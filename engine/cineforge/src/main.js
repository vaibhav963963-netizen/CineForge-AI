// CineForge runtime on the Deep Dive 3D engine. Reads the CineForge plan (plan.json), and for each frame time:
//   1. finds the active shot and places its subject in that shot's set. A person (kitchen, xray) is one Deep Dive Human and
//      an object (space, atmosphere, ground) is one rock; each keeps its identity when the set changes,
//   2. applies the shot's camera (framing and move from motion.js), lighting, effect, pose or motion, and the x-ray look,
//   3. renders through the Deep Dive film engine (ACES, soft shadows, bloom, depth of field, vignette, grain),
//   4. composes the transition (cut, dissolve, fade-black), draws the caption in the Deep Dive style, and measures the pixels.
// It reports measurements only. The Deep Dive folders are imported read-only and are not changed.
import * as THREE from 'three';
import { makeEngine, camera as makeCamera, W, H, RES, AA } from '../../styles/deep-dive/example/src/core/engine.js';
import { cameraAt, subjectAt } from '../../../dashboard/lib/cineforge/motion.js';
import { SET_BUILDERS, PERSON_SETS, makeAsteroid, makePerson, setPersonXray, buildEffect } from './scenes.js';
import { drawCaption } from './captions.js';

const TRANSITION_S = 0.4;
const CHANGE_LEVEL = 16;
const PERSON_FRAMING = 0.22;   // person sets: the camera comes in close (a person is ~1.7 m tall; the asteroid framing is ~9 m)
// lighting presets: scales on the set's base lights, plus an optional coloured glow near the subject
const LOOK = {
  sunlit: {},
  'backlit-rim': { rimScale: 3.0, keyScale: 1.4 },
  'night-ambient': { keyScale: 0.35, hemiScale: 0.6 },
  'fire-glow': { glow: { color: '#ff7a2a', I: 9 }, bloom: 0.6 },
  'plasma-glow': { glow: { color: '#7fe9ff', I: 9 }, bloom: 0.7 },
};

const GL = document.getElementById('gl'), CV = document.getElementById('cv');
GL.width = Math.round(W * RES); GL.height = Math.round(H * RES);
const out = CV.getContext('2d', { willReadFrequently: true });
const snap = document.createElement('canvas'); snap.width = W; snap.height = H; const snapCtx = snap.getContext('2d');

let E = null, cam = null, plan = null;
const sets = {};            // set name → { scene, light, base, look, glow, kind }
const subjects = new Map(); // identity → { root, kind } (a person or a rock; one per identity, moved between sets)
const effects = new Map();  // shotId → { set, fx }

function getSet(name) {
  if (!sets[name]) {
    const S = SET_BUILDERS[name](E);
    S.base = { key: S.light.key?.intensity ?? 1, rim: S.light.rim?.intensity ?? 0, hemi: S.light.hemi?.intensity ?? 0.5 };
    sets[name] = S;
  }
  return sets[name];
}
/** the subject for a shot: a person in a person set, a rock elsewhere. Same identity → same object across sets. */
function getSubject(shot) {
  const person = PERSON_SETS.has(shot.set);
  const key = `${person ? 'person' : 'object'}:${shot.subjectId}`;
  if (!subjects.has(key)) {
    if (person) { const h = makePerson(); subjects.set(key, { root: h.group, human: h, kind: 'person' }); }
    else subjects.set(key, { root: makeAsteroid(shot.subjectId), kind: 'object' });
  }
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
  const L = LOOK[name];
  if (!L) throw new Error(`unknown lighting "${name}"`);
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

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** a person's pose for the shot's motion at progress p (Deep Dive pose conventions, degrees) */
function poseHuman(h, motion, p) {
  h.pose({});
  h.parts[0].scale.set(1, 1, 1);
  const k = ease(p);
  switch (motion) {
    case 'rise':     // breathes in: the chest lifts, the head tilts back a little
      h.parts[0].scale.set(1 + 0.03 * k, 1 + 0.012 * k, 1 + 0.08 * k);
      h.pose({ head: [-4 * k, 0, 0], shL: [0, 0, 6 + 6 * k], shR: [0, 0, 6 + 6 * k] }); break;
    case 'fall':     // faints: the spine folds, the head drops, the eyes close
      h.pose({ spine: [10 * k, 0, 0], head: [14 * k, -6 * k, 0], lid: 1.05 * k }); break;
    case 'impact':   // a jolt that dies away
      h.pose({ spine: [-6 * Math.exp(-p * 6) * Math.sin(p * 30), 0, 0], head: [-4 * Math.exp(-p * 5) * Math.sin(p * 28), 0, 0] }); break;
    case 'approach': h.pose({ head: [0, -10 * k, 0], spine: [-3 * k, 0, 0] }); break;
    case 'recede':   h.pose({ head: [0, 10 * k, 0] }); break;
    case 'cross':    h.pose({ head: [0, 14 * Math.sin(p * Math.PI), 0], spine: [0, 0, 6 * Math.sin(p * Math.PI)] }); break;
    default:         h.pose({ head: [2 * Math.sin(p * 2), 0, 0] });   // stay: a slight idle sway
  }
}

/** render the frame at time t into the film canvas (WebGL), without the transition */
function renderShot(t) {
  const shot = shotAt(plan.shots, t);
  const S = getSet(shot ? shot.set : plan.shots[0].set);
  for (const e of effects.values()) e.fx.group.visible = false;
  if (!shot) { E.render(S.scene, cam, {}); return { shotId: null, set: S.kind }; }
  const subj = getSubject(shot);
  S.scene.add(subj.root);                       // moves the object into this set (Object3D.add removes it from the old set)
  const p = Math.max(0, Math.min(1, (t - shot.start) / Math.max(1e-6, shot.end - shot.start)));
  const person = subj.kind === 'person';
  // the framing and camera move come from motion.js; person sets bring the camera in to the person's scale
  const c = cameraAt(shot.camera, p, shot.shotSize || 'medium');
  // person sets: the look target stays on the person's centre and the camera moves around it (a track is a sideways move
  // around the person, not a pan away from them); the offset from the centre is scaled to the person's size
  const look = person ? [0, 1, 0] : c.look;
  const camPos = person ? c.pos.map((v, i) => look[i] + (v - c.look[i]) * PERSON_FRAMING) : c.pos;
  cam.position.set(...camPos); cam.lookAt(...look); cam.fov = c.fov; cam.updateProjectionMatrix();
  let subjPos;
  if (person) {
    setPersonXray(subj.human, shot.set === 'xray');
    poseHuman(subj.human, shot.motion, p);
    subjPos = [0, 1, 0];
    subj.root.position.set(0, 0, 0);
  } else {
    const st = subjectAt(shot.motion, p);
    subj.root.position.set(...st.pos); subj.root.rotation.set(...st.rot);
    subjPos = st.pos;
    subj.root.userData.mat.emissiveIntensity = 0.04;
  }
  const L = applyLook(S, shot.lighting || 'sunlit', subjPos);
  if (!person && L.glow) subj.root.userData.mat.emissiveIntensity = 0.9;
  const fxRec = getEffect(shot, S);
  if (fxRec) { fxRec.fx.group.visible = true; fxRec.fx.update(p, subjPos); }
  const dist = Math.hypot(camPos[0] - subjPos[0], camPos[1] - subjPos[1], camPos[2] - subjPos[2]);
  const close = shot.shotSize === 'close-up' || shot.shotSize === 'extreme-close-up';
  const sl = S.look || {};
  E.render(S.scene, cam, {
    bloom: L.bloom ?? sl.bloom ?? 0.3, bloomThreshold: sl.bloomThreshold ?? 0.85, focus: dist,
    aperture: close ? 0.004 : (sl.aperture ?? 0.0015), maxblur: 0.01, vignette: sl.vignette ?? 0.35, grain: 0.025, warm: 0.03,
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
  if (shot && shot.caption) drawCaption(out, shot.caption, into);
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
    await document.fonts.load('900 100px Inter');   // the Deep Dive caption face (loaded from the Deep Dive fonts folder)
    plan = await (await fetch('plan.json', { cache: 'no-store' })).json();
    E = makeEngine(GL, { w: GL.width, h: GL.height, samples: AA });
    cam = makeCamera(50);
    window.OP = { ready: true, runAll, drawFrame };
    const result = await runAll(plan.times, '/frame');
    pre.textContent = JSON.stringify(result);
  } catch (e) {
    pre.textContent = JSON.stringify({ error: String(e && e.stack || e) });
  }
})();
