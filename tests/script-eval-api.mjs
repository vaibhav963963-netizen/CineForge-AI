// Script-quality verification through the real app path: Studio API → script-only job (local Gemma) → saved project
// version → read back exactly as Script Studio loads it. STOPS there: never submits a render job, never runs TTS,
// Whisper, ComfyUI, scene, capture or FFmpeg.
//   node tests/script-eval-api.mjs [filter-regex]       (studio server must be running on PORT, default 3200)
import fs from 'node:fs';
import { storyProblems, visualProblems, ungrounded, estimateSeconds } from '../dashboard/lib/scriptgen.js';

const BASE = `http://127.0.0.1:${process.env.PORT || 3200}`;
const CASES = [
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
const VOICE = { 'hi-conversational': 'hf_alpha', hinglish: 'hm_omega', en: 'af_heart' };
const PERS = { 'hi-conversational': ['educational', 'documentary', 'desi-storyteller', 'suspense'], hinglish: ['mumbai-conversational', 'energetic-youtuber', 'documentary'], en: ['documentary', 'educational', 'suspense'] };
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const api = async (path, opts = {}) => { const r = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } if (!r.ok) throw new Error(`${r.status} ${path}: ${t.slice(0, 300)}`); return j; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outJson = `logs/tests/script-eval-api-${stamp}.json`, outMd = `logs/tests/script-eval-api-${stamp}.md`;
const renderJobsBefore = (await api('/api/jobs?limit=500')).filter((j) => j.kind === 'render').length;
const results = []; let k = 0;
for (const [cat, topic, langs] of CASES) for (const [language, durationSeconds] of langs) {
  const id = `${cat}/${language}`; if (only && !only.test(id)) continue;
  const personality = PERS[language][k++ % PERS[language].length];
  const input = { topic, language, personality, voice: VOICE[language], style: 'tall-tale', character: 'curious_student', durationSeconds, visualMode: 'hybrid-local' };
  const t0 = Date.now(); process.stdout.write(`${id} (${personality}, ${durationSeconds}s) … `);
  try {
    const sub = await api('/api/scripts/preview', { method: 'POST', body: JSON.stringify({ input, requestKey: `eval-${stamp}-${id}` }) });
    const jobId = sub.jobId || sub.job?.id || sub.id, projectId = sub.projectId || sub.project?.id;
    let job;
    for (;;) { await sleep(4000); job = (await api(`/api/jobs?projectId=${projectId}&limit=20`)).find((j) => (j.jobId || j.id) === jobId); if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) break; }
    if (job.status !== 'completed') throw new Error(`job ${job.status}: ${job.error?.message || job.message || ''}`);
    // exactly what Script Studio loads: the project, then the newest version (what the Script button now opens)
    const p = await api(`/api/projects/${projectId}`), latest = Math.max(...p.script.versions.map((v) => v.version));
    const s = await api(`/api/projects/${projectId}/scripts/${latest}`);
    const cfg = p.config, est = estimateSeconds(s, cfg), m = s.meta;
    const en = m.englishDraft?.lines || null;
    const rec = { id, topic, language, personality, durationSeconds, projectId, version: latest, jobResultVersion: job.result?.version ?? null,
      shownIsLatest: job.result?.version == null || job.result.version === latest, secs: Math.round((Date.now() - t0) / 1000), estimatedSeconds: est.seconds,
      title: s.title, lines: s.lines.map((l) => ({ text: l.text, say: l.say, visual: l.visual, onScreen: l.onScreen })), englishDraft: en,
      gates: m.gates || null, ready: !!m.llmReview?.confirmed, research: m.research ? { essentials: m.research.essentials, rejected: m.research.rejected } : null,
      factFile: m.factFile || null, lengthFit: m.lengthFit || null,
      // re-checked here so a stale server build cannot hide anything
      recheck: { story: storyProblems(s), visuals: visualProblems(s, { englishLines: en, topic }) },
      claims: (m.claimReview?.claims || []).filter((c) => c.status !== 'supported').map((c) => `L${c.line} ${c.status}: ${c.text || c.value}`) };
    results.push(rec);
    console.log(`${rec.secs}s, v${latest}, ~${est.seconds}s, ${rec.ready ? 'READY' : 'not ready'} [${Object.entries(rec.gates || {}).map(([g, v]) => (v.ok ? '+' : '-') + g).join(' ')}]`);
  } catch (e) { results.push({ id, topic, language, personality, durationSeconds, error: String(e.message).slice(0, 600) }); console.log('REJECTED/ERROR', String(e.message).slice(0, 300)); }
  fs.writeFileSync(outJson, JSON.stringify(results, null, 2));
  fs.writeFileSync(outMd, results.map((r) => r.error ? `## ${r.id} — ${r.personality}, ${r.durationSeconds}s\nTopic: ${r.topic}\nERROR: ${r.error}\n` :
    `## ${r.id} — ${r.personality}, target ${r.durationSeconds}s, est ${r.estimatedSeconds}s — ${r.ready ? 'READY' : 'NOT READY'}\nTopic: ${r.topic} · project ${r.projectId} v${r.version}${r.shownIsLatest ? '' : ' (STALE!)'} · fact file: ${r.factFile || 'none'}\nTitle: ${r.title}\n\n${r.lines.map((l, i) => `${i + 1}. ${l.text}${l.say && l.say !== l.text ? `\n   say: ${l.say}` : ''}\n   visual: ${l.visual}${l.onScreen ? `\n   on screen: ${l.onScreen}` : ''}`).join('\n')}\n\nGates: ${Object.entries(r.gates || {}).map(([g, v]) => `${g}=${v.ok ? 'ok' : 'FAIL(' + v.issues.join('; ').slice(0, 220) + ')'}`).join(', ')}\nEssentials: ${(r.research?.essentials || []).join('; ') || '-'}\nRecheck: story ${r.recheck.story.length} ${r.recheck.story.join(' | ')} · visuals ${r.recheck.visuals.length} ${r.recheck.visuals.join(' | ')}\nLength fit: ${r.lengthFit ? r.lengthFit.from + 's → ' + r.lengthFit.to + 's' : '-'}\nClaims to check: ${r.claims.join('; ') || 'none'}\n`).join('\n'));
}
const renderJobsAfter = (await api('/api/jobs?limit=500')).filter((j) => j.kind === 'render').length;
console.log(`render jobs before/after: ${renderJobsBefore}/${renderJobsAfter} (must be equal)`);
console.log('wrote', outJson, outMd);
