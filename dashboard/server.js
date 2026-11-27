// AI SHORTS STUDIO — local server: dashboard UI + validated generation API + persistent job system.
// Zero npm dependencies (Node 22+). Binds to 127.0.0.1 only. Every path resolves inside the workspace.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHS, ROOT, STUDIO_CONFIG, ensureDirs, rel, CHROME } from './lib/workspace.js';
import { publicCatalog, getCatalog } from './lib/catalog.js';
import { validateGenerationConfig, scriptFingerprint, configHash } from './lib/validate.js';
import { JobManager } from './lib/jobs.js';
import { createProject, loadProject, updateProject, listProjects, addScriptVersion, getScriptVersion, approveScriptVersion, updateScriptMeta, projectDir, deleteProject } from './lib/projects.js';
import { reviewClaims, findTopicFacts, listFactFiles, claimsGate, confirmClaims, pendingClaims } from './lib/factcheck.js';
import { runScriptJob, runRenderJob, renderPlan, scriptPlan, inputFromConfig } from './lib/pipeline.js';
import { checkLanguage, estimateSeconds, qualityGates, readiness, gateGroups, claimLedger } from './lib/scriptgen.js';
import { generateImage, seedFor, readImageIndex, writeImageIndex, freeVram } from './lib/imagegen.js';
import { createSetupRoutes } from './lib/setup/routes.js';
import { overview } from './lib/overview.js';
import { setQueueResumeHandler, isQueuePaused, pauseScriptBookQueue, resumeScriptBookQueue, getScriptBookQueueStatus } from './lib/sbqueue.js';
import { CONFIG, assertConfig } from './lib/config.js';
import { getQualityInspector, getCorrectionEngine, getPublishingGuard, QUALITY_CONFIG } from '../quality-gate/index.js';

assertConfig('The studio server');   // invalid .env values stop here with an actionable message

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// never die silently: log and keep serving (a crashed server would also orphan the running job)
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e && e.stack || e); try { fs.appendFileSync(path.join(PATHS.logs, 'server-errors.log'), `${new Date().toISOString()} ${e && e.stack || e}\n`); } catch {} });
process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e && e.stack || e); try { fs.appendFileSync(path.join(PATHS.logs, 'server-errors.log'), `${new Date().toISOString()} ${e && e.stack || e}\n`); } catch {} });
const PORT = CONFIG.PORT;   // central configuration (.env / environment / studio-config.json)
ensureDirs();
// one server per workspace: two servers sharing logs/jobs would mark each other's running jobs "interrupted" and
// could run two GPU jobs at once
const LOCK = path.join(PATHS.jobs, '.server.lock');
try {
  const other = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
  let alive = false; try { process.kill(other.pid, 0); alive = other.pid !== process.pid; } catch {}
  if (alive) { console.error(`\nAnother studio server is already running for this workspace (pid ${other.pid}, http://127.0.0.1:${other.port}/). Open that one, or stop it first.\n`); process.exit(1); }
} catch {}
fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, port: PORT, startedAt: new Date().toISOString() }));
const releaseLock = () => { try { if (JSON.parse(fs.readFileSync(LOCK, 'utf8')).pid === process.pid) fs.rmSync(LOCK); } catch {} };
process.on('exit', releaseLock); for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(s, () => process.exit(0));
const jobs = new JobManager();
// System Setup (dependency scanner, download manager, installer). Install/repair/update wait while a job runs.
const setup = createSetupRoutes({ port: PORT, isBusy: () => (jobs.running ? `a ${jobs.running.kind || 'render'} job is running` : null) });

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2' };

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let b = ''; req.on('data', (c) => { b += c; if (b.length > 2e6) { reject(new Error('request too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('invalid JSON body')); } }); req.on('error', reject);
});
class HttpError extends Error { constructor(code, msg, extra) { super(msg); this.code = code; this.extra = extra; } }

function systemInfo() {
  const cat = getCatalog();
  let disk = null; try { const s = fs.statfsSync(ROOT); disk = { freeGB: +((s.bavail * s.bsize) / 1024 ** 3).toFixed(1), totalGB: +((s.blocks * s.bsize) / 1024 ** 3).toFixed(1) }; } catch {}
  return {
    workspace: ROOT, cpu: os.cpus()[0]?.model, ramTotalGB: Math.round(os.totalmem() / 1024 ** 3), ramFreeGB: +(os.freemem() / 1024 ** 3).toFixed(1), node: process.version, disk,
    chrome: CHROME, paths: { projects: rel(PATHS.projects), exports: rel(PATHS.exports), models: 'models', python: rel(PATHS.python), ffmpeg: rel(PATHS.ffmpegBin), jobs: rel(PATHS.jobs) },
    engines: cat.engines, runningJob: jobs.running ? jobs.running.id : null,
  };
}

// ── media (only projects/ and exports/, with byte ranges for video seeking) ──────────────────────────────────
function serveFile(req, res, full) {
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const stat = fs.statSync(full), type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', range = req.headers.range;
  if (range) {
    const [a, b] = range.replace(/bytes=/, '').split('-'); const start = parseInt(a, 10), end = b ? parseInt(b, 10) : stat.size - 1;
    if (!(start >= 0 && end < stat.size && start <= end)) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': type });
    return req.method === 'HEAD' ? res.end() : fs.createReadStream(full, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  return req.method === 'HEAD' ? res.end() : fs.createReadStream(full).pipe(res);
}
function media(req, res, p) {
  const [kind, ...restParts] = p.split('/'), base = kind === 'projects' ? PATHS.projects : kind === 'exports' ? PATHS.exports : null;
  if (!base) { res.writeHead(404); return res.end(); }
  const full = path.resolve(base, restParts.join('/'));
  if (!full.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  return serveFile(req, res, full);
}

// ── job submission helpers ───────────────────────────────────────────────────────────────────────────────
function submitScriptJob({ input, projectId, requestKey, facts, origin = null }) {
  facts = typeof facts === 'string' && facts.trim() ? facts.trim().slice(0, 4000) : null;
  const v = validateGenerationConfig(input, { purpose: 'script' });
  if (!v.ok) throw new HttpError(422, 'Invalid selection', { errors: v.errors });
  let project = projectId ? loadProject(projectId) : null;
  // a project keeps one script fingerprint (topic + language + personality + duration); a different one → new project
  if (!project || project.script.versions.some((x) => x.fingerprint !== scriptFingerprint(v.config))) project = createProject({ topic: v.config.topic, config: v.config, configHash: configHash(v.config) });
  else updateProject(project.id, (p) => { p.config = v.config; p.configHash = configHash(v.config); });
  const dup = jobs.findActiveDuplicate({ requestKey, configHash: 'script:' + configHash(v.config), projectId: project.id });
  if (dup) return { job: dup, project, deduplicated: true, warnings: v.warnings };
  const job = jobs.submit({ kind: 'script', projectId: project.id, title: v.config.topic, config: v.config, plan: scriptPlan(), requestKey, origin, configHash: 'script:' + configHash(v.config) },
    (j) => runScriptJob(j, { projectId: project.id, config: v.config, facts }));
  return { job, project, deduplicated: false, warnings: v.warnings };
}

// Script Book queue: starts the next queued "pending" entry when no Script Book script is being written (one at a time)
let sbTicking = false;
// pause/resume/status live in lib/sbqueue.js (no side effects, so tests can import it without starting a server)
setQueueResumeHandler(() => { scriptBookQueueTick(); });
export { pauseScriptBookQueue, resumeScriptBookQueue, getScriptBookQueueStatus };

export async function scriptBookQueueTick() {
  if (sbTicking) return;
  if (isQueuePaused()) return;
  sbTicking = true;
  try {
    const sb = await import('./lib/scriptbook.js');
    const book = sb.syncWithJobs(jobs);
    if (book.entries.some((e) => e.status === 'generating')) return;
    // a DAILY quota stops the batch: pause queue until reset time
    const failedDaily = book.entries.find((e) => e.status === 'failed' && /daily (limit|quota)/i.test(e.error || '') && e.queued === false && Date.now() - Date.parse(e.updatedAt) < 24 * 60 * 60 * 1000);
    if (failedDaily) {
      const groq = await import('./lib/groq.js');
      const b = groq.rateBudget();
      const resetAt = b.dailyResetAt || (Date.now() + 15 * 60 * 1000);
      pauseScriptBookQueue(resetAt);
      const left = book.entries.filter((e) => e.queued && e.status === 'pending');
      if (left.length) console.log(`[scriptbook] daily quota reached — queue paused until ${new Date(resetAt).toISOString()}; ${left.length} queued topic(s) pending`);
      return;
    }
    const next = book.entries.find((e) => e.status === 'pending' && e.queued);
    if (!next) return;
    try { const g = await import('./lib/scriptmodel.js'); await g.ensureReady(); }
    catch (e) {
      if (e.code === 'daily-limit' && e.resetAt) {
        pauseScriptBookQueue(e.resetAt);
        console.log(`[scriptbook] queue paused on daily limit until ${new Date(e.resetAt).toISOString()}`);
        return;
      }
      for (const x of book.entries.filter((y) => y.queued)) sb.setQueued(x.id, false);
      console.log(`[scriptbook] queue paused: ${e.message}`);
      return;
    }
    const input = { topic: next.topic, language: next.language, personality: next.personality, voice: next.voice, style: next.style, character: next.character, durationSeconds: next.durationSeconds, visualMode: next.visualMode };
    const { job, project } = submitScriptJob({ input, projectId: null, requestKey: `scriptbook-${next.id}-${(next.attempts || 0) + 1}` });
    sb.markGenerating(next.id, { jobId: job.id, projectId: project.id }); sb.setQueued(next.id, false);
  } catch (e) { console.log(`[scriptbook] queue error: ${e.message}`); } finally { sbTicking = false; }
}
setInterval(() => { scriptBookQueueTick(); }, 15000).unref?.();

function submitRenderJob({ input, projectId, scriptVersion, requestKey, acceptUnverifiedClaims = false, origin = null }) {
  const v = validateGenerationConfig(input, { purpose: 'render', hasApprovedScript: !!scriptVersion });
  if (!v.ok) throw new HttpError(422, 'Invalid selection', { errors: v.errors });
  let project = projectId ? loadProject(projectId) : null;
  if (scriptVersion) {
    if (!project) throw new HttpError(404, `project ${projectId} not found`);
    const s = project.script.versions.find((x) => x.version === +scriptVersion);
    if (!s) throw new HttpError(404, `script v${scriptVersion} not found`);
    if (s.fingerprint !== scriptFingerprint(v.config)) throw new HttpError(409, `Script v${scriptVersion} was written for a different topic, language, personality or duration. Regenerate the preview for the current selection.`, { stale: true });
    // factual claims must be reviewed (or supported by the topic's fact file) before a render starts
    const gate = claimsGate((getScriptVersion(project.id, +scriptVersion) || {}).meta);
    if (!gate.ok) throw new HttpError(409, gate.message, { factCheck: true, pending: gate.pending, contradicted: gate.contradicted || [] });
    if (project.script.approvedVersion !== +scriptVersion) approveScriptVersion(project.id, +scriptVersion);
  }
  if (!project) project = createProject({ topic: v.config.topic, config: v.config, configHash: configHash(v.config) });
  const hash = configHash(v.config) + ':' + (scriptVersion || 'gen');
  const dup = jobs.findActiveDuplicate({ requestKey, configHash: hash, projectId: project.id });
  if (dup) return { job: dup, project, deduplicated: true, warnings: v.warnings };
  updateProject(project.id, (p) => { p.config = v.config; p.configHash = configHash(v.config); });
  const job = jobs.submit({ kind: 'render', projectId: project.id, title: v.config.topic, config: v.config, plan: renderPlan({ approved: !!scriptVersion, hybrid: v.config.visual.visualMode === 'hybrid-local' }), requestKey, origin, configHash: hash },
    (j) => runRenderJob(j, { projectId: project.id, config: v.config, scriptVersion: scriptVersion ? +scriptVersion : null, acceptUnverifiedClaims: acceptUnverifiedClaims === true }));
  return { job, project, deduplicated: false, warnings: v.warnings };
}

// ── router ──────────────────────────────────────────────────────────────────────────────────────────────────
async function api(req, res, url) {
  const p = url.pathname, m = (re) => p.match(re), method = req.method;
  if (p.startsWith('/api/setup/')) return setup.handle(req, res, url, { readBody, send });
  if (p === '/api/catalog') return send(res, 200, publicCatalog());
  if (p === '/api/system') return send(res, 200, systemInfo());
  if (p === '/api/characters') return send(res, 200, getCatalog().characters);
  if (p === '/api/voices') return send(res, 200, getCatalog().voices);
  if (p === '/api/validate' && method === 'POST') { const b = await readBody(req); const v = validateGenerationConfig(b.input || b, { purpose: b.purpose || 'render', hasApprovedScript: !!b.scriptVersion }); return send(res, v.ok ? 200 : 422, v); }

  // Script Book — topics → scripts written online (Groq) → saved → selected later for offline video production
  if (p.startsWith('/api/scriptbook')) {
    scriptBookQueueTick();
    const sb = await import('./lib/scriptbook.js');
    const fail = (e) => { throw new HttpError(e.status || 500, e.message, e.failing ? { failing: e.failing } : undefined); };
    const inputOf = (e) => ({ topic: e.topic, language: e.language, personality: e.personality, voice: e.voice, style: e.style, character: e.character, durationSeconds: e.durationSeconds, visualMode: e.visualMode });
    const online = async () => { try { const g = await import('./lib/scriptmodel.js'); await g.ensureReady(); return { ok: true }; } catch (e) { return { ok: false, reason: e.message, code: e.code || null }; } };
    const generate = (e) => {
      if (e.status === 'generating' && e.jobId && ['queued', 'running'].includes(jobs.get(e.jobId)?.status)) return { entry: e, deduplicated: true };   // never two jobs for one entry
      if (['approved', 'used'].includes(e.status)) throw new HttpError(409, `this script is already ${e.status}; add the topic again for a new script`);
      const { job, project } = submitScriptJob({ input: inputOf(e), projectId: e.projectId && (sb.getEntry(e.id)?.status !== 'failed') ? e.projectId : null, requestKey: `scriptbook-${e.id}-${(e.attempts || 0) + 1}` });
      return { entry: sb.markGenerating(e.id, { jobId: job.id, projectId: project.id }), jobId: job.id };
    };
    try {
      let mm;
      if (p === '/api/scriptbook' && method === 'GET') {
        const groq = await import('./lib/groq.js');
        const entries = sb.syncWithJobs(jobs).entries.map((e) => { const pr = e.projectId ? loadProject(e.projectId) : null; return { ...e, versions: (pr?.script?.versions || []).map((v) => ({ version: v.version, source: v.source || null, createdAt: v.createdAt || null })), projectApprovedVersion: pr?.script?.approvedVersion || null }; });
        return send(res, 200, { entries, statuses: sb.STATUSES, budget: groq.rateBudget(), queue: getScriptBookQueueStatus() });
      }
      if (p === '/api/scriptbook/status' && method === 'GET') { const sm = await import('./lib/scriptmodel.js'); const groq = await import('./lib/groq.js'); return send(res, 200, { provider: CONFIG.SCRIPT_GENERATION_PROVIDER, providerName: sm.providerName(), model: sm.configuredModel(), enabled: CONFIG.SCRIPT_GENERATION_ENABLED, keyPresent: sm.keyPresent(), online: await online(), production: 'local (offline)', budget: groq.rateBudget(), queue: getScriptBookQueueStatus() }); }
      if (p === '/api/scriptbook/existing-topics' && method === 'GET') return send(res, 200, sb.existingTopics());
      if (p === '/api/scriptbook/topics' && method === 'POST') { const b = await readBody(req); return send(res, 201, { added: sb.addTopics(Array.isArray(b.items) ? b.items : [b], { source: b.source || 'manual' }) }); }
      if (p === '/api/scriptbook/generate-pending' && method === 'POST') {
        const o = await online(); if (!o.ok) throw new HttpError(503, `scripts cannot be written now: ${o.reason}. Saved scripts remain usable for videos.`);
        // ONE script at a time (the Groq account's tokens-per-minute budget is shared): queue them; the queue below
        // starts the next one when the previous finishes
        const queued = sb.syncWithJobs(jobs).entries.filter((e) => e.status === 'pending').map((e) => sb.setQueued(e.id, true));
        scriptBookQueueTick();
        return send(res, 202, { queued: queued.length, started: 0 });
      }
      if ((mm = p.match(/^\/api\/scriptbook\/([\w-]{6,40})\/(generate|approve|refresh|render)$/)) && method === 'POST') {
        const e = sb.syncWithJobs(jobs).entries.find((x) => x.id === mm[1]); if (!e) throw new HttpError(404, 'Script Book entry not found');
        const b = await readBody(req).catch(() => ({}));
        if (mm[2] === 'generate') { const o = await online(); if (!o.ok) throw new HttpError(503, `scripts cannot be written now: ${o.reason}. Saved scripts remain usable for videos.`); return send(res, 202, generate(e)); }
        if (mm[2] === 'approve') return send(res, 200, sb.approve(e.id, { version: b.version || null }));
        if (mm[2] === 'refresh') return send(res, 200, sb.refreshFromVersion(e.id, b.version || e.version));
        // render: an APPROVED saved script → fully local, offline video production (no Groq call anywhere in it)
        if (!['approved', 'used'].includes(e.status) || !e.approvedVersion) throw new HttpError(409, 'only an approved script can be used for a video');
        const { job } = submitRenderJob({ input: inputOf(e), projectId: e.projectId, scriptVersion: e.approvedVersion, requestKey: `scriptbook-render-${e.id}-${(e.uses || []).length + 1}` });
        return send(res, 202, { jobId: job.id, entry: sb.markUsed(e.id, { jobId: job.id }) });
      }
      if ((mm = p.match(/^\/api\/scriptbook\/([\w-]{6,40})$/)) && method === 'DELETE') return send(res, 200, { removed: sb.removeEntry(mm[1]) });
    } catch (e) { if (e instanceof HttpError) throw e; fail(e); }
    throw new HttpError(404, 'unknown Script Book route');
  }

  // dashboard: real numbers from the project folders, job history and the automation database
  if (p === '/api/overview' && method === 'GET') {
    let db = null;
    try { const A = await import('../automation/db.mjs'); autoDb = autoDb || A.openDb(); db = autoDb; } catch {}
    return send(res, 200, overview({ projects: listProjects(), jobs: jobs.list({ limit: 500 }), db }));
  }
  // projects
  if (p === '/api/projects' && method === 'GET') return send(res, 200, listProjects());
  if (p === '/api/projects' && method === 'POST') {   // a project with a hand-written script (no model needed)
    const b = await readBody(req); const v = validateGenerationConfig(b.input, { purpose: 'render', hasApprovedScript: true });
    if (!v.ok) throw new HttpError(422, 'Invalid selection', { errors: v.errors });
    const pr = createProject({ topic: v.config.topic, config: v.config, configHash: configHash(v.config) });
    return send(res, 201, { project: pr });
  }
  let r;
  // permanent delete of one short (project folder + exported video); refused while a job for it is queued or running.
  // (Placed after "let r": declared above it, it threw "Cannot access 'r' before initialization" for every later route.)
  if ((r = m(/^\/api\/projects\/([A-Za-z0-9][\w.-]{0,120})$/)) && method === 'DELETE') {
    const busy = jobs.list({ projectId: r[1], limit: 200 }).filter((j) => j.status === 'running' || j.status === 'queued');
    if (busy.length) throw new HttpError(409, `a ${busy[0].kind} job is still ${busy[0].status} for this short — cancel it or wait for it to finish first`);
    try { const removed = deleteProject(r[1]); console.log(`[library] deleted ${r[1]} (${removed.length} item(s))`); return send(res, 200, { deleted: r[1], removed: removed.map((x) => rel(x)) }); }
    catch (e) { throw new HttpError(e.status || 500, e.message); }
  }
  if ((r = m(/^\/api\/projects\/([a-z0-9-]+)$/))) { const pr = loadProject(r[1]); if (!pr) throw new HttpError(404, 'project not found'); return send(res, 200, pr); }
  if ((r = m(/^\/api\/projects\/([a-z0-9-]+)\/scripts\/(\d+)$/)) && method === 'GET') { const s = getScriptVersion(r[1], +r[2]); if (!s) throw new HttpError(404, 'script version not found'); return send(res, 200, s); }
  if ((r = m(/^\/api\/projects\/([a-z0-9-]+)\/scripts$/)) && method === 'POST') {
    // save an edited / hand-written script as a new version (language checked against the project's config)
    const pr = loadProject(r[1]); if (!pr) throw new HttpError(404, 'project not found');
    const b = await readBody(req), lines = (b.lines || []).map((l) => ({ text: String(l.text || '').trim(), ...(l.say ? { say: String(l.say).trim() } : {}), visual: String(l.visual || '').trim(), ...(l.onScreen ? { onScreen: String(l.onScreen).trim() } : {}) })).filter((l) => l.text);
    if (lines.length < 2) throw new HttpError(422, 'A script needs at least 2 lines.');
    const script = { title: String(b.title || pr.title).trim(), lines };
    const problems = checkLanguage(script, pr.config);
    if (problems.length) throw new HttpError(422, `Script does not match ${pr.config.language.name}: ${problems.join('; ')}`);
    const est = estimateSeconds(script, pr.config);
    const saved = addScriptVersion(pr.id, script, { source: b.baseVersion ? 'edited' : 'manual', baseVersion: b.baseVersion || null, fingerprint: scriptFingerprint(pr.config), configHash: configHash(pr.config), wordCount: est.words, estimatedSeconds: est.seconds, language: pr.config.language.id, personality: pr.config.narration.personality, targetSeconds: pr.config.durationSeconds });
    // hand-written and edited scripts get the same fact review as model scripts
    const tf = findTopicFacts(pr.config.topic), review = reviewClaims(script, { topic: pr.config.topic, topicFacts: tf });
    // the edited text is validated as ITSELF (deterministic gates only — no model pass): a READY status can never carry
    // over from the version it was edited from
    const base = { script, meta: { claimReview: review, factFile: tf?.file || null, factsProvided: false } };
    const gates = qualityGates(pr.config, base, []);
    let meta = updateScriptMeta(pr.id, saved.version, { claimReview: review, factFile: tf?.file || null, claimsApproved: review.summary.needsReview === 0,
      gates, status: readiness(gates), gateGroups: gateGroups(gates), claims: claimLedger(base, tf), validatedBy: 'deterministic checks (edited version; no model review)', generatedAt: new Date().toISOString() }).meta;
    if (b.approveClaims) {
      let patch; try { patch = confirmClaims(meta, 'all'); } catch (e) { throw new HttpError(e.status || 409, e.message, { factCheck: true, claimReview: review, version: saved.version }); }
      meta = updateScriptMeta(pr.id, saved.version, { ...patch, claimsApprovedBy: 'author (approveClaims)' }).meta;
    }
    if (b.approve) approveScriptVersion(pr.id, saved.version);
    return send(res, 201, { version: saved.version, estimate: est, approved: !!b.approve, claimSummary: review.summary, claimsApproved: !!meta.claimsApproved, pendingClaims: pendingClaims(meta) });
  }
  if ((r = m(/^\/api\/projects\/([a-z0-9-]+)\/scripts\/(\d+)\/claims$/))) {
    const sv = getScriptVersion(r[1], +r[2]); if (!sv) throw new HttpError(404, 'script version not found');
    if (method === 'GET') return send(res, 200, { review: sv.meta.claimReview || null, confirmedClaims: sv.meta.confirmedClaims || [], claimsApproved: !!sv.meta.claimsApproved, pending: pendingClaims(sv.meta), gate: claimsGate(sv.meta), factFile: sv.meta.factFile || null });
    if (method === 'POST') {   // the user confirms flagged claims: { confirm: [claimId, …] | 'all' }
      const b = await readBody(req);
      let patch; try { patch = confirmClaims(sv.meta, b.confirm === 'all' ? 'all' : Array.isArray(b.confirm) ? b.confirm.map(String) : []); } catch (e) { throw new HttpError(e.status || 409, e.message, { factCheck: true }); }
      // unattended automation confirms only scripts whose gates passed, and is recorded as such (never as the user)
      const by = b.by === 'automation' ? 'automation (script gates passed)' : 'user (Script Studio)';
      const meta = updateScriptMeta(r[1], +r[2], { ...patch, ...(patch.claimsApproved ? { claimsApprovedBy: by } : {}) }).meta;
      return send(res, 200, { confirmedClaims: meta.confirmedClaims, claimsApproved: !!meta.claimsApproved, pending: pendingClaims(meta), gate: claimsGate(meta) });
    }
  }
  if (p === '/api/facts' && method === 'GET') return send(res, 200, listFactFiles().map(({ id, title, file, match, verified, theories, legends, knownErrors }) => ({ id, title, file, match, counts: { verified: (verified || []).length, theories: (theories || []).length, legends: (legends || []).length, knownErrors: (knownErrors || []).length } })));
  if (p === '/api/facts/match' && method === 'GET') { const tf = findTopicFacts(url.searchParams.get('topic') || ''); return send(res, 200, tf ? { id: tf.id, title: tf.title, file: tf.file, verified: tf.verified, theories: tf.theories, legends: tf.legends, knownErrors: tf.knownErrors, uncertain: tf.uncertain || null, sources: tf.sources || [] } : null); }
  if ((r = m(/^\/api\/projects\/([a-z0-9-]+)\/scripts\/(\d+)\/approve$/)) && method === 'POST') { return send(res, 200, approveScriptVersion(r[1], +r[2]).script); }
  if ((r = m(/^\/api\/projects\/([a-z0-9-]+)\/storyboard$/))) { const f = path.join(projectDir(r[1]), 'storyboard', 'storyboard.json'); if (!fs.existsSync(f)) throw new HttpError(404, 'no storyboard yet'); return send(res, 200, JSON.parse(fs.readFileSync(f, 'utf8'))); }
  if ((r = m(/^\/api\/projects\/([a-z0-9-]+)\/images$/))) return send(res, 200, readImageIndex(projectDir(r[1])));
  if ((r = m(/^\/api\/projects\/([a-z0-9-]+)\/images\/(S\d+)\/(approve|regenerate)$/)) && method === 'POST') {
    const dir = projectDir(r[1]), idx = readImageIndex(dir), e = idx.shots[r[2]];
    if (!e) throw new HttpError(404, 'no image for that shot');
    if (r[3] === 'approve') { e.approved = true; e.approvedAt = new Date().toISOString(); writeImageIndex(dir, idx); return send(res, 200, e); }
    if (jobs.running) throw new HttpError(409, 'A render is running; regenerate after it finishes.');
    const seed = seedFor(e.prompt, (e.regenerations || 0) + 1);
    const meta = await generateImage({ positive: e.prompt, negative: e.negative, seed, outFile: path.join(dir, e.file), prefix: `studio/${r[1]}/${r[2]}` });
    await freeVram();
    Object.assign(e, { seed, key: meta.key, approved: false, regenerations: (e.regenerations || 0) + 1, createdAt: new Date().toISOString() }); writeImageIndex(dir, idx);
    return send(res, 200, e);
  }

  // jobs
  if (p === '/api/scripts/preview' && method === 'POST') { const b = await readBody(req); const { job, project, deduplicated, warnings } = submitScriptJob(b); return send(res, 202, { jobId: job.id, projectId: project.id, deduplicated, warnings }); }
  if (p === '/api/jobs' && method === 'POST') { const b = await readBody(req); const { job, project, deduplicated, warnings } = submitRenderJob(b); return send(res, 202, { jobId: job.id, projectId: project.id, deduplicated, warnings }); }
  if (p === '/api/jobs' && method === 'GET') return send(res, 200, jobs.list({ projectId: url.searchParams.get('projectId'), limit: +(url.searchParams.get('limit') || 50) }));
  if (p === '/api/jobs/active') return send(res, 200, jobs.list({ limit: 200 }).filter((j) => j.status === 'running' || j.status === 'queued'));
  if ((r = m(/^\/api\/jobs\/([\w-]+)$/))) { const j = jobs.get(r[1]); if (!j) throw new HttpError(404, 'job not found'); return send(res, 200, j.snapshot()); }
  if ((r = m(/^\/api\/jobs\/([\w-]+)\/record$/))) { const f = path.join(PATHS.jobs, `${r[1]}.json`); if (!fs.existsSync(f)) throw new HttpError(404, 'job not found'); return send(res, 200, JSON.parse(fs.readFileSync(f, 'utf8'))); }
  if ((r = m(/^\/api\/jobs\/([\w-]+)\/cancel$/)) && method === 'POST') { const j = jobs.get(r[1]); if (!j) throw new HttpError(404, 'job not found'); return send(res, 200, { cancelled: j.requestCancel(), status: j.status }); }
  if ((r = m(/^\/api\/jobs\/([\w-]+)\/retry$/)) && method === 'POST') {
    const j = jobs.get(r[1]); if (!j) throw new HttpError(404, 'job not found');
    if (!['failed', 'cancelled'].includes(j.status)) throw new HttpError(409, 'only failed or cancelled jobs can be retried');
    const pr = loadProject(j.projectId), input = inputFromConfig(j.config);
    const out = j.kind === 'script' ? submitScriptJob({ input, projectId: j.projectId }) : submitRenderJob({ input, projectId: j.projectId, scriptVersion: pr?.script.approvedVersion || null });
    return send(res, 202, { jobId: out.job.id, projectId: out.project.id, retryOf: j.id });
  }
  if ((r = m(/^\/api\/jobs\/([\w-]+)\/events$/))) {
    const j = jobs.get(r[1]); if (!j) throw new HttpError(404, 'job not found');
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const push = (s) => res.write(`event: progress\ndata: ${JSON.stringify(s)}\n\n`);
    push(j.snapshot());
    if (['completed', 'failed', 'cancelled'].includes(j.status)) { res.write('event: end\ndata: {}\n\n'); return res.end(); }
    let last = 0, pending = null;
    const unsub = jobs.subscribe(j.id, (s) => {
      const now = Date.now(), terminal = ['completed', 'failed', 'cancelled'].includes(s.status);
      if (terminal) { clearTimeout(pending); push(s); res.write('event: end\ndata: {}\n\n'); cleanup(); return res.end(); }
      if (now - last > 250) { last = now; push(s); } else if (!pending) pending = setTimeout(() => { pending = null; last = Date.now(); push(j.snapshot()); }, 250);
    });
    const hb = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), 15000);
    const cleanup = () => { clearInterval(hb); clearTimeout(pending); if (unsub) unsub(); };
    req.on('close', cleanup);
    return;
  }
  // ── AI Video Quality Inspector API ─────────────────────────────────────────────────────────────
  if (p === '/api/quality' || p.startsWith('/api/quality/')) return await qualityApi(req, res, url, p, method);
  // ── CineForge (visual styles: the video renders run one at a time, in their own process) ─────────
  if (p === '/api/cineforge' || p.startsWith('/api/cineforge/')) return await cineforgeApi(req, res, url, p, method);
  // ── automation (scheduler state lives in logs/automation/automation.db; the scheduler is a separate process) ──
  if (p === '/api/automation' || p.startsWith('/api/automation/')) return await automationApi(req, res, url, p, method);
  throw new HttpError(404, `unknown endpoint ${method} ${p}`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = decodeURIComponent(url.pathname);
  try {
    if (p.startsWith('/api/')) return await api(req, res, url);
    if (p.startsWith('/media/')) return media(req, res, p.slice(7));
    // the dashboard's character previews load the SAME character code the videos use (read-only, two files only)
    const ENGINE3D = { '/engine3d/character3d.js': path.join(PATHS.styles, 'tall-tale', 'example', 'src', 'core', 'character3d.js'), '/engine3d/three.module.js': path.join(PATHS.styles, 'tall-tale', 'example', 'vendor', 'three.module.js') };
    // …and the per-character design files the character code imports (characters/index.js, characters/<id>/index.js)
    const cm = p.match(/^\/engine3d\/characters\/(?:([a-z_]+)\/)?index\.js$/);
    if (cm) { const f = path.join(PATHS.styles, 'tall-tale', 'example', 'src', 'core', 'characters', ...(cm[1] ? [cm[1]] : []), 'index.js'); if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' }); return fs.createReadStream(f).pipe(res); } }
    if (ENGINE3D[p]) { res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' }); return fs.createReadStream(ENGINE3D[p]).pipe(res); }    let f = path.join(__dirname, 'public', p === '/' ? 'index.html' : p);
    if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(__dirname, 'public', 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  } catch (e) {
    if (!res.headersSent) send(res, e.code && Number.isInteger(e.code) ? e.code : 500, { error: e.message, ...(e.extra || {}) });
    else res.end();
  }
});

server.listen(PORT, STUDIO_CONFIG.host || '127.0.0.1', () => {
  console.log('\n======================================================');
  console.log('  AI SHORTS STUDIO — dashboard + job server');
  console.log(`  http://127.0.0.1:${PORT}/`);
  console.log(`  workspace: ${ROOT}`);
  console.log(`  projects:  ${PATHS.projects}`);
  console.log(`  exports:   ${PATHS.exports}`);
  console.log(`  job store: ${PATHS.jobs}`);
  console.log('======================================================\n');
});

// ── automation API ────────────────────────────────────────────────────────────────────────────────────────────────
let autoDb = null;
async function automationApi(req, res, url, p, method) {
  const A = await import('../automation/db.mjs'), S = await import('../automation/settings.mjs');
  autoDb = autoDb || A.openDb();
  const db = autoDb, settings = () => S.validateSettings(A.getSettings(db)).value;
  if (p === '/api/automation' && method === 'GET') {
    const hb = db.prepare('SELECT * FROM heartbeat WHERE id = 1').get() || null;
    const state = db.prepare("SELECT value FROM settings WHERE key = 'state'").get();
    const runs = db.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT 30').all();
    const cps = Object.fromEntries(runs.map((r) => [r.id, db.prepare('SELECT stage, status, at FROM checkpoints WHERE run_id = ?').all(r.id)]));
    const events = db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 80').all();
    const attempts = db.prepare('SELECT * FROM attempts ORDER BY id DESC LIMIT 40').all();
    let health = null;
    if (url.searchParams.get('health') === '1') { try { health = await (await import('../automation/health.mjs')).healthReport(settings()); } catch (e) { health = { ok: false, error: e.message }; } }
    let youtube = null; try { youtube = (await import('../automation/youtube.mjs')).status(); } catch {}
    return send(res, 200, { heartbeat: hb ? { ...hb, ageSeconds: Math.round((Date.now() - Date.parse(hb.at)) / 1000) } : null, mode: state ? JSON.parse(state.value) : 'running',
      settings: settings(), defaults: S.DEFAULTS, runs, checkpoints: cps, events, attempts, health, youtube });
  }
  if (p === '/api/automation/settings' && method === 'POST') {
    const b = await readBody(req), upd = b.settings || {};
    for (const k of Object.keys(upd)) if (!(k in S.DEFAULTS)) throw new HttpError(422, `unknown setting "${k}"`);
    const v = S.validateSettings({ ...settings(), ...upd });
    if (!v.ok) throw new HttpError(422, 'Invalid automation settings', { errors: v.errors });
    A.putSettings(db, upd);
    return send(res, 200, { saved: Object.keys(upd), settings: settings() });
  }
  if (p === '/api/automation/command' && method === 'POST') {
    const b = await readBody(req), c = String(b.command || '');
    if (!/^(pause|resume|stop|run-now|publish:run_[\w-]+|requeue:run_[\w-]+)$/.test(c)) throw new HttpError(422, `unknown command "${c}"`);
    db.prepare('INSERT INTO commands (at, command) VALUES (?, ?)').run(new Date().toISOString(), c);
    return send(res, 202, { queued: c, note: 'applied by the scheduler on its next tick (≤ 30 s)' });
  }
  if (p === '/api/automation/youtube/videos' && method === 'GET') {
    const rows = db.prepare("SELECT id, topic, status, stage, youtube_video_id, youtube_url, publish_at, created_at, updated_at, last_error FROM runs ORDER BY created_at DESC LIMIT 200").all();
    const ups = Object.fromEntries(db.prepare("SELECT run_id, at FROM checkpoints WHERE stage = 'upload' AND status = 'done'").all().map((r) => [r.run_id, r.at]));
    const ids = rows.filter((r) => r.youtube_video_id).map((r) => r.youtube_video_id);
    let live = {}, liveError = null;
    if (ids.length) {
      try {
        const Y = await import('../automation/youtube.mjs'), tok = await Y.makeYouTube().accessToken();
        for (let k = 0; k < ids.length; k += 50) {
          const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status,snippet,statistics&id=${ids.slice(k, k + 50).join(',')}`, { headers: { Authorization: `Bearer ${tok}` } });
          const j = await r.json();
          for (const v of j.items || []) live[v.id] = { title: v.snippet?.title, privacy: v.status?.privacyStatus, publishAt: v.status?.publishAt || null, publishedAt: v.snippet?.publishedAt || null, uploadStatus: v.status?.uploadStatus, views: v.statistics?.viewCount ?? null };
        }
      } catch (e) { liveError = e.message; }
    }
    const videos = rows.map((r) => ({ runId: r.id, topic: r.topic, runStatus: r.status, stage: r.stage, videoId: r.youtube_video_id, url: r.youtube_url, uploadedAt: ups[r.id] || null, scheduledFor: r.publish_at, createdAt: r.created_at, lastError: r.last_error, youtube: r.youtube_video_id ? (live[r.youtube_video_id] || null) : null }));
    return send(res, 200, { videos, liveError, settings: settings() });
  }
  // change one Short's publish time: saved on the run (used at upload) and, if already uploaded and not public, on YouTube
  if (p === '/api/automation/youtube/schedule' && method === 'POST') {
    const b = await readBody(req), when = new Date(b.publishAt);
    if (!b.runId || isNaN(when)) throw new HttpError(422, 'runId and a valid publishAt are required');
    if (when.getTime() < Date.now() + 15 * 60 * 1000) throw new HttpError(422, 'The publish time must be at least 15 minutes in the future');
    const run = db.prepare('SELECT id, youtube_video_id FROM runs WHERE id = ?').get(b.runId);
    if (!run) throw new HttpError(404, 'Short not found');
    const iso = when.toISOString();
    let youtube = 'saved for upload';
    if (run.youtube_video_id) {
      const Y = await import('../automation/youtube.mjs'), tok = await Y.makeYouTube().accessToken();
      const cur = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${run.youtube_video_id}`, { headers: { Authorization: `Bearer ${tok}` } })).json();
      const st = cur.items?.[0]?.status;
      if (!st) throw new HttpError(404, 'The video was not found on YouTube');
      if (st.privacyStatus === 'public') throw new HttpError(409, 'This Short is already public; its publish time can no longer change');
      const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=status', { method: 'PUT', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: run.youtube_video_id, status: { privacyStatus: 'private', publishAt: iso, selfDeclaredMadeForKids: !!st.selfDeclaredMadeForKids, containsSyntheticMedia: st.containsSyntheticMedia !== false } }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new HttpError(502, `YouTube refused the new time: ${e.error?.message || r.status}`); }
      youtube = 'updated on YouTube';
    }
    db.prepare('UPDATE runs SET publish_at = ?, updated_at = ? WHERE id = ?').run(iso, new Date().toISOString(), run.id);
    return send(res, 200, { ok: true, publishAt: iso, youtube });
  }
  if (p === '/api/automation/youtube/status' && method === 'GET') {
    const Y = await import('../automation/youtube.mjs');
    const st = Y.status();
    return send(res, 200, {
      authorized: !!st.authorized,
      authorizedAt: st.authorizedAt || null,
      channelTitle: st.channel?.channelTitle || null,
      channelId: st.channel?.channelId || null,
      quotaUsedToday: st.quotaUsedToday ?? 0,
      quotaDaily: st.quotaDaily || 10000,
      clientSecret: !!st.clientSecret,
    });
  }
  if (p === '/api/automation/youtube/connect' && method === 'POST') {
    const Y = await import('../automation/youtube.mjs');
    Y.makeYouTube().authorize({ openBrowser: true }).catch((e) => {
      console.error('YouTube authorization background task:', e.message);
    });
    return send(res, 200, { ok: true, message: 'Google authorization page opened in your browser' });
  }
  if (p === '/api/automation/youtube/disconnect' && method === 'POST') {
    const Y = await import('../automation/youtube.mjs');
    const r = await Y.makeYouTube().disconnect();
    return send(res, 200, { ok: true, revoked: r.revoked, detail: r.detail });
  }
  if (p === '/api/automation/youtube/test' && method === 'POST') {
    const Y = await import('../automation/youtube.mjs');
    try {
      const ch = await Y.makeYouTube().verifyChannel();
      return send(res, 200, { ok: true, channelId: ch.channelId, channelTitle: ch.channelTitle, customUrl: ch.customUrl, channelCount: ch.channelCount });
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message, failureClass: e.failureClass || 'youtube_auth' });
    }
  }
  if (p.startsWith('/api/automation/runs/') && p.endsWith('/publish') && method === 'POST') {
    const runId = p.split('/')[4];
    const r = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
    if (!r) throw new HttpError(404, `run "${runId}" not found`);
    db.prepare("UPDATE runs SET status = 'queued', stage = 'upload', attempt = 0, next_attempt_at = ? WHERE id = ?")
      .run(new Date().toISOString(), runId);
    return send(res, 200, { ok: true, message: `Run ${runId} queued for upload` });
  }
  throw new HttpError(404, `unknown automation endpoint ${method} ${p}`);
}

// ── Quality Gate API ─────────────────────────────────────────────────────────────────────────────
async function cineforgeApi(req, res, url, p, method) {
  const cf = await import('./lib/cineforge/service.js');
  if (p === '/api/cineforge/styles' && method === 'GET') return send(res, 200, { styles: cf.listStyles() });
  if (p === '/api/cineforge/jobs' && method === 'GET') return send(res, 200, cf.jobStatus());
  if (p === '/api/cineforge/render' && method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    try { return send(res, 202, cf.startRender(b.style, { res: b.res || '1' })); }
    catch (e) { return send(res, e.status || 500, { error: e.message }); }
  }
  if (p === '/api/cineforge/video' && method === 'GET') {
    const f = cf.videoPath(url.searchParams.get('style') || '');
    if (!f) return send(res, 404, { error: 'no rendered video for this style yet' });
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(f).size, 'Cache-Control': 'no-store' });
    return fs.createReadStream(f).pipe(res);
  }
  return send(res, 404, { error: 'not found' });
}
async function qualityApi(req, res, url, p, method) {
  const inspector = getQualityInspector();
  const guard = getPublishingGuard();
  const correction = getCorrectionEngine();

  if (p === '/api/quality/status' && method === 'GET') {
    return send(res, 200, {
      ...inspector.modelManager.getSafeStatus(),
      config: {
        enabled: QUALITY_CONFIG.enabled,
        minScore: QUALITY_CONFIG.minScore,
        maxRetries: QUALITY_CONFIG.maxRetries,
        failClosed: QUALITY_CONFIG.failClosed,
      },
      weights: QUALITY_CONFIG.weights,
      thresholds: QUALITY_CONFIG.thresholds,
    });
  }

  if (p === '/api/quality/reports' && method === 'GET') {
    const projects = listProjects();
    const reports = [];
    for (const pr of projects) {
      const dir = projectDir(pr.id);
      const rep = inspector.reportGenerator.loadReport(path.join(dir, 'review'));
      const rendersDir = path.join(dir, 'renders');
      const hasRender = fs.existsSync(rendersDir) && fs.readdirSync(rendersDir).some((f) => f.endsWith('.mp4'));
      reports.push({
        projectId: pr.id,
        title: pr.title || pr.id,
        overallScore: rep ? rep.overallScore : null,
        status: rep ? rep.status : (hasRender ? 'NOT_INSPECTED' : 'NOT_RENDERED'),
        publishAllowed: rep ? rep.publishAllowed : false,
        inspectedAt: rep ? rep.inspectedAt : null,
        defectsCount: rep ? (rep.defects || []).length : 0,
        modelId: rep ? rep.modelId : null,
        reasons: rep ? (rep.reasons || []) : [],
        hasRender,
      });
    }
    return send(res, 200, reports);
  }

  let r;
  if ((r = p.match(/^\/api\/quality\/reports\/([\w-]+)$/)) && method === 'GET') {
    const dir = projectDir(r[1]);
    const rep = inspector.reportGenerator.loadReport(path.join(dir, 'review'));
    if (!rep) throw new HttpError(404, `No quality report found for project ${r[1]}`);
    return send(res, 200, rep);
  }

  if ((r = p.match(/^\/api\/quality\/inspect\/([\w-]+)$/)) && method === 'POST') {
    const dir = projectDir(r[1]);
    if (!fs.existsSync(dir)) throw new HttpError(404, `Project ${r[1]} not found`);
    const b = await readBody(req);
    const report = await inspector.inspectProject(dir, {
      useCache: b.force !== true,
      skipAI: b.skipAI === true,
    });
    return send(res, 200, report);
  }

  if ((r = p.match(/^\/api\/quality\/correct\/([\w-]+)$/)) && method === 'POST') {
    const dir = projectDir(r[1]);
    if (!fs.existsSync(dir)) throw new HttpError(404, `Project ${r[1]} not found`);
    const report = inspector.reportGenerator.loadReport(path.join(dir, 'review')) ||
      await inspector.inspectProject(dir);
    const plan = correction.generateCorrectionPlan(report, dir);
    if (!plan.canRetry) {
      return send(res, 400, { error: 'Maximum correction retries reached', plan });
    }
    const applied = await correction.applyCorrection(dir, plan);
    return send(res, 200, { applied, plan });
  }

  throw new HttpError(404, `unknown quality endpoint ${method} ${p}`);
}

