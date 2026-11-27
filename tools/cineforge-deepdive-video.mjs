// CineForge on the Deep Dive 3D engine: the example sentence → LIVE Groq planner → validated shots → render every frame in
// headless Chrome with the Deep Dive film engine → measure the composed frames → encode H.264 MP4 → verify with FFprobe.
// Output: logs/cineforge-deepdive/ (gitignored). Existing styles are only read, never changed.
//   node tools/cineforge-deepdive-video.mjs             full 1080x1920, 30 fps
//   CINEFORGE_RES=0.5 node tools/cineforge-deepdive-video.mjs   half-resolution 3D (faster, for checking)
//   CINEFORGE_REUSE_EVENTS=1 ...                        reuse the last saved live plan (judge rendering changes on the same shots)
// Sentence timing is ASSUMED (8.0 s); real timing from Kokoro/Whisper is not read yet.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, runChrome, parseStageResult, findChrome } from './cineforge-harness.mjs';
import { analyzeNarration } from '../dashboard/lib/cineforge/narrative-analyzer.js';
import { planShots, validateShots } from '../dashboard/lib/cineforge/shot-planner.js';
import { inspectFrames } from '../dashboard/lib/cineforge/visual-inspector.js';

const W = 1080, H = 1920, FPS = 30, RES = process.env.CINEFORGE_RES || '1';
// the hook from the Deep Dive style sheet: a person at home (kitchen), then inside the body (x-ray). Two sentences.
const SENTENCES = ['What if you swallowed gum?', 'It stays inside your stomach.'];
const SENTENCE = SENTENCES.join(' ');
const SEGMENTS = [{ id: 'S1', start: 0, end: 3 }, { id: 'S2', start: 3, end: 6 }];   // ASSUMED timing (3 shots of 1 s each)

const OUT = path.join(ROOT, 'logs', 'cineforge-deepdive');
const FRAMES = path.join(OUT, 'frames');
const ffmpeg = path.join(ROOT, 'runtime', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobe = path.join(ROOT, 'runtime', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
const PAGE = '/engine/cineforge/index.html';
const ALLOWED = ['/engine/cineforge/', '/engine/styles/deep-dive/example/', '/dashboard/lib/cineforge/'];

function fail(msg) { console.error(`FAILED: ${msg}`); process.exit(1); }
if (!findChrome()) fail('no Chrome/Edge found');

// 1. live planner, with repair: a plan that fails the shot rules (counts per sentence, static shots, durations) is sent back
//    to the planner with the exact errors, up to 3 attempts. Nothing is repaired by hand.
const SAVED = path.join(OUT, 'planner-events.json');
const INPUTS = SEGMENTS.map((s, i) => ({ id: s.id, text: SENTENCES[i], subject: 'person', environment: 'kitchen', seconds: s.end - s.start }));
const MAX_ATTEMPTS = 3;
let analysis = null, shots = null, validation = null, feedback = null;
if (process.env.CINEFORGE_REUSE_EVENTS === '1' && fs.existsSync(SAVED)) {
  analysis = { source: 'groq', events: JSON.parse(fs.readFileSync(SAVED, 'utf8')).events, errors: [], reusedSavedPlan: true };
  ({ shots } = planShots(analysis.events, SEGMENTS));
  validation = validateShots(shots, SEGMENTS);
  if (!validation.ok) fail(`saved plan is not valid: ${validation.errors.join('; ')}`);
} else {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const a = await analyzeNarration(INPUTS, { feedback });
    // keep the raw planner output of every attempt, so a rejected plan can be inspected
    fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'logs', `cineforge-deepdive-attempt${attempt}.json`), JSON.stringify({ sentences: SENTENCES, source: a.source, errors: a.errors, events: a.events }, null, 2));
    if (a.source !== 'groq') { analysis = a; validation = { ok: false, errors: [`planner did not return a valid plan: ${a.errors.join('; ')}`], warnings: [] }; break; }
    const planned = planShots(a.events, SEGMENTS);
    const v = planned.errors.length ? { ok: false, errors: planned.errors, warnings: [] } : validateShots(planned.shots, SEGMENTS);
    analysis = a; shots = planned.shots; validation = v;
    if (v.ok) { console.log(`planner accepted on attempt ${attempt}`); break; }
    console.log(`planner attempt ${attempt} rejected: ${v.errors.join('; ')}`);
    feedback = v.errors.join('; ');
  }
  if (!validation.ok) fail(`planner did not produce a valid plan after ${MAX_ATTEMPTS} attempts: ${validation.errors.join('; ')}`);
}

// 3. the plan and the output folder
const total = SEGMENTS.at(-1).end;
const times = Array.from({ length: Math.round(total * FPS) }, (_, i) => +(i / FPS).toFixed(4));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
fs.writeFileSync(SAVED, JSON.stringify({ sentence: SENTENCE, source: analysis.source, events: analysis.events }, null, 2));
fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ segments: SEGMENTS, shots, warnings: validation.warnings }, null, 2));
const plan = { width: W, height: H, fps: FPS, shots, times };   // served from memory at /engine/cineforge/plan.json (nothing written into the repo)

// 4. serve the repo (only the CineForge page, its runtime, and the read-only Deep Dive engine and vendor files)
let saved = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/frame' && req.method === 'POST') {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { fs.writeFileSync(path.join(FRAMES, `frame_${String(u.searchParams.get('i')).padStart(4, '0')}.jpg`), Buffer.concat(chunks)); saved++; res.writeHead(204); res.end(); });
    return;
  }
  const rel = decodeURIComponent(u.pathname);
  if (rel === '/engine/cineforge/plan.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(plan)); }
  if (!ALLOWED.some((p) => rel.startsWith(p)) && rel !== PAGE) { res.writeHead(404); return res.end('not found'); }
  const file = path.resolve(ROOT, '.' + (rel === '/' ? PAGE : rel));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}${PAGE}?res=${RES}`;

const t0 = Date.now();
let result;
try {
  result = parseStageResult(await runChrome(url, { width: W, height: H, timeoutMs: 3600000 }));
} finally {
  server.close();
}
if (result.error) fail(`render: ${result.error}`);
const renderSeconds = ((Date.now() - t0) / 1000).toFixed(1);

// 5. measured inspection (no score)
const inspection = inspectFrames(result.frames, shots);

// 6. encode and verify
const mp4 = path.join(OUT, 'cineforge-deepdive.mp4');
const enc = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'frame_%04d.jpg'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
if (enc.status !== 0) fail(`ffmpeg: ${enc.stderr}`);
const probe = JSON.parse(spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
  '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames,duration', '-of', 'json', mp4], { encoding: 'utf8' }).stdout);
const s = probe.streams[0];

const report = {
  video: mp4, engine: 'Deep Dive 3D film engine (read-only import)', resolutionScale: RES, sentence: SENTENCE,
  timingSource: 'assumed (8.0 s); not yet read from Kokoro/Whisper word timestamps',
  planner: { source: analysis.source, reusedSavedPlan: !!analysis.reusedSavedPlan, shots: shots.length },
  expected: { width: W, height: H, fps: FPS, durationSeconds: total, frames: times.length },
  actual: { width: s.width, height: s.height, fps: s.r_frame_rate, frames: Number(s.nb_read_frames), durationSeconds: Number(s.duration) },
  framesSaved: saved, renderSeconds: Number(renderSeconds),
  validationWarnings: validation.warnings, inspection, measurements: result.frames,
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

const checks = [
  ['planner returned a valid live plan', analysis.source === 'groq'],
  ['sentence has 3–6 shots', shots.length >= 3 && shots.length <= 6],
  ['resolution 1080x1920', s.width === W && s.height === H],
  ['30 fps', s.r_frame_rate === '30/1'],
  ['frame count matches plan', Number(s.nb_read_frames) === times.length],
  ['every frame saved', saved === times.length],
  ['measured inspection passes', inspection.ok],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(`video: ${mp4}`);
console.log(`shots: ${shots.map((x) => `${x.id} ${x.set}/${x.shotSize}/${x.camera}/${x.effect}`).join(' | ')}`);
console.log(`render time: ${renderSeconds} s for ${times.length} frames at RES ${RES}`);
console.log(`inspection: ${JSON.stringify(inspection.counts)}${inspection.errors.length ? ' — ' + inspection.errors.slice(0, 3).join('; ') : ''}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
