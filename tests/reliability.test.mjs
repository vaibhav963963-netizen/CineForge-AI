// Reliability fixes: terminology, length fitting (mocked model), voice calibration, visual concept checks.
// Mocked model responses prove the LOGIC only — they are not evidence that real Gemma output quality is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { termProblems, fitLength, estimateSeconds, calibratedRate, contaminationReason, visualProblems } from '../dashboard/lib/scriptgen.js';

const HI = { topic: 'What happens if Earth stops rotating?', durationSeconds: 30, language: { id: 'hi-formal', code: 'hi', script: 'Deva', captionScript: 'Deva', name: 'Hindi' }, narration: { voice: 'no_such_voice_for_tests', speed: 1, delivery: { lead: 0.3, outro: 1, gap: 0.3 } } };

// ── terminology ────────────────────────────────────────────────────────────────────────────────────────────────
test('terms: an incorrect Hindi transliteration of a planned term is flagged with the standard forms (not replaced)', () => {
  const s = { lines: [{ text: 'इन्वटेरिया गति का माप है, द्रव्यमान और वेग से निर्धारित।' }] };
  const p = termProblems(HI, s, { beats: ['Inertia keeps everything moving.'] });
  assert.equal(p.length, 1); assert.match(p[0], /"inertia".*इनर्शिया/);
  assert.equal(s.lines[0].text, 'इन्वटेरिया गति का माप है, द्रव्यमान और वेग से निर्धारित।');   // never auto-replaced
});
test('terms: correct terminology (loanword or Hindi term, with inflection) passes', () => {
  const s = { lines: [{ text: 'इनर्शिया की वजह से हर चीज़ आगे बढ़ती रहती है।' }, { text: 'जड़त्व के कारण वायुमंडल चलता रहेगा।' }, { text: 'पृथ्वी अपनी धुरी पर घूमती है।' }] };
  assert.deepEqual(termProblems(HI, s, { beats: ['Inertia keeps everything moving.', 'Because of inertia the atmosphere keeps moving.', 'Earth completes one rotation a day.'] }), []);
});
test('terms: an uncertain spelling is reported for review with the standard spelling, never guessed into the text', () => {
  const s = { lines: [{ text: 'सिस्टमीक हार्ट पूरे शरीर में खून भेजता है।' }] };
  const p = termProblems(HI, s, { beats: ['The heart pumps blood.'] });
  assert.ok(p.some((x) => /"सिस्टमीक" — the standard spelling is "सिस्टमिक"/.test(x)), JSON.stringify(p));
  assert.equal(s.lines[0].text, 'सिस्टमीक हार्ट पूरे शरीर में खून भेजता है।');
});

// ── length fitting (mocked model) ─────────────────────────────────────────────────────────────────────────────
const long = ['पृथ्वी हर दिन अपनी धुरी पर लगभग 24 घंटे में एक पूरा चक्कर लगाती है और यह बहुत तेज़ी से घूमती है।',
  'भूमध्य रेखा पर इसकी सतह लगभग 1670 किलोमीटर प्रति घंटे की रफ़्तार से घूमती है, जो सच में बहुत तेज़ है।',
  'अगर यह अचानक रुक जाए, तो वायुमंडल और महासागर अपनी पुरानी गति से आगे बढ़ते रहेंगे, बिना रुके।',
  'इस वजह से बहुत तेज़ हवाएँ चलेंगी और बड़ी-बड़ी लहरें तटों से टकराएँगी, जिससे भारी नुकसान होगा।',
  'इसलिए पाँच सेकंड का यह ठहराव भी पूरी दुनिया के लिए एक बहुत बड़ी आपदा बन जाएगा, सोचिए ज़रा।'];
const value = () => ({ script: { title: 't', lines: long.map((text) => ({ text, visual: 'v' })) }, meta: {} });
const shorter = ['पृथ्वी लगभग 24 घंटे में अपनी धुरी पर एक चक्कर लगाती है।', 'भूमध्य रेखा पर सतह लगभग 1670 किलोमीटर प्रति घंटे से घूमती है।', 'अगर यह अचानक रुके, तो वायुमंडल और महासागर आगे बढ़ते रहेंगे।', 'इससे तेज़ हवाएँ चलेंगी और बड़ी लहरें तटों से टकराएँगी।', 'इसलिए पाँच सेकंड का ठहराव भी दुनिया के लिए आपदा होगा।'];
const mock = (lines) => async () => ({ text: JSON.stringify({ lines }), truncated: false });

test('length: a script ~12 % (or more) over target is shortened, every number kept, decisions logged', async () => {
  const v = value(), cfg = { ...HI, durationSeconds: Math.round(estimateSeconds(v.script, HI).seconds / 1.2) };
  const out = await fitLength(cfg, v, { chatFn: mock(shorter) });
  assert.equal(out.meta.lengthFit.improved, true);
  assert.ok(out.meta.lengthFit.to < out.meta.lengthFit.from);
  assert.ok(out.script.lines[0].text.includes('24') && out.script.lines[1].text.includes('1670'));
  const res = out.meta.lengthFitLog[0].lines.map((l) => l.result);
  assert.ok(res.includes('accepted') && res.every((r) => r === 'accepted' || r === 'not needed'), JSON.stringify(res));
  // over-shortening is avoided: only the lines needed to reach the target are applied
  assert.ok(Math.abs(out.meta.lengthFit.to - cfg.durationSeconds) <= cfg.durationSeconds * 0.12, JSON.stringify(out.meta.lengthFit));
});
test('length: a rewrite that drops a number or is not shorter is rejected line by line with a clear reason', async () => {
  const v = value(), cfg = { ...HI, durationSeconds: Math.round(estimateSeconds(v.script, HI).seconds / 1.2) };
  const bad = [...shorter]; bad[1] = 'भूमध्य रेखा पर सतह बहुत तेज़ घूमती है।'; bad[2] = long[2] + ' और यह बात सच है।';
  const out = await fitLength(cfg, v, { chatFn: mock(bad) });
  const r = out.meta.lengthFitLog[0].lines;
  assert.match(r.find((x) => x.line === 2).reason, /dropped a number \(1670\)/);
  assert.match(r.find((x) => x.line === 3).reason, /not shorter/);
  assert.equal(out.script.lines[1].text, long[1]);   // rejected lines keep the original text
  assert.ok(out.meta.lengthFit.to < out.meta.lengthFit.from);   // the accepted lines still shortened the script
});
test('length: when nothing improves it is reported as not improved (never as success)', async () => {
  const v = value(), cfg = { ...HI, durationSeconds: Math.round(estimateSeconds(v.script, HI).seconds / 1.2) };
  const out = await fitLength(cfg, v, { chatFn: mock(long) });
  assert.equal(out.meta.lengthFit.improved, false);
  assert.match(out.meta.lengthFitLog.at(-1).result, /no improvement/);
});

// ── voice calibration ──────────────────────────────────────────────────────────────────────────────────────────
test('calibration: contaminated narration (emoji, stray quotes, Marathi, Latin in Devanagari) is excluded', () => {
  assert.match(contaminationReason([{ text: 'पृथ्वी घूमती है!”, 🌍”, “यह तेज़ है।' }], HI), /emoji|quoted/);
  assert.match(contaminationReason([{ text: 'या गतीमुळे सर्व काही पुढे सरकत राहते।' }], HI), /Marathi/);
  assert.match(contaminationReason([{ text: 'पृथ्वी Earth की तरह घूमती है।' }], HI), /Latin/);
  assert.equal(contaminationReason([{ text: 'पृथ्वी अपनी धुरी पर घूमती है।' }], HI), '');
});
test('calibration: one sample stays provisional; ≥3 clean samples use the median (an outlier cannot distort it)', () => {
  const one = calibratedRate(9.1, [6.3]);
  assert.match(one.confidence, /provisional \(1\/3/); assert.ok(one.rate > 6.3 && one.rate < 9.1 * 0.9);
  const many = calibratedRate(9.1, [8.6, 8.8, 3.0, 8.7]);
  assert.match(many.confidence, /measured \(4 clean samples/); assert.ok(Math.abs(many.rate - 8.65) < 0.01);
  assert.match(calibratedRate(9.1, []).confidence, /default/);
});

// ── visual concept ────────────────────────────────────────────────────────────────────────────────────────────
const keyTerms = ['hemocyanin', 'branchial hearts', 'gills'];
test('visuals: the right keyword in the background does not make the wrong subject right', () => {
  const p = visualProblems({ lines: [{ text: 'x', visual: 'Close-up of a single gill, with a small hemocyanin label in the corner.' }] },
    { beats: ['Octopus blood is blue because of hemocyanin.'], topic: 'Why do octopuses have three hearts?', keyTerms, shots: [{ subject: 'a single gill', action: 'pulsing', environment: 'lab', objects: ['hemocyanin label'] }] });
  assert.equal(p.length, 1); assert.match(p[0], /only in the background/);
});
test('visuals: a genuinely relevant visual passes', () => {
  const p = visualProblems({ lines: [{ text: 'x', visual: 'Macro shot of blue octopus blood, hemocyanin molecules carrying oxygen.' }] },
    { beats: ['Octopus blood is blue because of hemocyanin.'], topic: 'Why do octopuses have three hearts?', keyTerms, shots: [{ subject: 'hemocyanin molecules in blue blood', action: 'carrying oxygen', environment: 'microscopic', objects: [] }] });
  assert.deepEqual(p, []);
});
