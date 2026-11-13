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
import { createProject, loadProject, updateProject, listProjects, addScriptVersion, getScriptVersion, approveScriptVersion, updateScriptMeta, projectDir } from './lib/projects.js';
import { reviewClaims, findTopicFacts, listFactFiles, claimsGate, confirmClaims, pendingClaims } from './lib/factcheck.js';
import { runScriptJob, runRenderJob, renderPlan, scriptPlan, inputFromConfig } from './lib/pipeline.js';
import { checkLanguage, estimateSeconds } from './lib/scriptgen.js';
import { generateImage, seedFor, readImageIndex, writeImageIndex, freeVram } from './lib/imagegen.js';
import { TRENDING_TOPICS } from './lib/trends.js';
import { createSetupRoutes } from './lib/setup/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// never die silently: log and keep serving (a crashed server would also orphan the running job)
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e && e.stack || e); try { fs.appendFileSync(path.join(PATHS.logs, 'server-errors.log'), `${new Date().toISOString()} ${e && e.stack || e}\n`); } catch {} });
process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e && e.stack || e); try { fs.appendFileSync(path.join(PATHS.logs, 'server-errors.log'), `${new Date().toISOString()} ${e && e.stack || e}\n`); } catch {} });
const PORT = +(process.env.PORT || STUDIO_CONFIG.port || 3000);
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
function submitScriptJob({ input, projectId, requestKey, facts }) {
  facts = typeof facts === 'string' && facts.trim() ? facts.trim().slice(0, 4000) : null;
  const v = validateGenerationConfig(input, { purpose: 'script' });
  if (!v.ok) throw new HttpError(422, 'Invalid selection', { errors: v.errors });
  let project = projectId ? loadProject(projectId) : null;
  // a project keeps one script fingerprint (topic + language + personality + duration); a different one → new project
  if (!project || project.script.versions.some((x) => x.fingerprint !== scriptFingerprint(v.config))) project = createProject({ topic: v.config.topic, config: v.config, configHash: configHash(v.config) });
  else updateProject(project.id, (p) => { p.config = v.config; p.configHash = configHash(v.config); });
  const dup = jobs.findActiveDuplicate({ requestKey, configHash: 'script:' + configHash(v.config), projectId: project.id });
  if (dup) return { job: dup, project, deduplicated: true, warnings: v.warnings };
  const job = jobs.submit({ kind: 'script', projectId: project.id, title: v.config.topic, config: v.config, plan: scriptPlan(), requestKey, configHash: 'script:' + configHash(v.config) },
    (j) => runScriptJob(j, { projectId: project.id, config: v.config, facts }));
  return { job, project, deduplicated: false, warnings: v.warnings };
}

function submitRenderJob({ input, projectId, scriptVersion, requestKey, acceptUnverifiedClaims = false }) {
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
  const job = jobs.submit({ kind: 'render', projectId: project.id, title: v.config.topic, config: v.config, plan: renderPlan({ approved: !!scriptVersion, hybrid: v.config.visual.visualMode === 'hybrid-local' }), requestKey, configHash: hash },
    (j) => runRenderJob(j, { projectId: project.id, config: v.config, scriptVersion: scriptVersion ? +scriptVersion : null, acceptUnverifiedClaims: acceptUnverifiedClaims === true }));
  return { job, project, deduplicated: false, warnings: v.warnings };
}

// ── router ──────────────────────────────────────────────────────────────────────────────────────────────────
async function api(req, res, url) {
  const p = url.pathname, m = (re) => p.match(re), method = req.method;
  if (p.startsWith('/api/setup/')) return setup.handle(req, res, url, { readBody, send });
  if (p === '/api/catalog') return send(res, 200, publicCatalog());
  if (p === '/api/system') return send(res, 200, systemInfo());
  if (p === '/api/trends') return send(res, 200, TRENDING_TOPICS);
  if (p === '/api/characters') return send(res, 200, getCatalog().characters);
  if (p === '/api/voices') return send(res, 200, getCatalog().voices);
  if (p === '/api/validate' && method === 'POST') { const b = await readBody(req); const v = validateGenerationConfig(b.input || b, { purpose: b.purpose || 'render', hasApprovedScript: !!b.scriptVersion }); return send(res, v.ok ? 200 : 422, v); }

  // projects
  if (p === '/api/projects' && method === 'GET') return send(res, 200, listProjects());
  if (p === '/api/projects' && method === 'POST') {   // a project with a hand-written script (no model needed)
    const b = await readBody(req); const v = validateGenerationConfig(b.input, { purpose: 'render', hasApprovedScript: true });
    if (!v.ok) throw new HttpError(422, 'Invalid selection', { errors: v.errors });
    const pr = createProject({ topic: v.config.topic, config: v.config, configHash: configHash(v.config) });
    return send(res, 201, { project: pr });
  }
  let r;
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
    let meta = updateScriptMeta(pr.id, saved.version, { claimReview: review, factFile: tf?.file || null, claimsApproved: review.summary.needsReview === 0 }).meta;
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
      const meta = updateScriptMeta(r[1], +r[2], { ...patch, ...(patch.claimsApproved ? { claimsApprovedBy: 'user (Script Studio)' } : {}) }).meta;
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
