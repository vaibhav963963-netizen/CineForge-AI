// CineForge stage 1: narration → events. No network: the provider is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNarration, validateEvents, fallbackEvents, EVENT_SCHEMA, MAX_EVENTS_PER_SEGMENT } from '../dashboard/lib/cineforge/narrative-analyzer.js';

const SEGS = [
  { id: 'S1', text: 'The asteroid approached Earth, entered its atmosphere, and collided with the surface.', subject: 'asteroid', environment: 'space' },
  { id: 'S2', text: 'Dust rose over the crater.', subject: 'dust', environment: 'surface' },
];
const GOOD = {
  events: [
    { segmentId: 'S1', subject: 'asteroid', action: 'approaches Earth', environment: 'space', camera: 'wide establishing' },
    { segmentId: 'S1', subject: 'asteroid', action: 'enters the atmosphere', environment: 'upper atmosphere', camera: 'slow push-in' },
    { segmentId: 'S1', subject: 'asteroid', action: 'impacts the surface', environment: 'surface', camera: 'impact close-up' },
    { segmentId: 'S2', subject: 'dust', action: 'rises over the crater', environment: 'surface', camera: 'low medium' },
  ],
};
const replyWith = (obj) => async () => ({ text: JSON.stringify(obj) });

test('schema is strict: every field required, no extra properties', () => {
  assert.equal(EVENT_SCHEMA.additionalProperties, false);
  assert.deepEqual(EVENT_SCHEMA.required, ['events']);
  assert.equal(EVENT_SCHEMA.properties.events.items.additionalProperties, false);
});

test('one segment can yield several events; events get stable ids in order', async () => {
  const r = await analyzeNarration(SEGS, { chatFn: replyWith(GOOD) });
  assert.equal(r.source, 'groq');
  assert.deepEqual(r.errors, []);
  assert.equal(r.events.filter((e) => e.segmentId === 'S1').length, 3);
  assert.deepEqual(r.events.map((e) => e.id), ['E001', 'E002', 'E003', 'E004']);
});

test('invalid output falls back to one event per segment and names the errors', async () => {
  const bad = { events: [{ segmentId: 'S9', subject: 'x', action: 'y', environment: 'z', camera: 'w' }] };
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

test('too many events for one segment is rejected', () => {
  const many = Array.from({ length: MAX_EVENTS_PER_SEGMENT + 1 }, (_, i) => ({ segmentId: 'S2', subject: 'a', action: `b${i}`, environment: 'c', camera: 'd' }));
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
  const ev = fallbackEvents(SEGS);
  assert.equal(ev.length, 2);
  assert.equal(ev[1].action, SEGS[1].text);
});
