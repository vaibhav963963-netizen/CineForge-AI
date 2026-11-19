// YouTube publishing against a SIMULATED Google API (no network, no credentials). Proves the upload/resume/quota/
// auth/duplicate logic; a real upload to a test channel is a separate acceptance step that needs the user's OAuth setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../automation/db.mjs';
import { makeYouTube } from '../automation/youtube.mjs';

const SIZE = 20 * 1024 * 1024;   // 20 MB → 3 chunks of 8 MB
const file = path.join(os.tmpdir(), `cf-yt-${process.pid}.mp4`);
fs.writeFileSync(file, Buffer.alloc(SIZE, 7));
const S = { publishMode: 'private-upload' };

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
const ctx = (db, s = S) => ({ settings: s, checkpoints: { metadata: { data: { title: 'Why do octopuses have three hearts? #Shorts', tags: ['octopus'] } } }, db });

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
  await yt.upload(h.run(), ctx(h.db, { publishMode: 'scheduled-public' }));
  assert.equal(sent.status.privacyStatus, 'private'); assert.equal(sent.status.publishAt, '2026-11-16T12:30:00.000Z'); assert.equal(sent.status.containsSyntheticMedia, true);
  const r = { ...h.run(), youtube_video_id: 'VID1' };
  await assert.rejects(yt.confirmPublished(r, { settings: { publishMode: 'scheduled-public' } }), /not public yet/);
});

test.after(() => fs.rmSync(file, { force: true }));
