// Real-model check of correctLanguage on grammar errors found in saved benchmark outputs (script-only).
import fs from 'node:fs';
import { correctLanguage, languageIssues } from '../dashboard/lib/langquality.js';
import { chat, ensureServer, stopServer } from '../dashboard/lib/llm.js';
const L = { 'hi-conversational': { id: 'hi-conversational', code: 'hi', script: 'Deva', name: 'Hindi' }, hinglish: { id: 'hinglish', code: 'hi', script: 'Latn', name: 'Hinglish' }, en: { id: 'en', code: 'en', script: 'Latn', name: 'English' } };
const found = new Map();
for (const f of fs.readdirSync('logs/tests').filter((f) => /^script-eval-.*json$/.test(f))) {
  let r; try { r = JSON.parse(fs.readFileSync(`logs/tests/${f}`)); } catch { continue; }
  for (const x of r) { if (!x.lines || !L[x.language]) continue; const cfg = { language: L[x.language] };
    for (const i of languageIssues(cfg, { lines: x.lines })) { if (i.severity !== 'error') continue; const l = x.lines[i.line - 1]; const t = x.language === 'hinglish' ? (l.say || l.text) : l.text; if (!found.has(t)) found.set(t, { cfg, line: l }); } }
}
await ensureServer();
const out = []; const t0 = Date.now();
for (const [t, { cfg, line }] of found) {
  const r = await correctLanguage(cfg, { script: { lines: [{ ...line }] }, meta: {} }, { chatFn: chat });
  const e = r.log[0]; out.push(e);
  console.log(`\n[${cfg.language.name}] ${t}\n  errors: ${e.errors.join(' | ')}\n  ${e.mechanical ? `mechanical → ${e.mechanical}\n  ` : ''}${e.model ? `model → ${e.model.answer}\n  ${e.model.accepted ? 'ACCEPTED' : `REJECTED: ${e.model.reason}`}` : ''}\n  final: ${e.final}${e.remaining.length ? `\n  still: ${e.remaining.join(' | ')}` : ''}`);
}
stopServer();
console.log(`\n${out.length} lines, ${out.filter((e) => e.changed).length} corrected, ${out.filter((e) => e.model).length} model calls, ${Math.round((Date.now() - t0) / 1000)} s`);
fs.writeFileSync(`logs/tests/lang-correct-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`, JSON.stringify(out, null, 2));
