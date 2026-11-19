// Real-model check of correctVisuals on saved benchmark scripts (script data only — no image generation).
import fs from 'node:fs';
import { visualReport, correctVisuals } from '../dashboard/lib/visualsem.js';
import { findTopicFacts } from '../dashboard/lib/factcheck.js';
import { storyType } from '../dashboard/lib/scriptgen.js';
import { chat, ensureServer, stopServer } from '../dashboard/lib/llm.js';
const L = { 'hi-conversational': { id: 'hi-conversational', code: 'hi', script: 'Deva', name: 'Hindi' }, hinglish: { id: 'hinglish', code: 'hi', script: 'Latn', name: 'Hinglish' }, en: { id: 'en', code: 'en', script: 'Latn', name: 'English' } };
const recs = [], seen = new Set();
for (const f of fs.readdirSync('logs/tests').filter((f) => /^script-eval-2026-11-13T1[4-6].*\.json$/.test(f)).sort()) {
  for (const x of JSON.parse(fs.readFileSync(`logs/tests/${f}`))) { if (!x.lines || !L[x.language]) continue; const k = x.lines.map((l) => l.visual).join('|'); if (seen.has(k)) continue; seen.add(k); recs.push(x); }
}
await ensureServer();
const out = []; let calls = 0; const t0 = Date.now();
for (const x of recs) {
  const tf = findTopicFacts(x.topic), cfg = { topic: x.topic, language: L[x.language] }, kind = storyType(x.topic, tf);
  const value = { script: { lines: x.lines.map((l) => ({ ...l })) }, meta: { plan: x.plan } };
  const before = visualReport(cfg, value, { topicFacts: tf, storyKind: kind });
  if (before.ok) continue;
  const r = await correctVisuals(cfg, value, { chatFn: chat, topicFacts: tf, storyKind: kind });
  calls += r.calls; const after = visualReport(cfg, r.value, { topicFacts: tf, storyKind: kind });
  const narrationSame = r.value.script.lines.every((l, i) => l.text === x.lines[i].text && l.say === x.lines[i].say);
  out.push({ id: x.id, before: before.scenes.filter((s) => s.decision !== 'aligned').length, after: after.scenes.filter((s) => s.decision !== 'aligned').length, narrationSame, log: r.log });
  console.log(`\n== ${x.id} (${x.language}) — scenes not aligned: ${out.at(-1).before} → ${out.at(-1).after}; narration unchanged: ${narrationSame}`);
  for (const e of r.log) console.log(`  ${e.sceneId} ${e.accepted ? 'ACCEPTED' : 'REJECTED'}${e.reason ? ` (${e.reason.slice(0, 110)})` : ''}\n    problem: ${(e.problems || []).join('; ').slice(0, 140)}\n    from: ${(e.from || '').slice(0, 120)}${e.to ? `\n    to:   ${e.to.slice(0, 120)}` : ''}`);
}
stopServer();
console.log(`\n${out.length} scripts with findings, ${calls} model calls, ${Math.round((Date.now() - t0) / 1000)} s`);
fs.writeFileSync(`logs/tests/visual-correct-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`, JSON.stringify(out, null, 2));
