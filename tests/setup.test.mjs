// System Setup tests: download manager (range/no-range/interrupt/resume/corrupt/checksum/disk/duplicate/cancel/
// redirect/restart), registry validation, detection honesty, installer planning, API security, log redaction.
//   node --test tests/setup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-setup-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
// keep test records out of the real logs/setup (must be set before the setup modules load)
process.env.CINEFORGE_SETUP_DIR = path.join(tmp, 'setup-logs');
const { DownloadManager } = await import('../dashboard/lib/setup/downloads.js');
const { loadRegistry, validateRegistry, isTrustedUrl, topoOrder, REGISTRY_FILE } = await import('../dashboard/lib/setup/registry.js');
const { detectComponent } = await import('../dashboard/lib/setup/detect.js');
const { redact } = await import('../dashboard/lib/setup/log.js');
const { validateDir } = await import('../dashboard/lib/setup/settings.js');
const { InstallManager } = await import('../dashboard/lib/setup/installer.js');
const { createSetupRoutes } = await import('../dashboard/lib/setup/routes.js');

// ── fake download server ───────────────────────────────────────────────────────────────────────────────────────
const BODY = crypto.randomBytes(3 * 1024 * 1024 + 123);
const SHA = crypto.createHash('sha256').update(BODY).digest('hex');
const hits = [];
let dropAfter = null;             // bytes: close the socket mid-transfer once
const srv = http.createServer((req, res) => {
  hits.push({ url: req.url, range: req.headers.range });
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/redirect-good') { res.writeHead(302, { Location: '/ranged' }); return res.end(); }
  if (u.pathname === '/redirect-evil') { res.writeHead(302, { Location: 'http://evil.example.com/x' }); return res.end(); }
  if (u.pathname === '/404') { res.writeHead(404); return res.end(); }
  if (u.pathname === '/slow') { res.writeHead(200, { 'Content-Length': BODY.length }); res.write(BODY.subarray(0, 65536)); return; /* never finishes */ }
  const corrupt = u.pathname === '/corrupt', ranged = u.pathname === '/ranged' || corrupt;
  const data = corrupt ? Buffer.concat([BODY.subarray(0, 1000), Buffer.from('X'), BODY.subarray(1001)]) : BODY;
  const m = ranged && req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  const from = m ? +m[1] : 0;
  // /sloppy-range ignores the end of "bytes=a-b" (some servers do): the client must clamp
  const to = m && m[2] && u.searchParams.get('sloppy') !== '1' ? Math.min(+m[2], data.length - 1) : data.length - 1;
  const chunk = data.subarray(from, to + 1);
  res.writeHead(m ? 206 : 200, { 'Content-Length': chunk.length, ...(ranged ? { 'Accept-Ranges': 'bytes' } : {}), ...(m ? { 'Content-Range': `bytes ${from}-${to}/${data.length}` } : {}) });
  if (dropAfter != null && chunk.length > dropAfter) { const n = dropAfter; dropAfter = null; res.write(chunk.subarray(0, n), () => res.destroy()); return; }
  res.end(chunk);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
test.after(() => srv.close());

let n = 0;
const mk = (o = {}) => new DownloadManager({ stateFile: path.join(tmp, `state-${++n}.json`), trustedHosts: ['127.0.0.1'], allowedRoots: [tmp], allowHttp: true, backoffBaseMs: 20, idleTimeoutMs: 1500, maxAttempts: 4, marginBytes: 0, ...o });
const dest = (name) => path.join(tmp, 'dl', `${name}-${++n}.bin`);

test('download: success with sha256, no .part left, file placed atomically', async () => {
  const dm = mk(), d = dest('ok');
  const it = dm.add({ url: `${BASE}/ranged`, dest: d, size: BODY.length, sha256: SHA });
  const done = await dm.wait(it.id);
  assert.equal(done.status, 'completed'); assert.equal(done.verified, 'sha256');
  assert.ok(fs.readFileSync(d).equals(BODY)); assert.ok(!fs.existsSync(`${d}.part`));
});

test('download: interrupted transfer resumes with a Range request', async () => {
  const dm = mk(), d = dest('resume');
  dropAfter = 1024 * 1024;
  const it = dm.add({ url: `${BASE}/ranged`, dest: d, size: BODY.length, sha256: SHA });
  const done = await dm.wait(it.id);
  assert.equal(done.status, 'completed'); assert.equal(done.resumable, true);
  assert.ok(hits.some((h) => h.url === '/ranged' && h.range && +h.range.match(/\d+/)[0] > 0), 'a ranged request was made');
  assert.ok(fs.readFileSync(d).equals(BODY));
});

test('download: server without Range support restarts from zero and says so', async () => {
  const d = dest('norange');
  fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(`${d}.part`, BODY.subarray(0, 5000));
  const dm = mk();
  const it = dm.add({ url: `${BASE}/plain`, dest: d, size: BODY.length, sha256: SHA });
  const done = await dm.wait(it.id);
  assert.equal(done.status, 'completed'); assert.equal(done.resumable, false);
  assert.match(done.note || '', /restarting from zero/);
  assert.ok(fs.readFileSync(d).equals(BODY));
});

test('download: corrupted file fails checksum, is discarded, existing good file untouched', async () => {
  const d = dest('corrupt'); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, 'previous working file');
  const dm = mk();
  const it = dm.add({ url: `${BASE}/corrupt`, dest: d, size: BODY.length, sha256: SHA });
  await assert.rejects(dm.wait(it.id), /SHA256 mismatch/);
  assert.equal(dm.get(it.id).status, 'failed');
  assert.ok(!fs.existsSync(`${d}.part`)); assert.equal(fs.readFileSync(d, 'utf8'), 'previous working file');
});

test('download: wrong expected size is refused before writing', async () => {
  const dm = mk(), d = dest('size');
  const it = dm.add({ url: `${BASE}/ranged`, dest: d, size: 999, sha256: SHA });
  await assert.rejects(dm.wait(it.id), /differs from the registry/);
});

test('download: insufficient disk space is reported, nothing downloaded', async () => {
  const dm = mk({ freeBytes: () => 1000 }), d = dest('disk');
  const it = dm.add({ url: `${BASE}/ranged`, dest: d, size: BODY.length, sha256: SHA });
  await assert.rejects(dm.wait(it.id), /Insufficient storage/);
  assert.ok(!fs.existsSync(`${d}.part`));
});

test('download: duplicate request returns the same item', async () => {
  const dm = mk(), d = dest('dup');
  const a = dm.add({ url: `${BASE}/ranged`, dest: d, size: BODY.length, sha256: SHA });
  const b = dm.add({ url: `${BASE}/ranged`, dest: d, size: BODY.length, sha256: SHA });
  assert.equal(a.id, b.id);
  await dm.wait(a.id);
});

test('download: HTTP 404 fails without retry storm', async () => {
  const dm = mk(), before = hits.filter((h) => h.url === '/404').length;
  const it = dm.add({ url: `${BASE}/404`, dest: dest('404'), sha256: SHA });
  await assert.rejects(dm.wait(it.id), /HTTP 404/);
  assert.equal(hits.filter((h) => h.url === '/404').length - before, 1);
});

test('download: idle network is retried then fails (timeout handling)', async () => {
  const dm = mk({ maxAttempts: 2, idleTimeoutMs: 300 });
  const it = dm.add({ url: `${BASE}/slow`, dest: dest('slow'), sha256: SHA });
  await assert.rejects(dm.wait(it.id), /no data received/);
});

test('download: cancel removes the partial file; pause keeps it and resume completes', async () => {
  const dm = mk({ maxAttempts: 50, idleTimeoutMs: 200 }), d = dest('cancel');
  const it = dm.add({ url: `${BASE}/slow`, dest: d, sha256: SHA });
  await new Promise((r) => setTimeout(r, 150));
  dm.cancel(it.id);
  await assert.rejects(dm.wait(it.id));
  assert.equal(dm.get(it.id).status, 'cancelled'); assert.ok(!fs.existsSync(`${d}.part`));

  const dm2 = mk(), d2 = dest('pause');
  dropAfter = null;
  const it2 = dm2.add({ url: `${BASE}/ranged`, dest: d2, size: BODY.length, sha256: SHA });
  dm2.pause(it2.id);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(dm2.get(it2.id).status, 'paused');
  dm2.resume(it2.id);
  assert.equal((await dm2.wait(it2.id)).status, 'completed');
});

test('download: untrusted URL, redirect to untrusted host, and destination outside roots are refused', async () => {
  const dm = mk();
  assert.throws(() => dm.add({ url: 'https://evil.example.com/model.bin', dest: dest('x'), sha256: SHA }), /not a trusted download source/);
  assert.throws(() => dm.add({ url: `${BASE}/ranged`, dest: path.join(tmp, '..', 'escape.bin'), sha256: SHA }), /outside the allowed folders/);
  assert.throws(() => dm.add({ url: `${BASE}/ranged`, dest: 'C:\\Windows\\System32\\evil.dll', sha256: SHA }), /outside the allowed folders/);
  const it = dm.add({ url: `${BASE}/redirect-evil`, dest: dest('redir'), sha256: SHA });
  await assert.rejects(dm.wait(it.id), /untrusted host evil\.example\.com/);
  const ok = dm.add({ url: `${BASE}/redirect-good`, dest: dest('redir-ok'), size: BODY.length, sha256: SHA });
  assert.equal((await dm.wait(ok.id)).status, 'completed');
});

test('download: state survives a dashboard restart (running → paused with partial size kept)', async () => {
  const state = path.join(tmp, 'restart.json'), d = dest('restart');
  fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(`${d}.part`, BODY.subarray(0, 4096));
  fs.writeFileSync(state, JSON.stringify({ items: [{ id: 'dl-20261111000000-abcde', url: `${BASE}/ranged`, dest: d, size: BODY.length, sha256: SHA, status: 'downloading', bytes: 9999, createdAt: new Date().toISOString() }] }));
  const dm = mk({ stateFile: state });
  const it = dm.get('dl-20261111000000-abcde');
  assert.equal(it.status, 'paused'); assert.equal(it.bytes, 4096); assert.match(it.note, /Interrupted/);
  dm.resume(it.id);
  assert.equal((await dm.wait(it.id)).status, 'completed');
  assert.ok(fs.readFileSync(d).equals(BODY));
});

test('download: large file is fetched as parallel ranges, a dropped segment resumes, result is exact', async () => {
  const dm = mk({ segments: () => 4, segmentMinBytes: 0 }), d = dest('seg');
  const before = hits.length;
  dropAfter = 200 * 1024;
  const it = dm.add({ url: `${BASE}/ranged`, dest: d, size: BODY.length, sha256: SHA });
  const done = await dm.wait(it.id);
  assert.equal(done.status, 'completed'); assert.equal(done.segments, 4);
  const ranges = hits.slice(before).filter((h) => h.range && h.range !== 'bytes=0-0');
  assert.ok(ranges.length >= 5, `4 segments + 1 resumed segment, saw ${ranges.length}`);
  assert.ok(fs.readFileSync(d).equals(BODY));
  assert.ok(!fs.readdirSync(path.dirname(d)).some((f) => f.startsWith(path.basename(d) + '.seg')), 'segment files removed');
});

test('download: a server that ignores the range end cannot corrupt neighbouring segments', async () => {
  const dm = mk({ segments: () => 3, segmentMinBytes: 0 }), d = dest('sloppy');
  const done = await dm.wait(dm.add({ url: `${BASE}/ranged?sloppy=1`, dest: d, size: BODY.length, sha256: SHA }).id);
  assert.equal(done.status, 'completed'); assert.ok(fs.readFileSync(d).equals(BODY));
});

test('download: segmenting is not used when the server ignores ranges', async () => {
  const dm = mk({ segments: () => 4, segmentMinBytes: 0 }), d = dest('seg-plain');
  const done = await dm.wait(dm.add({ url: `${BASE}/plain`, dest: d, size: BODY.length, sha256: SHA }).id);
  assert.equal(done.status, 'completed'); assert.ok(!done.segments); assert.equal(done.resumable, false);
});

// ── registry ───────────────────────────────────────────────────────────────────────────────────────────────────
test('registry: the shipped registry is valid, ordered and only uses trusted HTTPS sources', () => {
  const reg = loadRegistry(REGISTRY_FILE, { force: true });
  assert.ok(reg.components.length >= 20);
  const order = topoOrder(reg.components);
  for (const c of reg.components) for (const d of c.dependsOn || []) assert.ok(order.indexOf(d) < order.indexOf(c.id), `${d} before ${c.id}`);
  for (const f of reg.features) assert.ok(f.requires.length);
});

test('registry: rejects cycles, unknown deps, untrusted URLs, path traversal and unchecked downloads', () => {
  const base = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  const bad = (mut) => { const r = structuredClone(base); mut(r); return validateRegistry(r).join('\n'); };
  assert.match(bad((r) => { r.components[0].dependsOn = [r.components[1].id]; r.components[1].dependsOn = [r.components[0].id]; }), /cycle/);
  assert.match(bad((r) => { r.components[0].dependsOn = ['nope']; }), /unknown nope/);
  assert.match(bad((r) => { r.components.find((c) => c.id === 'kokoro-model').detect.files[0].url = 'https://mirror.example.net/kokoro.onnx'; }), /untrusted URL/);
  assert.match(bad((r) => { r.components.find((c) => c.id === 'kokoro-model').detect.files[0].path = '../../evil.onnx'; }), /without \.\./);
  assert.match(bad((r) => { delete r.components.find((c) => c.id === 'ffmpeg').install.steps[0].sha256; }), /no checksum/);
  assert.match(bad((r) => { r.components.find((c) => c.id === 'ffmpeg').install.steps[1].op = 'shell'; }), /unknown install op shell/);
  assert.equal(isTrustedUrl('http://huggingface.co/x', base.trustedHosts), false, 'plain http refused');
  assert.equal(isTrustedUrl('https://huggingface.co.evil.com/x', base.trustedHosts), false);
  assert.equal(isTrustedUrl('https://user:pw@huggingface.co/x', base.trustedHosts), false);
});

// ── detection honesty ───────────────────────────────────────────────────────────────────────────────────────────
test('detect: an existing folder with a wrong-size or missing file is never "ready"', async () => {
  const dir = path.join(tmp, 'models'); fs.mkdirSync(dir, { recursive: true });
  const comp = { id: 'fake', name: 'Fake', detect: { type: 'files', base: dir, files: [{ path: 'a.bin', size: 10, sha256: SHA }, { path: 'b.bin', size: 3 }] } };
  assert.equal((await detectComponent(comp)).status, 'not-installed');
  fs.writeFileSync(path.join(dir, 'a.bin'), '12345'); fs.writeFileSync(path.join(dir, 'b.bin'), 'abc');
  const s = await detectComponent(comp);
  assert.equal(s.status, 'failed'); assert.match(s.problems.join(), /size 5/);
  fs.writeFileSync(path.join(dir, 'a.bin'), '0123456789');
  const s2 = await detectComponent(comp);
  assert.equal(s2.status, 'ready'); assert.equal(s2.integrity, 'unverified', 'size match alone is reported as unverified, not verified');
});

test('detect: missing executable → not-installed, not failed or ready', async () => {
  const s = await detectComponent({ id: 'x', name: 'x', detect: { type: 'exec', exe: path.join(tmp, 'nope.exe'), args: ['--version'], regex: '(\\d+)' } });
  assert.equal(s.status, 'not-installed');
});

// ── installer planning ─────────────────────────────────────────────────────────────────────────────────────────
test('installer: plan resolves prerequisites in order, skips ready ones, lists manual components', () => {
  const reg = loadRegistry();
  const dm = mk();
  const im = new InstallManager({ downloads: dm, registry: reg, profile: () => 'cpu' });
  const statuses = Object.fromEntries(reg.components.map((c) => [c.id, { status: 'not-installed' }]));
  const p = im.plan('install', ['comfyui-requirements'], statuses);
  assert.deepEqual(p.componentIds, ['python-base', 'comfyui', 'comfyui-venv', 'comfyui-torch', 'comfyui-requirements']);
  statuses['python-base'] = { status: 'ready' };
  assert.ok(!im.plan('install', ['comfyui-requirements'], statuses).componentIds.includes('python-base'));
  assert.equal(im.plan('install', ['browser'], statuses).manual[0].id, 'browser');
  assert.throws(() => im.plan('install', ['rm -rf /'], statuses), /unknown component/);
  assert.throws(() => im.plan('format-disk', ['ffmpeg'], statuses), /unknown action/);
  assert.match(im.plan('remove', ['ffmpeg'], statuses).blockers.join(), /only model files/);
  assert.throws(() => im.submit('update', ['gemma-3-4b'], { ...statuses, 'gemma-3-4b': { status: 'update-available' } }), /needs confirmation/);
});

test('installer: install/repair are refused while a render job runs', () => {
  const reg = loadRegistry();
  const im = new InstallManager({ downloads: mk(), registry: reg, profile: () => 'cpu', isBusy: () => 'a render job is running' });
  assert.throws(() => im.submit('install', ['ffmpeg'], {}), /render job is running/);
});

// ── API security ────────────────────────────────────────────────────────────────────────────────────────────────
test('api: token, Host, Origin and id validation', async () => {
  const routes = createSetupRoutes({ port: 0 });
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { ok({}); } }); });
  const s = http.createServer(async (req, res) => { try { await routes.handle(req, res, new URL(req.url, 'http://x'), { readBody, send }); } catch (e) { send(res, e.code || 500, { error: e.message }); } });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  // the routes were built for port 0: rebuild the allowlist for the real port
  const r2 = createSetupRoutes({ port, service: routes.service }); s.removeAllListeners('request');
  s.on('request', async (req, res) => { try { await r2.handle(req, res, new URL(req.url, 'http://x'), { readBody, send }); } catch (e) { send(res, e.code || 500, { error: e.message }); } });
  const req = (p, { method = 'GET', headers = {}, body } = {}) => new Promise((ok) => {
    const rq = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: `127.0.0.1:${port}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => ok({ status: res.statusCode, body: b ? JSON.parse(b) : null })); });
    if (body) rq.write(JSON.stringify(body)); rq.end();
  });
  try {
    const sess = await req('/api/setup/session'); assert.equal(sess.status, 200);
    const tok = sess.body.token;
    assert.equal((await req('/api/setup/ops', { method: 'POST', body: { action: 'install', ids: ['ffmpeg'] } })).status, 401, 'no token');
    assert.equal((await req('/api/setup/ops', { method: 'POST', headers: { 'X-CineForge-Token': 'x'.repeat(48) }, body: { action: 'install', ids: ['ffmpeg'] } })).status, 401, 'wrong token');
    assert.equal((await req('/api/setup/overview', { headers: { Host: 'attacker.example:80' } })).status, 403, 'DNS rebinding Host');
    assert.equal((await req('/api/setup/ops', { method: 'POST', headers: { Origin: 'https://evil.example', 'X-CineForge-Token': tok }, body: { action: 'install', ids: ['ffmpeg'] } })).status, 403, 'cross origin');
    assert.equal((await req('/api/setup/ops', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site', 'X-CineForge-Token': tok }, body: {} })).status, 403);
    assert.equal((await req('/api/setup/ops', { method: 'POST', headers: { 'X-CineForge-Token': tok }, body: { action: 'install', ids: ['ffmpeg & calc.exe'] } })).status, 404, 'injection in id');
    assert.equal((await req('/api/setup/ops', { method: 'POST', headers: { 'X-CineForge-Token': tok }, body: { action: 'install', ids: ['../../etc'] } })).status, 404);
    assert.equal((await req('/api/setup/plan', { method: 'POST', headers: { 'X-CineForge-Token': tok }, body: { action: '$(calc)', ids: ['ffmpeg'] } })).status, 400);
    assert.equal((await req('/api/setup/downloads/..%2F..%2Fx/open', { method: 'POST', headers: { 'X-CineForge-Token': tok }, body: {} })).status, 404);
    assert.equal((await req('/api/setup/storage/cleanup', { method: 'POST', headers: { 'X-CineForge-Token': tok }, body: { id: 'projects', confirm: true } })).status, 404, 'projects can never be cleaned');
    assert.equal((await req('/api/setup/config/path', { method: 'POST', headers: { 'X-CineForge-Token': tok }, body: { key: 'models.llm', value: 'C:\\Windows\\System32', confirm: true } })).status, 422);
    assert.equal((await req('/api/setup/components/kokoro-model/import', { method: 'POST', headers: { 'X-CineForge-Token': tok }, body: { file: 'kokoro-v1.0.onnx', source: path.join(tmp, 'nope') } })).status, 404);
    const ov = await req('/api/setup/overview'); assert.equal(ov.status, 200); assert.ok(ov.body.counts.total > 0);
  } finally { s.close(); }
});

test('logs: secrets and home paths are redacted', () => {
  const s = redact('GET https://cdn.hf.co/x?Signature=abc123&Key-Pair-Id=K1&Policy=eyJ x Authorization: Bearer hf_abcdefghijklmnopqrstuvwxyz HF_TOKEN=secret123 ' + os.homedir());
  assert.ok(!/abc123|hf_abcdef|secret123|eyJ/.test(s), s);
  assert.ok(!s.includes(os.homedir()));
  assert.equal(redact({ apiKey: 'zzz', nested: { password: 'p' } }).apiKey, '[redacted]');
});

test('settings: folder validation refuses system folders and drive roots', () => {
  assert.equal(validateDir('C:\\Windows\\Temp\\x').ok, false);
  assert.equal(validateDir('C:\\').ok, false);
  assert.equal(validateDir('').ok, false);
  assert.equal(validateDir('bad|name').ok, false);
  const ok = validateDir(path.join(tmp, 'new-models'));
  assert.equal(ok.ok, true); assert.equal(ok.exists, false);
});
