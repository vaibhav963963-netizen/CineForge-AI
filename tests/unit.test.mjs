// Unit tests: generation-config validation, job progress math, storyboard matching. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGenerationConfig, scriptFingerprint } from '../dashboard/lib/validate.js';
import { getCatalog } from '../dashboard/lib/catalog.js';
import { Job } from '../dashboard/lib/jobs.js';
import { analyze, findNumbers, planStoryboard } from '../dashboard/lib/storyboard.js';
import { checkLanguage, wordBudget } from '../dashboard/lib/scriptgen.js';

const base = { topic: 'How ISRO reached Mars', language: 'en', personality: 'documentary', voice: 'am_michael', style: 'night-file', character: 'none', durationSeconds: 30, visualMode: 'procedural' };
const V = (o, opts = { purpose: 'render', hasApprovedScript: true }) => validateGenerationConfig({ ...base, ...o }, opts);
const fields = (r) => r.errors.map((e) => e.field);

test('catalog: voices come from the installed voice pack, Hindi voices present', () => {
  const c = getCatalog(true);
  const hi = c.voices.filter((v) => v.language === 'hi').map((v) => v.id);
  assert.deepEqual(hi.sort(), ['hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi']);
  assert.equal(c.styles.length, 6);
  for (const s of ['tall-tale', 'deep-dive', 'night-file', 'inside-out', 'stick-story', 'paper-atlas']) assert.ok(c.styles.find((x) => x.id === s && x.available), s);
  assert.ok(c.characters.find((x) => x.id === 'none'));
  assert.ok(c.characters.find((x) => x.id === 'desi_hero' && x.available && x.name === 'Bunty'));
});

test('validation: a supported English config is accepted and normalized', () => {
  const r = V({});
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.config.language.code, 'en');
  assert.equal(r.config.narration.voice, 'am_michael');
  assert.equal(r.config.narration.ttsLang, 'en-us');
  assert.equal(r.config.visual.characterMode, 'none');
  assert.equal(r.config.resolution, '1080x1920');
});

test('validation: Hindi with an English voice is refused, alternatives are the Hindi voices', () => {
  const r = V({ language: 'hi-conversational', voice: 'am_michael' });
  assert.equal(r.ok, false);
  const e = r.errors.find((x) => x.field === 'voice');
  assert.ok(e, 'voice error expected');
  assert.deepEqual(e.alternatives.sort(), ['hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi']);
});

test('validation: English with a Hindi voice is refused (no silent fallback either way)', () => {
  const r = V({ voice: 'hm_omega' });
  assert.equal(r.ok, false); assert.ok(fields(r).includes('voice'));
});

test('validation: Mumbai Conversational requires Hindi/Hinglish', () => {
  const r = V({ personality: 'mumbai-conversational' });
  assert.equal(r.ok, false); assert.ok(fields(r).includes('personality'));
  assert.equal(V({ language: 'hinglish', voice: 'hf_alpha', personality: 'mumbai-conversational' }).ok, true);
});

test('validation: unknown ids and out-of-range durations are errors, never defaults', () => {
  assert.ok(fields(V({ style: 'cyberpunk' })).includes('style'));
  assert.ok(fields(V({ character: 'nobody' })).includes('character'));
  assert.ok(fields(V({ voice: 'xx_fake' })).includes('voice'));
  assert.ok(fields(V({ durationSeconds: 5 })).includes('durationSeconds'));
  assert.ok(fields(V({ language: undefined })).includes('language'));
  assert.ok(fields(V({ visualMode: 'cloud' })).includes('visualMode'));
});

test('validation: the script fingerprint changes with topic/language/personality/duration only', () => {
  const a = V({}).config, b = V({ style: 'paper-atlas', character: 'desi_hero' }).config, c = V({ durationSeconds: 35 }).config;
  assert.equal(scriptFingerprint(a), scriptFingerprint(b));
  assert.notEqual(scriptFingerprint(a), scriptFingerprint(c));
});

test('script language check: English text for a Hindi config is rejected; Devanagari passes', () => {
  const hi = V({ language: 'hi-conversational', voice: 'hm_omega', personality: 'documentary' }).config;
  assert.ok(checkLanguage({ lines: [{ text: 'India reached Mars on the first try.' }] }, hi).length > 0);
  assert.equal(checkLanguage({ lines: [{ text: 'भारत ने पहली ही बार में मंगल ग्रह तक पहुँच बनाई।' }] }, hi).length, 0);
  const hg = V({ language: 'hinglish', voice: 'hf_alpha', personality: 'documentary' }).config;
  assert.ok(checkLanguage({ lines: [{ text: 'Kya aapko pata hai ISRO ne Mars tak kaise pahuncha?' }] }, hg).length > 0, 'Hinglish line without say');
  assert.equal(checkLanguage({ lines: [{ text: 'Kya aapko pata hai ISRO ne Mars tak kaise pahuncha?', say: 'क्या आपको पता है इसरो ने मार्स तक कैसे पहुँचा?' }] }, hg).length, 0);
});

test('duration controls the word budget', () => {
  const c30 = V({ durationSeconds: 30 }).config, c60 = V({ durationSeconds: 60 }).config;
  assert.ok(wordBudget(c60, 18) > wordBudget(c30, 9) * 1.8);
});

// ── progress math ──────────────────────────────────────────────────────────────────────────────────────────
const plan = [{ id: 'validate', weight: 10 }, { id: 'tts', weight: 40 }, { id: 'images', weight: 20 }, { id: 'qa', weight: 30 }];
const quiet = (j) => { j.save = () => {}; j.log = () => {}; return j; };

test('progress: weighted, monotonic, real fractions only, capped at 99 until completion', () => {
  const j = quiet(new Job({ kind: 'render', projectId: 'p', plan }));
  j.begin(); const seen = [];
  const rec = () => seen.push(j.progress);
  j.startStage('validate'); rec(); j.completeStage('validate'); rec();
  assert.equal(j.progress, 10);
  j.startStage('tts'); j.stageProgress('tts', { current: 1, total: 4 }); rec();
  assert.equal(j.progress, 20);
  j.stageProgress('tts', { current: 0, total: 4 }); rec();
  assert.equal(j.progress, 20, 'a lower report never moves progress backwards');
  j.stageProgress('tts', { indeterminate: true }); rec();
  assert.equal(j.progress, 20, 'indeterminate holds the bar');
  j.completeStage('tts'); rec();
  j.skipStage('images', 'procedural'); rec();
  assert.equal(j.progress, Math.floor(50 / 80 * 100), 'a skipped stage leaves the plan');
  j.startStage('qa'); j.stageProgress('qa', { fraction: 1 }); rec();
  assert.equal(j.progress, 99, 'never 100 before completion');
  j.complete({ ok: true }); rec();
  assert.equal(j.progress, 100);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], `monotonic ${seen}`);
});

test('progress: a failure freezes the bar and is never 100; cancel marks cancelled', () => {
  const j = quiet(new Job({ kind: 'render', projectId: 'p', plan }));
  j.begin(); j.startStage('validate'); j.completeStage('validate'); j.startStage('tts'); j.stageProgress('tts', { fraction: 0.5 });
  const before = j.progress; j.fail(new Error('boom'));
  assert.equal(j.status, 'failed'); assert.equal(j.failedStage, 'tts'); assert.equal(j.progress, before); assert.ok(j.progress < 100);
  const k = quiet(new Job({ kind: 'render', projectId: 'p', plan }));
  k.begin(); k.startStage('validate'); k.requestCancel(); k.fail(Object.assign(new Error('x'), { cancelled: true }));
  assert.equal(k.status, 'cancelled'); assert.ok(k.progress < 100);
});

// ── storyboard ─────────────────────────────────────────────────────────────────────────────────────────────
test('storyboard: whole-word matching (no "king" inside "thinking"), Hindi + English triggers', () => {
  assert.ok(!analyze('an engineer thinking hard').some((c) => c.id === 'history'));
  assert.ok(analyze('the king of the fort').some((c) => c.id === 'history'));
  assert.ok(analyze('बल्लेबाज ने छक्का मारा').some((c) => c.id === 'batting'));
  assert.ok(analyze('मंदिर की घंटी').some((c) => c.id === 'bell'));
  assert.deepEqual(findNumbers('Gravity $100M vs Mangalyaan $74M').map((n) => n.value), ['$100M', '$74M']);
});

test('storyboard: cricket narration → cricket ground, batting lead, bowler extra, 3D in 3D styles', () => {
  const config = V({ style: 'tall-tale', character: 'desi_hero' }).config, style = getCatalog().styles.find((s) => s.id === 'tall-tale');
  const lines = [{ text: 'In gully cricket, the batsman owns the bat.', visual: 'a batsman hitting a six in a street cricket match' }, { text: 'And he never gets out first ball.', visual: 'the bowler bowls and the batsman swings' }, { text: 'Rules are rules.', visual: 'kids celebrating' }];
  const timing = { duration: 10, lines: [{ start: 0.3, end: 3 }, { start: 3.3, end: 6.2 }, { start: 6.5, end: 9 }] };
  const sb = planStoryboard({ script: { title: 't', lines }, timing, words: [], config, style, topic: 'gully cricket rules' });
  const s1 = sb.shots[0];
  assert.equal(s1.environment, 'cricket');
  assert.ok(s1.cast.some((c) => c.role === 'lead' && c.action === 'bat_swing'));
  assert.ok(s1.cast.some((c) => c.role === 'extra' && c.action === 'bowl'));
  assert.equal(s1.method, 'scene3d');
  for (const s of sb.shots) for (const k of ['visualObjective', 'subject', 'environment', 'camera', 'lighting', 'method', 'transition', 'animation']) assert.ok(s[k] !== undefined, `${s.id}.${k}`);
});

test('storyboard: no lead character in space, and none at all when "No Lead Character" is chosen', () => {
  const style = getCatalog().styles.find((s) => s.id === 'deep-dive');
  const lines = [{ text: 'India reached Mars.', visual: 'the orbiter arriving at Mars in space' }, { text: 'Scientists celebrated.', visual: 'a scientist celebrating in a lab' }];
  const timing = { duration: 7, lines: [{ start: 0.3, end: 3 }, { start: 3.3, end: 6.5 }] };
  const withLead = planStoryboard({ script: { title: 't', lines }, timing, words: [], config: V({ style: 'deep-dive', character: 'desi_hero' }).config, style, topic: 'isro' });
  assert.equal(withLead.shots[0].environment, 'space'); assert.ok(!withLead.shots[0].cast.some((c) => c.role === 'lead'));
  assert.ok(withLead.shots[1].cast.some((c) => c.role === 'lead'));
  const none = planStoryboard({ script: { title: 't', lines }, timing, words: [], config: V({ style: 'deep-dive', character: 'none' }).config, style, topic: 'isro' });
  assert.ok(none.shots.every((s) => !s.cast.some((c) => c.role === 'lead')));
});
