// CineForge service for the dashboard: lists the visual styles, starts one video render at a time (the GPU is shared), and
// reports the result from the render's own report. The render is the same tool the command line uses (tools/cineforge-video.mjs),
// so the dashboard and the command line produce identical videos.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STYLES, DEFAULT_STYLE } from './styles.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const TOOL = path.join(ROOT, 'tools', 'cineforge-video.mjs');
const OUT = (style) => path.join(ROOT, 'logs', `cineforge-${style}`);

let current = null;                 // the running job, if any: { style, startedAt, pid, res }
const finished = new Map();         // style → last result { style, status, finishedAt, error?, checks?, video? }

function reportOf(style) {
  try { return JSON.parse(fs.readFileSync(path.join(OUT(style), 'report.json'), 'utf8')); } catch { return null; }
}

/** the six styles as the dashboard shows them, with the result of their last render (from the render's report) */
export function listStyles() {
  return Object.entries(STYLES).map(([id, s]) => {
    const rep = reportOf(id);
    const video = rep && fs.existsSync(rep.video) ? `/api/cineforge/video?style=${encodeURIComponent(id)}` : null;
    const last = finished.get(id) || null;
    return {
      id, label: s.label, sets: s.sets,
      running: !!(current && current.style === id),
      lastRender: rep ? { style: id, at: fs.statSync(rep.video).mtime.toISOString(), inspection: rep.inspection?.ok ?? null, shots: rep.planner?.shots ?? null, renderSeconds: rep.renderSeconds ?? null } : null,
      status: current && current.style === id ? 'running' : (last?.status || (rep ? 'done' : 'not rendered')),
      error: last?.error || null,
      video,
    };
  });
}

export function jobStatus() {
  return { running: current ? { style: current.style, startedAt: current.startedAt, res: current.res } : null, last: [...finished.values()] };
}

/** start a render for one style. Refuses a second render while one is running, and an unknown style. */
export function startRender(style = DEFAULT_STYLE, { res = '1' } = {}) {
  if (!STYLES[style]) throw Object.assign(new Error(`unknown style "${style}"`), { status: 400 });
  if (current) throw Object.assign(new Error(`a render is already running (${current.style})`), { status: 409 });
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, [TOOL], {
    cwd: ROOT, windowsHide: true, env: { ...process.env, CINEFORGE_STYLE: style, CINEFORGE_RES: String(res) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  current = { style, startedAt, pid: child.pid, res: String(res) };
  child.on('close', (code) => {
    const rep = reportOf(style);
    const ok = code === 0 && rep && rep.inspection?.ok;
    finished.set(style, { style, status: ok ? 'done' : 'failed', finishedAt: new Date().toISOString(), error: ok ? null : (stderr.trim().split('\n').slice(-3).join(' ') || `exit ${code}`).slice(0, 400) });
    current = null;
  });
  return { style, startedAt, pid: child.pid };
}

/** the rendered video of a style, as a file path (or null) */
export function videoPath(style) {
  const rep = reportOf(style);
  return rep && fs.existsSync(rep.video) ? rep.video : null;
}
