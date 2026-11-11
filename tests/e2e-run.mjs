// End-to-end acceptance runner against a running studio server (real API, real models, real renders).
//   node tests/e2e-run.mjs cases [A B C UNSUPPORTED] [--source llm|fixture]   Part 9: settings integration tests
//   node tests/e2e-run.mjs progress                                            Part 10: progress acceptance test
// STUDIO_URL (default http://127.0.0.1:3100). Evidence (every SSE event with timestamps, checks, paths) is written to
// logs/tests/<run>.json. Exit code 0 only if every check passed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:3100';
const FFPROBE = path.join(ROOT, 'runtime', 'ffmpeg', 'bin', 'ffprobe.exe');
const args = process.argv.slice(2), mode = args[0], opt = (k, d) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : d; };
const SOURCE = opt('--source', 'llm');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const LEGACY = [/faceless-shorts/i, /\.cache[\\/]+huggingface/i];

async function api(p, body, method) {
  const r = await fetch(BASE + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  return { status: r.status, body: j };
}

/** follow a job over SSE; returns { final, events: [{ at, progress, stage, stageProgress, status, message }] } */
async function follow(jobId, { onEvent, signal } = {}) {
  const events = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const r = await fetch(`${BASE}/api/jobs/${jobId}/events`, { signal });
      const dec = new TextDecoder(); let buf = '', ev = null, final = null;
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const type = (block.match(/^event: (.*)$/m) || [])[1], data = (block.match(/^data: (.*)$/m) || [])[1];
          if (type === 'progress' && data) { const s = JSON.parse(data); ev = { at: now(), progress: s.progress, stage: s.currentStage, stageProgress: s.stageProgress, status: s.status, message: s.message }; events.push(ev); final = s; if (onEvent) await onEvent(s, events); }
          if (type === 'end') return { final, events };
        }
      }
      if (final && ['completed', 'failed', 'cancelled'].includes(final.status)) return { final, events };
    } catch (e) { if (signal && signal.aborted) throw e; }
    await sleep(1000);   // reconnect, like a refreshed browser
  }
  throw new Error('SSE never finished');
}

function ffprobe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status) return null;
  const j = JSON.parse(r.stdout), v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
  const [n, d] = v.r_frame_rate.split('/').map(Number);
  return { duration: +j.format.duration, width: v.width, height: v.height, fps: n / d, vcodec: v.codec_name, acodec: a?.codec_name };
}
const devaRatio = (s) => { const d = (s.match(/[ऀ-ॿ]/g) || []).length, l = (s.match(/[A-Za-z]/g) || []).length; return d / Math.max(1, d + l); };
function monotonic(events) { let last = -1; for (const e of events) { if (e.progress < last) return false; last = e.progress; } return true; }
/** live processes whose command line mentions `needle` (PowerShell CIM; throws if the query itself fails) */
function procsMatching(needle) {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle.replace(/'/g, "''")}*' -and $_.Name -ne 'powershell.exe' } | Select-Object -ExpandProperty ProcessId`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('process query failed: ' + r.stderr);
  return r.stdout.split(/\s+/).filter(Boolean).map(Number).filter((p) => p !== process.pid);
}
function presence(projectDir) {
  const r = spawnSync(process.execPath, ['tools/capture.mjs', 'presence'], { cwd: projectDir, encoding: 'utf8', env: { ...process.env, FFMPEG: path.join(ROOT, 'runtime', 'ffmpeg', 'bin', 'ffmpeg.exe') } });
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@RESULT '));
  return line ? JSON.parse(line.slice(9)).presence : null;
}
function maxJump(events) { let m = { delta: 0 }; for (let i = 1; i < events.length; i++) { const d = events[i].progress - events[i - 1].progress; if (d > m.delta) m = { delta: d, from: events[i - 1].stage, to: events[i].stage, at: events[i].t || events[i].at }; } return m; }
function grepLegacy(paths) {
  const hits = [];
  for (const p of paths) { if (!fs.existsSync(p)) continue; const t = fs.readFileSync(p, 'utf8'); for (const re of LEGACY) if (re.test(t)) hits.push(`${path.relative(ROOT, p)} ~ ${re}`); }
  return hits;
}

// ── test cases (Part 9) ──────────────────────────────────────────────────────────────────────────────────
const CASES = {
  A: { input: { topic: 'How ISRO Reached Mars for Less Than the Budget of the Movie Gravity', language: 'hi-conversational', personality: 'mumbai-conversational', voice: 'hm_omega', style: 'deep-dive', character: 'desi_hero', durationSeconds: 40, visualMode: 'procedural' } },
  B: { input: { topic: 'The Mystery of Roopkund, the Skeleton Lake of the Himalayas', language: 'en', personality: 'documentary', voice: 'bm_george', style: 'night-file', character: 'none', durationSeconds: 30, visualMode: 'procedural' } },
  C: { input: { topic: 'Why Do Indian Temples Have Bells?', language: 'hi-conversational', personality: 'educational', voice: 'hf_alpha', style: 'tall-tale', character: 'curious_student', durationSeconds: 45, visualMode: 'procedural' } },
  UNSUPPORTED: [
    { name: 'Hindi narration with an English voice', input: { topic: 'Test topic', language: 'hi-conversational', personality: 'documentary', voice: 'am_michael', style: 'deep-dive', character: 'none', durationSeconds: 30, visualMode: 'procedural' }, field: 'voice' },
    { name: 'Mumbai personality with English', input: { topic: 'Test topic', language: 'en', personality: 'mumbai-conversational', voice: 'am_michael', style: 'deep-dive', character: 'none', durationSeconds: 30, visualMode: 'procedural' }, field: 'personality' },
    { name: 'English narration with a Hindi voice', input: { topic: 'Test topic', language: 'en', personality: 'documentary', voice: 'hf_beta', style: 'deep-dive', character: 'none', durationSeconds: 30, visualMode: 'procedural' }, field: 'voice' },
    { name: 'unknown visual style', input: { topic: 'Test topic', language: 'en', personality: 'documentary', voice: 'am_michael', style: 'anime', character: 'none', durationSeconds: 30, visualMode: 'procedural' }, field: 'style' },
  ],
};
if (process.env.HYBRID === '1') for (const k of ['A', 'B', 'C']) CASES[k].input.visualMode = 'hybrid-local';

async function getScript(name, input, report) {
  if (SOURCE === 'fixture') {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', `test-${name.toLowerCase()}.json`), 'utf8'));
    const p = await api('/api/projects', { input }); if (p.status !== 201) throw new Error(JSON.stringify(p.body));
    const s = await api(`/api/projects/${p.body.project.id}/scripts`, { ...fx, approve: true, approveClaims: true }); if (s.status !== 201) throw new Error(JSON.stringify(s.body));
    report.script = { source: 'fixture (hand-written, approved)', version: s.body.version, estimate: s.body.estimate };
    return { projectId: p.body.project.id, version: s.body.version };
  }
  const pv = await api('/api/scripts/preview', { input, requestKey: `e2e-${name}-preview-${Date.now()}` });
  if (pv.status !== 202) throw new Error(`preview refused: ${JSON.stringify(pv.body)}`);
  const { final, events } = await follow(pv.body.jobId);
  report.scriptJob = { jobId: pv.body.jobId, status: final.status, error: final.error, events: events.length, monotonic: monotonic(events), elapsedSeconds: final.elapsedSeconds };
  if (final.status !== 'completed') throw new Error(`script generation ${final.status}: ${final.error}`);
  const ap = await api(`/api/projects/${pv.body.projectId}/scripts/${final.result.version}/approve`, {});
  if (ap.status !== 200) throw new Error(JSON.stringify(ap.body));
  report.script = { source: 'local LLM preview, then approved', version: final.result.version, estimate: final.result.estimate, model: final.result.meta?.model, attempts: final.result.meta?.attempts };
  // fact check: the review must exist; a render must be refused while claims are pending; the harness then plays the
  // reviewer and confirms the flagged claims (listed in the evidence for a human check). Known errors are never confirmed.
  const pid = pv.body.projectId, ver = final.result.version;
  const cl = (await api(`/api/projects/${pid}/scripts/${ver}/claims`)).body;
  report.factCheck = { factFile: cl.factFile, summary: cl.review?.summary, flagged: (cl.review?.claims || []).filter((c) => c.status !== 'supported').map((c) => ({ id: c.id, line: c.line, status: c.status, kind: c.kind, value: c.value, text: c.text })) };
  report.checks.fact_review_present = !!cl.review;
  report.checks.no_known_errors = !!cl.review && cl.review.summary.contradicted === 0;
  report.checks.no_legend_or_theory_as_fact = !!cl.review && cl.review.summary.needsAttribution === 0;
  // with a topic fact file, every year/number (narration and on-screen) must come from it — the harness may confirm
  // names and quantities as a reviewer would, but an invented number is a factual failure, not something to confirm
  report.checks.numbers_from_verified_facts = !cl.factFile || (cl.review?.claims || []).filter((c) => (c.kind === 'year' || c.kind === 'number') && c.status !== 'supported').length === 0;
  if (cl.pending.length) {
    const blocked = await api('/api/jobs', { input, projectId: pid, scriptVersion: ver, requestKey: `e2e-${name}-blocked-${Date.now()}` });
    report.checks.render_blocked_until_claims_reviewed = blocked.status === 409 && blocked.body.factCheck === true;
    if (cl.review.summary.contradicted === 0) {
      const ok = await api(`/api/projects/${pid}/scripts/${ver}/claims`, { confirm: cl.pending.map((c) => c.id) });
      report.factCheck.confirmedByHarness = ok.body.confirmedClaims;
      if (!ok.body.claimsApproved) throw new Error('claims could not be approved: ' + JSON.stringify(ok.body));
    }
  } else report.checks.render_blocked_until_claims_reviewed = true;   // nothing to review
  return { projectId: pid, version: ver };
}

async function runCase(name) {
  const input = CASES[name].input, report = { case: name, input, startedAt: now(), checks: {} }, C = report.checks;
  try {
    const { projectId, version } = await getScript(name, input, report);
    const sv = (await api(`/api/projects/${projectId}/scripts/${version}`)).body;
    const text = sv.lines.map((l) => l.text).join(' ');
    report.scriptSample = sv.lines.slice(0, 3).map((l) => l.text);
    C.script_language = input.language.startsWith('hi-') ? devaRatio(text) > 0.9 : devaRatio(text) === 0;
    const sub = await api('/api/jobs', { input, projectId, scriptVersion: version, requestKey: `e2e-${name}-render-${Date.now()}` });
    if (sub.status !== 202) throw new Error(`render refused: ${JSON.stringify(sub.body)}`);
    report.jobId = sub.body.jobId; report.projectId = projectId;
    const { final, events } = await follow(sub.body.jobId);
    report.events = events; report.status = final.status; report.error = final.error; report.warnings = final.warnings;
    report.stages = final.stages.map((s) => ({ id: s.id, name: s.name, status: s.status, seconds: s.startedAt && s.endedAt ? +((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000).toFixed(1) : null, message: s.message }));
    C.job_completed = final.status === 'completed';
    C.progress_monotonic = monotonic(events);
    C.hundred_only_at_completion = events.filter((e) => e.progress === 100).every((e) => e.status === 'completed') && final.progress === 100;
    const P = path.join(ROOT, 'projects', projectId), pj = JSON.parse(fs.readFileSync(path.join(P, 'project.json'), 'utf8'));
    C.config_reached_backend = pj.config.language.id === input.language && pj.config.narration.personality === input.personality && pj.config.narration.voice === input.voice && pj.config.visual.style === input.style && pj.config.visual.character === input.character && pj.config.durationSeconds === input.durationSeconds;
    const lines = JSON.parse(fs.readFileSync(path.join(P, 'audio', 'lines.json'), 'utf8'));
    report.narration = { voice: lines.voice, lang: lines.lang, speed: lines.speed, duration: lines.duration };
    C.voice_used = lines.voice === input.voice && lines.lang === pj.config.narration.ttsLang;
    const personality = (await api('/api/catalog')).body.personalities.find((p) => p.id === input.personality);
    C.personality_delivery_applied = Math.abs(lines.speed - personality.delivery.speed) <= 0.19 && (JSON.parse(fs.readFileSync(path.join(P, 'script.json'), 'utf8')).gap === personality.delivery.gap);
    report.alignment = pj.alignment;
    C.spoken_language_verified = input.language.startsWith('hi-') ? pj.alignment?.detectedLanguage === 'hi' : true;
    const scene = JSON.parse(fs.readFileSync(path.join(P, 'scenes', 'scene.json'), 'utf8'));
    C.style_applied = scene.style.id === input.style && fs.existsSync(path.join(P, 'vendor')) === (scene.style.renderer === 'webgl');
    C.character_respected = input.character === 'none' ? scene.character.mode === 'none' && scene.shots.every((s) => !s.cast.some((c) => c.role === 'lead')) : scene.character.id === input.character && scene.shots.some((s) => s.cast.some((c) => c.role === 'lead'));
    report.storyboard = scene.shots.map((s) => ({ id: s.id, method: s.method, env: s.environment, objects: s.objects, cast: s.cast.map((c) => `${c.role}:${c.action}`), overlay: s.overlay?.type || null }));
    if (input.character !== 'none') { const pr = presence(P); report.presence = pr; C.character_visible_in_pixels = !!pr && pr.length > 0 && pr.every((x) => x.minChanged >= 0.01); }
    if (input.visualMode === 'hybrid-local') {
      const idx = JSON.parse(fs.readFileSync(path.join(P, 'generated-images', 'index.json'), 'utf8')), need = scene.shots.filter((s) => s.method === 'image' || s.method === 'hybrid');
      report.images = idx;
      C.images_generated = final.stages.find((s) => s.id === 'images').status === 'done' && need.length > 0 && need.every((s) => { const own = idx.shots[s.id] || idx.shots[s.imageReuse]; const file = own && path.join(P, own.file); return !!s.image && !!file && fs.existsSync(file) && fs.statSync(file).size > 20000; });   // reused images (imageReuse) count as present
    }
    const onScreen = sv.lines.map((l) => l.onScreen || '').join(' | ') + ' ' + text;
    C.overlays_match_script = scene.shots.every((s) => !s.overlay || (s.overlay.type === 'comparison' ? s.overlay.items.every((it) => onScreen.includes(it.display)) : s.overlay.type === 'number' ? onScreen.includes(s.overlay.value) : s.overlay.type === 'date' ? onScreen.includes(s.overlay.text) : true));
    C.ending_not_generic = !['office', 'studio'].includes(scene.shots[scene.shots.length - 1].environment);
    report.maxProgressJump = maxJump(events);
    const exp = final.result && path.join(ROOT, final.result.exportPath);
    const probe = exp && fs.existsSync(exp) ? ffprobe(exp) : null;
    report.output = { exportPath: final.result?.exportPath, absolute: exp, probe };
    C.ffprobe_valid = !!probe && probe.width === 1080 && probe.height === 1920 && Math.abs(probe.fps - 30) < 0.05 && probe.vcodec === 'h264' && probe.acodec === 'aac';
    C.duration_within_tolerance = !!probe && Math.abs(probe.duration - input.durationSeconds) <= 0.1 * input.durationSeconds;
    C.output_in_workspace_exports = !!exp && path.dirname(exp) === path.join(ROOT, 'exports');
    C.no_legacy_paths = grepLegacy([path.join(P, 'project.json'), path.join(ROOT, 'logs', 'jobs', `${sub.body.jobId}.json`), path.join(ROOT, 'logs', 'jobs', `${sub.body.jobId}.log`), path.join(P, 'scenes', 'scene.json')]).length === 0;
  } catch (e) { report.error = String(e.message || e); C.ran = false; }
  report.finishedAt = now(); report.passed = Object.values(C).length > 0 && Object.values(C).every(Boolean);
  return report;
}

async function runUnsupported() {
  const out = [];
  for (const u of CASES.UNSUPPORTED) {
    const v = await api('/api/validate', { input: u.input, purpose: 'render', scriptVersion: 1 });
    const r = await api('/api/jobs', { input: u.input, requestKey: `e2e-unsupported-${Date.now()}` });
    const err = (r.body.errors || []).find((e) => e.field === u.field);
    out.push({ name: u.name, validateStatus: v.status, renderStatus: r.status, error: err?.message, alternatives: err?.alternatives, passed: v.status === 422 && r.status === 422 && !!err && !r.body.jobId });
  }
  return out;
}

// ── progress acceptance (Part 10) ────────────────────────────────────────────────────────────────────────────
async function progressAcceptance() {
  const R = { startedAt: now(), checks: {} }, C = R.checks;
  const input = { ...CASES.B.input, topic: 'Progress acceptance: The Mystery of Roopkund Lake', durationSeconds: 30 };
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'test-b.json'), 'utf8'));
  const mk = async (inp, script) => { const p = await api('/api/projects', { input: inp }); await api(`/api/projects/${p.body.project.id}/scripts`, { ...script, approve: true, approveClaims: true }); return p.body.project.id; };
  // 1 · real job with duplicate click + refresh + full event capture
  const pid = await mk(input, fx), key = `progress-acceptance-${Date.now()}`;
  const first = await api('/api/jobs', { input, projectId: pid, scriptVersion: 1, requestKey: key });
  const dup = await api('/api/jobs', { input, projectId: pid, scriptVersion: 1, requestKey: key });
  R.jobId = first.body.jobId;
  C.job_created = first.status === 202 && !!first.body.jobId;
  C.duplicate_click_same_job = dup.body.jobId === first.body.jobId && dup.body.deduplicated === true;
  const allJobIds = [first.body.jobId];
  // a second, different job submitted back-to-back must queue behind the first (never run concurrently / overwrite)
  const cancelInput = { ...input, topic: 'Progress acceptance: cancellation run' };
  const pid2 = await mk(cancelInput, fx);
  const j2 = await api('/api/jobs', { input: cancelInput, projectId: pid2, scriptVersion: 1, requestKey: `cancel-${Date.now()}` });
  allJobIds.push(j2.body.jobId);
  await sleep(600);
  const j2snap = (await api(`/api/jobs/${j2.body.jobId}`)).body;
  R.queued = { jobId: j2.body.jobId, status: j2snap.status, message: j2snap.message };
  C.second_job_queued_not_concurrent = j2.body.jobId !== first.body.jobId && j2snap.status === 'queued' && j2snap.message.includes(first.body.jobId);
  let refreshed = null;
  const { final, events } = await follow(first.body.jobId, {
    onEvent: async (s) => {
      if (!refreshed && s.currentStage === 'capture' && s.stageProgress > 20) {
        // simulate a browser refresh: brand-new connection + the endpoint the dashboard uses to re-attach
        const active = (await api('/api/jobs/active')).body.map((j) => j.jobId);
        const snap = (await api(`/api/jobs/${first.body.jobId}`)).body;
        const ctl = new AbortController(); let second = null;
        try { await follow(first.body.jobId, { signal: ctl.signal, onEvent: (x) => { second = x; ctl.abort(); } }); } catch {}
        refreshed = { at: now(), activeContainsJob: active.includes(first.body.jobId), snapshotProgress: snap.progress, secondStreamProgress: second?.progress, seenProgress: s.progress, stage: snap.currentStage };
      }
    },
  });
  R.events = events; R.final = { status: final.status, progress: final.progress, result: final.result, error: final.error };
  R.stageTimeline = final.stages.map((s) => ({ id: s.id, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, message: s.message }));
  const rec = (await api(`/api/jobs/${first.body.jobId}/record`)).body;
  R.recordedEvents = rec.events;
  C.progress_monotonic = monotonic(events) && monotonic(rec.events);
  const order = final.stages.filter((s) => s.status === 'done').map((s) => s.id);
  C.stages_in_order = JSON.stringify(order) === JSON.stringify(final.stages.filter((s) => s.status === 'done').sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).map((s) => s.id));
  for (const st of ['validate', 'script', 'tts', 'align', 'storyboard', 'scene', 'capture', 'compose', 'qa']) C[`stage_${st}_completed`] = final.stages.find((s) => s.id === st)?.status === 'done';
  C.frame_counters_reported = rec.events.some((e) => /Capturing frame \d+ of \d+/.test(e.message));
  C.encoding_mux_reported = rec.events.some((e) => e.stage === 'compose');
  C.no_unjustified_jump = (() => { for (let i = 1; i < rec.events.length; i++) { const a = rec.events[i - 1], b = rec.events[i]; if (b.progress - a.progress > 20 && a.stage === b.stage) return false; } return true; })();
  R.maxProgressJump = maxJump(rec.events);   // largest single step (stage completions of stages without internal progress)
  C.per_job_logs_isolated = (() => { try { const l = fs.readFileSync(path.join(ROOT, 'logs', 'jobs', `${first.body.jobId}.log`), 'utf8'); return l.includes(pid) && !l.includes(pid2); } catch { return false; } })();
  C.refresh_preserves_progress = !!refreshed && refreshed.activeContainsJob && refreshed.snapshotProgress >= refreshed.seenProgress && refreshed.secondStreamProgress >= refreshed.seenProgress;
  R.refresh = refreshed;
  C.hundred_only_after_verified_output = final.status === 'completed' && final.progress === 100 && rec.events.filter((e) => e.progress === 100).every((e) => e.status === 'completed') && !!final.result && fs.existsSync(path.join(ROOT, final.result.exportPath)) && final.stages.find((s) => s.id === 'qa').status === 'done';
  // 2 · the queued job now runs; cancel it DURING FRAME CAPTURE (Node → headless Chrome → GPU process tree) and verify
  //     that no process mentioning its project survives
  let cancelledAt = null, procsWhileRunning = null;
  const c2 = await follow(j2.body.jobId, { onEvent: async (s) => {
    if (!cancelledAt && s.currentStage === 'capture' && (s.stageProgress || 0) > 5) {
      procsWhileRunning = procsMatching(pid2).length;
      cancelledAt = { at: now(), progress: s.progress, stage: s.currentStage };
      await api(`/api/jobs/${j2.body.jobId}/cancel`, {});
    }
  } });
  await sleep(2500);
  const survivors = procsMatching(pid2);   // throws if the process query itself fails, so this can't pass vacuously
  R.cancel = { jobId: j2.body.jobId, cancelledAt, processesBeforeCancel: procsWhileRunning, survivors, final: { status: c2.final.status, progress: c2.final.progress, message: c2.final.message } };
  C.cancellation_during_capture_works = c2.final.status === 'cancelled' && c2.final.progress < 100 && procsWhileRunning > 0 && survivors.length === 0;
  // 3 · a failing job stops with the real error and never shows 100 (script far too long for a 20 s target)
  const longInput = { ...input, topic: 'Progress acceptance: failure run', durationSeconds: 20 };
  const pid3 = await mk(longInput, fx);
  const j3 = await api('/api/jobs', { input: longInput, projectId: pid3, scriptVersion: 1, requestKey: `fail-${Date.now()}` });
  allJobIds.push(j3.body.jobId);
  const c3 = await follow(j3.body.jobId);
  R.failure = { jobId: j3.body.jobId, status: c3.final.status, failedStage: c3.final.failedStage, error: c3.final.error, progress: c3.final.progress };
  C.error_stops_job = c3.final.status === 'failed' && c3.final.failedStage === 'tts' && c3.final.progress < 100 && !c3.events.some((e) => e.progress === 100);
  // 4 · retry of the failed job creates a new job (same project), the failure stays in history
  const rt = await api(`/api/jobs/${j3.body.jobId}/retry`, {});
  R.retry = { ...rt.body };
  if (rt.body.jobId) {
    allJobIds.push(rt.body.jobId);
    let seen = null; for (let i = 0; i < 40 && !seen; i++) { const s = (await api(`/api/jobs/${rt.body.jobId}`)).body; if (['running', 'failed', 'completed'].includes(s.status)) seen = s; else await sleep(500); }
    R.retry.reached = seen && { status: seen.status, stage: seen.currentStage, progress: seen.progress };
    await api(`/api/jobs/${rt.body.jobId}/cancel`, {});
  }
  const original = (await api('/api/jobs?limit=200')).body.find((j) => j.jobId === j3.body.jobId);
  C.retry_runs_and_history_kept = rt.status === 202 && rt.body.retryOf === j3.body.jobId && rt.body.jobId !== j3.body.jobId && !!R.retry.reached && original?.status === 'failed';
  C.unique_job_ids = new Set(allJobIds).size === allJobIds.length;
  R.jobIds = allJobIds;
  R.finishedAt = now(); R.passed = Object.values(C).every(Boolean);
  return R;
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────────────────
fs.mkdirSync(path.join(ROOT, 'logs', 'tests'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let out, ok = true;
if (mode === 'cases') {
  const which = args.slice(1).filter((a) => !a.startsWith('--') && a !== SOURCE);
  const list = which.length ? which : ['UNSUPPORTED', 'A', 'B', 'C'];
  out = { kind: 'settings-integration', source: SOURCE, base: BASE, results: [] };
  for (const name of list) {
    console.log(`\n=== ${name} ===`);
    const r = name === 'UNSUPPORTED' ? { case: 'UNSUPPORTED', results: await runUnsupported() } : await runCase(name);
    if (name === 'UNSUPPORTED') { r.passed = r.results.every((x) => x.passed); for (const x of r.results) console.log(`${x.passed ? 'PASS' : 'FAIL'}  ${x.name}: HTTP ${x.renderStatus} · ${x.error}`); }
    else { for (const [k, v] of Object.entries(r.checks)) console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`); if (r.error) console.log('ERROR', r.error); console.log(r.output?.exportPath || '', r.output?.probe ? `${r.output.probe.duration.toFixed(2)} s` : ''); }
    out.results.push(r); ok = ok && r.passed;
  }
} else if (mode === 'progress') {
  out = { kind: 'progress-acceptance', base: BASE, ...(await progressAcceptance()) };
  for (const [k, v] of Object.entries(out.checks)) console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);
  ok = out.passed;
} else { console.log('usage: node tests/e2e-run.mjs cases [A B C UNSUPPORTED] [--source llm|fixture] | progress'); process.exit(2); }
const file = path.join(ROOT, 'logs', 'tests', `${mode}-${stamp}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`\n${ok ? 'ALL PASSED' : 'SOME CHECKS FAILED'} · evidence: ${path.relative(ROOT, file)}`);
process.exit(ok ? 0 : 1);
