// CineForge test video: plan → route → render every frame in headless Chrome (Three.js) → inspect the measured frames →
// encode H.264 MP4 with FFmpeg → verify with FFprobe. Output goes to logs/cineforge-test/ (gitignored).
//   node tools/cineforge-video.mjs            1080x1920, 30 fps, 9 s demo
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, serveStage, runChrome, parseStageResult, findChrome } from './cineforge-harness.mjs';
import { planShots } from '../dashboard/lib/cineforge/shot-planner.js';
import { routeShots } from '../dashboard/lib/cineforge/renderer-router.js';
import { inspectFrames } from '../dashboard/lib/cineforge/visual-inspector.js';

const W = 1080, H = 1920, FPS = 30;
// Demo narration as timed segments (in a real run these come from the Faster-Whisper word timestamps).
const SEGMENTS = [{ id: 'S1', start: 0, end: 6 }, { id: 'S2', start: 6, end: 9 }];
// Demo events. The impact shot uses a track camera because impact + shake needs Blender (not installed); the router
// would report that as an error, which is the intended behaviour.
const EVENTS = [
  { id: 'E001', segmentId: 'S1', subject: 'asteroid', action: 'approaches Earth', environment: 'space', motion: 'approach', camera: 'static' },
  { id: 'E002', segmentId: 'S1', subject: 'asteroid', action: 'enters the atmosphere', environment: 'upper atmosphere', motion: 'approach', camera: 'push' },
  { id: 'E003', segmentId: 'S1', subject: 'asteroid', action: 'impacts the surface', environment: 'surface', motion: 'impact', camera: 'track' },
  { id: 'E004', segmentId: 'S2', subject: 'dust', action: 'rises over the crater', environment: 'surface', motion: 'rise', camera: 'crane' },
];

const OUT = path.join(ROOT, 'logs', 'cineforge-test');
const FRAMES = path.join(OUT, 'frames');
const ffmpeg = path.join(ROOT, 'runtime', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobe = path.join(ROOT, 'runtime', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

function fail(msg) { console.error(`FAILED: ${msg}`); process.exit(1); }

if (!findChrome()) fail('no Chrome/Edge found');
const { shots, errors: planErrors } = planShots(EVENTS, SEGMENTS);
if (planErrors.length) fail(`plan: ${planErrors.join('; ')}`);
const routed = routeShots(shots, { available: { threejs: true, blender: false } });
if (routed.errors.length) fail(`routing: ${routed.errors.join('; ')}`);

const total = SEGMENTS.at(-1).end;
const times = Array.from({ length: Math.round(total * FPS) }, (_, i) => +(i / FPS).toFixed(4));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

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

const inspection = inspectFrames(result.frames, shots);
const mp4 = path.join(OUT, 'cineforge-test.mp4');
const enc = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(FRAMES, 'frame_%04d.jpg'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
if (enc.status !== 0) fail(`ffmpeg: ${enc.stderr}`);
const probe = JSON.parse(spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
  '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames,duration', '-of', 'json', mp4], { encoding: 'utf8' }).stdout);
const s = probe.streams[0];

const report = {
  video: mp4,
  expected: { width: W, height: H, fps: FPS, durationSeconds: total, frames: times.length },
  actual: { width: s.width, height: s.height, fps: s.r_frame_rate, frames: Number(s.nb_read_frames), durationSeconds: Number(s.duration) },
  framesSaved: saved,
  renderSeconds: Number(renderSeconds),
  routing: routed.plan,
  inspection,
  measurements: result.frames,   // per-frame numbers the inspection was based on
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

const checks = [
  ['resolution 1080x1920', s.width === W && s.height === H],
  ['30 fps', s.r_frame_rate === '30/1'],
  ['frame count matches plan', Number(s.nb_read_frames) === times.length],
  ['every frame saved', saved === times.length],
  ['measured inspection passes', inspection.ok],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(`video: ${mp4}`);
console.log(`render time: ${renderSeconds} s for ${times.length} frames`);
console.log(`inspection: ${JSON.stringify(inspection.counts)}${inspection.errors.length ? ' — ' + inspection.errors.slice(0, 3).join('; ') : ''}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
