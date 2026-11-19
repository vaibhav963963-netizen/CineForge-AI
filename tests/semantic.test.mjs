// Step 4: meaning preservation — deterministic first pass, narrow semantic review (fail-safe), final-script
// verification, and the Persian/Arabic-letter failure in Hinglish. Cases are the real Step 3 rewrites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { meaningDiff, blocking, semanticReview, verifyScriptMeaning } from '../dashboard/lib/semantic.js';
import { fitLength, estimateSeconds, checkLanguage, persianPlural, qualityGates } from '../dashboard/lib/scriptgen.js';

const caught = (a, b, re) => { const d = meaningDiff(a, b), bl = blocking(d); assert.ok(bl.some((c) => re.test(`${c.type}: ${c.detail}`)), JSON.stringify(d)); };
const passes = (a, b) => { const d = meaningDiff(a, b); assert.deepEqual(blocking(d), [], JSON.stringify(d)); return d; };

// ── actual Step 3 failures ─────────────────────────────────────────────────────────────────────────────────────
test('dropped destination: "खून को पूरे शरीर में पहुंचाता है" → "खून पहुंचाता है"', () => caught('सिस्टेमिक हार्ट खून को पूरे शरीर में पहुंचाता है।', 'सिस्टेमिक हार्ट खून पहुंचाता है।', /location.*शरीर|qualifier.*पूरे/));
test('dropped place names: "बर्मूडा, फ्लोरिडा और पुर्तगाल के बीच"', () => caught('बर्मूडा त्रिकोण उत्तरी अटलांटिक महासागर में स्थित है, बर्मूडा, फ्लोरिडा और पुर्तगाल के बीच।', 'बर्मूडा त्रिकोण अटलांटिक महासागर में स्थित है।', /entity.*फ्लोरिडा/));
test('changed cause-and-effect: "mistakes cause accidents" → "mistakes come from pilots"', () => caught('गलतियाँ पायलटों और कप्तानों के कारण दुर्घटनाओं का कारण बन सकती हैं।', 'गलतियाँ पायलटों और कप्तानों से होती हैं।', /relationship.*कारण/));
test('a theory stated as fact: "शायद … मदद करता है" → "… पंप करता है"', () => caught('शायद, अतिरिक्त ब्रांकियल हार्ट रक्त को तेजी से पंप करने में मदद करता है, जिससे ऑक्टोपस जीवित रहता है।', 'अतिरिक्त ब्रांकियल हार्ट रक्त को तेजी से पंप करता है, जिससे ऑक्टोपस जीवित रहता है।', /certainty.*शायद/));
test('dropped qualifier and descriptive destination: "शरीर के बाकी हिस्सों तक, जैसे भुजाएँ और मस्तिष्क"', () => caught('सिस्टेमिक हार्ट ऑक्सीजन से भरपूर रक्त को शरीर के बाकी हिस्सों तक पहुँचाता है, जैसे भुजाएँ और मस्तिष्क।', 'सिस्टेमिक हार्ट ऑक्सीजन रक्त पहुँचाता है।', /destination.*हिस्सों|qualifier.*बाकी/));
test('dropped quantity qualifier: "कई जहाज़" → "जहाज़"', () => caught('कई जहाज़ और हवाई जहाज़ दशकों से गायब हो गए हैं।', 'जहाज़ और हवाई जहाज दशकों से गायब हो गए।', /qualifier.*कई/));
test('changed subject (English): "Mistakes by pilots can cause accidents" → "Pilots make mistakes"', () => caught('Mistakes by pilots can cause accidents.', 'Pilots make mistakes.', /relationship|subject|certainty/));
test('changed factual relationship (English): destination dropped', () => caught('The systemic heart pumps blood to the whole body.', 'The systemic heart pumps blood.', /destination.*body|qualifier.*whole/));
test('negation flipped (Hindi and English)', () => { caught('ऑक्टोपस का खून लाल नहीं होता।', 'ऑक्टोपस का खून लाल होता है।', /negation/); caught('Vaccines do not cause autism.', 'Vaccines cause autism.', /negation/); });
test('object changed: "भुजाएँ और मस्तिष्क" → only "मस्तिष्क"', () => caught('हार्ट भुजाएँ और मस्तिष्क तक खून भेजता है।', 'हार्ट मस्तिष्क तक खून भेजता है।', /entity.*भुजा/));

// ── valid paraphrases must still pass (no excessive rejection) ─────────────────────────────────────────────────
test('valid: dropping a redundant "in the region" and a comma', () => passes('तूफान के मौसम में, क्षेत्र में तीव्र तूफान आते हैं, जिससे नेविगेशन मुश्किल हो जाता है।', 'तूफान के मौसम में तीव्र तूफान आते हैं, जिससे नेविगेशन मुश्किल हो जाता है।'));
test('valid: dropping filler ("सच में", "बहुत", "you know")', () => { passes('यह सच में बहुत हैरान करने वाली बात है।', 'यह हैरान करने वाली बात है।'); passes('The heart really pumps blood to the whole body, you know.', 'The heart pumps blood to the whole body.'); });
test('valid: word order and inflection changes', () => { passes('पृथ्वी हर दिन अपनी धुरी पर लगभग 24 घंटे में एक पूरा चक्कर लगाती है।', 'पृथ्वी हर दिन लगभग 24 घंटे में अपनी धुरी पर एक पूरा चक्कर लगाती है।'); passes('दो ब्रांकियल हार्ट्स गिल्स से खून पंप करते हैं।', 'दो ब्रांकियल हार्ट गिल्स से खून पंप करते हैं।'); });
test('valid: dropping a descriptive aside leaves an UNCERTAIN (reviewable) case, not a rejection', () => { const d = passes('खाड़ी धारा महासागर में एक शक्तिशाली नदी की तरह बहती है।', 'खाड़ी धारा महासागर में बहती है।'); assert.equal(d.uncertain, true); });

// ── semantic review: narrow, fail-safe ─────────────────────────────────────────────────────────────────────────
const reply = (obj, extra = {}) => async () => ({ text: JSON.stringify(obj), truncated: false, ...extra });
test('review: "same" accepted; "changed" rejected with what was lost', async () => {
  assert.equal((await semanticReview({ original: 'a', rewrite: 'b', chatFn: reply({ sameMeaning: true, lost: '' }) })).verdict, 'same');
  const r = await semanticReview({ original: 'a', rewrite: 'b', chatFn: reply({ sameMeaning: false, lost: 'the destination' }) });
  assert.equal(r.verdict, 'changed'); assert.match(r.lost, /destination/);
});
test('review fails SAFE: error, cut-off, malformed or contradictory answers are "unknown"', async () => {
  const cases = [async () => { throw new Error('fetch failed'); }, reply({ sameMeaning: true, lost: '' }, { truncated: true }), async () => ({ text: '{"ok":1}', truncated: false }), async () => ({ text: 'not json', truncated: false }), reply({ sameMeaning: true, lost: 'the place names' })];
  for (const chatFn of cases) assert.equal((await semanticReview({ original: 'a', rewrite: 'b', chatFn })).verdict, 'unknown');
  // the reviewer only answers; it is never asked to write text
  let sys = ''; await semanticReview({ original: 'a', rewrite: 'b', chatFn: async ({ messages, schema }) => { sys = messages[0].content; assert.deepEqual(Object.keys(schema.properties).sort(), ['lost', 'sameMeaning']); return { text: '{"sameMeaning":true,"lost":""}' }; } });
  assert.match(sys, /You do NOT rewrite anything/);
});

// ── fitting integration ────────────────────────────────────────────────────────────────────────────────────────
const HG = { topic: 'Why do octopuses have three hearts?', durationSeconds: 30, language: { id: 'hinglish', code: 'hi', script: 'Latn', captionScript: 'Latn', name: 'Hinglish' }, narration: { voice: 'no_such_voice_for_tests', speed: 1, delivery: { lead: 0.3, outro: 1, gap: 0.3 } } };
const OL = ['ऑक्टोपस के तीन दिल होते हैं।', 'सिस्टेमिक हार्ट खून को पूरे शरीर में पहुंचाता है और यह बहुत ज़रूरी काम है।', 'खाड़ी धारा महासागर में एक शक्तिशाली नदी की तरह बहती है, यह सच है।'];
const run = async (answers, review = { sameMeaning: true, lost: '' }) => {
  const v = { script: { title: 't', lines: OL.map((say) => ({ text: 'x', say, visual: 'v' })) }, meta: {} };
  let reviews = 0;
  const chatFn = async ({ messages, schema }) => {
    if (schema?.properties?.sameMeaning) { reviews++; return typeof review === 'function' ? review() : { text: JSON.stringify(review) }; }
    const t = messages[1].content.match(/^ {2}LINE: (.*)$/m)[1]; return { text: JSON.stringify({ line: answers[t] ?? t }) };
  };
  const out = await fitLength({ ...HG, durationSeconds: Math.round(estimateSeconds(v.script, HG).seconds / 1.3) }, v, { chatFn });
  return { out, reviews, reasons: out.meta.lengthFitLog.flatMap((e) => e.lines || []).map((l) => `L${l.line} ${l.result} ${l.reason || ''}`) };
};
test('fitting: a real destination loss is rejected deterministically (no model review spent)', async () => {
  const { out, reviews, reasons } = await run({ [OL[1]]: 'सिस्टेमिक हार्ट खून पहुंचाता है और यह ज़रूरी काम है।' });
  assert.ok(reasons.some((r) => /L2 rejected meaning: /.test(r)), reasons.join('\n')); assert.equal(out.script.lines[1].say, OL[1]); assert.equal(reviews, 0);
});
test('fitting: an uncertain rewrite goes to the review; "changed" → rejected, original kept', async () => {
  const { out, reviews, reasons } = await run({ [OL[2]]: 'खाड़ी धारा महासागर में बहती है, यह सच है।' }, { sameMeaning: false, lost: 'the comparison to a powerful river' });
  assert.ok(reviews >= 1); assert.ok(reasons.some((r) => /L3 rejected meaning changed \(review: the comparison/.test(r)), reasons.join('\n')); assert.equal(out.script.lines[2].say, OL[2]);
});
test('fitting: uncertain + review unavailable → "could not be verified", original kept (fails safe)', async () => {
  const { out, reasons } = await run({ [OL[2]]: 'खाड़ी धारा महासागर में बहती है, यह सच है।' }, () => { throw new Error('fetch failed'); });
  assert.ok(reasons.some((r) => /L3 rejected meaning could not be verified/.test(r)), reasons.join('\n')); assert.equal(out.script.lines[2].say, OL[2]);
});
test('fitting: a valid shortening (filler only) is accepted without any review', async () => {
  const { out, reviews } = await run({ [OL[1]]: 'सिस्टेमिक हार्ट खून को पूरे शरीर में पहुंचाता है और यह ज़रूरी काम है।' });
  assert.equal(out.script.lines[1].say, 'सिस्टेमिक हार्ट खून को पूरे शरीर में पहुंचाता है और यह ज़रूरी काम है।'); assert.equal(reviews, 0);
});
test('fitting: semantic reviews are capped per stage', async () => {
  const many = Object.fromEntries(OL.map((t) => [t, t.replace(/[^\s]+ /, '')]));   // every answer drops a word → uncertain
  const { reviews } = await run(many);
  assert.ok(reviews <= 3, `reviews ${reviews}`);
});

// ── final saved script verification (separate from fitting; never rewrites) ───────────────────────────────────
test('final verification: the SAVED lines are compared with the lines fitting found; structured findings with evidence', () => {
  const base = ['ऑक्टोपस के तीन दिल होते हैं।', 'सिस्टेमिक हार्ट खून को पूरे शरीर में पहुंचाता है।'];
  const value = { script: { lines: [{ text: 'x', say: base[0] }, { text: 'x', say: 'सिस्टेमिक हार्ट खून पहुंचाता है।' }] }, meta: { lengthFitBase: base, lengthFitLog: [] } };
  const before = JSON.stringify(value.script);
  const r = verifyScriptMeaning(HG, value, { file: 'facts/octopus-three-hearts.json', terms: { hi: { 'systemic heart': 'सिस्टमिक हार्ट (पूरे शरीर वाला दिल)' } }, verified: [{ text: 'The systemic heart pumps blood to the rest of the body.', keys: ['systemic'] }] });
  assert.equal(r.ok, false); assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.lineId, 'L2'); assert.equal(f.decision, 'needs review'); assert.ok(['high', 'medium'].includes(f.severity));
  assert.ok(f.changes.length); assert.equal(f.original, base[1]);
  assert.equal(JSON.stringify(value.script), before, 'verification never rewrites the script');
  const g = qualityGates(HG, { script: value.script, meta: { ...value.meta, claimReview: { claims: [] } } });
  assert.equal(g.meaning.ok, false); assert.match(g.meaning.issues[0], /^L2: /);
});
test('final verification: unchanged lines and cleared rewrites pass', () => {
  const value = { script: { lines: [{ text: 'x', say: 'ऑक्टोपस के तीन दिल होते हैं।' }] }, meta: { lengthFitBase: ['ऑक्टोपस के तीन दिल होते हैं।'] } };
  assert.equal(verifyScriptMeaning(HG, value).ok, true);
});

// ── Hinglish: Persian/Arabic letters ───────────────────────────────────────────────────────────────────────────
test('Arabic/Persian letters: the seen "दशक‌ها" is repaired to the Hindi plural; anything else still fails, naming the word', () => {
  assert.equal(persianPlural('दशक‌ها पहले, कई जहाज़ गायब हुए।'), 'दशकों पहले, कई जहाज़ गायब हुए।');
  assert.equal(persianPlural('दशकها पहले।'), 'दशकों पहले।');
  const p = checkLanguage({ lines: [{ text: 'x', say: 'यह कتاب पुरानी है।' }] }, HG);
  assert.ok(p.some((x) => /letters from another script .* in "कتाب"|in "कتاب"/.test(x) || /another script/.test(x)), JSON.stringify(p));
  assert.ok(p.some((x) => /entirely in Devanagari/.test(x)));
  // English and plain Hindi unaffected
  assert.deepEqual(checkLanguage({ lines: [{ text: 'Yeh sach hai.', say: 'यह सच है।' }] }, HG), []);
});

// ── Step 4 real run: rewrites the 4B semantic review APPROVED — now caught deterministically ─────────────────────
test('real (review approved it): a separate claim dropped — "…, पृथ्वी झुकी हुई है"', () => caught('कंपास उत्तरी दिशा की ओर इशारा करती है, पृथ्वी झुकी हुई है।', 'कंपास उत्तरी दिशा की ओर इशारा करती है।', /claim.*पृथ्वी झुकी/));
test('real (review approved it): "…, समुद्र अशांत होते हैं" dropped', () => caught('तूफान मौसम में अचानक बनते हैं, समुद्र अशांत होते हैं।', 'तूफान मौसम में अचानक बनते हैं।', /claim.*समुद्र अशांत/));
test('real (review approved it): location aside "– अटलांटिक महासागर का एक खास क्षेत्र –" dropped', () => caught('बर्मूडा त्रिकोण – अटलांटिक महासागर का एक खास क्षेत्र – का एक परेशान करने वाला इतिहास है।', 'बर्मूडा त्रिकोण का परेशान करने वाला इतिहास है।', /claim.*अटलांटिक/));
test('real (review approved it): "जो पानी से ऑक्सीजन खींचने के लिए छोटे फिल्टर हैं" → "ऑक्सीजन खींचता है"', () => caught('ब्रांकियल हार्ट दो गिल्स के माध्यम से रक्त पंप करते हैं, जो पानी से ऑक्सीजन खींचने के लिए छोटे फिल्टर हैं।', 'ब्रांकियल हार्ट दो गिल्स से रक्त पंप करता, ऑक्सीजन खींचता है।', /claim.*फिल्टर/));
test('real: one of two "कई" dropped is a lost qualifier', () => caught('कई दशकों से, कई जहाज़ और विमान यहाँ गायब हो गए हैं।', 'कई दशकों से जहाज़ और विमान गायब होते रहे।', /qualifier.*कई/));
test('English: a dropped clause is a dropped claim; a dropped filler clause is not', () => {
  caught('The Gulf Stream flows through the area, carrying warm water north.', 'The Gulf Stream flows through the area.', /claim.*warm water/);
  passes('The Gulf Stream flows through the area, you know, really fast.', 'The Gulf Stream flows through the area really fast.');
});
test('real (Step 4 run): the object dropped — "ब्रांकियल हार्ट खून को दो गिल्स से पंप करते हैं" → "…दो गिल्स से पंप करता है"', () => caught('ब्रांकियल हार्ट खून को दो गिल्स से पंप करते हैं, जहाँ पानी से ऑक्सीजन ली जाती है।', 'ब्रांकियल हार्ट दो गिल्स से पंप करता है, जहाँ ऑक्सीजन ली जाती है।', /object.*खून/));
test('valid: the object kept with a shorter verb phrase passes', () => passes('ब्रांकियल हार्ट खून को दो गिल्स तक पंप करते हैं।', 'ब्रांकियल हार्ट खून दो गिल्स तक पंप करते हैं।'));
