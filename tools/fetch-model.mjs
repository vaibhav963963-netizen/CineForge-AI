// Robust model downloader for slow / flaky connections (Node 22, no packages).
//   node tools/fetch-model.mjs <url> <dest> [--segments 6] [--sha256 <hex>]
// Splits the file into byte ranges downloaded in parallel, resumes each segment after any error (every error is
// retried), reuses an existing "<dest>.part" prefix, verifies the final size (and sha256 when given), then renames
// into place. Used by setup-workspace for models; nothing is downloaded at render time.
import fs from 'node:fs';
import crypto from 'node:crypto';

const [url, dest] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SEG = +opt('--segments', 6), SHA = opt('--sha256', null);
if (!url || !dest) { console.error('usage: node tools/fetch-model.mjs <url> <dest> [--segments 6] [--sha256 hex]'); process.exit(2); }
if (fs.existsSync(dest)) { console.log(`exists: ${dest}`); process.exit(0); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// one downloader per file: two processes appending to the same segment files would corrupt them
const LOCK = `${dest}.lock`;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
try { const pid = +fs.readFileSync(LOCK, 'utf8'); if (pid && pid !== process.pid && alive(pid)) { console.error(`another downloader (pid ${pid}) is already fetching ${dest}`); process.exit(3); } } catch {}
fs.writeFileSync(LOCK, String(process.pid));
const unlock = () => { try { if (+fs.readFileSync(LOCK, 'utf8') === process.pid) fs.rmSync(LOCK); } catch {} };
process.on('exit', unlock); for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(130));

async function size() {
  for (let i = 0; ; i++) {
    try { const r = await fetch(url, { method: 'HEAD', redirect: 'follow' }); const n = +r.headers.get('content-length'); if (r.ok && n > 0) return n; throw new Error(`HEAD ${r.status}`); }
    catch (e) { if (i > 20) throw e; await sleep(2000); }
  }
}
const total = await size(), segSize = Math.ceil(total / SEG);
const segs = Array.from({ length: SEG }, (_, k) => ({ k, from: k * segSize, to: Math.min(total, (k + 1) * segSize) - 1, file: `${dest}.seg${k}` }));
// reuse a contiguous .part from a previous single-stream download as the beginning of segment 0
if (fs.existsSync(`${dest}.part`) && !fs.existsSync(segs[0].file)) {
  const n = fs.statSync(`${dest}.part`).size;
  if (n <= segSize) fs.renameSync(`${dest}.part`, segs[0].file); else { fs.copyFileSync(`${dest}.part`, segs[0].file); fs.truncateSync(segs[0].file, segSize); fs.rmSync(`${dest}.part`); }
}
const have = (s) => (fs.existsSync(s.file) ? fs.statSync(s.file).size : 0);
const want = (s) => s.to - s.from + 1;
let lastPrint = 0; const t0 = Date.now(), start = segs.reduce((a, s) => a + have(s), 0);
function report(force) {
  const now = Date.now(); if (!force && now - lastPrint < 5000) return; lastPrint = now;
  const got = segs.reduce((a, s) => a + have(s), 0), rate = (got - start) / Math.max(1, (now - t0) / 1000);
  console.log(`@@PROGRESS ${JSON.stringify({ current: got, total, unit: 'byte', message: `${(got / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB · ${(rate / 1024).toFixed(0)} KB/s` })}`);
}
async function runSeg(s) {
  for (let attempt = 0; have(s) < want(s); attempt++) {
    const off = s.from + have(s);
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${off}-${s.to}` }, redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
      if (r.status !== 206) throw new Error(`range not honoured (HTTP ${r.status})`);
      const out = fs.createWriteStream(s.file, { flags: 'a' });
      try { for await (const chunk of r.body) { if (!out.write(chunk)) await new Promise((res) => out.once('drain', res)); report(); } }
      finally { await new Promise((res) => out.end(res)); }
    } catch (e) { if (attempt % 5 === 4) console.log(`segment ${s.k}: retrying after ${e.message}`); await sleep(Math.min(15000, 1000 * (attempt + 1))); }
  }
  if (have(s) > want(s)) throw new Error(`segment ${s.k} overran`);
}
await Promise.all(segs.map(runSeg));
report(true);
const tmp = `${dest}.joined`, out = fs.createWriteStream(tmp);
const hash = crypto.createHash('sha256');
for (const s of segs) { for await (const c of fs.createReadStream(s.file)) { hash.update(c); if (!out.write(c)) await new Promise((r) => out.once('drain', r)); } }
await new Promise((r) => out.end(r));
if (fs.statSync(tmp).size !== total) throw new Error('size mismatch after join');
const digest = hash.digest('hex');
if (SHA && digest !== SHA.toLowerCase()) throw new Error(`sha256 mismatch: ${digest}`);
fs.renameSync(tmp, dest); for (const s of segs) fs.rmSync(s.file, { force: true });
console.log(`@@RESULT ${JSON.stringify({ dest, bytes: total, sha256: digest, seconds: Math.round((Date.now() - t0) / 1000) })}`);
console.log(`done: ${dest} (${(total / 1048576).toFixed(1)} MB, sha256 ${digest.slice(0, 16)}…)`);
