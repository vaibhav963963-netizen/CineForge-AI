// Script quality regressions — every input below is a real line the local model produced on 2026-11-12.
//   node --test tests/script-quality.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEnd, danglingLine, fillerTail, westernPunct, onScreenFor, asciiDigits, qualityProblems, checkLanguage, lineCount } from '../dashboard/lib/scriptgen.js';
import { reviewClaims, findTopicFacts } from '../dashboard/lib/factcheck.js';

const HI = { language: { script: 'Deva', id: 'hi-conversational', code: 'hi', name: 'Hindi' }, durationSeconds: 40 };
const EN = { language: { script: 'Latn', id: 'en', code: 'en', name: 'English' }, durationSeconds: 30 };

test('sentence ends: leaked JSON quotes, doubled marks and "|" dandas become one mark', () => {
  assert.equal(cleanEnd('अधिकांश हिंदू मंदिरों में घंटा लटका होता है।”,।'), 'अधिकांश हिंदू मंदिरों में घंटा लटका होता है।');
  assert.equal(cleanEnd('इसरो ने कम बजट में कमाल किया! ?'), 'इसरो ने कम बजट में कमाल किया!');
  assert.equal(cleanEnd('ये तो एकदम धांसू है, समझे? |।'), 'ये तो एकदम धांसू है, समझे?');
  assert.equal(cleanEnd('यह हिस्सा है'), 'यह हिस्सा है।');
  assert.equal(cleanEnd('The bell rings.",', false), 'The bell rings.');
});

test('CJK punctuation leaked into English is normalised', () => {
  assert.equal(westernPunct('Roopkund is a glacial lake in Uttarakhand。'), 'Roopkund is a glacial lake in Uttarakhand.');
});

test('half-sentences and padded endings are detected; complete sentences are not', () => {
  for (const t of ['अधिकांश मंदिरों में घंटा लटकाया जाता है, तो', 'भक्त प्रवेश से पहले घंटा बजाते हैं, फिर', 'यह नकारात्मक ऊर्जा दूर करती है, निश्चित रूप से', 'इसरो ने कमाल कर दिया और', 'The bell rings, and']) assert.ok(danglingLine(t), t);
  for (const t of ['It’s known as Skeleton Lake, sadly.', 'Madhwal discovered remains in 1942, then.', 'The Mediterranean group died around 1800 CE, but…', 'Groups died separately, roughly speaking.', 'भारत में मंदिरों में घंटी लगी होती है, सच में।']) assert.ok(fillerTail(t), t);
  for (const t of ['भारत में मंदिरों में घंटियाँ क्यों हैं?', 'फिर, एक दिसंबर 2013 को मार्स के लिए चला।', 'One group had South Asian ancestry.', 'Then the bones appear.']) { assert.ok(!danglingLine(t), t); assert.ok(!fillerTail(t), t); }
});

test('quality problems: Hindi "visual", fragments, padded endings', () => {
  const p = qualityProblems({ lines: [{ text: 'पांच नवंबर 2013 को, लॉन्च हुआ था।', visual: 'लॉन्चपैड का वाइड शॉट' }, { text: 'एक महीना।', visual: 'Earth orbit' }, { text: 'It sits high, sadly.', visual: 'a lake' }] }, HI);
  assert.ok(p.some((x) => /English sentence/.test(x)) && p.some((x) => /fragments/.test(x)) && p.some((x) => /filler/.test(x)), p.join(' | '));
  assert.deepEqual(qualityProblems({ lines: [{ text: 'Roopkund is a glacial lake high in the Himalayas.', visual: 'A frozen lake below snowy peaks.' }, { text: 'Every summer, melting ice reveals hundreds of bones.', visual: 'Bones on rocks by the shore.' }] }, EN), []);
});

test('on-screen text must repeat what the same line says', () => {
  assert.equal(onScreenFor({ text: 'इसरो ने एकदम कमाल कर दिखाया।', onScreen: 'बेंगलुरु' }).onScreen, undefined);
  assert.equal(onScreenFor({ text: '450 करोड़ का मिशन था।', onScreen: '₹450 करोड़' }).onScreen, '₹450 करोड़');
});

test('Devanagari digits are read by the number checks', () => {
  assert.equal(asciiDigits('२४ सितंबर २०१४, ८ साल'), '24 सितंबर 2014, 8 साल');
});

test('letters from another script inside a Hindi line are refused', () => {
  const p = checkLanguage({ lines: [{ text: 'इसरो ने दिखाया कि बड़ी бюдजीट भी नहीं टिकती।' }, { text: 'मंगलयान 5 नवंबर 2013 को लॉन्च हुआ, ₹450 करोड़ में!' }] }, HI);
  assert.equal(p.length, 1); assert.match(p[0], /line 1 .*another script/);
});

test('line count: Hindi written directly gets longer lines, English keeps 3.4 s per line', () => {
  assert.equal(lineCount(HI), 10); assert.equal(lineCount({ ...EN, durationSeconds: 30 }), 9);
});

test('fact check: a number the facts give in metres is not accepted in feet (seen: "5,020 feet")', () => {
  const rk = findTopicFacts('The Mystery of Roopkund, the Skeleton Lake of the Himalayas');
  const st = (t) => reviewClaims({ lines: [{ text: t }] }, { topic: 'Roopkund', topicFacts: rk }).claims.find((c) => c.kind === 'number').status;
  assert.equal(st('It’s at about 5,020 feet.'), 'unverified');
  assert.equal(st('It sits at about 5,020 metres.'), 'supported');
  assert.equal(st('It lies at about 16,470 feet.'), 'supported');
});

test('fact check: known-error keys match only with their currency and as whole numbers', () => {
  const is = findTopicFacts('How ISRO Reached Mars for Less Than the Budget of the Movie Gravity');
  const known = (t) => reviewClaims({ lines: [{ text: t }] }, { topic: 'ISRO', topicFacts: is }).claims.some((c) => c.kind === 'known error');
  assert.equal(known('ग्रेविटी का खर्चा लगभग 100 मिलियन अमेरिकी डॉलर था।'), false);
  assert.equal(known('ग्रेविटी का बजट ₹100 करोड़ था।'), true);
  assert.equal(known('Gravity cost ₹ 100 crore.'), true);
});

test('fact check: a verified number on the topic itself is not a "wrong subject"; Gravity ₹450 crore still is', () => {
  const rk = findTopicFacts('The Mystery of Roopkund, the Skeleton Lake of the Himalayas'), is = findTopicFacts('How ISRO Reached Mars for Less Than the Budget of the Movie Gravity');
  const num = (r) => r.claims.find((c) => c.kind === 'number');
  assert.equal(num(reviewClaims({ lines: [{ text: 'Roopkund lies at about 5,020 metres high in the Himalayas.' }] }, { topic: 'Roopkund', topicFacts: rk })).status, 'supported');
  assert.equal(num(reviewClaims({ lines: [{ text: 'ग्रेविटी फिल्म का बजट ₹450 करोड़ था।' }] }, { topic: 'ISRO', topicFacts: is })).status, 'unverified');
  assert.equal(num(reviewClaims({ lines: [{ text: 'ग्रेविटी का बजट 10 करोड़ डॉलर था।' }] }, { topic: 'ISRO', topicFacts: is })).status, 'supported');
});
