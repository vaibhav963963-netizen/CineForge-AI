// Regressions from the Moon Hindi audit: visual-text corruption, stock onlookers, Hindi filler, fact-file terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { visualText, chooseVisual, visualProblems, storyProblems } from '../dashboard/lib/scriptgen.js';
import { findTopicFacts } from '../dashboard/lib/factcheck.js';

test('visual normalisation never removes letters (seen: "Wide  hot", "Clo e-up", "A  tylized illu tration")', () => {
  for (const s of ['Wide shot of the Moon', 'Close-up shot of a stylized illustration', 'Aerial view showing the Moon’s orbit, stars and Earth']) {
    const out = chooseVisual(s + ' in space tonight', 'fallback');
    for (const w of visualText(s).split(/\s+/)) assert.ok(out.includes(w.replace(/[,]/g, '')), `${w} missing in "${out}"`);
  }
  assert.equal(visualText('Close-up  shot\n of\tglass'), 'Close-up shot of glass');
  assert.equal(visualText('stars, sun, ships'), 'stars, sun, ships');
});

test('no regex in scriptgen collapses the letter "s" (only whitespace may be collapsed)', () => {
  const src = fs.readFileSync(new URL('../dashboard/lib/scriptgen.js', import.meta.url), 'utf8');
  assert.ok(!/replace\(\/s\+\/g/.test(src)); assert.ok(!/\/,s\*with/.test(src));
});

test('visuals: a stock onlooker over a science line is flagged; people in a line about people are not', () => {
  const sc = { lines: [{ text: 'x', visual: 'Wide shot of a young boy, wide-eyed with wonder, standing on a grassy hilltop gazing at the full moon.' }, { text: 'y', visual: 'Medium shot of Sher Shah Suri inspecting a roadside sarai with travellers resting.' }] };
  const p = visualProblems(sc, { englishLines: ['The Moon always shows Earth the same face.', 'Sher Shah Suri built sarais where travellers could rest.'], topic: 'x' });
  assert.equal(p.length, 1); assert.match(p[0], /^line 1: shows people/);
});

test('Hindi filler on the hook ("ये बहुत अजीब है") is flagged', () => {
  assert.ok(storyProblems({ lines: [{ text: 'चाँद हमेशा पृथ्वी की ओर एक ही चेहरा दिखाता है, ये बहुत अजीब है।' }, { text: 'इसकी वजह पृथ्वी की ग्रेविटी है।' }, { text: 'इसलिए हम उसका दूसरा हिस्सा कभी नहीं देखते।' }] }).some((x) => /filler/.test(x)));
});

test('fact files can carry established Hindi terms (used in the writer prompt)', () => {
  const f = findTopicFacts('Why does the Moon always show the same face to Earth?');
  assert.equal(f.terms.hi.libration, 'लिब्रेशन'); assert.match(f.terms.hi['tidal locking'], /टाइडल लॉकिंग/);
});
import { stripLeaks } from '../dashboard/lib/scriptgen.js';
test('planning notes copied into narration are removed (seen: "… [facts: A vaccine shows …]", "। [।")', () => {
  assert.equal(stripLeaks('Vaccines show the immune system a harmless piece. [facts: A vaccine shows the immune'), 'Vaccines show the immune system a harmless piece.');
  assert.equal(stripLeaks('यह खंडित था और चलना मुश्किल था। [।'), 'यह खंडित था और चलना मुश्किल था।');
  assert.equal(stripLeaks('A normal line [with brackets] stays.'), 'A normal line [with brackets] stays.');
});
test('"[visual: …]" notes copied into narration are removed (seen in GT Road English)', () => {
  assert.equal(stripLeaks('Serais offered rest for travelers on the Uttarapath. [visual: A traditional sarai – a stone building – with travelers resting.]'), 'Serais offered rest for travelers on the Uttarapath.');
});
import { ungrounded as UG, storyProblems as SP } from '../dashboard/lib/scriptgen.js';
test('bare "Visual: …" notes, "Did" as a name, and "अद्भुत रहस्य" endings (seen in the audience-first run)', () => {
  assert.equal(stripLeaks('B cells produce antibodies, marking the germ for elimination. Visual: Microscopic view of B cells.'), 'B cells produce antibodies, marking the germ for elimination.');
  assert.deepEqual(UG(['Did you know that vaccines train your body?'], 'vaccines train the immune system'), []);
  assert.ok(SP({ lines: [{ text: 'चाँद हमेशा एक ही तरफ़ क्यों दिखता है?' }, { text: 'इसकी वजह पृथ्वी की ग्रेविटी है।' }, { text: 'इसलिए चाँद हमेशा एक ही तरफ़ दिखाता है, एक अद्भुत रहस्य!' }] }).some((p) => p.startsWith('line 3')));
});
