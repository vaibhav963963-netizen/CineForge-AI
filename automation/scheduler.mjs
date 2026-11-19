#!/usr/bin/env node
// CineForge automation — background scheduler daemon.
//   node automation/scheduler.mjs            run (one instance per machine; refuses to start twice)
//   node automation/scheduler.mjs --once     one tick, then exit (diagnostics)
// Runs independently of the dashboard: started at Windows logon by Task Scheduler (see install-startup.ps1).
// Process timer (not a browser timer); every tick is persisted, so a restart continues where it stopped.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb, logEvent, AUTO_DIR, ROOT } from './db.mjs';
import { CONFIG, assertConfig } from '../dashboard/lib/config.js';
import { Engine } from './engine.mjs';
import { validateSettings } from './settings.mjs';

const TICK_MS = CONFIG.AUTOMATION_TICK_SECONDS * 1000;
const LOCK = path.join(AUTO_DIR, 'scheduler.lock');

// ── single-instance lock (a stale lock left by a crashed process is taken over) ─────────────────────────────────
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function acquireLock(file = LOCK) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let k = 0; k < 2; k++) {
    try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { flag: 'wx' }); return { ok: true }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let other = null; try { other = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      if (other?.pid && other.pid !== process.pid && alive(other.pid)) return { ok: false, pid: other.pid };
      fs.rmSync(file, { force: true });   // stale lock from a process that no longer exists
    }
  }
  return { ok: false };
}
export function releaseLock(file = LOCK) { try { const l = JSON.parse(fs.readFileSync(file, 'utf8')); if (l.pid === process.pid) fs.rmSync(file, { force: true }); } catch {} }

// ── daily maintenance: prune old events / attempts, back up the database (7 kept) ───────────────────────────────
export function maintenance(db, s, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const last = db.prepare("SELECT value FROM settings WHERE key = 'lastMaintenance'").get();
  if (last && JSON.parse(last.value) === day) return false;
  const cutoff = new Date(now - (s.eventRetentionDays || 30) * 86400000).toISOString();
  const pruned = db.prepare('DELETE FROM events WHERE at < ?').run(cutoff).changes;
  const dir = path.join(AUTO_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `automation-${day}.db`);
  try { fs.rmSync(file, { force: true }); db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); } catch (e) { logEvent(db, 'warn', `Database backup failed: ${e.message}`); }
  for (const f of fs.readdirSync(dir).filter((x) => /^automation-\d{4}-\d\d-\d\d\.db$/.test(x)).sort().slice(0, -7)) fs.rmSync(path.join(dir, f), { force: true });
  db.prepare("INSERT INTO settings (key, value) VALUES ('lastMaintenance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(day));
  logEvent(db, 'info', `Maintenance: ${pruned} old event(s) pruned, database backed up to ${path.relative(ROOT, file)}`);
  return true;
}

async function main() {
  assertConfig('The CineForge scheduler');
  const once = process.argv.includes('--once');
  const lock = acquireLock();
  if (!lock.ok) { console.error(`CineForge scheduler is already running (pid ${lock.pid ?? '?'}); not starting a second instance.`); process.exit(2); }
  const db = openDb();
  const { createExecutor } = await import('./executor.mjs');
  const settings = () => validateSettings(Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, JSON.parse(r.value)]))).value;
  const { notify } = await import('./notify.mjs');
  const { probeResources, healthReport } = await import('./health.mjs');
  const engine = new Engine({ db, executor: createExecutor({ db, settings }), resources: () => probeResources(settings().studio.url),
    notify: (level, msg) => { try { notify(level, msg); } catch {} } });
  logEvent(db, 'info', `Scheduler started (pid ${process.pid})${once ? ' — single tick' : ''}`);
  // startup health check (logged; critical problems also raise a notification)
  try {
    const h = await healthReport(settings());
    for (const c of h.checks) logEvent(db, c.ok ? 'info' : (c.severity === 'critical' ? 'error' : 'warn'), `Health · ${c.check}: ${c.detail}`);
    if (!h.ok) notify('error', `Startup health check failed: ${h.checks.filter((c) => !c.ok && c.severity === 'critical').map((c) => `${c.check} (${c.detail})`).join('; ')}`);
  } catch (e) { logEvent(db, 'warn', `Health check could not run: ${e.message}`); }
  let stopping = false, busy = false;
  const shutdown = (sig) => {
    if (stopping) return; stopping = true;
    logEvent(db, 'info', `Scheduler stopping (${sig})${busy ? ' — waiting for the current step to finish' : ''}`);
    const done = () => { engine.heartbeat('stopped', sig); releaseLock(); process.exit(0); };
    if (!busy) done(); else { const t = setInterval(() => { if (!busy) { clearInterval(t); done(); } }, 500); }
  };
  for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(s, () => shutdown(s));
  process.on('exit', () => releaseLock());
  const loop = async () => {
    if (stopping) return;
    busy = true;
    try { maintenance(db, settings()); const r = await engine.tick(); if (once) console.log(JSON.stringify(r)); }
    catch (e) { logEvent(db, 'error', `Tick failed: ${e.stack || e.message}`); engine.heartbeat('error', e.message); }
    finally { busy = false; }
    if (once) { releaseLock(); process.exit(0); }
    if (!stopping) setTimeout(loop, TICK_MS);
  };
  loop();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
