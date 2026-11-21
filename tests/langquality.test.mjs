// Step 5: language quality — validation separate from correction; corrections never change meaning.
// Sentences marked "real" come from saved benchmark outputs (logs/tests/script-eval-*.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { languageIssues, mechanicalFix, correctLanguage } from '../dashboard/lib/langquality.js';
import { checkLanguage, qualityGates, termProblems } from '../dashboard/lib/scriptgen.js';

const HI = { topic: 't', durationSeconds: 30, language: { id: 'hi-conversational', code: 'hi', script: 'Deva', captionScript: 'Deva', name: 'Hindi' }, narration: { voice: 'no_such_voice_for_tests', speed: 1, delivery: { lead: 0.3, outro: 1, gap: 0.3 } } };
const EN = { ...HI, language: { id: 'en', code: 'en', script: 'Latn', captionScript: 'Latn', name: 'English' } };
const HG = { ...HI, language: { id: 'hinglish', code: 'hi', script: 'Latn', captionScript: 'Latn', name: 'Hinglish' } };
const issues = (cfg, t) => languageIssues(cfg, { lines: [cfg === HG ? { text: 'x', say: t } : { text: t }] });
const errs = (cfg, t) => issues(cfg, t).filter((x) => x.severity === 'error');
const has = (cfg, t, re) => assert.ok(errs(cfg, t).some((x) => re.test(`${x.rule}: ${x.detail}`)), JSON.stringify(issues(cfg, t)));
const clean = (cfg, t) => assert.deepEqual(errs(cfg, t), [], JSON.stringify(issues(cfg, t)));

// ── Hindi: real errors ─────────────────────────────────────────────────────────────────────────────────────────
test('real: gender — "जीवन का नदी" (नदी is feminine)', () => has(HI, 'रूडयार्ड कीपलिंग ने इस राह को ‘जीवन का नदी’ बताया।', /gender agreement.*की नदी/));
test('real: gender — "गहरी समुद्र तल" (समुद्र is masculine)', () => has(HI, 'गहरी समुद्र तल के नीचे गैस फँसी है।', /gender agreement.*masculine/));
test('real: verb without auxiliary — "…पंप करता, जो पानी से ऑक्सीजन लेता।"', () => has(HI, 'ब्रांकियल हार्ट दो गिल्स से खून पंप करता, जो पानी से ऑक्सीजन लेता।', /verb form.*लेता/));
test('real: verb without auxiliary — "…जो क्षेत्र से बहती, शक्तिशाली प्रवाह।"', () => has(HI, 'नदी गल्फ स्ट्रीम है, जो क्षेत्र से बहती, शक्तिशाली प्रवाह।', /verb form.*बहती/));
test('verb agreement: "करते है", "करता हैं", "करते था"', () => { has(HI, 'ये लोग काम करते है।', /verb agreement.*हैं/); has(HI, 'वह रोज़ काम करता हैं।', /verb agreement/); has(HI, 'वे वहाँ रहते था।', /verb agreement.*थे/); });
test('subject-verb gender: "पृथ्वी घूमता है", "दिल धड़कती है"', () => { has(HI, 'पृथ्वी घूमता है।', /subject-verb gender/); has(HI, 'दिल धड़कती है।', /subject-verb gender/); });
test('postpositions: doubled or stacked case markers', () => { has(HI, 'वह घर से से निकला।', /repeated word/); has(HI, 'राजा का के बेटे ने कहा।', /case marker/); });

// ── Hindi: valid sentences must pass (false positives found in the benchmark corpus) ────────────────────────────
test('valid: negative habitual without है ("बारिश नहीं होती", "हमेशा अंधेरा नहीं होता")', () => { clean(HI, 'हिमालय हवाओं को रोकते हैं, इसलिए पीछे बारिश नहीं होती।'); clean(HI, 'लेकिन चाँद का दूर वाला हिस्सा हमेशा अंधेरा नहीं होता, यह भी धूप पाता है।'); });
test('valid: the object next to the verb is not the subject ("रक्त ऑक्सीजन लेता है", "दिल ऑक्सीजन पहुँचाता है")', () => { clean(HI, 'रक्त ऑक्सीजन लेता है।'); clean(HI, 'फिर, दिल ऑक्सीजन पहुँचाता है।'); });
test('valid: a clause sharing the next auxiliary is a warning, not an error', () => { clean(HI, 'बूस्टर खुराक स्मृति को मजबूत करते, समुदाय को सुरक्षित रखते हैं!'); assert.ok(issues(HI, 'बूस्टर खुराक स्मृति को मजबूत करते, समुदाय को सुरक्षित रखते हैं!').some((x) => x.severity === 'warning')); });
test('valid: natural Hindi sentences from the project pass', () => {
  for (const t of ['ऑक्टोपस के पास तीन दिल होते हैं: दो ब्रांकियल हार्ट और एक सिस्टेमिक हार्ट।', 'पृथ्वी हर दिन अपनी धुरी पर लगभग 24 घंटे में एक पूरा चक्कर लगाती है।', '1796 में एडवर्ड जेनर ने चेचक से बचाव का तरीका खोजा।', 'शेर शाह सूरी ने उत्तरापथ को फिर से बनवाया।', 'खाड़ी धारा महासागर में एक शक्तिशाली नदी की तरह बहती है।', 'वैज्ञानिकों का मानना है कि ये दिल मदद करते हैं।', 'उसने मदद की।', 'बड़ी लहरें तटों से टकराएँगी।']) clean(HI, t);
});

// ── English ────────────────────────────────────────────────────────────────────────────────────────────────────
test('English errors: a/an, repeated words, subject-verb agreement', () => {
  has(EN, 'It was a enormous wave.', /article.*an enormous/); has(EN, 'This is an big step.', /article.*a big/);
  has(EN, 'The the ship vanished.', /repeated word/); has(EN, 'Scientists is still unsure.', /subject-verb/); has(EN, 'It don\'t sink.', /subject-verb/); has(EN, 'They was lost at sea.', /subject-verb/);
});
test('English valid: "an hour", "a unique", "a one-time", "had had", natural narration', () => {
  for (const t of ['It took an hour.', 'It is a unique case.', 'It was a one-time event.', 'By then the crew had had enough.', 'In 1796 Edward Jenner showed that cowpox could protect people from smallpox.', 'The Moon always shows the same face to Earth because of tidal locking.']) clean(EN, t);
});

// ── Hinglish ───────────────────────────────────────────────────────────────────────────────────────────────────
test('Hinglish: grammar is checked on the spoken Devanagari form; code-switched terms pass', () => {
  clean(HG, 'ऑक्टोपस के तीन हार्ट होते हैं, और गिल्स पानी से ऑक्सीजन लेती हैं।'); has(HG, 'ये गिल्स ऑक्सीजन लेते है।', /verb agreement/);
});
test('Hinglish: unexpected writing systems still fail the language check (Arabic letters, Latin inside the spoken form)', () => {
  assert.ok(checkLanguage({ lines: [{ text: 'x', say: 'यह कتاب पुरानी है।' }] }, HG).some((x) => /another script/.test(x)));
  assert.ok(checkLanguage({ lines: [{ text: 'x', say: 'यह oxygen and carbon लेता है।' }] }, HG).some((x) => /Devanagari "say"/.test(x)));
});

// ── terminology consistency ────────────────────────────────────────────────────────────────────────────────────
test('real: one word spelled two ways in a script ("तरफ" / "तरफ़", "गांवों" / "गाँवों") is flagged', () => {
  const r = languageIssues(HI, { lines: [{ text: 'हवा पहाड़ की तरफ बहती है।' }, { text: 'गांवों में बारिश होती है।' }, { text: 'फिर हवा समुद्र की तरफ़ लौटती है।' }, { text: 'पहाड़ी गाँवों में ठंड रहती है।' }] });
  assert.equal(r.filter((x) => x.rule === 'spelling consistency').length, 2);
});
test('scientific terminology: a non-standard spelling is reported with the fact-file form (existing term check still active)', () => {
  const p = termProblems(HI, { lines: [{ text: 'सिस्टमीक हार्ट पूरे शरीर में खून भेजता है।' }] }, { beats: ['The heart pumps blood.'] });
  assert.ok(p.some((x) => /सिस्टमिक/.test(x)));
});
test('an opening pronoun with nothing to refer to is flagged (warning)', () => assert.ok(languageIssues(HI, { lines: [{ text: 'यह दुनिया की सबसे लंबी सड़क है।' }] }).some((x) => x.rule === 'unclear reference')));

// ── correction: mechanical first, model only for the rest, never a meaning change ───────────────────────────────
test('mechanical fixes are exact and meaning-free', () => {
  assert.equal(mechanicalFix('ये लोग काम करते है।', issues(HI, 'ये लोग काम करते है।')), 'ये लोग काम करते हैं।');
  assert.equal(mechanicalFix('कीपलिंग ने इसे जीवन का नदी बताया।', issues(HI, 'कीपलिंग ने इसे जीवन का नदी बताया।')), 'कीपलिंग ने इसे जीवन की नदी बताया।');
  assert.equal(mechanicalFix('It was a enormous wave.', issues(EN, 'It was a enormous wave.')), 'It was an enormous wave.');
});
const doc = (cfg, ts) => ({ script: { title: 't', lines: ts.map((t) => (cfg === HG ? { text: 'x', say: t, visual: 'v' } : { text: t, visual: 'v' })) }, meta: {} });
test('correction: a mechanical error is fixed without any model call', async () => {
  let calls = 0; const r = await correctLanguage(HI, doc(HI, ['ये लोग रोज़ काम करते है।']), { chatFn: async () => { calls++; return { text: '{}' }; } });
  assert.equal(r.value.script.lines[0].text, 'ये लोग रोज़ काम करते हैं।'); assert.equal(calls, 0);
});
test('correction: a model fix that also changes meaning is REJECTED and the original kept', async () => {
  const bad = 'ब्रांकियल हार्ट दो गिल्स से खून पंप करता है।';   // drops "जो पानी से ऑक्सीजन लेता"
  const r = await correctLanguage(HI, doc(HI, ['ब्रांकियल हार्ट दो गिल्स से खून पंप करता, जो पानी से ऑक्सीजन लेता।']), { chatFn: async () => ({ text: JSON.stringify({ line: bad }) }) });
  assert.equal(r.value.script.lines[0].text, 'ब्रांकियल हार्ट दो गिल्स से खून पंप करता, जो पानी से ऑक्सीजन लेता।');
  assert.equal(r.log[0].model.accepted, false); assert.match(r.log[0].model.reason, /meaning|words changed/);
});
test('correction: a minimal grammar-only fix is accepted', async () => {
  const good = 'ब्रांकियल हार्ट दो गिल्स से खून पंप करता है, जो पानी से ऑक्सीजन लेता है।';
  const r = await correctLanguage(HI, doc(HI, ['ब्रांकियल हार्ट दो गिल्स से खून पंप करता, जो पानी से ऑक्सीजन लेता।']), { chatFn: async () => ({ text: JSON.stringify({ line: good }) }) });
  assert.equal(r.value.script.lines[0].text, good); assert.equal(r.log[0].model.accepted, true); assert.deepEqual(r.log[0].remaining, []);
});
test('correction: a fix that changes a number, removes a hedge, or leaves the error is rejected; model failure keeps the original', async () => {
  const orig = 'शायद 3 दिल मदद करता, जो पानी से ऑक्सीजन लेता।';
  for (const ans of ['शायद 4 दिल मदद करते हैं, जो पानी से ऑक्सीजन लेते हैं।', '3 दिल मदद करते हैं, जो पानी से ऑक्सीजन लेते हैं।', orig]) {
    const r = await correctLanguage(HI, doc(HI, [orig]), { chatFn: async () => ({ text: JSON.stringify({ line: ans }) }) });
    assert.equal(r.value.script.lines[0].text, orig, ans);
  }
  const r = await correctLanguage(HI, doc(HI, [orig]), { chatFn: async () => { throw new Error('fetch failed'); } });
  assert.equal(r.value.script.lines[0].text, orig); assert.match(r.log[0].model.reason, /no valid answer/);
});
test('correction: valid lines are never sent to the model', async () => {
  let calls = 0; await correctLanguage(HI, doc(HI, ['ऑक्टोपस के पास तीन दिल होते हैं।', 'बारिश नहीं होती।']), { chatFn: async () => { calls++; return { text: '{}' }; } });
  assert.equal(calls, 0);
});
test('grammar gate: errors → gate fails (NEEDS_REVIEW); warnings are advisory only', () => {
  const g = qualityGates(HI, { script: { lines: [{ text: 'कीपलिंग ने इसे जीवन का नदी बताया।', visual: 'v' }] }, meta: { claimReview: { claims: [] } } });
  assert.equal(g.grammar.ok, false); assert.match(g.grammar.issues[0], /gender agreement/);
  const w = qualityGates(HI, { script: { lines: [{ text: 'बूस्टर खुराक स्मृति को मजबूत करते, समुदाय को सुरक्षित रखते हैं!', visual: 'v' }] }, meta: { claimReview: { claims: [] } } });
  assert.equal(w.grammar.ok, true); assert.ok(w.grammar.advisory.length);
});

// ── Step 5 evaluation: errors that passed the first version of the validator ────────────────────────────────────
test('real: verb without auxiliary before a dash — "टीका … टुकड़े दिखाता - वायरस या प्रोटीन।"', () => has(HI, 'टीका प्रतिरक्षा प्रणाली को टुकड़े दिखाता - वायरस या प्रोटीन।', /verb form.*दिखाता/));
test('real: English comma splices', () => {
  has(EN, 'The decline unfolded slowly over centuries, a gradual change occurred.', /comma splice/);
  has(EN, 'Around 1900 BCE, many cities were slowly emptied, people moved to smaller villages.', /comma splice/);
});
test('valid English commas: intro phrase, participle, relative clause, list, conjunction', () => {
  for (const t of ['Around 1900 BCE, many cities were slowly emptied.', 'Weakening monsoon rains and droughts likely caused crop failure, leading to population movement.', 'Harappa had wide streets, which were laid out in a grid.', 'The cities had drains, granaries and baths.', 'The rains failed, and the farms dried up.', 'Archaeological sites revealed the scale of this ancient, thriving civilization.']) clean(EN, t);
});
test('real (Step 5 eval): an appositive with a hyphenated "-ed" adjective is not a comma splice', () => clean(EN, 'Cities like Harappa displayed a planned layout – streets and bricks, a well-organized society.'));

test('real (rendered short 2026-11-19): leaked JSON fragments with numbers between quotes fail the language check', () => {
  const EN2 = { language: { id: 'en', code: 'en', script: 'Latn', captionScript: 'Latn', name: 'English' } };
  for (const t of ['The Moon always shows the same side to Earth.”, 13, “Because of tidal locking,”, 14', 'Long ago, the Moon rotated much faster than it does now.”, 13, “Then, Earth’s gravity began to exert its'])
    assert.ok(checkLanguage({ lines: [{ text: t }] }, EN2).some((x) => /stray quoted fragments/.test(x)), t);
  // real quotations and numbers in normal sentences still pass
  for (const t of ['Kipling called it “the river of life”, and the name stuck.', 'Today we see about 59 percent of its surface, over time.', 'He said "go", and 13 ships left.'])
    assert.deepEqual(checkLanguage({ lines: [{ text: t }] }, EN2), [], t);
});
