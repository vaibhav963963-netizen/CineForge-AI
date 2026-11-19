// CineForge automation — production executor: drives the existing studio over its local API, one stage at a time.
// Each stage returns { fields, data }: fields are saved on the run, data in the stage checkpoint.
//   topic → script (generate + gates) → render (the SAVED script version: never regenerated) → qa (ffprobe + sha256)
//   → metadata → upload → publish → record
// Upload/publish use automation/youtube.mjs (P3). Until YouTube is authorised, use publishMode "manual".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from './db.mjs';
import { CONFIG } from '../dashboard/lib/config.js';

const fail = (msg, failureClass) => Object.assign(new Error(msg), failureClass ? { failureClass } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── studio client ─────────────────────────────────────────────────────────────────────────────────────────────────
export function studioClient(base) {
  const api = async (p, opts = {}) => {
    let r;
    try { r = await fetch(base + p, { ...opts, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(opts.timeout || 30000) }); }
    catch (e) { throw fail(`studio server not reachable at ${base} (${e.cause?.code || e.message})`, 'studio_unavailable'); }
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok) throw fail(`studio ${r.status} ${p}: ${(j?.error?.message || j?.message || t).toString().slice(0, 300)}`);
    return j;
  };
  return {
    api,
    async healthy() { try { await api('/api/catalog', { timeout: 5000 }); return true; } catch { return false; } },
    /** start the studio server if it is down (detached, survives the scheduler) and wait until it answers */
    async ensure(log = () => {}) {
      if (await this.healthy()) return;
      const port = new URL(base).port || String(CONFIG.PORT);
      log(`Studio not running — starting it on port ${port}`);
      const out = fs.openSync(path.join(ROOT, 'logs', 'server.out'), 'a');
      spawn(process.execPath, [path.join(ROOT, 'dashboard', 'server.js')], { cwd: ROOT, env: { ...process.env, PORT: port }, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
      for (let k = 0; k < 60; k++) { await sleep(2000); if (await this.healthy()) return; }
      throw fail(`studio server did not start on port ${port} within 2 minutes`, 'studio_unavailable');
    },
    /** poll a studio job to a terminal state; studio stage failures keep their message for classification */
    async waitJob(jobId, { log = () => {}, timeoutMin = 120 } = {}) {
      const end = Date.now() + timeoutMin * 60000; let last = '';
      while (Date.now() < end) {
        const j = await api(`/api/jobs/${jobId}`);
        const line = `${j.status} ${j.progress ?? ''}% ${j.currentStageName || ''}`;
        if (line !== last) { log(`studio job ${jobId}: ${line}`); last = line; }
        if (j.status === 'completed') return j;
        if (j.status === 'failed') throw fail(`Failed during ${j.failedStageName || j.currentStageName || 'studio job'}: ${j.error?.message || j.error || j.message}`);
        if (j.status === 'cancelled') throw fail('studio job cancelled', 'cancelled');
        await sleep(5000);
      }
      throw fail(`studio job ${jobId} did not finish within ${timeoutMin} min`, 'render');
    },
  };
}

// ── ffprobe (independent final QA) ────────────────────────────────────────────────────────────────────────────────
function ffprobe(file) {
  const exe = [path.join(ROOT, 'runtime', 'ffmpeg', 'bin', 'ffprobe.exe'), 'ffprobe'].find((p) => p === 'ffprobe' || fs.existsSync(p));
  const r = spawnSync(exe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw fail(`ffprobe failed on ${file}: ${(r.stderr || r.error?.message || '').slice(0, 200)}`, 'render');
  return JSON.parse(r.stdout);
}
const sha256 = (file) => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

// ── executor ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function createExecutor({ db, settings, youtube = null }) {
  const studio = () => studioClient(settings().studio.url);
  const input = (s, topic) => ({ topic, language: s.studio.language, personality: s.studio.personality, voice: s.studio.voice, style: s.studio.style, character: s.studio.character, durationSeconds: s.studio.durationSeconds, visualMode: s.studio.visualMode });
  const yt = async () => youtube || (await import('./youtube.mjs').catch(() => null));

  return {
    // topic: the user's queue first, else the trends list; a topic already produced is never repeated
    async topic(run, { settings: s, log }) {
      const used = new Set(db.prepare('SELECT LOWER(topic) AS t FROM runs WHERE topic IS NOT NULL AND id != ?').all(run.id).map((r) => r.t));
      let pool = s.topicQueue || [];
      if (s.topicSource === 'trends' || !pool.length) {
        const c = studio(); await c.ensure(log);
        const trends = await c.api('/api/trends');
        pool = [...pool, ...trends.map((t) => (typeof t === 'string' ? t : t.topic || t.title)).filter(Boolean)];
      }
      const topic = pool.find((t) => !used.has(String(t).toLowerCase()));
      if (!topic) throw fail('research failure: no unused topic left — add topics to the automation topic queue', 'research');
      if (s.topicQueue?.includes(topic)) db.prepare("INSERT INTO settings (key, value) VALUES ('topicQueue', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(s.topicQueue.filter((t) => t !== topic)));
      log(`Topic: ${topic}`);
      return { fields: { topic }, data: { topic, source: s.topicQueue?.includes(topic) ? 'queue' : 'trends' } };
    },

    // script: generate in the studio (research, plan, write, validate); unattended gate policy
    async script(run, { settings: s, log }) {
      const c = studio(); await c.ensure(log);
      const sub = await c.api('/api/scripts/preview', { method: 'POST', body: JSON.stringify({ input: input(s, run.topic), requestKey: `auto-${run.id}-script-${run.attempt}` }) });
      const jobId = sub.jobId || sub.job?.id, projectId = sub.projectId || sub.project?.id;
      updateStudio(db, run.id, jobId);
      const j = await c.waitJob(jobId, { log, timeoutMin: 45 });
      const version = j.result?.version;
      const sv = await c.api(`/api/projects/${projectId}/scripts/${version}`);
      const status = sv.meta?.status || 'NEEDS_REVIEW';
      const failed = Object.entries(sv.meta?.gates || {}).filter(([, g]) => !g.ok).map(([k, g]) => `${k}: ${(g.issues || [])[0] || ''}`);
      if (status === 'FAILED') throw fail(`script validation: v${version} FAILED (${failed.join('; ').slice(0, 300)})`, 'script_validation');
      if (status !== 'READY' && s.scriptGate !== 'allow-needs-review') throw fail(`script validation: v${version} needs review (${failed.join('; ').slice(0, 300)})`, 'script_validation');
      // the gates passed (or the user allowed NEEDS_REVIEW): confirm remaining claims as automation, approve the version
      const gate = await c.api(`/api/projects/${projectId}/scripts/${version}/claims`);
      if (gate.gate?.contradicted?.length) throw fail(`script validation: v${version} repeats a known factual error`, 'script_validation');
      if (!gate.gate?.ok) await c.api(`/api/projects/${projectId}/scripts/${version}/claims`, { method: 'POST', body: JSON.stringify({ confirm: 'all', by: 'automation' }) });
      await c.api(`/api/projects/${projectId}/scripts/${version}/approve`, { method: 'POST', body: '{}' });
      log(`Script v${version} ${status} — approved for render`);
      return { fields: { project_id: projectId, script_version: version }, data: { projectId, version, status, title: sv.title, gates: Object.fromEntries(Object.entries(sv.meta?.gates || {}).map(([k, g]) => [k, g.ok])) } };
    },

    // render: the SAVED script version (no regeneration); studio stage failures are classified by message
    async render(run, { settings: s, log }) {
      if (!run.project_id || !run.script_version) throw fail('render: no approved script version on this run', 'script_validation');
      const c = studio(); await c.ensure(log);
      const sub = await c.api('/api/jobs', { method: 'POST', body: JSON.stringify({ input: input(s, run.topic), projectId: run.project_id, scriptVersion: run.script_version, requestKey: `auto-${run.id}-render-${run.attempt}` }) });
      const jobId = sub.jobId || sub.job?.id;
      updateStudio(db, run.id, jobId);
      const j = await c.waitJob(jobId, { log, timeoutMin: 120 });
      const p = j.result?.exportAbsolutePath || (j.result?.exportPath && path.join(ROOT, j.result.exportPath));
      if (!p) throw fail('render finished without an export path', 'render');
      return { fields: { video_path: p }, data: { jobId, exportPath: j.result.exportPath, durationSeconds: j.result.durationSeconds, qa: j.result.qa?.status || null } };
    },

    // qa: independent of the studio — the file exists, has video + audio, the duration is within tolerance
    async qa(run, { settings: s }) {
      if (!run.video_path || !fs.existsSync(run.video_path)) throw fail(`final QA: video file missing (${run.video_path})`, 'render');
      const info = ffprobe(run.video_path), dur = +info.format?.duration;
      const v = info.streams?.find((x) => x.codec_type === 'video'), a = info.streams?.find((x) => x.codec_type === 'audio');
      if (!v || !a) throw fail('final QA: the video must have a video and an audio stream', 'render');
      const T = s.studio.durationSeconds;
      if (!(dur > 5) || Math.abs(dur - T) > T * 0.2) throw fail(`final QA: duration ${dur?.toFixed?.(1)} s is not within 20 % of ${T} s`, 'render');
      const hash = await sha256(run.video_path);
      return { fields: { video_sha: hash }, data: { durationSeconds: +dur.toFixed(2), video: `${v.codec_name} ${v.width}x${v.height}`, audio: a.codec_name, sha256: hash } };
    },

    // metadata: from the saved script (title, description, tags) + AI-content disclosure
    async metadata(run, { settings: s }) {
      const c = studio(); await c.ensure();
      const sv = await c.api(`/api/projects/${run.project_id}/scripts/${run.script_version}`);
      const title = String(sv.title || run.topic).replace(/\s+/g, ' ').trim().slice(0, 95);
      const body = sv.lines.map((l) => l.text).slice(0, 3).join(' ');
      const tags = [...new Set(String(run.topic).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3))].slice(0, 10);
      const meta = { title: `${title} #Shorts`.slice(0, 100), description: `${body}\n\n#Shorts\n\nMade with CineForge AI (narration and visuals are AI-generated).`.slice(0, 4900), tags, categoryId: '27', defaultLanguage: s.studio.language.startsWith('hi') ? 'hi' : 'en', madeForKids: false, containsSyntheticMedia: true };
      return { data: meta };
    },

    async upload(run, ctx) {
      const y = await yt();
      if (!y?.upload) throw fail('YouTube publishing is not set up yet (authorization required) — use publish mode "manual" until it is', 'youtube_auth');
      return y.upload(run, { ...ctx, db });
    },
    async publish(run, ctx) {
      const y = await yt();
      if (!y?.confirmPublished) throw fail('YouTube publishing is not set up yet (authorization required)', 'youtube_auth');
      return y.confirmPublished(run, { ...ctx, db });
    },
    async record(run) {
      return { data: { topic: run.topic, project: run.project_id, script: run.script_version, video: run.video_path, sha256: run.video_sha, youtube: run.youtube_url, publishedAt: new Date().toISOString() } };
    },

    // emergency stop: cancel the studio job this run is waiting on
    async cancel(run) {
      if (!run.studio_job_id) return;
      try { await studio().api(`/api/jobs/${run.studio_job_id}/cancel`, { method: 'POST', body: '{}' }); } catch {}
    },
  };
}
function updateStudio(db, runId, jobId) { db.prepare('UPDATE runs SET studio_job_id = ? WHERE id = ?').run(jobId, runId); }
