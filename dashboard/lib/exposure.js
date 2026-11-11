// Exposure checks for generated images and rendered shots. Luma statistics come from FFmpeg signalstats:
// YAVG = mean, YLOW/YHIGH = 10th/90th percentile (0–255).
// Calibrated on the Roopkund night-file render (Nov 11): near-black AI image shots measured YHIGH 3–4 (a skeleton
// lost on black), a blown-out glow shot YLOW 74 / YAVG 153 in a video whose other shots averaged ~40, and readable
// dim night shots YHIGH 34–133.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PATHS } from './workspace.js';

// raw-image limits are stricter than rendered-shot limits: style treatments darken (night-file turned a raw image
// with 90th-percentile luma 34 / range 13 into a near-black shot at 8; raw images at ≥ 63 / range ≥ 40 stayed readable)
export const LIMITS = { darkHigh: 22, imageDarkHigh: 55, imageFlatRange: 25, blownLow: 60, blownAvg: 140, blownRatio: 1.8, flatRange: 12 };

/** luma stats of one still image */
export function imageStats(file) {
  const r = spawnSync(PATHS.ffmpeg, ['-hide_banner', '-i', file, '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true });
  const g = (k) => +(((r.stdout || '') + (r.stderr || '')).match(new RegExp(`signalstats\\.${k}=([\\d.]+)`)) || [])[1];
  return { avg: g('YAVG'), low: g('YLOW'), high: g('YHIGH') };
}

/** a generated image before it is used: null when fine, else the reason */
export function judgeImage({ avg, low, high }) {
  if (![avg, low, high].every(Number.isFinite)) return 'unreadable image';
  if (high < LIMITS.imageDarkHigh) return `near-black (90th-percentile luma ${high})`;
  if (low > 110) return `blown out (10th-percentile luma ${low})`;
  if (high - low < LIMITS.imageFlatRange) return `flat, no detail (luma range ${high - low})`;
  return null;
}

/** last resort for an image that stays too dark/flat after regeneration: stretch its levels locally (in place) */
export function autoLevel(file) {
  const tmp = file.replace(/\.png$/i, '.lvl.png');
  const r = spawnSync(PATHS.ffmpeg, ['-hide_banner', '-y', '-i', file, '-vf', 'normalize=blackpt=black:whitept=white:smoothing=0:independence=0,eq=gamma=1.15', '-frames:v', '1', tmp], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return false;
  fs.renameSync(tmp, file); return true;
}

/** per-shot verdicts for a rendered video. frames: [{ t, avg, low, high }]; shots: [{ id, start, end }] */
export function judgeShots(frames, shots) {
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const per = shots.map((s) => {
    // skip the transitions at both ends of the shot
    const pad = Math.min(0.35, (s.end - s.start) / 4), fr = frames.filter((f) => f.t >= s.start + pad && f.t <= s.end - pad);
    return { id: s.id, start: s.start, end: s.end, n: fr.length, avg: med(fr.map((f) => f.avg)), low: med(fr.map((f) => f.low)), high: med(fr.map((f) => f.high)) };
  }).filter((p) => p.n);
  const videoAvg = med(per.map((p) => p.avg));
  for (const p of per) {
    p.problem = p.high < LIMITS.darkHigh ? `near-black (90th-percentile luma ${p.high})`
      : (p.low > LIMITS.blownLow && p.avg > LIMITS.blownAvg && p.avg > videoAvg * LIMITS.blownRatio) ? `blown out (luma ${Math.round(p.avg)} vs video ${Math.round(videoAvg)}, shadows at ${p.low})`
      : (p.high - p.low < LIMITS.flatRange) ? `flat / malformed frame (luma range ${p.high - p.low})`
      : null;
  }
  return { videoAvg, shots: per, bad: per.filter((p) => p.problem) };
}
