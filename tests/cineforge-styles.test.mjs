// CineForge visual styles: each style plans only its own sets, the prompt and schema follow the style, and an unknown style is
// an error. No network: the provider is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, setsFor, DEFAULT_STYLE } from '../dashboard/lib/cineforge/styles.js';
import { eventSchema, systemPrompt, validateEvents, analyzeNarration } from '../dashboard/lib/cineforge/narrative-analyzer.js';
import { validateShots, planShots } from '../dashboard/lib/cineforge/shot-planner.js';

const SEG = [{ id: 'S1', start: 0, end: 3 }];
const base = (set) => ({ segmentId: 'S1', subject: 'man', action: 'walks', environment: 'corridor', set, startState: 'at the door', endState: 'at the stairs', caption: 'The *corridor', motion: 'approach', camera: 'push', shotSize: 'wide', lighting: 'night-ambient', effect: 'none', transition: 'cut' });

test('every style lists its sets, with a description for each', () => {
  for (const [id, s] of Object.entries(STYLES)) {
    assert.ok(s.label, `${id} has a label`);
    assert.ok(s.sets.length >= 2, `${id} has sets`);
    for (const set of s.sets) assert.ok(s.setHelp[set], `${id}.${set} has a description`);
  }
  assert.equal(DEFAULT_STYLE, 'deep-dive');
});

test('the Night File schema allows only its own sets; the Deep Dive schema allows only its own', () => {
  assert.deepEqual(eventSchema('night-file').properties.events.items.properties.set.enum, ['corridor', 'house', 'casewall']);
  assert.deepEqual(eventSchema('deep-dive').properties.events.items.properties.set.enum, setsFor('deep-dive'));
});

test('the prompt names the style and describes only that style\'s sets', () => {
  const p = systemPrompt('night-file');
  assert.match(p, /Night File 3D/);
  assert.match(p, /corridor = /);
  assert.doesNotMatch(p, /kitchen/);
});

test('an event with another style\'s set is rejected', () => {
  const v = validateEvents({ events: [base('kitchen')] }, SEG, { style: 'night-file' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((m) => /set "kitchen" is not allowed/.test(m)));
  assert.equal(validateEvents({ events: [base('corridor')] }, SEG, { style: 'night-file' }).ok, true);
});

test('a shot plan with another style\'s set is rejected by the shot validator too', () => {
  const { shots } = planShots([{ id: 'E1', ...base('kitchen') }, { id: 'E2', ...base('corridor') }, { id: 'E3', ...base('house') }], SEG);
  const v = validateShots(shots, SEG, { style: 'night-file' });
  assert.ok(v.errors.some((m) => /set "kitchen" is not allowed/.test(m)));
});

test('the analyzer sends the style\'s schema and prompt to the provider', async () => {
  let sent = null;
  await analyzeNarration([{ id: 'S1', text: 'She never came home.' }], { style: 'night-file', chatFn: async (req) => { sent = req; return { text: JSON.stringify({ events: [base('corridor')] }) }; } });
  assert.deepEqual(sent.schema.properties.events.items.properties.set.enum, ['corridor', 'house', 'casewall']);
  assert.match(sent.messages[0].content, /Night File 3D/);
});

test('an unknown style is an error, never a silent fallback', () => {
  assert.throws(() => setsFor('pixar'), /unknown style "pixar"/);
});
