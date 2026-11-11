// Benchmark local image generation (ComfyUI + the installed SD1.5-class checkpoint) on this GPU before using it:
// seconds per image, peak VRAM (nvidia-smi sampled during generation), for a lean and a hi-res setting, on prompts in
// each studio style. Images are kept for visual review. Writes the chosen settings + license to
// models/image-generation/studio-model.json (read by the catalog / imagegen).
//   node tools/benchmark-comfy.mjs              → logs/benchmarks/comfy-<ts>.json + logs/benchmarks/comfy-<ts>/*.png
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getCatalog } from '../dashboard/lib/catalog.js';
import { ensureComfy, stopComfy, generateImage, freeVram, DEFAULT_SETTINGS } from '../dashboard/lib/imagegen.js';
import { PATHS } from '../dashboard/lib/workspace.js';

const ts = new Date().toISOString().replace(/[:.]/g, '-'), dir = path.join(PATHS.logs, 'benchmarks', `comfy-${ts}`);
fs.mkdirSync(dir, { recursive: true });
const cat = getCatalog(true), styles = Object.fromEntries(cat.styles.map((s) => [s.id, s]));
const PROMPTS = [
  ['deep-dive', 'the Mangalyaan orbiter satellite arriving at Mars in space'],
  ['tall-tale', 'a devotee ringing a brass bell at the entrance of an Indian temple'],
  ['night-file', 'a frozen glacial lake high in snowy mountains at night'],
  ['paper-atlas', 'a historic Maratha hill fort on a mountain top'],
  ['inside-out', 'a rocket launching from a launch pad'],
  ['stick-story', 'a family in a living room during a power cut, holding a torch'],
];
const SETTINGS = { lean: { ...DEFAULT_SETTINGS, hires: false }, hires: { ...DEFAULT_SETTINGS, hires: true } };

function vramSampler() {
  let peak = 0, stop = false;
  const tick = () => { if (stop) return; const p = spawn('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { windowsHide: true }); let o = ''; p.stdout.on('data', (b) => (o += b)); p.on('close', () => { const v = parseInt(o, 10); if (v > peak) peak = v; setTimeout(tick, 400); }); };
  tick(); return { done: () => { stop = true; return peak; } };
}

const out = { kind: 'comfyui-benchmark', startedAt: new Date().toISOString(), checkpoint: cat._internal.comfy.checkpoint, gpu: 'NVIDIA GeForce RTX 3050 6GB Laptop GPU', results: [] };
const t0 = Date.now(); await ensureComfy(); out.startupSeconds = +((Date.now() - t0) / 1000).toFixed(1);
console.log(`ComfyUI ready in ${out.startupSeconds} s · checkpoint ${out.checkpoint}`);
// the studio's settings module reads models/image-generation/studio-model.json; benchmark both variants explicitly
const imagegen = await import('../dashboard/lib/imagegen.js');
for (const [variant, s] of Object.entries(SETTINGS)) {
  for (const [k, [style, subject]] of PROMPTS.entries()) {
    if (variant === 'hires' && k > 2) break;   // hi-res only on three prompts (it is the slower path)
    const st = styles[style], positive = `${subject}, ${st.image.prompt}`, file = path.join(dir, `${variant}-${style}.png`);
    const v = vramSampler(), s0 = Date.now();
    let err = null, r = null;
    try { r = await imagegen.generateImage({ positive, negative: st.image.negative, seed: 1234 + k, outFile: file, prefix: `bench/${variant}-${style}`, settingsOverride: s }); } catch (e) { err = e.message; }
    const peak = v.done(), secs = (Date.now() - s0) / 1000;
    const res = { variant, style, subject, seconds: +secs.toFixed(1), vramPeakMiB: peak, file: path.relative(PATHS.root, file), bytes: fs.existsSync(file) ? fs.statSync(file).size : 0, cached: r?.cached, error: err };
    out.results.push(res); console.log(`${variant.padEnd(6)} ${style.padEnd(12)} ${err ? 'FAIL ' + err : `${res.seconds} s · VRAM peak ${peak} MiB`}`);
  }
  await freeVram();
}
stopComfy();
const avg = (v) => { const r = out.results.filter((x) => x.variant === v && !x.error && !x.cached); return r.length ? +(r.reduce((a, x) => a + x.seconds, 0) / r.length).toFixed(1) : null; };
out.summary = { leanAvgSeconds: avg('lean'), hiresAvgSeconds: avg('hires'), peakVramMiB: Math.max(...out.results.map((x) => x.vramPeakMiB || 0)) };
out.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(PATHS.logs, 'benchmarks', `comfy-${ts}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.summary), '\nevidence:', path.relative(PATHS.root, path.join(PATHS.logs, 'benchmarks', `comfy-${ts}.json`)));
process.exit(0);
