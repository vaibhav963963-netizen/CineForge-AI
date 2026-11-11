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

test('script review: checkable claims (years, numbers, quantities, names) are listed for verification', async () => {
  const { extractClaims } = await import('../dashboard/lib/scriptgen.js');
  const c = extractClaims({ lines: [{ text: 'In 1999, skeletons were discovered there.' }, { text: 'Around 45 skeletons were found.' }, { text: 'A sad tale.' }, { text: 'पूरा मिशन साढ़े चार सौ करोड़ में बना।' }] });
  assert.deepEqual(c.map((x) => x.line), [1, 2, 4]);
  assert.ok(c[0].check.includes('year 1999') && c[1].check.includes('number 45'));
});

test('storyboard: placeholder on-screen values ("None", "N/A", "-") never become overlays', () => {
  const config = V({ style: 'night-file' }).config, style = getCatalog().styles.find((s) => s.id === 'night-file');
  const lines = [{ text: 'A frozen lake hides a secret.', visual: 'a frozen lake at night', onScreen: 'None' }, { text: 'It was found long ago.', visual: 'a dark shore', onScreen: 'N/A' }];
  const sb = planStoryboard({ script: { title: 't', lines }, timing: { duration: 7, lines: [{ start: 0.3, end: 3 }, { start: 3.3, end: 6.5 }] }, words: [], config, style, topic: 'lake' });
  assert.ok(sb.shots.every((s) => !s.overlay || !/none|n\/a/i.test(JSON.stringify(s.overlay))));
});

// ── visual quality: AI-image coverage, image reuse, exposure verdicts ──────────────────────────────────────────
test('storyboard: hybrid mode covers every non-action shot with an AI image (no budget cap) and reuses repeats', () => {
  const config = V({ style: 'night-file', character: 'none', visualMode: 'hybrid-local' }).config, style = getCatalog().styles.find((s) => s.id === 'night-file');
  const texts = ['A frozen lake hides a secret.', 'Bones lie under the ice.', 'Pilgrims walked this path.', 'A storm came over the peaks.', 'Scientists studied the bones.', 'The DNA told a new story.', 'Two groups died centuries apart.', 'The mystery is still cold.'];
  const lines = texts.map((t, i) => ({ text: t, visual: i === 7 ? 'a frozen lake at night in the Himalayas' : ['a frozen lake at night in the Himalayas', 'bones under clear ice', 'pilgrims on a snowy trail', 'storm clouds over snowy peaks', 'scientists in a lab with bones', 'a DNA helix glowing', 'two groups of travellers on a mountain trail', 'x'][i] }));
  const timing = { duration: 8 * 3.2, lines: lines.map((_, i) => ({ start: i * 3.2 + 0.2, end: i * 3.2 + 3 })) };
  const sb = planStoryboard({ script: { title: 't', lines }, timing, words: [], config, style, topic: 'Roopkund' });
  const procedural = sb.shots.filter((s) => s.method === 'scene3d' || s.method === 'scene2d');
  assert.equal(procedural.length, 0, `procedural shots in AI-image mode: ${procedural.map((s) => s.id).join(', ')}`);
  const last = sb.shots.at(-1);
  assert.equal(last.imageReuse, sb.shots[0].id, 'identical visual reuses the first image');
});

test('exposure: near-black, blown-out and flat shots are flagged; normal dim night shots pass', async () => {
  const { judgeShots, judgeImage } = await import('../dashboard/lib/exposure.js');
  const fr = (t0, t1, avg, low, high) => Array.from({ length: Math.round((t1 - t0) * 4) }, (_, k) => ({ t: t0 + k / 4, avg, low, high }));
  const frames = [...fr(0, 3, 45, 6, 120), ...fr(3, 6, 5, 0, 4), ...fr(6, 9, 153, 74, 234), ...fr(9, 12, 30, 3, 59), ...fr(12, 15, 90, 88, 95)];
  const shots = [0, 3, 6, 9, 12].map((s, i) => ({ id: 'S0' + (i + 1), start: s, end: s + 3 }));
  const q = judgeShots(frames, shots);
  assert.deepEqual(q.bad.map((b) => b.id), ['S02', 'S03', 'S05']);
  assert.match(q.bad[0].problem, /near-black/); assert.match(q.bad[1].problem, /blown out/); assert.match(q.bad[2].problem, /flat/);
  assert.equal(judgeImage({ avg: 8, low: 0, high: 12 }) !== null, true);
  assert.equal(judgeImage({ avg: 60, low: 8, high: 140 }), null);
});

// ── factual accuracy ────────────────────────────────────────────────────────────────────────────────────────
test('fact check: invented place, legend-as-history and wrong numbers are flagged; known errors block rendering', async () => {
  const { reviewClaims, findTopicFacts, claimsGate, confirmClaims } = await import('../dashboard/lib/factcheck.js');
  const tf = findTopicFacts('The Mystery of Roopkund, the Skeleton Lake');
  assert.equal(tf?.id, 'roopkund');
  const script = { title: 'Skeleton Lake', lines: [
    { text: 'Roopkund lies in Uttarakhand’s Panna National Park.' }, { text: 'The skeletons date back to the 11th century.' },
    { text: 'A royal procession met a sudden storm.' }, { text: 'A 2019 DNA study found distinct groups who died 1,000 years apart.' },
    { text: 'Legend says a goddess punished a king with hail.' } ] };
  const r = reviewClaims(script, { topic: 'Roopkund', topicFacts: tf });
  const by = (line, st) => r.claims.filter((c) => c.line === line && c.status === st);
  assert.ok(by(1, 'contradicted').length, 'Panna National Park is a known error');
  assert.ok(by(2, 'unverified').some((c) => c.value === '11th'), '11th century is not in the verified facts');
  assert.ok(by(3, 'needs-attribution').length, 'royal procession told as fact');
  assert.equal(r.claims.filter((c) => c.line === 4 && c.status !== 'supported').length, 0, 'verified DNA facts are supported');
  assert.equal(by(5, 'needs-attribution').length, 0, 'a framed legend is fine');
  const meta = { claimReview: r };
  assert.equal(claimsGate(meta).ok, false);
  assert.throws(() => confirmClaims(meta, 'all'), /Known errors cannot be approved/);
  const clean = reviewClaims({ title: 't', lines: script.lines.slice(1) }, { topic: 'Roopkund', topicFacts: tf });
  const m2 = { claimReview: clean, ...confirmClaims({ claimReview: clean }, 'all') };
  assert.equal(claimsGate(m2).ok, true);
});

// ── Hinglish captions keep English loanwords in English spelling ──────────────────────────────────────────────
test('hinglish: English loanwords keep English spelling; Hindi words are transliterated; no false matches', async () => {
  const { hinglishCaption } = await import('../dashboard/lib/translit.js');
  assert.equal(hinglishCaption('भारत ने क्रिकेट मैच में विकेट लिया।').text, 'Bharat ne cricket match mein wicket liya.');
  assert.equal(hinglishCaption('पाकिस्तान के बॉलर ने बाउंसर डाला!', ['bowler', 'bouncer']).text, 'Pakistan ke bowler ne bouncer dala!');
  assert.equal(hinglishCaption('ISRO ने Mars पर मिशन भेजा', ['mission']).text, 'ISRO ne Mars par mission bheja');
  assert.doesNotMatch(hinglishCaption('यह काम करना है', ['come', 'car']).text, /come|car\b/);
});

test('storyboard: comparison keeps unit-only labels readable; AI-image mode puts diagrams over an AI image; abstract visuals become concrete', async () => {
  const { concreteVisual } = await import('../dashboard/lib/storyboard.js');
  const config = V({ style: 'night-file', character: 'none', visualMode: 'hybrid-local' }).config, style = getCatalog().styles.find((s) => s.id === 'night-file');
  const lines = [{ text: 'A frozen lake hides a secret.', visual: 'a frozen lake at night' }, { text: 'Two groups died a thousand years apart.', visual: 'a frozen lake at night', onScreen: '800 CE vs 1800 CE' }, { text: 'Bones lie under the ice.', visual: 'bones under clear ice' }];
  const sb = planStoryboard({ script: { title: 't', lines }, timing: { duration: 10, lines: [{ start: 0.2, end: 3 }, { start: 3.3, end: 6.5 }, { start: 6.8, end: 9.6 }] }, words: [], config, style, topic: 'Roopkund' });
  const info = sb.shots.find((s) => s.method === 'infographic');
  assert.ok(info, 'comparison shot is an infographic');
  assert.deepEqual(info.overlay.items.map((x) => x.label), ['800 CE', '1800 CE']);
  assert.ok(info.imageReuse, 'infographic gets an AI image backdrop');
  assert.match(concreteVisual('Microscopic image of ancient DNA fragments.', 'lab', 'Roopkund skeletons'), /scientist .* bone/);
  assert.equal(concreteVisual('Time-lapse of the lake freezing over.', 'mountains'), 'the lake freezing over');
});

test('image prompts: named people become their role, maps become the place, video jargon is dropped; spoken numbers meet the facts', async () => {
  const { concreteVisual } = await import('../dashboard/lib/storyboard.js');
  assert.equal(concreteVisual('black and white H. K. Madhwal', 'mountains', 'Roopkund', 'Forest ranger Madhwal found them in 1942.'), 'a man in a forest ranger uniform in the snowy Himalayas');
  assert.equal(concreteVisual('slow motion of snow melting, exposing bones', 'mountains', 'Roopkund'), 'snow melting, exposing bones');
  assert.match(concreteVisual('map showing the route of the pilgrimage', 'mountains', 'Roopkund'), /pilgrims walking/);
  assert.match(concreteVisual('ISRO scientists celebrating in the control room', 'lab', 'How ISRO reached Mars', 'ISRO scientists cheered.'), /^ISRO/);
  const { reviewClaims, findTopicFacts, spokenNumbersToDigits } = await import('../dashboard/lib/factcheck.js');
  assert.equal(spokenNumbersToDigits('around eight hundred CE at five thousand twenty metres'), 'around 800 CE at 5020 metres');
  assert.equal(reviewClaims({ lines: [{ text: 'One group died around eight hundred CE.' }] }, { topic: 'Roopkund', topicFacts: findTopicFacts('Roopkund') }).summary.needsReview, 0);
});

test('fact check: beliefs must be framed as beliefs (never credited to science); on-screen numbers are checked; units matter', async () => {
  const { reviewClaims, findTopicFacts } = await import('../dashboard/lib/factcheck.js');
  const bells = findTopicFacts('Why Do Indian Temples Have Bells?'), isro = findTopicFacts('How ISRO reached Mars for less');
  const st = (tf, l) => reviewClaims({ lines: [l] }, { topic: 't', topicFacts: tf }).claims;
  assert.ok(st(bells, { text: 'प्रतिध्वनि सात सेकंड तक रहती है, वैज्ञानिकों का मानना है।' }).some((c) => c.kind === 'belief credited to science'));
  assert.equal(st(bells, { text: 'नकारात्मक ऊर्जा दूर करती है, ऐसा माना जाता है।' }).length, 0);
  assert.ok(st(bells, { text: 'हर मंदिर में घंटा है।', onScreen: '90% temples' }).some((c) => c.value === '90%' && c.status === 'unverified'));
  assert.equal(st(isro, { text: 'फिल्म ग्रेविटी ₹100 करोड़ में बनी है।' }).find((c) => c.kind === 'number').status, 'unverified');
  assert.equal(st(isro, { text: 'Gravity cost about 100 million dollars.' }).find((c) => c.kind === 'number').status, 'supported');
  assert.equal(st(isro, { text: 'ऑर्बिटर ने 8 साल काम किया।' }).find((c) => c.kind === 'number').status, 'supported');
});

test('storyboard lexicon: short English words need a real inflection ("bathed" is not "bat"); video-jargon on-screen text is dropped', async () => {
  assert.deepEqual(analyze('A serene temple interior, bathed in light.').map((c) => c.id), ['temple']);
  assert.ok(analyze('He swings the bat and hits a six').some((c) => c.id === 'batting'));
  const config = V({ style: 'night-file', character: 'none', visualMode: 'hybrid-local' }).config, style = getCatalog().styles.find((s) => s.id === 'night-file');
  const sb = planStoryboard({ script: { title: 't', lines: [{ text: 'Listen to this.', visual: 'a frozen lake', onScreen: '94 words' }, { text: 'It is old.', visual: 'a frozen lake at night' }] }, timing: { duration: 6, lines: [{ start: 0.2, end: 2.8 }, { start: 3, end: 5.8 }] }, words: [], config, style, topic: 'Roopkund' });
  assert.ok(sb.shots.every((s) => !s.overlay || !/words/.test(JSON.stringify(s.overlay))));
});

test('image prompts: text/graphic-design requests and logos never reach the image model', async () => {
  const { concreteVisual } = await import('../dashboard/lib/storyboard.js');
  for (const v of ['₹450 crore displayed prominently on screen', 'split screen: ISRO mission vs. Gravity film poster', 'text overlay: 300 days journey']) assert.equal(concreteVisual(v, 'space', 'ISRO', '', 'space'), 'a spacecraft orbiting the red planet Mars');
  assert.equal(concreteVisual('final shot of Mars with the ISRO logo', 'space', 'ISRO', '', 'space'), 'final shot of Mars');
});

test('fact check: a hedged verified number with the wrong unit still fails ("लगभग 74 करोड़ डॉलर" for 74 million dollars)', async () => {
  const { reviewClaims, findTopicFacts } = await import('../dashboard/lib/factcheck.js');
  const isro = findTopicFacts('How ISRO reached Mars for less'), bells = findTopicFacts('Why Do Indian Temples Have Bells?');
  const nums = (tf, text) => reviewClaims({ lines: [{ text }] }, { topic: 't', topicFacts: tf }).claims.filter((c) => c.kind === 'number').map((c) => c.status);
  assert.deepEqual(nums(isro, 'यह मिशन ₹450 करोड़ का था, लगभग 74 करोड़ डॉलर।'), ['supported', 'unverified']);
  assert.deepEqual(nums(isro, 'ग्रेविटी का बजट लगभग 10 करोड़ डॉलर था।'), ['supported']);
  assert.deepEqual(nums(bells, 'कुछ मानते हैं ध्वनि सात सेकंड रहती है।'), ['supported']);
});

test('hindi: half-Latin words the model writes are repaired ("मंगalyaan" → मंगलयान, "पंचदhatu" → पंचधातु)', async () => {
  const { devanagarizeLatin } = await import('../dashboard/lib/scriptgen.js');
  assert.equal(devanagarizeLatin('इसरो ने मंगalyaan मिशन शुरू किया।'), 'इसरो ने मंगलयान मिशन शुरू किया।');
  assert.equal(devanagarizeLatin('कुछ पंचदhatu से बनाई जाती हैं।'), 'कुछ पंचधातु से बनाई जाती हैं।');
});

test('fact check: a verified number attached to the wrong subject fails ("Gravity\'s budget was ₹450 crore")', async () => {
  const { reviewClaims, findTopicFacts } = await import('../dashboard/lib/factcheck.js');
  const isro = findTopicFacts('How ISRO reached Mars for less');
  const st = (text) => reviewClaims({ lines: [{ text }] }, { topic: 't', topicFacts: isro }).claims.filter((c) => c.kind === 'number').map((c) => c.status);
  assert.deepEqual(st('हॉलीवुड फिल्म ग्रेविटी का बजट ₹450 करोड़ डॉलर था।'), ['unverified']);
  assert.deepEqual(st('ग्रेविटी का बजट लगभग 10 करोड़ डॉलर था।'), ['supported']);
  assert.deepEqual(st('₹450 करोड़ में, इसरो ने कमाल दिखाया!'), ['supported']);
});
