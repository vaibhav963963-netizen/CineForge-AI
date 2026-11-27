// CineForge runtime. Reads the CineForge plan (plan.json) and the visual style (?style=…), and for each frame time:
//   1. finds the active shot and places its set and subject. A subject keeps its identity when the set changes,
//   2. applies the shot's camera (framing and move from motion.js), lighting, effect, and the style's pose or motion,
//   3. renders through the style's film engine (tone map, soft shadows, bloom, depth of field, vignette, grain),
//   4. composes the transition (cut, dissolve, fade-black), draws the style's caption, and measures the composed pixels.
// The style supplies its sets, subjects, poses, look and caption (engine/cineforge/src/styles/). The style folders it
// imports are read-only and are not changed. It reports measurements only; it never assigns a quality score.
import * as THREE from 'three';
import { cameraAt } from '../../../dashboard/lib/cineforge/motion.js';
import { buildEffect } from './scenes.js';
import { getStyle } from './styles/index.js';

const STYLE = getStyle(new URLSearchParams(location.search).get('style') || 'deep-dive');
const { RES, W, H } = { RES: +(new URLSearchParams(location.search).get('res') || 1), W: 1080, H: 1920 };
const TRANSITION_S = 0.4;
const CHANGE_LEVEL = 16;

const GL = document.getElementById('gl'), CV = document.getElementById('cv');
GL.width = Math.round(W * RES); GL.height = Math.round(H * RES);
const out = CV.getContext('2d', { willReadFrequently: true });
const snap = document.createElement('canvas'); snap.width = W; snap.height = H; const snapCtx = snap.getContext('2d');

let E = null, cam = null, plan = null;
const sets = {};            // set name → { scene, light, base, look, glow, update, kind }
const subjects = new Map(); // identity → subject (one per identity; moved between sets)
const effects = new Map();  // shotId → { set, fx }

function getSet(name) {
  if (!sets[name]) {
    const S = STYLE.buildSet(name, E);
    S.base = { key: S.light.key?.intensity ?? 1, rim: S.light.rim?.intensity ?? 0, hemi: S.light.hemi?.intensity ?? 0.5 };
    sets[name] = S;
  }
  return sets[name];
}
/** the subject for a shot. Same identity → same object across sets (a person stays the same person when the set changes). */
function getSubject(shot) {
  const key = `${STYLE.isPerson(shot.set) ? 'person' : 'object'}:${shot.subjectId}`;
  if (!subjects.has(key)) subjects.set(key, STYLE.makeSubject(shot.set, shot.subjectId));
  return subjects.get(key);
}
function getEffect(shot, S) {
  if (!shot.effect || shot.effect === 'none') return null;
  if (!effects.has(shot.id)) {
    const fx = buildEffect(shot.effect, shot.id);
    if (fx) { fx.group.visible = false; S.scene.add(fx.group); effects.set(shot.id, { set: shot.set, fx }); }
  }
  return effects.get(shot.id) || null;
}

/** the shot active at tSec: the last one that started (a shot covers start <= t < end) */
export function shotAt(shots, tSec) {
  let active = null;
  for (const s of shots) if (tSec >= s.start - 1e-9) active = s;
  return active && tSec <= active.end + 1e-9 ? active : null;
}
function applyLook(S, name, subjPos) {
  const L = STYLE.lookPresets[name];
  if (!L) throw new Error(`unknown lighting "${name}" for style ${STYLE.id}`);
  if (S.light.key) S.light.key.intensity = S.base.key * (L.keyScale ?? 1);
  if (S.light.rim) S.light.rim.intensity = S.base.rim * (L.rimScale ?? 1);
  if (S.light.hemi) S.light.hemi.intensity = S.base.hemi * (L.hemiScale ?? 1);
  if (L.glow) {
    if (!S.glow) { S.glow = new THREE.PointLight(0xffffff, 0, 16, 1.4); S.scene.add(S.glow); }
    S.glow.color.set(L.glow.color); S.glow.intensity = L.glow.I;
    S.glow.position.set(subjPos[0], subjPos[1] + 0.6, subjPos[2] + 1.8);
  } else if (S.glow) S.glow.intensity = 0;
  return L;
}

/** render the frame at time t into the film canvas (WebGL), without the transition */
function renderShot(t) {
  const shot = shotAt(plan.shots, t);
  const S = getSet(shot ? shot.set : plan.shots[0].set);
  for (const e of effects.values()) e.fx.group.visible = false;
  if (S.update) S.update(t);                    // a set's own motion (a flickering lamp, a moving door)
  if (!shot) { E.render(S.scene, cam, {}); return { shotId: null, set: S.kind }; }
  const subj = getSubject(shot);
  S.scene.add(subj.root);                       // moves the object into this set (Object3D.add removes it from the old set)
  const p = Math.max(0, Math.min(1, (t - shot.start) / Math.max(1e-6, shot.end - shot.start)));
  const person = subj.kind === 'person';
  const c = cameraAt(shot.camera, p, shot.shotSize || 'medium');
  // person framing: the shot size sets the distance and the height of the look point (a close-up holds the head and
  // shoulders); the camera move (push, track, orbit, crane) changes the direction and the distance around that frame
  let look = c.look, camPos = c.pos;
  if (person) {
    const F = STYLE.personFrame[shot.shotSize] || STYLE.personFrame.medium;
    look = [0, F.y, 0];
    const off = [c.pos[0] - c.look[0], c.pos[1] - c.look[1], c.pos[2] - c.look[2]];
    const len = Math.hypot(...off) || 1;
    const dist = F.d * (len / 9);   // cameraAt's distances are ~9 units; a push shortens the distance, a pull lengthens it
    camPos = [dist * off[0] / len, F.y + dist * off[1] / len, dist * off[2] / len];
  }
  cam.position.set(...camPos); cam.lookAt(...look); cam.fov = c.fov; cam.updateProjectionMatrix();
  const subjPos = STYLE.placeSubject(subj, shot, p, t);
  const L = applyLook(S, shot.lighting || 'sunlit', subjPos);
  if (!person && subj.root.userData.mat) subj.root.userData.mat.emissiveIntensity = L.glow ? 0.9 : 0.04;
  const fxRec = getEffect(shot, S);
  if (fxRec) { fxRec.fx.group.visible = true; fxRec.fx.update(p, subjPos); }
  const dist = Math.hypot(camPos[0] - subjPos[0], camPos[1] - subjPos[1], camPos[2] - subjPos[2]);
  const close = shot.shotSize === 'close-up' || shot.shotSize === 'extreme-close-up';
  const film = STYLE.film, sl = S.look || {};
  E.render(S.scene, cam, {
    bloom: L.bloom ?? sl.bloom ?? 0.3, bloomThreshold: sl.bloomThreshold ?? film.bloomThreshold, focus: dist,
    aperture: close ? film.apertureClose : (sl.aperture ?? film.aperture), maxblur: film.maxblur,
    vignette: sl.vignette ?? film.vignette, grain: film.grain, warm: film.warm,
  });
  return { shotId: shot.id, set: shot.set, shot, p, camera: { pos: camPos, look, fov: c.fov }, subject: { id: shot.subjectId, pos: subjPos }, effect: shot.effect, lighting: shot.lighting };
}

/** render frame t and compose it into the output (transition, caption), returns the render state */
export function drawFrame(t) {
  const shot = shotAt(plan.shots, t);
  const i = shot ? plan.shots.indexOf(shot) : -1, before = i > 0 ? plan.shots[i - 1] : null;
  const into = shot ? t - shot.start : Infinity;
  const st = renderShot(t);
  out.globalAlpha = 1; out.fillStyle = '#000';
  out.drawImage(GL, 0, 0, W, H);
  if (shot && before && into < TRANSITION_S && shot.transition === 'dissolve') {
    renderShot(before.end - 1e-3);
    snapCtx.clearRect(0, 0, W, H); snapCtx.drawImage(GL, 0, 0, W, H);
    renderShot(t);
    out.drawImage(GL, 0, 0, W, H);
    out.globalAlpha = 1 - into / TRANSITION_S; out.drawImage(snap, 0, 0, W, H); out.globalAlpha = 1;
  } else if (shot && before && into < TRANSITION_S && shot.transition === 'fade-black') {
    out.globalAlpha = 1 - into / TRANSITION_S; out.fillRect(0, 0, W, H); out.globalAlpha = 1;
  }
  if (shot && shot.caption) STYLE.drawCaption(out, shot.caption, into);
  return st;
}

function measure(prev) {
  const d = out.getImageData(0, 0, W, H).data, n = W * H;
  const luma = new Uint8ClampedArray(n);
  let sum = 0, sq = 0;
  for (let i = 0, j = 0; j < n; i += 4, j++) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; luma[j] = l; sum += l; sq += l * l; }
  const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
  let diff = null, changed = null;
  if (prev && prev.length === n) { let acc = 0, moved = 0; for (let j = 0; j < n; j++) { const dl = Math.abs(luma[j] - prev[j]); acc += dl; if (dl > CHANGE_LEVEL) moved++; } diff = acc / n; changed = moved / n; }
  return { luma, std: +std.toFixed(2), mean: +mean.toFixed(2), diffFromPrev: diff, changedFraction: changed };
}

/** render every planned frame, upload each composed JPEG to uploadUrl, and return the per-frame measurements */
export async function runAll(times, uploadUrl) {
  const frames = []; let prev = null;
  for (const [i, t] of times.entries()) {
    const st = drawFrame(t);
    const px = measure(prev);
    prev = px.luma;
    if (uploadUrl) {
      const blob = await new Promise((resolve) => CV.toBlob(resolve, 'image/jpeg', 0.92));
      await fetch(`${uploadUrl}?i=${i}`, { method: 'POST', body: blob });
    }
    frames.push({ t, shotId: st.shotId, set: st.set, effect: st.effect || null, lighting: st.lighting || null, subject: st.subject || null,
      camera: st.camera ? { pos: st.camera.pos, fov: st.camera.fov } : null, std: px.std, mean: px.mean, diffFromPrev: px.diffFromPrev, changedFraction: px.changedFraction });
  }
  return { frames };
}

(async () => {
  const pre = document.getElementById('out');
  try {
    for (const f of STYLE.fonts) await document.fonts.load(f);   // the style's caption face (loaded by index.html)
    plan = await (await fetch('plan.json', { cache: 'no-store' })).json();
    if (plan.style && plan.style !== STYLE.id) throw new Error(`the plan is for style "${plan.style}" but the page is "${STYLE.id}"`);
    E = STYLE.makeEngine(GL, { w: GL.width, h: GL.height, samples: 4 });
    cam = STYLE.makeCamera(50);
    window.OP = { ready: true, runAll, drawFrame };
    const result = await runAll(plan.times, '/frame');
    pre.textContent = JSON.stringify(result);
  } catch (e) {
    pre.textContent = JSON.stringify({ error: String(e && e.stack || e) });
  }
})();
