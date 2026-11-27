// CineForge stage 2b: renderer-agnostic keyframe evaluation. Given a shot and a time, returns the camera and the main
// subject's transform. Three.js (next step) applies these numbers; this file has no browser or GPU dependency, so it is
// testable in Node. Every move is a closed enum from narrative-analyzer.js, never free text.
import { CAMERA_MOVES, MOTIONS } from './narrative-analyzer.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = (t) => t * t * t;

// Camera keyframes: [from, to] for position, look-at and field of view, interpolated over the shot.
const CAM = {
  static: { pos: [[0, 1.6, 9], [0, 1.6, 9]], look: [[0, 1, 0], [0, 1, 0]], fov: 50 },
  push: { pos: [[0, 1.6, 10], [0, 1.6, 6]], look: [[0, 1, 0], [0, 1, 0]], fov: 50 },
  pull: { pos: [[0, 1.6, 6], [0, 1.6, 10]], look: [[0, 1, 0], [0, 1, 0]], fov: 50 },
  track: { pos: [[-3, 1.6, 9], [3, 1.6, 9]], look: [[-1.5, 1, 0], [1.5, 1, 0]], fov: 50 },
  crane: { pos: [[0, 0.4, 8], [0, 4.0, 8]], look: [[0, 1, 0], [0, 1, 0]], fov: 50 },
};
const ORBIT = { radius: 9, height: 1.6, fromDeg: -35, toDeg: 35 };

/** Camera state at normalised progress p (0..1). */
export function cameraAt(move, p) {
  if (!CAMERA_MOVES.includes(move)) throw new Error(`unknown camera move "${move}"`);
  const t = clamp01(p);
  if (move === 'orbit') {
    const deg = lerp(ORBIT.fromDeg, ORBIT.toDeg, easeInOut(t)) * (Math.PI / 180);
    return { pos: [ORBIT.radius * Math.sin(deg), ORBIT.height, ORBIT.radius * Math.cos(deg)], look: [0, 1, 0], fov: 50 };
  }
  if (move === 'shake') {
    // a controlled, deterministic jitter around a static frame (no randomness, so renders are reproducible)
    const j = 0.04 * Math.sin(t * 60), k = 0.03 * Math.cos(t * 83);
    return { pos: [j, 1.6 + k, 9], look: [0, 1, 0], fov: 50 };
  }
  const c = CAM[move];
  const e = easeInOut(t);
  return { pos: lerp3(c.pos[0], c.pos[1], e), look: lerp3(c.look[0], c.look[1], e), fov: c.fov };
}

// Subject tracks: [from, to] positions and an easing per motion. 'stay' keeps the subject in place.
const SUBJECT = {
  stay: { from: [0, 0, 0], to: [0, 0, 0], ease: easeInOut },
  approach: { from: [0, 3, -14], to: [0, 0, 0], ease: easeInOut },
  recede: { from: [0, 0, 0], to: [0, 3, -14], ease: easeInOut },
  cross: { from: [-6, 0, 0], to: [6, 0, 0], ease: easeInOut },
  rise: { from: [0, -1, 0], to: [0, 3, 0], ease: easeInOut },
  fall: { from: [0, 4, 0], to: [0, 0, 0], ease: easeIn },
  impact: { from: [0, 3, -10], to: [0, 0, 0], ease: easeIn },
};

/** Main subject state at progress p (0..1). Rotation turns slowly so a still object still reads as 3D. */
export function subjectAt(motion, p) {
  if (!MOTIONS.includes(motion)) throw new Error(`unknown motion "${motion}"`);
  const t = clamp01(p), s = SUBJECT[motion];
  return { pos: lerp3(s.from, s.to, s.ease(t)), rot: [0, t * 0.6, 0] };
}

/**
 * Evaluate one shot at absolute time tSec. Time outside the shot is clamped to its start or end, so consecutive shots
 * hand over cleanly. Returns { shotId, p, camera, subject: { id, pos, rot } }.
 */
export function evaluateShot(shot, tSec) {
  const span = shot.end - shot.start;
  const p = span > 0 ? clamp01((tSec - shot.start) / span) : 0;
  return {
    shotId: shot.id,
    p,
    camera: cameraAt(shot.camera, p),
    subject: { id: shot.subjectId, ...subjectAt(shot.motion, p) },
  };
}
