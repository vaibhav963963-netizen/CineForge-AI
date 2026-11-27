// CineForge stage 2: events → timed shots → keyframe motion. Pure Node, no browser, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planShots, validateShots, subjectId, shotCountBounds, MIN_SHOT_S } from '../dashboard/lib/cineforge/shot-planner.js';
import { cameraAt, subjectAt, evaluateShot } from '../dashboard/lib/cineforge/motion.js';

// two sentences with real-looking timestamps (seconds): a 9 s sentence (six shots) and a 3 s sentence (three shots)
const SEGMENTS = [
  { id: 'S1', start: 0.0, end: 9.0 },
  { id: 'S2', start: 9.0, end: 12.0 },
];
const base = (over) => ({ startState: 'start', endState: 'end', motion: 'approach', camera: 'static', shotSize: 'wide', lighting: 'sunlit', effect: 'none', transition: 'cut', ...over });
const EVENTS = [
  { id: 'E001', segmentId: 'S1', subject: 'Asteroid', action: 'Earth from space', environment: 'space', ...base({ motion: 'recede', camera: 'aerial', shotSize: 'extreme-wide', subject: 'Earth' }) },
  { id: 'E002', segmentId: 'S1', subject: 'asteroid ', action: 'approaches', environment: 'space', ...base({ camera: 'track', shotSize: 'wide', lighting: 'backlit-rim', transition: 'dissolve' }) },
  { id: 'E003', segmentId: 'S1', subject: 'asteroid', action: 'enters the atmosphere', environment: 'upper atmosphere', ...base({ camera: 'push', shotSize: 'close-up', lighting: 'plasma-glow', effect: 'fire-plasma' }) },
  { id: 'E004', segmentId: 'S1', subject: 'asteroid', action: 'descends', environment: 'sky', ...base({ motion: 'fall', camera: 'track', shotSize: 'medium', lighting: 'fire-glow', effect: 'fire-plasma' }) },
  { id: 'E005', segmentId: 'S1', subject: 'asteroid', action: 'impacts the surface', environment: 'surface', ...base({ motion: 'impact', camera: 'shake', shotSize: 'extreme-close-up', lighting: 'fire-glow', effect: 'debris', transition: 'fade-black' }) },
  { id: 'E006', segmentId: 'S1', subject: 'dust', action: 'aftermath', environment: 'surface', ...base({ motion: 'rise', camera: 'crane', shotSize: 'wide', lighting: 'night-ambient', effect: 'dust-cloud' }) },
  { id: 'E007', segmentId: 'S2', subject: 'dust', action: 'rises over the crater', environment: 'surface', ...base({ motion: 'rise', camera: 'crane', shotSize: 'medium', effect: 'dust-cloud' }) },
  { id: 'E008', segmentId: 'S2', subject: 'dust', action: 'drifts', environment: 'surface', ...base({ motion: 'cross', camera: 'track', shotSize: 'close-up', effect: 'dust-cloud' }) },
  { id: 'E009', segmentId: 'S2', subject: 'dust', action: 'settles', environment: 'surface', ...base({ motion: 'fall', camera: 'pull', shotSize: 'wide', effect: 'dust-cloud' }) },
];

test('one 9 s sentence with six events becomes six shots that cover it exactly', () => {
  const { shots, errors } = planShots(EVENTS, SEGMENTS);
  assert.deepEqual(errors, []);
  const s1 = shots.filter((s) => s.segmentId === 'S1');
  assert.equal(s1.length, 6);
  assert.equal(s1[0].start, 0);
  assert.equal(s1.at(-1).end, 9);
  for (let i = 1; i < s1.length; i++) assert.equal(s1[i].start, s1[i - 1].end);
  assert.ok(s1.every((s) => Math.abs(s.duration - 1.5) < 0.001));
});

test('shots keep their framing, lighting, effect, transition and start/end states from the events', () => {
  const { shots } = planShots(EVENTS, SEGMENTS);
  const s = shots[4];   // the impact
  assert.equal(s.shotSize, 'extreme-close-up');
  assert.equal(s.effect, 'debris');
  assert.equal(s.transition, 'fade-black');
  assert.equal(s.startState, 'start');
  assert.equal(s.endState, 'end');
});

test('shot ids are sequential and every event becomes exactly one shot', () => {
  const { shots } = planShots(EVENTS, SEGMENTS);
  assert.equal(shots.length, EVENTS.length);
  assert.equal(shots[0].id, 'SH001');
  assert.equal(shots.at(-1).id, 'SH009');
  assert.deepEqual(shots.map((s) => s.eventId), EVENTS.map((e) => e.id));
});

test('the same subject keeps one identity across shots, whatever its spelling or case', () => {
  const { shots } = planShots(EVENTS, SEGMENTS);
  assert.equal(shots[1].subjectId, 'asteroid');
  assert.equal(shots[2].subjectId, 'asteroid');
  assert.equal(shots[3].subjectId, 'asteroid');
  assert.notEqual(shots[5].subjectId, shots[1].subjectId);
  assert.equal(subjectId('  Earth! '), 'earth');
});

test('shot counts per sentence: 3–6, and never more shots than the length allows', () => {
  assert.deepEqual(shotCountBounds(9), { min: 3, max: 6 });
  assert.deepEqual(shotCountBounds(3), { min: 3, max: 3 });
  assert.deepEqual(shotCountBounds(2.5), { min: 2, max: 2 });
  assert.deepEqual(shotCountBounds(0.5), { min: 0, max: 0 });
});

test('a valid plan passes validation (coverage, order, enums, counts, start/end states)', () => {
  const { shots } = planShots(EVENTS, SEGMENTS);
  const v = validateShots(shots, SEGMENTS);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.deepEqual(v.errors, []);
});

test('a too-short shot is reported, not silently stretched', () => {
  const tight = [{ id: 'S1', start: 0, end: 1.5 }];
  const ev = [1, 2, 3].map((i) => ({ id: `E${i}`, segmentId: 'S1', subject: 'a', action: 'x', environment: 'y', ...base({ motion: 'stay', effect: 'dust-cloud' }) }));
  const { shots } = planShots(ev, tight);
  const v = validateShots(shots, tight);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((m) => new RegExp(`shorter than ${MIN_SHOT_S}s`).test(m)));
  assert.equal(shots[0].duration, 0.5);   // timing is as planned, not changed
});

test('a sentence with too few shots is reported (3 are needed for a 3 s sentence)', () => {
  const two = EVENTS.filter((e) => e.segmentId === 'S2').slice(0, 2);
  const { shots } = planShots(two, SEGMENTS);
  const v = validateShots(shots, SEGMENTS);
  assert.ok(v.errors.some((m) => /segment S2 has 2 shots; this sentence needs 3–3/.test(m)), v.errors.join('; '));
});

test('a sentence with too many shots for its length is reported (max six)', () => {
  const seven = [...EVENTS.filter((e) => e.segmentId === 'S1'), { ...EVENTS[1], id: 'E010' }];
  const { shots } = planShots(seven, [SEGMENTS[0]]);
  const v = validateShots(shots, [SEGMENTS[0]]);
  assert.ok(v.errors.some((m) => /has 7 shots; this sentence needs 3–6/.test(m)), v.errors.join('; '));
});

test('a static shot with no effect is an error: every shot must move or do something physical', () => {
  const bad = [{ id: 'E1', segmentId: 'S2', subject: 'a', action: 'x', environment: 'y', ...base({ motion: 'stay', camera: 'push', effect: 'none' }) }];
  const seg = [{ id: 'S2', start: 0, end: 1 }];
  const v = validateShots(planShots(bad, seg).shots, seg);
  assert.ok(v.errors.some((m) => /static shot, needs a subject motion or an effect/.test(m)));
});

test('a shot missing its start or end state is an error', () => {
  const noEnd = [{ id: 'E1', segmentId: 'S2', subject: 'a', action: 'x', environment: 'y', ...base({ endState: '' }) }];
  const seg = [{ id: 'S2', start: 0, end: 1 }];
  const v = validateShots(planShots(noEnd, seg).shots, seg);
  assert.ok(v.errors.some((m) => /needs both a startState and an endState/.test(m)));
});

test('three shots in a row at the same framing is a warning, not an error', () => {
  const same = [1, 2, 3].map((i) => ({ id: `E${i}`, segmentId: 'S2', subject: 'a', action: 'x', environment: 'y', ...base({ shotSize: 'medium', effect: 'dust-cloud' }) }));
  const seg = [{ id: 'S2', start: 0, end: 3 }];
  const v = validateShots(planShots(same, seg).shots, seg);
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((m) => /three shots in a row/.test(m)));
});

test('a segment with no events is reported, not skipped silently', () => {
  const { shots, errors } = planShots(EVENTS.filter((e) => e.segmentId === 'S1'), SEGMENTS);
  assert.ok(errors.some((m) => /segment S2 has no events/.test(m)));
  assert.equal(validateShots(shots, SEGMENTS).ok, false);
});

test('the subject actually moves over an approach shot (not a static frame)', () => {
  const shot = planShots(EVENTS, SEGMENTS).shots[1];
  const a = evaluateShot(shot, shot.start).subject.pos;
  const b = evaluateShot(shot, shot.end).subject.pos;
  assert.notDeepEqual(a, b);
  assert.ok(b[2] > a[2], 'approaches along +z');
});

test('a stay motion keeps the subject in place', () => {
  assert.deepEqual(subjectAt('stay', 0).pos, subjectAt('stay', 1).pos);
});

test('a push camera moves toward the subject; a static camera does not move', () => {
  assert.ok(cameraAt('push', 1).pos[2] < cameraAt('push', 0).pos[2], 'push moves toward the subject (z decreases)');
  assert.deepEqual(cameraAt('static', 0).pos, cameraAt('static', 1).pos);
});

test('framing changes the camera distance: close-ups sit closer than wide shots', () => {
  const dist = (c) => Math.hypot(...c.pos);
  assert.ok(dist(cameraAt('static', 0.5, 'extreme-close-up')) < dist(cameraAt('static', 0.5, 'close-up')));
  assert.ok(dist(cameraAt('static', 0.5, 'close-up')) < dist(cameraAt('static', 0.5, 'medium')));
  assert.ok(dist(cameraAt('static', 0.5, 'medium')) < dist(cameraAt('static', 0.5, 'extreme-wide')));
});

test('the aerial camera sweeps down from high above the subject', () => {
  const start = cameraAt('aerial', 0).pos, end = cameraAt('aerial', 1).pos;
  assert.ok(start[1] > 10, 'starts high');
  assert.ok(end[1] < start[1], 'descends');
});

test('shake is a controlled jitter around the frame, not random', () => {
  assert.deepEqual(cameraAt('shake', 0.37), cameraAt('shake', 0.37));
  assert.notDeepEqual(cameraAt('shake', 0.1).pos, cameraAt('shake', 0.6).pos);
});

test('evaluation is deterministic and clamps outside the shot', () => {
  const shot = planShots(EVENTS, SEGMENTS).shots[2];
  assert.deepEqual(evaluateShot(shot, 4), evaluateShot(shot, 4));
  assert.equal(evaluateShot(shot, shot.start - 5).p, 0);
  assert.equal(evaluateShot(shot, shot.end + 5).p, 1);
});

test('unknown motion, camera or shot size throw instead of guessing', () => {
  assert.throws(() => subjectAt('teleport', 0.5), /unknown motion/);
  assert.throws(() => cameraAt('dolly-zoom', 0.5), /unknown camera/);
  assert.throws(() => cameraAt('static', 0.5, 'huge'), /unknown shot size/);
});
