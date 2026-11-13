// Script pipeline regression tests (no model): structured output, language modes, claim ledger, readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonStrict, hinglishProblems, claimLedger, readiness, qualityGates, EN_HEDGE, HI_HEDGE, ungrounded, checkLanguage } from '../dashboard/lib/scriptgen.js';
import { findTopicFacts, reviewClaims } from '../dashboard/lib/factcheck.js';

const cfg = (id, extra = {}) => ({ topic: 't', durationSeconds: 30, language: id === 'en' ? { id: 'en', code: 'en', script: 'Latn', captionScript: 'Latn', name: 'English' } : id === 'hinglish' ? { id: 'hinglish', code: 'hi', script: 'Latn', captionScript: 'Latn', ttsScript: 'Deva', name: 'Hinglish' } : { id: 'hi-conversational', code: 'hi', script: 'Deva', captionScript: 'Deva', name: 'Hindi' }, narration: { voice: 'x', speed: 1, delivery: { lead: 0.3, outro: 1, gap: 0.3 } }, ...extra });

test('structured output: fences/trailing commas/raw newlines are repaired; truncated output is rejected, never partially accepted', () => {
  assert.deepEqual(parseJsonStrict('```json\n{"lines":[{"text":"a\nb"},]}\n```'), { lines: [{ text: 'a\nb' }] });
  assert.equal(parseJsonStrict('{"title":"x","lines":[{"text":"मंगलयान ने'), null);
  assert.equal(parseJsonStrict('{"lines":[{"text":"cut'), null);
  assert.deepEqual(parseJsonStrict('{"t":"मंगल \\"यान\\""}'), { t: 'मंगल "यान"' });
});

test('Hinglish: an English-only line and a missing Devanagari voice form are reported; real Hinglish passes', () => {
  const good = { lines: [{ text: 'Chand hamesha ek hi side dikhata hai.', say: 'चाँद हमेशा एक ही साइड दिखाता है।', english: ['side'] }, { text: 'Iski wajah Earth ki gravity hai.', say: 'इसकी वजह अर्थ की ग्रेविटी है।', english: ['Earth', 'gravity'] }] };
  assert.deepEqual(hinglishProblems(good), []);
  const bad = { lines: [{ text: 'The Moon always shows the same side to the Earth.', say: 'द मून ऑलवेज़…', english: ['moon', 'always', 'shows', 'same', 'side', 'earth'] }, { text: 'Sher Shah Suri ne road banayi.', say: 'Sher Shah Suri ने रोड बनाई।', english: ['road'] }] };
  const p = hinglishProblems(bad);
  assert.ok(p.some((x) => /English sentences/.test(x) && /lines 1\b/.test(x))); assert.ok(p.some((x) => /voice form/.test(x) && /2/.test(x)));
});

test('English mode: Devanagari inside an English script is a language failure', () => {
  assert.ok(checkLanguage({ lines: [{ text: 'The road was rebuilt by शेर शाह.' }] }, cfg('en')).length > 0);
});

test('attribution survives translation: hedges are recognised in English and Hindi', () => {
  assert.ok(EN_HEDGE.test('Scientists think the river shifted course.')); assert.ok(EN_HEDGE.test('Rivers may have dried up.'));
  assert.ok(HI_HEDGE.test('वैज्ञानिकों का मानना है कि नदी ने रास्ता बदला।')); assert.ok(!HI_HEDGE.test('नदी का रास्ता बदल गया।'));
});

test('theory stated as fact (seen in Indus Hindi): flagged through the English draft even when the Hindi line cannot be matched', () => {
  const tf = findTopicFacts('Why did the cities of the Indus Valley Civilisation decline?');
  const draft = reviewClaims({ lines: [{ text: 'The Ghaggar-Hakra river dried up and the cities died.' }] }, { topic: 'Indus', topicFacts: tf });
  assert.ok(draft.claims.some((c) => c.status === 'needs-attribution'));
  const hindi = { script: { lines: [{ text: 'घग्गर-हकरा नदी सूख गई और शहर खत्म हो गए।', visual: 'Dry riverbed of the Ghaggar-Hakra beside ruined brick city walls.' }] },
    meta: { factFile: tf.file, claimReview: { claims: [] }, englishDraft: { lines: ['The Ghaggar-Hakra river dried up and the cities died.'] }, draftFlags: draft.claims.filter((c) => c.status === 'needs-attribution').map((c) => ({ ...c, fromDraft: true })), research: { essentials: [], evidence: [] } } };
  const g = qualityGates(cfg('hi', { topic: 'Indus' }), hindi);
  assert.equal(g.facts.ok, false); assert.ok(g.facts.issues.some((x) => /theory or belief stated as fact/.test(x)));
});

test('valid scientific terms are not names; sentence openers and adverbs are not names', () => {
  const src = 'Vaccines train the immune system. B cells make antibodies; T cells destroy infected cells. Edward Jenner 1796 smallpox.';
  assert.deepEqual(ungrounded(['Cytotoxic T cells directly kill infected cells.', 'Consequently, memory cells remain.', 'Protecting others matters.'], src), []);
});

test('claim ledger: IDs, lines, statuses, sources and explanations; no source → NEEDS_RESEARCH, never VERIFIED', () => {
  const tf = findTopicFacts('ISRO Mars Orbiter Mission');
  const s = { lines: [{ text: 'Mangalyaan entered Mars orbit on 24 September 2014.' }, { text: 'It cost 900 crore.' }] };
  const rv = reviewClaims(s, { topic: 'ISRO Mars Orbiter Mission', topicFacts: tf });
  const L = claimLedger({ script: s, meta: { factFile: tf.file, claimReview: rv } }, tf);
  assert.ok(L.every((c) => /^C\d+$/.test(c.id) && c.line >= 1));
  assert.ok(L.some((c) => c.status === 'VERIFIED' && c.claim === '2014' && /24 September 2014/.test(c.source.fact)));
  assert.ok(L.some((c) => c.status === 'UNSUPPORTED' && /900/.test(c.claim) && c.explanation));
  const none = claimLedger({ script: s, meta: { claimReview: { claims: [{ line: 1, value: '2014', status: 'unverified' }] } } });
  assert.equal(none[0].status, 'NEEDS_RESEARCH');
});

test('readiness: language failure → FAILED; any other failed gate → NEEDS_REVIEW; all pass → READY', () => {
  const ok = { ok: true, issues: [] }, no = { ok: false, issues: ['x'] };
  assert.equal(readiness({ language: no, facts: ok }), 'FAILED');
  assert.equal(readiness({ language: ok, facts: ok, editorial: no }), 'NEEDS_REVIEW');
  assert.equal(readiness({ language: ok, facts: ok, editorial: ok }), 'READY');
});

test('editorial: the whole-script model judgment is advisory (calibration showed it cannot discriminate) — its notes are kept, it does not decide READY', () => {
  const v = { script: { lines: [{ text: 'The Indus cities were large.', visual: 'Wide shot of the brick ruins of Mohenjo-daro under a hot sun.' }, { text: 'Their drains were covered.', visual: 'Close-up of covered brick drains in Mohenjo-daro ruins.' }] },
    meta: { factFile: 'x.json', claimReview: { claims: [] }, research: { essentials: [], evidence: [] }, editorialJudgment: { hook: 'weak', hookNote: 'plain statement', flow: 'connected', ending: 'abrupt', endingNote: 'stops after a fact' } } };
  const g = qualityGates(cfg('en', { topic: 'Indus Valley cities' }), v);
  assert.equal(g.editorial.ok, true); assert.ok(g.editorial.advisory.some((x) => /ending is abrupt/.test(x)));
});
import fs from 'node:fs';
import { unframedLines } from '../dashboard/lib/scriptgen.js';
test('native generation: the primary pipeline never translates (generateCore does not call viaEnglish)', () => {
  const src = fs.readFileSync(new URL('../dashboard/lib/scriptgen.js', import.meta.url), 'utf8');
  const core = src.slice(src.indexOf('async function generateCore'), src.indexOf('\n}\n', src.indexOf('async function generateCore')));
  assert.ok(!/viaEnglish\(/.test(core)); assert.ok(/generateDirect\(config, opts\)/.test(core));
});
test('theory framing from the shared plan is checked in each language', () => {
  const plan = { beats: [{ factKinds: ['established'], factTexts: ['a'] }, { factKinds: ['speculation'], factTexts: ['Rivers may have shifted course.'] }] };
  const hi = { language: { id: 'hi-conversational', script: 'Deva' } }, en = { language: { id: 'en', script: 'Latn' } }, hg = { language: { id: 'hinglish', script: 'Latn' } };
  assert.deepEqual(unframedLines(hi, [{ text: 'शहर बड़े थे।' }, { text: 'नदी का रास्ता बदल गया।' }], plan).map((u) => u.line), [2]);
  assert.deepEqual(unframedLines(hi, [{ text: 'शहर बड़े थे।' }, { text: 'माना जाता है कि नदी का रास्ता बदल गया।' }], plan), []);
  assert.deepEqual(unframedLines(en, [{ text: 'x' }, { text: 'Scientists think the river shifted course.' }], plan), []);
  assert.deepEqual(unframedLines(hg, [{ text: 'x' }, { text: 'Nadi ka rasta badal gaya.', say: 'नदी का रास्ता बदल गया।' }], plan).map((u) => u.line), [2]);
  assert.deepEqual(unframedLines(hg, [{ text: 'x' }, { text: 'Maana jaata hai ki nadi ka rasta badla.', say: 'माना जाता है कि नदी का रास्ता बदला।' }], plan), []);
});
import { missingEssentials as ME, finalizeGates } from '../dashboard/lib/scriptgen.js';
test('coverage in Devanagari checks names only; concepts are not reported missing across scripts', () => {
  const r = { essentials: ['Luna 3', 'Tidal Locking', 'Gravity'], essentialKinds: { 'Luna 3': 'event', 'Tidal Locking': 'concept', Gravity: 'concept' } };
  assert.deepEqual(ME(r, '1959 में लूना 3 ने दूर के हिस्से की तस्वीर ली। इसे ज्वारीय बंधन कहते हैं।'), []);
  assert.deepEqual(ME(r, 'चाँद हमेशा एक ही चेहरा दिखाता है।'), ['Luna 3']);
});
test('gates are computed on the FINAL visuals and FINAL lines (not the draft)', () => {
  const config = cfg('en', { topic: 'Why does the Moon always show the same face to Earth?' });
  const v = { script: { lines: [{ text: 'The Moon spins once for every trip around Earth.', visual: 'Wide shot of a young boy gazing at the full moon from a hilltop.' }] },
    meta: { factFile: 'facts/moon-tidal-locking.json', groundText: 'Moon Earth spins once trip around', claimReview: { claims: [] }, research: { essentials: [], evidence: [] }, ungrounded: [{ line: 1, terms: ['Wide'] }], llmReview: { modelIssues: [], issues: [] } } };
  const out = finalizeGates(config, v);
  assert.ok(out.meta.gates.visuals.issues.some((x) => /shows people/.test(x)));
  assert.ok(!out.meta.gates.facts.issues.some((x) => /Wide/.test(x)));
  assert.equal(out.meta.llmReview.confirmed, false);
});
