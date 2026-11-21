// Library: permanent delete of one short (project folder + its exported video only).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deleteProject } from '../dashboard/lib/projects.js';
import { PATHS } from '../dashboard/lib/workspace.js';

test('deleteProject removes the project folder and its exports, and nothing else', () => {
  const id = `zz-delete-test-${process.pid}`, other = `${id}-keep`;
  fs.mkdirSync(path.join(PATHS.projects, id, 'audio'), { recursive: true }); fs.writeFileSync(path.join(PATHS.projects, id, 'project.json'), '{}');
  fs.mkdirSync(PATHS.exports, { recursive: true });
  for (const f of [`${id}.mp4`, `${id}.srt`, `${other}.mp4`]) fs.writeFileSync(path.join(PATHS.exports, f), 'x');
  try {
    const removed = deleteProject(id);
    assert.equal(fs.existsSync(path.join(PATHS.projects, id)), false);
    assert.equal(fs.existsSync(path.join(PATHS.exports, `${id}.mp4`)), false); assert.equal(fs.existsSync(path.join(PATHS.exports, `${id}.srt`)), false);
    assert.equal(fs.existsSync(path.join(PATHS.exports, `${other}.mp4`)), true, 'a different short sharing the prefix is untouched');
    assert.equal(removed.length, 3);
  } finally { fs.rmSync(path.join(PATHS.projects, id), { recursive: true, force: true }); for (const f of [`${id}.mp4`, `${id}.srt`, `${other}.mp4`]) fs.rmSync(path.join(PATHS.exports, f), { force: true }); }
});
test('deleteProject refuses paths, system folders and unknown ids', () => {
  for (const bad of ['../x', '..', 'a/b', 'a\\b', '_system', '', '.hidden']) assert.throws(() => deleteProject(bad), /invalid project id/, bad);
  assert.throws(() => deleteProject('no-such-short-xyz-123'), /project not found/);
});
test('server: DELETE endpoint exists and refuses while a job for the short is running; UI asks for confirmation', () => {
  const src = fs.readFileSync(new URL('../dashboard/server.js', import.meta.url), 'utf8'), ui = fs.readFileSync(new URL('../dashboard/public/app.js', import.meta.url), 'utf8');
  assert.match(src, /method === 'DELETE'/); assert.match(src, /new HttpError\(409/);
  assert.match(ui, /data-delete-project/); assert.match(ui, /confirm\(`Permanently delete/);
});
test('server routing: no route uses "r" before "let r" (seen: the Delete route made jobs, automation and facts return 500)', () => {
  const src = fs.readFileSync(new URL('../dashboard/server.js', import.meta.url), 'utf8');
  const decl = src.indexOf('  let r;'), firstUse = src.search(/\(r = m\(/);
  assert.ok(decl > 0 && firstUse > decl, `first "(r = m(" at ${firstUse}, "let r;" at ${decl}`);
});

test('script model: the configured model only — a missing model is "not ready", never a substitute (no silent fallback)', async () => {
  const src = fs.readFileSync(new URL('../dashboard/lib/catalog.js', import.meta.url), 'utf8');
  assert.ok(!/\|\| models\[0\] \|\| null/.test(src), 'the "any .gguf" fallback is gone');
  assert.match(src, /the studio does not substitute another model/);
  const { getCatalog } = await import('../dashboard/lib/catalog.js');
  const llm = getCatalog(true)._internal.llm;
  assert.ok(['gemini', 'groq'].includes(llm.provider)); assert.equal(llm.model, null);   // script writing is online; no local model file is used
});
