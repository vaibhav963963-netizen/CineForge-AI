// CineForge stage 2a: visual events → timed shots.
// Each narration segment (one sentence) has its real time window from the word timestamps. Its events are shots, split
// evenly across the window. Nothing is clamped silently: a shot shorter than MIN_SHOT_S, or a sentence with too few or
// too many shots for its length, is reported by validateShots.
import { CAMERA_MOVES, MOTIONS, SHOT_SIZES, LIGHTING, EFFECTS, TRANSITIONS, MIN_SHOTS_PER_SEGMENT, MAX_SHOTS_PER_SEGMENT } from './vocab.js';
import { setsFor, DEFAULT_STYLE } from './styles.js';

export const MIN_SHOT_S = 1.0;
export const TIME_TOLERANCE_S = 0.01;

const round = (x) => Math.round(x * 1000) / 1000;

/** Continuity identity: the same subject name (case and spacing ignored) always maps to the same id. */
export function subjectId(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, '-').replace(/^-|-$/g, '') || 'subject';
}

/**
 * events: from analyzeNarration. segments: [{ id, start, end }] in seconds (from word timestamps).
 * Returns { shots, errors }. Shots are in narration order.
 */
export function planShots(events, segments) {
  const shots = [], errors = [];
  for (const seg of segments) {
    const evs = events.filter((e) => e.segmentId === seg.id);
    if (!evs.length) { errors.push(`segment ${seg.id} has no events`); continue; }
    const span = seg.end - seg.start;
    if (!(span > 0)) { errors.push(`segment ${seg.id} has no duration`); continue; }
    const each = span / evs.length;
    evs.forEach((e, i) => {
      const start = seg.start + i * each;
      const end = i === evs.length - 1 ? seg.end : start + each;
      shots.push({
        id: `SH${String(shots.length + 1).padStart(3, '0')}`,
        eventId: e.id,
        segmentId: seg.id,
        start: round(start),
        end: round(end),
        duration: round(end - start),
        subject: String(e.subject).trim(),
        subjectId: subjectId(e.subject),
        action: e.action,
        environment: e.environment,
        set: e.set,
        caption: e.caption,
        startState: e.startState,
        endState: e.endState,
        motion: e.motion,
        camera: e.camera,
        shotSize: e.shotSize,
        lighting: e.lighting,
        effect: e.effect,
        transition: e.transition,
      });
    });
  }
  return { shots, errors };
}

/** how many shots a sentence of this length can carry: 3–6, but never shorter than MIN_SHOT_S per shot */
export function shotCountBounds(spanSeconds) {
  const fit = Math.floor((spanSeconds + TIME_TOLERANCE_S) / MIN_SHOT_S);
  return { min: Math.min(MIN_SHOTS_PER_SEGMENT, fit), max: Math.min(MAX_SHOTS_PER_SEGMENT, fit) };
}

/**
 * Checks the plan. Returns { ok, errors, warnings }. Problems are reported, never repaired silently.
 * segments: [{ id, start, end }] — needed for the per-sentence shot counts and coverage checks.
 */
export function validateShots(shots, segments, { style = DEFAULT_STYLE } = {}) {
  const errors = [], warnings = [];
  const enums = { set: setsFor(style), motion: MOTIONS, camera: CAMERA_MOVES, shotSize: SHOT_SIZES, lighting: LIGHTING, effect: EFFECTS, transition: TRANSITIONS };
  for (const s of shots) {
    if (s.duration < MIN_SHOT_S - TIME_TOLERANCE_S) errors.push(`${s.id}: ${s.duration}s is shorter than ${MIN_SHOT_S}s`);
    for (const [k, allowed] of Object.entries(enums)) {
      if (!allowed.includes(s[k])) errors.push(`${s.id}: ${k} "${s[k]}" is not allowed`);
    }
    if (!s.subjectId) errors.push(`${s.id}: has no subject`);
    if (!s.startState || !s.endState) errors.push(`${s.id}: needs both a startState and an endState`);
    if (!s.caption || !String(s.caption).trim()) errors.push(`${s.id}: needs a caption`);
    if (s.motion === 'stay' && s.effect === 'none') errors.push(`${s.id}: static shot, needs a subject motion or an effect`);
  }
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].start < shots[i - 1].end - TIME_TOLERANCE_S) errors.push(`${shots[i].id} overlaps ${shots[i - 1].id}`);
  }
  for (const seg of segments) {
    const mine = shots.filter((s) => s.segmentId === seg.id);
    if (!mine.length) { errors.push(`segment ${seg.id} has no shots`); continue; }
    if (Math.abs(mine[0].start - seg.start) > TIME_TOLERANCE_S || Math.abs(mine.at(-1).end - seg.end) > TIME_TOLERANCE_S) {
      errors.push(`segment ${seg.id} is not fully covered by its shots`);
    }
    const { min, max } = shotCountBounds(seg.end - seg.start);
    if (min < 1) errors.push(`segment ${seg.id} is too short (${(seg.end - seg.start).toFixed(2)} s) for even one ${MIN_SHOT_S}s shot`);
    else if (mine.length < min || mine.length > max) {
      errors.push(`segment ${seg.id} has ${mine.length} shots; this sentence needs ${min}–${max}`);
    }
    for (let i = 2; i < mine.length; i++) {
      if (mine[i].shotSize === mine[i - 1].shotSize && mine[i - 1].shotSize === mine[i - 2].shotSize) {
        warnings.push(`${mine[i].id}: three shots in a row at the same framing (${mine[i].shotSize}); vary the angles`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
