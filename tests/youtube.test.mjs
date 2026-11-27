// YouTube publishing against a SIMULATED Google API (no network, no credentials). Proves the upload/resume/quota/
// auth/duplicate logic; a real upload to a test channel is a separate acceptance step that needs the user's OAuth setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDb } from '../automation/db.mjs';
import { makeYouTube } from '../automation/youtube.mjs';

const SIZE = 20 * 1024 * 1024;   // 20 MB → 3 chunks of 8 MB
const file = path.join(os.tmpdir(), `cf-yt-${process.pid}.mp4`);
const fileBytes = Buffer.alloc(SIZE, 7);
fs.writeFileSync(file, fileBytes);
const S = { publishMode: 'private-upload' };
// The Quality Gate blocks any upload without a PASS inspection bound to this exact file (sha256).
const FILE_SHA = crypto.createHash('sha256').update(fileBytes).digest('hex');
const PASS_QA = { data: { qualityReport: { status: 'PASS', overallScore: 92, defects: [], technicalReport: { mandatoryFailed: [] }, videoSha256: FILE_SHA, inspectedAt: '2026-11-27T00:00:00.000Z' } } };

/** fake Google: token endpoint, resumable init, chunk PUTs (optionally dropping one), videos.list */
function fakeGoogle({ dropChunkAt = null, refreshError = null, statusItem = null } = {}) {
  const st = { received: 0, inits: 0, puts: 0, dropped: false };
  const res = (status, body = {}, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });
  const fetchFn = async (url, o = {}) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) return refreshError ? res(400, { error: refreshError, error_description: 'Token has been expired or revoked.' }) : res(200, { access_token: 'at', expires_in: 3600 });
    if (url.includes('uploadType=resumable')) { st.inits++; return res(200, {}, { location: 'https://upload.example/session/1' }); }
    if (url.startsWith('https://upload.example/session/1')) {
      st.puts++;
      const cr = o.headers['Content-Range'];
      if (cr.startsWith('bytes */')) return st.received >= SIZE ? res(201, { id: 'VID1', status: { privacyStatus: 'private' } }) : res(308, {}, st.received ? { range: `bytes=0-${st.received - 1}` } : {});
      const [a, b] = cr.slice(6).split('/')[0].split('-').map(Number);
      if (dropChunkAt != null && a >= dropChunkAt && !st.dropped) { st.dropped = true; throw Object.assign(new Error('socket hang up'), { cause: { code: 'ECONNRESET' } }); }
      assert.equal(a, st.received, 'chunks must continue exactly where Google confirmed');
      st.received = b + 1;
      return st.received >= SIZE ? res(201, { id: 'VID1', status: { privacyStatus: 'private', publishAt: null } }) : res(308, {}, { range: `bytes=0-${b}` });
    }
    if (url.includes('/youtube/v3/videos?part=status')) return res(200, { items: [statusItem || { status: { privacyStatus: 'private', uploadStatus: 'processed' }, processingDetails: { processingStatus: 'succeeded' } }] });
    throw new Error(`unexpected ${url}`);
  };
  return { fetchFn, st };
}
function setup(opts = {}, run = {}) {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO runs (id, slot, status, stage, attempt, topic, video_path, video_sha, created_at, updated_at) VALUES ('r1', 's1', 'running', 'upload', 0, 'Octopus hearts', ?, 'sha-A', 'x', 'x')").run(file);
  const g = fakeGoogle(opts);
  let tok = { refresh_token: 'rt' };
  const yt = makeYouTube({ fetchFn: g.fetchFn, db, store: { client: { installed: { client_id: 'c', client_secret: 's' } }, read: () => tok, write: (t) => { tok = t; } } });
  const getRun = () => db.prepare("SELECT * FROM runs WHERE id = 'r1'").get();
  return { db, yt, g, getRun, run: () => ({ ...getRun(), ...run }) };
}
const ctx = (db, s = S) => ({ settings: s, checkpoints: { qa: PASS_QA, metadata: { data: { title: 'Why do octopuses have three hearts? #Shorts', tags: ['octopus'] } } }, db });

test('resumable upload in chunks; the session is saved before any byte is sent', async () => {
  const h = setup();
  const out = await h.yt.upload(h.run(), ctx(h.db));
  assert.equal(out.fields.youtube_video_id, 'VID1'); assert.equal(h.g.st.inits, 1); assert.equal(h.g.st.received, SIZE);
});

test('interrupted upload resumes from the byte offset Google confirmed (not from zero, no new session)', async () => {
  const h = setup({ dropChunkAt: 8 * 1024 * 1024 });
  await assert.rejects(h.yt.upload(h.run(), ctx(h.db)), (e) => e.failureClass === 'upload_interrupted');
  assert.equal(h.getRun().upload_session, 'https://upload.example/session/1');   // persisted
  const out = await h.yt.upload(h.run(), ctx(h.db));                                // the scheduler's retry
  assert.equal(out.fields.youtube_video_id, 'VID1'); assert.equal(h.g.st.inits, 1); assert.equal(h.g.st.received, SIZE);
});

test('duplicate prevention: a run that has a video ID, or the same video uploaded by another run, is not uploaded again', async () => {
  const h = setup();
  const again = await h.yt.upload({ ...h.run(), youtube_video_id: 'VID0' }, ctx(h.db));
  assert.equal(again.data.reused, true); assert.equal(h.g.st.inits, 0);
  h.db.prepare("INSERT INTO runs (id, slot, status, stage, attempt, video_sha, youtube_video_id, youtube_url, created_at, updated_at) VALUES ('r0','s0','published','record',0,'sha-A','VIDX','https://youtu.be/VIDX','x','x')").run();
  const dup = await h.yt.upload(h.run(), ctx(h.db));
  assert.equal(dup.fields.youtube_video_id, 'VIDX'); assert.equal(h.g.st.inits, 0);
});

test('revoked authorization → youtube_auth (permanent: re-authorize once)', async () => {
  const h = setup({ refreshError: 'invalid_grant' });
  await assert.rejects(h.yt.upload(h.run(), ctx(h.db)), (e) => e.failureClass === 'youtube_auth' && /revoked/.test(e.message));
});

test('quota: an upload that does not fit the remaining daily quota is not attempted', async () => {
  const h = setup();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
  h.db.prepare("INSERT INTO settings (key, value) VALUES (?, '9000')").run(`quota:${day}`);
  await assert.rejects(h.yt.upload(h.run(), ctx(h.db)), (e) => e.failureClass === 'youtube_quota');
  assert.equal(h.g.st.inits, 0);
});

test('scheduled-public: publishAt is sent; confirmPublished waits until YouTube made it public', async () => {
  const h = setup({}, { publish_at: '2026-11-16T12:30:00.000Z' });
  let sent = null;
  const orig = h.g.fetchFn;
  const yt = (await import('../automation/youtube.mjs')).makeYouTube({ db: h.db, store: { client: { installed: { client_id: 'c', client_secret: 's' } }, read: () => ({ refresh_token: 'rt', access_token: 'at', expires_at: Date.now() + 3600e3 }), write() {} },
    fetchFn: async (u, o) => { if (u.includes('uploadType=resumable')) sent = JSON.parse(o.body); return orig(u, o); } });
  await yt.upload(h.run(), ctx(h.db, { publishMode: 'scheduled-public', youtubePrivacy: 'public' }));
  assert.equal(sent.status.privacyStatus, 'private'); assert.equal(sent.status.publishAt, '2026-11-16T12:30:00.000Z'); assert.equal(sent.status.containsSyntheticMedia, true);
  const r = { ...h.run(), youtube_video_id: 'VID1' };
  await assert.rejects(yt.confirmPublished(r, { settings: { publishMode: 'scheduled-public', youtubePrivacy: 'public' } }), /not public yet/);
});

test('manual upload without prior DB row creates row and saves resumable session on interruption', async () => {
  const db = openDb(':memory:');
  const g = fakeGoogle({ dropChunkAt: 8 * 1024 * 1024 });
  let tok = { refresh_token: 'rt' };
  const yt = makeYouTube({ fetchFn: g.fetchFn, db, store: { client: { installed: { client_id: 'c', client_secret: 's' } }, read: () => tok, write: (t) => { tok = t; } } });
  const manualRun = { id: 'manual-run-99', video_path: file, topic: 'Manual Video' };
  // DB has NO row for manual-run-99 yet
  assert.equal(db.prepare("SELECT 1 FROM runs WHERE id = 'manual-run-99'").get(), undefined);
  await assert.rejects(yt.upload(manualRun, { settings: S, db, checkpoints: { qa: PASS_QA } }), (e) => e.failureClass === 'upload_interrupted');
  // Row now exists and upload_session is saved!
  const saved = db.prepare("SELECT * FROM runs WHERE id = 'manual-run-99'").get();
  assert.ok(saved, 'DB row must be created for manual upload');
  assert.equal(saved.upload_session, 'https://upload.example/session/1');
  // Second upload resumes from the saved session
  const out = await yt.upload(saved, { settings: S, db, checkpoints: { qa: PASS_QA } });
  assert.equal(out.fields.youtube_video_id, 'VID1');
  assert.equal(g.st.inits, 1);   // No second videos.insert
});

test('ambiguous timeout during upload initiation marks the run for reconciliation and is not blindly retried', async () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO runs (id, slot, status, stage, attempt, topic, video_path, video_sha, created_at, updated_at) VALUES ('r-timeout', 's-to', 'running', 'upload', 0, 'Timeout run', ?, 'sha-T', 'x', 'x')").run(file);
  let tok = { refresh_token: 'rt' };
  // fake fetch that throws a timeout on videos.insert
  const fetchTimeout = async (url) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }) };
    if (url.includes('uploadType=resumable')) throw Object.assign(new Error('connection timed out'), { cause: { code: 'ETIMEDOUT' } });
    throw new Error(`unexpected ${url}`);
  };
  const yt = makeYouTube({ fetchFn: fetchTimeout, db, store: { client: { installed: { client_id: 'c', client_secret: 's' } }, read: () => tok, write: (t) => { tok = t; } } });
  const runRow = db.prepare("SELECT * FROM runs WHERE id = 'r-timeout'").get();
  await assert.rejects(yt.upload(runRow, { settings: S, db, checkpoints: { qa: PASS_QA } }), (e) => e.failureClass === 'reconciliation');
  const updated = db.prepare("SELECT * FROM runs WHERE id = 'r-timeout'").get();
  assert.equal(updated.status, 'needs_reconciliation');
  assert.equal(updated.failure_class, 'reconciliation');
  assert.ok(updated.last_error.includes('Ambiguous timeout'));
  // And verify classify marks reconciliation as retry: false
  const { CLASSES, classify } = await import('../automation/classify.mjs');
  assert.equal(CLASSES.reconciliation.retry, false);
  assert.equal(classify(new Error('ambiguous timeout')), 'reconciliation');
});

test('restart recovery: process killed mid-upload restarts, reads saved session and resumes without restarting from zero', async () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO runs (id, slot, status, stage, attempt, topic, video_path, video_sha, created_at, updated_at) VALUES ('r-restart', 's-rst', 'running', 'upload', 0, 'Restart run', ?, 'sha-R', 'x', 'x')").run(file);
  const g = fakeGoogle({ dropChunkAt: 8 * 1024 * 1024 });
  let tok = { refresh_token: 'rt' };
  const yt1 = makeYouTube({ fetchFn: g.fetchFn, db, store: { client: { installed: { client_id: 'c', client_secret: 's' } }, read: () => tok, write: (t) => { tok = t; } } });
  // Process 1 starts upload and dies at 8MB
  const run1 = db.prepare("SELECT * FROM runs WHERE id = 'r-restart'").get();
  await assert.rejects(yt1.upload(run1, { settings: S, db, checkpoints: { qa: PASS_QA } }));
  assert.equal(db.prepare("SELECT upload_session FROM runs WHERE id = 'r-restart'").get().upload_session, 'https://upload.example/session/1');

  // Process 2 (simulating a restarted studio / scheduler process) starts fresh
  const yt2 = makeYouTube({ fetchFn: g.fetchFn, db, store: { client: { installed: { client_id: 'c', client_secret: 's' } }, read: () => tok, write: (t) => { tok = t; } } });
  const restartedRun = db.prepare("SELECT * FROM runs WHERE id = 'r-restart'").get();
  assert.ok(restartedRun.upload_session);
  const out = await yt2.upload(restartedRun, { settings: S, db, checkpoints: { qa: PASS_QA } });
  assert.equal(out.fields.youtube_video_id, 'VID1');
  assert.equal(g.st.inits, 1);   // No new videos.insert on restart
  assert.equal(g.st.received, SIZE);
});

test('captions: SRT builder formats Hindi caption text and validates monotonic timing', async () => {
  const { buildSrtFromLines, parseAndValidateSrt, parseSrtTime } = await import('../automation/publish_assets.mjs');
  const sampleLines = [
    { i: 0, text: 'क्या आप जानते हैं कि पृथ्वी का जन्म कैसे हुआ?', start: 0.5, end: 4.2 },
    { i: 1, text: 'साढ़े चार अरब साल पहले एक विशाल धूल का बादल था।', start: 4.8, end: 9.1 },
    { i: 2, text: 'यह गुरुत्वाकर्षण के कारण सिकुड़ने लगा।', start: 9.3, end: 14.0 },
  ];
  const srt = buildSrtFromLines(sampleLines);
  const val = parseAndValidateSrt(srt);
  assert.equal(val.ok, true);
  assert.equal(val.count, 3);
  assert.equal(val.blocks[0].text, 'क्या आप जानते हैं कि पृथ्वी का जन्म कैसे हुआ?');
  assert.ok(val.blocks[1].start >= val.blocks[0].end);
  assert.ok(val.blocks[2].start >= val.blocks[1].end);

  // Non-monotonic or malformed SRT must be rejected
  const badSrt = `1\n00:00:05,000 --> 00:00:02,000\nखराब टाइमिंग`;
  assert.equal(parseAndValidateSrt(badSrt).ok, false);
});

test('thumbnails and captions: upload calls with fake fetch', async () => {
  const requests = [];
  const fakeFetch = async (url, opts = {}) => {
    requests.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600 }) };
    if (url.includes('/thumbnails/set')) return { ok: true, status: 200, json: async () => ({ default: { url: 'https://i.ytimg.com/vi/VID1/default.jpg' } }) };
    if (url.includes('/captions')) return { ok: true, status: 200, json: async () => ({ id: 'CAP1', snippet: { language: 'hi' } }) };
    throw new Error(`unexpected ${url}`);
  };
  const testThumb = path.join(os.tmpdir(), `cf-thumb-${process.pid}.jpg`);
  fs.writeFileSync(testThumb, Buffer.alloc(1024, 9));
  const testSrt = `1\n00:00:01,000 --> 00:00:04,000\nपरीक्षण कैप्शन\n`;

  const yt = makeYouTube({ fetchFn: fakeFetch, store: { client: { installed: { client_id: 'c', client_secret: 's' } }, read: () => ({ refresh_token: 'rt', access_token: 'at', expires_at: Date.now() + 3600e3 }), write() {} } });
  
  const thumbRes = await yt.setThumbnail('VID1', testThumb);
  assert.equal(thumbRes.bytes, 1024);
  const thumbReq = requests.find((r) => r.url.includes('/thumbnails/set'));
  assert.ok(thumbReq);
  assert.equal(thumbReq.headers['Content-Type'], 'image/jpeg');

  const capRes = await yt.uploadCaptions('VID1', testSrt, { language: 'hi', name: 'Hindi' });
  assert.equal(capRes.captionId, 'CAP1');
  const capReq = requests.find((r) => r.url.includes('/captions'));
  assert.ok(capReq);
  assert.ok(capReq.headers['Content-Type'].includes('multipart/related'));

  fs.rmSync(testThumb, { force: true });
});

test('dashboard YouTube API routes: status, connect, disconnect, test without exposing secrets', async () => {
  const http = await import('node:http');
  let tok = { refresh_token: 'secret-refresh-token', access_token: 'secret-access-token', expires_at: Date.now() + 3600e3, channel: { channelId: 'CH123', channelTitle: 'My Channel' } };
  const mockYt = makeYouTube({
    fetchFn: async (url) => {
      if (url.includes('channels?')) return { ok: true, status: 200, json: async () => ({ items: [{ id: 'CH123', snippet: { title: 'My Channel' } }] }) };
      if (url.includes('revoke')) return { ok: true, status: 200 };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    store: {
      client: { installed: { client_id: 'client-id-xyz', client_secret: 'client-secret-abc' } },
      read: () => tok,
      write: (t) => { tok = t; },
      clear: () => { tok = null; }
    }
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (p === '/api/automation/youtube/status' && req.method === 'GET') {
      const st = mockYt.status();
      return send(200, {
        authorized: !!st.authorized,
        authorizedAt: st.authorizedAt || null,
        channelTitle: st.channel?.channelTitle || null,
        channelId: st.channel?.channelId || null,
        quotaUsedToday: st.quotaUsedToday ?? 0,
        quotaDaily: st.quotaDaily || 10000,
        clientSecret: !!st.clientSecret,
      });
    }
    if (p === '/api/automation/youtube/connect' && req.method === 'POST') {
      return send(200, { ok: true, message: 'Google authorization page opened in your browser' });
    }
    if (p === '/api/automation/youtube/disconnect' && req.method === 'POST') {
      const r = await mockYt.disconnect();
      return send(200, { ok: true, revoked: r.revoked, detail: r.detail });
    }
    if (p === '/api/automation/youtube/test' && req.method === 'POST') {
      try {
        const ch = await mockYt.verifyChannel();
        return send(200, { ok: true, channelId: ch.channelId, channelTitle: ch.channelTitle, customUrl: ch.customUrl, channelCount: ch.channelCount });
      } catch (e) {
        return send(400, { ok: false, error: e.message });
      }
    }
    send(404, { error: 'not found' });
  });

  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. status check
    const rStatus = await fetch(`${base}/api/automation/youtube/status`);
    const jStatus = await rStatus.json();
    assert.equal(jStatus.authorized, true);
    assert.equal(jStatus.channelTitle, 'My Channel');
    assert.equal(jStatus.channelId, 'CH123');

    // 2. connect check
    const rConn = await fetch(`${base}/api/automation/youtube/connect`, { method: 'POST' });
    const jConn = await rConn.json();
    assert.equal(jConn.ok, true);

    // 3. test connection check
    const rTest = await fetch(`${base}/api/automation/youtube/test`, { method: 'POST' });
    const jTest = await rTest.json();
    assert.equal(jTest.ok, true);
    assert.equal(jTest.channelId, 'CH123');

    // 4. disconnect check
    const rDisc = await fetch(`${base}/api/automation/youtube/disconnect`, { method: 'POST' });
    const jDisc = await rDisc.json();
    assert.equal(jDisc.ok, true);
    assert.equal(tok, null);

    // 5. SECRECY CHECK: Grep all responses to guarantee no secrets ever leak
    const allResponses = [JSON.stringify(jStatus), JSON.stringify(jConn), JSON.stringify(jTest), JSON.stringify(jDisc)].join(' ');
    assert.ok(!allResponses.includes('secret-refresh-token'), 'refresh token must never appear in response');
    assert.ok(!allResponses.includes('secret-access-token'), 'access token must never appear in response');
    assert.ok(!allResponses.includes('client-secret-abc'), 'client secret must never appear in response');
    assert.ok(!allResponses.includes('client-id-xyz'), 'client id must never appear in response');
  } finally {
    server.close();
  }
});

test('quality gate: an upload without a passing inspection is blocked before any YouTube call', async () => {
  const h = setup();
  await assert.rejects(h.yt.upload(h.run(), { settings: S, db: h.db, checkpoints: {} }), (e) => e.failureClass === 'quality_gate_failed' && /never completed Quality Gate/.test(e.message));
  assert.equal(h.g.st.inits, 0);
});

test('quality gate: a FAIL inspection blocks the upload', async () => {
  const h = setup();
  const failQa = { data: { qualityReport: { ...PASS_QA.data.qualityReport, status: 'FAILED', overallScore: 60 } } };
  await assert.rejects(h.yt.upload(h.run(), { settings: S, db: h.db, checkpoints: { qa: failQa } }), (e) => e.failureClass === 'quality_gate_failed');
  assert.equal(h.g.st.inits, 0);
});

test('quality gate: a video changed after inspection (hash mismatch) is blocked', async () => {
  const h = setup();
  const staleQa = { data: { qualityReport: { ...PASS_QA.data.qualityReport, videoSha256: '0'.repeat(64) } } };
  await assert.rejects(h.yt.upload(h.run(), { settings: S, db: h.db, checkpoints: { qa: staleQa } }), (e) => e.failureClass === 'quality_gate_failed' && /changed since inspection/.test(e.message));
  assert.equal(h.g.st.inits, 0);
});

test.after(() => fs.rmSync(file, { force: true }));
