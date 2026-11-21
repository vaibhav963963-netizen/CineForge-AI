// Step 7: image QA on ACTUAL images. Technical checks run on real pixels (FFmpeg). The semantic part is tested with
// a scripted vision model (describeImage receives the real image bytes; only the model's answer is scripted) —
// a real local vision model is not installed yet (its projector needs approval to download).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { measureImage, technicalFindings, setFindings, hamming, describeImage, semanticFindings, inspectProject, correctImages } from '../dashboard/lib/imageqa.js';
import { PATHS } from '../dashboard/lib/workspace.js';
import { findTopicFacts } from '../dashboard/lib/factcheck.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imageqa-'));
const ff = (...a) => { const r = spawnSync(PATHS.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...a], { windowsHide: true }); assert.equal(r.status, 0, String(r.stderr)); };
const P = (n) => path.join(dir, n);
// a detailed, colourful 9:16 test picture (fractal) — a "good" technical image
ff('-f', 'lavfi', '-i', 'mandelbrot=s=768x1368:end_pts=1', '-frames:v', '1', P('good.png'));
ff('-f', 'lavfi', '-i', 'testsrc2=s=768x1368', '-frames:v', '1', P('good2.png'));
ff('-f', 'lavfi', '-i', 'color=c=0x0a0a0a:s=768x1368', '-frames:v', '1', P('black.png'));
ff('-f', 'lavfi', '-i', 'color=c=0x7a8a9a:s=768x1368', '-frames:v', '1', P('blank.png'));
ff('-i', P('good.png'), '-vf', 'scale=1368:768', P('landscape.png'));
ff('-i', P('good.png'), '-vf', 'scale=768:900,pad=768:1368:0:234:black', P('letterbox.png'));
ff('-i', P('good.png'), '-vf', 'eq=brightness=0.03', P('near-dup.png'));
fs.writeFileSync(P('truncated.png'), fs.readFileSync(P('good.png')).subarray(0, 2000));
fs.writeFileSync(P('not-image.png'), 'not an image');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const tech = (f) => technicalFindings(measureImage(P(f)));

// ── technical (pixel-level, deterministic) ─────────────────────────────────────────────────────────────────────
test('technical: a detailed 9:16 image passes', () => { assert.deepEqual(tech('good.png'), []); assert.deepEqual(tech('good2.png'), []); });
test('technical: missing, corrupted and non-image files are errors', () => {
  assert.match(tech('nope.png')[0].problem, /missing/); assert.match(tech('truncated.png')[0].problem, /cannot be decoded/); assert.match(tech('not-image.png')[0].problem, /cannot be decoded/);
});
test('technical: black and blank images are errors', () => {
  assert.ok(tech('black.png').some((x) => x.severity === 'error' && /near-black/.test(x.problem)));
  assert.ok(tech('blank.png').some((x) => x.severity === 'error' && /blank|flat/.test(x.problem)), JSON.stringify(tech('blank.png')));
});
test('technical: wrong aspect ratio is an error; a black letterbox band is flagged for review', () => {
  assert.ok(tech('landscape.png').some((x) => x.severity === 'error' && /aspect ratio/.test(x.problem)));
  assert.ok(tech('letterbox.png').some((x) => /black border/.test(x.problem)), JSON.stringify(measureImage(P('letterbox.png'))));
});
test('technical: near-duplicate images are found by perceptual hash; different images are not', () => {
  const a = measureImage(P('good.png')), b = measureImage(P('near-dup.png')), c = measureImage(P('good2.png'));
  assert.ok(hamming(a.dhash, b.dhash) <= 5, `${hamming(a.dhash, b.dhash)}`); assert.ok(hamming(a.dhash, c.dhash) > 12);
  const f = setFindings([{ ...a, sceneId: 'S01' }, { ...b, sceneId: 'S02' }, { ...c, sceneId: 'S03' }]);
  assert.ok(f[1].some((x) => /duplicate of S01/.test(x.problem))); assert.equal(f[2].filter((x) => /duplicate/.test(x.problem)).length, 0);
});
test('technical: real generated images from this workspace pass (when present)', (t) => {
  const d = 'projects/why-does-the-moon-always-show-276a3f/generated-images';
  if (!fs.existsSync(d)) return t.skip('rendered Moon project not present');
  for (const f of fs.readdirSync(d).filter((x) => /\.png$/.test(x))) assert.deepEqual(technicalFindings(measureImage(path.join(d, f))).filter((x) => x.severity !== 'warning'), [], f);
});

// ── semantic (pixel description from a vision model; the model's answer is scripted here) ────────────────────────
const HG = { topic: 'Why do octopuses have three hearts?', language: { id: 'hinglish', code: 'hi', script: 'Latn', name: 'Hinglish' } };
const sv = (beats) => ({ script: { lines: beats.map(() => ({ text: 'x', say: 'x' })) }, meta: { plan: { beats } } });
const vision = (answer) => async ({ messages, schema }) => {
  // the real image bytes are sent, and the model is NOT told the narration
  const img = messages[1].content.find((c) => c.type === 'image_url'); assert.match(img.image_url.url, /^data:image\/png;base64,iVBOR/);
  assert.ok(!JSON.stringify(messages).includes('three hearts')); assert.ok(schema.properties.objects);
  return { text: JSON.stringify({ mainSubject: '', description: '', objects: [], people: 0, era: 'none/unclear', visibleText: '', watermark: false, distorted: false, style: 'photo', ...answer }) };
};
const semFor = async (answer, beats = ['An octopus has three hearts.'], cfg = HG, kind = null) => semanticFindings(cfg, sv(beats), 0, await describeImage(P('good.png'), { visionChat: vision(answer) }), { topicFacts: findTopicFacts(cfg.topic), storyKind: kind });
test('semantic: a correct image (octopus with three hearts) passes', async () => assert.deepEqual(await semFor({ mainSubject: 'octopus', description: 'a diagram of an octopus with its three hearts', objects: [{ name: 'hearts', count: 3 }] }), []));
test('semantic: wrong number of hearts → error', async () => assert.ok((await semFor({ mainSubject: 'octopus', description: 'an octopus with two hearts', objects: [{ name: 'hearts', count: 2 }] })).some((x) => x.severity === 'error' && /count mismatch/.test(x.problem))));
test('semantic: human heart for the octopus → error', async () => assert.ok((await semFor({ mainSubject: 'human heart', description: 'a human heart inside a human chest' })).some((x) => x.severity === 'error' && /human anatomy/.test(x.problem))));
test('semantic: red octopus blood (a known error) → error', async () => assert.ok((await semFor({ mainSubject: 'octopus', description: 'an octopus with red blood flowing from its gills' }, ['The branchial hearts pump blood through the gills.'])).some((x) => x.severity === 'error' && /known error/.test(x.problem))));
test('semantic: an unrelated image (a stone building for "the far side gets sunlight") → review', async () => {
  const cfg = { topic: 'Why does the Moon always show the same face to Earth?', language: { id: 'en', code: 'en', script: 'Latn', name: 'English' } };
  assert.ok((await semFor({ mainSubject: 'stone building', description: 'a weathered stone building with a circular window' }, ["The far side isn't dark; it gets as much sunlight as the near side."], cfg)).some((x) => x.category === 'semantic'));
});
test('semantic: modern objects in a historical scene → error', async () => {
  const cfg = { topic: 'How the Grand Trunk Road connected India for centuries', language: { id: 'hi-conversational', code: 'hi', script: 'Deva', name: 'Hindi' } };
  assert.ok((await semFor({ mainSubject: 'road', description: 'a busy asphalt highway with trucks and a caravan', era: 'modern' }, ['In the 16th century Sher Shah Suri rebuilt the road.'], cfg, 'history')).some((x) => x.severity === 'error' && /period mismatch/.test(x.problem)));
});
test('semantic: misleading text / watermark and distortion are flagged for review', async () => {
  const f = await semFor({ mainSubject: 'octopus', description: 'an octopus with three hearts', objects: [{ name: 'hearts', count: 3 }], visibleText: 'SHUTTERSTOCK', watermark: true, distorted: true });
  assert.ok(f.some((x) => /text or watermark/.test(x.problem))); assert.ok(f.some((x) => /distorted/.test(x.problem)));
});
test('semantic: no vision model, or a failed inspection → NEEDS_REVIEW, never approved', async () => {
  const none = semanticFindings(HG, sv(['x']), 0, await describeImage(P('good.png'), {}), {});
  assert.equal(none[0].severity, 'review'); assert.match(none[0].problem, /not inspected/);
  const err = semanticFindings(HG, sv(['x']), 0, await describeImage(P('good.png'), { visionChat: async () => { throw new Error('fetch failed'); } }), {});
  assert.equal(err[0].severity, 'review');
});

// ── gates: a critical finding cannot be averaged away ───────────────────────────────────────────────────────────
test('gates: five good images + one critical error → the project is REJECTED; the report is per image', async () => {
  const good = { mainSubject: 'octopus', description: 'an octopus with its three hearts', objects: [{ name: 'hearts', count: 3 }] };
  const shots = ['good.png', 'good2.png', 'good.png', 'good2.png', 'good.png', 'good2.png'].map((f, i) => ({ sceneId: `S0${i + 1}`, file: P(f), line: i, visual: 'v' }));
  let k = 0;
  const visionChat = async (o) => { k++; return vision(k === 4 ? { mainSubject: 'human heart', description: 'a human heart in a human chest' } : good)(o); };
  const r = await inspectProject(HG, { projectId: 'p', shots, sceneValue: sv(shots.map(() => 'An octopus has three hearts.')), topicFacts: findTopicFacts(HG.topic), visionChat });
  assert.equal(r.decision, 'REJECTED'); assert.equal(r.images[3].decision, 'REJECTED'); assert.equal(r.gates.accuracy.ok, false);
  for (const im of r.images) for (const key of ['projectId', 'sceneId', 'image', 'narration', 'visual', 'alignmentScore', 'findings', 'decision']) assert.ok(key in im, key);
});
test('gates: without a vision model every image is NEEDS_REVIEW (technical checks still run)', async () => {
  const r = await inspectProject(HG, { projectId: 'p', shots: [{ sceneId: 'S01', file: P('good.png'), line: 0 }, { sceneId: 'S02', file: P('black.png'), line: 0 }], sceneValue: sv(['An octopus has three hearts.']) });
  assert.equal(r.images[0].decision, 'NEEDS_REVIEW'); assert.equal(r.images[1].decision, 'REJECTED'); assert.equal(r.decision, 'REJECTED');
});

// ── correction workflow ─────────────────────────────────────────────────────────────────────────────────────────
const rep = { images: [{ sceneId: 'S01', image: P('good.png'), decision: 'APPROVED', findings: [] }, { sceneId: 'S02', image: P('black.png'), decision: 'REJECTED', findings: [{ problem: 'near-black', severity: 'error' }] }] };
test('correction: only failed images are regenerated; a passing version is kept, the original is never overwritten', async () => {
  const calls = []; const log = await correctImages(rep, { regenerate: async (im, a) => { calls.push(im.sceneId); return P('good2.png'); }, inspect: async () => ({ decision: 'APPROVED', findings: [] }) });
  assert.deepEqual(calls, ['S02']); assert.equal(log[0].kept, P('good2.png')); assert.equal(log[0].decision, 'APPROVED (corrected)');
  assert.ok(fs.existsSync(P('black.png')));
});
test('correction: attempts are limited; every rejected version is recorded; the original stays and NEEDS_REVIEW', async () => {
  let n = 0; const log = await correctImages(rep, { maxAttempts: 2, regenerate: async () => { n++; return P(`v${n}.png`); }, inspect: async () => ({ decision: 'REJECTED', findings: [{ problem: 'still wrong', severity: 'error' }] }) });
  assert.equal(n, 2); assert.equal(log[0].kept, P('black.png')); assert.match(log[0].decision, /NEEDS_REVIEW \(original kept\)/);
  assert.deepEqual(log[0].versions.slice(1).map((v) => v.reasons[0]), ['still wrong', 'still wrong']);
});
test('real (workspace scan): a bright, colourful pastel illustration is not "blown out"; a washed-out grey one is', () => {
  assert.deepEqual(technicalFindings({ exists: true, width: 768, height: 1368, avg: 198, low: 136, high: 226, entropy: 0.42, saturation: 32 }), []);
  assert.ok(technicalFindings({ exists: true, width: 768, height: 1368, avg: 220, low: 150, high: 240, entropy: 0.6, saturation: 4 }).some((x) => /blown out/.test(x.problem)));
});
