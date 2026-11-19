// Script intelligence: research brief + NEEDS_RESEARCH, cross-topic name leaks, story shapes, visual period/repetition,
// claim ledger fields, and validation of edited versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { crossTopicNames, storyType, STORY_SHAPES, readiness, researchBrief, visualPeriodAndRepetition, claimLedger, qualityGates } from '../dashboard/lib/scriptgen.js';
import { findTopicFacts, reviewClaims } from '../dashboard/lib/factcheck.js';

const HI = { topic: 'How do vaccines train the immune system?', durationSeconds: 30, language: { id: 'hi-conversational', code: 'hi', script: 'Deva', captionScript: 'Deva', name: 'Hindi' }, narration: { voice: 'no_such_voice_for_tests', speed: 1, delivery: { lead: 0.3, outro: 1, gap: 0.3 } } };

test('cross-topic names: a name from another topic\'s fact file is caught (seen: Sher Shah Suri in a vaccines script)', () => {
  assert.deepEqual(crossTopicNames('शेर शाह सूरी ने 1796 में गाय के खसरा से सुरक्षा का तरीका दिखाया।', HI.topic, '').map((x) => x.name).sort(), ['Sher Shah', 'Sher Shah Suri']);
  assert.deepEqual(crossTopicNames('Rudyard Kipling explained tidal locking.', 'Why does the Moon always show the same face to Earth?', '').map((x) => x.name), ['Kipling']);
  // the same name in its own topic, and clean scripts, are not flagged
  assert.deepEqual(crossTopicNames('शेर शाह सूरी ने उत्तरापथ को फिर से बनवाया।', 'How the Grand Trunk Road connected India for centuries', ''), []);
  assert.deepEqual(crossTopicNames('1796 में एडवर्ड जेनर ने चेचक से बचाव का तरीका खोजा।', HI.topic, ''), []);
});

test('the facts gate fails on a cross-topic name, whatever else passes', () => {
  const tf = findTopicFacts(HI.topic);
  const script = { lines: [{ text: 'शेर शाह सूरी ने 1796 में चेचक का टीका बनाया।', visual: 'x' }, { text: 'टीका शरीर को एंटीबॉडी बनाना सिखाता है।', visual: 'y' }] };
  const g = qualityGates(HI, { script, meta: { factFile: tf.file, claimReview: reviewClaims(script, { topic: HI.topic, topicFacts: tf }), research: { essentials: [], evidence: [] } } });
  assert.equal(g.facts.ok, false); assert.ok(g.facts.issues.some((x) => /belongs to another topic/.test(x)));
});

test('research: no verified source → RESEARCH gate fails and the status is NEEDS_RESEARCH (never READY, even if fluent)', () => {
  const ok = { ok: true, issues: [] };
  assert.equal(readiness({ research: { ok: false, issues: ['x'] }, language: ok, facts: ok, editorial: ok }), 'NEEDS_RESEARCH');
  assert.equal(readiness({ research: ok, language: { ok: false, issues: ['y'] } }), 'FAILED');
  assert.equal(readiness({ research: ok, language: ok, facts: ok }), 'READY');
  const g = qualityGates({ ...HI, topic: 'Why are heatwaves in India getting longer?' }, { script: { lines: [{ text: 'गर्मी बढ़ रही है।', visual: 'x' }] }, meta: { claimReview: { claims: [] } } });
  assert.equal(g.research.ok, false); assert.equal(g.research.brief.status, 'NEEDS_RESEARCH');
});

test('research brief: verified facts, names and dates, terminology, misconceptions, sources, model-only claims', () => {
  const tf = findTopicFacts('Why do octopuses have three hearts?');
  const b = researchBrief(tf, { essentials: ['Hemocyanin'], evidence: [{ text: 'Octopuses have blue blood.', source: 'model' }] });
  assert.equal(b.status, 'PARTIAL'); assert.ok(b.coreFacts.length >= 5); assert.ok(b.terminology.includes('hemocyanin'));
  assert.ok(b.misconceptions.some((m) => /two hearts/.test(m.wrong))); assert.ok(b.sources.length); assert.deepEqual(b.modelOnlyClaims, ['Octopuses have blue blood.']);
  assert.equal(researchBrief(null).status, 'NEEDS_RESEARCH');
  const gt = researchBrief(findTopicFacts('Grand Trunk Road history'));
  assert.ok(gt.namesAndDates.names.some((n) => /Sher Shah/.test(n))); assert.ok(gt.namesAndDates.dates.includes('1540'));
});

test('story architecture adapts to the topic (history ≠ science ≠ mystery) and reaches the planner prompt', () => {
  assert.equal(storyType('How the Grand Trunk Road connected India for centuries'), 'history');
  assert.equal(storyType('Why does ice float on water?'), 'science');
  assert.equal(storyType('The mystery of the Bermuda Triangle'), 'mystery');
  assert.equal(storyType('How to start a small business'), 'explainer');
  assert.match(STORY_SHAPES.history, /chronological/); assert.match(STORY_SHAPES.mystery, /proven from what is theory/);
  const src = fs.readFileSync(new URL('../dashboard/lib/scriptgen.js', import.meta.url), 'utf8');
  assert.ok(/STORY SHAPE — \$\{STORY_SHAPES\[storyType\(config\.topic, topicFacts\)\]\}/.test(src));
});

test('visuals: a modern object in a historical line and repeated visuals are flagged; a period-correct sequence passes', () => {
  const bad = { lines: [{ visual: 'Wide shot of Sher Shah Suri on horseback beside a busy asphalt highway with trucks.' }, { visual: 'Close-up of a stone sarai courtyard with travellers resting at dusk.' }, { visual: 'Close-up of a stone sarai courtyard with travellers resting at dusk, lanterns.' }] };
  const p = visualPeriodAndRepetition(bad, ['In the 16th century Sher Shah Suri rebuilt the road.', 'Sarais gave travellers rest.', 'Each sarai also kept horses for the post.']);
  assert.ok(p.some((x) => /^line 1: period mismatch/.test(x))); assert.ok(p.some((x) => /lines 2 and 3: nearly the same visual/.test(x)));
  const good = { lines: [{ visual: 'Wide shot of a Mughal-era caravan on a dusty road at sunset.' }, { visual: 'Close-up of a carved kos minar pillar by the roadside.' }] };
  assert.deepEqual(visualPeriodAndRepetition(good, ['The Mughals kept the road in use.', 'Kos minars marked the distance.']), []);
  // "today" lines may show modern traffic
  assert.deepEqual(visualPeriodAndRepetition({ lines: [{ visual: 'Aerial view of trucks on the highway.' }] }, ['Today parts of the 16th-century route are national highways.']), []);
});

test('claim ledger: sentence reference, risk and confidence for every claim', () => {
  const tf = findTopicFacts('ISRO Mars Orbiter Mission');
  const s = { lines: [{ text: 'Mangalyaan entered Mars orbit on 24 September 2014.' }, { text: 'It cost 900 crore.' }] };
  const L = claimLedger({ script: s, meta: { factFile: tf.file, claimReview: reviewClaims(s, { topic: 'ISRO', topicFacts: tf }) } }, tf);
  for (const c of L) { assert.match(c.sentenceId, /^L\d+$/); assert.ok(['low', 'medium', 'high'].includes(c.risk)); assert.ok(c.confidence >= 0 && c.confidence <= 1); }
  assert.ok(L.some((c) => c.claim.includes('900') && c.risk === 'high' && c.confidence <= 0.3));
});

test('edited versions are validated as themselves (deterministic gates, labelled; no READY carried over)', () => {
  const src = fs.readFileSync(new URL('../dashboard/server.js', import.meta.url), 'utf8');
  assert.ok(/const gates = qualityGates\(pr\.config, base, \[\]\);/.test(src));
  assert.ok(/validatedBy: 'deterministic checks \(edited version; no model review\)'/.test(src));
});

test('benchmark false positives fixed: short-name fuzz, short term outlines, plain Hindi is review not FAILED', async () => {
  const { termProblems } = await import('../dashboard/lib/scriptgen.js');
  // "आराम" (aram) must not match "Harappa" (arap); the real Sher Shah leak is still caught
  assert.deepEqual(crossTopicNames('उन्होंने रास्ते पर सराय बनाईं, यात्रियों के लिए आराम करने की जगह।', 'How the Grand Trunk Road connected India for centuries', ''), []);
  assert.ok(crossTopicNames('शेर शाह सूरी ने 1796 में टीका बनाया।', HI.topic, '').length > 0);
  // "रखते" is a verb, not a misspelled "रॉकेट"
  assert.deepEqual(termProblems({ language: { code: 'hi' } }, { lines: [{ text: 'बूस्टर खुराक समुदाय को सुरक्षित रखते हैं।' }] }, {}), []);
  // plain Hindi in Hinglish mode: editorial issue (NEEDS_REVIEW), never FAILED
  const hg = { ...HI, topic: 'Why do octopuses have three hearts?', language: { id: 'hinglish', code: 'hi', script: 'Latn', captionScript: 'Latn', name: 'Hinglish' } };
  const lines = ['Octopus ke teen hriday hote hain, yeh sach hai.', 'Do galphade pani se pran vayu lete hain aur yeh kaam ka hai.', 'Ek poore sharir ko rakt deta hai.'].map((t) => ({ text: t, say: 'उसके तीन हृदय होते हैं।', english: [], visual: 'x' }));
  const g = qualityGates(hg, { script: { lines }, meta: { factFile: 'facts/octopus-three-hearts.json', claimReview: { claims: [] }, research: { essentials: [], evidence: [] } } });
  assert.equal(g.language.ok, true); assert.ok(g.editorial.issues.some((x) => /plain Hindi/.test(x)));
  assert.notEqual(readiness(g), 'FAILED');
});

test('vaccines: "Jenner protected against measles (खसरा)" is a known error (seen in the benchmark)', () => {
  const tf = findTopicFacts('How do vaccines train the immune system?');
  const bad = reviewClaims({ lines: [{ text: '1796 में, जेनर ने गायधर्मा से मटेरियल का इस्तेमाल करके खसरा बचाया।' }] }, { topic: 'vaccines', topicFacts: tf }).claims.filter((c) => c.status === 'contradicted');
  assert.equal(bad.length, 1); assert.match(bad[0].note, /चेचक/);
  assert.equal(tf.terms.hi.smallpox, 'चेचक');
});
