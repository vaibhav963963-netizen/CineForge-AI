// Story-level checks (Stage D, deterministic part) — topic independent, no model needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { storyProblems } from '../dashboard/lib/scriptgen.js';
const S = (...t) => ({ lines: t.map((text) => ({ text, visual: 'x' })) });

test('generic Hindi and English openers are flagged', () => {
  for (const first of ['सुनो, इसरो ने कमाल किया।', 'क्या आप जानते हैं?', 'Did you know this?', 'Today we are going to talk about Roopkund.'])
    assert.ok(storyProblems(S(first, 'Then the engine fired.', 'It reached orbit.')).some((p) => p.startsWith('line 1')), first);
});
test('generic endings are flagged, concrete endings are not', () => {
  assert.ok(storyProblems(S('A rover found ice.', 'It drilled 2 metres.', 'यह भारत के लिए गर्व की बात है!')).some((p) => p.startsWith('line 3')));
  assert.deepEqual(storyProblems(S('A rover found ice under the dust.', 'It drilled two metres into the crater floor.', 'So the next base may be built where the water is.')), []);
});
test('a number repeated later is flagged, a comparison is not', () => {
  assert.ok(storyProblems(S('The mission cost 450 crore.', 'Engineers tested every bolt.', 'Only 450 crore was spent.')).some((p) => /repeats the number 450/.test(p)));
  assert.deepEqual(storyProblems(S('The mission cost 450 crore.', 'Engineers tested every bolt twice.', 'NASA spent far more than 450 crore on its probe.')), []);
});
test('near-duplicate lines are flagged', () => {
  assert.ok(storyProblems(S('Roopkund lake holds hundreds of human skeletons.', 'Scientists tested the bones.', 'Hundreds of human skeletons lie in Roopkund lake.')).some((p) => /nearly the same/.test(p)));
});
test('works on every topic, not one example', () => {
  const ok = S('A tiny octopus can change colour in 200 milliseconds.', 'Its skin hides millions of pigment sacs.', 'Muscles squeeze them open like umbrellas.', 'That is why a predator loses it against coral.');
  assert.deepEqual(storyProblems(ok), []);
});
test('telegraphic fragments and stock "cool design" endings are flagged', () => {
  const p = storyProblems(S('An octopus shifts color.', 'Camouflage costs energy.', 'Circulation is complex.', 'Three hearts, quite strange.', 'Three hearts – a cool design indeed!'));
  assert.ok(p.some((x) => /clipped fragments/.test(x))); assert.ok(p.some((x) => x.startsWith('line 5')));
});
test('narration that describes the picture, and textbook Hindi in Hinglish, are flagged', () => {
  assert.ok(storyProblems(S('चाँद का गहरा चित्र, छाया के साथ स्क्रीन पर।', 'फिर पृथ्वी ने उसे धीमा किया।', 'इसलिए हम हमेशा एक ही चेहरा देखते हैं।')).some((x) => /describe the picture/.test(x)));
  assert.ok(storyProblems(S('Do hriday rakt ko gills tak bhejte hain.', 'Teesra dil body ko blood deta hai.', 'Isliye octopus tez tair pata hai.')).some((x) => /textbook Hindi/.test(x)));
});
import { missingEssentials, phoneticDeva, qualityGates } from '../dashboard/lib/scriptgen.js';
test('coverage: an essential person left out is reported; mentioned ones are not', () => {
  const r = { essentials: ['Sher Shah Suri', 'Mughal Empire', 'Grand Trunk Road'] };
  assert.deepEqual(missingEssentials(r, 'The Mughals rebuilt the Grand Trunk Road with brick.'), ['Sher Shah Suri']);
  assert.deepEqual(missingEssentials(r, 'Sher Shah Suri rebuilt the Grand Trunk Road; later the Mughal emperors kept it.'), []);
  assert.deepEqual(missingEssentials(r, 'शेर शाह सूरी ने सड़क बनवाई।'), ['Mughal Empire', 'Grand Trunk Road']);   // native Hindi: matched across scripts
});
test('Hindi verb-in-the-middle order and "देखें!" endings are flagged', () => {
  const p = storyProblems(S('शेर शाह सूरी ने यह सड़क दोबारा बनवाई।', 'स्थिर रखरखाव से सड़क बनी रही सालों।', 'आज भी इसके हिस्से मौजूद हैं, देखें!'));
  assert.ok(p.some((x) => /verb comes at the end/.test(x))); assert.ok(p.some((x) => x.startsWith('line 3')));
});
test('a leftover Latin name is spelled in Devanagari', () => { assert.match(phoneticDeva('Tycho'), /^[ऀ-ॿ]+$/); assert.equal(phoneticDeva('kamal'), 'कमल'); });
test('gates: no verified source → facts gate "needs research", never Ready', () => {
  const config = { durationSeconds: 30, topic: 'x', language: { id: 'en', code: 'en', script: 'Latn', captionScript: 'Latn', name: 'English' }, narration: { voice: 'af_heart', speed: 1, delivery: { lead: 0.3, outro: 1, gap: 0.3 } } };
  const g = qualityGates(config, { script: { lines: [{ text: 'The Moon turns once on its axis for every trip around Earth.', visual: 'x' }] }, meta: { research: { essentials: [], evidence: [{ text: 'a', source: 'model' }] }, claimReview: { claims: [] } } });
  assert.equal(g.facts.ok, false); assert.equal(g.facts.needsResearch, true);
});
import { ungrounded } from '../dashboard/lib/scriptgen.js';
test('grounding: names and numbers missing from every source are reported', () => {
  const src = 'Sher Shah Suri rebuilt the Grand Trunk Road in the 16th century. The Mughal emperors kept it in use.';
  const u = ungrounded(['Akbar ordered a paved road to Bengal.', 'Sher Shah Suri rebuilt it with sarais.', 'Today, 12,000 vehicles still use the road.'], src);
  assert.deepEqual(u.map((x) => x.line), [1, 3]); assert.ok(u[0].terms.includes('Akbar')); assert.ok(u[1].terms.includes('12000') || u[1].terms.some((t) => /12/.test(t)));
});
import { visualProblems } from '../dashboard/lib/scriptgen.js';
test('visuals: a stock smiling-person / Mumbai-street shot over a Mars line is flagged; a matching shot is not', () => {
  const sc = { lines: [{ text: 'मंगलयान ने 2014 में मंगल की कक्षा में प्रवेश किया।', visual: 'A smiling man on a busy Mumbai street.' }, { text: 'x', visual: 'Close-up of the Mangalyaan spacecraft firing its engine near Mars.' }] };
  const p = visualProblems(sc, { englishLines: ['Mangalyaan entered Mars orbit in 2014.', 'Its engine fired near Mars to slow it down.'], topic: 'How ISRO reached Mars' });
  assert.equal(p.length, 1); assert.match(p[0], /^line 1/);
});
test('Hinglish grounding: an English name that no source has is reported', () => {
  assert.deepEqual(ungrounded(['Tycho 1959', 'Moon Earth'], 'The Moon and Earth. Luna 3 photographed it in 1959.').map((u) => u.terms), [['Tycho']]);
});
import fsx from 'node:fs';
test('reference script (user-supplied quality target) passes the story and visual checks — no false positives', () => {
  const ref = JSON.parse(fsx.readFileSync(new URL('./fixtures/reference-mars-hi.json', import.meta.url), 'utf8'));
  const sc = { lines: ref.lines.map((l) => ({ text: l.text, visual: l.visual })) };
  assert.deepEqual(storyProblems(sc), []);
  assert.deepEqual(visualProblems(sc, { englishLines: ref.lines.map((l) => l.en), topic: ref.topic }), []);
  assert.deepEqual(storyProblems({ lines: ref.lines.map((l) => ({ text: l.en })) }), []);
});
test('reference script is fully grounded in the ISRO fact file', async () => {
  const { findTopicFacts } = await import('../dashboard/lib/factcheck.js');
  const ref = JSON.parse(fsx.readFileSync(new URL('./fixtures/reference-mars-hi.json', import.meta.url), 'utf8')), f = findTopicFacts(ref.topic);
  assert.deepEqual(ungrounded(ref.lines.map((l) => l.en), [ref.topic, ...f.verified.map((v) => v.text), ...f.aliases].join(' ')), []);
});
test('exclamation on every line and filler reactions are flagged', () => {
  const p = storyProblems(S('चाँद हमेशा एक ही तरफ दिखाता है, जानकर आप हैरान हो जाएंगे!', 'पहले चाँद तेज़ घूमता था!', 'धरती ने उसे धीमा किया!', 'ज्वारीय बंधन बहुत दिलचस्प है!', 'आज हम उसका एक ही चेहरा देखते हैं!'));
  assert.ok(p.some((x) => /end with "!"/.test(x))); assert.ok(p.some((x) => /filler reaction/.test(x)));
});

test('audience-first hooks: a curiosity question that names the specific idea passes; an empty one does not', () => {
  const ok = (h) => !storyProblems(S(h, 'Then the engine fired over the ocean.', 'So the satellite reached its orbit.')).some((p) => p.startsWith('line 1'));
  assert.ok(ok('क्या आप जानते हैं कि चाँद हमें हमेशा अपना एक ही चेहरा क्यों दिखाता है?'));
  assert.ok(ok('Have you ever wondered why the Moon always shows us the same face?'));
  assert.ok(!ok('क्या आप जानते हैं?')); assert.ok(!ok('एक मिनट, सुनो!'));
});
