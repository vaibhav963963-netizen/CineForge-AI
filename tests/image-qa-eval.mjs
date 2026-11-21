// Pixel-level TECHNICAL image QA over every existing project's generated images (no model; FFmpeg only).
import fs from 'node:fs';
import { measureImage, technicalFindings, setFindings } from '../dashboard/lib/imageqa.js';
const out = []; const t0 = Date.now();
for (const p of fs.readdirSync('projects')) {
  const d = `projects/${p}/generated-images`; if (!fs.existsSync(d)) continue;
  const files = fs.readdirSync(d).filter((x) => /^S\d+\.png$/i.test(x)).sort(); if (!files.length) continue;
  const m = files.map((f) => ({ ...measureImage(`${d}/${f}`), sceneId: f.replace('.png', '') }));
  const cross = setFindings(m);
  m.forEach((x, i) => { const f = [...technicalFindings(x), ...cross[i]]; out.push({ project: p, sceneId: x.sceneId, file: x.file, findings: f }); });
}
const flagged = out.filter((x) => x.findings.length);
console.log(`${out.length} images in ${new Set(out.map((x) => x.project)).size} projects, ${Math.round((Date.now() - t0) / 1000)} s; flagged ${flagged.length}`);
const by = {}; for (const x of flagged) for (const f of x.findings) (by[`${f.category}/${f.severity}: ${f.problem.replace(/\(.*?\)|S\d+|\d+/g, '').trim()}`] ||= []).push(`${x.project}/${x.sceneId}  ${f.problem}`);
for (const [k, v] of Object.entries(by)) { console.log(`\n${k} (${v.length})`); v.slice(0, 6).forEach((s) => console.log('  ' + s)); }
fs.writeFileSync(`logs/tests/image-qa-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`, JSON.stringify(out, null, 2));
