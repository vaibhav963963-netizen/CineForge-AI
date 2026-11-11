// Canonical workspace configuration. Every path the studio touches is resolved here, relative to the workspace root
// (the folder that contains dashboard/, engine/, projects/ ...). Nothing outside the workspace is used at runtime:
// no ~/.faceless-shorts, no ~/faceless-shorts, no ~/.cache/huggingface. Those old folders are left untouched as
// recovery backups only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_FILE = path.join(ROOT, 'config', 'studio-config.json');
export const STUDIO_CONFIG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

const r = (p) => path.resolve(ROOT, p);
const P = STUDIO_CONFIG.paths;

export const PATHS = {
  root: ROOT,
  engine: r(P.engine),
  styles: r(P.styles),
  runtimeTemplate: r(P.runtimeTemplate),
  engineScripts: r(P.engineScripts),
  comfyWorkflows: r(P.comfyWorkflows),
  projects: r(P.projects),
  exports: r(P.exports),
  logs: r(P.logs),
  jobs: r(P.jobs),
  fonts: r(P.fonts),
  characters: r(P.characters),
  models: {
    kokoro: r(P.models.kokoro),
    whisperEnglish: r(P.models.whisperEnglish),
    whisperMultilingual: r(P.models.whisperMultilingual),
    llm: r(P.models.llm),
    imageGeneration: r(P.models.imageGeneration),
  },
  python: r(P.runtime.python),
  pythonScripts: path.dirname(r(P.runtime.python)),
  ffmpegBin: r(P.runtime.ffmpeg),
  ffmpeg: path.join(r(P.runtime.ffmpeg), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
  ffprobe: path.join(r(P.runtime.ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
  llamaCpp: r(P.runtime.llamaCpp),
  comfyui: r(P.runtime.comfyui),
};

/** Directories known to belong to the pre-migration layout. They must never be used at runtime. */
export const LEGACY_LOCATIONS = ['faceless-shorts', '.faceless-shorts', path.join('.cache', 'huggingface')];

export const CHROME = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p)) || null;

export function isInsideWorkspace(p) {
  const rel = path.relative(ROOT, path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function assertInsideWorkspace(p, what = 'path') {
  if (!isInsideWorkspace(p)) throw new Error(`${what} resolves outside the workspace: ${p}`);
  return path.resolve(p);
}

/** Path relative to the workspace root, with forward slashes, for logs and the UI. */
export const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/**
 * Environment for every child process (Python, Node render tools, FFmpeg). Model caches point inside the workspace
 * and Hugging Face is forced offline, so a missing model fails loudly instead of being downloaded to ~/.cache.
 */
export function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['FACELESS_HOME', 'HF_HOME', 'WHISPER_MODEL_PATH', 'HUGGINGFACE_HUB_CACHE', 'XDG_CACHE_HOME']) delete env[k];
  const sep = process.platform === 'win32' ? ';' : ':';
  return {
    ...env,
    STUDIO_ROOT: ROOT,
    KOKORO_DIR: PATHS.models.kokoro,
    HF_HOME: path.join(ROOT, 'models', 'hf-home'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PATH: [PATHS.ffmpegBin, PATHS.pythonScripts, env.PATH || env.Path || ''].join(sep),
    ...(CHROME ? { CHROME } : {}),
    ...extra,
  };
}

export function ensureDirs() {
  for (const d of [PATHS.projects, PATHS.exports, PATHS.logs, PATHS.jobs]) fs.mkdirSync(d, { recursive: true });
}
