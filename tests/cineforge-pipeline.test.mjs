// CineForge supporting modules: asset manifest, renderer router, render queue, visual inspector. Pure Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSETS, validateManifest, getAsset } from '../dashboard/lib/cineforge/asset-manifest.js';
import { chooseRenderer, routeShots } from '../dashboard/lib/cineforge/renderer-router.js';
import { runQueue, MAX_ATTEMPTS } from '../dashboard/lib/cineforge/render-queue.js';
import { inspectFrames } from '../dashboard/lib/cineforge/visual-inspector.js';

const SHOTS = [
  { id: 'SH001', start: 0, end: 2, subjectId: 'asteroid', motion: 'approach', camera: 'static' },
  { id: 'SH002', start: 2, end: 4, subjectId: 'asteroid', motion: 'approach', camera: 'push' },
  { id: 'SH003', start: 4, end: 6, subjectId: 'asteroid', motion: 'impact', camera: 'shake' },
];

test('asset manifest: every asset has a licence, a source, a cost and a renderer; ids are unique', () => {
  assert.deepEqual(validateManifest(), { ok: true, errors: [] });
  assert.equal(getAsset('proc.sphere').license, 'project-original');
  assert.equal(getAsset('nope'), null);
});

test('asset manifest rejects an entry without a licence', () => {
  const bad = [{ id: 'x', category: 'c', format: 'glb', source: 's', license: '', cost: 'low', renderers: ['threejs'] }];
  assert.equal(validateManifest(bad).ok, false);
});

test('renderer router: lightweight shots go to Three.js', () => {
  assert.equal(chooseRenderer(SHOTS[0]).renderer, 'threejs');
});

test('renderer router: impact + shake goes to Blender when Blender is available', () => {
  assert.equal(chooseRenderer(SHOTS[2], { available: { threejs: true, blender: true } }).renderer, 'blender');
});

test('renderer router: a needed Blender that is missing is an error, never a silent switch', () => {
  const r = chooseRenderer(SHOTS[2]);   // Blender not available in this environment
  assert.equal(r.renderer, null);
  assert.match(r.error, /needs blender .* not available/);
  const routed = routeShots(SHOTS);
  assert.equal(routed.plan.length, 2);
  assert.equal(routed.errors.length, 1);
});

test('renderer router: a manual override is honoured; an unavailable override is an error', () => {
  assert.equal(chooseRenderer(SHOTS[0], { override: 'threejs' }).renderer, 'threejs');
  assert.match(chooseRenderer(SHOTS[0], { override: 'blender' }).error, /not switching silently/);
  assert.match(chooseRenderer(SHOTS[0], { override: 'unreal' }).error, /unknown renderer/);
});

test('render queue: every shot renders once; a shot that fails twice then succeeds is retried; no shot is looped forever', async () => {
  const calls = new Map();
  const renderFn = async (shot) => {
    const n = (calls.get(shot.id) || 0) + 1; calls.set(shot.id, n);
    if (shot.id === 'SH002' && n <= 2) throw new Error('gpu memory');
    return { file: `${shot.id}.png` };
  };
  const events = [];
  const out = await runQueue(SHOTS, renderFn, { onEvent: (e) => events.push(e) });
  assert.equal(out.complete, true);
  assert.equal(calls.get('SH002'), 3);
  assert.equal(calls.get('SH001'), 1);
  assert.ok(events.some((e) => e.type === 'retry' && e.shotId === 'SH002'));
});

test('render queue: a shot that keeps failing stops after MAX_ATTEMPTS and is reported', async () => {
  let n = 0;
  const out = await runQueue(SHOTS, async (shot) => { if (shot.id === 'SH003') { n++; throw new Error('blender crashed'); } return {}; });
  assert.equal(n, MAX_ATTEMPTS);
  assert.equal(out.complete, false);
  assert.deepEqual(out.failures.map((f) => f.shotId), ['SH003']);
});

test('render queue: resume keeps completed shots and renders only the rest', async () => {
  const done = new Map([['SH001', { file: 'SH001.png' }]]);
  const rendered = [];
  const out = await runQueue(SHOTS, async (shot) => { rendered.push(shot.id); return {}; }, { completed: done });
  assert.deepEqual(rendered, ['SH002', 'SH003']);
  assert.equal(out.results.get('SH001').file, 'SH001.png');
});

// a normal moving frame: some pixels changed since the previous frame
const frame = (t, shotId, extra = {}) => ({ t, shotId, subject: { id: 'asteroid' }, std: 20, diffFromPrev: 1.0, changedFraction: 0.01, ...extra });

test('visual inspector: a good, moving sequence passes with measured counts and no score', () => {
  const frames = [frame(0, 'SH001'), frame(1, 'SH001'), frame(2, 'SH002'), frame(3, 'SH002'), frame(4, 'SH003'), frame(5, 'SH003')];
  const r = inspectFrames(frames, SHOTS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.counts, { frames: 6, shots: 3, blank: 0, repeated: 0, slow: 0, noSubject: 0 });
  assert.equal(r.score, undefined, 'the inspector must not invent a score');
});

test('visual inspector: blank frames and missing subjects are errors', () => {
  const frames = [frame(0, 'SH001', { std: 0.5 }), frame(1, 'SH001', { subject: null }), frame(2, 'SH002'), frame(4, 'SH003'), frame(5, 'SH003')];
  const r = inspectFrames(frames, SHOTS);
  assert.equal(r.ok, false);
  assert.equal(r.counts.blank, 1);
  assert.equal(r.counts.noSubject, 1);
});

test('visual inspector: a frame identical to the previous one inside a moving shot is an error', () => {
  const frames = [frame(0, 'SH001'), frame(1, 'SH001', { changedFraction: 0, diffFromPrev: 0 }), frame(2, 'SH002'), frame(3, 'SH002'), frame(4, 'SH003'), frame(5, 'SH003')];
  const r = inspectFrames(frames, SHOTS);
  assert.equal(r.counts.repeated, 1);
  assert.equal(r.ok, false);
});

test('visual inspector: a static shot may repeat frames; a shot change is never a repeat', () => {
  const staticPlan = [{ id: 'SH001', start: 0, end: 2, subjectId: 'a', motion: 'stay', camera: 'static' }];
  const still = [frame(0, 'SH001', { changedFraction: 0, diffFromPrev: 0 }), frame(1, 'SH001', { changedFraction: 0, diffFromPrev: 0 })];
  assert.equal(inspectFrames(still, staticPlan).counts.repeated, 0);
  const cut = [frame(0, 'SH001'), frame(1, 'SH002', { changedFraction: 0, diffFromPrev: 0 })];
  assert.equal(inspectFrames(cut, SHOTS.slice(0, 2)).counts.repeated, 0);
});

test('visual inspector: very slow change in a moving shot is a warning, not an error', () => {
  const frames = [frame(0, 'SH001'), frame(1, 'SH001', { changedFraction: 0.00005, diffFromPrev: 0.002 }), frame(2, 'SH002'), frame(3, 'SH002'), frame(4, 'SH003'), frame(5, 'SH003')];
  const r = inspectFrames(frames, SHOTS);
  assert.equal(r.counts.slow, 1);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.ok, true);
});

test('visual inspector: a planned shot with no frames is an error', () => {
  const r = inspectFrames([frame(0, 'SH001')], SHOTS);
  assert.ok(r.errors.some((m) => /SH002 has no rendered frames/.test(m)));
});
