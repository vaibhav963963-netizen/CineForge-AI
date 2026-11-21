// Real test: Script Book entries → scripts written with Groq ONE AT A TIME → saved → reloaded. Script-only (no render).
//   node tests/groq-scriptbook-e2e.mjs [entryId …]   (default: every entry whose source is "groq-acceptance-test")
import fs from 'node:fs';
const B = `http://127.0.0.1:${process.env.PORT || 3000}`;
const api = async (p, o = {}) => { const r = await fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined }); const j = await r.json().catch(() => ({})); return { status: r.status, body: j }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const book = (await api('/api/scriptbook')).body.entries;
const ids = process.argv.slice(2).length ? process.argv.slice(2) : book.filter((e) => e.source === 'groq-acceptance-test').map((e) => e.id);
const out = [];
for (const id of ids) {
  const t0 = Date.now();
  const g = await api(`/api/scriptbook/${id}/generate`, { method: 'POST' });
  if (g.status !== 202) { out.push({ id, error: g.body.error }); console.log(id, 'NOT STARTED', g.status, g.body.error); continue; }
  let e;
  for (;;) { await sleep(8000); e = (await api('/api/scriptbook')).body.entries.find((x) => x.id === id); if (e.status !== 'generating') break; }
  const secs = Math.round((Date.now() - t0) / 1000);
  let v = null; if (e.projectId && e.version) v = (await api(`/api/projects/${e.projectId}/scripts/${e.version}`)).body;
  const m = v?.meta || {}, gates = Object.fromEntries(Object.entries(m.gates || {}).map(([k, x]) => [k, x.ok]));
  const r = { id, language: e.language, topic: e.topic, status: e.status, scriptStatus: e.scriptStatus, seconds: secs, error: e.error, model: m.model?.name, estimatedSeconds: m.estimatedSeconds, target: e.durationSeconds, lines: (v?.lines || []).map((l) => l.say ? `${l.say}  |  ${l.text}` : l.text), visuals: (v?.lines || []).every((l) => (l.visual || '').length > 10), gates, failing: Object.entries(m.gates || {}).filter(([, x]) => !x.ok).map(([k, x]) => `${k}: ${(x.issues || []).slice(0, 2).join(' / ')}`.slice(0, 240)) };
  out.push(r);
  console.log(`\n== ${r.language} · ${r.status} (${r.scriptStatus}) · ${secs}s · ~${r.estimatedSeconds}s for ${r.target}s · model ${r.model}${r.error ? ` · ERROR ${r.error}` : ''}`);
  r.lines.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
  console.log('  gates:', Object.entries(gates).map(([k, ok]) => (ok ? '+' : '-') + k).join(' '));
  r.failing.forEach((f) => console.log('   -', f));
}
// persistence: the book file on disk, re-read independently of the server
const disk = JSON.parse(fs.readFileSync('logs/scriptbook/scriptbook.json', 'utf8'));
console.log('\nreloaded from disk:', ids.map((id) => { const d = disk.entries.find((x) => x.id === id); return `${id}=${d?.status}/v${d?.version}`; }).join(' '));
fs.writeFileSync(`logs/tests/groq-scriptbook-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`, JSON.stringify(out, null, 2));
