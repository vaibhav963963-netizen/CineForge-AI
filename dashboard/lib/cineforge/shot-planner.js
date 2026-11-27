// CineForge stage 2a: visual events → timed shots.
// Each narration segment's time window (from the real word timestamps) is split evenly across its events. Nothing is
// clamped silently: a shot shorter than MIN_SHOT_S is reported by validateShots, so the planner can't hide bad timing.
import { CAMERA_MOVES, MOTIONS } from './narrative-analyzer.js';

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
        motion: e.motion,
        camera: e.camera,
      });
    });
  }
  return { shots, errors };
}

/** Checks the plan. Returns { ok, errors }. Timing problems are reported, never repaired silently. */
export function validateShots(shots, segments) {
  const errors = [];
  for (const s of shots) {
    if (s.duration < MIN_SHOT_S - TIME_TOLERANCE_S) errors.push(`${s.id}: ${s.duration}s is shorter than ${MIN_SHOT_S}s`);
    if (!MOTIONS.includes(s.motion)) errors.push(`${s.id}: motion "${s.motion}" is not allowed`);
    if (!CAMERA_MOVES.includes(s.camera)) errors.push(`${s.id}: camera "${s.camera}" is not allowed`);
    if (!s.subjectId) errors.push(`${s.id}: has no subject`);
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
  }
  return { ok: errors.length === 0, errors };
}
