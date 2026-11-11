// Projects: one folder per video inside <workspace>/projects, a project.json that records the exact configuration,
// script versions, storyboard version, models, assets, render + QA results. Final videos go to <workspace>/exports.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PATHS, assertInsideWorkspace, rel } from './workspace.js';

export const PROJECT_DIRS = ['script', 'storyboard', 'generated-images', 'image-references', '3d-assets', 'scenes', 'audio', 'renders', 'review'];
const ID_RE = /^[a-z0-9][a-z0-9-]{2,80}$/;

export function slugify(text) {
  return String(text).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 6).join('-').slice(0, 40).replace(/-+$/, '');
}

export function projectDir(id) {
  if (!ID_RE.test(id)) throw new Error(`invalid project id "${id}"`);
  return assertInsideWorkspace(path.join(PATHS.projects, id), 'project folder');
}

export function newProjectId(topic) {
  const base = slugify(topic) || 'short';
  for (;;) {
    const id = `${base}-${crypto.randomBytes(3).toString('hex')}`;
    if (!fs.existsSync(path.join(PATHS.projects, id))) return id;
  }
}

const now = () => new Date().toISOString();

export function createProject({ topic, config, configHash }) {
  const id = newProjectId(topic), dir = projectDir(id);
  fs.mkdirSync(dir, { recursive: true });
  for (const d of PROJECT_DIRS) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const project = {
    schema: 1, id, title: topic, topic, status: 'draft', createdAt: now(), updatedAt: now(),
    config, configHash, workspacePath: rel(dir),
    script: { approvedVersion: null, versions: [] },
    storyboard: null, models: {}, assets: {}, voice: null, render: null, qa: null, exportPath: null, history: [],
  };
  saveProject(project);
  return project;
}

export function loadProject(id) {
  const f = path.join(projectDir(id), 'project.json');
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function saveProject(p) {
  p.updatedAt = now();
  const f = path.join(projectDir(p.id), 'project.json'), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2)); fs.renameSync(tmp, f);
  return p;
}

export function updateProject(id, fn) { const p = loadProject(id); if (!p) throw new Error(`project ${id} not found`); fn(p); return saveProject(p); }

// ── script versions ───────────────────────────────────────────────────────────────────────────────────────
const vfile = (id, v) => path.join(projectDir(id), 'script', `v${String(v).padStart(3, '0')}.json`);

export function addScriptVersion(id, script, meta) {
  let saved;
  updateProject(id, (p) => {
    const version = (p.script.versions.reduce((m, v) => Math.max(m, v.version), 0) || 0) + 1;
    const entry = { version, createdAt: now(), ...meta };
    fs.writeFileSync(vfile(id, version), JSON.stringify({ ...script, version, meta: entry }, null, 2));
    // project.json keeps the claim summary; the full per-claim review lives in the version file
    p.script.versions.push(entryForProject(entry));
    if (p.status === 'draft') p.status = 'script-ready';
    saved = { version, entry };
  });
  return saved;
}

function entryForProject(entry) {
  const { claimReview, ...rest } = entry;
  return claimReview ? { ...rest, claimSummary: claimReview.summary } : rest;
}

/** merge fields into a script version's meta (version file + project.json entry) */
export function updateScriptMeta(id, version, patch) {
  const f = vfile(id, version);
  if (!fs.existsSync(f)) throw new Error(`script version ${version} does not exist`);
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  s.meta = { ...s.meta, ...patch };
  fs.writeFileSync(f, JSON.stringify(s, null, 2));
  updateProject(id, (p) => { const i = p.script.versions.findIndex((v) => v.version === version); if (i >= 0) p.script.versions[i] = { ...p.script.versions[i], ...entryForProject(patch) }; });
  return s;
}

export function getScriptVersion(id, version) {
  const f = vfile(id, version);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function approveScriptVersion(id, version) {
  return updateProject(id, (p) => {
    if (!p.script.versions.some((v) => v.version === version)) throw new Error(`script version ${version} does not exist`);
    p.script.approvedVersion = version;
    p.script.versions.forEach((v) => { v.approved = v.version === version; if (v.version === version) v.approvedAt = now(); });
  });
}

// ── library ───────────────────────────────────────────────────────────────────────────────────────────────
function firstFile(dir, re) { try { return fs.readdirSync(dir).filter((f) => re.test(f)).sort()[0] || null; } catch { return null; } }

export function listProjects() {
  if (!fs.existsSync(PATHS.projects)) return [];
  const out = [];
  for (const e of fs.readdirSync(PATHS.projects, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('_')) continue;
    const dir = path.join(PATHS.projects, e.name), pj = path.join(dir, 'project.json');
    const exportFile = path.join(PATHS.exports, `${e.name}.mp4`);
    const hasExport = fs.existsSync(exportFile);
    if (fs.existsSync(pj)) {
      try {
        const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
        const cover = fs.existsSync(path.join(dir, 'review', 'cover.jpg')) ? `/media/projects/${p.id}/review/cover.jpg` : null;
        out.push({
          id: p.id, legacy: false, title: p.title, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt,
          config: p.config, script: p.script, storyboard: p.storyboard, voice: p.voice, render: p.render, qa: p.qa, models: p.models,
          assets: p.assets, exportPath: p.exportPath, hasVideo: hasExport && !!p.exportPath,
          videoUrl: hasExport ? `/media/exports/${p.id}.mp4` : null, coverUrl: cover, history: (p.history || []).slice(-10),
        });
      } catch (err) { out.push({ id: e.name, legacy: false, title: e.name, status: 'unreadable', error: err.message }); }
      continue;
    }
    // pre-v3 project: settings were never recorded, so none are shown (no guessing from current defaults)
    let title = e.name, lines = 0, dur = null, voice = null;
    try { const s = JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8')); title = s.title || title; lines = (s.lines || []).length; } catch {}
    try { const l = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'lines.json'), 'utf8')); dur = l.duration; voice = l.voice || null; } catch {}
    const coverDir = path.join(dir, 'review', 'cover'), coverF = firstFile(coverDir, /\.(jpg|png)$/);
    const cover = coverF ? `/media/projects/${e.name}/review/cover/${coverF}` : fs.existsSync(path.join(dir, 'review', 'all.jpg')) ? `/media/projects/${e.name}/review/all.jpg` : null;
    out.push({
      id: e.name, legacy: true, title, status: hasExport ? 'rendered' : 'draft', lines, durationSeconds: dur, voiceUsed: voice,
      hasVideo: hasExport, videoUrl: hasExport ? `/media/exports/${e.name}.mp4` : null, coverUrl: cover,
      updatedAt: fs.statSync(dir).mtime.toISOString(),
      note: 'Legacy project (created before v3): its generation settings were not recorded.',
    });
  }
  return out.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
