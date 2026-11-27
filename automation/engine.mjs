// CineForge automation — scheduler engine (pure logic; clock, executor and resource probe are injected so every
// behaviour can be verified with a fake clock and simulated failures before anything touches the GPU).
//
// One tick:  commands → heartbeat → (paused? stop) → schedule due production slots (incl. missed ones) →
//            pick ONE eligible run → guards (quiet hours, resources) → run ONE stage → checkpoint or classify+retry.
// Strictly sequential: at most one stage of one run executes at a time (6 GB GPU).
import crypto from 'node:crypto';
import { logEvent, getSettings, setCheckpoint, checkpoints, updateRun, getRun, nowIso } from './db.mjs';
import { validateSettings, zoned, instantOf, inWindow, nextOccurrence, nextRecoveryWindow } from './settings.mjs';
import { classify, nextAttempt, CLASSES } from './classify.mjs';

export const STAGES = ['topic', 'script', 'render', 'qa', 'metadata', 'upload', 'publish', 'record'];
const HEAVY = new Set(['script', 'render']);           // need the GPU / large models
const ALL_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CATCH_UP_HOURS = 24;                              // a slot missed longer ago than this is skipped, not run

export class Engine {
  /**
   * @param {object} o
   * @param {import('node:sqlite').DatabaseSync} o.db
   * @param {Function} [o.clock]       () => epoch ms
   * @param {object}   o.executor      { topic, script, render, qa, metadata, upload, publish, record, cancel? } — async (run, ctx) => { fields?, data? }
   * @param {Function} [o.resources]   async () => { freeDiskGB, freeRamGB, gpuBusy, studioBusy }
   * @param {Function} [o.notify]      (level, message, run) => void
   */
  constructor({ db, clock = Date.now, executor, resources = async () => ({}), notify = () => {} }) {
    Object.assign(this, { db, clock, executor, resources, notify });
  }
  settings() { return validateSettings(getSettings(this.db)).value; }
  log(level, msg, runId = null) { logEvent(this.db, level, msg, runId, this.clock); if (level !== 'info') this.notify(level, msg, runId); }
  state() { const r = this.db.prepare("SELECT value FROM settings WHERE key = 'state'").get(); return r ? JSON.parse(r.value) : 'running'; }
  setState(s) { this.db.prepare("INSERT INTO settings (key, value) VALUES ('state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(s)); }

  heartbeat(state, detail = '') {
    this.db.prepare('INSERT INTO heartbeat (id, pid, at, state, detail) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET pid = excluded.pid, at = excluded.at, state = excluded.state, detail = excluded.detail')
      .run(process.pid, nowIso(this.clock), state, String(detail).slice(0, 500));
  }

  // ── control commands (pause | resume | stop | requeue:<runId> | run-now) ─────────────────────────────────────
  async processCommands() {
    const cmds = this.db.prepare('SELECT * FROM commands WHERE done_at IS NULL ORDER BY id').all();
    for (const c of cmds) {
      const [cmd, arg] = c.command.split(':');
      if (cmd === 'pause') { this.setState('paused'); this.log('info', 'Automation paused (current stage finishes, no new work starts)'); }
      else if (cmd === 'resume') { this.setState('running'); this.log('info', 'Automation resumed'); }
      else if (cmd === 'stop') {
        this.setState('paused');
        for (const r of this.db.prepare("SELECT * FROM runs WHERE status = 'running'").all()) {
          try { await this.executor.cancel?.(r); } catch {}
          updateRun(this.db, r.id, { status: 'waiting_retry', next_attempt_at: nowIso(this.clock), last_error: 'emergency stop' }, this.clock);
          this.log('warn', `Emergency stop: run ${r.id} halted at stage "${r.stage}"; it resumes from its last checkpoint after "resume"`, r.id);
        }
      } else if (cmd === 'publish' && arg) {
        const r = getRun(this.db, arg);
        if (r && ['awaiting_publish', 'queued', 'failed', 'waiting_retry'].includes(r.status)) {
          updateRun(this.db, r.id, { status: 'queued', stage: 'upload', attempt: 0, next_attempt_at: nowIso(this.clock), failure_class: null }, this.clock);
          this.log('info', `Run ${r.id} queued for upload/publish`, r.id);
        }
      } else if (cmd === 'requeue' && arg) {
        const r = getRun(this.db, arg);
        if (r && ['dead', 'failed', 'cancelled', 'waiting_retry'].includes(r.status)) {
          updateRun(this.db, r.id, { status: 'waiting_retry', attempt: 0, next_attempt_at: nowIso(this.clock), failure_class: null }, this.clock);
          this.log('info', `Run ${r.id} requeued from stage "${r.stage}" (completed checkpoints are kept)`, r.id);
        }
      } else if (cmd === 'run-now') { this.createRun(`${zoned(this.clock(), this.settings().timeZone).date}#manual-${c.id}`, 'manual run requested'); }
      this.db.prepare('UPDATE commands SET done_at = ? WHERE id = ?').run(nowIso(this.clock), c.id);
    }
  }
  command(cmd) { this.db.prepare('INSERT INTO commands (at, command) VALUES (?, ?)').run(nowIso(this.clock), cmd); }

  // ── scheduling: due production slots, missed-execution catch-up, duplicate guard ──────────────────────────────
  createRun(slot, why) {
    const id = `run_${slot.replace(/[^\w]/g, '')}_${crypto.randomBytes(3).toString('hex')}`;
    const r = this.db.prepare("INSERT OR IGNORE INTO runs (id, slot, status, stage, attempt, created_at, updated_at) VALUES (?, ?, 'queued', 'topic', 0, ?, ?)")
      .run(id, slot, nowIso(this.clock), nowIso(this.clock));
    if (r.changes) { this.log('info', `Run created for slot ${slot} (${why})`, id); return id; }
    return null;   // slot already has a run: duplicate prevented by the UNIQUE(slot) constraint
  }
  schedule(s) {
    if (!s.enabled) return;
    const now = this.clock();
    // catch-up only covers slots AFTER automation was first enabled (turning it on must not produce a video for a
    // day that was never scheduled)
    let since = this.db.prepare("SELECT value FROM settings WHERE key = 'enabledSince'").get();
    if (!since) { this.db.prepare("INSERT INTO settings (key, value) VALUES ('enabledSince', ?)").run(JSON.stringify(nowIso(this.clock))); since = { value: JSON.stringify(nowIso(this.clock)) }; }
    const sinceMs = Date.parse(JSON.parse(since.value));
    // today and yesterday (a slot missed while the PC was off is caught up once, within CATCH_UP_HOURS)
    for (const back of [1, 0]) {
      const day = zoned(now - back * 86400000, s.timeZone);
      if (!s.productionDays.includes(day.weekday)) continue;
      const at = instantOf(day.date, s.productionTime, s.timeZone);
      if (at > now || at < sinceMs - 60000) continue;
      const late = now - at;
      for (let k = 0; k < s.maxVideosPerDay; k++) {
        const slot = `${day.date}#${k + 1}`;
        if (this.db.prepare('SELECT 1 FROM runs WHERE slot = ?').get(slot)) continue;
        if (late > CATCH_UP_HOURS * 3600000) continue;
        this.createRun(slot, late > 15 * 60000 ? `missed by ${Math.round(late / 60000)} min — catching up once` : 'scheduled');
      }
    }
  }

  // ── pick one eligible run ──────────────────────────────────────────────────────────────────────────────────────
  nextRun() {
    const now = nowIso(this.clock);
    // a run left "running" by a crashed / restarted process resumes first (same run ID, first incomplete stage)
    return this.db.prepare("SELECT * FROM runs WHERE status = 'running' ORDER BY created_at LIMIT 1").get()
      || this.db.prepare("SELECT * FROM runs WHERE status = 'queued' OR (status = 'waiting_retry' AND next_attempt_at <= ?) ORDER BY created_at LIMIT 1").get(now);
    // 'awaiting_publish' (manual mode) is never picked up automatically — a person publishes it
  }

  /** next free publish slot (one video per slot; overdue videos move to the next slot — never published in a burst) */
  publishSlot(s, run) {
    if (run.publish_at) return run.publish_at;
    const taken = new Set(this.db.prepare("SELECT publish_at FROM runs WHERE publish_at IS NOT NULL AND id != ?").all(run.id).map((r) => r.publish_at));
    let t = this.clock();
    for (let k = 0; k < 60; k++) {
      const at = nextOccurrence(t, s.publishTime, s.publishDays, s.timeZone);
      const iso = new Date(at).toISOString();
      if (!taken.has(iso)) return iso;
      t = at + 60000;
    }
    return null;
  }

  // ── one tick ──────────────────────────────────────────────────────────────────────────────────────────────────
  async tick() {
    await this.processCommands();
    const s = this.settings();
    if (this.state() === 'paused') { this.heartbeat('paused'); return { idle: 'paused' }; }
    this.schedule(s);
    const run = this.nextRun();
    if (!run) { this.heartbeat('idle'); return { idle: 'nothing due' }; }
    const stage = run.stage, now = this.clock();
    if (HEAVY.has(stage) && inWindow(now, s.quietHours, s.timeZone)) {
      const at = nextOccurrence(now, s.quietHours.end, ALL_DAYS, s.timeZone);
      if (run.status !== 'waiting_retry' || run.next_attempt_at !== new Date(at).toISOString()) {
        updateRun(this.db, run.id, { status: 'waiting_retry', next_attempt_at: new Date(at).toISOString() }, this.clock);
        this.log('info', `Quiet hours: stage "${stage}" waits until ${new Date(at).toISOString()}`, run.id);
      }
      this.heartbeat('waiting', 'quiet hours'); return { waiting: 'quiet hours' };
    }
    // resource guard before heavy stages
    if (HEAVY.has(stage)) {
      const r = await this.resources();
      const why = r.freeDiskGB != null && r.freeDiskGB < s.minFreeDiskGB ? Object.assign(new Error(`insufficient disk space: ${r.freeDiskGB} GB free, ${s.minFreeDiskGB} GB required`), { failureClass: 'disk' })
        : r.freeRamGB != null && r.freeRamGB < s.minFreeRamGB ? Object.assign(new Error(`insufficient RAM: ${r.freeRamGB} GB free, ${s.minFreeRamGB} GB required`), { failureClass: 'resources' })
        : r.freeVramGB != null && s.minFreeVramGB && r.freeVramGB < s.minFreeVramGB ? Object.assign(new Error(`insufficient VRAM: ${r.freeVramGB} GB free, ${s.minFreeVramGB} GB required (another program is using the GPU)`), { failureClass: 'resources' })
        : r.studioBusy ? Object.assign(new Error('the studio is already running another job (one heavy job at a time)'), { failureClass: 'resources' })
        : null;
      if (why) return this.fail(run, stage, why, s);
    }
    return this.runStage(run, stage, s);
  }

  async runStage(run, stage, s) {
    const cps = checkpoints(this.db, run.id);
    if (cps[stage]?.status === 'done') return this.advance(run, stage, s);   // never re-run a completed stage
    // the publish stage runs at the run's publish slot, not before (waiting is not a failure and costs no attempt)
    if (stage === 'publish' && run.publish_at && Date.parse(run.publish_at) > this.clock()) {
      if (run.status !== 'waiting_retry' || run.next_attempt_at !== run.publish_at) {
        updateRun(this.db, run.id, { status: 'waiting_retry', next_attempt_at: run.publish_at }, this.clock);
        this.log('info', `Uploaded; publishing at ${run.publish_at}`, run.id);
      }
      this.heartbeat('waiting', `${run.id} publishes at ${run.publish_at}`); return { stage, result: 'waiting for publish slot', at: run.publish_at };
    }
    const attemptNo = run.attempt + 1;
    const attemptId = this.db.prepare('INSERT INTO attempts (run_id, stage, attempt, started_at) VALUES (?, ?, ?, ?)').run(run.id, stage, attemptNo, nowIso(this.clock)).lastInsertRowid;
    updateRun(this.db, run.id, { status: 'running' }, this.clock);
    this.heartbeat('working', `${run.id} · ${stage}`);
    this.log('info', `Stage "${stage}" started (attempt ${attemptNo})`, run.id);
    try {
      if (stage === 'upload' && s.publishMode === 'manual') {
        // manual mode: the verified video waits for a person; nothing is uploaded
        setCheckpoint(this.db, run.id, 'upload', 'skipped', { reason: 'publish mode: manual' }, this.clock);
        updateRun(this.db, run.id, { status: 'awaiting_publish', stage: 'upload', attempt: 0 }, this.clock);
        this.db.prepare("UPDATE attempts SET ended_at = ?, result = 'manual' WHERE id = ?").run(nowIso(this.clock), attemptId);
        this.log('info', 'Video verified and ready; publish mode is manual — waiting for you', run.id);
        return { stage, result: 'awaiting manual publish' };
      }
      if (s.publishMode === 'scheduled-public' && !run.publish_at) updateRun(this.db, run.id, { publish_at: this.publishSlot(s, run) }, this.clock);
      const fresh = getRun(this.db, run.id);
      const out = (await this.executor[stage](fresh, { settings: s, checkpoints: cps, clock: this.clock, log: (m) => this.log('info', m, run.id) })) || {};
      if (out.fields) updateRun(this.db, run.id, out.fields, this.clock);
      setCheckpoint(this.db, run.id, stage, 'done', out.data ?? null, this.clock);
      this.db.prepare("UPDATE attempts SET ended_at = ?, result = 'ok' WHERE id = ?").run(nowIso(this.clock), attemptId);
      this.log('info', `Stage "${stage}" done`, run.id);
      return this.advance(getRun(this.db, run.id), stage, s);
    } catch (e) {
      this.db.prepare("UPDATE attempts SET ended_at = ?, result = 'failed', error = ? WHERE id = ?").run(nowIso(this.clock), String(e.message).slice(0, 1000), attemptId);
      return this.fail(getRun(this.db, run.id), stage, e, s);
    }
  }

  advance(run, stage, s) {
    const i = STAGES.indexOf(stage);
    if (i === STAGES.length - 1) {
      updateRun(this.db, run.id, { status: 'published', attempt: 0, next_attempt_at: null }, this.clock);
      this.log('info', `Run complete${run.youtube_url ? `: ${run.youtube_url}` : ''}`, run.id);
      return { stage, result: 'complete' };
    }
    updateRun(this.db, run.id, { stage: STAGES[i + 1], status: 'queued', attempt: 0, next_attempt_at: null, last_error: null, failure_class: null, resource_wait_since: null }, this.clock);
    return { stage, result: 'done', next: STAGES[i + 1] };
  }

  fail(run, stage, err, s) {
    const cls = classify(err);
    // a resource shortage usually clears in minutes (seen: 0.8 GB free RAM right after the script stage while the
    // studio's script model was still unloading): re-check every 3 min for up to 30 min WITHOUT using a retry attempt;
    // only after that does the normal retry policy (slots, recovery window, dead-letter) apply
    if (CLASSES[cls]?.waitForResources) {
      const since = Date.parse(run.resource_wait_since || '') || this.clock();
      if (this.clock() - since < 30 * 60000) {
        const at = this.clock() + 3 * 60000;
        updateRun(this.db, run.id, { status: 'waiting_retry', next_attempt_at: new Date(at).toISOString(), failure_class: cls, last_error: String(err.message).slice(0, 1000), resource_wait_since: new Date(since).toISOString() }, this.clock);
        this.log('info', `Stage "${stage}" waits for resources (${String(err.message).slice(0, 120)}) — re-check at ${new Date(at).toISOString()}`, run.id);
        return { stage, result: 'retry', failureClass: cls, at, resourceWait: true };
      }
    }
    const attempt = run.attempt + 1;
    const first = this.db.prepare('SELECT MIN(started_at) AS t FROM attempts WHERE run_id = ? AND stage = ?').get(run.id, stage)?.t;
    const d = nextAttempt(cls, attempt, s, this.clock(), { nextRecoveryWindow, nextOccurrence, inWindow }, first ? Date.parse(first) : this.clock());
    const fields = { attempt, failure_class: cls, last_error: String(err.message || err).slice(0, 1000) };
    this.db.prepare('UPDATE attempts SET failure_class = ?, next_attempt_at = ? WHERE id = (SELECT MAX(id) FROM attempts WHERE run_id = ?)').run(cls, d.retry ? new Date(d.at).toISOString() : null, run.id);
    if (d.retry) {
      updateRun(this.db, run.id, { ...fields, status: 'waiting_retry', next_attempt_at: new Date(d.at).toISOString() }, this.clock);
      this.log('warn', `Stage "${stage}" failed (${CLASSES[cls].label}): ${fields.last_error.slice(0, 200)} — retry ${attempt}/${s.retryCount} at ${new Date(d.at).toISOString()}`, run.id);
      return { stage, result: 'retry', failureClass: cls, at: d.at };
    }
    updateRun(this.db, run.id, { ...fields, status: 'dead', next_attempt_at: null }, this.clock);
    this.log('error', `Stage "${stage}" moved to the dead-letter queue (${CLASSES[cls].label}): ${d.reason}`, run.id);
    return { stage, result: 'dead', failureClass: cls, reason: d.reason };
  }
}
