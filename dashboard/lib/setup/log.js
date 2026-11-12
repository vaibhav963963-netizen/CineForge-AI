// Structured setup logs (JSON lines in logs/setup/setup.log) with secret redaction. Every scan, download, install,
// verify, config change and health check writes here with an operation id and component id.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PATHS } from '../workspace.js';

// CINEFORGE_SETUP_DIR lets tests keep their records out of the real setup log
export const SETUP_DIR = process.env.CINEFORGE_SETUP_DIR ? path.resolve(process.env.CINEFORGE_SETUP_DIR) : path.join(PATHS.logs, 'setup');
export const LOG_FILE = path.join(SETUP_DIR, 'setup.log');
fs.mkdirSync(SETUP_DIR, { recursive: true });

const SECRET_KEYS = /(token|secret|password|passwd|api[_-]?key|auth|cookie|credential|signature|policy|key-pair-id)/i;
const HOME = os.homedir();

/** Remove secrets from any string: query-string credentials, Authorization headers, env-style KEY=VALUE secrets. */
export function redact(v) {
  if (v == null) return v;
  if (typeof v === 'string') {
    let s = v
      .replace(/([?&][^=&\s]*(?:token|signature|policy|key-pair-id|expires|x-amz-[a-z-]+|sig)[^=&\s]*=)[^&\s"']+/gi, '$1[redacted]')
      .replace(/(authorization:\s*)(bearer|basic)?\s*[^\s"']+/gi, '$1[redacted]')
      .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|APIKEY)[A-Z0-9_]*)=([^\s"']+)/g, '$1=[redacted]')
      .replace(/\bhf_[A-Za-z0-9]{20,}\b/g, '[redacted]').replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted]');
    if (HOME && HOME.length > 3) s = s.split(HOME).join('%USERPROFILE%');
    return s;
  }
  if (Array.isArray(v)) return v.map(redact);
  if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEYS.test(k) && typeof x === 'string' ? '[redacted]' : redact(x); return o; }
  return v;
}

export function logEvent(evt) {
  const rec = redact({ ts: new Date().toISOString(), ...evt });
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(rec) + '\n'); } catch {}
  return rec;
}

export function readLog({ limit = 300, opId, componentId } = {}) {
  let lines = [];
  try { lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n'); } catch { return []; }
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try { const r = JSON.parse(lines[i]); if ((opId && r.opId !== opId) || (componentId && r.componentId !== componentId)) continue; out.push(r); } catch {}
  }
  return out.reverse();
}

/** Clear disposable logs (setup log only; job logs and project data are never touched). */
export function clearLog() { try { fs.rmSync(LOG_FILE, { force: true }); } catch {} }

export const newId = (prefix) => `${prefix}-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`;

/** Atomic JSON write (tmp + rename) so a crash never leaves half a state file. */
export function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
export function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
