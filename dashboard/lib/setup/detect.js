// Component detection. A component is "ready" only when its real check passes: files present with the expected size
// (and no known hash mismatch), executables run and report a compatible version, pip pins match, imports succeed.
// A folder that merely exists is never enough.
import fs from 'node:fs';
import path from 'node:path';
import { CHROME } from '../workspace.js';
import { loadRegistry, baseVars, resolvePath, resolvedFiles } from './registry.js';
import { cachedHash } from './hashcache.js';
import { execText, cmpVersion } from './system.js';
import { childEnv } from '../workspace.js';

const pyEnv = () => { const e = childEnv(); delete e.PYTHONHOME; delete e.PYTHONPATH; return e; };
const exists = (p) => { try { return fs.statSync(p); } catch { return null; } };

/** Locate a usable Python 3.12 base interpreter: portable runtime/python312 first, then the py launcher. */
export async function findBasePython(c, vars = baseVars()) {
  const portable = resolvePath(c.detect.portable, vars);
  const want = `${c.detect.major}.${c.detect.minor}`;
  const cands = [];
  if (exists(portable)) cands.push({ exe: portable, how: 'portable (runtime/python312)' });
  const py = await execText('py', [`-${want}`, '-c', 'import sys;print(sys.executable)']);
  if (py.ok && py.stdout.trim()) cands.push({ exe: py.stdout.trim().split(/\r?\n/).pop(), how: `py -${want} launcher` });
  for (const cand of cands) {
    const r = await execText(cand.exe, ['-c', 'import sys,venv,ensurepip;print("%d.%d.%d"%sys.version_info[:3])'], { env: pyEnv() });
    if (r.ok && r.stdout.trim().startsWith(want)) return { ...cand, version: r.stdout.trim() };
  }
  return null;
}

function parseRequirements(file) {
  const pins = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.replace(/#.*/, '').trim().match(/^([A-Za-z0-9_.-]+)\s*==\s*([^\s;]+)/);
    if (m) pins.push({ name: m[1].toLowerCase().replace(/[-_.]+/g, '-'), version: m[2] });
  }
  return pins;
}

async function importCheck(python, mods) {
  const code = `import importlib,json\nbad={}\nfor m in ${JSON.stringify(mods)}:\n  try: importlib.import_module(m)\n  except Exception as e: bad[m]=type(e).__name__+': '+str(e)[:160]\nprint(json.dumps(bad))`;
  const r = await execText(python, ['-c', code], { timeout: 120000, env: pyEnv() });
  try { return JSON.parse(r.stdout.trim().split(/\r?\n/).pop()); } catch { return { _python: r.error || r.stderr.slice(-300) || 'python failed' }; }
}

function browserVersion(exe) {
  try { const d = path.dirname(exe); const v = fs.readdirSync(d).filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x)).sort((a, b) => cmpVersion(b, a))[0]; return v || null; } catch { return null; }
}

const R = (status, extra = {}) => ({ status, problems: [], ...extra });

export async function detectComponent(c, ctx = {}) {
  const d = c.detect, vars = ctx.vars || baseVars();
  try {
    switch (d.type) {
      case 'os': {
        const s = ctx.system?.os; if (!s) return R('not-checked');
        const ok = s.platform === d.platform && d.arch.includes(s.arch) && s.build >= d.minBuild;
        return R(ok ? 'ready' : 'incompatible', { version: `${s.name} (build ${s.build}, ${s.arch})`, problems: ok ? [] : [`needs ${d.platform} ${d.arch.join('/')} build ≥ ${d.minBuild}`] });
      }
      case 'node': {
        const v = process.version.slice(1), ok = cmpVersion(v, c.minVersion) >= 0;
        return R(ok ? (c.version && cmpVersion(v, c.version) < 0 ? 'update-available' : 'ready') : 'incompatible', { version: v, location: process.execPath, problems: ok ? [] : [`Node ${c.minVersion}+ required`] });
      }
      case 'npm-none': {
        const pj = JSON.parse(fs.readFileSync(resolvePath(d.packageJson, vars), 'utf8'));
        const deps = { ...(pj.dependencies || {}), ...(pj.devDependencies || {}) };
        return R(Object.keys(deps).length ? 'not-installed' : 'ready', { version: `${Object.keys(deps).length} packages`, detail: Object.keys(deps).length ? 'package.json now declares dependencies: run npm ci in dashboard/' : 'zero npm dependencies (Node built-ins only)' });
      }
      case 'exec': {
        const exe = d.exe.startsWith('system:') ? d.exe.slice(7) : resolvePath(d.exe, vars);
        if (!d.exe.startsWith('system:') && !exists(exe)) return R('not-installed', { location: exe, problems: [`${path.basename(exe)} not found`] });
        const r = await execText(exe, d.args, { timeout: 20000 });
        const m = (r.stdout + '\n' + r.stderr).match(new RegExp(d.regex));
        if (!m) return R(r.error === 'not found' ? 'not-installed' : 'failed', { location: exe, problems: [r.error === 'not found' ? `${exe} not found on PATH` : `could not read version: ${(r.error || r.stderr).slice(0, 200)}`] });
        const v = m[1];
        if (c.minVersion && cmpVersion(v, c.minVersion) < 0) return R('incompatible', { version: v, location: exe, problems: [`version ${v} < required ${c.minVersion}`] });
        if (c.version && cmpVersion(v, c.version) < 0) return R('update-available', { version: v, location: exe });
        return R('ready', { version: v, location: exe });
      }
      case 'python-base': {
        const p = await findBasePython(c, vars);
        return p ? R('ready', { version: p.version, location: p.exe, detail: p.how }) : R('not-installed', { problems: ['No Python 3.12 with venv/ensurepip found (portable runtime/python312 or py launcher)'] });
      }
      case 'python-version': {
        const exe = resolvePath(d.python, vars); if (!exists(exe)) return R('not-installed', { location: exe, problems: ['environment not created'] });
        const r = await execText(exe, ['-c', 'import sys;print("%d.%d.%d"%sys.version_info[:3])'], { env: pyEnv() });
        if (!r.ok) return R('failed', { location: exe, problems: [`python does not start (base interpreter moved or removed?): ${(r.error || r.stderr).slice(0, 200)}`] });
        const v = r.stdout.trim(); const ok = v.startsWith(`${d.major}.${d.minor}.`);
        return R(ok ? 'ready' : 'incompatible', { version: v, location: exe, problems: ok ? [] : [`Python ${d.major}.${d.minor} required`] });
      }
      case 'pip-pins': {
        const exe = resolvePath(d.python, vars); if (!exists(exe)) return R('not-installed', { problems: ['studio Python environment missing'] });
        const pins = parseRequirements(resolvePath(d.requirements, vars));
        const r = await execText(exe, ['-m', 'pip', 'list', '--format=json', '--disable-pip-version-check'], { timeout: 60000, env: pyEnv() });
        let have = []; try { have = JSON.parse(r.stdout); } catch { return R('failed', { problems: ['pip list failed: ' + (r.error || r.stderr).slice(0, 200)] }); }
        const map = new Map(have.map((p) => [p.name.toLowerCase().replace(/[-_.]+/g, '-'), p.version]));
        const packages = pins.map((p) => ({ name: p.name, want: p.version, have: map.get(p.name) || null }));
        const missing = packages.filter((p) => !p.have), wrong = packages.filter((p) => p.have && p.have !== p.want);
        const bad = missing.length ? {} : await importCheck(exe, d.imports || []);
        const problems = [...missing.map((p) => `${p.name} missing`), ...wrong.map((p) => `${p.name} ${p.have} (pinned ${p.want})`), ...Object.entries(bad).map(([m, e]) => `import ${m} failed: ${e}`)];
        const status = missing.length === packages.length ? 'not-installed' : missing.length || Object.keys(bad).length ? 'failed' : wrong.length ? 'incompatible' : 'ready';
        return R(status, { version: `${packages.length - missing.length}/${packages.length} pinned packages`, packages, problems, location: exe });
      }
      case 'python-import': {
        const exe = resolvePath(d.python, vars); if (!exists(exe)) return R('not-installed', { problems: ['Python environment missing'] });
        const bad = await importCheck(exe, d.imports);
        const n = Object.keys(bad).length;
        return R(n === 0 ? 'ready' : n === d.imports.length ? 'not-installed' : 'failed', { version: `${d.imports.length - n}/${d.imports.length} modules import`, problems: Object.entries(bad).map(([m, e]) => `${m}: ${e}`) });
      }
      case 'torch': {
        const exe = resolvePath(d.python, vars); if (!exists(exe)) return R('not-installed', { problems: ['ComfyUI Python environment missing'] });
        const r = await execText(exe, ['-c', 'import json,torch;print(json.dumps({"v":torch.__version__,"cuda":torch.version.cuda,"avail":torch.cuda.is_available(),"dev":torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))'], { timeout: 120000, env: pyEnv() });
        let t; try { t = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()); } catch { return R(/No module named/.test(r.stderr) ? 'not-installed' : 'failed', { problems: [(r.stderr || r.error || '').slice(-300)] }); }
        const base = t.v.split('+')[0], problems = [];
        if (t.cuda && !t.avail) problems.push(`CUDA build (cu${t.cuda}) but no usable CUDA GPU: ComfyUI must run with the CPU profile`);
        const status = cmpVersion(base, d.version) !== 0 ? 'incompatible' : 'ready';
        if (status === 'incompatible') problems.push(`torch ${t.v} installed, ${d.version} is the tested version`);
        return R(status, { version: `${t.v}${t.cuda ? ` · CUDA ${t.cuda}` : ' · CPU'}${t.dev ? ` · ${t.dev}` : ''}`, cuda: t.cuda, cudaAvailable: t.avail, problems });
      }
      case 'ffmpeg': {
        const ff = resolvePath(d.ffmpeg, vars), fp = resolvePath(d.ffprobe, vars);
        if (!exists(ff) || !exists(fp)) return R('not-installed', { location: path.dirname(ff), problems: [!exists(ff) ? 'ffmpeg.exe missing' : 'ffprobe.exe missing'] });
        const [v, enc, fil, pv] = await Promise.all([execText(ff, ['-hide_banner', '-version']), execText(ff, ['-hide_banner', '-encoders']), execText(ff, ['-hide_banner', '-filters']), execText(fp, ['-hide_banner', '-version'])]);
        const m = v.stdout.match(/ffmpeg version (\S+)/); if (!m || !pv.ok) return R('failed', { location: path.dirname(ff), problems: ['ffmpeg/ffprobe do not run'] });
        const problems = [...d.encoders.filter((e) => !new RegExp(`\\s${e}\\s`).test(enc.stdout)).map((e) => `encoder ${e} missing`), ...d.filters.filter((f) => !new RegExp(`\\s${f}\\s`).test(fil.stdout)).map((f) => `filter ${f} missing`)];
        const ver = m[1].match(/^[\d.]+/)?.[0] || m[1];
        return R(problems.length ? 'incompatible' : c.version && cmpVersion(ver, c.version) < 0 ? 'update-available' : 'ready', { version: m[1], location: path.dirname(ff), problems });
      }
      case 'browser': {
        if (!CHROME) return R('not-installed', { problems: ['Neither Google Chrome nor Microsoft Edge was found; set CHROME=path'] });
        return R('ready', { version: browserVersion(CHROME) || 'installed', location: CHROME, detail: /msedge/i.test(CHROME) ? 'Microsoft Edge' : 'Chromium-based browser' });
      }
      case 'nvidia': {
        const nv = ctx.system?.gpu?.nvidia; if (!nv) return R('not-checked');
        if (!nv.present) return R('not-installed', { detail: nv.reason, problems: [] });
        return R(nv.cudaCapable ? 'ready' : 'incompatible', { version: nv.driver, detail: `${nv.name} · ${nv.vramGB} GB VRAM · compute ${nv.computeCapability}`, problems: nv.cudaCapable ? [] : [`driver ${nv.driver} is older than ${nv.minDriverForCuda126} (CUDA 12.6)`] });
      }
      case 'files': {
        const files = resolvedFiles(c, vars).map((f) => {
          const st = exists(f.abs), part = exists(`${f.abs}.part`);
          const sizeOk = !!st && (!f.size || st.size === f.size);
          const h = st && f.sha256 ? cachedHash(f.abs) : null;
          const integrity = !st ? 'missing' : !sizeOk ? 'size-mismatch' : !f.sha256 ? 'size-only' : !h ? 'unverified' : h === f.sha256 ? 'verified' : 'hash-mismatch';
          return { path: f.path, abs: f.abs, exists: !!st, size: st ? st.size : 0, expectedSize: f.size || null, integrity, checksumSource: f.checksumSource || null, partialBytes: part ? part.size : 0, url: f.url || null };
        });
        const missing = files.filter((f) => !f.exists), bad = files.filter((f) => f.integrity === 'size-mismatch' || f.integrity === 'hash-mismatch');
        const problems = [...missing.map((f) => `${f.path} missing${f.partialBytes ? ` (${(f.partialBytes / 1048576).toFixed(0)} MB partial download)` : ''}`), ...bad.map((f) => `${f.path}: ${f.integrity === 'size-mismatch' ? `size ${f.size} ≠ expected ${f.expectedSize}` : 'SHA-256 does not match'}`)];
        const status = missing.length === files.length ? 'not-installed' : bad.length ? 'failed' : missing.length ? 'not-installed' : 'ready';
        const integrity = bad.length ? 'corrupted' : files.every((f) => f.integrity === 'verified' || f.integrity === 'size-only') ? 'verified' : files.some((f) => f.integrity === 'unverified') ? 'unverified' : 'size-checked';
        return R(status, { files, integrity, installedBytes: files.reduce((a, f) => a + f.size, 0), location: resolvePath(c.detect.base, vars), problems });
      }
      default: return R('not-checked', { problems: [`unknown detect type ${d.type}`] });
    }
  } catch (e) {
    return R('failed', { problems: [e.message.slice(0, 300)] });
  }
}

/** Bytes still to download / write for a component that is not ready. */
export function remainingBytes(c, st) {
  // unknown is not "missing": nothing is counted until a scan says so
  if (st.status === 'ready' || st.status === 'update-available' || st.status === 'not-checked') return 0;
  if (c.detect.type === 'files') return (st.files || []).filter((f) => !f.exists || f.integrity === 'size-mismatch' || f.integrity === 'hash-mismatch').reduce((a, f) => a + (f.expectedSize || 0) - (f.partialBytes || 0), 0);
  return c.diskBytes || 0;
}

export async function detectAll(system, { only } = {}) {
  const reg = loadRegistry(), vars = baseVars(), out = {};
  const list = reg.components.filter((c) => !only || only.includes(c.id));
  // a few at a time: each python/torch probe starts an interpreter
  const queue = [...list];
  await Promise.all(Array.from({ length: 4 }, async () => { for (let c; (c = queue.shift());) { const t = Date.now(); out[c.id] = { ...(await detectComponent(c, { system, vars })), checkedAt: new Date().toISOString(), checkMs: Date.now() - t }; } }));
  return out;
}

export function featureReadiness(reg, statuses) {
  return reg.features.map((f) => {
    const missing = f.requires.filter((id) => !['ready', 'update-available'].includes(statuses[id]?.status));
    return { id: f.id, name: f.name, note: f.note || null, ready: missing.length === 0, missing: missing.map((id) => ({ id, name: reg.byId.get(id).name, status: statuses[id]?.status || 'not-checked' })) };
  });
}
