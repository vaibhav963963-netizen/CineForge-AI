// Single-request script generation: local sentence repair and the render-input check (no model calls).
import test from 'node:test';
import assert from 'node:assert/strict';
import { repairSentences, sceneSchemaIssues } from '../dashboard/lib/scriptgen.js';

const HI = { language: { id: 'hi-conversational', code: 'hi', script: 'Deva' } };
const EN = { language: { id: 'en', code: 'en', script: 'Latn' } };
const HING = { language: { id: 'hinglish', code: 'hi', script: 'Latn' } };

test('a clipped Hindi habitual verb gets its auxiliary; negatives and past forms stay', () => {
  const v = repairSentences(HI, { script: { lines: [{ text: 'हर हार्ट गिल्स में खून पंप करता।' }, { text: 'मेमोरी सेल्स लंबे समय तक रहते।' }, { text: 'बारिश नहीं होती।' }, { text: 'यह रास्ता था।' }] }, meta: {} });
  assert.deepEqual(v.script.lines.map((l) => l.text), ['हर हार्ट गिल्स में खून पंप करता है।', 'मेमोरी सेल्स लंबे समय तक रहते हैं।', 'बारिश नहीं होती।', 'यह रास्ता था।']);
  assert.equal(v.meta.localRepairs.length, 2);
});

test('English scripts are never touched by the Hindi repair', () => {
  const val = { script: { lines: [{ text: 'It keeps going.' }] }, meta: {} };
  assert.equal(repairSentences(EN, val), val);
});

test('render input check: a complete scene passes, missing fields are named', () => {
  const ok = { title: 'T', lines: [{ text: 'A rainbow forms when sunlight meets raindrops.', visual: 'Wide shot of a rainbow over wet fields after rain.' }] };
  assert.deepEqual(sceneSchemaIssues(EN, ok), []);
  const bad = { title: '', lines: [{ text: '', visual: 'sky' }] };
  const iss = sceneSchemaIssues(EN, bad);
  assert.ok(iss.some((x) => /no title/.test(x)) && iss.some((x) => /narration text is missing/.test(x)) && iss.some((x) => /visual description/.test(x)));
  assert.ok(sceneSchemaIssues(HING, ok).some((x) => /Devanagari voice text/.test(x)));
  assert.ok(sceneSchemaIssues(HI, ok).some((x) => /not in Devanagari/.test(x)));
});
