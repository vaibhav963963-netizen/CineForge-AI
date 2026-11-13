// Regressions from the scriptgen final code audit (and the Earth-rotation render that failed at Kokoro).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emptyHook, storyProblems, visualProblems, estimateSeconds, hindiCps, HINDI_CPS, checkLanguage, marathiWords, stripLeaks, finalizeGates } from '../dashboard/lib/scriptgen.js';

const SRC = fs.readFileSync(new URL('../dashboard/lib/scriptgen.js', import.meta.url), 'utf8');
const cfg = (id, extra = {}) => ({ topic: 'x', durationSeconds: 40, language: id === 'en' ? { id: 'en', code: 'en', script: 'Latn', captionScript: 'Latn', name: 'English' } : id === 'hinglish' ? { id: 'hinglish', code: 'hi', script: 'Latn', captionScript: 'Latn', ttsScript: 'Deva', name: 'Hinglish' } : { id: 'hi-formal', code: 'hi', script: 'Deva', captionScript: 'Deva', name: 'Hindi' }, narration: { voice: 'no_such_voice_for_tests', speed: 1, delivery: { lead: 0.3, outro: 1, gap: 0.3 } }, ...extra });

test('hooks: specific curiosity questions pass; empty generic openers fail', () => {
  for (const h of ['क्या आप जानते हैं कि चाँद हमें हमेशा अपना एक ही चेहरा क्यों दिखाता है?', 'Have you ever wondered why octopuses have three hearts?', 'Kya aap jaante hain ki octopus ke teen dil hote hain?']) assert.equal(emptyHook(h), false, h);
  for (const h of ['क्या आप जानते हैं?', 'Did you know this?', 'सुनो, आज कुछ नया।', 'एक मिनट, सुनो!', 'Today we are going to talk about the Moon.']) assert.equal(emptyHook(h), true, h);
});

test('editorial authority: the advisory model verdict never triggers or approves a rewrite (source check)', () => {
  const review = SRC.slice(SRC.indexOf('async function reviewScript'), SRC.indexOf('export function finalizeGates'));
  assert.ok(!/judgedNow\.hook\s*!==/.test(review), 'reviewScript must not branch on the model verdict');
  assert.ok(/improveHookEnding\(config, cur, det,/.test(review), 'the rewrite is driven by deterministic problems');
  const ihe = SRC.slice(SRC.indexOf('export async function improveHookEnding'));
  assert.ok(!/await judgeScript\(/.test(ihe.slice(0, ihe.indexOf('\n}\n'))), 'no re-judgment decides acceptance');
});

test('visuals: wrong subject for the line is flagged (hemocyanin vs gill, branchial vs unrelated heart, tidal locking vs a person)', () => {
  const keyTerms = ['branchial hearts', 'hemocyanin', 'systemic heart', 'gills'];
  const sc = { lines: [{ text: 'x', visual: 'Close-up of a single gill showing muscular contractions pumping blood.' }, { text: 'x', visual: 'Close-up of a human heart beating inside a ribcage.' }, { text: 'x', visual: 'Macro shot of blue blood with hemocyanin molecules glowing.' }] };
  const p = visualProblems(sc, { beats: ['Octopus blood is blue because it carries oxygen with hemocyanin.', 'The two branchial hearts pump blood through the gills.', 'Octopus blood is blue because of hemocyanin.'], topic: 'Why do octopuses have three hearts?', keyTerms });
  assert.deepEqual(p.map((x) => +x.match(/^line (\d+)/)[1]), [1, 2]);
  const moon = visualProblems({ lines: [{ text: 'x', visual: 'Wide shot of a young boy gazing at the full moon.' }] }, { beats: ['The Moon is tidally locked to Earth.'], topic: 'Why does the Moon show one face?' });
  assert.match(moon[0], /shows people/);
});

test('visuals: wrong action for the line is flagged (the systemic heart stopping vs an octopus releasing ink)', () => {
  const p = visualProblems({ lines: [{ text: 'x', visual: 'Slow-motion shot of an octopus releasing a cloud of ink.' }] }, { beats: ['The systemic heart stops beating while the octopus swims.'], topic: 'Why do octopuses have three hearts?', keyTerms: ['systemic heart'] });
  assert.equal(p.length, 1);
});

test('visuals: no English text to compare → marked for review, never silently passed', () => {
  const p = visualProblems({ lines: [{ text: 'चाँद हमेशा एक ही चेहरा दिखाता है।', visual: 'Wide shot of the full moon.' }] }, { topic: 'Moon' });
  assert.match(p[0], /could not be checked/);
});

test('Hindi duration: an uncalibrated voice uses a conservative provisional rate (10 % slower than the reference)', () => {
  assert.equal(hindiCps(cfg('hi')), +(HINDI_CPS * 0.9).toFixed(3));
  const s = { lines: [{ text: 'पृथ्वी हर चौबीस घंटे में अपनी धुरी पर एक बार घूमती है।' }] };
  const e = estimateSeconds(s, cfg('hi'));
  assert.ok(e.speechSeconds > 3 && e.speechSeconds < 8, JSON.stringify(e));
});

test('Hinglish duration: the Devanagari voice text (say) is what is timed, not the Roman caption', () => {
  const shortSay = { lines: [{ text: 'Octopus ke teen dil hote hain.', say: 'ऑक्टोपस के तीन दिल होते हैं।' }] };
  const longSay = { lines: [{ text: 'Octopus ke teen dil hote hain.', say: 'ऑक्टोपस के तीन दिल होते हैं, दो गिल्स के लिए और एक पूरे शरीर के लिए।' }] };
  assert.ok(estimateSeconds(longSay, cfg('hinglish')).speechSeconds > estimateSeconds(shortSay, cfg('hinglish')).speechSeconds);
});

test('final saved-script validation: Marathi inside Hindi and emoji/quoted junk are language failures (status FAILED)', () => {
  assert.ok(marathiWords('या गतीमुळे सर्व काही पुढे सरकत राहते, जोपर्यंत ते थांबत नाही।') >= 2);
  assert.equal(marathiWords('इसलिए सब कुछ आगे बढ़ता रहेगा और कुछ भी नहीं रुकेगा।'), 0);
  const junk = { lines: [{ text: 'पृथ्वी हर 24 घंटे में घूमती है!”, 🌍”, “यह गति बहुत तेज है।' }] };
  assert.ok(checkLanguage(junk, cfg('hi')).some((p) => /emoji or stray/.test(p)));
  assert.equal(stripLeaks(junk.lines[0].text), 'पृथ्वी हर 24 घंटे में घूमती है!');
  const v = { script: { lines: [{ text: 'अचानक थांबल्यास, गती कायम राहील, ज्यामुळे मोठा बदल घडून येईल।', visual: 'Wide shot of Earth from space.' }] }, meta: { claimReview: { claims: [] }, research: { essentials: [], evidence: [] }, llmReview: { modelIssues: [], issues: [] } } };
  const out = finalizeGates(cfg('hi', { topic: 'Earth stops rotating' }), v);
  assert.equal(out.meta.status, 'FAILED'); assert.ok(out.meta.gates.language.issues.some((x) => /Marathi/.test(x)));
});

test('one-click render: a length far off target stops before TTS even when review issues are accepted (source check)', () => {
  const p = fs.readFileSync(new URL('../dashboard/lib/pipeline.js', import.meta.url), 'utf8');
  assert.ok(/Math\.abs\(dur\.estimatedSeconds - config\.durationSeconds\) > config\.durationSeconds \* Math\.max\(0\.15, \(config\.durationTolerance \|\| 0\.1\) \* 1\.5\)/.test(p));
});
