// CineForge style: Tall Tale 3D. Sunny 3D worlds (a main street, a shop interior, a meadow) with flat 2D cartoon people that
// always turn to face the camera: thick ink outlines, big round heads, bean bodies, stick limbs. Captions come one word at a
// time, white with a black edge. Its sets and cut-out people are imported read-only; nothing in the Tall Tale folders changes.
import { makeEngine, camera as makeCamera } from '../../../styles/tall-tale/example/src/core/engine.js';
import { mainStreet, interior, meadow } from '../../../styles/tall-tale/example/src/core/world.js';
import { Toon } from '../../../styles/tall-tale/example/src/core/toon.js';

// one character for the whole video (the style's rule: one look, all video). A man in overalls and a boater hat.
const LOOK = { body: '#3E7CC9', pattern: 'overalls', patCol: '#2B3550', hat: 'boater', hatCol: '#E8C36A', band: '#B5372E', neck: 'bowtie', neckCol: '#B5372E', extra: ['mustache'] };
const CAP = { y: 1340, size: 88, maxW: 960, stroke: 14 };
const GROUND = { street: 0.18, interior: 0, meadow: 0 };
const PERSON_FRAME = {
  'extreme-wide': { d: 3.6, y: 0.95 }, wide: { d: 2.9, y: 1.0 }, medium: { d: 2.1, y: 1.12 },
  'close-up': { d: 1.3, y: 1.42 }, 'extreme-close-up': { d: 0.85, y: 1.58 },
};
const LOOKS = {
  sunlit: {},
  'backlit-rim': { keyScale: 1.3 },
  'night-ambient': { keyScale: 0.5, hemiScale: 0.7 },
  'fire-glow': { keyScale: 1.1, bloom: 0.45 },
  'plasma-glow': { keyScale: 1.1, bloom: 0.5 },
};

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const BLINK_PERIOD = 3.4, BLINK_LEN = 0.14;
function blinkAt(t) {
  const ph = ((t % BLINK_PERIOD) + BLINK_PERIOD) % BLINK_PERIOD;
  return ph >= BLINK_LEN ? 0 : 1 - Math.abs(ph / BLINK_LEN * 2 - 1);
}

/** the scene's key and hemisphere lights, found in the graph (the set builders keep their sun in their own shape) */
function collectLights(scene) {
  let key = null, hemi = null;
  scene.traverse((o) => { if (!key && o.isDirectionalLight) key = o; if (!hemi && o.isHemisphereLight) hemi = o; });
  return { key, rim: null, hemi };
}
const BUILD = {
  street: (E) => mainStreet(E, { people: false, cars: false, dusk: false }),
  interior: (E) => interior(E, {}),
  meadow: (E) => meadow(E, {}),
};

/** one line of ink-outlined text, one word at a time, centred in the lower third */
function drawCaption(ctx, text, lt = 0, shotDur = 1) {
  const words = String(text || '').replace(/\*/g, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const i = Math.min(words.length - 1, Math.floor(Math.max(0, lt) / Math.max(0.05, shotDur) * words.length));
  const word = words[i];
  ctx.save();
  ctx.font = `900 ${CAP.size}px Inter, sans-serif`; ctx.letterSpacing = '-1px';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const x = 540, y = CAP.y;
  const sc = lt < 0.12 ? lerp(0.7, 1, ease(lt / 0.12)) : 1;
  ctx.translate(x, y); ctx.scale(sc, sc);
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
  ctx.lineWidth = CAP.stroke; ctx.strokeStyle = '#000'; ctx.strokeText(word, 0, 0);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#FFFFFF'; ctx.fillText(word, 0, 0);
  ctx.restore();
}

export const tallTale = {
  id: 'tall-tale',
  label: 'Tall Tale 3D',
  makeEngine,
  makeCamera,
  fonts: ['900 100px Inter'],
  personFrame: PERSON_FRAME,
  lookPresets: LOOKS,
  film: { aperture: 0.0008, apertureClose: 0.0015, maxblur: 0.006, bloomThreshold: 0.85, vignette: 0.12, grain: 0, warm: 0 },
  buildSet(name, E) {
    const raw = BUILD[name](E);
    return { scene: raw.scene, light: collectLights(raw.scene), update: () => {}, kind: name, ground: GROUND[name] ?? 0,
      look: { bloom: 0.25, vignette: 0.12, aperture: 0.0008 } };
  },
  isPerson() { return true; },
  makeSubject() {
    const toon = new Toon(LOOK, { height: 1.75 });
    return { root: toon.group, toon, kind: 'person' };
  },
  /** the cut-out's pose and mood for this shot; it turns to face the camera every frame */
  placeSubject(subj, shot, p, t, cam, S) {
    const k = ease(p), tt = subj.toon, blink = blinkAt(t);
    const ground = S?.ground ?? 0;
    let x = 0, z = 0, st = { mood: 'neutral', legs: 'stand', blink, talk: 0 };
    switch (shot.motion) {
      case 'approach': x = 0; z = lerp(-2.2, 0.4, k); st = { mood: 'happy', legs: 'walk', phase: p * Math.PI * 6, blink, talk: 1, armL: [30 * k, 20], armR: [30 * k, 20] }; break;
      case 'recede':   z = lerp(0.4, -2.2, k); st = { mood: 'smug', legs: 'walk', phase: p * Math.PI * 6, blink, talk: 1 }; break;
      case 'cross':    x = lerp(-1.4, 1.4, k); st = { mood: 'sly', legs: 'walk', phase: p * Math.PI * 6, blink, talk: 1, lean: 0.05 * Math.sin(p * 6) }; break;
      case 'rise':     st = { mood: 'proud', legs: 'stand', blink, talk: 1, armL: [120 * k, 30], armR: [120 * k, 30] }; break;
      case 'fall':     st = { mood: 'dizzy', legs: 'stand', blink: Math.max(blink, k), talk: 0, lean: 0.25 * k, sweat: k }; break;
      case 'impact':   st = { mood: 'shock', legs: 'jump', phase: p * 4, blink: 0, talk: 0, bob: 0.08 * Math.exp(-p * 5) * Math.abs(Math.sin(p * 18)) }; break;
      default:         st = { mood: 'neutral', legs: 'stand', blink, talk: 1, lean: 0.02 * Math.sin(p * 2) };
    }
    tt.at(x, ground, z);
    tt.set(st);
    if (cam) tt.face(cam);
    return [x, ground + 0.9, z];
  },
  drawCaption,
};
