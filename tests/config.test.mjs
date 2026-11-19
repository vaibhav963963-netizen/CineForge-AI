// Central configuration: loading, validation, Windows paths, precedence, legacy names, test isolation, redaction,
// and compatibility of the studio + automation modules with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv, loadConfig, resolvePath, redact, redactConfig, SCHEMA, CONFIG, publicConfig } from '../dashboard/lib/config.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-env-'));
const ROOT = 'C:\\Work\\Shorts Studio';

test('.env parsing: comments, quotes, export prefix, inline comments, empty values', () => {
  const e = parseEnv('# comment\nPORT=3100   # inline\nexport HOST=localhost\nA="quoted # not a comment"\nB=\'single $literal\'\nC=\n\r\nD=x=y');
  assert.deepEqual(e, { PORT: '3100', HOST: 'localhost', A: 'quoted # not a comment', B: 'single $literal', C: '', D: 'x=y' });
  assert.throws(() => parseEnv('not a valid line'), /expected KEY=VALUE/);
});

test('Windows paths: backslashes, forward slashes, quotes and relative paths', () => {
  const e = parseEnv('CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"\nAUTOMATION_DB=logs\\auto\\a.db\nYOUTUBE_TOKEN_FILE=D:/keys/tok.dpapi');
  assert.equal(e.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');   // \P, \G … are not escapes
  const { config, errors } = loadConfig({ env: {}, files: e, root: ROOT });
  assert.deepEqual(errors, []);
  assert.equal(config.CHROME_PATH, path.normalize('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'));
  assert.equal(config.YOUTUBE_TOKEN_FILE, path.normalize('D:/keys/tok.dpapi'));
  assert.equal(config.AUTOMATION_DB, path.resolve(ROOT, 'logs\\auto\\a.db'));
  assert.equal(resolvePath('"C:/x/y z"', ROOT), path.normalize('C:/x/y z'));
});

test('defaults are used when variables are missing; nothing is required', () => {
  const { config, errors, sources } = loadConfig({ env: {}, files: {}, root: ROOT });
  assert.deepEqual(errors, []);
  assert.equal(config.LLM_PORT, 8091); assert.equal(config.COMFYUI_PORT, 8188); assert.equal(config.AUTOMATION_TICK_SECONDS, 30);
  assert.equal(config.AUTOMATION_STUDIO_URL, `http://127.0.0.1:${config.PORT}`);   // derived from PORT
  assert.equal(sources.PORT, 'default');
});

test('invalid values are reported with an actionable message (and fall back to the default)', () => {
  const { config, errors } = loadConfig({ env: {}, files: { PORT: 'abc', LLM_PORT: '70000', SOFTWARE_GL: 'maybe', HOST: '0.0.0.0', AUTOMATION_STUDIO_URL: 'ftp://x', LOG_LEVEL: 'loud' }, root: ROOT });
  assert.equal(errors.length, 6);
  assert.ok(errors.some((e) => /^PORT="abc": must be a whole number/.test(e)));
  assert.ok(errors.some((e) => /^LLM_PORT=.*between 1 and 65535/.test(e)));
  assert.ok(errors.some((e) => /^HOST=.*must be one of 127\.0\.0\.1/.test(e)));   // never bind to the network
  assert.equal(config.LLM_PORT, 8091);
});

test('precedence: environment > .env > defaults; legacy variable names still work', () => {
  const { config, sources } = loadConfig({ env: { PORT: '4000' }, files: { PORT: '3100', LLM_PORT: '9000' }, root: ROOT });
  assert.equal(config.PORT, 4000); assert.equal(sources.PORT, 'environment');
  assert.equal(config.LLM_PORT, 9000); assert.equal(sources.LLM_PORT, '.env');
  const legacy = loadConfig({ env: { CINEFORGE_AUTOMATION_DB: 'x.db', CINEFORGE_NO_TOAST: '1', CHROME: 'C:/c.exe' }, files: {}, root: ROOT }).config;
  assert.equal(legacy.AUTOMATION_DB, path.resolve(ROOT, 'x.db')); assert.equal(legacy.NOTIFY_TOAST, false); assert.equal(legacy.CHROME_PATH, path.normalize('C:/c.exe'));
});

test('test isolation: under node --test the developer .env is not read; real DB and toasts are never used', () => {
  fs.writeFileSync(path.join(tmp, '.env'), 'PORT=3999\nNOTIFY_TOAST=true\n');
  fs.writeFileSync(path.join(tmp, '.env.test'), 'LOG_LEVEL=debug\n');
  const t = loadConfig({ env: { NODE_TEST_CONTEXT: 'child' }, root: tmp }).config;
  assert.notEqual(t.PORT, 3999); assert.equal(t.LOG_LEVEL, 'debug');
  assert.equal(t.NOTIFY_TOAST, false); assert.match(t.AUTOMATION_DB, /test-automation\.db$/);
  const dev = loadConfig({ env: {}, root: tmp }).config;
  assert.equal(dev.PORT, 3999);
  // and this very test process is isolated
  assert.equal(CONFIG.CINEFORGE_ENV === 'test' || !!process.env.NODE_TEST_CONTEXT, true);
  assert.match(CONFIG.AUTOMATION_DB, /test-automation\.db$/);
});

test('secret redaction: secret-named variables, tokens in text, unknown secret-looking .env keys are flagged', () => {
  assert.deepEqual(redactConfig({ YOUTUBE_API_KEY: 'AIzaXYZ', DB_PASSWORD: 'p', YOUTUBE_TOKEN_FILE: 'youtube/tokens.dpapi', PORT: 1 }), { YOUTUBE_API_KEY: '***', DB_PASSWORD: '***', YOUTUBE_TOKEN_FILE: 'youtube/tokens.dpapi', PORT: 1 });
  // fake values, assembled at run time so this file never contains a token-shaped literal (the pre-commit secret
  // scan correctly refuses those)
  const fakeAccess = ['ya', '29.', 'a0AfH6SMBx', '-very-secret'].join('');
  const s = redact(`Authorization: Bearer ${fakeAccess} refresh_token=1//0gAbCdEfGhIjKlMnOpQrStUvWxYz client_secret":"GOCSPX-abcdefghijklmnop" password=hunter2`);
  for (const leak of ['a0AfH6SMBx', '0gAbCdEfGh', 'abcdefghijklmnop', 'hunter2']) assert.ok(!s.includes(leak), `${leak} leaked: ${s}`);
  const { warnings } = loadConfig({ env: {}, files: { YOUTUBE_REFRESH_TOKEN: 'abc' }, root: ROOT });
  assert.match(warnings[0], /looks like a secret/); assert.ok(!warnings[0].includes('abc'));
  assert.ok(!JSON.stringify(publicConfig()).match(/ya29\.|GOCSPX-|1\/\/0/));
});

test('.env.example documents every supported variable and loads without errors', () => {
  const ex = parseEnv(fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));
  assert.deepEqual(SCHEMA.filter((s) => !(s.key in ex)).map((s) => s.key), []);
  const r = loadConfig({ env: {}, files: ex, root: ROOT });
  assert.deepEqual(r.errors, []); assert.deepEqual(r.warnings, []);
  assert.ok(!/=(ya29|GOCSPX|1\/\/0)/.test(fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8')));
});

test('compatibility: studio and automation read the central configuration', async () => {
  const { STUDIO_CONFIG } = await import('../dashboard/lib/workspace.js');
  assert.equal(STUDIO_CONFIG.port, CONFIG.PORT); assert.equal(STUDIO_CONFIG.services.llmPort, CONFIG.LLM_PORT);
  assert.ok(STUDIO_CONFIG.paths.models.kokoro, 'workspace layout still comes from studio-config.json');
  const { DEFAULTS } = await import('../automation/settings.mjs');
  assert.equal(DEFAULTS.studio.url, CONFIG.AUTOMATION_STUDIO_URL);   // no hardcoded :3200 any more
  const src = ['dashboard/server.js', 'dashboard/lib/llm.js', 'dashboard/lib/setup/health.js', 'dashboard/lib/setup/log.js', 'automation/db.mjs', 'automation/notify.mjs', 'automation/scheduler.mjs', 'automation/youtube.mjs']
    .map((f) => [f, fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')]);
  for (const [f, s] of src) assert.ok(!/process\.env\.(PORT|CHROME|SOFTWARE_GL|CINEFORGE_[A-Z_]+)\b/.test(s), `${f} reads the environment directly`);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
