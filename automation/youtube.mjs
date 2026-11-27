// CineForge automation — YouTube publishing (official YouTube Data API v3 + OAuth 2.0; no third-party SDK).
//
//  · One-time authorization: `node automation/youtube.mjs authorize` opens Google's consent page; a loopback server
//    on 127.0.0.1 receives the code (PKCE). The refresh token is stored ENCRYPTED with Windows DPAPI
//    (youtube/tokens.dpapi — readable only by this Windows user) and access tokens are refreshed automatically.
//  · Revoked/expired authorization (invalid_grant, 401) → failure class youtube_auth (no retry; re-authorize once).
//  · Resumable upload: the session URI is persisted on the run before any byte is sent; after an interruption or a
//    restart the upload continues from the byte offset Google confirms (308 + Range), never from zero.
//  · Duplicate prevention: a run that already has a video ID, or a video with the same sha256 already uploaded by
//    another run, is never uploaded again.
//  · Quota: units are counted per Pacific-time day (YouTube's quota day); an upload that does not fit the remaining
//    quota is not attempted (class youtube_quota → next day).
//  · Publishing: private-upload → privacyStatus private; scheduled-public → private + publishAt (YouTube publishes
//    at the configured slot); only QA-verified videos ever reach upload().
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, openDb, nowIso } from './db.mjs';
import { CONFIG } from '../dashboard/lib/config.js';
import { assertPublishable } from '../quality-gate/index.js';


export const YT_DIR = path.join(ROOT, 'youtube');
const SECRET = CONFIG.YOUTUBE_CLIENT_SECRET_FILE, TOKENS = CONFIG.YOUTUBE_TOKEN_FILE;
// youtube = full access, needed to change a video's visibility (videos.update); youtube.upload alone cannot
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.force-ssl'];
const COST = { 'videos.insert': 1600, 'videos.list': 1, 'channels.list': 1, 'captions.insert': 400, 'thumbnails.set': 50 };
const DAILY_QUOTA = CONFIG.YOUTUBE_DAILY_QUOTA, CHUNK = 8 * 1024 * 1024;
const fail = (msg, failureClass) => Object.assign(new Error(msg), { failureClass });

// ── DPAPI (current Windows user) — no plaintext token on disk ───────────────────────────────────────────────────
function ps(script, input) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`DPAPI: ${(r.stderr || '').slice(0, 200)}`);
  return r.stdout.trim();
}
export const protect = (text) => ps('Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,"CurrentUser"))', text);
export const unprotect = (b64) => ps('Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,"CurrentUser"))', b64);

export function makeYouTube({ fetchFn = fetch, store = null, clock = Date.now, db = null } = {}) {
  // token store (DPAPI file by default; injectable for tests)
  const tokens = store || {
    read() { try { return JSON.parse(unprotect(fs.readFileSync(TOKENS, 'utf8'))); } catch { return null; } },
    write(t) { fs.mkdirSync(path.dirname(TOKENS), { recursive: true }); fs.writeFileSync(TOKENS, protect(JSON.stringify(t))); },
  };
  const client = () => {
    if (!fs.existsSync(SECRET) && !store) throw fail('YouTube is not set up: youtube/client_secret.json is missing (see docs/automation.md)', 'youtube_auth');
    const j = store?.client || JSON.parse(fs.readFileSync(SECRET, 'utf8'));
    return j.installed || j.web || j;
  };

  // ── quota (YouTube's quota day resets at midnight Pacific time) ───────────────────────────────────────────────
  const quotaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(clock()));
  const quotaDb = () => db || openDb();
  const used = () => { const r = quotaDb().prepare("SELECT value FROM settings WHERE key = ?").get(`quota:${quotaDay()}`); return r ? JSON.parse(r.value) : 0; };
  const spend = (op) => quotaDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + ?").run(`quota:${quotaDay()}`, JSON.stringify(COST[op]), COST[op]);
  const ensureQuota = (op) => { if (used() + COST[op] > DAILY_QUOTA) throw fail(`YouTube quota: ${used()} of ${DAILY_QUOTA} units used today; ${op} needs ${COST[op]} (quotaExceeded — waits for the next quota day)`, 'youtube_quota'); };

  // ── access token (refresh automatically; revoked → youtube_auth) ──────────────────────────────────────────────
  async function accessToken() {
    const t = tokens.read();
    if (!t?.refresh_token) throw fail('YouTube is not authorized yet — run: node automation/youtube.mjs authorize', 'youtube_auth');
    if (t.access_token && t.expires_at > clock() + 60000) return t.access_token;
    const c = client();
    const r = await fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(`YouTube token refresh failed: ${j.error || r.status} ${j.error_description || ''} — authorization was revoked or expired; re-authorize once`, j.error === 'invalid_grant' || r.status === 400 || r.status === 401 ? 'youtube_auth' : 'network');
    tokens.write({ ...t, access_token: j.access_token, expires_at: clock() + (j.expires_in || 3600) * 1000 });
    return j.access_token;
  }
  async function call(op, url, opts = {}) {
    ensureQuota(op);
    const token = await accessToken();   // outside the try: an auth failure must stay youtube_auth, not become "network"
    let r;
    try { r = await fetchFn(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } }); }
    catch (e) {
      if (e?.cause?.code === 'ETIMEDOUT' || /timeout|timed out/i.test(e?.message)) {
        throw Object.assign(new Error(`YouTube ${op}: request timed out (${e.cause?.code || e.message})`), { cause: e.cause, failureClass: op === 'videos.insert' ? 'reconciliation' : 'network' });
      }
      throw fail(`YouTube ${op}: network error (${e.cause?.code || e.message})`, op === 'videos.insert' ? 'upload_interrupted' : 'network');
    }
    spend(op);
    return r;
  }
  const apiError = async (r, op) => {
    const j = await r.json().catch(() => ({})), reason = j.error?.errors?.[0]?.reason || j.error?.status || '';
    const msg = `YouTube API error ${r.status} (${op}): ${reason} ${j.error?.message || ''}`.trim();
    if (/quota|rateLimit|dailyLimit/i.test(reason)) return fail(msg, 'youtube_quota');
    if (r.status === 401 || /auth|permission|forbidden/i.test(reason)) return fail(msg, 'youtube_auth');
    return fail(msg, r.status >= 500 ? 'network' : 'unknown');
  };

  // ── resumable upload ──────────────────────────────────────────────────────────────────────────────────────────
  async function upload(run, { settings: s, checkpoints: cps = {}, db: rdb, log = () => {} }) {
    if (CONFIG.QUALITY_GATE_ENABLED) {
      let qr = cps.qa?.data?.qualityReport;
      if (!qr && run.video_path) {
        const projectDir = run.project_id ? path.join(ROOT, 'projects', run.project_id) : path.dirname(path.dirname(run.video_path));
        const reportFile = path.join(projectDir, 'review', 'quality_report.json');
        if (fs.existsSync(reportFile)) {
          try { qr = JSON.parse(fs.readFileSync(reportFile, 'utf8')); } catch {}
        }
      }
      try {
        assertPublishable({ videoPath: run.video_path, qualityReport: qr, currentRun: run });
      } catch (e) {
        throw fail(e.message, 'quality_gate_failed');
      }
    }
    const d = rdb || db;
    if (run.youtube_video_id) { log(`Already uploaded as ${run.youtube_video_id} — not uploading again`); return { fields: {}, data: { videoId: run.youtube_video_id, reused: true } }; }
    if (run.video_sha && d) {
      const dup = d.prepare('SELECT youtube_video_id, youtube_url FROM runs WHERE video_sha = ? AND youtube_video_id IS NOT NULL AND id != ?').get(run.video_sha, run.id);
      if (dup) { log(`The same video (sha256) is already on YouTube as ${dup.youtube_video_id} — not uploading a duplicate`); return { fields: { youtube_video_id: dup.youtube_video_id, youtube_url: dup.youtube_url }, data: { duplicateOf: dup.youtube_video_id } }; }
    }
    if (!run.video_path || !fs.existsSync(run.video_path)) throw fail(`upload: verified video file missing (${run.video_path})`, 'render');
    const size = fs.statSync(run.video_path).size, meta = cps.metadata?.data || {};
    let session = run.upload_session, offset = 0;
    if (session) {   // resume: ask Google how many bytes it has
      const q = await call('videos.list', session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}`, 'Content-Length': '0' } });
      if (q.status === 200 || q.status === 201) return done(await q.json());
      if (q.status === 308) { const rg = q.headers.get('range'); offset = rg ? +rg.split('-')[1] + 1 : 0; log(`Resuming upload at byte ${offset} of ${size}`); }
      else if (q.status === 404 || q.status === 410) { session = null; log('Upload session expired — starting a new session'); }
      else throw await apiError(q, 'upload resume');
    }
    if (!session) {
      const body = { snippet: { title: meta.title || run.topic, description: meta.description || '', tags: meta.tags || [], categoryId: meta.categoryId || '27', defaultLanguage: meta.defaultLanguage, defaultAudioLanguage: meta.defaultLanguage },
        status: (() => { const priv = s.youtubePrivacy || CONFIG.YOUTUBE_DEFAULT_PRIVACY, sched = s.publishMode === 'scheduled-public' && priv === 'public' && run.publish_at;
          return { privacyStatus: sched ? 'private' : priv, selfDeclaredMadeForKids: !!meta.madeForKids, containsSyntheticMedia: meta.containsSyntheticMedia !== false, ...(sched ? { publishAt: run.publish_at } : {}) }; })() };
      let init;
      try {
        init = await call('videos.insert', 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(size) }, body: JSON.stringify(body) });
      } catch (err) {
        if (err?.failureClass === 'reconciliation' || err?.cause?.code === 'ETIMEDOUT' || /timeout|timed out|ambiguous/i.test(err?.message)) {
          if (d && run.id) {
            d.prepare("UPDATE runs SET status = 'needs_reconciliation', failure_class = 'reconciliation', last_error = ?, updated_at = ? WHERE id = ?")
              .run(`Ambiguous timeout during videos.insert: ${err.message}`, nowIso(clock), run.id);
          }
          throw Object.assign(err, { failureClass: 'reconciliation' });
        }
        throw err;
      }
      if (!init.ok) throw await apiError(init, 'videos.insert');
      session = init.headers.get('location');
      if (!session) throw fail('YouTube did not return an upload session', 'upload_interrupted');
      if (d && run.id) {
        const row = d.prepare('SELECT 1 FROM runs WHERE id = ?').get(run.id);
        if (!row) {
          d.prepare("INSERT OR REPLACE INTO runs (id, slot, status, stage, attempt, topic, video_path, video_sha, upload_session, created_at, updated_at) VALUES (?, ?, 'running', 'upload', 0, ?, ?, ?, ?, ?, ?)")
            .run(run.id, run.slot || `manual_${run.id}`, run.topic || 'Manual Upload', run.video_path, run.video_sha || null, session, nowIso(clock), nowIso(clock));
        } else {
          d.prepare('UPDATE runs SET upload_session = ?, updated_at = ? WHERE id = ?').run(session, nowIso(clock), run.id);   // persisted BEFORE sending bytes
        }
      }
    }
    const fd = fs.openSync(run.video_path, 'r');
    try {
      while (offset < size) {
        const len = Math.min(CHUNK, size - offset), buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, offset);
        const token = await accessToken();
        let r;
        try { r = await fetchFn(session, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Length': String(len), 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` }, body: buf }); }
        catch (e) { throw fail(`upload interrupted at byte ${offset} of ${size} (${e.cause?.code || e.message}) — resumes from the confirmed offset`, 'upload_interrupted'); }
        if (r.status === 308) { const rg = r.headers.get('range'); offset = rg ? +rg.split('-')[1] + 1 : offset + len; log(`Uploaded ${Math.round(offset / size * 100)} %`); continue; }
        if (r.status === 200 || r.status === 201) return done(await r.json());
        if (r.status >= 500) throw fail(`upload interrupted: YouTube ${r.status} at byte ${offset}`, 'upload_interrupted');
        throw await apiError(r, 'upload');
      }
    } finally { fs.closeSync(fd); }
    throw fail('upload ended without a video resource', 'upload_interrupted');
    function done(v) {
      log(`Uploaded: https://youtu.be/${v.id}`);
      if (d && run.id) {
        d.prepare("UPDATE runs SET youtube_video_id = ?, youtube_url = ?, upload_session = NULL, updated_at = ? WHERE id = ?")
          .run(v.id, `https://youtu.be/${v.id}`, nowIso(clock), run.id);
      }
      return { fields: { youtube_video_id: v.id, youtube_url: `https://youtu.be/${v.id}`, upload_session: null }, data: { videoId: v.id, privacy: v.status?.privacyStatus, publishAt: v.status?.publishAt || null, bytes: size } };
    }
  }

  // ── after upload: processing status; scheduled-public is published by YouTube at publishAt ────────────────────
  async function confirmPublished(run, { settings: s, log = () => {} }) {
    const r = await call('videos.list', `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(run.youtube_video_id)}`);
    if (!r.ok) throw await apiError(r, 'videos.list');
    const v = (await r.json()).items?.[0];
    if (!v) throw fail(`YouTube video ${run.youtube_video_id} not found (deleted?)`, 'unknown');
    const st = v.status || {}, proc = v.processingDetails?.processingStatus;
    if (st.uploadStatus === 'failed' || st.uploadStatus === 'rejected' || proc === 'failed') throw fail(`YouTube rejected the video: ${st.failureReason || st.rejectionReason || proc}`, 'render');
    if (proc && proc !== 'succeeded' && proc !== 'terminated') throw fail(`YouTube is still processing the video (${proc})`, 'network');   // retried with backoff
    if (s.publishMode === 'scheduled-public' && (s.youtubePrivacy || CONFIG.YOUTUBE_DEFAULT_PRIVACY) === 'public' && st.privacyStatus !== 'public') throw fail(`video ${run.youtube_video_id} is not public yet (privacy ${st.privacyStatus}, publishAt ${st.publishAt || '–'})`, 'network');
    log(`YouTube status: ${st.privacyStatus}${proc ? ` · processing ${proc}` : ''}`);
    return { data: { privacyStatus: st.privacyStatus, publishAt: st.publishAt || null, processing: proc || null } };
  }

  // ── one-time authorization (loopback + PKCE) ─────────────────────────────────────────────────────────────────
  async function authorize({ openBrowser = true } = {}) {
    const c = client(), verifier = crypto.randomBytes(48).toString('base64url'), challenge = crypto.createHash('sha256').update(verifier).digest('base64url'), state = crypto.randomBytes(16).toString('hex');
    const server = http.createServer();
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const redirect = `http://127.0.0.1:${server.address().port}`;
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: c.client_id, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state })}`;
    console.log(`Open this page to authorize CineForge (it opens automatically):\n${url}\n`);
    if (openBrowser) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    const code = await new Promise((resolve, reject) => {
      server.on('request', (req, res) => {
        const q = new URL(req.url, redirect).searchParams;
        res.end(q.get('code') ? 'CineForge is authorized. You can close this tab.' : `Authorization failed: ${q.get('error')}`);
        if (q.get('state') !== state) return reject(new Error('authorization state mismatch'));
        q.get('code') ? resolve(q.get('code')) : reject(new Error(q.get('error') || 'no code'));
      });
      setTimeout(() => reject(new Error('authorization timed out (5 min)')), 300000).unref();
    }).finally(() => server.close());
    const r = await fetchFn('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }) });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) throw new Error(`token exchange failed: ${j.error || r.status} ${j.error_description || ''}`);
    tokens.write({ refresh_token: j.refresh_token, access_token: j.access_token, expires_at: clock() + (j.expires_in || 3600) * 1000, scope: j.scope, authorizedAt: new Date(clock()).toISOString() });
    return { ok: true };
  }
  const status = () => { const t = (() => { try { return tokens.read(); } catch { return null; } })(); return { clientSecret: !!store || fs.existsSync(SECRET), authorized: !!t?.refresh_token, authorizedAt: t?.authorizedAt || null, channel: t?.channel || null, quotaUsedToday: (() => { try { return used(); } catch { return null; } })(), quotaDaily: DAILY_QUOTA, channel: t?.channel || null }; };

  // ── OAuth client file: validated by structure only; values are never printed ───────────────────────────────
  function validateClientSecret() {
    if (!fs.existsSync(SECRET)) return { ok: false, problem: `not found: ${SECRET}` };
    let j; try { j = JSON.parse(fs.readFileSync(SECRET, 'utf8')); } catch { return { ok: false, problem: 'not valid JSON' }; }
    const c = j.installed || j.web;
    if (!c) return { ok: false, problem: 'no "installed" (Desktop) client block' };
    const missing = ['client_id', 'client_secret', 'auth_uri', 'token_uri'].filter((k) => !c[k]);
    if (missing.length) return { ok: false, problem: `missing fields: ${missing.join(', ')}` };
    if (!j.installed) return { ok: false, problem: 'not a Desktop client (the studio needs an OAuth "Desktop app" client)' };
    return { ok: true, type: 'installed', redirectUris: (c.redirect_uris || []).length };
  }

  // ── channel check: the API must confirm the authorized account has a channel (never assumed) ─────────────────
  async function verifyChannel() {
    ensureQuota('channels.list');
    const r = await call('channels.list', 'https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true');
    if (!r.ok) throw await apiError(r, 'channels.list');
    const j = await r.json(), all = (j.items || []).map((c) => ({ channelId: c.id, channelTitle: c.snippet?.title || '', customUrl: c.snippet?.customUrl || null }));
    const ch = all[0];
    if (!ch?.channelId) throw fail('This Google account has no YouTube channel. Create one at youtube.com, then connect again.', 'youtube_auth');
    // the API returns every channel of the account; the first one is stored, and ALL are reported so the owner can confirm the right one
    const info = { channelId: ch.channelId, channelTitle: ch.channelTitle, customUrl: ch.customUrl, channelCount: all.length, channels: all, verifiedAt: new Date(clock()).toISOString() };
    tokens.write({ ...(tokens.read() || {}), channel: info });
    return info;
  }

  // ── disconnect: revoke at Google, then delete the local encrypted token (even if the revoke call fails) ──────
  async function disconnect() {
    const t = tokens.read();
    let revoked = false, detail = 'no stored authorization';
    if (t?.refresh_token) {
      try {
        const r = await fetchFn('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refresh_token }) });
        revoked = r.ok; detail = r.ok ? 'revoked at Google' : `Google returned ${r.status}; local copy removed anyway`;
      } catch (e) { detail = `could not reach Google (${e.cause?.code || e.message}); local copy removed, revoke it at myaccount.google.com if needed`; }
    }
    if (!store) { try { fs.rmSync(TOKENS, { force: true }); } catch {} } else if (store.clear) store.clear();
    return { ok: true, revoked, detail };
  }

  // ── captions (SRT, one language) and the cover image: both attach to an uploaded video; never re-upload the video ──
  async function uploadCaptions(videoId, srt, { language = 'hi', name = 'Subtitles' } = {}) {
    const boundary = 'cf' + crypto.randomBytes(8).toString('hex');
    const meta = JSON.stringify({ snippet: { videoId, language, name, isDraft: false } });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`, 'utf8'),
      Buffer.from(srt, 'utf8'), Buffer.from(`\r\n--${boundary}--`, 'utf8')]);
    const r = await call('captions.insert', 'https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet',
      { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}`, 'Content-Length': String(body.length) }, body });
    if (!r.ok) throw await apiError(r, 'captions.insert');
    const j = await r.json();
    return { captionId: j.id || null, language };
  }
  async function setThumbnail(videoId, jpgFile) {
    const buf = fs.readFileSync(jpgFile);
    const r = await call('thumbnails.set', `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
      { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(buf.length) }, body: buf });
    if (!r.ok) throw await apiError(r, 'thumbnails.set');
    return { bytes: buf.length };
  }

  return { upload, confirmPublished, authorize, accessToken, status, quotaUsed: used, verifyChannel, disconnect, validateClientSecret, uploadCaptions, setThumbnail };
}

// default instance used by the executor (lazy: no file access until a method is called)
let inst = null;
const get = () => (inst = inst || makeYouTube());
export const upload = (run, ctx) => makeYouTube({ db: ctx.db }).upload(run, ctx);
export const confirmPublished = (run, ctx) => makeYouTube({ db: ctx.db }).confirmPublished(run, ctx);
export const status = () => get().status();
export const setThumbnail = (...a) => get().setThumbnail(...a);
export const uploadCaptions = (...a) => get().uploadCaptions(...a);

// CLI: node automation/youtube.mjs authorize | status
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]).replace(/\\/g, '/'))) {
  const cmd = process.argv[2];
  if (cmd === 'authorize') get().authorize().then(() => console.log('Authorized. The refresh token is stored encrypted (Windows DPAPI) in youtube/tokens.dpapi.')).catch((e) => { console.error(e.message); process.exit(1); });
  else if (cmd === 'status') console.log(JSON.stringify(get().status(), null, 2));
  else if (cmd === 'verify') get().verifyChannel().then((c) => console.log(JSON.stringify(c, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
  else if (cmd === 'disconnect') get().disconnect().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
  else console.log('usage: node automation/youtube.mjs authorize | status | verify | disconnect');
}
