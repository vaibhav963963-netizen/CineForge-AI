// CineForge automation — health checks (scheduler start + before each run) and resource probes incl. VRAM.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './db.mjs';

/** GPU memory via nvidia-smi (null when no NVIDIA GPU / tool) */
export function gpuMemory() {
  try {
    const r = spawnSync('nvidia-smi', ['--query-gpu=memory.used,memory.total,name', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (r.status !== 0) return null;
    const [used, total, ...name] = r.stdout.trim().split('\n')[0].split(',').map((x) => x.trim());
    return { usedGB: +(+used / 1024).toFixed(2), totalGB: +(+total / 1024).toFixed(2), freeGB: +((+total - +used) / 1024).toFixed(2), name: name.join(',') };
  } catch { return null; }
}

export async function probeResources(studioUrl) {
  let freeDiskGB = null;
  try { const st = fs.statfsSync(ROOT); freeDiskGB = +((st.bavail * st.bsize) / 1e9).toFixed(1); } catch {}
  let studioBusy = false;
  try { const r = await fetch(`${studioUrl}/api/jobs/active`, { signal: AbortSignal.timeout(3000) }); if (r.ok) studioBusy = (await r.json()).length > 0; } catch {}
  const gpu = gpuMemory();
  return { freeDiskGB, freeRamGB: +(os.freemem() / 1e9).toFixed(1), freeVramGB: gpu?.freeGB ?? null, studioBusy };
}

/** full health report: [{ check, ok, detail, severity }] — severity 'critical' blocks production */
export async function healthReport(s, { youtube = null } = {}) {
  const out = [], add = (check, ok, detail, severity = 'critical') => out.push({ check, ok: !!ok, detail, severity: ok ? 'ok' : severity });
  const res = await probeResources(s.studio.url);
  add('disk', res.freeDiskGB == null || res.freeDiskGB >= s.minFreeDiskGB, `${res.freeDiskGB ?? '?'} GB free (minimum ${s.minFreeDiskGB})`);
  add('ram', res.freeRamGB >= s.minFreeRamGB, `${res.freeRamGB} GB free (minimum ${s.minFreeRamGB})`, 'warning');
  const gpu = gpuMemory();
  add('gpu', !!gpu, gpu ? `${gpu.name}: ${gpu.freeGB} of ${gpu.totalGB} GB VRAM free` : 'nvidia-smi not found (GPU check skipped)', 'warning');
  const llm = (() => { try { return fs.readdirSync(path.join(ROOT, 'models', 'llm')).filter((f) => f.endsWith('.gguf')); } catch { return []; } })();
  add('script model', llm.length > 0, llm.join(', ') || 'no .gguf model in models/llm');
  add('kokoro', fs.existsSync(path.join(ROOT, 'models', 'kokoro', 'kokoro-v1.0.onnx')), 'models/kokoro/kokoro-v1.0.onnx');
  add('ffmpeg', fs.existsSync(path.join(ROOT, 'runtime', 'ffmpeg', 'bin', 'ffmpeg.exe')) || spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0, 'runtime/ffmpeg/bin/ffmpeg.exe');
  let studio = false; try { studio = (await fetch(`${s.studio.url}/api/catalog`, { signal: AbortSignal.timeout(4000) })).ok; } catch {}
  add('studio', studio, studio ? `reachable at ${s.studio.url}` : `not running at ${s.studio.url} (the scheduler starts it when needed)`, 'info');
  if (s.publishMode !== 'manual') {
    const y = youtube?.status?.() || (await import('./youtube.mjs')).status();
    add('youtube', y.clientSecret && y.authorized, y.authorized ? `authorized ${y.authorizedAt || ''} · quota ${y.quotaUsedToday ?? '?'}/${y.quotaDaily}` : (y.clientSecret ? 'not authorized — run: node automation/youtube.mjs authorize' : 'youtube/client_secret.json missing'));
  }
  return { ok: out.every((c) => c.ok || c.severity !== 'critical'), checks: out, resources: res };
}
