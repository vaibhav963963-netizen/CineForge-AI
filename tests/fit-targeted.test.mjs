// Steps 2–3: one-line-per-request length fitting, strict answer validation, runaway protection, line priority,
// and the Hinglish language check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitLength, estimateSeconds, checkLanguage, danglingLine } from '../dashboard/lib/scriptgen.js';

const HI = { topic: 'What if the Earth stopped spinning?', durationSeconds: 30, language: { id: 'hi-conversational', code: 'hi', script: 'Deva', captionScript: 'Deva', name: 'Hindi' }, narration: { voice: 'no_such_voice_for_tests', speed: 1, delivery: { lead: 0.3, outro: 1, gap: 0.3 } } };
const HG = { ...HI, language: { id: 'hinglish', code: 'hi', script: 'Latn', captionScript: 'Latn', name: 'Hinglish' } };
const long = ['पृथ्वी हर दिन अपनी धुरी पर लगभग 24 घंटे में एक पूरा चक्कर लगाती है और यह बहुत तेज़ी से घूमती है।',
  'भूमध्य रेखा पर इसकी सतह लगभग 1670 किलोमीटर प्रति घंटे की रफ़्तार से घूमती है, जो सच में बहुत तेज़ है।',
  'अगर यह अचानक रुक जाए, तो वायुमंडल और महासागर अपनी पुरानी गति से आगे बढ़ते रहेंगे, बिना रुके।',
  'इस वजह से बहुत तेज़ हवाएँ चलेंगी और बड़ी-बड़ी लहरें तटों से टकराएँगी, जिससे भारी नुकसान होगा।',
  'इसलिए पाँच सेकंड का यह ठहराव भी पूरी दुनिया के लिए एक बहुत बड़ी आपदा बन जाएगा, सोचिए ज़रा।'];
const good = { [long[0]]: 'पृथ्वी हर दिन लगभग 24 घंटे में अपनी धुरी पर एक पूरा चक्कर लगाती है।', [long[1]]: 'भूमध्य रेखा पर सतह लगभग 1670 किलोमीटर प्रति घंटे से घूमती है।', [long[2]]: 'अगर यह अचानक रुके, तो वायुमंडल और महासागर आगे बढ़ते रहेंगे।', [long[3]]: 'इस वजह से तेज़ हवाएँ चलेंगी और लहरें तटों से टकराएँगी, जिससे भारी नुकसान होगा।', [long[4]]: 'इसलिए पाँच सेकंड का ठहराव भी दुनिया के लिए बड़ी आपदा होगा।' };
const value = () => ({ script: { title: 't', lines: long.map((text) => ({ text, visual: 'v' })) }, meta: {} });
const lineOf = (messages) => messages[1].content.match(/^  LINE: (.*)$/m)[1];
const over = (r) => ({ ...HI, durationSeconds: Math.round(estimateSeconds(value().script, HI).seconds / r) });
// a fake model: answer(t) gives the reply for the line t; every request is recorded
const model = (answer) => { const calls = []; const fn = async ({ messages, maxTokens, schema }) => { if (schema?.properties?.sameMeaning) return { text: JSON.stringify({ sameMeaning: true, lost: '' }), truncated: false }; calls.push({ messages, maxTokens, schema }); return { text: JSON.stringify({ line: answer(lineOf(messages)) }), truncated: false }; }; fn.calls = calls; return fn; };
const all = (out) => out.meta.lengthFitLog.flatMap((e) => e.lines || []);
const reasonsFor = (out, n) => all(out).filter((x) => x.line === n).map((x) => x.reason);

test('every request targets exactly one line, with its ID, budget, must-keep facts, neighbours and the read-only script', async () => {
  const fn = model((t) => good[t] || t);
  await fitLength(over(1.25), value(), { chatFn: fn });
  assert.ok(fn.calls.length > 0);
  for (const c of fn.calls) {
    const u = c.messages[1].content;
    assert.equal((u.match(/^  LINE: /gm) || []).length, 1);
    assert.match(u, /^LINE ID: \[\d\]$/m); assert.match(u, /FULL SCRIPT \(read-only context\)/); assert.match(u, /^PREVIOUS: /m); assert.match(u, /^NEXT: /m);
    assert.match(u, /AT MOST \d+ words, at most \d+ characters/); assert.match(u, /^MUST KEEP: /m);
    assert.ok(c.schema.properties.line.maxLength > 0 && c.maxTokens < 400, 'one-sentence output limits');
  }
});

test('a correct single-line answer is accepted and the total duration is recalculated after it', async () => {
  const cfg = over(1.25), out = await fitLength(cfg, value(), { chatFn: model((t) => good[t] || t) });
  const acc = out.meta.lengthFitLog.filter((e) => /^accepted/.test(e.result || ''));
  assert.ok(acc.length >= 2);
  for (let k = 1; k < acc.length; k++) assert.equal(acc[k].before, acc[k - 1].after);   // each call starts from the recalculated total
  assert.ok(out.meta.lengthFit.to < out.meta.lengthFit.from);
  assert.ok(Math.abs(out.meta.lengthFit.to - cfg.durationSeconds) <= cfg.durationSeconds * 0.1, JSON.stringify(out.meta.lengthFit));
  assert.equal(out.meta.lengthFit.reason, null);
  assert.ok(out.script.lines.every((l, i) => l.text === long[i] || l.text === good[long[i]]), 'no line deleted or moved');
});

test('stops as soon as the script is inside ±8 % — lines are not all shortened equally', async () => {
  const out = await fitLength(over(1.1), value(), { chatFn: model((t) => good[t] || t) });
  assert.ok(out.script.lines.filter((l, i) => l.text !== long[i]).length < long.length);
  assert.match(out.meta.lengthFitLog.at(-1).result, /within ±8 %/);
});

test('the conclusion and the hook are changed last', async () => {
  const fn = model((t) => t);   // every answer unchanged → the order of requests is the priority order
  await fitLength(over(1.25), value(), { chatFn: fn });
  const order = fn.calls.map((c) => long.indexOf(lineOf(c.messages)) + 1);
  assert.notEqual(order[0], 5); assert.notEqual(order[0], 1);
  assert.ok(order.indexOf(5) > order.indexOf(3), JSON.stringify(order));
});

const rejects = async (bad, re) => {
  const out = await fitLength(over(1.25), value(), { chatFn: model((t) => (t === long[2] ? bad : t)) });
  assert.ok(reasonsFor(out, 3).some((r) => re.test(r)), JSON.stringify(reasonsFor(out, 3)));
  assert.equal(out.script.lines[2].text, long[2]);   // the original line is kept
};
test('wrong-line answer is rejected', () => rejects(good[long[3]], /answered with another line/));
test('multiple-sentence answer is rejected', () => rejects('अगर यह रुके तो हवा आगे बढ़ेगी। महासागर भी आगे बढ़ेंगे।', /2 sentences for a 1-sentence line/));
test('unchanged answer is rejected and counted', async () => {
  const out = await fitLength(over(1.25), value(), { chatFn: model((t) => t) });
  assert.ok(all(out).every((x) => /unchanged/.test(x.reason))); assert.ok(out.meta.lengthFit.unchanged >= 5);
});
test('repetitive number loop is rejected', () => rejects('अगर यह रुके, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5।', /token loop/));
test('repetitive word loop is rejected', () => rejects('अगर यह रुके तो वायुमंडल वायुमंडल वायुमंडल वायुमंडल वायुमंडल वायुमंडल आगे बढ़ेगा।', /token loop/));
test('commentary in the answer is rejected', () => rejects('Rewritten line (9 words): अगर यह रुके, तो वायुमंडल और महासागर आगे बढ़ते रहेंगे।', /commentary/));
test('excessively short answer is rejected (essential content at risk)', () => rejects('वायुमंडल और महासागर बढ़ेंगे।', /too short|too much of the original lost/));
test('answer that is not shorter is rejected', () => rejects(long[2].replace('बिना रुके।', 'बिना रुके, लगातार और तेज़ी से।'), /not shorter/));
test('changed number is rejected', async () => {
  const out = await fitLength(over(1.25), value(), { chatFn: model((t) => (t === long[1] ? 'भूमध्य रेखा पर सतह लगभग 1600 किलोमीटर प्रति घंटे से घूमती है।' : t)) });
  assert.ok(reasonsFor(out, 2).some((r) => /introduced a number \(1600\)/.test(r)), JSON.stringify(reasonsFor(out, 2)));
});
test('broken Hindi grammar (cut off on a postposition) is rejected', () => rejects('अगर यह अचानक रुक जाए, तो वायुमंडल और महासागर अपनी पुरानी गति से आगे बढ़ने के।', /incomplete sentence/));
test('meaning change is rejected', () => rejects('अगर यह रुके, तो हम सब छुट्टी मनाएँगे और गाना गाएँगे।', /meaning changed/));

test('lost essential term (fact file) or name (English) is rejected', async () => {
  const VX = { ...HI, topic: 'How do vaccines train the immune system?' };
  const L = ['टीका शरीर को सिखाता है, और फिर एंटीबॉडी बनती हैं जो कीटाणु को पहचानती हैं और उसे रोकती हैं।', 'फिर मेमोरी सेल्स लंबे समय तक शरीर में रहते हैं, ताकि अगली बार तेज़ी से जवाब मिले।'];
  const v = { script: { title: 't', lines: L.map((text) => ({ text, visual: 'v' })) }, meta: {} };
  const out = await fitLength({ ...VX, durationSeconds: Math.round(estimateSeconds(v.script, VX).seconds / 1.3) }, v, { chatFn: model((t) => (t === L[0] ? 'टीका शरीर को सिखाता है, फिर कीटाणु को पहचानती और रोकती हैं।' : t)) });
  assert.ok(all(out).some((x) => x.line === 1 && /lost an essential term, name or number word \(एंटीबॉडी\)/.test(x.reason)), JSON.stringify(all(out).map((x) => x.reason)));
  const EN = { ...HI, topic: 'vaccines', language: { id: 'en', code: 'en', script: 'Latn', captionScript: 'Latn', name: 'English' } };
  const E = ['In 1796 the English doctor Edward Jenner showed that material taken from cowpox could protect people from smallpox.', 'That simple test became the very first vaccine in all of history.'];
  const ve = { script: { title: 't', lines: E.map((text) => ({ text, visual: 'v' })) }, meta: {} };
  const outE = await fitLength({ ...EN, durationSeconds: Math.round(estimateSeconds(ve.script, EN).seconds / 1.3) }, ve, { chatFn: model((t) => (t === E[0] ? 'In 1796 an English doctor showed that cowpox could protect people from smallpox.' : t)) });
  assert.ok(all(outE).some((x) => /lost an essential term, name or number word \(.*Edward Jenner/.test(x.reason)), JSON.stringify(all(outE).map((x) => x.reason)));
});

test('retry limit: at most two attempts per line, bounded calls, firmer second instruction; unshortenable → NEEDS_REVIEW reason', async () => {
  const fn = model((t) => t), out = await fitLength(over(1.3), value(), { chatFn: fn });
  const per = {}; for (const c of fn.calls) { const k = lineOf(c.messages); per[k] = (per[k] || 0) + 1; }
  assert.ok(Object.values(per).every((n) => n <= 2)); assert.ok(fn.calls.length <= 10);
  assert.ok(fn.calls.some((c) => /last answer for this line was rejected/.test(c.messages[0].content)));
  assert.match(out.meta.lengthFit.reason, /could not be shortened safely in two attempts/);
  assert.deepEqual(out.script.lines.map((l) => l.text), long);
  assert.equal(out.meta.lengthFit.calls, fn.calls.length);
});

test('runaway: an answer cut off at the token limit is rejected, never accepted', async () => {
  const fn = async () => ({ text: JSON.stringify({ line: 'अगर यह रुके, तो वायुमंडल' }), truncated: true });
  const out = await fitLength(over(1.25), value(), { chatFn: fn });
  assert.ok(all(out).every((x) => /cut off at the length limit/.test(x.reason)));
  assert.deepEqual(out.script.lines.map((l) => l.text), long);
});

test('narrative context: PREVIOUS and NEXT in each request are the real neighbours', async () => {
  const fn = model((t) => t); await fitLength(over(1.25), value(), { chatFn: fn });
  for (const c of fn.calls) {
    const u = c.messages[1].content, i = long.indexOf(lineOf(c.messages));
    assert.ok(u.includes(`PREVIOUS: ${i ? long[i - 1] : '(start of the script)'}`)); assert.ok(u.includes(`NEXT: ${i < 4 ? long[i + 1] : '(end of the script)'}`));
  }
});

// ── Hinglish language check ───────────────────────────────────────────────────────────────────────────────────
const hg = (text, say) => checkLanguage({ lines: [{ text, say }] }, HG);
test('Hinglish check: a short all-Hindi line is Hindi, not English (seen: "गलतियाँ होने पर दुर्घटनाएँ हो सकती हैं।")', () => {
  assert.deepEqual(hg('Galtiyan hone par durghatnayen ho sakti hain.', 'गलतियाँ होने पर दुर्घटनाएँ हो सकती हैं।'), []);
  assert.deepEqual(hg('Yeh sach hai.', 'यह सच है।'), []);
});
test('Hinglish check: natural code-switching and English terms inside Hindi pass', () => {
  assert.deepEqual(hg('Octopus ke teen heart hote hain.', 'ऑक्टोपस के तीन हार्ट होते हैं।'), []);
  assert.deepEqual(hg('Gills paani se oxygen leti hain.', 'गिल्स पानी से ऑक्सीजन लेती हैं।'), []);
});
test('Hinglish check: plain Roman English still fails; malformed and Marathi lines still fail', () => {
  const en = checkLanguage({ lines: ['The octopus has three hearts.', 'Two pump blood to the gills.', 'One pumps it to the body.'].map((t) => ({ text: t, say: 'द ऑक्टोपस हैज़ थ्री हार्ट्स।' })) }, HG);
  assert.ok(en.some((x) => /reads as English/.test(x)), JSON.stringify(en));
  assert.ok(hg('Yeh oxygen leta hai.', 'यह oxygen and carbon dioxide लेता है।').some((x) => /missing its Devanagari "say"/.test(x)));
  assert.ok(hg('Yeh sach hai.', undefined).some((x) => /missing its Devanagari "say"/.test(x)));
  assert.ok(hg('Yeh sach aahe.', 'हे खरे आहे आणि त्यामुळे सर्व काही बदलते।').some((x) => /Marathi/.test(x)));
});
test('Hindi (Devanagari) check is unchanged: Roman English in a Hindi script still fails', () => {
  assert.ok(checkLanguage({ lines: [{ text: 'The Earth spins fast.' }] }, HI).some((x) => /not in Devanagari/.test(x)));
  assert.deepEqual(checkLanguage({ lines: [{ text: 'पृथ्वी तेज़ी से घूमती है।' }] }, HI), []);
});
test('a line cut off on a postposition is incomplete (seen in the octopus draft: "…ऑक्सीजन बनाए रखने के")', () => {
  for (const t of ['ऑक्सीजन बनाए रखने के।', 'ऑक्सीजन बनाए रखने के', 'यह काम करने के लिए।', 'यह राम का।']) assert.equal(danglingLine(t), true, t);
  for (const t of ['उसने मदद की।', 'वह घर में है।', 'यह बात सच है।', 'ऑक्टोपस के तीन दिल होते हैं।']) assert.equal(danglingLine(t), false, t);
});

test('model not reachable: fitting stops at once with that reason (never "could not be shortened safely")', async () => {
  let n = 0; const fn = async () => { n++; throw new Error('fetch failed'); };
  const out = await fitLength(over(1.25), value(), { chatFn: fn });
  assert.equal(n, 1); assert.match(out.meta.lengthFit.reason, /local model is not reachable/);
  assert.deepEqual(out.script.lines.map((l) => l.text), long);
});

// ── real rewrites from the controlled run (logs/tests/fit-controlled-2026-11-13T15-37-25.json) that were accepted ──
const OCT = { ...HG, topic: 'Why do octopuses have three hearts?' };
const realReject = async (cfg, lines, i, bad, re) => {
  const v = { script: { title: 't', lines: lines.map((say) => ({ text: 'x', say, visual: 'v' })) }, meta: {} };
  const c = { ...cfg, durationSeconds: Math.round(estimateSeconds(v.script, cfg).seconds / 1.3) };
  const out = await fitLength(c, v, { chatFn: model((t) => (t === lines[i] ? bad : t)) });
  const r = all(out).filter((x) => x.line === i + 1).map((x) => x.reason);
  assert.ok(r.some((x) => re.test(x)), JSON.stringify(r));
  assert.equal(out.script.lines[i].say, lines[i]);
};
const OL = ['ऑक्टोपस के पास तीन दिल होते हैं: दो ब्रांकियल हार्ट और एक सिस्टेमिक हार्ट।', 'ब्रांकियल हार्ट दो गिल्स से ऑक्सीजन लेते हैं।', 'गिल्स पानी से घुली हुई ऑक्सीजन लेते हैं, इसलिए रक्त में ऑक्सीजन आती है।', 'ऑक्टोपस का खून नीला होता है, हीमोसायनिन प्रोटीन से।'];
test('real: the third heart dropped ("…दो ब्रांकियल हार्ट।") is rejected — spelling-tolerant, counted terms', () => realReject(OCT, OL, 0, 'ऑक्टोपस के पास तीन दिल होते हैं: दो ब्रांकियल हार्ट।', /lost an essential term.*(सिस्टेमिक|हार्ट|एक)/));
test('real: the number word "दो" dropped is rejected', () => realReject(OCT, OL, 1, 'ब्रांकियल हार्ट गिल्स से ऑक्सीजन लेते हैं।', /number word \(दो\)/));
test('real: the cause-and-effect clause dropped ("इसलिए रक्त में ऑक्सीजन आती है") is rejected', () => realReject(OCT, OL, 2, 'गिल्स पानी से घुली हुई ऑक्सीजन लेते हैं।', /lost an essential term.*ऑक्सीजन|cause-and-effect/));
test('real: a verbless fragment ("ऑक्टोपस का खून नीला, हीमोसायनिन।") is rejected', () => realReject(OCT, OL, 3, 'ऑक्टोपस का खून नीला, हीमोसायनिन।', /fragment/));
const BER = { ...HG, topic: 'The mystery of the Bermuda Triangle — what really happens there?' };
const BL = ['पृथ्वी के चुंबकीय क्षेत्र में भिन्नताएँ होती हैं, जिससे कंपासें भ्रमित हो सकती हैं।', 'तूफान के मौसम में, क्षेत्र में तीव्र तूफान आते हैं, जिससे नेविगेशन मुश्किल हो जाता है।', 'गलतियाँ पायलटों और कप्तानों के कारण दुर्घटनाओं का कारण बन सकती हैं।'];
test('real: "…, जिससे कंपासें भ्रमित हो सकती हैं" cut off is rejected (cause-and-effect)', () => realReject(BER, BL, 0, 'पृथ्वी के चुंबकीय क्षेत्र में भिन्नताएँ होती हैं।', /cause-and-effect/));
test('real: "…नेविगेशन मुश्किल।" (no verb) is rejected', () => realReject(BER, BL, 1, 'तूफान के मौसम में तीव्र तूफान आते हैं, जिससे नेविगेशन मुश्किल।', /fragment/));
test('real: "…के कारण दुर्घटनाएँ।" (no verb) is rejected', () => realReject(BER, BL, 2, 'गलतियाँ पायलटों और कप्तानों के कारण दुर्घटनाएँ।', /fragment/));
test('a genuine shortening that keeps terms, number words, the causal link and the verb is accepted', async () => {
  const v = { script: { title: 't', lines: OL.map((say) => ({ text: 'x', say, visual: 'v' })) }, meta: {} };
  const c = { ...OCT, durationSeconds: Math.round(estimateSeconds(v.script, OCT).seconds / 1.15) };
  const ok = 'गिल्स पानी से ऑक्सीजन लेते हैं, इसलिए रक्त में ऑक्सीजन आती है।';
  const out = await fitLength(c, v, { chatFn: model((t) => (t === OL[2] ? ok : t)) });
  assert.equal(out.script.lines[2].say, ok, JSON.stringify(all(out).filter((x) => x.line === 3).map((x) => x.reason)));
});
test('real: "mistakes cause accidents" → "mistakes come from pilots" is rejected (too much of the original lost)', () => realReject(BER, BL, 2, 'गलतियाँ पायलटों और कप्तानों से होती हैं।', /too much of the original lost/));
test('real: "…गिल्स के ऊपर से, फिर शरीर में।" (ends on a postposition, not a verb) is rejected', () => realReject(OCT, ['ब्रांकियल हार्ट दो गिल्स से ऑक्सीजन लेते हैं।', 'रक्त ऑक्सीजन लेता है जब यह गिल्स के ऊपर से गुजरता है, और फिर इसे शरीर में ले जाता है।'], 1, 'रक्त ऑक्सीजन लेता है गिल्स के ऊपर से, फिर शरीर में।', /fragment/));
test('real: step-by-step erosion of one line is measured against the line as fitting found it', async () => {
  const L = ['ऑक्टोपस के तीन दिल होते हैं।', 'सिस्टेमिक हार्ट ऑक्सीजन से भरपूर रक्त को शरीर के बाकी हिस्सों तक पहुँचाता है, जैसे भुजाएँ और मस्तिष्क।'];
  const steps = { [L[1]]: 'सिस्टेमिक हार्ट ऑक्सीजन से भरपूर रक्त शरीर में पहुँचाता है।', 'सिस्टेमिक हार्ट ऑक्सीजन से भरपूर रक्त शरीर में पहुँचाता है।': 'सिस्टेमिक हार्ट ऑक्सीजन रक्त पहुँचाता है।' };
  const v = { script: { title: 't', lines: L.map((say) => ({ text: 'x', say, visual: 'v' })) }, meta: {} };
  const out = await fitLength({ ...OCT, durationSeconds: Math.round(estimateSeconds(v.script, OCT).seconds / 1.6) }, v, { chatFn: model((t) => steps[t] || t) });
  assert.notEqual(out.script.lines[1].say, 'सिस्टेमिक हार्ट ऑक्सीजन रक्त पहुँचाता है।');
  // since Step 4 the FIRST damaging step is already rejected ("बाकी हिस्सों तक … भुजाएँ और मस्तिष्क" dropped)
  assert.ok(all(out).some((x) => /too much of the original lost|meaning: /.test(x.reason || '')), JSON.stringify(all(out).map((x) => x.reason)));
});
test('real: plural term dropped ("दो ब्रांकियल हार्ट्स …" → "दो ब्रांकियल …") is rejected', () => realReject(OCT, ['ऑक्टोपस के तीन दिल होते हैं।', 'दो ब्रांकियल हार्ट्स पानी से ऑक्सीजन लेते हैं, और फिर वह रक्त आगे भेजते हैं।'], 1, 'दो ब्रांकियल ऑक्सीजन लेते हैं, और फिर वह रक्त आगे भेजते हैं।', /lost an essential term.*हार्ट/));
test('real: the Hindi descriptive term "पूरे शरीर वाला दिल" reduced to "दिल" is rejected', () => realReject(OCT, ['ऑक्टोपस के तीन दिल होते हैं।', 'फिर, पूरे शरीर वाला दिल ऑक्सीजन युक्त रक्त को ऑक्टोपस के पूरे शरीर तक पहुँचाता है।'], 1, 'फिर, दिल ऑक्सीजन युक्त रक्त को ऑक्टोपस के पूरे शरीर तक पहुँचाता है।', /lost an essential term.*पूरे शरीर वाला/));
test('erosion across stages: the after-review pass compares with the line as the first pass found it', async () => {
  const L = ['ऑक्टोपस के तीन दिल होते हैं।', 'सिस्टेमिक हार्ट ऑक्सीजन से भरपूर रक्त को शरीर के बाकी हिस्सों तक पहुँचाता है, जैसे भुजाएँ और मस्तिष्क।'];
  const mid = 'सिस्टेमिक हार्ट ऑक्सीजन से भरपूर रक्त शरीर में पहुँचाता है।', worn = 'सिस्टेमिक हार्ट ऑक्सीजन रक्त पहुँचाता है।';
  const v = { script: { title: 't', lines: L.map((say) => ({ text: 'x', say, visual: 'v' })) }, meta: {} };
  const cfg = { ...OCT, durationSeconds: Math.round(estimateSeconds(v.script, OCT).seconds / 1.6) };
  const first = await fitLength(cfg, v, { chatFn: model((t) => (t === L[1] ? mid : t)) });
  // (Step 4: the first step itself drops a destination and listed entities, so it is rejected too)
  const second = await fitLength(cfg, first, { chatFn: model((t) => (t === mid ? worn : t)), stage: 'after review' });
  assert.notEqual(second.script.lines[1].say, worn);
});

test('real (E2E 2026-11-19): an English lengthening is not cut off by the output cap (it used to end "…braking effect, yo")', async () => {
  const EN = { ...HI, topic: 'Why does the Moon always show the same face to Earth?', language: { id: 'en', code: 'en', script: 'Latn', captionScript: 'Latn', name: 'English' } };
  const L = ['Earth’s gravity slowly slowed the Moon’s spin, creating a bulge.', 'Now the Moon always shows Earth the same face.'];
  const v = { script: { title: 't', lines: L.map((text) => ({ text, visual: 'v' })) }, meta: {} };
  const longer = 'Earth’s gravity slowly slowed the Moon’s spin over millions of years, creating a bulge that acted like a gentle brake.';
  let cap = 0;
  const chatFn = async ({ messages, schema }) => {
    if (schema?.properties?.sameMeaning) return { text: JSON.stringify({ sameMeaning: true, lost: '' }) };
    const t = messages[1].content.match(/^ {2}LINE: (.*)$/m)[1]; if (t === L[0]) cap = schema.properties.line.maxLength;
    return { text: JSON.stringify({ line: t === L[0] ? longer : t }) };
  };
  await fitLength({ ...EN, durationSeconds: Math.round(estimateSeconds(v.script, EN).seconds * 1.3) }, v, { chatFn });
  assert.ok(cap >= longer.length, `cap ${cap} < ${longer.length}`);
});
