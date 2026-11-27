// CineForge stage 2c runner (browser). Loads a plan, renders each requested time, composes the transitions between shots,
// and measures the REAL pixels of the composed frame:
//   std              luma spread over the frame (blank-frame check)
//   changedFraction  share of pixels whose luma moved by more than CHANGE_LEVEL since the previous frame (motion check)
//   diffFromPrev     mean absolute luma change (reference only)
// Transitions: 'cut' (no blend), 'dissolve' (previous shot cross-fades into this one), 'fade-black' (fades through black).
// It reports numbers only; it never assigns a quality score.
import { createStage, renderAt, shotAt } from './stage-renderer.js';

export const CHANGE_LEVEL = 16;        // luma step (0–255) that counts as a changed pixel
export const TRANSITION_S = 0.4;       // length of a dissolve or fade at the start of a shot

function lumaOf(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const luma = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) luma[j] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return luma;
}

function pixelStats(out, prev) {
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const cur = lumaOf(ctx, out.width, out.height);
  let sum = 0, sq = 0;
  for (let j = 0; j < cur.length; j++) { sum += cur[j]; sq += cur[j] * cur[j]; }
  const n = cur.length, mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
  let diff = null, changed = null;
  if (prev && prev.length === cur.length) {
    let acc = 0, moved = 0;
    for (let j = 0; j < cur.length; j++) {
      const delta = Math.abs(cur[j] - prev[j]);
      acc += delta;
      if (delta > CHANGE_LEVEL) moved++;
    }
    diff = acc / n;
    changed = moved / n;
  }
  return {
    mean: +mean.toFixed(2), std: +std.toFixed(2),
    // raw values, not rounded: an exact repeat must be recognisable (0 means identical pixels)
    diffFromPrev: diff, changedFraction: changed,
    luma: cur,
  };
}

/** The shot before the given one in the plan, or null for the first shot. */
function previousShot(shots, shot) {
  const i = shots.indexOf(shot);
  return i > 0 ? shots[i - 1] : null;
}

/**
 * plan: { width, height, shots, times: number[], frameUpload?: url }.
 * If frameUpload is set, each composed frame is sent to it as JPEG (used by the video tool to write the image sequence).
 * Returns { frames: [...] } with measurements only, never the raw pixels.
 */
export async function runPlan(glCanvas, plan) {
  const stage = createStage(glCanvas, { width: plan.width, height: plan.height });
  const out = document.createElement('canvas');
  out.width = plan.width; out.height = plan.height;
  const outCtx = out.getContext('2d');
  const snap = document.createElement('canvas');   // holds the previous shot while a dissolve is composed
  snap.width = plan.width; snap.height = plan.height;
  const snapCtx = snap.getContext('2d');

  const frames = [];
  let prev = null;
  for (const [i, t] of plan.times.entries()) {
    const shot = shotAt(plan.shots, t);
    const before = shot ? previousShot(plan.shots, shot) : null;
    const into = shot ? t - shot.start : Infinity;
    let state;
    outCtx.globalAlpha = 1;
    outCtx.fillStyle = '#000';
    state = renderAt(stage, plan.shots, t);
    outCtx.drawImage(glCanvas, 0, 0);
    if (shot && before && into < TRANSITION_S && shot.transition === 'dissolve') {
      // the previous shot, as it ends, cross-fades out while this shot fades in
      renderAt(stage, plan.shots, before.end - 1e-3);
      snapCtx.clearRect(0, 0, snap.width, snap.height);
      snapCtx.drawImage(glCanvas, 0, 0);
      renderAt(stage, plan.shots, t);
      outCtx.drawImage(glCanvas, 0, 0);
      const a = into / TRANSITION_S;
      outCtx.globalAlpha = 1 - a;
      outCtx.drawImage(snap, 0, 0);
      outCtx.globalAlpha = 1;
    } else if (shot && before && into < TRANSITION_S && shot.transition === 'fade-black') {
      const a = into / TRANSITION_S;
      outCtx.globalAlpha = 1 - a;
      outCtx.fillRect(0, 0, out.width, out.height);
      outCtx.globalAlpha = 1;
    }

    const px = pixelStats(out, prev && prev.luma);
    prev = px;
    if (plan.frameUpload) {
      const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.92));
      await fetch(`${plan.frameUpload}?i=${i}`, { method: 'POST', body: blob });
    }
    frames.push({
      t, shotId: state ? state.shotId : null, camera: state ? state.camera : null, subject: state ? state.subject : null,
      screen: state ? state.screen : null, effect: state ? state.effect : null, lighting: state ? state.lighting : null,
      transition: shot ? shot.transition : null,
      mean: px.mean, std: px.std, diffFromPrev: px.diffFromPrev, changedFraction: px.changedFraction,
    });
  }
  return { frames };
}
