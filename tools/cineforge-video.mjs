// CineForge test video: the example sentence → LIVE Groq planner → validated shots → route → render every frame in headless
// Chrome (Three.js) → inspect the measured frames → encode H.264 MP4 with FFmpeg → verify with FFprobe.
// Output goes to logs/cineforge-test/ (gitignored): the video, the planner's events, the plan and the per-frame report.
//   node tools/cineforge-video.mjs            1080x1920, 30 fps
// The sentence's timing is ASSUMED (8.0 s). Real timing comes from the Kokoro/Faster-Whisper word timestamps, which this
// tool does not yet read; the report says so.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, serveStage, runChrome, parseStageResult, findChrome } from './cineforge-harness.mjs';
import { analyzeNarration } from '../dashboard/lib/cineforge/narrative-analyzer.js';
import { planShots, validateShots } from '../dashboard/lib/cineforge/shot-planner.js';
import { routeShots } from '../dashboard/lib/cineforge/renderer-router.js';
import { inspectFrames } from '../dashboard/lib/cineforge/visual-inspector.js';

const W = 1080, H = 1920, FPS = 30;
const SENTENCE = 'A giant asteroid approached Earth, entered its atmosphere, and collided with the surface, creating a massive explosion.';
const SEGMENTS = [{ id: 'S1', start: 0, end: 8 }];   // ASSUMED timing for this sentence (see header)

const OUT = path.join(ROOT, 'logs', 'cineforge-test');
const FRAMES = path.join(OUT, 'frames');
const ffmpeg = path.join(ROOT, 'runtime', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobe = path.join(ROOT, 'runtime', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

function fail(msg) { console.error(`FAILED: ${msg}`); process.exit(1); }

if (!findChrome()) fail('no Chrome/Edge found');

// 1. live planner (Groq). A fallback is NOT accepted here: the demo must come from the real planner.
// CINEFORGE_REUSE_EVENTS=1 re-uses the events saved by the last live run (for judging rendering changes on the same shots).
const SAVED = path.join(OUT, 'planner-events.json');
let analysis;
if (process.env.CINEFORGE_REUSE_EVENTS === '1' && fs.existsSync(SAVED)) {
  const saved = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
  analysis = { source: 'groq', events: saved.events, errors: [], reusedSavedPlan: true };
} else {
  analysis = await analyzeNarration([{ id: SEGMENTS[0].id, text: SENTENCE, subject: 'asteroid', environment: 'space' }]);
  if (analysis.source !== 'groq') fail(`planner did not return a valid plan (source ${analysis.source}): ${analysis.errors.join('; ')}`);
}

// 2. timed shots and validation (timing, counts, enums, states, static-shot rule)
const { shots, errors: planErrors } = planShots(analysis.events, SEGMENTS);
if (planErrors.length) fail(`plan: ${planErrors.join('; ')}`);
const validation = validateShots(shots, SEGMENTS);
if (!validation.ok) fail(`validation: ${validation.errors.join('; ')}`);

// 3. routing (Three.js is the only renderer installed)
const routed = routeShots(shots, { available: { threejs: true, blender: false } });
if (routed.errors.length) fail(`routing: ${routed.errors.join('; ')}`);

// 4. render every frame
const total = SEGMENTS.at(-1).end;
const times = Array.from({ length: Math.round(total * FPS) }, (_, i) => +(i / FPS).toFixed(4));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
fs.writeFileSync(path.join(OUT, 'planner-events.json'), JSON.stringify({ sentence: SENTENCE, source: analysis.source, events: analysis.events }, null, 2));
fs.writeFileSync(path.join(OUT, 'shots.json'), JSON.stringify({ segments: SEGMENTS, shots, warnings: validation.warnings }, null, 2));

const plan = { width: W, height: H, shots, times, frameUpload: '/frame' };
let saved = 0;
const { server, url } = await serveStage(plan, {
  onFrame: (i, buf) => { fs.writeFileSync(path.join(FRAMES, `frame_${String(i).padStart(4, '0')}.jpg`), buf); saved++; },
});
const t0 = Date.now();
let result;
try {
  result = parseStageResult(await runChrome(url, { width: W, height: H, timeoutMs: 900000 }));
} finally {
  server.close();
}
if (result.error) fail(`stage: ${result.error}`);
const renderSeconds = ((Date.now() - t0) / 1000).toFixed(1);

// 5. measured inspection (no score)
const inspection = inspectFrames(result.frames, shots);

// 6. encode and verify
const mp4 = path.join(OUT, 'cineforge-test.mp4');
const enc = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'frame_%04d.jpg'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
if (enc.status !== 0) fail(`ffmpeg: ${enc.stderr}`);
const probe = JSON.parse(spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
  '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames,duration', '-of', 'json', mp4], { encoding: 'utf8' }).stdout);
const s = probe.streams[0];

const report = {
  video: mp4,
  sentence: SENTENCE,
  timingSource: 'assumed (8.0 s); not yet read from Kokoro/Whisper word timestamps',
  planner: { source: analysis.source, reusedSavedPlan: !!analysis.reusedSavedPlan, shots: shots.length },
  expected: { width: W, height: H, fps: FPS, durationSeconds: total, frames: times.length },
  actual: { width: s.width, height: s.height, fps: s.r_frame_rate, frames: Number(s.nb_read_frames), durationSeconds: Number(s.duration) },
  framesSaved: saved,
  renderSeconds: Number(renderSeconds),
  routing: routed.plan,
  validationWarnings: validation.warnings,
  inspection,
  measurements: result.frames,   // per-frame numbers the inspection was based on
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
console.log(`shots: ${shots.map((x) => `${x.id} ${x.shotSize}/${x.camera}/${x.effect}`).join(' | ')}`);
console.log(`render time: ${renderSeconds} s for ${times.length} frames`);
console.log(`inspection: ${JSON.stringify(inspection.counts)}${inspection.errors.length ? ' — ' + inspection.errors.slice(0, 3).join('; ') : ''}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
