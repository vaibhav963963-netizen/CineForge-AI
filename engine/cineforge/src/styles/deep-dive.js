// CineForge style: Deep Dive 3D. Its sets (kitchen, x-ray, and the planet world), the sculpted Human with blinks and gestures,
// the x-ray look, and the Deep Dive caption face. The Deep Dive folders are imported read-only and are not changed.
import { makeEngine, camera as makeCamera } from '../../../styles/deep-dive/example/src/core/engine.js';
import { SET_BUILDERS, PERSON_SETS, makeAsteroid, makePerson, setPersonXray } from '../scenes.js';
import { subjectAt } from '../../../../dashboard/lib/cineforge/motion.js';
import { drawCaption } from '../captions.js';

// person sets: camera distance (m) and the height of the look point (m) for each shot size. A person is ~1.7 m tall.
const PERSON_FRAME = {
  'extreme-wide': { d: 3.6, y: 0.95 }, wide: { d: 2.9, y: 1.0 }, medium: { d: 2.1, y: 1.12 },
  'close-up': { d: 1.3, y: 1.42 }, 'extreme-close-up': { d: 0.85, y: 1.58 },
};
// lighting presets: scales on the set's base lights, plus an optional coloured glow near the subject
const LOOK = {
  sunlit: {},
  'backlit-rim': { rimScale: 3.0, keyScale: 1.4 },
  'night-ambient': { keyScale: 0.35, hemiScale: 0.6 },
  'fire-glow': { glow: { color: '#ff7a2a', I: 9 }, bloom: 0.6 },
  'plasma-glow': { glow: { color: '#7fe9ff', I: 9 }, bloom: 0.7 },
};

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
// blinking is a function of the film time, so it is the same on every render: a quick close every 3.2 s
const BLINK_PERIOD = 3.2, BLINK_LEN = 0.16;
function blinkAt(t) {
  const ph = ((t % BLINK_PERIOD) + BLINK_PERIOD) % BLINK_PERIOD;
  if (ph >= BLINK_LEN) return 0;
  return 1 - Math.abs(ph / BLINK_LEN * 2 - 1);   // 0 → 1 → 0 across the blink
}
/**
 * a person's pose for the shot's motion at progress p, at film time t (Deep Dive pose conventions, degrees).
 * Gestures: hands together (approach), a wave (cross), a hand to the throat (impact), a hand on the chest (rise),
 * limp arms (fall). Eyes look toward the camera, or up at the thing they are thinking about. Blinks are added on top.
 */
function poseHuman(h, motion, p, t = 0) {
  h.pose({});
  h.parts[0].scale.set(1, 1, 1);
  const k = ease(p), blink = blinkAt(t);
  let q;
  switch (motion) {
    case 'rise':     // breathes in: the chest lifts, a hand rests on the chest
      h.parts[0].scale.set(1 + 0.03 * k, 1 + 0.012 * k, 1 + 0.08 * k);
      q = { head: [-4 * k, 0, 0], shR: [22 * k, 0, -18 * k], elR: 85 * k, shL: [0, 0, 8], look: [0, -4 * k] }; break;
    case 'fall':     // faints: the spine folds, the head drops, the arms go limp, the eyes close
      q = { spine: [10 * k, 0, 0], head: [14 * k, -6 * k, 0], shL: [-10 * k, 0, 20 * k], shR: [-10 * k, 0, 20 * k], elL: 10, elR: 10, lid: 1.05 * k }; break;
    case 'impact':   // a jolt that dies away, a hand goes to the throat, the eyes go up
      q = { spine: [-6 * Math.exp(-p * 6) * Math.sin(p * 30), 0, 0], head: [-4 * Math.exp(-p * 5) * Math.sin(p * 28), 0, 0],
        shR: [55 * k, 0, -22 * k], elR: 105 * k, look: [0, -14 * k] }; break;
    case 'approach': // leans in, hands come together in front
      q = { head: [0, -10 * k, 0], spine: [-3 * k, 0, 0], shL: [34 * k, 0, 12 * k], elL: 70 * k, shR: [34 * k, 0, -12 * k], elR: 70 * k }; break;
    case 'recede':   q = { head: [0, 10 * k, 0] }; break;
    case 'cross':    // turns, waves with the right hand
      q = { head: [0, 14 * Math.sin(p * Math.PI), 0], spine: [0, 0, 6 * Math.sin(p * Math.PI)], shR: [0, 0, 62 * k], elR: 28 + 26 * Math.sin(p * 14) }; break;
    default:         q = { head: [2 * Math.sin(p * 2), 0, 0] };   // stay: a slight idle sway
  }
  q.lid = Math.max(q.lid ?? 0, blink);   // blink on top of any closing of the eyes
  h.pose(q);
}

export const deepDive = {
  id: 'deep-dive',
  label: 'Deep Dive 3D',
  makeEngine,
  makeCamera,
  fonts: ['900 100px Inter'],   // the caption face (loaded from the Deep Dive fonts folder by index.html)
  personFrame: PERSON_FRAME,
  lookPresets: LOOK,
  film: { aperture: 0.0015, apertureClose: 0.004, maxblur: 0.01, bloomThreshold: 0.85, vignette: 0.35, grain: 0.025, warm: 0.03 },
  buildSet(name, E) { return SET_BUILDERS[name](E); },
  isPerson(setName) { return PERSON_SETS.has(setName); },
  /** a person (one Human per identity) in person sets, a rock elsewhere. The same identity is the same object across sets. */
  makeSubject(setName, id) {
    if (this.isPerson(setName)) { const h = makePerson(); return { root: h.group, human: h, kind: 'person' }; }
    return { root: makeAsteroid(id), kind: 'object' };
  },
  /** set the subject's pose / position for this shot; returns its centre point (used for the framing and the glow) */
  placeSubject(subj, shot, p, t) {
    if (subj.kind === 'person') {
      setPersonXray(subj.human, shot.set === 'xray');
      poseHuman(subj.human, shot.motion, p, t);
      subj.root.position.set(0, 0, 0);
      return [0, 1, 0];
    }
    const st = subjectAt(shot.motion, p);
    subj.root.position.set(...st.pos); subj.root.rotation.set(...st.rot);
    return st.pos;
  },
  drawCaption,
};
