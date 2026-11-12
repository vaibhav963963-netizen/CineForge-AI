// Dependency registry loader: config/dependencies.json is the only list of what CineForge AI needs. This module
// validates it (unique ids, known dependencies, no cycles, download URLs on trusted HTTPS hosts, install targets inside
// their declared folders) and resolves {placeholders} through studio-config.json paths.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PATHS } from '../workspace.js';
import { getSettings } from './settings.js';

export const REGISTRY_FILE = path.join(ROOT, 'config', 'dependencies.json');
const LEVELS = ['required', 'recommended', 'optional'];
const OPS = ['download', 'extract', 'delete-temp', 'venv', 'pip', 'git-or-archive'];

let cache = null;
export function loadRegistry(file = REGISTRY_FILE, { force = false } = {}) {
  if (cache && !force && file === REGISTRY_FILE) return cache;
  const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = validateRegistry(reg);
  if (problems.length) throw new Error(`dependency registry invalid:\n - ${problems.join('\n - ')}`);
  reg.byId = new Map(reg.components.map((c) => [c.id, c]));
  if (file === REGISTRY_FILE) cache = reg;
  return reg;
}

export function isTrustedUrl(url, hosts) {
  let u; try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  return hosts.includes(u.hostname.toLowerCase());
}

function allSteps(c) {
  const i = c.install || {};
  if (i.steps) return i.steps;
  if (i.variants) return Object.values(i.variants).flatMap((v) => v.steps || []);
  return [];
}
export function fileEntries(c) { return c.detect?.type === 'files' ? c.detect.files : []; }

export function validateRegistry(reg) {
  const p = [], ids = new Set();
  if (reg.schemaVersion !== 1) p.push('schemaVersion must be 1');
  if (!Array.isArray(reg.trustedHosts) || !reg.trustedHosts.length) p.push('trustedHosts missing');
  for (const c of reg.components || []) {
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(c.id || '')) p.push(`bad id ${c.id}`);
    if (ids.has(c.id)) p.push(`duplicate id ${c.id}`); ids.add(c.id);
    if (!LEVELS.includes(c.level)) p.push(`${c.id}: level must be one of ${LEVELS}`);
    if (!reg.categories[c.category]) p.push(`${c.id}: unknown category ${c.category}`);
    if (!c.detect?.type) p.push(`${c.id}: detect.type missing`);
    for (const s of allSteps(c)) {
      if (!OPS.includes(s.op)) p.push(`${c.id}: unknown install op ${s.op}`);
      for (const u of [s.url, s.archive && /^https:/.test(s.archive) ? s.archive : null, s.repo].filter(Boolean)) if (!isTrustedUrl(u, reg.trustedHosts)) p.push(`${c.id}: untrusted URL ${u}`);
      if (s.op === 'download' && !s.sha256 && !s.sha512b64) p.push(`${c.id}: download ${s.url} has no checksum`);
    }
    for (const f of fileEntries(c)) {
      if (!f.path || path.isAbsolute(f.path) || f.path.split(/[\\/]/).includes('..')) p.push(`${c.id}: file path ${f.path} must be relative without ..`);
      if (f.url && !isTrustedUrl(f.url, reg.trustedHosts)) p.push(`${c.id}: untrusted URL ${f.url}`);
      if (f.sha256 && !/^[0-9a-f]{64}$/.test(f.sha256)) p.push(`${c.id}: bad sha256 for ${f.path}`);
    }
  }
  for (const c of reg.components || []) for (const d of c.dependsOn || []) if (!ids.has(d)) p.push(`${c.id}: depends on unknown ${d}`);
  for (const f of reg.features || []) for (const d of f.requires) if (!ids.has(d)) p.push(`feature ${f.id}: requires unknown ${d}`);
  try { topoOrder(reg.components); } catch (e) { p.push(e.message); }
  return p;
}

/** Topological order (dependencies first); throws on a cycle. */
export function topoOrder(components, subset = null) {
  const by = new Map(components.map((c) => [c.id, c])), out = [], state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 2) return; if (state.get(id) === 1) throw new Error(`dependency cycle: ${[...trail, id].join(' → ')}`);
    state.set(id, 1); for (const d of by.get(id)?.dependsOn || []) visit(d, [...trail, id]); state.set(id, 2); out.push(id);
  };
  for (const c of components) if (!subset || subset.includes(c.id)) visit(c.id, []);
  return subset ? out : out;
}

// ── placeholders ──────────────────────────────────────────────────────────────────────────────────────────────
export function baseVars(extra = {}) {
  const s = getSettings();
  return {
    root: ROOT, tmp: path.resolve(ROOT, s.downloadDir), 'paths.fonts': PATHS.fonts,
    // Windows' own bsdtar (reads zip); Git's GNU tar earlier on PATH cannot
    system32: path.join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32'),
    'models.kokoro': PATHS.models.kokoro, 'models.whisperEnglish': PATHS.models.whisperEnglish, 'models.whisperMultilingual': PATHS.models.whisperMultilingual,
    'models.llm': PATHS.models.llm, 'models.imageGeneration': PATHS.models.imageGeneration,
    'runtime.ffmpegBin': PATHS.ffmpegBin, 'runtime.llamaCpp': PATHS.llamaCpp, 'runtime.comfyui': PATHS.comfyui,
    'runtime.pythonVenv': path.dirname(PATHS.pythonScripts), 'python.venv': PATHS.python,
    'python.comfy': path.join(PATHS.comfyui, 'venv', 'Scripts', 'python.exe'),
    ...extra,
  };
}
export function resolveStr(s, vars = baseVars()) {
  return String(s).replace(/\{([\w.]+)\}/g, (m, k) => { if (!(k in vars) || vars[k] == null) throw new Error(`unresolved placeholder ${m}`); return vars[k]; });
}
export const resolvePath = (s, vars) => path.normalize(resolveStr(s, vars));

/** Absolute file targets of a 'files' component, each checked to stay inside its base folder. */
export function resolvedFiles(c, vars = baseVars()) {
  const base = resolvePath(c.detect.base, vars);
  return fileEntries(c).map((f) => {
    const abs = path.resolve(base, f.path), r = path.relative(base, abs);
    if (r.startsWith('..') || path.isAbsolute(r)) throw new Error(`${c.id}: ${f.path} escapes ${base}`);
    return { ...f, abs };
  });
}

export function installSteps(c, profile) {
  const i = c.install || {};
  if (i.steps) return i.steps;
  if (i.variants) return (i.variants[profile === 'cpu' ? 'cpu' : 'gpu'] || i.variants.gpu || {}).steps || [];
  return null;
}
export const isInstallable = (c) => !!(c.install && (c.install.steps || c.install.variants || c.install.type === 'files'));
