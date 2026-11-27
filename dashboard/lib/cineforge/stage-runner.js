// CineForge stage 2c runner (browser). Loads a plan, renders each requested time, and measures the REAL pixels:
//   std              luma spread over the frame (blank-frame check)
//   changedFraction  share of pixels whose luma moved by more than CHANGE_LEVEL since the previous frame (motion check)
//   diffFromPrev     mean absolute luma change (kept for reference; it is diluted by the empty frame, so not used for motion)
// It reports numbers only; it never assigns a quality score.
import { createStage, renderAt } from './stage-renderer.js';

export const CHANGE_LEVEL = 16;   // luma step (0–255) that counts as a changed pixel

function pixelStats(canvas, prev) {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  ctx.canvas.width = canvas.width; ctx.canvas.height = canvas.height;
  ctx.drawImage(canvas, 0, 0);
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0, sq = 0, n = 0;
  const cur = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    cur[j] = l; sum += l; sq += l * l; n++;
  }
  const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
  let diff = null, changed = null;
  if (prev && prev.length === cur.length) {
    let acc = 0, moved = 0;
    for (let j = 0; j < cur.length; j++) {
      const delta = Math.abs(cur[j] - prev[j]);
      acc += delta;
      if (delta > CHANGE_LEVEL) moved++;
    }
    diff = acc / cur.length;
    changed = moved / cur.length;
  }
  return {
    mean: +mean.toFixed(2), std: +std.toFixed(2),
    // raw values, not rounded: an exact repeat must be recognisable (0 means identical pixels)
    diffFromPrev: diff,
    changedFraction: changed,
    luma: cur,
  };
}

/**
 * plan: { width, height, shots, times: number[], frameUpload?: url }.
 * If frameUpload is set, each frame is sent to it as JPEG (used by the video tool to write the image sequence).
 * Returns { frames: [...] } with measurements only, never the raw pixels.
 */
export async function runPlan(canvas, plan) {
  const stage = createStage(canvas, { width: plan.width, height: plan.height });
  const frames = [];
  let prev = null;
  for (const [i, t] of plan.times.entries()) {
    const state = renderAt(stage, plan.shots, t);
    const px = pixelStats(canvas, prev && prev.luma);
    prev = px;
    if (plan.frameUpload) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      await fetch(`${plan.frameUpload}?i=${i}`, { method: 'POST', body: blob });
    }
    frames.push({ t, shotId: state ? state.shotId : null, camera: state ? state.camera : null, subject: state ? state.subject : null, screen: state ? state.screen : null, mean: px.mean, std: px.std, diffFromPrev: px.diffFromPrev, changedFraction: px.changedFraction });
  }
  return { frames };
}
