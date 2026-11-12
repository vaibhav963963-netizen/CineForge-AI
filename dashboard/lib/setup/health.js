// System health checks. Each check exercises the real thing the pipeline uses — no file-exists shortcuts:
//   ffmpeg      encode 1 s of test video+audio with libx264/AAC, then ffprobe the result
//   tts+align   the pipeline's own voice.py (Kokoro) on a one-line script, then words.py (faster-whisper)
//   webgl       headless Chrome/Edge through CDP, WebGL2 context + renderer string
//   llm/comfy   health endpoint if the service runs; an explicit "load test" starts and stops it (GPU-heavy, so it
//               is refused while a render job runs)
//   ports       the studio's ports: free / used by the studio / used by another program (never touched)
// Results: healthy | warning | failed | not-configured, each with a repair suggestion.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { PATHS, STUDIO_CONFIG, CHROME, childEnv } from '../workspace.js';
import { execText } from './system.js';
import { SETUP_DIR, logEvent, newId } from './log.js';
import { getCatalog } from '../catalog.js';

const H = (status, summary, extra = {}) => ({ status, summary, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkFfmpeg() {
  if (!fs.existsSync(PATHS.ffmpeg) || !fs.existsSync(PATHS.ffprobe)) return H('not-configured', 'FFmpeg / FFprobe not installed', { repair: { action: 'install', componentId: 'ffmpeg' } });
  const out = path.join(SETUP_DIR, `health-${process.pid}.mp4`);
  const t = Date.now();
  const r = await execText(PATHS.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', out], { timeout: 60000 });
  if (!r.ok) return H('failed', `encode failed: ${(r.stderr || r.error).slice(0, 200)}`, { repair: { action: 'repair', componentId: 'ffmpeg' } });
  const p = await execText(PATHS.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', out]);
  fs.rmSync(out, { force: true });
  let j; try { j = JSON.parse(p.stdout); } catch { return H('failed', 'ffprobe could not read the test file', { repair: { action: 'repair', componentId: 'ffmpeg' } }); }
  const codecs = j.streams.map((s) => s.codec_name).join('+'), dur = +j.format.duration;
  return H(codecs.includes('h264') && codecs.includes('aac') && Math.abs(dur - 1) < 0.2 ? 'healthy' : 'warning', `1080×1920 H.264 + AAC test clip encoded and probed (${dur.toFixed(2)} s) in ${Date.now() - t} ms`);
}

async function checkSpeech() {
  const cat = getCatalog(true), tts = cat.engines.tts, wEn = cat._internal.whisper.english;
  if (!fs.existsSync(PATHS.python)) return H('not-configured', 'Studio Python environment missing', { repair: { action: 'install', componentId: 'python-packages' } });
  if (!tts.ready) return H('not-configured', tts.reason, { repair: { action: 'install', componentId: 'kokoro-model' } });
  const voice = cat.voices.find((v) => v.id.startsWith('a')) || cat.voices[0];
  if (!voice) return H('failed', 'no voices in the Kokoro voice pack', { repair: { action: 'repair', componentId: 'kokoro-voices' } });
  const dir = path.join(SETUP_DIR, `health-speech-${process.pid}`); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify({ title: 'Setup check', lines: [{ text: 'This is a quick system check of the local voice.' }] }));
    const t = Date.now(), env = childEnv();
    const v = await execText(PATHS.python, [path.join(PATHS.engineScripts, 'voice.py'), '--script', path.join(dir, 'script.json'), '--out-dir', path.join(dir, 'audio'), '--voice', voice.id, '--lang', voice.id[0] === 'b' ? 'en-gb' : 'en-us', '--speed', '1.0'], { timeout: 180000, env });
    if (!v.ok) return H('failed', `Kokoro TTS failed: ${(v.stderr || v.stdout).trim().split('\n').pop().slice(0, 200)}`, { repair: { action: 'repair', componentId: 'python-packages' } });
    const ttsMs = Date.now() - t;
    if (!wEn) return H('warning', `Kokoro OK (${ttsMs} ms, voice ${voice.id}); English Whisper not installed`, { repair: { action: 'install', componentId: 'whisper-small-en' } });
    const w = await execText(PATHS.python, [path.join(PATHS.engineScripts, 'words.py'), '--project', dir, '--model', wEn.dir, '--language', 'en'], { timeout: 180000, env });
    if (!w.ok) return H('failed', `Whisper alignment failed: ${(w.stderr || w.stdout).trim().split('\n').pop().slice(0, 200)}`, { repair: { action: 'repair', componentId: 'whisper-small-en' } });
    let words = []; try { words = JSON.parse(fs.readFileSync(path.join(dir, 'audio', 'words.json'), 'utf8')); } catch {}
    return H(words.length >= 5 ? 'healthy' : 'warning', `Kokoro narrated a test line (${ttsMs} ms, ${voice.id}); Whisper aligned ${words.length} words (${Date.now() - t - ttsMs} ms)`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Headless browser + CDP + WebGL2: the same flags as capture.mjs, on about:blank, fully offline. */
export async function checkWebGL() {
  if (!CHROME) return H('not-configured', 'Chrome / Edge not found', { repair: { action: 'manual', componentId: 'browser' } });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-health-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--ignore-gpu-blocklist', '--force_high_performance_gpu',
    ...(process.env.SOFTWARE_GL ? ['--use-angle=swiftshader'] : []), '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-pings', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  try {
    let port; for (let i = 0; i < 150 && !port; i++) { try { port = fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch { await sleep(100); } }
    if (!port) return H('failed', 'browser did not start in headless mode', { repair: { action: 'manual', componentId: 'browser' } });
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page'); const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const val = await new Promise((res, rej) => {
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) m.error ? rej(new Error(m.error.message)) : res(m.result.result.value); };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: `(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return { ok: false }; const d = g.getExtension('WEBGL_debug_renderer_info'); return { ok: true, renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown', maxTex: g.getParameter(g.MAX_TEXTURE_SIZE) }; })()` } }));
      setTimeout(() => rej(new Error('CDP timeout')), 15000);
    });
    ws.close();
    if (!val.ok) return H('failed', 'WebGL2 is not available in headless mode', { repair: { action: 'manual', componentId: 'browser', hint: 'Update the GPU driver, or set SOFTWARE_GL=1 (slow software rendering).' } });
    const soft = /swiftshader|llvmpipe|software/i.test(val.renderer);
    return H(soft ? 'warning' : 'healthy', `WebGL2 via CDP on ${val.renderer} (max texture ${val.maxTex})`, soft ? { hint: 'Software rendering: frame capture will be slow.' } : {});
  } catch (e) { return H('failed', `CDP / WebGL check failed: ${e.message}`); }
  finally { try { chrome.kill('SIGKILL'); } catch {} setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} }, 800); }
}

async function httpOk(url) { try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; } }

/** Listening TCP ports → owning pid (netstat, read-only). */
async function listeners() {
  const r = await execText('netstat', ['-ano', '-p', 'TCP']); const map = new Map();
  for (const l of r.stdout.split(/\r?\n/)) { const m = l.trim().match(/^TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/i); if (m) map.set(+m[2], +m[3]); }
  return map;
}
export async function checkPorts(owned = {}, dashboardPort = +(process.env.PORT || STUDIO_CONFIG.port || 3000)) {
  const ls = await listeners();
  const ports = [{ name: 'Dashboard', port: dashboardPort, ownPid: process.pid }, { name: 'Script model (llama-server)', port: STUDIO_CONFIG.services.llmPort, ownPid: owned.llm }, { name: 'ComfyUI', port: STUDIO_CONFIG.services.comfyPort, ownPid: owned.comfy }];
  return ports.map((p) => {
    const pid = ls.get(p.port);
    if (!pid) return { ...p, state: 'free', status: p.ownPid === process.pid ? 'failed' : 'healthy', summary: 'free (the studio starts the service here on demand)' };
    if (pid === p.ownPid) return { ...p, pid, state: 'studio', status: 'healthy', summary: `used by the studio (pid ${pid})` };
    return { ...p, pid, state: 'other', status: 'warning', summary: `used by another program (pid ${pid}). The studio will not stop it; change services.${p.port === STUDIO_CONFIG.services.llmPort ? 'llmPort' : 'comfyPort'} in config/studio-config.json if the service cannot start.` };
  });
}

async function checkService(kind, { loadTest, busy }) {
  const port = kind === 'llm' ? STUDIO_CONFIG.services.llmPort : STUDIO_CONFIG.services.comfyPort;
  const url = kind === 'llm' ? `http://127.0.0.1:${port}/health` : `http://127.0.0.1:${port}/system_stats`;
  const cat = getCatalog(true), eng = kind === 'llm' ? cat.engines.llm : cat.engines.comfyui;
  if (!eng.ready) return H('not-configured', eng.reason, { repair: { action: 'install', componentId: kind === 'llm' ? 'gemma-3-4b' : 'comfyui' } });
  if (await httpOk(url)) return H('healthy', `running and answering on 127.0.0.1:${port}`);
  if (!loadTest) return H('healthy', 'installed; starts on demand (run the load test to start and stop it once)', { loadTest: true });
  if (busy) return H('warning', `load test skipped: ${busy}`);
  const t = Date.now();
  try {
    if (kind === 'llm') {
      const llm = await import('../llm.js');
      await llm.ensureServer();
      const r = await llm.chat({ messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxTokens: 8, temperature: 0 });
      llm.stopServer();
      return H('healthy', `model loaded and answered "${r.text.trim().slice(0, 30)}" in ${((Date.now() - t) / 1000).toFixed(1)} s (server stopped again)`);
    }
    const ig = await import('../imagegen.js');
    await ig.ensureComfy();
    const stats = await (await fetch(url)).json();
    ig.stopComfy();
    const dev = stats.devices?.[0];
    return H('healthy', `ComfyUI started in ${((Date.now() - t) / 1000).toFixed(1)} s on ${dev ? `${dev.name} (${(dev.vram_total / 1073741824).toFixed(1)} GB)` : 'unknown device'} (stopped again)`);
  } catch (e) { return H('failed', `${kind === 'llm' ? 'llama-server' : 'ComfyUI'} load test failed: ${e.message.slice(0, 240)}`, { repair: { action: 'repair', componentId: kind === 'llm' ? 'llama-cpp' : 'comfyui-requirements' } }); }
}

/** Run checks. `which` = list of ids, default all non-load-test checks. */
export async function runHealth({ which, loadTest = false, busy = null, statuses = {}, system = null, port } = {}) {
  const opId = newId('health'), t0 = Date.now(), all = {};
  const want = (id) => !which || which.includes(id);
  const tasks = {
    backend: async () => H('healthy', `dashboard backend pid ${process.pid}, Node ${process.version}, up ${Math.round(process.uptime())} s`),
    frontend: async () => { const f = ['index.html', 'app.js', 'setup.js', 'style.css'].filter((x) => !fs.existsSync(path.join(PATHS.root, 'dashboard', 'public', x))); return f.length ? H('failed', `missing ${f.join(', ')}`) : H('healthy', 'static UI files present (no build step needed)'); },
    ffmpeg: checkFfmpeg,
    speech: () => (busy ? H('warning', `skipped while ${busy}`) : checkSpeech()),
    webgl: checkWebGL,
    llm: () => checkService('llm', { loadTest, busy }),
    comfyui: () => checkService('comfy', { loadTest, busy }),
    ports: async () => { const p = await checkPorts({}, port); const bad = p.filter((x) => x.status !== 'healthy'); return H(bad.some((b) => b.status === 'failed') ? 'failed' : bad.length ? 'warning' : 'healthy', p.map((x) => `${x.port} ${x.state}`).join(' · '), { ports: p }); },
    folders: async () => { const w = system?.permissions?.writable || {}; const bad = Object.entries(w).filter(([, ok]) => !ok).map(([k]) => k); return bad.length ? H('failed', `not writable: ${bad.join(', ')}`, { hint: 'Move the workspace to a folder you own (not Program Files).' }) : H('healthy', 'workspace, runtime, models, logs, projects and exports are writable'); },
    storage: async () => { const g = system?.workspaceDisk?.freeGB; return g == null ? H('warning', 'free space unknown') : g < 5 ? H('failed', `${g} GB free — renders and downloads will fail`) : g < 15 ? H('warning', `${g} GB free — tight for model downloads`) : H('healthy', `${g} GB free on the workspace drive`); },
    gpu: async () => { const nv = system?.gpu?.nvidia; if (!nv) return H('warning', 'not scanned'); if (!nv.present) return H('warning', 'no NVIDIA GPU: CPU profile (image generation impractical; WebGL uses the integrated GPU)'); return H(nv.cudaCapable ? 'healthy' : 'warning', `${nv.name}, ${nv.vramGB} GB VRAM, driver ${nv.driver}${nv.cudaCapable ? '' : ` (< ${nv.minDriverForCuda126} for CUDA 12.6)`}`); },
    models: async () => { const ids = ['kokoro-model', 'kokoro-voices', 'whisper-small-en', 'whisper-small', 'gemma-3-4b', 'dreamshaper-8']; const s = ids.map((i) => [i, statuses[i]]).filter(([, x]) => x); const bad = s.filter(([, x]) => x.integrity === 'corrupted'); const unv = s.filter(([, x]) => x.integrity === 'unverified'); return bad.length ? H('failed', `corrupted: ${bad.map(([i]) => i).join(', ')}`, { repair: { action: 'repair', componentId: bad[0][0] } }) : unv.length ? H('warning', `${unv.length} model file set(s) not hash-verified yet (sizes match)`, { hint: 'Run Verify on the AI Models tab (hashes multi-GB files, takes a minute).' }) : H('healthy', 'all installed models match their checksums'); },
  };
  await Promise.all(Object.entries(tasks).filter(([id]) => want(id)).map(async ([id, fn]) => { const t = Date.now(); try { all[id] = { ...(await fn()), ms: Date.now() - t }; } catch (e) { all[id] = H('failed', e.message, { ms: Date.now() - t }); } }));
  logEvent({ kind: 'health', opId, results: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.status])), ms: Date.now() - t0 });
  return { opId, checkedAt: new Date().toISOString(), ms: Date.now() - t0, checks: all };
}
