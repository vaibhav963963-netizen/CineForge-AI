// Download manager: queue with a concurrency limit, streamed writes to "<dest>.part", HTTP Range resume when the server
// honours it (and an honest restart from zero when it does not), every redirect hop checked against the trusted-host
// allowlist, idle timeout, exponential backoff, disk-space precheck, size + SHA-256/512 verification, then an atomic
// rename that never destroys a working file before the new one is verified. State persists in
// logs/setup/downloads.json; after a restart, interrupted downloads come back as "paused" with their partial size.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { isTrustedUrl } from './registry.js';
import { logEvent, newId, readJson, writeJsonAtomic, redact } from './log.js';

const ACTIVE = ['queued', 'downloading', 'verifying'];
const sleep = (ms, signal) => new Promise((res) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true }); });

export class DownloadError extends Error { constructor(msg, { retry = false, code } = {}) { super(msg); this.retry = retry; this.code = code; } }

export class DownloadManager extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.stateFile        persisted queue
   * @param {string[]} o.trustedHosts   allowlist (every redirect hop must match)
   * @param {string[]} o.allowedRoots   destinations must resolve inside one of these folders
   * @param {() => number} [o.concurrency]
   * @param {boolean} [o.allowHttp]     tests only: permit http://127.0.0.1
   * @param {number} [o.idleTimeoutMs] [o.maxAttempts] [o.backoffBaseMs] [o.marginBytes]
   * @param {(dir:string)=>number|null} [o.freeBytes]  injectable for tests
   */
  constructor(o) {
    super();
    this.o = { concurrency: () => 2, idleTimeoutMs: 60_000, maxAttempts: 8, backoffBaseMs: 2000, marginBytes: 512 * 1048576, allowHttp: false, freeBytes: defaultFree, ...o };
    this.items = new Map(); this.ctrl = new Map(); this.waiters = new Map(); this.lastSave = 0;
    const saved = readJson(this.o.stateFile, { items: [] });
    for (const it of saved.items || []) {
      // a download that was running when the server stopped: keep the .part, let the user resume (we re-check
      // Range support then, because the server may have changed)
      if (ACTIVE.includes(it.status)) { it.status = 'paused'; it.note = 'Interrupted (dashboard stopped). Resume to continue from the partial file.'; it.speed = 0; }
      if (it.status !== 'completed') it.bytes = partSize(it.dest);
      this.items.set(it.id, it);
    }
    this.save(true);
  }

  trusted(url) {
    if (this.o.allowHttp) { try { const u = new URL(url); if (u.protocol === 'http:' && this.o.trustedHosts.includes(u.hostname)) return true; } catch {} }
    return isTrustedUrl(url, this.o.trustedHosts);
  }
  insideRoots(dest) {
    const abs = path.resolve(dest);
    return this.o.allowedRoots.some((r) => { const rel = path.relative(path.resolve(r), abs); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); });
  }

  list() { return [...this.items.values()].map((i) => this.view(i)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id) { const i = this.items.get(id); return i ? this.view(i) : null; }
  view(i) {
    const bytes = i.status === 'completed' && i.total ? i.total : i.bytes;
    return { ...i, bytes, url: redact(i.url), percent: i.total ? Math.min(100, +(100 * bytes / i.total).toFixed(1)) : null };
  }
  activeFor(dest) { const d = path.resolve(dest).toLowerCase(); return [...this.items.values()].find((i) => i.dest.toLowerCase() === d && (ACTIVE.includes(i.status) || i.status === 'paused')); }

  /** Queue a download. Returns the existing item for a duplicate request (same destination, still active). */
  add({ url, dest, size = null, sha256 = null, sha512b64 = null, componentId = null, label = null, opId = null }) {
    if (!this.trusted(url)) throw new DownloadError(`refused: ${new URL(url).hostname} is not a trusted download source`, { code: 'untrusted-url' });
    if (!this.insideRoots(dest)) throw new DownloadError('refused: destination is outside the allowed folders', { code: 'bad-destination' });
    if (sha256 && !/^[0-9a-f]{64}$/i.test(sha256)) throw new DownloadError('invalid sha256', { code: 'bad-checksum' });
    const dup = this.activeFor(dest);
    if (dup) { if (dup.status === 'paused') this.resume(dup.id); return this.view(dup); }
    const it = { id: newId('dl'), componentId, opId, label: label || path.basename(dest), url, host: new URL(url).hostname, dest: path.resolve(dest), size, sha256: sha256 && sha256.toLowerCase(), sha512b64,
      status: 'queued', bytes: partSize(dest), total: size, speed: 0, eta: null, resumable: null, attempts: 0, error: null, note: null,
      createdAt: new Date().toISOString(), startedAt: null, completedAt: null, finalHost: null };
    this.items.set(it.id, it); this.changed(it, true);
    logEvent({ kind: 'download', action: 'queued', dlId: it.id, componentId, opId, url, dest: it.dest, size });
    this.pump();
    return this.view(it);
  }

  /** Resolves when the item completes; rejects on failure/cancel. */
  wait(id) {
    const it = this.items.get(id); if (!it) return Promise.reject(new Error('unknown download'));
    if (it.status === 'completed') return Promise.resolve(this.view(it));
    if (['failed', 'cancelled'].includes(it.status)) return Promise.reject(new DownloadError(it.error || it.status, { code: it.status }));
    return new Promise((res, rej) => { const l = this.waiters.get(id) || []; l.push({ res, rej }); this.waiters.set(id, l); });
  }
  settle(it) {
    const l = this.waiters.get(it.id); if (!l) return; this.waiters.delete(it.id);
    for (const w of l) it.status === 'completed' ? w.res(this.view(it)) : w.rej(new DownloadError(it.error || it.status, { code: it.status }));
  }

  pause(id) {
    const it = this.items.get(id); if (!it) return null;
    if (it.status === 'queued') { it.status = 'paused'; this.changed(it, true); }
    else if (it.status === 'downloading') { it.pauseRequested = true; this.ctrl.get(id)?.abort(); }
    return this.view(it);
  }
  resume(id) {
    const it = this.items.get(id); if (!it || !['paused', 'failed', 'cancelled'].includes(it.status)) return it ? this.view(it) : null;
    Object.assign(it, { status: 'queued', error: null, note: null, attempts: 0, bytes: partSize(it.dest) }); this.changed(it, true); this.pump();
    return this.view(it);
  }
  retry(id) { return this.resume(id); }
  cancel(id) {
    const it = this.items.get(id); if (!it) return null;
    if (it.status === 'downloading') { it.cancelRequested = true; this.ctrl.get(id)?.abort(); }
    else if (['queued', 'paused', 'failed'].includes(it.status)) { rmPart(it.dest); Object.assign(it, { status: 'cancelled', bytes: 0, speed: 0 }); this.changed(it, true); this.settle(it); }
    return this.view(it);
  }
  /** Delete the partial file and forget the entry (only for items that are not running). */
  remove(id) {
    const it = this.items.get(id); if (!it) return false;
    if (['downloading', 'verifying'].includes(it.status)) throw new DownloadError('pause or cancel the download first', { code: 'busy' });
    if (it.status !== 'completed') rmPart(it.dest);
    this.items.delete(id); this.save(true); this.emit('change', { id, removed: true });
    return true;
  }

  changed(it, force = false) { this.emit('change', this.view(it)); this.save(force); }
  save(force) {
    const now = Date.now(); if (!force && now - this.lastSave < 2000) return; this.lastSave = now;
    const items = [...this.items.values()].map(({ pauseRequested, cancelRequested, ...rest }) => rest);
    try { writeJsonAtomic(this.o.stateFile, { savedAt: new Date().toISOString(), items }); } catch {}
  }

  pump() {
    const running = [...this.items.values()].filter((i) => i.status === 'downloading' || i.status === 'verifying').length;
    let slots = Math.max(0, this.o.concurrency() - running);
    for (const it of [...this.items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (!slots) break;
      if (it.status === 'queued') { slots--; this.run(it); }
    }
  }

  async run(it) {
    it.status = 'downloading'; it.startedAt ||= new Date().toISOString(); it.pauseRequested = it.cancelRequested = false; this.changed(it, true);
    try {
      await this.transfer(it);
      it.status = 'verifying'; it.speed = 0; this.changed(it, true);
      await this.verifyAndPlace(it);
      Object.assign(it, { status: 'completed', completedAt: new Date().toISOString(), eta: 0 });
      logEvent({ kind: 'download', action: 'completed', dlId: it.id, componentId: it.componentId, opId: it.opId, bytes: it.bytes, resumable: it.resumable });
    } catch (e) {
      if (it.cancelRequested) { rmPart(it.dest); Object.assign(it, { status: 'cancelled', bytes: 0, error: null }); logEvent({ kind: 'download', action: 'cancelled', dlId: it.id, componentId: it.componentId }); }
      else if (it.pauseRequested) { Object.assign(it, { status: 'paused', note: it.resumable === false ? 'Paused. This server does not support resuming: the download will restart from zero.' : 'Paused.' }); logEvent({ kind: 'download', action: 'paused', dlId: it.id, bytes: it.bytes }); }
      else { Object.assign(it, { status: 'failed', error: e.message }); logEvent({ kind: 'download', action: 'failed', dlId: it.id, componentId: it.componentId, opId: it.opId, error: e.message, recovery: 'Retry resumes from the partial file when the server supports it.' }); }
    } finally {
      it.speed = 0; this.ctrl.delete(it.id); this.changed(it, true);
      // a paused item keeps its waiters (an install step waits until it is resumed or cancelled)
      if (['completed', 'failed', 'cancelled'].includes(it.status)) this.settle(it);
      this.pump();
    }
  }

  /** Free-space check before each attempt: remaining bytes + margin must fit. */
  checkSpace(it) {
    const need = (it.total || it.size || 0) - partSize(it.dest);
    const free = this.o.freeBytes(path.dirname(it.dest));
    if (free != null && need > 0 && free < need + this.o.marginBytes)
      throw new DownloadError(`Insufficient storage: ${fmt(need)} needed (+${fmt(this.o.marginBytes)} margin), ${fmt(free)} free on ${path.parse(it.dest).root}`, { code: 'insufficient-storage' });
  }

  async open(it, from, signal, range = null) {
    let url = it.url;
    for (let hop = 0; hop < 8; hop++) {
      if (!this.trusted(url)) throw new DownloadError(`refused redirect to untrusted host ${new URL(url).hostname}`, { code: 'untrusted-redirect' });
      const r = await fetch(url, { headers: { ...(range ? { Range: range } : from > 0 ? { Range: `bytes=${from}-` } : {}), 'User-Agent': 'CineForge-Setup/1.0', 'Accept-Encoding': 'identity' }, redirect: 'manual', signal });
      if ([301, 302, 303, 307, 308].includes(r.status)) { const loc = r.headers.get('location'); try { await r.body?.cancel(); } catch {} if (!loc) throw new DownloadError('redirect without location', { retry: true }); url = new URL(loc, url).toString(); continue; }
      it.finalHost = new URL(url).hostname;
      return r;
    }
    throw new DownloadError('too many redirects');
  }

  /**
   * Large files from servers that honour Range are fetched as N parallel byte ranges ("<dest>.seg<k>"), each resumed
   * independently, then joined into "<dest>.part". Throttled per-connection links (common for HF/GitHub CDNs) get
   * close to N× the throughput. The layout is persisted in the item so a restart resumes the same segments.
   */
  async transfer(it) {
    const want = this.o.segments ? this.o.segments() : 1;
    if (!it.segments && want > 1 && it.size && it.size >= (this.o.segmentMinBytes ?? 64 * 1048576) && partSize(it.dest) === 0) {
      const ac = new AbortController(); this.ctrl.set(it.id, ac);
      try { const r = await this.open(it, 0, ac.signal, 'bytes=0-0'); await r.body?.cancel(); if (r.status === 206) { it.segments = want; it.resumable = true; } else it.resumable = false; }
      catch (e) { if (it.pauseRequested || it.cancelRequested) throw e; }
    }
    if (it.segments > 1) return this.transferSegmented(it);
    return this.transferSingle(it);
  }

  async transferSegmented(it) {
    const total = it.total = it.size, N = it.segments, segSize = Math.ceil(total / N);
    const segs = Array.from({ length: N }, (_, k) => ({ k, from: k * segSize, to: Math.min(total, (k + 1) * segSize) - 1, file: `${it.dest}.seg${k}` }));
    const have = (s) => { try { return fs.statSync(s.file).size; } catch { return 0; } };
    const need = (s) => s.to - s.from + 1;
    const ac = new AbortController(); this.ctrl.set(it.id, ac);
    this.checkSpace(it);
    fs.mkdirSync(path.dirname(it.dest), { recursive: true });
    let winBytes = 0, winStart = Date.now();
    const runSeg = async (s) => {
      for (let attempt = 0; have(s) < need(s); attempt++) {
        if (ac.signal.aborted) throw ac.signal.reason || new Error('aborted');
        const off = s.from + have(s);
        try {
          const r = await this.open(it, null, ac.signal, `bytes=${off}-${s.to}`);
          if (r.status !== 206) { await r.body?.cancel(); throw new DownloadError(`range not honoured (HTTP ${r.status})`, { code: 'no-range' }); }
          let left = need(s) - have(s);
          const out = fs.createWriteStream(s.file, { flags: 'a' }); let idle;
          const kick = () => { clearTimeout(idle); idle = setTimeout(() => { try { r.body.cancel(); } catch {} }, this.o.idleTimeoutMs); };
          try {
            kick();
            for await (let chunk of r.body) {
              kick();
              // a server that ignores the end of "bytes=a-b" must not spill into the next segment
              if (chunk.length > left) chunk = chunk.subarray(0, left);
              if (chunk.length && !out.write(chunk)) await new Promise((res) => out.once('drain', res));
              left -= chunk.length; it.bytes += chunk.length; winBytes += chunk.length;
              if (left <= 0) break;
              const dt = Date.now() - winStart;
              if (dt > 1000) { const inst = winBytes / (dt / 1000); it.speed = it.speed ? 0.7 * it.speed + 0.3 * inst : inst; winBytes = 0; winStart = Date.now(); it.eta = it.speed ? Math.round((total - it.bytes) / it.speed) : null; this.changed(it); }
            }
          } finally { clearTimeout(idle); await new Promise((res) => out.end(res)); }
        } catch (e) {
          if (ac.signal.aborted || it.pauseRequested || it.cancelRequested) throw e;
          if (e.code === 'no-range' || e.code === 'untrusted-redirect' || attempt + 1 >= this.o.maxAttempts * 3) throw e;
          it.note = `segment ${s.k + 1}/${N}: retrying after ${e.message}`; this.changed(it);
          await sleep(Math.min(30_000, this.o.backoffBaseMs * 2 ** Math.min(attempt, 4)), ac.signal);
        }
      }
      if (have(s) > need(s)) throw new DownloadError(`segment ${s.k + 1} overran its range`);
    };
    it.bytes = segs.reduce((a, s) => a + have(s), 0);
    try { await Promise.all(segs.map(runSeg)); }
    catch (e) { ac.abort(); throw e; }
    // join → .part (verified by the caller), then drop the segments
    const out = fs.createWriteStream(`${it.dest}.part`);
    for (const s of segs) for await (const c of fs.createReadStream(s.file, { highWaterMark: 1 << 20 })) if (!out.write(c)) await new Promise((r) => out.once('drain', r));
    await new Promise((r) => out.end(r));
    for (const s of segs) fs.rmSync(s.file, { force: true });
  }

  async transferSingle(it) {
    for (it.attempts = it.attempts || 0; ; it.attempts++) {
      const ac = new AbortController(); this.ctrl.set(it.id, ac);
      try {
        this.checkSpace(it);
        let from = partSize(it.dest);
        if (it.total && from === it.total) return;            // already complete (e.g. after a crash before rename)
        const r = await this.open(it, from, ac.signal);
        let append = false;
        if (r.status === 206) {
          const cr = r.headers.get('content-range') || '', m = cr.match(/bytes (\d+)-(\d+)\/(\d+|\*)/);
          if (!m || +m[1] !== from) { await r.body?.cancel(); throw new DownloadError(`server returned an unexpected range (${cr})`, { retry: true }); }
          if (m[3] !== '*') it.total = +m[3];
          it.resumable = true; append = true;
        } else if (r.status === 200) {
          if (from > 0) { it.resumable = false; it.note = 'Server ignored the resume request: restarting from zero.'; logEvent({ kind: 'download', action: 'range-unsupported', dlId: it.id, host: it.finalHost }); }
          else if (it.resumable == null) it.resumable = /bytes/i.test(r.headers.get('accept-ranges') || '');
          const len = +r.headers.get('content-length'); if (len > 0) it.total = len;
          from = 0;
        } else if (r.status === 416) {
          await r.body?.cancel();
          rmPart(it.dest); throw new DownloadError('partial file is larger than the source: discarded, restarting', { retry: true });
        } else {
          await r.body?.cancel();
          const retry = r.status >= 500 || r.status === 408 || r.status === 429;
          throw new DownloadError(`HTTP ${r.status} from ${it.finalHost}`, { retry, code: `http-${r.status}` });
        }
        if (it.size && it.total && it.total !== it.size) { await r.body?.cancel(); throw new DownloadError(`source size ${it.total} differs from the registry (${it.size}): refusing a possibly different file`, { code: 'size-mismatch' }); }
        this.checkSpace(it);
        fs.mkdirSync(path.dirname(it.dest), { recursive: true });
        const out = fs.createWriteStream(`${it.dest}.part`, { flags: append ? 'a' : 'w' });
        it.bytes = from; let winBytes = 0, winStart = Date.now(), idle;
        const kick = () => { clearTimeout(idle); idle = setTimeout(() => ac.abort(new DownloadError('no data received for ' + this.o.idleTimeoutMs / 1000 + ' s', { retry: true })), this.o.idleTimeoutMs); };
        try {
          kick();
          for await (const chunk of r.body) {
            kick();
            if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
            it.bytes += chunk.length; winBytes += chunk.length;
            const dt = Date.now() - winStart;
            if (dt > 1000) { const inst = winBytes / (dt / 1000); it.speed = it.speed ? 0.7 * it.speed + 0.3 * inst : inst; winBytes = 0; winStart = Date.now(); it.eta = it.total && it.speed ? Math.round((it.total - it.bytes) / it.speed) : null; this.changed(it); }
          }
        } finally { clearTimeout(idle); await new Promise((res) => out.end(res)); }
        if (it.total && it.bytes < it.total) throw new DownloadError(`connection closed at ${it.bytes} of ${it.total} bytes`, { retry: true });
        return;
      } catch (e) {
        if (it.pauseRequested || it.cancelRequested) throw e;
        const err = ac.signal.aborted && ac.signal.reason instanceof DownloadError ? ac.signal.reason : e;
        const retry = err instanceof DownloadError ? err.retry : true;      // network errors (TypeError: fetch failed) retry
        if (!retry || it.attempts + 1 >= this.o.maxAttempts) throw err instanceof DownloadError ? err : new DownloadError(`${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''}`);
        const wait = Math.min(60_000, this.o.backoffBaseMs * 2 ** it.attempts);
        it.note = `Attempt ${it.attempts + 1} failed (${err.message}${err.cause?.code ? ` ${err.cause.code}` : ''}); retrying in ${Math.round(wait / 1000)} s`;
        this.changed(it, true);
        logEvent({ kind: 'download', action: 'retry', dlId: it.id, attempt: it.attempts + 1, error: err.message, waitMs: wait });
        const w = new AbortController(); this.ctrl.set(it.id, w); await sleep(wait, w.signal);
        if (it.pauseRequested || it.cancelRequested) throw err;
      }
    }
  }

  async verifyAndPlace(it) {
    const part = `${it.dest}.part`, st = fs.statSync(part);
    if (it.size && st.size !== it.size) { rmPart(it.dest); throw new DownloadError(`size ${st.size} ≠ expected ${it.size}: partial file discarded`); }
    if (it.sha256 || it.sha512b64) {
      const algo = it.sha256 ? 'sha256' : 'sha512', h = crypto.createHash(algo);
      for await (const c of fs.createReadStream(part, { highWaterMark: 1 << 20 })) h.update(c);
      const got = it.sha256 ? h.digest('hex') : h.digest('base64'), want = it.sha256 || it.sha512b64;
      if (got !== want) { rmPart(it.dest); throw new DownloadError(`${algo.toUpperCase()} mismatch (got ${got.slice(0, 16)}…): corrupted or tampered file discarded`, { code: 'checksum-mismatch' }); }
      it.verified = algo;
    } else it.verified = 'size';
    // keep a working file until the new one is in place
    const old = `${it.dest}.old`;
    if (fs.existsSync(it.dest)) fs.renameSync(it.dest, old);
    try { fs.renameSync(part, it.dest); } catch (e) { if (fs.existsSync(old)) fs.renameSync(old, it.dest); throw e; }
    fs.rmSync(old, { force: true });
  }
}

// bytes on disk for an unfinished download: the single-stream .part plus any parallel segments
function partSize(dest) { let n = 0; for (const f of partFiles(dest)) { try { n += fs.statSync(f).size; } catch {} } return n; }
function partFiles(dest) { const dir = path.dirname(dest), base = path.basename(dest); let ents = []; try { ents = fs.readdirSync(dir); } catch {} return ents.filter((e) => e === base + '.part' || (e.startsWith(base + '.seg') && /^\d+$/.test(e.slice(base.length + 4)))).map((e) => path.join(dir, e)); }
function rmPart(dest) { for (const f of partFiles(dest)) { try { fs.rmSync(f, { force: true }); } catch {} } }
function defaultFree(dir) {
  let d = dir; while (!fs.existsSync(d)) { const up = path.dirname(d); if (up === d) return null; d = up; }
  try { const s = fs.statfsSync(d); return s.bavail * s.bsize; } catch { return null; }
}

function fmt(b) { return b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b + ' bytes'; }
