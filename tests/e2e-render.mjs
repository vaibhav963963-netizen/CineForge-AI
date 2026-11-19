// End-to-end: one short through the real studio API (script → TTS → alignment → images → scene → capture → FFmpeg),
// then verify the exported MP4, its library entry, and the permanent Delete. No upload, no automation.
//   node tests/e2e-render.mjs            (studio server must be running on PORT, default 3000)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;
const api = async (p, opts = {}) => { const r = await fetch(BASE + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { startedAt: new Date().toISOString(), steps: [] };
const step = (name, ok, detail) => { report.steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); };

// E2E_LANG=en|hinglish|hi-conversational, E2E_TOPIC="…" (defaults: Hinglish octopus, 30 s)
const LANG = process.env.E2E_LANG || 'hinglish', VOICE = { en: 'af_heart', hinglish: 'hm_omega', 'hi-conversational': 'hf_alpha' };
const input = { topic: process.env.E2E_TOPIC || 'Why do octopuses have three hearts?', language: LANG, personality: LANG === 'hinglish' ? 'documentary' : 'educational', voice: VOICE[LANG], style: 'tall-tale', character: 'curious_student', durationSeconds: +(process.env.E2E_SECONDS || 30), visualMode: 'hybrid-local' };
const t0 = Date.now();
const sub = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ input, requestKey: `e2e-${Date.now()}`, acceptUnverifiedClaims: true }) });
step('submit one-click render job', sub.status === 202, { status: sub.status, jobId: sub.body.jobId, projectId: sub.body.projectId, warnings: sub.body.warnings });
if (sub.status !== 202) { fs.writeFileSync('logs/tests/e2e-render-failed.json', JSON.stringify({ report, sub }, null, 2)); process.exit(1); }
const { jobId, projectId } = sub.body;

let job, last = '';
for (;;) {
  await sleep(5000);
  job = (await api(`/api/jobs/${jobId}`)).body;
  const line = `${job.status} ${job.progress}% ${job.stage || ''} ${String(job.message || '').slice(0, 90)}`;
  if (line !== last) { console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${line}`); last = line; }
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) break;
}
const secs = Math.round((Date.now() - t0) / 1000);
step('render job completed', job.status === 'completed', { status: job.status, seconds: secs, error: job.error || null });
report.job = { status: job.status, seconds: secs, error: job.error || null, stages: (job.stages || []).map((s) => ({ id: s.id, status: s.status, seconds: s.startedAt && s.endedAt ? Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000) : null })) };
for (const s of report.job.stages) console.log(`    stage ${s.id.padEnd(14)} ${String(s.status).padEnd(10)} ${s.seconds ?? '-'} s`);

const pr = (await api(`/api/projects/${projectId}`)).body;
// the project lists version numbers; the full version (lines + meta + gates) is served separately
const vNo = pr.script?.approvedVersion || pr.script?.versions?.at(-1)?.version;
const sv = vNo ? (await api(`/api/projects/${projectId}/scripts/${vNo}`)).body : null;
report.versions = (pr.script?.versions || []).map((x) => ({ version: x.version, source: x.source || x.meta?.source || null }));
report.script = { version: sv?.version, status: sv?.meta?.status, lines: sv?.script?.lines?.map((l) => ({ say: l.say, text: l.text, visual: l.visual })), gates: Object.fromEntries(Object.entries(sv?.meta?.gates || {}).map(([k, v]) => [k, v.ok])) };
step('script saved with gates', !!sv?.meta?.gates, report.script.gates);

if (job.status === 'completed') {
  const mp4 = path.join('exports', `${projectId}.mp4`);
  const exists = fs.existsSync(mp4);
  step('exported MP4 exists', exists, mp4);
  if (exists) {
    const probe = JSON.parse(execFileSync('runtime/ffmpeg/bin/ffprobe.exe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate', '-of', 'json', mp4]).toString());
    const v = probe.streams.find((s) => s.codec_type === 'video'), a = probe.streams.find((s) => s.codec_type === 'audio'), dur = +probe.format.duration;
    report.video = { duration: dur, sizeMB: +(probe.format.size / 1048576).toFixed(1), video: v && `${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate}`, audio: a && a.codec_name };
    step('MP4 has video + audio, vertical 9:16', !!v && !!a && v.height > v.width, report.video);
    step('duration close to target (±20 %)', Math.abs(dur - input.durationSeconds) <= input.durationSeconds * 0.2, `${dur.toFixed(1)} s for ${input.durationSeconds} s`);
  }
  const lib = (await api('/api/projects')).body.find((p) => p.id === projectId);
  step('short is listed in the Video Library with its video', !!lib?.hasVideo, lib ? { title: lib.title, status: lib.status, videoUrl: lib.videoUrl } : 'not listed');
  const media = lib?.videoUrl ? await fetch(BASE + lib.videoUrl, { method: 'HEAD' }) : null;
  step('video is served to the browser', media?.status === 200, media ? `${media.status} ${media.headers.get('content-type')}` : null);
}

// permanent Delete through the new endpoint, only for the short this test created
if (process.env.KEEP !== '1') {
  const del = await api(`/api/projects/${projectId}`, { method: 'DELETE' });
  step('DELETE /api/projects/:id', del.status === 200, del.body);
  const gone = !fs.existsSync(path.join('projects', projectId)) && !fs.existsSync(path.join('exports', `${projectId}.mp4`));
  const listed = (await api('/api/projects')).body.some((p) => p.id === projectId);
  step('project folder and video removed; not listed any more', gone && !listed);
  const again = await api(`/api/projects/${projectId}`, { method: 'DELETE' });
  step('deleting again → 404', again.status === 404, again.body);
}
const bad = await api('/api/projects/..%2F..%2Fdashboard', { method: 'DELETE' });
step('DELETE refuses a path outside the projects folder', bad.status === 404 || bad.status === 400, bad.status);

report.finishedAt = new Date().toISOString(); report.passed = report.steps.every((s) => s.ok);
const out = `logs/tests/e2e-render-${report.startedAt.replace(/[:.]/g, '-').slice(0, 19)}.json`;
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n${report.steps.filter((s) => s.ok).length}/${report.steps.length} steps passed — ${out}`);
