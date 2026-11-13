// Script-only evaluation: real local Gemma generations across categories × languages.
// STOPS at script generation — no TTS, Whisper, images, scene, capture or FFmpeg.
import fs from 'node:fs';
import { validateGenerationConfig } from '../dashboard/lib/validate.js';
import { generateScript, storyProblems, qualityProblems, estimateSeconds } from '../dashboard/lib/scriptgen.js';
import { stopServer } from '../dashboard/lib/llm.js';

const CASES = [
  ['science-space', 'Why does the Moon always show the same face to Earth?'],
  ['history', 'How the Grand Trunk Road connected India for centuries'],
  ['tech-ai', 'How does UPI send money in two seconds?'],
  ['mystery', 'The mystery of the Bermuda Triangle — what really happens there?'],
  ['education', 'Why does ice float on water?'],
  ['nature', 'How do the Sundarbans mangroves protect Kolkata from cyclones?'],
  ['interesting-facts', 'Why do octopuses have three hearts?'],
  ['current-affairs', 'Why are heatwaves in India getting longer?'],
];
const LANGS = [
  { language: 'hi-conversational', voice: 'hf_alpha', personalities: ['educational', 'desi-storyteller', 'suspense'] },
  { language: 'hinglish', voice: 'hm_omega', personalities: ['energetic-youtuber', 'mumbai-conversational', 'documentary'] },
  { language: 'en', voice: 'af_heart', personalities: ['documentary', 'educational', 'suspense'] },
];
const DUR = [30, 45, 60];
// retest set (SET=retest): previously failing cases + factual-quality topics, each language at a different duration
const RETEST = [
  ['science-space', 'Why does the Moon always show the same face to Earth?', [['hi-conversational', 45], ['en', 30], ['hinglish', 60]]],
  ['history', 'How the Grand Trunk Road connected India for centuries', [['hi-conversational', 60], ['en', 45], ['hinglish', 30]]],
  ['science-2', 'How do vaccines train the immune system?', [['hi-conversational', 30], ['en', 60], ['hinglish', 45]]],
  ['history-2', 'Why did the cities of the Indus Valley Civilisation decline?', [['hi-conversational', 45], ['en', 30], ['hinglish', 60]]],
  ['nature', 'How do the Sundarbans mangroves protect Kolkata from cyclones?', [['en', 45], ['hinglish', 60]]],
  ['tech-ai', 'How does UPI send money in two seconds?', [['hinglish', 60]]],
  ['mystery', 'The mystery of the Bermuda Triangle — what really happens there?', [['hinglish', 45]]],
  ['education', 'Why does ice float on water?', [['hinglish', 60]]],
  ['interesting-facts', 'Why do octopuses have three hearts?', [['hinglish', 30]]],
  ['current-affairs', 'Why are heatwaves in India getting longer?', [['hinglish', 60]]],
];
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outJson = `logs/tests/script-eval-${stamp}.json`, outMd = `logs/tests/script-eval-${stamp}.md`;
const results = [];
let k = 0;
const JOBS = process.env.SET === 'retest'
  ? RETEST.flatMap(([cat, topic, ls]) => ls.map(([lang, d], j) => { const L = LANGS.find((x) => x.language === lang); return { cat, topic, L, personality: L.personalities[(k++ + j) % 3], durationSeconds: d }; }))
  : CASES.flatMap(([cat, topic]) => LANGS.map((L) => { const o = { cat, topic, L, personality: L.personalities[k % 3], durationSeconds: DUR[(k + LANGS.indexOf(L)) % 3] }; k++; return o; }));
for (const { cat, topic, L, personality, durationSeconds } of JOBS) {
  const id = `${cat}/${L.language}`; if (only && !only.test(id)) continue;
  const v = validateGenerationConfig({ topic, language: L.language, personality, voice: L.voice, style: 'tall-tale', character: 'curious_student', durationSeconds, visualMode: 'hybrid-local' }, { purpose: 'script' });
  if (v.errors?.length) { results.push({ id, error: JSON.stringify(v.errors) }); continue; }
  const t0 = Date.now(); process.stdout.write(`${id} (${personality}, ${durationSeconds}s) … `);
  try {
    const r = await generateScript(v.config, { onProgress: () => {} });
    const est = estimateSeconds(r.script, v.config);
    const rec = { id, topic, language: L.language, personality, durationSeconds, secs: Math.round((Date.now() - t0) / 1000),
      estimatedSeconds: est.seconds, plan: r.meta.plan || null, lines: r.script.lines.map((l) => ({ text: l.text, visual: l.visual, onScreen: l.onScreen })),
      englishDraft: r.meta.englishDraft?.lines || null, story: storyProblems(r.script), quality: qualityProblems(r.script, v.config),
      review: r.meta.llmReview, claims: (r.meta.claimReview?.claims || []).filter((c) => c.status !== 'verified').map((c) => ({ line: c.line, status: c.status, text: c.text })),
      visualsFromFinal: !!r.meta.visuals, gates: r.meta.gates, research: r.meta.research, lengthFit: r.meta.lengthFit || null, languageOk: r.meta.gates?.language?.ok };
    results.push(rec); console.log(`${rec.secs}s, ~${est.seconds}s speech, gates ${Object.entries(rec.gates || {}).map(([k, v]) => (v.ok ? '+' : '-') + k).join(' ')}`);
  } catch (e) { results.push({ id, error: String(e.message) }); console.log('ERROR', e.message); }
  fs.writeFileSync(outJson, JSON.stringify(results, null, 2));
  fs.writeFileSync(outMd, results.map((r) => r.error ? `## ${r.id}\nERROR ${r.error}\n` :
    `## ${r.id} — ${r.personality}, target ${r.durationSeconds}s, est ${r.estimatedSeconds}s\nTopic: ${r.topic}\nPlan: ${r.plan?.centralStory || '(none)'}\n\n${r.lines.map((l, i) => `${i + 1}. ${l.text}\n   _visual:_ ${l.visual}`).join('\n')}\n\nStory issues: ${r.story.join(' | ') || 'none'}\nQuality issues: ${r.quality.join(' | ') || 'none'}\nEssentials: ${(r.research?.essentials || []).join('; ') || '-'}
Rejected by claim check: ${(r.research?.rejected || []).map((x) => x.text + ' [' + x.verdict + ']').join(' | ') || '-'}
Gates: ${Object.entries(r.gates || {}).map(([k, v]) => `${k}=${v.ok ? 'ok' : 'FAIL(' + v.issues.join('; ').slice(0, 200) + ')'}`).join(', ')}
Length fit: ${r.lengthFit ? r.lengthFit.from + 's → ' + r.lengthFit.to + 's' : '-'}\nClaims not verified: ${r.claims.map((c) => `L${c.line} ${c.status}`).join(', ') || 'none'}\n`).join('\n'));
}
stopServer();
console.log('wrote', outJson, outMd);
