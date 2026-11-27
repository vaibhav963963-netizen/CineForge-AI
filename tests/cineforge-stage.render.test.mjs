// CineForge stage 2c, end to end in a REAL headless Chrome with WebGL: the stage page renders a planned shot sequence,
// and the test checks the measured pixels (not just the maths). Skipped when no Chrome is installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planShots } from '../dashboard/lib/cineforge/shot-planner.js';
import { serveStage, runChrome, parseStageResult, findChrome } from '../tools/cineforge-harness.mjs';

const SEGMENTS = [{ id: 'S1', start: 0, end: 6 }, { id: 'S2', start: 6, end: 9 }];
const EVENTS = [
  { id: 'E001', segmentId: 'S1', subject: 'asteroid', action: 'approaches Earth', environment: 'space', motion: 'approach', camera: 'static' },
  { id: 'E002', segmentId: 'S1', subject: 'asteroid', action: 'enters the atmosphere', environment: 'upper atmosphere', motion: 'approach', camera: 'push' },
  { id: 'E003', segmentId: 'S1', subject: 'asteroid', action: 'impacts the surface', environment: 'surface', motion: 'impact', camera: 'shake' },
  { id: 'E004', segmentId: 'S2', subject: 'dust', action: 'rises over the crater', environment: 'surface', motion: 'rise', camera: 'crane' },
];
const W = 540, H = 960;

test('stage renders a planned sequence in real WebGL: subject moves, camera moves, pixels change', { skip: findChrome() ? false : 'no Chrome/Edge found' }, async () => {
  const { shots, errors } = planShots(EVENTS, SEGMENTS);
  assert.deepEqual(errors, []);
  const times = Array.from({ length: 19 }, (_, i) => +(i * 0.5).toFixed(2));   // 0 … 9 s
  const plan = { width: W, height: H, shots, times };
  const { server, url } = await serveStage(plan);
  let result;
  try {
    result = parseStageResult(await runChrome(url, { width: W, height: H }));
  } finally { server.close(); }
  assert.equal(result.error, undefined, `stage error: ${result.error}`);
  const f = result.frames;
  assert.equal(f.length, times.length);

  // not blank: every frame has real luminance variation (ground, subject, light)
  for (const fr of f) assert.ok(fr.std > 3, `frame t=${fr.t} looks blank (std ${fr.std})`);

  // the active shot is the planned one at every time (half-open rule: start <= t < end; the final time is in the last shot)
  for (const fr of f) {
    const shot = shots.find((s) => fr.t >= s.start - 1e-9 && fr.t < s.end - 1e-9) || shots.at(-1);
    assert.equal(fr.shotId, shot.id, `t=${fr.t} should be in ${shot.id}`);
    assert.ok(fr.subject, `t=${fr.t} has no subject`);
  }

  // continuity: the same subject identity across the three asteroid shots
  const ast = f.filter((fr) => fr.shotId === 'SH001' || fr.shotId === 'SH002' || fr.shotId === 'SH003');
  assert.ok(ast.every((fr) => fr.subject.id === 'asteroid'));

  // SH001 (0–2 s) is the approach; compare inside it (t=2 starts SH002 at the same position)
  const a = f.find((fr) => fr.t === 0), b = f.find((fr) => fr.t === 1.5);
  assert.notDeepEqual(a.subject.pos, b.subject.pos, 'subject position must change during the approach');
  assert.ok(Math.abs(a.screen.y - b.screen.y) > 0.01, `subject must move on screen (y ${a.screen.y} → ${b.screen.y})`);

  // SH002 (2–4 s) is the push; compare the start and end of that shot
  const p1 = f.find((fr) => fr.t === 2), p2 = f.find((fr) => fr.t === 3.5);
  assert.ok(p2.camera.pos[2] < p1.camera.pos[2], 'push camera must move toward the subject');

  // pixels change over time while things move: no frame during the moving shots is identical to the previous one
  const moving = f.filter((fr) => fr.t > 0 && fr.t <= 6 && fr.changedFraction !== null);
  assert.ok(moving.every((fr) => !(fr.changedFraction === 0 && fr.diffFromPrev === 0)), 'no repeated frames during motion');
  assert.ok(moving.every((fr) => fr.changedFraction > 0), 'every moving frame has some changed pixels');
});
