// CineForge stage 2: events → timed shots → keyframe motion. Pure Node, no browser, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planShots, validateShots, subjectId, MIN_SHOT_S } from '../dashboard/lib/cineforge/shot-planner.js';
import { cameraAt, subjectAt, evaluateShot } from '../dashboard/lib/cineforge/motion.js';

// two narration segments with real-looking timestamps (seconds)
const SEGMENTS = [
  { id: 'S1', start: 0.0, end: 6.0 },
  { id: 'S2', start: 6.0, end: 9.0 },
];
const EVENTS = [
  { id: 'E001', segmentId: 'S1', subject: 'Asteroid', action: 'approaches Earth', environment: 'space', motion: 'approach', camera: 'static' },
  { id: 'E002', segmentId: 'S1', subject: 'asteroid ', action: 'enters the atmosphere', environment: 'upper atmosphere', motion: 'approach', camera: 'push' },
  { id: 'E003', segmentId: 'S1', subject: 'asteroid', action: 'impacts the surface', environment: 'surface', motion: 'impact', camera: 'shake' },
  { id: 'E004', segmentId: 'S2', subject: 'dust', action: 'rises over the crater', environment: 'surface', motion: 'rise', camera: 'crane' },
];

test('one segment with three events becomes three shots that cover the segment exactly', () => {
  const { shots, errors } = planShots(EVENTS, SEGMENTS);
  assert.deepEqual(errors, []);
  const s1 = shots.filter((s) => s.segmentId === 'S1');
  assert.equal(s1.length, 3);
  assert.equal(s1[0].start, 0);
  assert.equal(s1.at(-1).end, 6);
  assert.equal(s1[1].start, s1[0].end);
  assert.equal(s1[2].start, s1[1].end);
  assert.ok(s1.every((s) => Math.abs(s.duration - 2) < 0.001));
});

test('shot ids are sequential and every event becomes exactly one shot', () => {
  const { shots } = planShots(EVENTS, SEGMENTS);
  assert.deepEqual(shots.map((s) => s.id), ['SH001', 'SH002', 'SH003', 'SH004']);
  assert.deepEqual(shots.map((s) => s.eventId), ['E001', 'E002', 'E003', 'E004']);
});

test('the same subject keeps one identity across shots, whatever its spelling or case', () => {
  const { shots } = planShots(EVENTS, SEGMENTS);
  assert.equal(shots[0].subjectId, 'asteroid');
  assert.equal(shots[1].subjectId, 'asteroid');
  assert.equal(shots[2].subjectId, 'asteroid');
  assert.notEqual(shots[3].subjectId, shots[0].subjectId);
  assert.equal(subjectId('  Earth! '), 'earth');
});

test('a too-short shot is reported, not silently stretched', () => {
  const tight = [{ id: 'S1', start: 0, end: 1.5 }];
  const ev = [
    { id: 'E1', segmentId: 'S1', subject: 'a', action: 'x', environment: 'y', motion: 'stay', camera: 'static' },
    { id: 'E2', segmentId: 'S1', subject: 'a', action: 'x', environment: 'y', motion: 'stay', camera: 'static' },
    { id: 'E3', segmentId: 'S1', subject: 'a', action: 'x', environment: 'y', motion: 'stay', camera: 'static' },
  ];
  const { shots } = planShots(ev, tight);
  const v = validateShots(shots, tight);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((m) => new RegExp(`shorter than ${MIN_SHOT_S}s`).test(m)));
  assert.equal(shots[0].duration, 0.5);   // timing is as planned, not changed
});

test('a valid plan passes validation (coverage, order, allowed enums, subjects)', () => {
  const { shots } = planShots(EVENTS, SEGMENTS);
  assert.deepEqual(validateShots(shots, SEGMENTS), { ok: true, errors: [] });
});

test('a segment with no events is reported, not skipped silently', () => {
  const { shots, errors } = planShots(EVENTS.filter((e) => e.segmentId === 'S1'), SEGMENTS);
  assert.ok(errors.some((m) => /segment S2 has no events/.test(m)));
  assert.equal(validateShots(shots, SEGMENTS).ok, false);
});

test('the subject actually moves over an approach shot (not a static frame)', () => {
  const shot = planShots(EVENTS, SEGMENTS).shots[0];
  const a = evaluateShot(shot, shot.start).subject.pos;
  const b = evaluateShot(shot, shot.end).subject.pos;
  assert.notDeepEqual(a, b);
  assert.ok(b[2] > a[2], 'approaches along +z');
});

test('a stay motion keeps the subject in place', () => {
  const p0 = subjectAt('stay', 0).pos, p1 = subjectAt('stay', 1).pos;
  assert.deepEqual(p0, p1);
});

test('a push camera moves the camera; a static camera does not move it', () => {
  const pushA = cameraAt('push', 0).pos, pushB = cameraAt('push', 1).pos;
  assert.ok(pushB[2] < pushA[2], 'push moves toward the subject (z decreases)');
  assert.deepEqual(cameraAt('static', 0).pos, cameraAt('static', 1).pos);
});

test('shake is a controlled jitter around the frame, not random', () => {
  const a = cameraAt('shake', 0.37), b = cameraAt('shake', 0.37);
  assert.deepEqual(a, b);
  assert.notDeepEqual(cameraAt('shake', 0.1).pos, cameraAt('shake', 0.6).pos);
});

test('evaluation is deterministic and clamps outside the shot', () => {
  const shot = planShots(EVENTS, SEGMENTS).shots[1];
  assert.deepEqual(evaluateShot(shot, 2.5), evaluateShot(shot, 2.5));
  assert.equal(evaluateShot(shot, shot.start - 5).p, 0);
  assert.equal(evaluateShot(shot, shot.end + 5).p, 1);
});

test('unknown motion or camera values throw instead of guessing', () => {
  assert.throws(() => subjectAt('teleport', 0.5), /unknown motion/);
  assert.throws(() => cameraAt('dolly-zoom', 0.5), /unknown camera/);
});
