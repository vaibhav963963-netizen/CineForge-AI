// Streamed hashing (64 KB chunks, never loads a model into memory) with a cache keyed by path + size + mtime, so a
// 2.5 GB GGUF is hashed once and re-hashed only when the file changes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SETUP_DIR, readJson, writeJsonAtomic } from './log.js';

const CACHE_FILE = path.join(SETUP_DIR, 'hash-cache.json');
let cache = null;
const load = () => (cache ??= readJson(CACHE_FILE, {}));
const keyOf = (abs, st) => `${path.resolve(abs).toLowerCase()}|${st.size}|${Math.round(st.mtimeMs)}`;

export function cachedHash(abs, algo = 'sha256', encoding = 'hex') {
  try { const st = fs.statSync(abs); return load()[`${algo}:${encoding}:${keyOf(abs, st)}`] || null; } catch { return null; }
}

export async function hashFile(abs, { algo = 'sha256', encoding = 'hex', onProgress, signal, useCache = true } = {}) {
  const st = fs.statSync(abs), key = `${algo}:${encoding}:${keyOf(abs, st)}`;
  if (useCache && load()[key]) return load()[key];
  const h = crypto.createHash(algo); let done = 0, last = 0;
  for await (const chunk of fs.createReadStream(abs, { highWaterMark: 1 << 20 })) {
    if (signal?.aborted) throw Object.assign(new Error('hashing cancelled'), { cancelled: true });
    h.update(chunk); done += chunk.length;
    if (onProgress && Date.now() - last > 250) { last = Date.now(); onProgress(done, st.size); }
  }
  const digest = h.digest(encoding);
  load()[key] = digest;
  try { writeJsonAtomic(CACHE_FILE, cache); } catch {}
  return digest;
}
