// Setup service: one instance per server. Holds the last system scan and component statuses (persisted in
// logs/setup/last-scan.json so the UI shows them immediately after a restart), the download manager, the install
// manager, storage accounting and safe cleanup.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ROOT, PATHS } from '../workspace.js';
import { loadRegistry, baseVars, resolvedFiles } from './registry.js';
import { scanSystem, checkNetwork } from './system.js';
import { detectAll, detectComponent, featureReadiness, remainingBytes } from './detect.js';
import { DownloadManager } from './downloads.js';
import { InstallManager } from './installer.js';
import { runHealth } from './health.js';
import { getSettings, updateSettings, resolveProfile } from './settings.js';
import { SETUP_DIR, logEvent, readJson, writeJsonAtomic, newId } from './log.js';

const SCAN_FILE = path.join(SETUP_DIR, 'last-scan.json');

export class SetupService extends EventEmitter {
  constructor({ isBusy = () => null } = {}) {
    super();
    this.reg = loadRegistry();
    const last = readJson(SCAN_FILE, {});
    this.system = last.system || null; this.statuses = last.statuses || {}; this.lastScanAt = last.scannedAt || null;
    this.scan_ = null; this.health = readJson(path.join(SETUP_DIR, 'last-health.json'), null); this.network = null; this.isBusy = isBusy;
    const v = baseVars();
    this.dm = new DownloadManager({
      stateFile: path.join(SETUP_DIR, 'downloads.json'), trustedHosts: this.reg.trustedHosts,
      allowedRoots: [ROOT, v.tmp, ...Object.values(PATHS.models)], concurrency: () => getSettings().downloadConcurrency, segments: () => getSettings().downloadSegments,
    });
    this.im = new InstallManager({ downloads: this.dm, registry: this.reg, isBusy, system: () => this.system,
      profile: () => resolveProfile(this.system), onStatus: (id, st) => { this.statuses[id] = { ...st, checkedAt: new Date().toISOString() }; this.persist(); this.emit('status', { id }); } });
    this.dm.on('change', (d) => this.emit('download', d));
    this.im.on('change', (o) => this.emit('op', o));
  }

  persist() { try { writeJsonAtomic(SCAN_FILE, { scannedAt: this.lastScanAt, system: this.system, statuses: this.statuses }); } catch {} }

  /** Full scan in the background; concurrent callers share the same run. */
  scan({ only } = {}) {
    if (this.scan_) return this.scan_;
    const opId = newId('scan'), t0 = Date.now();
    this.scanning = { opId, startedAt: new Date().toISOString(), done: 0, total: only ? only.length : this.reg.components.length };
    this.emit('scan', this.scanning);
    this.scan_ = (async () => {
      try {
        this.system = await scanSystem();
        const st = await detectAll(this.system, { only });
        Object.assign(this.statuses, st);
        // only a full scan counts as "last full system scan"; component re-checks keep the old timestamp
        if (!only) this.lastScanAt = new Date().toISOString();
        this.persist();
        logEvent({ kind: 'scan', opId, ms: Date.now() - t0, summary: Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.status])) });
        return this.overview();
      } finally { this.scan_ = null; this.scanning = null; this.emit('scan', null); }
    })();
    return this.scan_;
  }
  async rescanComponent(id) { const c = this.reg.byId.get(id); if (!c) throw Object.assign(new Error('unknown component'), { status: 404 }); this.statuses[id] = { ...(await detectComponent(c, { system: this.system })), checkedAt: new Date().toISOString() }; this.persist(); return this.statuses[id]; }

  /** Live status = detected status overlaid with what is happening right now (downloading, installing, …). */
  liveStatus(id) {
    const st = this.statuses[id] || { status: 'not-checked', problems: [] };
    const op = this.im.activeFor(id);
    const dls = this.dm.list().filter((d) => d.componentId === id && ['queued', 'downloading', 'verifying', 'paused'].includes(d.status));
    let live = st.status;
    if (op && op.current === id) live = op.action === 'verify' ? 'verifying' : /download/.test(op.stage || '') ? 'downloading' : op.stage === 'verifying' ? 'verifying' : /extract|venv|pip|step/.test(op.stage || '') ? 'installing' : 'configuring';
    else if (op) live = 'queued';
    if (dls.some((d) => d.status === 'downloading')) live = 'downloading'; else if (!op && dls.some((d) => d.status === 'paused')) live = 'paused';
    if (live === 'not-installed') { const c = this.reg.byId.get(id); const need = remainingBytes(c, st); const free = this.system?.workspaceDisk?.freeBytes; if (free != null && need > free) live = 'insufficient-storage'; }
    const lastOp = this.im.list(100).find((o) => o.componentIds.includes(id));
    if (live === st.status && lastOp && ['failed', 'cancelled'].includes(lastOp.status) && st.status !== 'ready' && lastOp.endedAt > (st.checkedAt || '')) live = lastOp.status;
    return { ...st, live, opId: op?.id || null, downloads: dls.map((d) => d.id) };
  }

  components() {
    const s = getSettings();
    return this.reg.components.map((c) => {
      const st = this.liveStatus(c.id);
      let files = []; try { files = c.detect.type === 'files' ? resolvedFiles(c) : []; } catch {}
      const sizeBytes = files.reduce((a, f) => a + (f.size || 0), 0) || null;
      const { install, detect, ...meta } = c;
      return { ...meta, installType: install?.type || (install?.steps || install?.variants ? 'automatic' : 'none'), instructions: install?.instructions || null,
        variants: install?.variants ? Object.keys(install.variants) : null, sizeBytes, downloadBytes: remainingBytes(c, st), location: st.location || (c.detect.base ? (() => { try { return resolvedFiles(c)[0]?.abs && path.dirname(resolvedFiles(c)[0].abs); } catch { return null; } })() : null), state: st, profile: resolveProfile(this.system, s.hardwareProfile) };
    });
  }

  overview() {
    const comps = this.components(), by = (f) => comps.filter(f);
    const required = by((c) => c.level === 'required');
    const ok = (c) => ['ready', 'update-available'].includes(c.state.status);
    const missingReq = required.filter((c) => !ok(c));
    const totalDownload = comps.filter((c) => c.level !== 'optional' && !ok(c)).reduce((a, c) => a + (c.downloadBytes || 0), 0);
    const allMissingBytes = comps.filter((c) => !ok(c)).reduce((a, c) => a + (c.downloadBytes || 0), 0);
    return {
      readiness: !this.lastScanAt ? 'not-checked' : missingReq.length ? 'setup-required' : comps.some((c) => c.level === 'recommended' && !ok(c)) ? 'ready-with-gaps' : 'ready',
      readyToLaunch: !!this.lastScanAt && missingReq.length === 0,
      counts: { total: comps.length, installed: by(ok).length, missing: by((c) => ['not-installed', 'insufficient-storage'].includes(c.state.live)).length, failed: by((c) => ['failed', 'incompatible'].includes(c.state.status)).length,
        pendingDownloads: this.dm.list().filter((d) => ['queued', 'downloading', 'paused'].includes(d.status)).length, updates: by((c) => c.state.status === 'update-available').length },
      missingRequired: missingReq.map((c) => ({ id: c.id, name: c.name, status: c.state.live, problems: c.state.problems })),
      remaining: comps.filter((c) => !ok(c)).map((c) => ({ id: c.id, name: c.name, level: c.level, status: c.state.live, downloadBytes: c.downloadBytes, installType: c.installType })),
      bytes: { requiredAndRecommended: totalDownload, everything: allMissingBytes },
      features: featureReadiness(this.reg, this.statuses),
      system: this.system, lastScanAt: this.lastScanAt, scanning: this.scanning || null,
      profile: { setting: getSettings().hardwareProfile, effective: resolveProfile(this.system) },
      activeOp: this.im.list(5).find((o) => ['queued', 'running'].includes(o.status)) || null,
      busy: this.isBusy(), settings: getSettings(), network: this.network,
    };
  }

  /** Recommended profile from detected hardware, with warnings. Never claims performance from a GPU name. */
  hardware() {
    const s = this.system; if (!s) return { scanned: false };
    const nv = s.gpu.nvidia, ram = s.ram.totalGB, warn = [];
    if (ram < 8) warn.push(`${ram} GB RAM: below the 8 GB the script model needs; use the Low memory profile and close other programs.`);
    else if (ram < 12) warn.push(`${ram} GB RAM: the script model and a render should not run at the same time (the studio already serialises them).`);
    if (nv?.present && nv.vramGB < 4) warn.push(`${nv.vramGB} GB VRAM: the script model (≈3 GB) and SD1.5 images may not fit; Low memory profile recommended.`);
    if (nv?.present && !nv.cudaCapable) warn.push(`NVIDIA driver ${nv.driver} is older than ${nv.minDriverForCuda126}: CUDA 12.6 PyTorch will not run until the driver is updated.`);
    if (!nv?.present) warn.push('No NVIDIA GPU detected: AI image generation would run on the CPU (minutes per image). Procedural visuals, narration and scripts work normally.');
    const free = s.workspaceDisk?.freeGB; if (free != null && free < 15) warn.push(`${free} GB free on the workspace drive: a full install needs about 12 GB more.`);
    const recommended = !nv?.present || !nv.cudaCapable ? 'cpu' : nv.vramGB < 4 || ram < 12 ? 'low-memory' : 'nvidia-cuda';
    return { scanned: true, recommended, setting: getSettings().hardwareProfile, effective: resolveProfile(s), warnings: warn, profiles: this.reg.hardwareProfiles, system: s };
  }

  async runHealth(opts) {
    const r = await runHealth({ ...opts, busy: this.isBusy(), statuses: this.statuses, system: this.system });
    // a partial run (some checks only) updates those checks; it never hides the rest of the last full result
    this.health = opts?.which && this.health ? { ...this.health, checkedAt: r.checkedAt, checks: { ...this.health.checks, ...r.checks } } : r; try { writeJsonAtomic(path.join(SETUP_DIR, 'last-health.json'), this.health); } catch {} return this.health; }
  async checkNetwork() { this.network = await checkNetwork(); logEvent({ kind: 'network', online: this.network.online }); return this.network; }

  // ── storage ──────────────────────────────────────────────────────────────────────────────────────────────
  async storage() {
    if (this.storage_ && Date.now() - this.storage_.at < 60_000) return this.storage_.data;
    const v = baseVars();
    const groups = { models: Object.values(PATHS.models), runtime: [path.join(ROOT, 'runtime')], cache: [path.join(PATHS.models.imageGeneration, 'cache'), path.join(ROOT, 'models', 'hf-home')],
      downloads: [v.tmp], projects: [PATHS.projects], exports: [PATHS.exports], logs: [PATHS.logs], backups: [path.join(ROOT, 'backups')] };
    const data = { at: new Date().toISOString(), groups: {} };
    for (const [k, dirs] of Object.entries(groups)) { let b = 0, n = 0; for (const d of new Set(dirs)) { const r = await dirSize(d, k === 'runtime' ? [v.tmp] : []); b += r.bytes; n += r.files; } data.groups[k] = { bytes: b, files: n, paths: dirs.map((d) => rel(d)) }; }
    data.partials = findPartials([v.tmp, ...Object.values(PATHS.models)], this.dm);
    data.total = Object.values(data.groups).reduce((a, g) => a + g.bytes, 0);
    try { const s = fs.statfsSync(ROOT); data.freeBytes = s.bavail * s.bsize; data.diskBytes = s.blocks * s.bsize; } catch {}
    data.cleanups = [
      { id: 'partial-downloads', name: 'Incomplete downloads (.part files not in use)', bytes: data.partials.filter((p) => !p.active).reduce((a, p) => a + p.bytes, 0), safe: true },
      { id: 'download-temp', name: 'Download folder (archives already installed)', bytes: data.groups.downloads.bytes - data.partials.filter((p) => p.active && p.path.startsWith(rel(v.tmp))).reduce((a, p) => a + p.bytes, 0), safe: true },
      { id: 'image-cache', name: 'AI image cache (regenerated on demand; project images are kept)', bytes: (await dirSize(path.join(PATHS.models.imageGeneration, 'cache'))).bytes, safe: true },
      { id: 'setup-logs', name: 'Setup logs and finished operation records', bytes: (await dirSize(SETUP_DIR)).bytes, safe: true },
    ];
    this.storage_ = { at: Date.now(), data };
    return data;
  }

  cleanup(id) {
    const v = baseVars(), freed = { files: 0, bytes: 0 };
    const rmFile = (f) => { try { const s = fs.statSync(f); fs.rmSync(f, { force: true }); freed.files++; freed.bytes += s.size; } catch {} };
    if (id === 'partial-downloads') { for (const p of findPartials([v.tmp, ...Object.values(PATHS.models)], this.dm)) if (!p.active) rmFile(path.resolve(ROOT, p.path)); for (const d of this.dm.list()) if (['paused', 'failed', 'cancelled'].includes(d.status)) this.dm.remove(d.id); }
    else if (id === 'download-temp') { if (fs.existsSync(v.tmp)) for (const e of fs.readdirSync(v.tmp)) { const f = path.join(v.tmp, e); if (this.dm.activeFor(f.replace(/\.part$/, ''))) continue; if (fs.statSync(f).isFile()) rmFile(f); } }
    else if (id === 'image-cache') { const d = path.join(PATHS.models.imageGeneration, 'cache'); if (fs.existsSync(d)) for (const e of fs.readdirSync(d)) if (/\.(png|jpe?g|webp|json)$/i.test(e)) rmFile(path.join(d, e)); }
    else if (id === 'setup-logs') { for (const f of [path.join(SETUP_DIR, 'setup.log'), path.join(SETUP_DIR, 'last-health.json')]) rmFile(f); const od = path.join(SETUP_DIR, 'ops'); if (fs.existsSync(od)) for (const e of fs.readdirSync(od)) { const op = readJson(path.join(od, e), null); if (op && ['completed', 'failed', 'cancelled', 'interrupted'].includes(op.status)) rmFile(path.join(od, e)); } }
    else throw Object.assign(new Error('unknown cleanup'), { status: 404 });
    this.storage_ = null;
    logEvent({ kind: 'cleanup', action: id, ...freed });
    return freed;
  }

  diagnostics() {
    const o = this.overview();
    return { generatedAt: new Date().toISOString(), app: 'CineForge AI', node: process.version, registrySchema: this.reg.schemaVersion,
      readiness: o.readiness, readyToLaunch: o.readyToLaunch, counts: o.counts, profile: o.profile,
      system: this.system && { os: this.system.os, cpu: this.system.cpu, ram: this.system.ram, gpu: this.system.gpu, workspaceDisk: this.system.workspaceDisk, permissions: this.system.permissions, env: this.system.env },
      components: this.components().map((c) => ({ id: c.id, level: c.level, status: c.state.status, version: c.state.version || null, integrity: c.state.integrity || null, problems: c.state.problems })),
      features: o.features.map((f) => ({ id: f.id, ready: f.ready, missing: f.missing.map((m) => m.id) })),
      health: this.health && Object.fromEntries(Object.entries(this.health.checks).map(([k, v]) => [k, `${v.status}: ${v.summary}`])),
      recentOps: this.im.list(10).map((o2) => ({ id: o2.id, action: o2.action, components: o2.componentIds, status: o2.status, error: o2.error })),
      downloads: this.dm.list().slice(0, 20).map((d) => ({ label: d.label, status: d.status, bytes: d.bytes, total: d.total, error: d.error })) };
  }

  wizardUpdate(patch) { return updateSettings({ wizard: patch }); }
}

const rel = (p) => { const r = path.relative(ROOT, p); return r.startsWith('..') || path.isAbsolute(r) ? p : r.split(path.sep).join('/'); };
async function dirSize(dir, skip = []) {
  let bytes = 0, files = 0, k = 0;
  const walk = async (d) => {
    if (skip.some((s) => path.resolve(s) === path.resolve(d))) return;
    let ents; try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { const p = path.join(d, e.name); if (e.isSymbolicLink()) continue; if (e.isDirectory()) await walk(p); else { try { bytes += (await fs.promises.stat(p)).size; files++; } catch {} } if (++k % 2000 === 0) await new Promise((r) => setImmediate(r)); }
  };
  await walk(dir); return { bytes, files };
}
/** tools/fetch-model.mjs (CLI) holds "<dest>.lock" with its pid while it downloads: never touch those segments. */
function lockedByCli(dest) { try { const pid = +fs.readFileSync(`${dest}.lock`, 'utf8'); if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; } }
function findPartials(dirs, dm) {
  const out = [];
  const walk = (d, depth) => { let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory() && depth < 3 && e.name !== 'cache') walk(p, depth + 1); else if (/\.(part|seg\d+|joined)$/.test(e.name)) { const dest = p.replace(/\.(part|seg\d+|joined)$/, ''); const a = dm.activeFor(dest); out.push({ path: rel(p), bytes: fs.statSync(p).size, active: (!!a && ['queued', 'downloading', 'verifying', 'paused'].includes(a.status)) || lockedByCli(dest) }); } } };
  for (const d of new Set(dirs)) walk(d, 0);
  return out;
}
