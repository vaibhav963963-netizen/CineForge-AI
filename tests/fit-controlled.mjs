// Controlled length-fitting check with the REAL local model (script-only: no TTS, Whisper, images, render).
// Inputs are SAVED benchmark scripts (text + spoken "say"); nothing is generated, no fact is changed.
//   natural-overlong : a script that the pipeline itself produced too long (saved before Step 2/3 fitting existed)
//   controlled       : the latest natural script, unchanged, with a LOWER target (clearly labelled) so it is overlong
// Usage: node tests/fit-controlled.mjs
import fs from 'node:fs';
import { validateGenerationConfig } from '../dashboard/lib/validate.js';
import { fitLength, estimateSeconds, qualityGates } from '../dashboard/lib/scriptgen.js';
import { stopServer, ensureServer } from '../dashboard/lib/llm.js';
await ensureServer();   // fitLength alone does not start the local model (generateScript does)
import { reviewClaims, findTopicFacts } from '../dashboard/lib/factcheck.js';

const load = (f, id) => JSON.parse(fs.readFileSync(`logs/tests/${f}.json`, 'utf8')).find((x) => x.id === id);
const CASES = [
  { kind: 'natural-overlong', src: ['script-eval-2026-11-13T15-03-00', 'biology/hinglish'], target: 30 },
  { kind: 'natural-overlong', src: ['script-eval-2026-11-13T15-03-00', 'mystery/hinglish'], target: 45 },
  { kind: 'controlled (natural script, target lowered 30 → 25 s)', src: ['script-eval-2026-11-13T15-19-50', 'biology/hinglish'], target: 25 },
  { kind: 'controlled (natural script, target lowered 45 → 38 s)', src: ['script-eval-2026-11-13T15-19-50', 'mystery/hinglish'], target: 38 },
];
const out = [];
for (const c of CASES) {
  const rec = load(...c.src);
  const v = validateGenerationConfig({ topic: rec.topic, language: rec.language, personality: rec.personality, voice: 'hm_omega', style: 'tall-tale', character: 'curious_student', durationSeconds: c.target, visualMode: 'hybrid-local' }, { purpose: 'script' });
  const config = v.config;
  const script = { title: 't', lines: rec.lines.map((l) => ({ text: l.text, say: l.say, visual: l.visual })) };
  const before = estimateSeconds(script, config).seconds, t0 = Date.now();
  const r = await fitLength(config, { script, meta: {} }, { onProgress: () => {} });
  const secs = Math.round((Date.now() - t0) / 1000), log = r.meta.lengthFitLog, lines = log.flatMap((e) => e.lines || []);
  const tf = findTopicFacts(rec.topic);
  // facts kept: every number and every fact-file term in the original appears in the result
  const nums = (s) => s.lines.flatMap((l) => (String(l.say || l.text).match(/\d+(?:\.\d+)?/g) || []));
  const lostNums = nums(script).filter((n) => !nums(r.script).includes(n));
  const claims = (s) => reviewClaims(s, { topic: rec.topic, topicFacts: tf }).claims;
  const g = qualityGates(config, { script: r.script, meta: { ...r.meta, factFile: tf?.file, claimReview: { claims: claims(r.script) } } });
  const row = { case: `${rec.id} — ${c.kind}`, source: c.src.join(' / '), target: c.target, before, after: r.meta.lengthFit.to, calls: r.meta.lengthFit.calls, secs,
    accepted: lines.filter((x) => x.result === 'accepted').length, unchanged: lines.filter((x) => /unchanged/.test(x.reason || '')).length, rejected: lines.filter((x) => x.result === 'rejected').length,
    reasons: lines.filter((x) => x.result === 'rejected').map((x) => `L${x.line}: ${x.reason}`), reason: r.meta.lengthFit.reason,
    lostNumbers: lostNums, sameLineCount: r.script.lines.length === script.lines.length, languageOk: g.language.ok, durationOk: g.duration.ok,
    changes: r.script.lines.map((l, i) => (l.say === script.lines[i].say ? null : { line: i + 1, from: script.lines[i].say, to: l.say })).filter(Boolean), log };
  out.push(row);
  console.log(`${row.case}: ${before}s → ${row.after}s (target ${c.target}), ${row.calls} calls, ${secs}s; accepted ${row.accepted}, unchanged ${row.unchanged}, rejected ${row.rejected}; numbers lost: ${lostNums.length}; language ${g.language.ok ? 'ok' : 'FAIL'}`);
}
stopServer();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.writeFileSync(`logs/tests/fit-controlled-${stamp}.json`, JSON.stringify(out, null, 2));
console.log(`wrote logs/tests/fit-controlled-${stamp}.json`);
