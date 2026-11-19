// CineForge automation — persistent state (SQLite via node:sqlite, built into Node 22; no extra download).
// Everything the scheduler knows lives here, so it survives dashboard closes, process restarts and Windows reboots:
// settings, runs (one production → publish lifecycle each, with a stable id across retries), per-stage checkpoints,
// the event log, retry history, the heartbeat and control commands (pause / resume / stop).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, redact } from '../dashboard/lib/config.js';

process.removeAllListeners('warning');   // node:sqlite prints an ExperimentalWarning on every start
const { DatabaseSync } = await import('node:sqlite');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUTO_DIR = path.join(ROOT, 'logs', 'automation');

export function openDb(file = CONFIG.AUTOMATION_DB) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, slot TEXT NOT NULL UNIQUE,           -- slot = production day (YYYY-MM-DD) + index: duplicate guard
      status TEXT NOT NULL,                                     -- queued | running | waiting_retry | awaiting_publish | published | failed | dead | cancelled
      stage TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
      topic TEXT, project_id TEXT, script_version INTEGER, studio_job_id TEXT, video_path TEXT, video_sha TEXT,
      youtube_video_id TEXT, youtube_url TEXT, upload_session TEXT, resource_wait_since TEXT,
      publish_at TEXT, next_attempt_at TEXT, last_error TEXT, failure_class TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoints (run_id TEXT NOT NULL, stage TEXT NOT NULL, status TEXT NOT NULL, data TEXT, at TEXT NOT NULL,
      PRIMARY KEY (run_id, stage));
    CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, stage TEXT NOT NULL, attempt INTEGER NOT NULL,
      started_at TEXT NOT NULL, ended_at TEXT, result TEXT, failure_class TEXT, error TEXT, next_attempt_at TEXT);
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, run_id TEXT, message TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS heartbeat (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER, at TEXT, state TEXT, detail TEXT);
    CREATE TABLE IF NOT EXISTS commands (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, command TEXT NOT NULL, done_at TEXT);
    CREATE INDEX IF NOT EXISTS runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS events_run ON events(run_id);
  `);
  // migrations for databases created by earlier versions
  const cols = new Set(db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name));
  if (!cols.has('resource_wait_since')) db.exec('ALTER TABLE runs ADD COLUMN resource_wait_since TEXT');
  return db;
}

export const nowIso = (clock = Date.now) => new Date(clock()).toISOString();

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
export function logEvent(db, level, message, runId = null, clock = Date.now) {
  if ((LEVELS[level] ?? 1) < (LEVELS[CONFIG.LOG_LEVEL] ?? 1)) return;
  // secrets never reach the event log (tokens, client secrets, bearer headers are masked)
  db.prepare('INSERT INTO events (at, level, run_id, message) VALUES (?, ?, ?, ?)').run(nowIso(clock), level, runId, redact(String(message)).slice(0, 2000));
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
}
export function putSettings(db, obj) {
  const st = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(obj)) st.run(k, JSON.stringify(v));
}

export function setCheckpoint(db, runId, stage, status, data = null, clock = Date.now) {
  db.prepare('INSERT INTO checkpoints (run_id, stage, status, data, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id, stage) DO UPDATE SET status = excluded.status, data = excluded.data, at = excluded.at')
    .run(runId, stage, status, data == null ? null : JSON.stringify(data), nowIso(clock));
}
export function checkpoints(db, runId) {
  return Object.fromEntries(db.prepare('SELECT stage, status, data FROM checkpoints WHERE run_id = ?').all(runId).map((r) => [r.stage, { status: r.status, data: r.data ? JSON.parse(r.data) : null }]));
}

export function updateRun(db, id, fields, clock = Date.now) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => fields[k]), nowIso(clock), id);
}
export const getRun = (db, id) => db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
