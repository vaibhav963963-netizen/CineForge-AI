// Step 6: visual-semantic intelligence. Scenes marked "real" come from saved benchmark outputs
// (logs/tests/script-eval-2026-11-13T1[4-6]*.json): the visual, its line and its story-plan beat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { visualReport, correctVisuals, sceneReference } from '../dashboard/lib/visualsem.js';
import { findTopicFacts } from '../dashboard/lib/factcheck.js';
import { qualityGates, readiness } from '../dashboard/lib/scriptgen.js';

const EN = { topic: 't', durationSeconds: 30, language: { id: 'en', code: 'en', script: 'Latn', captionScript: 'Latn', name: 'English' }, narration: { voice: 'no_such_voice_for_tests', speed: 1, delivery: { lead: 0.3, outro: 1, gap: 0.3 } } };
const HI = { ...EN, language: { id: 'hi-conversational', code: 'hi', script: 'Deva', captionScript: 'Deva', name: 'Hindi' } };
const HG = { ...EN, language: { id: 'hinglish', code: 'hi', script: 'Latn', captionScript: 'Latn', name: 'Hinglish' } };
// scenes: [narration line, visual, plan beat (English)]
const report = (cfg, topic, scenes, kind = null) => { const tf = findTopicFacts(topic); return visualReport({ ...cfg, topic }, { script: { lines: scenes.map(([text, visual]) => ({ text, visual })) }, meta: { plan: { beats: scenes.map((s) => s[2] || '') } } }, { topicFacts: tf, storyKind: kind }); };
const finds = (r, sceneNo, cat, re) => assert.ok(r.scenes[sceneNo - 1].findings.some((f) => f.category === cat && re.test(f.problem)), JSON.stringify(r.scenes[sceneNo - 1].findings));
const cleanScene = (r, n) => assert.deepEqual(r.scenes[n - 1].findings.filter((f) => f.severity !== 'warning'), [], JSON.stringify(r.scenes[n - 1]));

const OCT = 'Why do octopuses have three hearts?', MOON = 'Why does the Moon always show the same face to Earth?', VAX = 'How do vaccines train the immune system?', INDUS = 'Why did the cities of the Indus Valley Civilisation decline?', GT = 'How the Grand Trunk Road connected India for centuries', BER = 'The mystery of the Bermuda Triangle — what really happens there?';

// ── real mismatches ────────────────────────────────────────────────────────────────────────────────────────────
test('real (Hinglish octopus): red blood pictured — a known error of the topic → error, never READY', () => {
  const r = report(HG, OCT, [['x', 'Wide shot of an octopus swimming through the ocean, with two distinct, darker colored hearts visible beneath its mantle, and a faint trail of red blood flowing from its gills.', 'The two branchial hearts pump blood through the gills.']]);
  finds(r, 1, 'facts', /known error.*red/); assert.equal(r.scenes[0].decision, 'misleading — not ready'); assert.equal(r.ok, false);
});
test('real (English Moon): "the far side gets sunlight" shown as a stone building → alignment review', () => {
  const r = report(EN, MOON, [["The far side isn't dark; it gets as much sunlight as the near side.", 'Medium shot of a weathered, stone building with a large, circular window looking out at the night sky.']]);
  finds(r, 1, 'alignment', /does not show what the line is about/);
});
test('real (Hindi vaccines): an invented historical figure and place in the visual → facts review', () => {
  const r = report(HI, VAX, [['1796 में जेनर ने काउपॉक्स से चेचक का पहला टीका बनाया।', 'Close-up shot of a young woman, Lady Mary Wortley Montagu, meticulously examining a cowpox blister in London.', 'In 1796 Edward Jenner used cowpox to protect against smallpox.']]);
  finds(r, 1, 'facts', /Montagu/); finds(r, 1, 'facts', /London/);
});
test('real (Hindi vaccines): antibodies line shown as a pustule on an arm; people the line is not about', () => {
  const r = report(HI, VAX, [['x', 'Medium shot of a human arm with a small, raised red bump (a pustule).', 'The immune system reacts by making antibodies against the proteins.'], ['x', 'Wide shot of a skilled artisan, a man in a leather apron, carefully crafting a sword.', 'A vaccine shows the body a harmless version of a germ.']]);
  finds(r, 1, 'alignment', /antibodies/); finds(r, 2, 'alignment', /shows people/);
});
test('real (English Indus): a date the narration does not give ("circa 2500 BC") → facts review', () => {
  const r = report(EN, INDUS, [['The Indus Valley civilisation thrived from 2600 to 1900 BCE in Pakistan and north-west India.', 'Wide shot of a vast, fertile floodplain in the Indus River valley, circa 2500 BC.']], 'history');
  finds(r, 1, 'facts', /adds numbers.*2500/);
});
test('history: modern objects and the wrong era in a historical scene → error', () => {
  const r = report(HI, GT, [['x', 'Wide shot of Sher Shah Suri on horseback beside a busy asphalt highway with trucks.', 'In the 16th century Sher Shah Suri rebuilt the road.'], ['x', 'Wide shot of a Victorian railway station with British officers.', 'Ancient Mauryan rulers used the route around 300 BCE.']], 'history');
  finds(r, 1, 'history', /period mismatch.*(asphalt|highway|trucks)/); finds(r, 2, 'history', /wrong era/);
});
test('history: a scene about TODAY may show modern traffic', () => {
  const r = report(HI, GT, [['x', 'Aerial view of trucks on the highway at dusk.', 'Today parts of the 16th-century route are national highways.']], 'history');
  cleanScene(r, 1);
});
test('science: wrong count of a body part, and human anatomy for a non-human subject → error', () => {
  const r = report(HG, OCT, [['x', 'Diagram of an octopus with two hearts glowing inside its mantle.', 'An octopus has three hearts.'], ['x', 'Close-up of a human heart beating inside a human chest.', 'The systemic heart pumps blood to the body.']]);
  finds(r, 1, 'science', /count mismatch.*3 hearts.*2/); finds(r, 2, 'science', /human anatomy/);
});
test('science: sensational medical imagery is flagged (advisory)', () => {
  const r = report(HI, VAX, [['x', 'Close-up of a terrifying needle piercing bloody skin.', 'A vaccine is injected into the arm.']]);
  assert.ok(r.scenes[0].findings.some((f) => f.category === 'science' && f.severity === 'warning' && /sensational/.test(f.problem)));
});
test('diversity: a repeated scene (review) and three identical compositions in a row (warning)', () => {
  const r = report(HI, GT, [['x', 'Close-up of a stone sarai courtyard with travellers resting at dusk.', 'Sarais gave travellers rest.'], ['x', 'Close-up of a stone sarai courtyard with travellers resting at dusk, lanterns.', 'Each sarai kept horses for the royal post.'], ['x', 'Close-up of a carved kos minar pillar by the roadside.', 'Kos minars marked every kos of the road.']], 'history');
  finds(r, 2, 'diversity', /nearly the same visual as scene S1/); finds(r, 3, 'diversity', /third "close-up" in a row/);
});
test('continuity: a character changes appearance between scenes → review', () => {
  const r = report(EN, 'A day in the life of a young sailor', [['A young sailor joins the ship.', 'Wide shot of a sailor in a red coat boarding a wooden ship.'], ['The sailor climbs the mast.', 'Low angle of the sailor in a blue coat climbing the mast.']]);
  finds(r, 2, 'continuity', /changes appearance/);
});
test('completeness: missing visual → error; no narration reference → review (uncertain, never READY)', () => {
  const r = visualReport({ ...HI, topic: OCT }, { script: { lines: [{ text: 'ऑक्टोपस के तीन दिल होते हैं।', visual: '' }, { text: 'यह सच है।', visual: 'Close-up of an octopus mantle.' }] }, meta: {} }, { topicFacts: null });
  finds(r, 1, 'completeness', /no visual/); finds(r, 2, 'completeness', /no narration reference/);
  assert.equal(r.scenes[1].decision, 'needs review');
});

// ── correct scenes that must pass (the old gate rejected these) ────────────────────────────────────────────────
test('real (Hindi GT road): "Uttarapath" shown as an ancient trade route passes — the fact file links the two', () => {
  const r = report(HI, GT, [['x', 'Close-up shot of a partially excavated section of ancient road, with worn stones and cart ruts.', 'The Uttarapath was an ancient trade route across north India.']], 'history');
  cleanScene(r, 1);
});
test('real (Hinglish Bermuda): planes, ships and the Atlantic pass (synonyms; name only in Devanagari elsewhere)', () => {
  const tf = findTopicFacts(BER);
  const r = visualReport({ ...HG, topic: BER }, { script: { lines: [{ text: 'x', say: 'बर्मूडा त्रिकोण अटलांटिक महासागर में है।', visual: 'Wide shot of the Bermuda Triangle area in the Atlantic Ocean.' }, { text: 'x', say: 'कई जहाज़ और विमान गायब हुए।', visual: 'Close-up shot of a distressed, partially submerged airplane fuselage near a ship\'s wheel.' }] }, meta: { plan: { beats: ['The Bermuda Triangle lies in the North Atlantic.', 'Over decades, ships and planes vanished there.'] } } }, { topicFacts: tf, storyKind: 'mystery' });
  cleanScene(r, 1); cleanScene(r, 2);
});
test('valid: correct science and history scenes in English, Hindi and Hinglish pass', () => {
  cleanScene(report(HG, OCT, [['x', 'Diagram of an octopus showing its three hearts: two branchial hearts beside the gills and one systemic heart.', 'An octopus has three hearts.']]), 1);
  cleanScene(report(EN, INDUS, [['Around 1900 BCE many cities were slowly emptied.', 'Wide shot of abandoned mud-brick houses in an ancient Indus city at dusk.']], 'history'), 1);
  cleanScene(report(HI, MOON, [['x', 'Diagram of the Moon orbiting Earth, the same side always facing it.', 'The Moon always shows the same face because of tidal locking.']]), 1);
  cleanScene(report(HI, GT, [['x', 'Wide shot of a Mughal-era caravan on a dusty road at sunset.', 'The Mughals kept the road in use in the 17th century.']], 'history'), 1);
});
test('scene references are traceable (source of the reference is reported)', () => {
  const ref = sceneReference({ script: { lines: [{ text: 'x', say: 'ऑक्टोपस में हीमोसायनिन होता है।', english: ['hemocyanin'] }] }, meta: { plan: { beats: ['Octopus blood uses hemocyanin.'] } } }, 0, findTopicFacts(OCT));
  assert.deepEqual(ref.sources, ['story plan', 'English words of the line', 'fact-file terms in the line']);
});

// ── correction: narration read-only, re-validated, uncertain → kept ─────────────────────────────────────────────
const doc = (lines, beats) => ({ script: { title: 't', lines }, meta: { plan: { beats } } });
test('correction: a misleading scene is replaced only by a visual that passes re-validation; narration untouched', async () => {
  const v = doc([{ text: 'x', say: 'ऑक्टोपस के तीन दिल होते हैं।', visual: 'Close-up of a human heart beating inside a human chest.' }], ['An octopus has three hearts.']);
  const r = await correctVisuals({ ...HG, topic: OCT }, v, { topicFacts: findTopicFacts(OCT), chatFn: async () => ({ text: JSON.stringify({ visual: 'Diagram of an octopus showing its three hearts beside the gills.' }) }) });
  assert.equal(r.value.script.lines[0].visual, 'Diagram of an octopus showing its three hearts beside the gills.'); assert.equal(r.log[0].accepted, true);
  assert.equal(r.value.script.lines[0].say, 'ऑक्टोपस के तीन दिल होते हैं।');
});
test('correction: a replacement that is still wrong, or creates a new problem, is rejected (scene kept, NEEDS_REVIEW)', async () => {
  const v = doc([{ text: 'x', say: 'ऑक्टोपस के तीन दिल होते हैं।', visual: 'Close-up of a human heart inside a human chest.' }], ['An octopus has three hearts.']);
  const r = await correctVisuals({ ...HG, topic: OCT }, v, { topicFacts: findTopicFacts(OCT), chatFn: async () => ({ text: JSON.stringify({ visual: 'Diagram of an octopus with two hearts.' }) }) });
  assert.equal(r.value.script.lines[0].visual, v.script.lines[0].visual); assert.equal(r.log[0].accepted, false); assert.match(r.log[0].reason, /still:.*count mismatch/);
  const r2 = await correctVisuals({ ...HG, topic: OCT }, v, { topicFacts: findTopicFacts(OCT), chatFn: async () => { throw new Error('fetch failed'); } });
  assert.equal(r2.value.script.lines[0].visual, v.script.lines[0].visual); assert.match(r2.log[0].reason, /no valid answer/);
});
test('correction: aligned scenes are never sent to the model; calls are capped', async () => {
  let calls = 0; const chatFn = async () => { calls++; return { text: '{"visual":"x"}' }; };
  await correctVisuals({ ...HG, topic: OCT }, doc([{ text: 'x', say: 'तीन दिल।', visual: 'Diagram of an octopus showing its three hearts.' }], ['An octopus has three hearts.']), { topicFacts: findTopicFacts(OCT), chatFn });
  assert.equal(calls, 0);
  const bad = Array.from({ length: 6 }, () => ({ text: 'x', say: 'दिल।', visual: 'Close-up of a human heart inside a human chest.' }));
  const r = await correctVisuals({ ...HG, topic: OCT }, doc(bad, bad.map(() => 'An octopus has three hearts.')), { topicFacts: findTopicFacts(OCT), chatFn, maxCalls: 4 });
  assert.equal(calls, 4); assert.ok(r.log.some((e) => /correction limit/.test(e.reason || '')));
});
test('gate: the visuals gate reports per-category issues; a misleading scene keeps the script out of READY', () => {
  const tfm = { claimReview: { claims: [] }, plan: { beats: ['An octopus has three hearts.'] } };
  const g = qualityGates({ ...HG, topic: OCT }, { script: { lines: [{ text: 'x', say: 'ऑक्टोपस के तीन दिल होते हैं।', visual: 'Close-up of a human heart inside a human chest.' }] }, meta: tfm });
  assert.equal(g.visuals.ok, false); assert.match(g.visuals.issues[0], /S1: human anatomy.*\[science\]/);
  assert.ok(g.visuals.categories.science && g.visuals.scenes[0].decision === 'misleading — not ready');
  assert.notEqual(readiness(g), 'READY');
});
