// Generation jobs: unique id, a weighted stage plan, progress that only ever comes from real work, persisted to
// logs/jobs/<jobId>.json (so it survives a browser refresh AND a server restart), live subscribers (SSE), a
// timestamped event log, cancellation, and one-heavy-job-at-a-time queueing.
//
// Overall progress = (Σ weights of finished stages + weight(current) × fraction(current)) / Σ weights of active stages.
//  · skipped stages leave the plan (their weight is removed, so progress never goes backwards)
//  · a stage with no measurable progress reports fraction = null (indeterminate): it contributes 0 until it finishes
//  · the value is capped at 99 until the job is marked completed, which the pipeline does only after the final MP4
//    exists, FFprobe verified it, the export copy was verified and QA ran.  Failed / cancelled jobs never show 100.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { PATHS } from './workspace.js';

export const STAGES = {
  validate:   { name: 'Configuration validation' },
  script:     { name: 'Script generation' },
  prepare:    { name: 'Script & narration preparation' },
  tts:        { name: 'Kokoro TTS narration' },
  align:      { name: 'Whisper word alignment' },
  storyboard: { name: 'Storyboard planning' },
  images:     { name: 'Local image generation' },
  scene:      { name: 'Scene construction & animation check' },
  capture:    { name: 'WebGL frame capture (H.264)' },
  audio:      { name: 'Sound design & audio mix' },
  compose:    { name: 'FFmpeg audio/video composition' },
  qa:         { name: 'Visual QA & export' },
};

const now = () => new Date().toISOString();
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export class CancelledError extends Error { constructor() { super('Job cancelled by user'); this.cancelled = true; } }

export class Job {
  constructor({ id, kind, projectId, title, config, plan, requestKey, configHash }) {
    this.id = id || `job_${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}_${crypto.randomBytes(3).toString('hex')}`;
    this.kind = kind; this.projectId = projectId; this.title = title || projectId; this.config = config || null;
    this.requestKey = requestKey || null; this.configHash = configHash || null;
    this.status = 'queued'; this.currentStage = null; this.message = 'Queued';
    this.stages = plan.map((p) => ({
      id: p.id, name: p.name || STAGES[p.id]?.name || p.id, weight: p.weight, status: p.skip ? 'skipped' : 'pending',
      skipReason: p.skip || null, fraction: 0, current: null, total: null, unit: null, message: p.skip || '',
      startedAt: null, endedAt: null,
    }));
    this.progress = 0; this.warnings = []; this.error = null; this.failedStage = null; this.result = null;
    this.createdAt = now(); this.startedAt = null; this.updatedAt = now(); this.finishedAt = null;
    this.logs = []; this.events = []; this.children = new Set(); this.cancelRequested = false;
    this.listeners = new Set(); this._saveTimer = null; this._lastEvent = null;
  }

  // ── progress math ─────────────────────────────────────────────────────────────────────────────────────────
  computeProgress() {
    const active = this.stages.filter((s) => s.status !== 'skipped');
    const total = active.reduce((a, s) => a + s.weight, 0) || 1;
    let done = 0;
    for (const s of active) {
      if (s.status === 'done') done += s.weight;
      else if (s.status === 'running' && typeof s.fraction === 'number') done += s.weight * Math.max(0, Math.min(1, s.fraction));
    }
    const pct = (done / total) * 100;
    return this.status === 'completed' ? 100 : Math.min(99, Math.floor(pct));
  }
  stage(id) { const s = this.stages.find((x) => x.id === id); if (!s) throw new Error(`unknown stage ${id}`); return s; }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────────
  begin() { this.status = 'running'; this.startedAt = now(); this.message = 'Starting'; this.emit(true); }

  startStage(id, message, { name } = {}) {
    this.throwIfCancelled();
    const s = this.stage(id);
    if (name) s.name = name;
    s.status = 'running'; s.startedAt = now(); s.fraction = 0; s.message = message || s.name;
    this.currentStage = id; this.message = s.message;
    this.log(`▶ ${s.name}${message ? ': ' + message : ''}`);
    this.emit(true);
  }

  /**
   * Report real progress inside the running stage.
   *   { current, total }  → fraction = current/total (e.g. "frame 450 of 1053")
   *   { fraction }        → explicit fraction 0..1 from a measured quantity
   *   { indeterminate: true } → the stage is working but cannot measure how far along it is
   * Fractions are monotonic: a lower value never replaces a higher one.
   */
  stageProgress(id, { current, total, fraction, unit, message, indeterminate } = {}) {
    const s = this.stage(id);
    if (s.status !== 'running') return;
    if (indeterminate) s.fraction = null;
    else {
      let f = fraction;
      if (f === undefined && Number.isFinite(current) && Number.isFinite(total) && total > 0) f = current / total;
      if (Number.isFinite(f)) s.fraction = Math.max(typeof s.fraction === 'number' ? s.fraction : 0, Math.min(1, f));
    }
    if (Number.isFinite(current)) s.current = current;
    if (Number.isFinite(total)) s.total = total;
    if (unit) s.unit = unit;
    if (message) { s.message = message; this.message = message; }
    this.emit(false);
  }

  completeStage(id, message) {
    const s = this.stage(id);
    s.status = 'done'; s.fraction = 1; s.endedAt = now(); if (message) s.message = message;
    this.log(`✔ ${s.name}${message ? ': ' + message : ''} (${secs(s.startedAt, s.endedAt)} s)`);
    this.emit(true);
  }

  skipStage(id, reason) {
    const s = this.stage(id);
    s.status = 'skipped'; s.skipReason = reason; s.message = reason; s.endedAt = now();
    this.log(`↷ ${s.name} skipped: ${reason}`);
    this.emit(true);
  }

  warn(msg) { if (!this.warnings.includes(msg)) { this.warnings.push(msg); this.log(`⚠ ${msg}`); this.emit(true); } }

  fail(err) {
    if (TERMINAL.has(this.status)) return;
    const s = this.currentStage ? this.stage(this.currentStage) : null;
    if (err && err.cancelled) return this.markCancelled();
    if (s && s.status === 'running') { s.status = 'failed'; s.endedAt = now(); }
    this.status = 'failed'; this.failedStage = this.currentStage; this.error = String(err && err.message || err);
    this.message = `Failed during ${s ? s.name : 'setup'}: ${this.error}`; this.finishedAt = now();
    this.log(`✖ ${this.message}`);
    this.emit(true, true);
  }

  markCancelled() {
    if (TERMINAL.has(this.status)) return;
    const s = this.currentStage ? this.stage(this.currentStage) : null;
    if (s && s.status === 'running') { s.status = 'cancelled'; s.endedAt = now(); }
    this.status = 'cancelled'; this.message = 'Cancelled by user'; this.finishedAt = now();
    this.log('■ Job cancelled');
    this.emit(true, true);
  }

  /** Only the pipeline's final step calls this, after the output has been verified. */
  complete(result, message = 'Video ready') {
    this.result = result; this.status = 'completed'; this.message = message; this.currentStage = null; this.finishedAt = now();
    this.log(`★ ${message}`);
    this.emit(true, true);
  }

  // ── cancellation ──────────────────────────────────────────────────────────────────────────────────────────
  requestCancel() {
    if (TERMINAL.has(this.status)) return false;
    this.cancelRequested = true;
    if (this.status === 'queued') { this.markCancelled(); return true; }
    this.log('Cancellation requested: stopping child processes...');
    for (const c of this.children) killTree(c);
    this.emit(true);
    return true;
  }
  throwIfCancelled() { if (this.cancelRequested) throw new CancelledError(); }

  // ── logs, events, persistence ─────────────────────────────────────────────────────────────────────────────
  log(line) {
    const entry = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
    this.logs.push(entry); if (this.logs.length > 600) this.logs.splice(0, this.logs.length - 600);
    try { fs.appendFileSync(path.join(PATHS.jobs, `${this.id}.log`), entry + '\n'); } catch {}
  }

  emit(important, final = false) {
    // monotonic: a failure/cancel freezes the bar where real work stopped instead of moving it backwards
    this.progress = this.status === 'completed' ? 100 : Math.min(99, Math.max(this.progress || 0, this.computeProgress()));
    this.updatedAt = now();
    const s = this.currentStage ? this.stage(this.currentStage) : null;
    const ev = { t: this.updatedAt, status: this.status, stage: this.currentStage, progress: this.progress,
      stageProgress: s && typeof s.fraction === 'number' ? Math.round(s.fraction * 1000) / 10 : null, message: this.message };
    const last = this._lastEvent;
    // event log: every stage/status change, every whole-percent change, and at most one heartbeat per 2 s otherwise
    if (important || !last || last.status !== ev.status || last.stage !== ev.stage || last.progress !== ev.progress || Date.parse(ev.t) - Date.parse(last.t) > 2000) {
      this.events.push(ev); this._lastEvent = ev; if (this.events.length > 4000) this.events.splice(1, 1);
    }
    const snap = this.snapshot();
    for (const fn of this.listeners) { try { fn(snap); } catch {} }
    this.scheduleSave(important || final);
  }

  scheduleSave(immediate) {
    if (immediate) { clearTimeout(this._saveTimer); this._saveTimer = null; return this.save(); }
    if (!this._saveTimer) this._saveTimer = setTimeout(() => { this._saveTimer = null; this.save(); }, 500);
  }
  save() {
    const file = path.join(PATHS.jobs, `${this.id}.json`), tmp = file + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(this.toJSON(true), null, 1)); fs.renameSync(tmp, file); } catch (e) { console.error('job save failed', e.message); }
  }

  elapsedSeconds() { return this.startedAt ? Math.round(((this.finishedAt ? Date.parse(this.finishedAt) : Date.now()) - Date.parse(this.startedAt)) / 1000) : 0; }

  /** ETA only once there's enough evidence: ≥ 15 % done, ≥ 20 s elapsed, and the current stage is measurable. */
  estimateRemaining() {
    if (this.status !== 'running') return null;
    const el = this.elapsedSeconds(), p = this.progress, s = this.currentStage ? this.stage(this.currentStage) : null;
    if (p < 15 || el < 20 || !s || typeof s.fraction !== 'number') return null;
    return Math.round(el * (100 - p) / p);
  }

  snapshot() {
    return {
      jobId: this.id, kind: this.kind, projectId: this.projectId, title: this.title, status: this.status,
      currentStage: this.currentStage, currentStageName: this.currentStage ? this.stage(this.currentStage).name : null,
      progress: this.progress,
      stageProgress: (() => { const s = this.currentStage && this.stage(this.currentStage); return s && typeof s.fraction === 'number' ? Math.round(s.fraction * 1000) / 10 : null; })(),
      message: this.message,
      stages: this.stages.map(({ id, name, weight, status, fraction, current, total, unit, message, startedAt, endedAt, skipReason }) =>
        ({ id, name, weight, status, fraction: typeof fraction === 'number' ? Math.round(fraction * 1000) / 1000 : null, current, total, unit, message, startedAt, endedAt, skipReason })),
      completedStages: this.stages.filter((s) => s.status === 'done').map((s) => s.id),
      failedStage: this.failedStage, error: this.error, warnings: this.warnings,
      createdAt: this.createdAt, startedAt: this.startedAt, updatedAt: this.updatedAt, finishedAt: this.finishedAt,
      elapsedSeconds: this.elapsedSeconds(), estimatedRemainingSeconds: this.estimateRemaining(),
      result: this.result, logs: this.logs.slice(-120), cancelRequested: this.cancelRequested,
    };
  }
  toJSON(full = false) {
    return { ...this.snapshot(), config: this.config, requestKey: this.requestKey, configHash: this.configHash, ...(full ? { logs: this.logs, events: this.events } : {}) };
  }

  static restore(data) {
    const j = new Job({ id: data.jobId, kind: data.kind, projectId: data.projectId, title: data.title, config: data.config, plan: [], requestKey: data.requestKey, configHash: data.configHash });
    Object.assign(j, {
      status: data.status, currentStage: data.currentStage, message: data.message, progress: data.progress, warnings: data.warnings || [],
      error: data.error, failedStage: data.failedStage, result: data.result, createdAt: data.createdAt, startedAt: data.startedAt,
      updatedAt: data.updatedAt, finishedAt: data.finishedAt, logs: data.logs || [], events: data.events || [],
      stages: (data.stages || []).map((s) => ({ ...s })),
    });
    return j;
  }
}

const secs = (a, b) => ((Date.parse(b) - Date.parse(a)) / 1000).toFixed(1);

/**
 * Kill a child and all of its descendants (headless Chrome, GPU helpers ...). sync=true waits for taskkill to finish:
 * required before exiting, otherwise the async taskkill dies with us and the tree survives (seen with llama-server).
 */
export function killTree(child, { sync = false } = {}) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      const args = ['/PID', String(child.pid), '/T', '/F'];
      if (sync) spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true, timeout: 10000 });
      else spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
    } else process.kill(-child.pid, 'SIGKILL');
  } catch { try { child.kill('SIGKILL'); } catch {} }
}

// ── manager ─────────────────────────────────────────────────────────────────────────────────────────────────
export class JobManager {
  constructor() {
    fs.mkdirSync(PATHS.jobs, { recursive: true });
    this.jobs = new Map(); this.queue = []; this.running = null;
    this.restoreFromDisk();
  }

  restoreFromDisk() {
    for (const f of fs.readdirSync(PATHS.jobs).filter((f) => f.endsWith('.json'))) {
      try {
        const j = Job.restore(JSON.parse(fs.readFileSync(path.join(PATHS.jobs, f), 'utf8')));
        if (!TERMINAL.has(j.status)) {
          // the process that ran it is gone: report that honestly instead of pretending it is still running
          const s = j.currentStage && j.stages.find((x) => x.id === j.currentStage);
          if (s && s.status === 'running') s.status = 'failed';
          j.status = 'failed'; j.failedStage = j.currentStage; j.error = 'Interrupted: the studio server stopped while this job was running. Retry to resume.';
          j.message = j.error; j.finishedAt = now(); j.log('✖ ' + j.error); j.save();
        }
        this.jobs.set(j.id, j);
      } catch (e) { console.error('could not restore job', f, e.message); }
    }
  }

  get(id) { return this.jobs.get(id) || null; }

  list({ projectId, limit = 50 } = {}) {
    return [...this.jobs.values()].filter((j) => !projectId || j.projectId === projectId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, limit)
      .map((j) => { const s = j.snapshot(); delete s.logs; return s; });
  }

  /** an unfinished job for the same request key or identical render, so a double click / refresh never starts a duplicate */
  findActiveDuplicate({ requestKey, configHash, projectId }) {
    return [...this.jobs.values()].find((j) => !TERMINAL.has(j.status) &&
      ((requestKey && j.requestKey === requestKey) || (configHash && j.configHash === configHash && j.projectId === projectId))) || null;
  }

  /** create + enqueue. runner(job) does the work; it must call job.complete(...) itself after verifying output. */
  submit(jobOpts, runner) {
    const job = new Job(jobOpts);
    this.jobs.set(job.id, job);
    job.log(`Job created for project ${job.projectId} (${job.kind})`);
    job.emit(true);
    this.queue.push({ job, runner });
    this.pump();
    return job;
  }

  pump() {
    if (this.running) {
      for (const { job } of this.queue) if (job.status === 'queued') { job.message = `Queued behind ${this.running.id}`; job.emit(false); }
      return;
    }
    const next = this.queue.shift();
    if (!next) return;
    if (next.job.status !== 'queued') return this.pump();   // cancelled while queued
    this.running = next.job;
    (async () => {
      try { next.job.begin(); await next.runner(next.job); if (next.job.status === 'running') throw new Error('pipeline ended without verifying its output'); }
      catch (e) { next.job.fail(e); }
      finally {
        for (const c of next.job.children) killTree(c);
        this.running = null; setImmediate(() => this.pump());
      }
    })();
  }

  subscribe(id, fn) { const j = this.get(id); if (!j) return null; j.listeners.add(fn); return () => j.listeners.delete(fn); }
}
