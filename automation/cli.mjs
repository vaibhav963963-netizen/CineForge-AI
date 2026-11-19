#!/usr/bin/env node
// CineForge automation — command line.
//   node automation/cli.mjs status                 heartbeat, state, current/next runs
//   node automation/cli.mjs runs [n]               recent runs
//   node automation/cli.mjs events [n]             recent events
//   node automation/cli.mjs pause | resume | stop  (stop = emergency stop: cancels the running studio job)
//   node automation/cli.mjs requeue <runId>        dead/failed run → resume from its last checkpoint
//   node automation/cli.mjs run-now                start one production run now
//   node automation/cli.mjs settings               show settings
//   node automation/cli.mjs set key=value ...      change settings (values are JSON; validated before saving)
import { openDb, getSettings, putSettings, nowIso } from './db.mjs';
import { validateSettings, DEFAULTS } from './settings.mjs';

const db = openDb();
const [cmd, ...args] = process.argv.slice(2);
const cmdRow = (c) => db.prepare('INSERT INTO commands (at, command) VALUES (?, ?)').run(nowIso(), c);
const show = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));

switch (cmd) {
  case 'status': {
    const hb = db.prepare('SELECT * FROM heartbeat WHERE id = 1').get();
    const age = hb ? Math.round((Date.now() - Date.parse(hb.at)) / 1000) : null;
    const state = db.prepare("SELECT value FROM settings WHERE key = 'state'").get();
    show({ scheduler: hb ? `${hb.state} (pid ${hb.pid}, heartbeat ${age}s ago${age > 120 ? ' — NOT RUNNING?' : ''})` : 'never started', mode: state ? JSON.parse(state.value) : 'running',
      enabled: validateSettings(getSettings(db)).value.enabled,
      active: db.prepare("SELECT id, slot, status, stage, attempt, next_attempt_at, failure_class, last_error FROM runs WHERE status NOT IN ('published','dead','cancelled') ORDER BY created_at").all(),
      deadLetter: db.prepare("SELECT id, slot, stage, failure_class, last_error FROM runs WHERE status = 'dead' ORDER BY updated_at DESC LIMIT 10").all() });
    break;
  }
  case 'runs': show(db.prepare('SELECT id, slot, status, stage, attempt, topic, youtube_url, publish_at, updated_at FROM runs ORDER BY created_at DESC LIMIT ?').all(+(args[0] || 10))); break;
  case 'events': for (const e of db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(+(args[0] || 30)).reverse()) console.log(`${e.at} ${e.level.toUpperCase().padEnd(5)} ${e.run_id ? `[${e.run_id}] ` : ''}${e.message}`); break;
  case 'pause': case 'resume': case 'stop': case 'run-now': cmdRow(cmd); show(`${cmd} queued — the scheduler applies it on its next tick (≤ 30 s)`); break;
  case 'requeue': if (!args[0]) { show('usage: requeue <runId>'); process.exit(1); } cmdRow(`requeue:${args[0]}`); show(`requeue of ${args[0]} queued`); break;
  case 'settings': show(validateSettings(getSettings(db)).value); break;
  case 'set': {
    const cur = validateSettings(getSettings(db)).value, upd = {};
    for (const a of args) { const i = a.indexOf('='); if (i < 1) continue; const k = a.slice(0, i), raw = a.slice(i + 1); if (!(k in DEFAULTS)) { show(`unknown setting "${k}"`); process.exit(1); } try { upd[k] = JSON.parse(raw); } catch { upd[k] = raw; } }
    const v = validateSettings({ ...cur, ...upd });
    if (!v.ok) { show({ saved: false, errors: v.errors }); process.exit(1); }
    putSettings(db, upd); show({ saved: upd });
    break;
  }
  default: show('commands: status | runs [n] | events [n] | pause | resume | stop | requeue <runId> | run-now | settings | set key=value ...'); process.exit(cmd ? 1 : 0);
}
