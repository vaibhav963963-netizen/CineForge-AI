// Configuration manager for setup: hardware profile, download behaviour and editable studio paths.
// Every write validates first, backs the file up into backups/config/, then writes atomically. Path changes go to
// config/studio-config.json (the single place paths live) and take effect after the server restarts.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STUDIO_CONFIG } from '../workspace.js';
import { logEvent, writeJsonAtomic, readJson } from './log.js';

export const SETTINGS_FILE = path.join(ROOT, 'config', 'setup-settings.json');
const STUDIO_CONFIG_FILE = path.join(ROOT, 'config', 'studio-config.json');
const BACKUP_DIR = path.join(ROOT, 'backups', 'config');

export const DEFAULT_SETTINGS = { hardwareProfile: 'auto', downloadConcurrency: 2, downloadSegments: 4, downloadDir: 'runtime/.downloads', allowDownloads: true, wizard: { step: 0, dismissed: false } };
const PROFILES = ['auto', 'nvidia-cuda', 'cpu', 'low-memory'];

export function getSettings() {
  const s = readJson(SETTINGS_FILE, {});
  return { ...DEFAULT_SETTINGS, ...s, wizard: { ...DEFAULT_SETTINGS.wizard, ...(s.wizard || {}) } };
}

function backup(file) {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const b = path.join(BACKUP_DIR, `${path.basename(file, '.json')}.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.copyFileSync(file, b);
  return b;
}

/** Editable paths: key → [studio-config path segments]. Anything else is rejected. */
export const EDITABLE_PATHS = {
  'models.kokoro': ['paths', 'models', 'kokoro'], 'models.whisperEnglish': ['paths', 'models', 'whisperEnglish'],
  'models.whisperMultilingual': ['paths', 'models', 'whisperMultilingual'], 'models.llm': ['paths', 'models', 'llm'],
  'models.imageGeneration': ['paths', 'models', 'imageGeneration'], exports: ['paths', 'exports'], projects: ['paths', 'projects'],
};
const FORBIDDEN_ROOTS = ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'].map((p) => p.toLowerCase());

/** Validate a user-supplied directory: absolute or workspace-relative, not a system folder, creatable and writable. */
export function validateDir(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 260) return { ok: false, error: 'Enter a folder path (max 260 characters).' };
  if (/[\0<>"|?*]/.test(input.replace(/^[A-Za-z]:/, ''))) return { ok: false, error: 'The path contains characters Windows does not allow.' };
  const abs = path.resolve(ROOT, input.trim());
  const low = abs.toLowerCase();
  if (FORBIDDEN_ROOTS.some((f) => low === f || low.startsWith(f + '\\'))) return { ok: false, error: 'System folders cannot be used.' };
  if (path.parse(abs).root === abs) return { ok: false, error: 'Choose a folder, not the root of a drive.' };
  // the nearest existing ancestor must be writable
  let probe = abs; while (!fs.existsSync(probe)) { const up = path.dirname(probe); if (up === probe) return { ok: false, error: 'The drive does not exist.' }; probe = up; }
  if (!fs.statSync(probe).isDirectory()) return { ok: false, error: `${probe} is a file, not a folder.` };
  try { const t = path.join(probe, `.cineforge-write-test-${process.pid}`); fs.writeFileSync(t, 'x'); fs.rmSync(t); } catch { return { ok: false, error: `No write permission in ${probe}.` }; }
  let freeGB = null; try { const s = fs.statfsSync(probe); freeGB = +((s.bavail * s.bsize) / 1024 ** 3).toFixed(1); } catch {}
  return { ok: true, path: abs, stored: path.relative(ROOT, abs).startsWith('..') || path.isAbsolute(path.relative(ROOT, abs)) ? abs : path.relative(ROOT, abs).split(path.sep).join('/'), freeGB, exists: fs.existsSync(abs) };
}

export function updateSettings(patch, { actor = 'user' } = {}) {
  const cur = getSettings(), next = { ...cur }, errors = [];
  if ('hardwareProfile' in patch) { if (!PROFILES.includes(patch.hardwareProfile)) errors.push(`unknown hardware profile ${patch.hardwareProfile}`); else next.hardwareProfile = patch.hardwareProfile; }
  if ('downloadConcurrency' in patch) { const n = +patch.downloadConcurrency; if (!Number.isInteger(n) || n < 1 || n > 4) errors.push('download concurrency must be 1–4'); else next.downloadConcurrency = n; }
  if ('downloadSegments' in patch) { const n = +patch.downloadSegments; if (!Number.isInteger(n) || n < 1 || n > 8) errors.push('connections per download must be 1–8'); else next.downloadSegments = n; }
  if ('allowDownloads' in patch) next.allowDownloads = patch.allowDownloads === true;
  if ('downloadDir' in patch) { const v = validateDir(patch.downloadDir); if (!v.ok) errors.push(`download folder: ${v.error}`); else next.downloadDir = v.stored; }
  if ('wizard' in patch && patch.wizard && typeof patch.wizard === 'object') {
    next.wizard = { ...cur.wizard };
    if (Number.isInteger(patch.wizard.step) && patch.wizard.step >= 0 && patch.wizard.step <= 11) next.wizard.step = patch.wizard.step;
    if (typeof patch.wizard.dismissed === 'boolean') next.wizard.dismissed = patch.wizard.dismissed;
  }
  if (errors.length) return { ok: false, errors };
  backup(SETTINGS_FILE); writeJsonAtomic(SETTINGS_FILE, next);
  logEvent({ kind: 'config', action: 'settings-updated', actor, changes: Object.keys(patch) });
  return { ok: true, settings: next };
}

/** Change a studio path (model folders, exports, projects). Files are NOT moved; restart required. */
export function updateStudioPath(key, value) {
  const seg = EDITABLE_PATHS[key];
  if (!seg) return { ok: false, errors: [`${key} is not an editable path`] };
  const v = validateDir(value); if (!v.ok) return { ok: false, errors: [v.error] };
  const cfg = JSON.parse(fs.readFileSync(STUDIO_CONFIG_FILE, 'utf8'));
  let o = cfg; for (const k of seg.slice(0, -1)) o = o[k];
  const before = o[seg.at(-1)]; o[seg.at(-1)] = v.stored;
  const b = backup(STUDIO_CONFIG_FILE); writeJsonAtomic(STUDIO_CONFIG_FILE, cfg);
  logEvent({ kind: 'config', action: 'path-changed', key, before, after: v.stored, backup: b && path.relative(ROOT, b) });
  return { ok: true, key, before, after: v.stored, restartRequired: true, backup: b && path.relative(ROOT, b), note: 'Existing files were not moved. Move them yourself or download them again into the new folder, then restart the studio.' };
}

/** Effective hardware profile (auto → resolved from the GPU scan). */
export function resolveProfile(system, setting = getSettings().hardwareProfile) {
  if (setting !== 'auto') return setting;
  const nv = system?.gpu?.nvidia;
  return nv && nv.cudaCapable ? 'nvidia-cuda' : 'cpu';
}

/** Runtime knobs the LLM / ComfyUI launchers read. 'auto' returns {} so the existing pipeline arguments are unchanged. */
export function runtimeProfile() {
  const p = getSettings().hardwareProfile;
  if (p === 'cpu') return { llmGpuLayers: 0, comfyArgs: ['--cpu'] };
  if (p === 'low-memory') return { llmContext: 4096, comfyArgs: ['--lowvram'] };
  return {};
}

export { STUDIO_CONFIG };
