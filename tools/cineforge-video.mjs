// CineForge video for one visual style: narration (the studio's Kokoro voice) → LIVE Groq planner (with that style's sets only,
// repaired from its own errors) → validated shots → render every frame in headless Chrome with the style's film engine →
// measure the composed frames → mux the narration → verify with FFprobe. Output: logs/cineforge-<style>/ (gitignored).
// The style folders (engine/styles/*) are only read, never changed.
//   CINEFORGE_STYLE=deep-dive node tools/cineforge-video.mjs
//   CINEFORGE_STYLE=night-file CINEFORGE_RES=0.5 node tools/cineforge-video.mjs     half-resolution 3D (faster, for checking)
//   CINEFORGE_REUSE_EVENTS=1 ...   reuse the last saved live plan of this style (judge rendering changes on the same shots)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, runChrome, parseStageResult, findChrome } from './cineforge-harness.mjs';
import { analyzeNarration } from '../dashboard/lib/cineforge/narrative-analyzer.js';
import { planShots, validateShots } from '../dashboard/lib/cineforge/shot-planner.js';
import { inspectFrames } from '../dashboard/lib/cineforge/visual-inspector.js';
import { STYLES } from '../dashboard/lib/cineforge/styles.js';

const W = 1080, H = 1920, FPS = 30, RES = process.env.CINEFORGE_RES || '1';
// per style: the sentences of its test hook, the narrator voice (Kokoro, offline), and what the person is doing in the set
const CONFIG = {
  'deep-dive': {
    sentences: ['What if you swallowed gum?', 'It stays inside your stomach.'],
    voice: 'am_michael', environment: 'a kitchen, or inside the body',
  },
  'inside-out': {
    sentences: ['What if you swallowed gum?', 'It goes down into your stomach.'],
    voice: 'am_michael', environment: 'a bright room, an x-ray of the body, or inside the stomach',
  },
  'paper-atlas': {
    sentences: ['In 1666, a baker left a fire burning.', 'The fire spread across the old city.'],
    voice: 'am_michael', environment: 'a hall on parchment, a harbour, or a map of the city',
  },
  'stick-story': {
    sentences: ['What if the power went out for three days?', 'You would need a plan.'],
    voice: 'am_michael', environment: 'a living room, a kitchen, or a hallway',
  },
  'tall-tale': {
    sentences: ['In 1914, a family mailed their daughter to Grandma.', 'The postman accepted her as a parcel.'],
    voice: 'am_michael', environment: 'a sunny main street, an indoor shop with a counter, or a meadow',
  },
  'night-file': {
    sentences: ['She walked down the dark corridor.', 'Her photo hung on the case wall.'],
    voice: 'am_onyx', environment: 'a dark apartment corridor, a dark house at night, or a case wall',
  },
};
const STYLE = process.env.CINEFORGE_STYLE || 'deep-dive';
if (!CONFIG[STYLE] || !STYLES[STYLE]) { console.error(`FAILED: no test configuration for style "${STYLE}" (known: ${Object.keys(CONFIG).join(', ')})`); process.exit(1); }
const { sentences: SENTENCES, voice: VOICE, environment: ENV } = CONFIG[STYLE];
const SENTENCE = SENTENCES.join(' ');

const NARR = path.join(ROOT, 'logs', `cineforge-narration-${STYLE}`);
const OUT = path.join(ROOT, 'logs', `cineforge-${STYLE}`);
const FRAMES = path.join(OUT, 'frames');
const ffmpeg = path.join(ROOT, 'runtime', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobe = path.join(ROOT, 'runtime', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
const PYTHON = path.join(ROOT, 'runtime', 'python-venv', 'Scripts', process.platform === 'win32' ? 'python.exe' : 'python');
const PAGE = '/engine/cineforge/index.html';
const ALLOWED = ['/engine/cineforge/', '/engine/styles/deep-dive/example/', '/engine/styles/night-file/example/', '/engine/styles/tall-tale/example/',
  '/engine/styles/inside-out/example/', '/engine/styles/paper-atlas/example/', '/engine/styles/stick-story/example/', '/dashboard/lib/cineforge/'];

function fail(msg) { console.error(`FAILED: ${msg}`); process.exit(1); }
if (!findChrome()) fail('no Chrome/Edge found');

// 1. narration: the studio's voice tool (real audio, exact line times)
function narrate() {
  fs.mkdirSync(NARR, { recursive: true });
  fs.writeFileSync(path.join(NARR, 'script.json'), JSON.stringify({ lines: SENTENCES.map((text) => ({ text })), lead: 0.35, gap: 0.26, outro: 1.0 }, null, 1));
  const r = spawnSync(PYTHON, [path.join(ROOT, 'engine', 'scripts', 'voice.py'), '--script', path.join(NARR, 'script.json'), '--out-dir', NARR,
    '--voice', VOICE, '--lang', 'en-us', '--speed', '1.0'], { encoding: 'utf8' });
  if (r.status !== 0) fail(`narration: ${r.stderr || r.stdout}`);
  return JSON.parse(fs.readFileSync(path.join(NARR, 'lines.json'), 'utf8'));
}
const NARR_META = narrate();
// each sentence's window runs from its first spoken word to the next sentence's first word (the last one to the end)
const SEGMENTS = SENTENCES.map((text, i) => ({
  id: `S${i + 1}`, start: i === 0 ? 0 : NARR_META.lines[i].start, end: i + 1 < SENTENCES.length ? NARR_META.lines[i + 1].start : NARR_META.duration,
}));

// 2. live planner for this style, with repair: a plan that fails the shot rules goes back with the exact errors (3 attempts)
const SAVED = path.join(OUT, 'planner-events.json');
const INPUTS = SEGMENTS.map((s, i) => ({ id: s.id, text: SENTENCES[i], subject: 'person', environment: ENV, seconds: s.end - s.start }));
const MAX_ATTEMPTS = 3;
let analysis = null, shots = null, validation = null, feedback = null;
if (process.env.CINEFORGE_REUSE_EVENTS === '1' && fs.existsSync(SAVED)) {
  analysis = { source: 'groq', events: JSON.parse(fs.readFileSync(SAVED, 'utf8')).events, errors: [], reusedSavedPlan: true };
  ({ shots } = planShots(analysis.events, SEGMENTS));
  validation = validateShots(shots, SEGMENTS, { style: STYLE });
  if (!validation.ok) fail(`saved plan is not valid: ${validation.errors.join('; ')}`);
} else {
  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const a = await analyzeNarration(INPUTS, { feedback, style: STYLE });
    fs.writeFileSync(path.join(ROOT, 'logs', `cineforge-${STYLE}-attempt${attempt}.json`), JSON.stringify({ style: STYLE, sentences: SENTENCES, source: a.source, errors: a.errors, events: a.events }, null, 2));
    if (a.source !== 'groq') { analysis = a; validation = { ok: false, errors: [`planner did not return a valid plan: ${a.errors.join('; ')}`], warnings: [] }; break; }
    const planned = planShots(a.events, SEGMENTS);
    const v = planned.errors.length ? { ok: false, errors: planned.errors, warnings: [] } : validateShots(planned.shots, SEGMENTS, { style: STYLE });
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
fs.writeFileSync(SAVED, JSON.stringify({ style: STYLE, sentence: SENTENCE, source: analysis.source, events: analysis.events }, null, 2));
fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ style: STYLE, segments: SEGMENTS, shots, warnings: validation.warnings }, null, 2));
const plan = { style: STYLE, width: W, height: H, fps: FPS, shots, times };   // served from memory at /engine/cineforge/plan.json

// 4. serve the repo (only the CineForge page, its runtime, and the read-only style folders)
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
  const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.ttf') ? 'font/ttf' : file.endsWith('.otf') ? 'font/otf' : file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}${PAGE}?style=${STYLE}&res=${RES}`;

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

// 6. encode, mux the narration, verify
const videoOnly = path.join(OUT, 'video-only.mp4');
const mp4 = path.join(OUT, `cineforge-${STYLE}.mp4`);
const enc = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'frame_%04d.jpg'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', videoOnly], { encoding: 'utf8' });
if (enc.status !== 0) fail(`ffmpeg: ${enc.stderr}`);
const mux = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', videoOnly, '-i', path.join(NARR, 'narration.wav'),
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
if (mux.status !== 0) fail(`ffmpeg mux: ${mux.stderr}`);
fs.rmSync(videoOnly, { force: true });
const probe = JSON.parse(spawnSync(ffprobe, ['-v', 'error', '-count_frames',
  '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_read_frames,duration', '-of', 'json', mp4], { encoding: 'utf8' }).stdout);
const s = probe.streams.find((x) => x.codec_type === 'video');
const audio = probe.streams.find((x) => x.codec_type === 'audio');

const allowedSets = STYLES[STYLE].sets;
const report = {
  style: STYLE, label: STYLES[STYLE].label, video: mp4, resolutionScale: RES, sentence: SENTENCE,
  timingSource: `real: Kokoro narration (${VOICE}), line times from ${path.relative(ROOT, path.join(NARR, 'lines.json'))}`,
  narration: { voice: VOICE, duration: NARR_META.duration, lines: NARR_META.lines.map((l) => ({ start: l.start, end: l.end, text: l.text })) },
  audio: audio ? { codec: 'aac', duration: Number(audio.duration) } : null,
  planner: { source: analysis.source, reusedSavedPlan: !!analysis.reusedSavedPlan, shots: shots.length },
  expected: { width: W, height: H, fps: FPS, durationSeconds: total, frames: times.length },
  actual: { width: s.width, height: s.height, fps: s.r_frame_rate, frames: Number(s.nb_read_frames), durationSeconds: Number(s.duration) },
  framesSaved: saved, renderSeconds: Number(renderSeconds),
  validationWarnings: validation.warnings, inspection, measurements: result.frames,
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

const checks = [
  ['planner returned a valid live plan', analysis.source === 'groq'],
  ['every shot uses only this style\'s sets', shots.every((x) => allowedSets.includes(x.set))],
  ['each sentence has its allowed shot count (3–6 for a sentence of 3 s or more; fewer for shorter ones)', validation.ok],
  ['narration audio is in the video', !!audio],
  ['video length matches the narration', Math.abs(Number(s.duration) - NARR_META.duration) < 0.2],
  ['resolution 1080x1920', s.width === W && s.height === H],
  ['30 fps', s.r_frame_rate === '30/1'],
  ['frame count matches plan (within 3 frames: the audio mux trims the end)', Math.abs(Number(s.nb_read_frames) - times.length) <= 3],
  ['every frame saved', saved === times.length],
  ['measured inspection passes', inspection.ok],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(`style: ${STYLES[STYLE].label}`);
console.log(`video: ${mp4}`);
console.log(`shots: ${shots.map((x) => `${x.id} ${x.set}/${x.shotSize}/${x.camera}/${x.effect}`).join(' | ')}`);
console.log(`render time: ${renderSeconds} s for ${times.length} frames at RES ${RES}`);
console.log(`inspection: ${JSON.stringify(inspection.counts)}${inspection.errors.length ? ' — ' + inspection.errors.slice(0, 3).join('; ') : ''}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
