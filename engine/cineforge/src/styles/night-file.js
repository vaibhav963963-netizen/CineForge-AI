// CineForge style: Night File 3D. Dark real 3D places with one light, faceless people (Night File's own Human, face: false),
// the subject glowing solid red, a typewriter caption face with one red word, and a slow, grainy film look.
// Its sets (corridor, house, case wall) and figure are imported read-only; nothing in the Night File folders is changed.
import * as THREE from 'three';
import { makeEngine, camera as makeCamera } from '../../../styles/night-file/example/src/core/engine.js';
import { Human } from '../../../styles/night-file/example/src/core/human.js';
import { subjectMat, corridor, houseNight, caseWall } from '../../../styles/night-file/example/src/core/sets3d.js';

const RED = '#E4322B', BONE = '#F2F2F2', CAP = { y: 1400, size: 118, maxW: 900, stroke: 10 };
const PERSON_FRAME = {
  'extreme-wide': { d: 3.6, y: 0.95 }, wide: { d: 2.9, y: 1.0 }, medium: { d: 2.1, y: 1.12 },
  'close-up': { d: 1.3, y: 1.42 }, 'extreme-close-up': { d: 0.85, y: 1.58 },
};
// lighting presets: Night File has ONE light per scene, so the presets only dim it, or add the subject's red glow
const LOOK = {
  sunlit: {},
  'backlit-rim': { keyScale: 1.2 },
  'night-ambient': { keyScale: 0.55 },
  'fire-glow': { glow: { color: RED, I: 6 }, bloom: 0.7 },
  'plasma-glow': { glow: { color: RED, I: 8 }, bloom: 0.8 },
};
// where the person stands in each set (the case wall is a board at z = 0, so the person stands in front of it)
const OFFSET = { corridor: [0, 0, 0], house: [0, 0, 0], casewall: [0, 0, 1.2] };

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

/** the case wall's photos: dark stills with a red figure (drawn here, so the set needs no image files) */
function photos() {
  return [0, 1, 2, 3, 4].map((i) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#0c0d10'; g.fillRect(0, 0, 256, 300);
    const grd = g.createRadialGradient(128, 110, 10, 128, 110, 130); grd.addColorStop(0, 'rgba(228,50,43,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 300);
    g.fillStyle = i % 2 ? '#3a0d0b' : '#2a0604'; g.beginPath(); g.ellipse(128, 120, 14 + i * 2, 42, 0, 0, Math.PI * 2); g.fill(); g.fillRect(104, 150, 48, 110);
    return c;
  });
}
/** the first spot (the lamp) and the hemisphere light of a set, found in the scene graph (the set builders do not return them all) */
function collectLights(scene) {
  let key = null, hemi = null;
  scene.traverse((o) => { if (!key && (o.isSpotLight || o.isDirectionalLight)) key = o; if (!hemi && o.isHemisphereLight) hemi = o; });
  return { key, rim: null, hemi };
}

const BUILDERS = { corridor: () => corridor(), house: () => houseNight(), casewall: () => caseWall(photos()) };

/** draws a caption in the typewriter face, the words in bone with the "*" word in Night File red, on a dark shadow */
function drawCaption(ctx, text, lt = 1) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).map((w) => ({ txt: w.replace(/\*/g, ''), hi: w.includes('*') }));
  if (!words.length) return;
  const size = CAP.size, sp = size * 0.22;
  ctx.save();
  ctx.font = `bold ${size}px CineMono, monospace`; ctx.letterSpacing = '0px';
  words.forEach((w) => (w.w = ctx.measureText(w.txt).width));
  const width = (ws) => ws.reduce((a, w) => a + w.w, 0) + sp * (ws.length - 1);
  let lines = [words];
  if (width(words) > CAP.maxW && words.length > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) { const a = words.slice(0, i), b = words.slice(i), m = Math.max(width(a), width(b)); if (!best || m < best.m) best = { m, l: [a, b] }; }
    lines = best.l;
  }
  const fit = Math.min(1, CAP.maxW / Math.max(...lines.map(width)));
  const pop = lt < 0.2 ? 0.8 + 0.2 * Math.min(1, lt / 0.2) : 1;
  ctx.translate(540, CAP.y); ctx.scale(pop * fit, pop * fit);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
  const lh = size, y0 = -(lines.length - 1) * lh / 2;
  lines.forEach((ln, li) => {
    let x = -width(ln) / 2; const y = y0 + li * lh;
    for (const w of ln) {
      ctx.lineWidth = CAP.stroke; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(w.txt, x + 4, y + 6); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(w.txt, x + 4, y + 6);
      ctx.fillStyle = w.hi ? RED : BONE; ctx.fillText(w.txt, x, y);
      x += w.w + sp;
    }
  });
  ctx.restore();
}

export const nightFile = {
  id: 'night-file',
  label: 'Night File 3D',
  makeEngine,
  makeCamera,
  fonts: ['bold 100px CineMono'],   // the typewriter face (FreeMonoBold, loaded by index.html)
  personFrame: PERSON_FRAME,
  lookPresets: LOOK,
  film: { aperture: 0.0025, apertureClose: 0.0035, maxblur: 0.012, bloomThreshold: 0.55, vignette: 0.55, grain: 0.05, warm: 0 },
  /** each set: { scene, light, update(t), look } — the sets are Night File's own, one light per scene */
  buildSet(name) {
    const raw = BUILDERS[name]();
    return { scene: raw.scene, light: collectLights(raw.scene), update: raw.update || (() => {}), kind: name,
      look: { bloom: 0.5, bloomThreshold: 0.55, vignette: 0.55, aperture: 0.0025 } };
  },
  /** every person is a faceless Night File figure; the subject is solid red (subjectMat) */
  isPerson() { return true; },
  makeSubject() {
    const h = new Human({ face: false });
    const m = subjectMat(2.2);
    h.setAllMaterial(m);
    return { root: h.group, human: h, kind: 'person', mat: m };
  },
  /** the figure's motion for this shot. Walks toward or away from the camera, stands, collapses or jolts. */
  placeSubject(subj, shot, p) {
    const h = subj.human, k = ease(p), off = OFFSET[shot.set] || [0, 0, 0];
    const walk = p * Math.PI * 3;   // a step cycle across the shot
    let x = 0, z = 0;
    switch (shot.motion) {
      case 'approach': h.walk(walk, 1); z = lerp(-2.2, 0.2, k); break;          // walks toward the camera
      case 'recede':   h.walk(walk, 1); z = lerp(0.2, -2.2, k); break;          // walks away from it
      case 'cross':    h.walk(walk, 1); x = lerp(-1.2, 1.2, k); break;          // walks across the frame
      case 'rise':     h.pose({ head: [-8 * k, 0, 0], shL: [0, 0, 4 + 4 * k], shR: [0, 0, 4 + 4 * k] }); break;   // lifts the head
      case 'fall':     h.pose({ spine: [14 * k, 0, 0], head: [18 * k, -6 * k, 0], knL: 26 * k, knR: 26 * k, shL: [-8 * k, 0, 16 * k], shR: [-8 * k, 0, 16 * k] }); break;   // collapses
      case 'impact':   h.pose({ spine: [-6 * Math.exp(-p * 6) * Math.sin(p * 30), 0, 0], head: [-4 * Math.exp(-p * 5) * Math.sin(p * 28), 0, 0] }); break;   // a jolt
      default:         h.pose({ head: [2 * Math.sin(p * 2), 0, 0] });           // stands still, a slight sway
    }
    subj.root.position.set(off[0] + x, 0, off[2] + z);
    return [off[0] + x, 1, off[2] + z];
  },
  drawCaption,
};
