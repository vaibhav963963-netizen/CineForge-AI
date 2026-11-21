// Script Book: topics → scripts written ONLINE (Groq) → saved permanently → selected later for OFFLINE video
// production. Scripts themselves are stored as project script versions (the same storage the renderer reads); the book
// keeps each entry's status, its project/version links, approvals and uses.
//
// Status: pending → generating → generated (every required check passed) | needs_review | failed → approved → used
// "approved" is only possible for a version whose required checks all passed (status READY) — never otherwise.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { PATHS } from './workspace.js';
import { CONFIG } from './config.js';
import { getScriptVersion, loadProject } from './projects.js';
import { TRENDING_TOPICS } from './trends.js';

export const STATUSES = ['pending', 'generating', 'generated', 'needs_review', 'approved', 'used', 'failed'];
const FILE = () => path.join(PATHS.logs, 'scriptbook', 'scriptbook.json');
const now = () => new Date().toISOString();

export function loadBook() { try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return { version: 1, entries: [] }; throw new Error(`Script Book file is unreadable: ${e.message}`); } }
/** atomic, flushed write (a crash never leaves a half-written book) */
export function saveBook(book) {
  const f = FILE(), tmp = `${f}.tmp`; fs.mkdirSync(path.dirname(f), { recursive: true });
  const fd = fs.openSync(tmp, 'w'); try { fs.writeSync(fd, JSON.stringify(book, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, f);
}
const keyOf = (e) => [e.topic.trim().toLowerCase(), e.language, e.durationSeconds, e.personality, e.voice].join('|');

/** add topics (deduplicated by topic + language + duration + personality + voice) */
export function addTopics(items, { source = 'manual' } = {}) {
  const book = loadBook(), have = new Set(book.entries.map(keyOf)), added = [];
  for (const it of items) {
    const e = { topic: String(it.topic || '').trim(), language: it.language, durationSeconds: +it.durationSeconds, personality: it.personality, voice: it.voice, style: it.style || 'tall-tale', character: it.character || 'curious_student', visualMode: it.visualMode || 'hybrid-local' };
    if (!e.topic || !e.language || !e.durationSeconds || !e.personality || !e.voice) throw new Error(`incomplete topic: ${JSON.stringify(it).slice(0, 120)}`);
    if (have.has(keyOf(e))) continue;
    const entry = { id: crypto.randomUUID().slice(0, 12), ...e, source, status: 'pending', createdAt: now(), updatedAt: now(), attempts: 0, projectId: null, version: null, jobId: null, error: null, approvals: [], uses: [] };
    book.entries.push(entry); have.add(keyOf(e)); added.push(entry);
  }
  saveBook(book); return added;
}

/** topics from the EXISTING topic storage: the automation topic queue (read-only) and the curated Topic Ideas */
export function existingTopics() {
  let queue = [];
  try { const db = new DatabaseSync(CONFIG.AUTOMATION_DB, { readOnly: true }); const row = db.prepare("SELECT value FROM settings WHERE key = 'topicQueue'").get(); db.close(); queue = row ? JSON.parse(row.value) : []; } catch {}
  return { automationQueue: Array.isArray(queue) ? queue.map(String) : [], topicIdeas: TRENDING_TOPICS.map((t) => ({ topic: t.title, language: t.language, personality: t.personality, style: t.style })) };
}

const set = (id, patch) => { const book = loadBook(), e = book.entries.find((x) => x.id === id); if (!e) throw Object.assign(new Error('Script Book entry not found'), { status: 404 }); Object.assign(e, patch, { updatedAt: now() }); saveBook(book); return e; };
export const getEntry = (id) => loadBook().entries.find((x) => x.id === id) || null;
export const markGenerating = (id, { jobId, projectId }) => set(id, { status: 'generating', jobId, projectId, error: null, attempts: (getEntry(id)?.attempts || 0) + 1 });

/**
 * Bring "generating" entries up to date from their jobs (jobs: the JobManager). Completed → the saved version's own
 * status decides: READY → generated, FAILED → failed, anything else → needs_review. Failed/cancelled job → failed.
 */
export function syncWithJobs(jobs) {
  const book = loadBook(); let changed = false;
  for (const e of book.entries.filter((x) => x.status === 'generating')) {
    const j = e.jobId ? jobs.get(e.jobId) : null; if (!j) { if (e.jobId) { Object.assign(e, { status: 'failed', error: 'generation job not found (studio restarted during generation?) — generate again' }); changed = true; } continue; }
    if (j.status === 'completed') {
      const pr = loadProject(e.projectId), v = pr?.script?.versions?.at(-1)?.version;
      const sv = v ? getScriptVersion(e.projectId, v) : null, st = sv?.meta?.status;
      Object.assign(e, { version: v || null, scriptStatus: st || 'unknown', model: sv?.meta?.model?.name || null, status: st === 'READY' ? 'generated' : st === 'FAILED' ? 'failed' : 'needs_review', error: st === 'FAILED' ? 'the script failed its language checks' : null, generatedAt: now(), updatedAt: now() });
      changed = true;
    } else if (['failed', 'cancelled', 'interrupted'].includes(j.status)) { Object.assign(e, { status: 'failed', error: String(j.error || j.status).slice(0, 300), updatedAt: now() }); changed = true; }
  }
  if (changed) saveBook(book);
  return book;
}

/** re-read a script version's checks (e.g. after the user edited and re-validated it in Script Studio) */
export function refreshFromVersion(id, version) {
  const e = getEntry(id); if (!e?.projectId) throw Object.assign(new Error('this entry has no script yet'), { status: 409 });
  const sv = getScriptVersion(e.projectId, +version); if (!sv) throw Object.assign(new Error(`script v${version} not found`), { status: 404 });
  const st = sv.meta?.status;
  return set(id, { version: +version, scriptStatus: st || 'unknown', status: e.status === 'approved' || e.status === 'used' ? e.status : st === 'READY' ? 'generated' : st === 'FAILED' ? 'failed' : 'needs_review' });
}

/** approve ONLY a version whose required checks all passed; earlier approvals are kept */
export function approve(id, { version = null } = {}) {
  const e = getEntry(id); if (!e) throw Object.assign(new Error('Script Book entry not found'), { status: 404 });
  const v = +(version || e.version); const sv = e.projectId && v ? getScriptVersion(e.projectId, v) : null;
  if (!sv) throw Object.assign(new Error('there is no generated script to approve'), { status: 409 });
  if (sv.meta?.status !== 'READY') {
    const failing = Object.entries(sv.meta?.gates || {}).filter(([, g]) => !g.ok).map(([k]) => k);
    throw Object.assign(new Error(`script v${v} is ${sv.meta?.status || 'not validated'} — it cannot be approved until every required check passes${failing.length ? ` (failing: ${failing.join(', ')})` : ''}. Fix it in Script Studio, then refresh this entry.`), { status: 409, failing });
  }
  return set(id, { status: 'approved', version: v, approvedVersion: v, approvals: [...(e.approvals || []), { version: v, at: now() }] });
}
export const setQueued = (id, q) => set(id, { queued: !!q });
export function markUsed(id, { jobId }) { const e = getEntry(id); return set(id, { status: 'used', uses: [...(e.uses || []), { jobId, version: e.approvedVersion, at: now() }] }); }
export function markFailed(id, error) { return set(id, { status: 'failed', error: String(error).slice(0, 300) }); }
export function removeEntry(id) { const book = loadBook(), i = book.entries.findIndex((x) => x.id === id); if (i < 0) return false; if (['approved', 'used'].includes(book.entries[i].status)) throw Object.assign(new Error('approved or used scripts are kept'), { status: 409 }); book.entries.splice(i, 1); saveBook(book); return true; }
