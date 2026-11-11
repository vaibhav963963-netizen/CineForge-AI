// Benchmark the local script model (llama.cpp + GGUF) on the studio's real prompts:
// load time, generation speed, language correctness (Devanagari share / Hinglish "say" forms / English), word budget
// fit, retries. Every generated script is kept as evidence.
//   node tools/benchmark-llm.mjs                → logs/benchmarks/llm-<timestamp>.json
import fs from 'node:fs';
import path from 'node:path';
import { validateGenerationConfig } from '../dashboard/lib/validate.js';
import { generateScript, checkLanguage, estimateSeconds, wordBudget, lineCount } from '../dashboard/lib/scriptgen.js';
import { ensureServer, stopServer, modelInfo } from '../dashboard/lib/llm.js';
import { PATHS } from '../dashboard/lib/workspace.js';

const CASES = [
  { topic: 'How ISRO Reached Mars for Less Than the Budget of the Movie Gravity', language: 'hi-conversational', personality: 'mumbai-conversational', voice: 'hm_omega', durationSeconds: 40 },
  { topic: 'Why Do Indian Temples Have Bells?', language: 'hi-conversational', personality: 'educational', voice: 'hf_alpha', durationSeconds: 45 },
  { topic: 'How Shivaji Maharaj Built a Kingdom of Hill Forts', language: 'hi-formal', personality: 'dramatic-mythology', voice: 'hm_psi', durationSeconds: 40 },
  { topic: 'The Unwritten Rules of Gully Cricket', language: 'hinglish', personality: 'energetic-youtuber', voice: 'hf_beta', durationSeconds: 35 },
  { topic: 'The Mystery of Roopkund, the Skeleton Lake of the Himalayas', language: 'en', personality: 'documentary', voice: 'bm_george', durationSeconds: 30 },
];
const deva = (s) => { const d = (s.match(/[ऀ-ॿ]/g) || []).length, l = (s.match(/[A-Za-z]/g) || []).length; return +(d / Math.max(1, d + l)).toFixed(3); };

const out = { kind: 'llm-benchmark', startedAt: new Date().toISOString(), model: null, load: null, results: [] };
const t0 = Date.now(); await ensureServer(); out.load = { seconds: +((Date.now() - t0) / 1000).toFixed(1) }; out.model = modelInfo();
console.log(`model ${out.model.name || out.model.file} loaded in ${out.load.seconds} s`);
for (const c of CASES) {
  const v = validateGenerationConfig({ ...c, style: 'deep-dive', character: 'none', visualMode: 'procedural' }, { purpose: 'script' });
  if (!v.ok) { out.results.push({ case: c, error: v.errors }); continue; }
  const cfg = v.config, s0 = Date.now(); let r, err = null, lastTokens = 0;
  try { r = await generateScript(cfg, { onProgress: (p) => { if (p.current) lastTokens = p.current; } }); } catch (e) { err = e.message; }
  const secs = (Date.now() - s0) / 1000;
  const res = { language: c.language, personality: c.personality, topic: c.topic, targetSeconds: c.durationSeconds, seconds: +secs.toFixed(1), error: err };
  if (r) {
    const text = r.script.lines.map((l) => l.text).join(' '), est = estimateSeconds(r.script, cfg);
    Object.assign(res, {
      ok: true, attempts: r.meta.attempts, tokens: r.meta.tokens, tokensPerSecond: +(r.meta.tokens / secs).toFixed(1),
      lines: r.script.lines.length, plannedLines: lineCount(cfg), words: est.words, wordBudget: wordBudget(cfg, lineCount(cfg)), estimatedSeconds: est.seconds,
      devanagariShare: deva(text), sayDevanagariShare: c.language === 'hinglish' ? deva(r.script.lines.map((l) => l.say || '').join(' ')) : null,
      languageProblems: checkLanguage(r.script, cfg), visualsPresent: r.script.lines.filter((l) => l.visual).length, onScreen: r.script.lines.filter((l) => l.onScreen).map((l) => l.onScreen),
      script: r.script,
    });
  }
  out.results.push(res);
  console.log(`${c.language.padEnd(17)} ${c.personality.padEnd(22)} ${res.ok ? `OK  ${res.seconds}s ${res.tokensPerSecond} tok/s  attempts ${res.attempts}  ${res.words}/${res.wordBudget} words  ≈${res.estimatedSeconds}s  deva ${res.devanagariShare}` : `FAIL ${err}`}`);
  if (res.ok) console.log(`   "${r.script.lines[0].text}"`);
}
stopServer();
out.finishedAt = new Date().toISOString();
fs.mkdirSync(path.join(PATHS.logs, 'benchmarks'), { recursive: true });
const f = path.join(PATHS.logs, 'benchmarks', `llm-${out.startedAt.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(f, JSON.stringify(out, null, 1));
console.log(`evidence: ${path.relative(PATHS.root, f)}`);
process.exit(0);
