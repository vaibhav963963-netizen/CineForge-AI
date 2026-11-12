// Installation manager. Runs one operation at a time (install / repair / update / verify / remove), expands
// prerequisites in registry order, reuses components that already pass detection, and executes only the step types
// defined here. Every command is spawned with an argument array (no shell), arguments come from the registry, never
// from the request. Each operation is persisted to logs/setup/ops/<opId>.json with a timestamped log and survives
// restarts (a running op becomes "interrupted" with a repair hint).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ROOT, childEnv } from '../workspace.js';
import { loadRegistry, baseVars, resolvePath, resolveStr, resolvedFiles, installSteps, topoOrder, isInstallable } from './registry.js';
import { detectComponent, findBasePython } from './detect.js';
import { hashFile } from './hashcache.js';
import { logEvent, newId, readJson, writeJsonAtomic, SETUP_DIR } from './log.js';
import { killTree } from '../jobs.js';
import { getSettings } from './settings.js';

export const OPS_DIR = path.join(SETUP_DIR, 'ops');
const DONE = ['completed', 'failed', 'cancelled', 'interrupted'];
const ACTIONS = ['install', 'repair', 'update', 'verify', 'remove'];
const OK = (s) => s === 'ready' || s === 'update-available';

export class InstallManager extends EventEmitter {
  constructor({ downloads, profile, isBusy = () => null, onStatus = () => {}, system = () => null, registry = loadRegistry() }) {
    super();
    Object.assign(this, { dm: downloads, profile, isBusy, onStatus, system, reg: registry });
    this.queue = []; this.current = null; this.ops = new Map();
    fs.mkdirSync(OPS_DIR, { recursive: true });
    for (const f of fs.readdirSync(OPS_DIR).filter((x) => x.endsWith('.json')).sort().slice(-200)) {
      const op = readJson(path.join(OPS_DIR, f), null); if (!op) continue;
      if (!DONE.includes(op.status)) { op.status = 'interrupted'; op.endedAt = new Date().toISOString(); op.error = 'The dashboard stopped while this operation was running.'; op.recovery = 'Run Repair on the affected component; downloads resume from their partial files.'; this.persist(op); }
      this.ops.set(op.id, op);
    }
    // leftover extraction folders from an interrupted op
    try { const tmp = baseVars().tmp; for (const d of fs.readdirSync(tmp)) if (d.startsWith('staging-')) fs.rmSync(path.join(tmp, d), { recursive: true, force: true }); } catch {}
  }

  list(limit = 50) { return [...this.ops.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((o) => this.view(o)); }
  get(id) { const o = this.ops.get(id); return o ? this.view(o, true) : null; }
  view(o, full = false) { const { log, ...rest } = o; return full ? o : { ...rest, logTail: log.slice(-12) }; }
  activeFor(id) { return [...this.ops.values()].find((o) => !DONE.includes(o.status) && o.componentIds.includes(id)); }
  persist(op) { try { writeJsonAtomic(path.join(OPS_DIR, `${op.id}.json`), op); } catch {} }

  /** Plan without running: which components will be touched, download bytes, blockers. */
  plan(action, ids, statuses) {
    if (!ACTIONS.includes(action)) throw Object.assign(new Error(`unknown action ${action}`), { status: 400 });
    for (const id of ids) if (!this.reg.byId.has(id)) throw Object.assign(new Error(`unknown component ${id}`), { status: 404 });
    let order = ids;
    if (action === 'install' || action === 'repair') {
      order = topoOrder(this.reg.components, [...ids]).filter((id) => ids.includes(id) || !OK(statuses[id]?.status));
      if (action === 'install') order = order.filter((id) => !OK(statuses[id]?.status));
    }
    const blockers = [], manual = [];
    let downloadBytes = 0, diskBytes = 0;
    for (const id of order) {
      const c = this.reg.byId.get(id);
      if (action === 'remove' && c.category !== 'models') blockers.push(`${c.name}: only model files can be removed from here`);
      if (['install', 'repair', 'update'].includes(action) && !isInstallable(c)) { manual.push({ id, name: c.name, instructions: c.install?.instructions || 'Manual installation required.' }); continue; }
      if (['install', 'repair', 'update'].includes(action)) {
        if (c.install.type === 'files') { const st = statuses[id]; for (const f of resolvedFiles(c)) { const s = st?.files?.find((x) => x.path === f.path); if (action !== 'install' || !s || !s.exists || ['size-mismatch', 'hash-mismatch'].includes(s.integrity)) { downloadBytes += Math.max(0, (f.size || 0) - (s?.partialBytes || 0)); diskBytes += f.size || 0; } } }
        else { for (const s of installSteps(c, this.profile()) || []) if (s.op === 'download') downloadBytes += s.size || 0; diskBytes += c.diskBytes || 0; }
      }
    }
    return { action, componentIds: order, manual, blockers, downloadBytes, diskBytes };
  }

  submit(action, ids, statuses, { confirmed = false } = {}) {
    const busy = action !== 'verify' && this.isBusy();
    if (busy) throw Object.assign(new Error(`${busy} — install, repair and update wait until it finishes, so files in use are not replaced.`), { status: 409 });
    const plan = this.plan(action, ids, statuses);
    if (plan.blockers.length) throw Object.assign(new Error(plan.blockers.join('; ')), { status: 422 });
    if (['update', 'remove'].includes(action) && !confirmed) throw Object.assign(new Error(`${action} needs confirmation`), { status: 428, plan });
    const dup = plan.componentIds.map((id) => this.activeFor(id)).find(Boolean);
    if (dup) return { op: this.view(dup), deduplicated: true };
    if (!plan.componentIds.length && !plan.manual.length) throw Object.assign(new Error('Nothing to do: every selected component already passes its checks.'), { status: 409 });
    const op = { id: newId('op'), action, requested: ids, componentIds: plan.componentIds.filter((id) => !plan.manual.some((m) => m.id === id)), manual: plan.manual,
      status: 'queued', current: null, stage: null, progress: null, results: {}, createdAt: new Date().toISOString(), startedAt: null, endedAt: null, error: null, recovery: null, log: [], profile: this.profile() };
    this.ops.set(op.id, op); this.persist(op); this.queue.push(op); this.emit('change', this.view(op));
    logEvent({ kind: 'install', action: 'queued', opId: op.id, op: action, components: op.componentIds });
    this.next();
    return { op: this.view(op), deduplicated: false };
  }

  cancel(id) {
    const op = this.ops.get(id); if (!op || DONE.includes(op.status)) return op ? this.view(op) : null;
    op.cancelRequested = true;
    if (op.status === 'queued') { this.queue = this.queue.filter((o) => o !== op); this.finish(op, 'cancelled'); }
    else { if (this.child) killTree(this.child); if (this.currentDownload) this.dm.cancel(this.currentDownload); this.hashAbort?.abort(); }
    return this.view(op);
  }

  log(op, line, extra = {}) {
    const rec = { ts: new Date().toISOString(), msg: String(line).slice(0, 600) }; op.log.push(rec); if (op.log.length > 2000) op.log.splice(0, op.log.length - 2000);
    logEvent({ kind: 'install', opId: op.id, componentId: op.current, stage: op.stage, msg: rec.msg, ...extra });
    this.tick(op);
  }
  tick(op, force = false) { const now = Date.now(); if (force || !op._t || now - op._t > 400) { op._t = now; this.emit('change', this.view(op)); } if (force || !op._p || now - op._p > 3000) { op._p = now; this.persist(op); } }
  finish(op, status, error = null, recovery = null) {
    Object.assign(op, { status, error, recovery, endedAt: new Date().toISOString(), current: null, stage: null }); delete op.cancelRequested;
    logEvent({ kind: 'install', action: status, opId: op.id, op: op.action, error, recovery });
    this.persist(op); this.tick(op, true);
  }

  async next() {
    if (this.current || !this.queue.length) return;
    const op = this.current = this.queue.shift();
    op.status = 'running'; op.startedAt = new Date().toISOString(); this.tick(op, true);
    try {
      for (const id of op.componentIds) {
        if (op.cancelRequested) throw Object.assign(new Error('cancelled'), { cancelled: true });
        const c = this.reg.byId.get(id); op.current = id; op.stage = 'starting'; op.progress = null;
        this.log(op, `── ${op.action} ${c.name}`);
        await this.runComponent(op, c);
        op.results[id] = { status: 'done', at: new Date().toISOString() };
      }
      this.finish(op, 'completed');
    } catch (e) {
      if (op.cancelRequested || e.cancelled) this.finish(op, 'cancelled', null, 'Partial downloads were removed. Installed components that already passed verification were kept.');
      else { if (op.current) op.results[op.current] = { status: 'failed', error: e.message }; this.log(op, `✖ ${e.message}`); this.finish(op, 'failed', e.message, e.recovery || recoveryHint(e.message)); }
    } finally { this.current = null; this.child = null; this.currentDownload = null; this.next(); }
  }

  async runComponent(op, c) {
    const vars = baseVars();
    if (op.action === 'verify') return this.verify(op, c, vars);
    if (op.action === 'remove') return this.remove(op, c, vars);
    if (c.install.type === 'files') {
      const force = op.action !== 'install';
      const st = await detectComponent(c, { system: this.system(), vars });
      const jobs = [];
      for (const f of resolvedFiles(c, vars)) {
        const s = st.files?.find((x) => x.path === f.path);
        const needs = force ? !(s?.exists && s.integrity === 'verified') : !s?.exists || ['size-mismatch', 'hash-mismatch'].includes(s.integrity);
        if (!needs) { this.log(op, `✓ ${f.path} already present`); continue; }
        if (!f.url) throw new Error(`${f.path} has no download source`);
        if (!getSettings().allowDownloads) throw Object.assign(new Error(`${f.path} must be downloaded, but downloads are disabled (offline mode)`), { recovery: 'Enable downloads in Advanced, or use "Import local file" on the AI Models tab.' });
        const dl = this.dm.add({ url: f.url, dest: f.abs, size: f.size, sha256: f.sha256, componentId: c.id, opId: op.id });
        this.log(op, `↓ ${f.path} queued (${dl.id})`); jobs.push(dl.id);
      }
      await this.waitDownloads(op, jobs);
    } else {
      const steps = installSteps(c, op.profile);
      if (!steps) throw new Error(`${c.name} cannot be installed automatically`);
      for (let k = 0; k < steps.length; k++) { if (op.cancelRequested) throw Object.assign(new Error('cancelled'), { cancelled: true }); op.stage = `step ${k + 1}/${steps.length}: ${steps[k].op}`; await this.step(op, c, steps[k], vars); }
    }
    op.stage = 'verifying';
    const after = await detectComponent(c, { system: this.system(), vars });
    this.onStatus(c.id, after);
    if (!OK(after.status)) throw Object.assign(new Error(`${c.name} did not pass verification after install: ${after.problems.join('; ') || after.status}`), { recovery: 'Open Installation Logs for the command output, fix the cause, then Repair.' });
    this.log(op, `✓ ${c.name} verified (${after.version || after.status})`);
  }

  async waitDownloads(op, ids) {
    const total = () => ids.map((i) => this.dm.get(i)).filter(Boolean);
    const onChange = () => { const l = total(); const b = l.reduce((a, d) => a + (d.bytes || 0), 0), t = l.reduce((a, d) => a + (d.total || d.size || 0), 0); op.progress = { unit: 'byte', current: b, total: t || null }; op.stage = `downloading ${l.filter((d) => d.status === 'completed').length}/${l.length}`; this.tick(op); };
    this.dm.on('change', onChange);
    try { for (const id of ids) { this.currentDownload = id; await this.dm.wait(id); this.log(op, `✓ downloaded and verified ${this.dm.get(id)?.label}`); } }
    finally { this.dm.off('change', onChange); this.currentDownload = null; }
  }

  async step(op, c, s, vars) {
    const P = (x) => resolvePath(x, vars);
    switch (s.op) {
      case 'download': {
        // offline / cached install: an archive already in the download folder is reused when its checksum matches
        const to = P(s.to);
        if (fs.existsSync(to) && (!s.size || fs.statSync(to).size === s.size)) {
          const want = s.sha256 || s.sha512b64, got = await hashFile(to, { algo: s.sha256 ? 'sha256' : 'sha512', encoding: s.sha256 ? 'hex' : 'base64', useCache: false });
          if (got === want) { this.log(op, `✓ using cached ${path.basename(to)} (checksum matches, no download)`); return; }
          this.log(op, `cached ${path.basename(to)} does not match its checksum: downloading again`); fs.rmSync(to, { force: true });
        }
        if (!getSettings().allowDownloads) throw Object.assign(new Error(`${path.basename(to)} must be downloaded, but downloads are disabled (Advanced → offline mode)`), { recovery: `Enable downloads, or place the file in ${path.relative(ROOT, vars.tmp)} and Retry.` });
        const dl = this.dm.add({ url: s.url, dest: P(s.to), size: s.size || null, sha256: s.sha256 || null, sha512b64: s.sha512b64 || null, componentId: c.id, opId: op.id });
        this.log(op, `↓ ${path.basename(P(s.to))} from ${new URL(s.url).hostname}`);
        return this.waitDownloads(op, [dl.id]);
      }
      case 'extract': return this.extract(op, P(s.archive), s, vars);
      case 'delete-temp': { const f = P(s.path); if (isInside(f, vars.tmp)) fs.rmSync(f, { force: true }); return; }
      case 'venv': {
        const base = await this.basePython(vars);
        const target = P(s.target);
        if (fs.existsSync(path.join(target, 'pyvenv.cfg')) && op.action === 'install') this.log(op, 'existing environment found: upgrading in place');
        return this.exec(op, base, ['-m', 'venv', ...(fs.existsSync(path.join(target, 'pyvenv.cfg')) ? ['--upgrade'] : []), target]);
      }
      case 'pip': return this.exec(op, P(s.python), ['-m', 'pip', ...s.args.map((a) => resolveStr(a, vars)), '--progress-bar', 'off'], { pip: true });
      case 'git-or-archive': return this.gitOrArchive(op, s, vars);
      default: throw new Error(`step ${s.op} is not allowed`);
    }
  }

  async basePython(vars) {
    const c = this.reg.byId.get('python-base');
    const p = await findBasePython(c, vars);
    if (!p) throw Object.assign(new Error('No Python 3.12 base interpreter'), { recovery: 'Install "Python 3.12 (base interpreter)" first.' });
    return p.exe;
  }

  /** Extract with Windows' bsdtar into a private staging folder, then place files without deleting working copies first. */
  async extract(op, archive, s, vars) {
    const staging = path.join(vars.tmp, `staging-${op.id}`);
    fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging, { recursive: true });
    try {
      op.stage = `extracting ${path.basename(archive)}`;
      await this.exec(op, path.join(vars.system32, 'tar.exe'), ['-xf', archive, '-C', staging]);
      if (s.files) {
        for (const [from, to] of Object.entries(s.files)) {
          const src = path.resolve(staging, from), dst = resolvePath(to, vars);
          if (!isInside(src, staging)) throw new Error(`archive entry ${from} escapes the staging folder`);
          if (!fs.existsSync(src)) throw new Error(`archive does not contain ${from}`);
          replaceFile(src, dst); this.log(op, `  placed ${path.relative(ROOT, dst)}`);
        }
      } else {
        const src = path.resolve(staging, s.fromDir || ''), dst = resolvePath(s.toDir, vars);
        if (!isInside(src, staging) && src !== staging) throw new Error('fromDir escapes the staging folder');
        if (!fs.existsSync(src)) throw new Error(`archive does not contain ${s.fromDir}`);
        fs.mkdirSync(dst, { recursive: true });
        fs.cpSync(src, dst, { recursive: true, force: true });
        this.log(op, `  copied ${countFiles(src)} files to ${path.relative(ROOT, dst) || dst}`);
      }
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  }

  async gitOrArchive(op, s, vars) {
    const dst = resolvePath(s.toDir, vars);
    const git = await new Promise((res) => { const p = spawn('git', ['--version'], { windowsHide: true }); p.on('error', () => res(false)); p.on('close', (c) => res(c === 0)); });
    if (git && (!fs.existsSync(dst) || fs.existsSync(path.join(dst, '.git')) || fs.readdirSync(dst).every((x) => x === 'venv'))) {
      fs.mkdirSync(dst, { recursive: true });
      if (!fs.existsSync(path.join(dst, '.git'))) { await this.exec(op, 'git', ['-C', dst, 'init', '-q']); await this.exec(op, 'git', ['-C', dst, 'remote', 'add', 'origin', s.repo]); }
      await this.exec(op, 'git', ['-C', dst, 'fetch', '--depth', '1', 'origin', s.commit]);
      await this.exec(op, 'git', ['-C', dst, 'checkout', '--force', '-q', s.commit]);
      const head = await this.exec(op, 'git', ['-C', dst, 'rev-parse', 'HEAD'], { capture: true });
      if (head.trim() !== s.commit) throw new Error(`checked out ${head.trim()} instead of ${s.commit}`);
      this.log(op, `✓ ComfyUI at commit ${s.commit.slice(0, 8)} (git verified every object)`);
      return;
    }
    this.log(op, git ? 'existing non-git folder: using the commit archive' : 'Git not found: using the commit archive (no published checksum; the URL pins the commit)');
    const zip = path.join(vars.tmp, `comfyui-${s.commit.slice(0, 12)}.zip`);
    const dl = this.dm.add({ url: s.archive, dest: zip, componentId: op.current, opId: op.id });
    await this.waitDownloads(op, [dl.id]);
    await this.extract(op, zip, { fromDir: s.archiveRoot, toDir: s.toDir }, vars);
    fs.rmSync(zip, { force: true });
  }

  exec(op, cmd, args, { capture = false, pip = false } = {}) {
    return new Promise((resolve, reject) => {
      if (op.cancelRequested) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      const env = childEnv(); delete env.PYTHONHOME; delete env.PYTHONPATH; delete env.HF_HUB_OFFLINE; env.PIP_DISABLE_PIP_VERSION_CHECK = '1'; env.PIP_NO_INPUT = '1';
      this.log(op, `$ ${path.basename(cmd)} ${args.map((a) => (String(a).includes(ROOT) ? path.relative(ROOT, a) || '.' : a)).join(' ')}`);
      const child = this.child = spawn(cmd, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', lines = 0; const t0 = Date.now();
      const onData = (b) => { const s = b.toString('utf8'); if (capture) out += s; for (const l of s.split(/\r?\n/)) if (l.trim()) { lines++; this.log(op, `  ${l.trimEnd()}`); if (pip && /^(Collecting|Downloading|Installing|Successfully)/.test(l.trim())) op.progress = { unit: 'indeterminate', message: l.trim().slice(0, 140), elapsedSeconds: Math.round((Date.now() - t0) / 1000) }; } };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.on('error', (e) => reject(new Error(`${path.basename(cmd)} could not start: ${e.message}`)));
      child.on('close', (code) => {
        this.child = null;
        if (op.cancelRequested) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
        if (code === 0) return resolve(out);
        reject(new Error(`${path.basename(cmd)} exited with code ${code}`));
      });
    });
  }

  async verify(op, c, vars) {
    if (c.detect.type === 'files') {
      for (const f of resolvedFiles(c, vars)) {
        if (!fs.existsSync(f.abs)) { this.log(op, `✖ ${f.path} missing`); continue; }
        if (!f.sha256) { const ok = !f.size || fs.statSync(f.abs).size === f.size; this.log(op, `${ok ? '✓' : '✖'} ${f.path} size ${ok ? 'matches' : 'differs'} (no checksum published)`); continue; }
        op.stage = `hashing ${f.path}`; this.hashAbort = new AbortController();
        const h = await hashFile(f.abs, { useCache: false, signal: this.hashAbort.signal, onProgress: (d, t) => { op.progress = { unit: 'byte', current: d, total: t }; this.tick(op); } });
        this.log(op, `${h === f.sha256 ? '✓' : '✖'} ${f.path} SHA-256 ${h === f.sha256 ? 'matches' : 'MISMATCH'} (${f.checksumSource === 'tofu' ? 'recorded reference' : 'official reference'})`);
      }
    }
    const st = await detectComponent(c, { system: this.system(), vars });
    this.onStatus(c.id, st);
    this.log(op, `${OK(st.status) ? '✓' : '✖'} ${c.name}: ${st.status}${st.problems.length ? ' — ' + st.problems.join('; ') : ''}`);
  }

  async remove(op, c, vars) {
    for (const f of resolvedFiles(c, vars)) {
      for (const p of [f.abs, `${f.abs}.part`]) if (fs.existsSync(p)) { fs.rmSync(p, { force: true }); this.log(op, `removed ${path.relative(ROOT, p) || p}`); }
    }
    this.onStatus(c.id, await detectComponent(c, { system: this.system(), vars }));
  }
}

export function isInside(p, dir) { const r = path.relative(path.resolve(dir), path.resolve(p)); return !!r && !r.startsWith('..') && !path.isAbsolute(r); }
function replaceFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const old = `${dst}.old`;
  if (fs.existsSync(dst)) fs.renameSync(dst, old);
  try { fs.copyFileSync(src, dst); } catch (e) { if (fs.existsSync(old)) fs.renameSync(old, dst); throw e; }
  fs.rmSync(old, { force: true });
}
function countFiles(d) { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(d, e.name)) : 1; return n; }
function recoveryHint(msg) {
  if (/Insufficient storage/i.test(msg)) return 'Free disk space (Storage tab shows safe cleanups) or change the download folder, then Retry.';
  if (/EACCES|EPERM|permission/i.test(msg)) return 'A file is locked or not writable. Close programs using it (ComfyUI, llama-server, a running render) and Retry.';
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|no data received/i.test(msg)) return 'Network problem. Check the connection (Overview → Check network) and Retry; downloads resume where supported.';
  if (/mismatch/i.test(msg)) return 'The downloaded file did not match its published checksum and was discarded. Retry; if it repeats, the source changed — do not use a different mirror.';
  if (/Python 3\.12/.test(msg)) return 'Install "Python 3.12 (base interpreter)" first.';
  return 'See Installation Logs for the exact command output, then Repair.';
}
