// CineForge automation — cover image: one frame from the finished MP4, checked before it is ever uploaded.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATHS } from '../dashboard/lib/workspace.js';
import { measureImage } from '../dashboard/lib/imageqa.js';

const FFMPEG = PATHS.ffmpeg, FFPROBE = PATHS.ffprobe;
const MAX_BYTES = 2 * 1024 * 1024;   // YouTube thumbnail limit

/** duration of the MP4 in seconds (ffprobe) */
export function videoDuration(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true });
  const d = parseFloat(r.stdout);
  if (r.status !== 0 || !Number.isFinite(d) || d <= 0) throw new Error(`cannot read the video duration (${(r.stderr || '').slice(0, 120)})`);
  return d;
}

/**
 * Extract the cover frame at `atFraction` of the video, as a JPEG (quality 3 ≈ 150–300 KB at 1080×1920).
 * Retries at other points if the frame is too dark or flat; never returns a bad frame.
 */
export function extractCover(videoFile, outFile, { atFractions = [0.35, 0.5, 0.2, 0.65] } = {}) {
  const dur = videoDuration(videoFile);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const tried = [];
  for (const f of atFractions) {
    const t = (dur * f).toFixed(2);
    const r = spawnSync(FFMPEG, ['-v', 'error', '-y', '-ss', t, '-i', videoFile, '-frames:v', '1', '-q:v', '3', outFile], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0 || !fs.existsSync(outFile)) { tried.push({ at: t, problem: 'ffmpeg could not extract a frame' }); continue; }
    const size = fs.statSync(outFile).size;
    if (size > MAX_BYTES) { tried.push({ at: t, problem: `${(size / 1048576).toFixed(1)} MB (max 2 MB)` }); continue; }
    const st = measureImage(outFile);
    const problem = st.avg < 35 ? `too dark (average ${Math.round(st.avg)})` : (st.high - st.low) < 60 ? 'too flat (no contrast)' : null;
    if (problem) { tried.push({ at: t, problem }); continue; }
    return { ok: true, file: outFile, at: +t, bytes: size, luma: { avg: Math.round(st.avg), low: st.low, high: st.high }, tried };
  }
  try { fs.rmSync(outFile, { force: true }); } catch {}
  return { ok: false, file: null, tried };
}
