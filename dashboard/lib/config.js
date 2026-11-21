// Central environment configuration — the ONLY module that reads process.env / .env files for CineForge settings.
//
// Precedence (highest first):  real process environment  >  .env.<CINEFORGE_ENV>  >  .env  >  config/studio-config.json  >  built-in defaults
//   · CINEFORGE_ENV = development | production | test. Under `node --test` it is "test": .env.test is loaded and the
//     developer's .env is NOT (test isolation).
//   · Values are validated by type (int / bool / enum / url / path) at startup; invalid values stop the process with
//     an actionable message; unknown CINEFORGE-looking keys produce a warning.
//   · Paths: Windows paths are accepted as written (C:\x\y, C:/x/y, quoted or not); relative paths resolve against the
//     workspace root.
//   · Secrets: no secret is expected in .env (the YouTube refresh token is stored encrypted with Windows DPAPI in
//     youtube/tokens.dpapi, the OAuth client in youtube/client_secret.json). Any variable marked secret is redacted in
//     every report; redact() also masks token-shaped strings in free text (logs, diagnostics).
//   · Nothing here is sent to the browser: the dashboard only receives the non-secret `publicConfig()`.
// User-editable state (automation schedule, retries, publish times, topics) is NOT configured here — it lives in the
// automation settings database and the Automation page.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STUDIO_JSON = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'studio-config.json'), 'utf8')); } catch { return {}; } })();

// ── schema: every supported variable ─────────────────────────────────────────────────────────────────────────────
// type: int | number | bool | enum | url | path | string · default may be a function of the partially built config
export const SCHEMA = [
  // Application
  { key: 'CINEFORGE_ENV', section: 'Application', type: 'enum', values: ['development', 'production', 'test'], default: 'development', desc: 'Environment name; "test" loads .env.test instead of .env (set automatically under node --test)' },
  { key: 'LOG_LEVEL', section: 'Logging and diagnostics', type: 'enum', values: ['debug', 'info', 'warn', 'error'], default: 'info', desc: 'Minimum level written by the automation scheduler event log' },
  // Server and dashboard
  { key: 'PORT', section: 'Server and dashboard', type: 'int', min: 1, max: 65535, default: STUDIO_JSON.port || 3000, desc: 'Dashboard / studio API port' },
  { key: 'HOST', section: 'Server and dashboard', type: 'enum', values: ['127.0.0.1', 'localhost', '::1'], default: STUDIO_JSON.host || '127.0.0.1', desc: 'Bind address — loopback only (the studio API is never exposed to the network)' },
  // Local AI models and services
  { key: 'LLM_PORT', section: 'Gemma / llama.cpp', type: 'int', min: 1, max: 65535, default: STUDIO_JSON.services?.llmPort || 8091, desc: 'Port of the local llama-server (Gemma script model)' },
  { key: 'LLM_IDLE_STOP_SECONDS', section: 'Gemma / llama.cpp', type: 'int', min: 10, max: 3600, default: 90, desc: 'Stop the script model after this many idle seconds (frees GPU memory for TTS / images)' },
  { key: 'COMFYUI_PORT', section: 'ComfyUI', type: 'int', min: 1, max: 65535, default: STUDIO_JSON.services?.comfyPort || 8188, desc: 'Port of the local ComfyUI server (AI images)' },
  { key: 'CHROME_PATH', section: 'FFmpeg and capture', type: 'path', default: '', aliases: ['CHROME'], desc: 'Browser used for frame capture (default: installed Google Chrome, else Microsoft Edge)' },
  { key: 'SOFTWARE_GL', section: 'GPU and resource management', type: 'bool', default: false, desc: 'Software WebGL for frame capture (slow; only without a working GPU driver)' },
  // Automation
  { key: 'AUTOMATION_DB', section: 'Automation scheduler', type: 'path', default: 'logs/automation/automation.db', aliases: ['CINEFORGE_AUTOMATION_DB'], desc: 'Automation state database (SQLite)' },
  { key: 'AUTOMATION_TICK_SECONDS', section: 'Automation scheduler', type: 'int', min: 5, max: 600, default: 30, desc: 'Scheduler loop interval' },
  { key: 'AUTOMATION_STUDIO_URL', section: 'Automation scheduler', type: 'url', default: (c) => `http://127.0.0.1:${c.PORT}`, desc: 'Studio API the scheduler drives (default: this machine, PORT)' },
  // YouTube
  { key: 'YOUTUBE_CLIENT_SECRET_FILE', section: 'YouTube OAuth and publishing', type: 'path', default: 'youtube/client_secret.json', desc: 'OAuth client file downloaded from Google Cloud (kept out of Git)' },
  { key: 'YOUTUBE_TOKEN_FILE', section: 'YouTube OAuth and publishing', type: 'path', default: 'youtube/tokens.dpapi', desc: 'Encrypted refresh token (Windows DPAPI, current user only) — never put the token itself in .env' },
  { key: 'YOUTUBE_DAILY_QUOTA', section: 'YouTube OAuth and publishing', type: 'int', min: 100, max: 1000000, default: 10000, desc: 'YouTube Data API units per day for this project' },
  // Notifications
  { key: 'NOTIFY_TOAST', section: 'Notification settings', type: 'bool', default: true, aliases: [['CINEFORGE_NO_TOAST', (v) => !truthy(v)]], desc: 'Windows toast for automation warnings / errors' },
  // System Setup (diagnostics)
  { key: 'CINEFORGE_SETUP_DIR', section: 'Logging and diagnostics', type: 'path', default: '', desc: 'Override the System Setup state folder (tests only)' },
  // Script generation (online) — never used during video production
  { key: 'GEMINI_API_KEY', section: 'Google Gemini API (script writing)', type: 'secret', default: '', desc: 'Google Gemini API key (backend only; masked in every report, never sent to the browser)' },
  { key: 'GEMINI_THINKING_LEVEL', section: 'Google Gemini API (script writing)', type: 'enum', values: ['default', 'minimal', 'low', 'medium', 'high'], default: 'low', desc: 'Gemini thinking level for script calls (low = ~2.5x faster; default = model default, much slower)' },
  { key: 'GEMINI_MODEL', section: 'Google Gemini API (script writing)', type: 'string', default: 'gemini-2.5-flash', desc: 'Gemini model code used for script writing (checked against your key; a rerouted model is refused, never used silently)' },
  { key: 'GEMINI_BASE_URL', section: 'Google Gemini API (script writing)', type: 'url', default: 'https://generativelanguage.googleapis.com/v1beta', desc: 'Gemini REST API base URL' },
  { key: 'GROQ_API_KEY', section: 'Groq API (script writing)', type: 'secret', default: '', desc: 'Groq API key (backend only; masked in every report, never sent to the browser)' },
  { key: 'GROQ_MODEL', section: 'Groq API (script writing)', type: 'string', default: 'openai/gpt-oss-120b', desc: 'Groq model id used for script writing (checked against your account; never switched silently)' },
  { key: 'GROQ_BASE_URL', section: 'Groq API (script writing)', type: 'url', default: 'https://api.groq.com/openai/v1', desc: 'Groq OpenAI-compatible API base URL' },
  { key: 'SCRIPT_GENERATION_PROVIDER', section: 'Script generation', type: 'enum', values: ['gemini', 'groq'], default: 'gemini', desc: 'Where scripts are written (online: Google Gemini or Groq). No fallback between them. Video production never needs it.' },
  { key: 'SCRIPT_GENERATION_ENABLED', section: 'Script generation', type: 'bool', default: true, desc: 'Allow writing new scripts (saved scripts stay usable when disabled or offline)' },
  { key: 'SCRIPT_GENERATION_TIMEOUT', section: 'Script generation', type: 'int', min: 5000, max: 600000, default: 120000, desc: 'Timeout of one Groq request (ms)' },
  { key: 'SCRIPT_GENERATION_MODE', section: 'Script generation', type: 'enum', values: ['single-request', 'multi-pass'], default: 'single-request', desc: 'single-request = the whole script (research notes, plan, narration, storyboard) in ONE API call, then local checks; multi-pass = the older chain of separate research/plan/review/visual calls' },
  { key: 'SCRIPT_GENERATION_MAX_RETRIES', section: 'Script generation', type: 'int', min: 0, max: 10, default: 3, desc: 'Retries of one Groq request on rate limits, network errors and timeouts' },
  // Video production — always local and offline
  { key: 'VIDEO_GENERATION_PROVIDER', section: 'Local video production', type: 'enum', values: ['local'], default: 'local', desc: 'Video production runs on this computer only' },
  { key: 'TTS_PROVIDER', section: 'Local video production', type: 'enum', values: ['local'], default: 'local', desc: 'Kokoro TTS (local)' },
  { key: 'IMAGE_GENERATION_PROVIDER', section: 'Local video production', type: 'enum', values: ['local'], default: 'local', desc: 'ComfyUI + DreamShaper (local)' },
  { key: 'VIDEO_RENDER_PROVIDER', section: 'Local video production', type: 'enum', values: ['local'], default: 'local', desc: 'Three.js capture + FFmpeg (local)' },
];
const KNOWN = new Set(SCHEMA.flatMap((s) => [s.key, ...(s.aliases || []).map((a) => (Array.isArray(a) ? a[0] : a))]));
// variables that must never be printed (none are required in .env; listed so a user who adds one is still protected)
export const SECRET_KEYS = /(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE|CREDENTIAL|REFRESH|ENCRYPTION_KEY)/i;
// a variable that only POINTS to a secret file (…_FILE / _PATH / _DIR) is not itself secret
export const isSecretKey = (k) => SECRET_KEYS.test(k) && !/_(FILE|PATH|DIR)$/i.test(k);

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v).trim());

// ── .env parser (KEY=VALUE, comments, quotes, export prefix, Windows paths) ─────────────────────────────────────────
export function parseEnv(text) {
  const out = {};
  for (const [i, raw] of String(text).replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) throw new Error(`.env line ${i + 1}: expected KEY=VALUE, got "${line.slice(0, 40)}"`);
    let v = m[2];
    if (/^"/.test(v)) { const e = v.indexOf('"', 1); v = v.slice(1, e < 0 ? undefined : e).replace(/\\n/g, '\n').replace(/\\"/g, '"'); }   // "…" (only \n and \" are escapes: C:\Users stays intact)
    else if (/^'/.test(v)) { const e = v.indexOf("'", 1); v = v.slice(1, e < 0 ? undefined : e); }                                   // '…' literal
    else v = v.replace(/\s+#.*$/, '').trim();                                                                                        // unquoted: strip inline comment
    out[m[1]] = v;
  }
  return out;
}
const readEnvFile = (file) => { try { return parseEnv(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(`${path.basename(file)}: ${e.message}`); } };

/** Windows-safe path: quotes stripped, / or \ accepted, relative → workspace root */
export function resolvePath(v, root = ROOT) {
  const s = String(v).trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  return path.isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s) ? path.normalize(s) : path.resolve(root, s);
}

/**
 * Build the configuration. Pure (no global state) so tests can pass their own env / files.
 * @returns {{ config: object, errors: string[], warnings: string[], sources: object }}
 */
export function loadConfig({ env = process.env, root = ROOT, files = null } = {}) {
  const testRun = !!env.NODE_TEST_CONTEXT || env.CINEFORGE_ENV === 'test';
  const envName = env.CINEFORGE_ENV || (testRun ? 'test' : undefined);
  const fileVals = files || (testRun
    ? { ...readEnvFile(path.join(root, '.env.test')) }                                             // isolation: the developer's .env is not read in tests
    : { ...readEnvFile(path.join(root, '.env')), ...(envName ? readEnvFile(path.join(root, `.env.${envName}`)) : {}) });
  const merged = { ...fileVals, ...env };
  const errors = [], warnings = [], config = {}, sources = {};
  for (const s of SCHEMA) {
    let raw = merged[s.key], src = s.key in env ? 'environment' : s.key in fileVals ? '.env' : null;
    if (raw === undefined) for (const a of s.aliases || []) {
      const [name, map] = Array.isArray(a) ? a : [a, (x) => x];
      if (merged[name] !== undefined) { raw = map(merged[name]); src = `${name} (legacy name)`; break; }
    }
    if (raw === undefined || raw === '') { const d = typeof s.default === 'function' ? s.default(config) : s.default; config[s.key] = s.type === 'path' && d ? resolvePath(d, root) : d; sources[s.key] = 'default'; continue; }
    sources[s.key] = src || 'default';
    const bad = (why) => { errors.push(`${s.key}=${isSecretKey(s.key) ? '***' : JSON.stringify(String(raw))}: ${why} — ${s.desc}`); config[s.key] = typeof s.default === 'function' ? s.default(config) : s.default; };
    switch (s.type) {
      case 'int': case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n) || (s.type === 'int' && !Number.isInteger(n))) { bad(`must be ${s.type === 'int' ? 'a whole number' : 'a number'}`); break; }
        if ((s.min != null && n < s.min) || (s.max != null && n > s.max)) { bad(`must be between ${s.min} and ${s.max}`); break; }
        config[s.key] = n; break;
      }
      case 'bool': {
        if (typeof raw === 'boolean') { config[s.key] = raw; break; }
        if (!/^(1|0|true|false|yes|no|on|off)$/i.test(String(raw).trim())) { bad('must be true or false'); break; }
        config[s.key] = truthy(raw); break;
      }
      case 'enum': if (!s.values.includes(String(raw))) bad(`must be one of ${s.values.join(', ')}`); else config[s.key] = String(raw); break;
      case 'url': try { const u = new URL(String(raw)); if (!/^https?:$/.test(u.protocol)) throw 0; config[s.key] = u.origin + u.pathname.replace(/\/$/, ''); } catch { bad('must be an http(s) URL'); } break;
      case 'path': config[s.key] = resolvePath(raw, root); break;
      default: config[s.key] = String(raw);
    }
  }
  // test isolation even without a .env.test file: never the real automation database, never real notifications
  if (testRun) {
    if (sources.AUTOMATION_DB === 'default') config.AUTOMATION_DB = resolvePath('logs/automation/test-automation.db', root);
    if (sources.NOTIFY_TOAST === 'default') config.NOTIFY_TOAST = false;
  }
  for (const k of Object.keys(fileVals)) if (!KNOWN.has(k)) warnings.push(`.env: unknown variable ${k} (ignored)${isSecretKey(k) ? ' — and it looks like a secret: remove it from .env' : ''}`);
  return { config: Object.freeze(config), errors, warnings, sources };
}

// ── redaction ────────────────────────────────────────────────────────────────────────────────────────────────────
/** a config / object copy that is safe to print: secret-named keys masked */
export function redactConfig(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, isSecretKey(k) && v ? '***' : v]));
}
/** mask token-shaped strings in free text (Google access/refresh tokens, client secrets, bearer headers, key=value secrets) */
export function redact(text) {
  return String(text ?? '')
    .replace(/ya29\.[\w.-]+/g, 'ya29.***')
    .replace(/\b1\/\/[\w-]{20,}/g, '1//***')
    .replace(/GOCSPX-[\w-]+/g, 'GOCSPX-***')
    .replace(/\bgsk_[A-Za-z0-9]{8,}/g, 'gsk_***')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza***')
    .replace(/(Bearer\s+)[\w.~+/-]+=*/gi, '$1***')
    .replace(/((?:client_secret|refresh_token|access_token|api[_-]?key|password|token)["']?\s*[:=]\s*["']?)[^"'\s&,}]+/gi, '$1***');
}

// ── the process-wide configuration (loaded once at startup) ─────────────────────────────────────────────────────
const loaded = loadConfig();
export const CONFIG = loaded.config;
export const CONFIG_SOURCES = loaded.sources;
export const CONFIG_WARNINGS = loaded.warnings;
export const CONFIG_ERRORS = loaded.errors;

/** stop with an actionable message when the configuration is invalid (call at the start of every entry point) */
export function assertConfig(what = 'CineForge') {
  for (const w of CONFIG_WARNINGS) console.warn(`[config] ${w}`);
  if (!CONFIG_ERRORS.length) return CONFIG;
  console.error(`\n${what} cannot start — invalid configuration:\n${CONFIG_ERRORS.map((e) => `  · ${e}`).join('\n')}\n\nFix these in .env (see .env.example), or remove them to use the defaults.\n`);
  process.exit(78);   // EX_CONFIG
}
/** non-secret view for diagnostics / the dashboard */
export function publicConfig() { return redactConfig({ ...CONFIG }); }
