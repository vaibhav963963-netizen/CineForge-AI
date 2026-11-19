// Step 1: echoed list numbering ("1।", "१.", "(1)" …) must not be read as a new number; real numbers stay protected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripNumbering, fitLength, estimateSeconds } from '../dashboard/lib/scriptgen.js';

test('stripNumbering removes every numbering variant and keeps real narration numbers', () => {
  for (const x of ['1। वाक्य।', '१. वाक्य।', '(1) वाक्य।', '(१) वाक्य।', '1) वाक्य।', '१) वाक्य।', '१। वाक्य।', '1. वाक्य।', '1: वाक्य।', '1.(about 29% shorter) वाक्य।', ' 7 ।वाक्य।']) assert.equal(stripNumbering(x), 'वाक्य।', x);
  for (const x of ['1.6 million फीट प्रति सेकंड।', '1796 में जेनर ने टीका बनाया।', '2014 में भारत पोलियो-मुक्त हुआ।', '3-4 दिन लगते हैं।', 'तीन दिल होते हैं।']) assert.equal(stripNumbering(x), x, x);
});

const HG = { topic: 'Why do octopuses have three hearts?', durationSeconds: 10, language: { id: 'hinglish', code: 'hi', script: 'Latn', captionScript: 'Latn', name: 'Hinglish' }, narration: { voice: 'no_such_voice_for_tests', speed: 1, delivery: { lead: 0.3, outro: 1, gap: 0.3 } } };
const long = ['ऑक्टोपस के पास तीन दिल होते हैं, और यह बात सच में बहुत ही ज़्यादा हैरान करने वाली है।', 'दो दिल गलफड़ों से खून पंप करते हैं, जहाँ पानी से ऑक्सीजन ली जाती है, बहुत ध्यान से।', 'सन 1796 के बारे में नहीं, बल्कि आज के समुद्र में यह जीव 3 दिलों से जीता है, हर दिन।'];
const value = () => ({ script: { title: 't', lines: long.map((say) => ({ text: 'x', say, visual: 'v' })) }, meta: {} });
const fake = (lines) => async ({ messages, schema }) => {
  if (schema?.properties?.sameMeaning) return { text: JSON.stringify({ sameMeaning: true, lost: '' }), truncated: false };   // semantic review: agree by default
  const t = messages[1].content.match(/^  LINE: (.*)$/m)[1], i = long.indexOf(t);
  return { text: JSON.stringify({ line: i >= 0 ? lines[i] : t }), truncated: false };
};

test('fitLength (Hinglish): numbered rewrites are accepted, diagnostics record raw/normalized/say/sizes', async () => {
  const out = ['1। ऑक्टोपस के पास तीन दिल होते हैं, और यह बात ज़्यादा हैरान करने वाली है।', '(२) दो दिल गलफड़ों से खून पंप करते हैं, जहाँ पानी से ऑक्सीजन ली जाती है।', '३. सन 1796 के बारे में नहीं, आज के समुद्र में यह जीव 3 दिलों से जीता है, हर दिन।'];
  const r = await fitLength(HG, value(), { chatFn: fake(out) });
  const e = { ...r.meta.lengthFitLog[0], lines: r.meta.lengthFitLog.flatMap((x) => x.lines || []) };
  // each numbered line is accepted on its first call; later calls on the already-shortened line are copies
  assert.equal(e.lines.filter((x) => x.result === 'accepted').length, 3, JSON.stringify(e.lines.map((x) => x.reason)));
  assert.ok(e.lines.filter((x) => x.result === 'rejected').every((x) => /unchanged/.test(x.reason)));
  const d = e.lines.find((x) => x.line === 1 && x.result === 'accepted');
  for (const k of ['raw', 'normalized', 'original', 'candidate', 'say', 'originalSize', 'candidateSize', 'originalWords', 'candidateWords', 'originalSeconds', 'candidateSeconds']) assert.ok(k in d, k);
  assert.equal(d.raw, out[0]); assert.equal(d.normalized, 'ऑक्टोपस के पास तीन दिल होते हैं, और यह बात ज़्यादा हैरान करने वाली है।'); assert.ok(d.candidateSize < d.originalSize);
  assert.equal(e.target, 10); assert.equal(e.attempt, 1);
  assert.ok(estimateSeconds(r.script, HG).seconds < estimateSeconds(value().script, HG).seconds);
});

test('fitLength: a rewrite that truly invents or drops a number is still rejected', async () => {
  const out = ['1। ऑक्टोपस के 5 दिल होते हैं।', '2। दो दिल खून पंप करते हैं।', '3। आज यह जीव दिलों से जीता है।'];
  const e = { lines: (await fitLength(HG, value(), { chatFn: fake(out) })).meta.lengthFitLog.flatMap((x) => x.lines || []).sort((x, y) => x.line - y.line) };
  const why = (n) => e.lines.filter((x) => x.line === n).map((x) => x.reason).join(' | ');
  assert.match(why(1), /introduced a number \(5\)/);
  assert.match(why(3), /dropped a number/);
});
