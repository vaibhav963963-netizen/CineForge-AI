// CineForge stage 1: narration → shot events. No network: the provider is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNarration, validateEvents, fallbackEvents, EVENT_SCHEMA, MAX_EVENTS_PER_SEGMENT, CAMERA_MOVES, MOTIONS, SHOT_SIZES, LIGHTING, EFFECTS, TRANSITIONS } from '../dashboard/lib/cineforge/narrative-analyzer.js';
import { MIN_SHOTS_PER_SEGMENT } from '../dashboard/lib/cineforge/vocab.js';

const SEGS = [
  { id: 'S1', text: 'A giant asteroid approached Earth, entered its atmosphere, and collided with the surface, creating a massive explosion.', subject: 'asteroid', environment: 'space' },
  { id: 'S2', text: 'Dust rose over the crater.', subject: 'dust', environment: 'surface' },
];

// one complete event, with every required field
const ev = (segmentId, over = {}) => ({
  segmentId, subject: 'asteroid', action: 'approaches Earth', environment: 'space',
  startState: 'far away, small', endState: 'close, large', motion: 'approach', camera: 'static',
  shotSize: 'wide', lighting: 'sunlit', effect: 'none', transition: 'cut', ...over,
});

// the example sentence: six shots (wide Earth → approach → entry → descent → impact → aftermath)
const GOOD = {
  events: [
    ev('S1', { action: 'Earth seen from space', motion: 'stay', shotSize: 'extreme-wide', camera: 'aerial', subject: 'earth', startState: 'Earth turning slowly', endState: 'Earth in frame' }),
    ev('S1', { action: 'asteroid approaches Earth, rotating', motion: 'approach', shotSize: 'wide', camera: 'track', lighting: 'backlit-rim', transition: 'dissolve' }),
    ev('S1', { action: 'asteroid enters the atmosphere, fire and plasma', motion: 'approach', shotSize: 'close-up', camera: 'push', lighting: 'plasma-glow', effect: 'fire-plasma', transition: 'cut' }),
    ev('S1', { action: 'asteroid descends rapidly', motion: 'fall', shotSize: 'medium', camera: 'track', lighting: 'fire-glow', effect: 'fire-plasma' }),
    ev('S1', { action: 'impact with debris and shockwave', motion: 'impact', shotSize: 'extreme-close-up', camera: 'shake', lighting: 'fire-glow', effect: 'debris', transition: 'fade-black' }),
    ev('S1', { action: 'aftermath with dust cloud', motion: 'stay', shotSize: 'wide', camera: 'crane', effect: 'dust-cloud', lighting: 'night-ambient' }),
    ev('S2', { action: 'dust rises over the crater', motion: 'rise', effect: 'dust-cloud', camera: 'crane', shotSize: 'medium', subject: 'dust' }),
    ev('S2', { action: 'dust drifts', motion: 'cross', effect: 'dust-cloud', camera: 'track', shotSize: 'close-up', subject: 'dust' }),
    ev('S2', { action: 'dust settles', motion: 'fall', effect: 'dust-cloud', camera: 'pull', shotSize: 'wide', subject: 'dust' }),
  ],
};
const replyWith = (obj) => async () => ({ text: JSON.stringify(obj) });

test('closed vocabularies: camera, framing, lighting, effects and transitions are fixed lists in the schema', () => {
  const p = EVENT_SCHEMA.properties.events.items.properties;
  assert.deepEqual(p.camera.enum, CAMERA_MOVES);
  assert.deepEqual(p.motion.enum, MOTIONS);
  assert.deepEqual(p.shotSize.enum, SHOT_SIZES);
  assert.deepEqual(p.lighting.enum, LIGHTING);
  assert.deepEqual(p.effect.enum, EFFECTS);
  assert.deepEqual(p.transition.enum, TRANSITIONS);
  assert.ok(CAMERA_MOVES.includes('aerial') && SHOT_SIZES.includes('extreme-close-up'));
});

test('schema is strict: every field required, no extra properties', () => {
  assert.equal(EVENT_SCHEMA.additionalProperties, false);
  assert.deepEqual(EVENT_SCHEMA.required, ['events']);
  const items = EVENT_SCHEMA.properties.events.items;
  assert.equal(items.additionalProperties, false);
  for (const f of ['startState', 'endState', 'shotSize', 'lighting', 'effect', 'transition']) assert.ok(items.required.includes(f), f);
});

test('a sentence becomes several shots (the example gives six), with stable ids in order', async () => {
  const r = await analyzeNarration(SEGS, { chatFn: replyWith(GOOD) });
  assert.equal(r.source, 'groq');
  assert.deepEqual(r.errors, []);
  assert.equal(r.events.filter((e) => e.segmentId === 'S1').length, 6);
  assert.equal(r.events[0].id, 'E001');
  assert.equal(r.events.at(-1).id, 'E009');
});

test('the prompt asks for 3–6 shots per sentence with start and end states and the chosen vocabularies', async () => {
  let system = '';
  await analyzeNarration(SEGS, { chatFn: async (req) => { system = req.messages[0].content; return { text: JSON.stringify(GOOD) }; } });
  assert.match(system, new RegExp(`${MIN_SHOTS_PER_SEGMENT} to ${MAX_EVENTS_PER_SEGMENT} events`));
  assert.match(system, /startState and an endState/);
  assert.match(system, /fire-plasma/);
  assert.match(system, /never use the same size twice in a row/);
});

test('a field outside its closed list is rejected with the field and value named', () => {
  const bad = { events: [ev('S2', { motion: 'teleport', shotSize: 'huge', camera: 'wide establishing' })] };
  const v = validateEvents(bad, SEGS);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((m) => /motion "teleport"/.test(m)));
  assert.ok(v.errors.some((m) => /shotSize "huge"/.test(m)));
  assert.ok(v.errors.some((m) => /camera "wide establishing"/.test(m)));
});

test('missing start or end state is rejected', () => {
  const bad = { events: [ev('S2', { startState: '' }), ...[1, 2].map(() => ev('S2'))] };
  const v = validateEvents(bad, SEGS);
  assert.ok(v.errors.some((m) => /startState is empty/.test(m)));
});

test('invalid output falls back to one event per segment and names the errors', async () => {
  const bad = { events: [ev('S9')] };
  const r = await analyzeNarration(SEGS, { chatFn: replyWith(bad) });
  assert.equal(r.source, 'fallback');
  assert.ok(r.errors.some((m) => /unknown segmentId/.test(m)));
  assert.ok(r.errors.some((m) => /segment S1 has no event/.test(m)));
  assert.equal(r.events.length, SEGS.length);
});

test('provider error (e.g. daily limit) falls back and records the reason; nothing is invented', async () => {
  const r = await analyzeNarration(SEGS, { chatFn: async () => { throw new Error('daily limit reached'); } });
  assert.equal(r.source, 'fallback');
  assert.match(r.errors[0], /^provider: daily limit reached/);
  assert.equal(r.events[0].action, SEGS[0].text);
});

test('non-JSON output is treated as invalid, not crashed on', async () => {
  const r = await analyzeNarration(SEGS, { chatFn: async () => ({ text: 'not json' }) });
  assert.equal(r.source, 'fallback');
});

test('more than the maximum shots for one sentence is rejected', () => {
  const many = Array.from({ length: MAX_EVENTS_PER_SEGMENT + 1 }, (_, i) => ev('S2', { action: `b${i}` }));
  const v = validateEvents({ events: many }, SEGS);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((m) => /max/.test(m)));
});

test('empty input returns no events without calling the provider', async () => {
  let called = false;
  const r = await analyzeNarration([], { chatFn: async () => { called = true; return { text: '{}' }; } });
  assert.equal(called, false);
  assert.deepEqual(r.events, []);
});

test('fallbackEvents keeps the narration text as the action (no invented content)', () => {
  const evs = fallbackEvents(SEGS);
  assert.equal(evs.length, 2);
  assert.equal(evs[1].action, SEGS[1].text);
  assert.equal(evs[1].effect, 'none');
});
