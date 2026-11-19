// Automation scheduler — simulated acceptance with a FAKE CLOCK and a SIMULATED executor (no GPU, no studio, no
// YouTube). Each test is one behaviour from the specification. Real unattended runs are a separate, later step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, putSettings, checkpoints, getRun } from '../automation/db.mjs';
import { Engine, STAGES } from '../automation/engine.mjs';
import { classify } from '../automation/classify.mjs';
import { instantOf, zoned, validateSettings } from '../automation/settings.mjs';

const IST = (d, hm) => instantOf(d, hm, 'Asia/Kolkata');
function harness({ settings = {}, start = IST('2026-11-16', '07:59'), failures = {} } = {}) {
  const db = openDb(':memory:');
  putSettings(db, { enabled: true, publishMode: 'private-upload', retryCount: 3, quietHours: { start: '23:00', end: '06:00' }, ...settings });
  let now = start;
  const calls = Object.fromEntries(STAGES.map((s) => [s, 0]));
  // failures: { stage: [Error|null, ...] } consumed per call; null = success
  const executor = Object.fromEntries(STAGES.map((st) => [st, async (run) => {
    calls[st]++;
    const f = failures[st]?.shift();
    if (f) throw f;
    if (st === 'topic') return { fields: { topic: 'Why do octopuses have three hearts?' } };
    if (st === 'upload') return { fields: { youtube_video_id: 'vid123', youtube_url: 'https://youtu.be/vid123' } };
    return { data: { ok: true } };
  }]));
  executor.cancel = async () => { calls.cancel = (calls.cancel || 0) + 1; };
  const res = { freeDiskGB: 100, freeRamGB: 8, studioBusy: false };
  const engine = new Engine({ db, clock: () => now, executor, resources: async () => ({ ...res }) });
  const at = (iso) => { now = iso; };
  const advance = (min) => { now += min * 60000; };
  // run ticks until nothing is due now (bounded)
  const drain = async (max = 40) => { const out = []; for (let k = 0; k < max; k++) { const r = await engine.tick(); out.push(r); if (r.idle || r.waiting || r.result === 'retry' || r.result === 'dead' || r.result === 'awaiting manual publish' || r.result === 'waiting for publish slot') break; } return out; };
  return { db, engine, calls, res, at, advance, drain, now: () => now };
}
const runs = (db) => db.prepare('SELECT * FROM runs ORDER BY created_at').all();
const err = (msg) => new Error(msg);

test('1 · production starts on schedule (not before) and runs every stage to completion', async () => {
  const h = harness();
  assert.equal((await h.engine.tick()).idle, 'nothing due');            // 07:59 — nothing yet
  h.advance(1);                                                          // 08:00 IST
  await h.drain();
  const r = runs(h.db)[0];
  assert.equal(r.status, 'published'); assert.equal(r.youtube_video_id, 'vid123');
  assert.deepEqual(Object.values(h.calls).slice(0, 8), [1, 1, 1, 1, 1, 1, 1, 1]);
});

test('2 · restart mid-stage resumes the same run ID from its first incomplete stage; finished stages are not re-run', async () => {
  const h = harness();
  h.advance(1);
  for (let k = 0; k < 3; k++) await h.engine.tick();                   // topic, script, render done
  const id = runs(h.db)[0].id;
  h.db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(id);   // process died while running "qa"
  const engine2 = new Engine({ db: h.db, clock: h.now, executor: h.engine.executor, resources: h.engine.resources });   // new process
  for (let k = 0; k < 10; k++) await engine2.tick();
  const r = getRun(h.db, id);
  assert.equal(r.status, 'published'); assert.equal(runs(h.db).length, 1);
  assert.equal(h.calls.script, 1); assert.equal(h.calls.render, 1);    // never regenerated
  assert.equal(Object.keys(checkpoints(h.db, id)).length, 8);
});

test('3 · network failure during research → backoff retry, then success', async () => {
  const h = harness({ failures: { topic: [err('getaddrinfo ENOTFOUND www.googleapis.com')] } });
  h.advance(1);
  const r1 = await h.engine.tick();
  assert.equal(r1.result, 'retry'); assert.equal(r1.failureClass, 'network');
  assert.equal(new Date(r1.at).toISOString(), new Date(IST('2026-11-16', '08:30')).toISOString());
  h.at(r1.at); await h.drain();
  assert.equal(runs(h.db)[0].status, 'published');
});

test('4 · rendering interrupted → retried from the render stage (script not regenerated)', async () => {
  const h = harness({ failures: { render: [err('Failed during WebGL frame capture: Chrome exited')] } });
  h.advance(1);
  const out = await h.drain();
  assert.equal(out.at(-1).failureClass, 'render');
  h.at(out.at(-1).at); await h.drain();
  assert.equal(h.calls.script, 1); assert.equal(h.calls.render, 2); assert.equal(runs(h.db)[0].status, 'published');
});

test('5 · insufficient storage → heavy stage does not start; retries and continues when space is back', async () => {
  const h = harness();
  h.res.freeDiskGB = 4; h.advance(1);
  const out = await h.drain();
  assert.equal(out.at(-1).failureClass, 'disk'); assert.equal(h.calls.script, 0);
  h.res.freeDiskGB = 80; h.at(out.at(-1).at); await h.drain();
  assert.equal(runs(h.db)[0].status, 'published');
});

test('6 · model failure is classified and retried', async () => {
  const h = harness({ failures: { script: [err('Failed during Script generation (local LLM): script model HTTP 500')] } });
  h.advance(1);
  const out = await h.drain();
  assert.equal(out.at(-1).failureClass, 'model_unavailable');
  h.at(out.at(-1).at); await h.drain();
  assert.equal(runs(h.db)[0].status, 'published');
});

test('7 · upload interruption is retried (resumable class) without re-rendering', async () => {
  const h = harness({ failures: { upload: [err('upload interrupted: socket hang up at byte 18874368')] } });
  h.advance(1);
  const out = await h.drain();
  assert.equal(out.at(-1).failureClass, 'upload_interrupted');
  h.at(out.at(-1).at); await h.drain();
  assert.equal(h.calls.render, 1); assert.equal(h.calls.upload, 2); assert.equal(runs(h.db)[0].status, 'published');
});

test('8 · retry timing follows the slots: 08:00 → 08:30 → 10:00 → next recovery window → dead-letter', async () => {
  const fails = Array.from({ length: 5 }, () => err('Failed during Kokoro TTS narration: voice.py crashed'));
  const h = harness({ failures: { render: fails } });
  h.advance(1);
  const seen = [];
  let out = await h.drain();
  for (let k = 0; k < 4 && out.at(-1).result === 'retry'; k++) { seen.push(zoned(out.at(-1).at, 'Asia/Kolkata').time); h.at(out.at(-1).at); out = await h.drain(); }
  assert.deepEqual(seen, ['08:30', '10:00', '13:00']);
  assert.equal(out.at(-1).result, 'dead'); assert.equal(runs(h.db)[0].status, 'dead');
});

test('9 · checkpoints: a dead run requeued resumes at its failed stage with the same run ID', async () => {
  const h = harness({ settings: { retryCount: 0 }, failures: { qa: [err('ffprobe: invalid data found')] } });
  h.advance(1);
  await h.drain();
  const r = runs(h.db)[0]; assert.equal(r.status, 'dead'); assert.equal(r.stage, 'qa');
  h.engine.command(`requeue:${r.id}`); await h.drain();
  const r2 = getRun(h.db, r.id);
  assert.equal(r2.status, 'published'); assert.equal(h.calls.render, 1); assert.equal(runs(h.db).length, 1);
});

test('10 · duplicate prevention: repeated ticks and a second engine never create a second run for the slot', async () => {
  const h = harness();
  h.advance(1);
  const e2 = new Engine({ db: h.db, clock: h.now, executor: h.engine.executor, resources: h.engine.resources });
  h.engine.schedule(h.engine.settings()); e2.schedule(e2.settings()); h.engine.schedule(h.engine.settings());
  assert.equal(runs(h.db).length, 1);
});

test('11 · scheduled publishing happens at the configured time, not before; overdue videos take the next free slot', async () => {
  const h = harness({ settings: { publishMode: 'scheduled-public', publishTime: '18:00' } });
  h.advance(1);
  const out = await h.drain();
  assert.equal(out.at(-1).result, 'waiting for publish slot');
  const r = runs(h.db)[0];
  assert.equal(zoned(Date.parse(r.publish_at), 'Asia/Kolkata').time, '18:00');
  assert.equal(h.calls.publish, 0);
  h.at(Date.parse(r.publish_at)); await h.drain();
  assert.equal(getRun(h.db, r.id).status, 'published'); assert.equal(h.calls.publish, 1);
  // a second video the same day never shares the 18:00 slot (no burst publishing)
  const h2 = harness({ settings: { publishMode: 'scheduled-public', maxVideosPerDay: 2 } });
  h2.advance(1); await h2.drain(); await h2.drain();
  const slots = runs(h2.db).map((x) => x.publish_at).filter(Boolean);
  assert.equal(new Set(slots).size, slots.length);
});

test('12 · the next scheduled job starts automatically the next day', async () => {
  const h = harness();
  h.advance(1); await h.drain();
  h.at(IST('2026-11-17', '08:00')); await h.drain();
  const rs = runs(h.db);
  assert.equal(rs.length, 2); assert.deepEqual(rs.map((r) => r.slot), ['2026-11-16#1', '2026-11-17#1']); assert.ok(rs.every((r) => r.status === 'published'));
});

test('missed execution: a slot missed while the PC was off runs once; older than 24 h is skipped', async () => {
  // automation was enabled the day before; the PC was off at 08:00 and is switched on at 11:30
  const h = harness({ start: IST('2026-11-16', '11:30'), settings: { enabledSince: '2026-11-15T00:00:00.000Z' } });
  await h.drain(); await h.drain();
  assert.equal(runs(h.db).length, 1);
  assert.ok(h.db.prepare("SELECT 1 FROM events WHERE message LIKE '%missed by%'").get());
  const h2 = harness({ start: IST('2026-11-18', '07:00'), settings: { productionDays: ['mon'], enabledSince: '2026-11-10T00:00:00.000Z' } });   // Monday's slot is 47 h old
  await h2.drain(); assert.equal(runs(h2.db).length, 0);
  // turning automation on at 11:30 does NOT produce a video for that morning's 08:00 slot
  const h3 = harness({ start: IST('2026-11-16', '11:30') });
  await h3.drain(); assert.equal(runs(h3.db).length, 0);
});

test('YouTube OAuth failure is permanent (dead-letter, no retry); quota waits for the next day', async () => {
  const h = harness({ failures: { upload: [err('invalid_grant: Token has been expired or revoked.')] } });
  h.advance(1); const out = await h.drain();
  assert.equal(out.at(-1).result, 'dead'); assert.equal(out.at(-1).failureClass, 'youtube_auth');
  const q = harness({ failures: { upload: [err('YouTube API error 403: quotaExceeded')] } });
  q.advance(1); const o2 = await q.drain();
  assert.equal(o2.at(-1).failureClass, 'youtube_quota');
  assert.equal(zoned(o2.at(-1).at, 'Asia/Kolkata').date, '2026-11-17');
});

test('quiet hours: no heavy stage starts between 23:00 and 06:00', async () => {
  const h = harness({ settings: { productionTime: '23:30' }, start: IST('2026-11-16', '23:30') });
  const out = await h.drain();
  assert.equal(h.calls.script, 0);
  assert.equal(out.at(-1).waiting, 'quiet hours');
  assert.equal(zoned(Date.parse(runs(h.db)[0].next_attempt_at), 'Asia/Kolkata').time, '06:00');
});

test('pause / resume / emergency stop', async () => {
  const h = harness();
  h.engine.command('pause'); h.advance(1);
  assert.equal((await h.engine.tick()).idle, 'paused'); assert.equal(runs(h.db).length, 0);
  h.engine.command('resume'); await h.engine.tick(); await h.engine.tick();
  const id = runs(h.db)[0].id;
  h.db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(id);
  h.engine.command('stop'); await h.engine.tick();
  assert.equal(h.calls.cancel, 1); assert.equal(getRun(h.db, id).status, 'waiting_retry'); assert.equal(h.engine.state(), 'paused');
  h.engine.command('resume'); await h.drain();
  assert.equal(getRun(h.db, id).status, 'published');
});

test('manual publish mode: verified video waits for a person and is never uploaded automatically', async () => {
  const h = harness({ settings: { publishMode: 'manual' } });
  h.advance(1); await h.drain(); h.advance(600); await h.drain();
  assert.equal(runs(h.db)[0].status, 'awaiting_publish'); assert.equal(h.calls.upload, 0);
});

test('classification of real CineForge / YouTube error messages', () => {
  const cases = {
    'Failed during Kokoro TTS narration: the narration reads 72.1 s at a natural pace': 'voice',
    'Failed during Script generation (local LLM): Script v1: the local model\'s proof-read still flags 8 line(s)': 'model_unavailable',
    'Script v3 would last about 55 s for a 40 s target.': 'script_validation',
    'ComfyUI history wait timed out': 'visual',
    'ENOSPC: no space left on device, write': 'disk',
    'ErrorOutOfDeviceMemory (vkAllocateMemory)': 'resources',
    'connect ECONNREFUSED 127.0.0.1:3200 — studio server not reachable': 'studio_unavailable',
    'request to https://oauth2.googleapis.com failed, reason: getaddrinfo EAI_AGAIN': 'network',
  };
  for (const [m, c] of Object.entries(cases)) assert.equal(classify(new Error(m)), c, m);
});

test('settings: validation and DST-safe local times', () => {
  assert.equal(validateSettings({ productionTime: '25:00' }).ok, false);
  assert.equal(validateSettings({ timeZone: 'Mars/Olympus' }).ok, false);
  assert.ok(validateSettings({}).ok);
  // US DST starts 2026-03-08: 08:00 New York is 12:00 UTC after the change, 13:00 UTC before it
  assert.equal(new Date(instantOf('2026-03-07', '08:00', 'America/New_York')).toISOString(), '2026-03-07T13:00:00.000Z');
  assert.equal(new Date(instantOf('2026-03-09', '08:00', 'America/New_York')).toISOString(), '2026-03-09T12:00:00.000Z');
});
