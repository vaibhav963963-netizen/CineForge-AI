// Frame-exact capture through headless Chrome (DevTools Protocol). No npm packages (Node 22+). Run from the project.
//   node tools/capture.mjs check                       boot, list shots + captions, draw every 0.25 s, report errors
//   node tools/capture.mjs cues                        write audio/cues.json (sound cues for tools/mix.py)
//   node tools/capture.mjs sheet review/sheet.jpg [step=1] [cols=8]   contact sheet
//   node tools/capture.mjs frames review/cover "1.2,8.4"            full-size JPEGs of those times
//   node tools/capture.mjs video renders/video-only.mp4              every frame (FPS env, default 30) → H.264, no audio
//   node tools/capture.mjs preview                     serve the project and print a URL
// Progress for the studio job system is printed as "@@PROGRESS {json}" lines; results as "@@RESULT {json}".
// CHROME=/path overrides the browser; FFMPEG=/path the encoder (the studio passes the workspace binaries).
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FPS = +(process.env.FPS || 30);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2), flags = new Set(args.filter((a) => a.startsWith('--')));
const [mode, ...rest] = args.filter((a) => !a.startsWith('--'));
const progress = (o) => console.log('@@PROGRESS ' + JSON.stringify(o));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.otf': 'font/otf',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
function serve(port = 0) {
  return new Promise((res) => {
    const srv = http.createServer((req, r) => {
      const u = decodeURIComponent(req.url.split('?')[0]), f = path.join(ROOT, u === '/' ? 'index.html' : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(r);
    });
    srv.listen(port, '127.0.0.1', () => res(srv));
  });
}

async function openPage(port) {
  if (!CHROME) throw new Error('Chrome/Edge not found: install Google Chrome or set CHROME=/path/to/chrome');
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check',
    // --force_high_performance_gpu: on hybrid-graphics laptops headless Chrome otherwise renders WebGL on the
    // integrated GPU (verified: Intel UHD by default, NVIDIA RTX 3050 with this switch)
    '--hide-scrollbars', '--window-size=1080,1920', '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader', ...(process.env.SOFTWARE_GL ? ['--use-angle=swiftshader'] : []),
    '--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
  let dbg;
  for (let i = 0; i < 200 && !dbg; i++) { try { dbg = fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch { await sleep(100); } }
  if (!dbg) { chrome.kill('SIGKILL'); throw new Error('Chrome did not start'); }
  const r = await fetch(`http://127.0.0.1:${dbg}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/index.html?capture=1${process.env.QS || ''}`)}`, { method: 'PUT' });
  const target = await r.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(), logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('ERROR ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const x = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (x.exceptionDetails) throw new Error(x.exceptionDetails.exception?.description || x.exceptionDetails.text); return x.result.value; };
  await send('Runtime.enable');
  for (let i = 0; ; i++) {
    const st = await ev('window.OP ? (OP.bootError ? "ERR:" + OP.bootError : OP.ready) : false').catch(() => false);
    if (st === true) break;
    if (typeof st === 'string') throw new Error('boot failed: ' + st + '\n' + logs.join('\n'));
    if (i > 1800) throw new Error('boot timeout (180 s)\n' + logs.join('\n'));
    await sleep(100);
  }
  const gpu = await ev(`(() => { try { const g = document.createElement('canvas').getContext('webgl2'); const d = g && g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : (g ? 'webgl2' : 'none'); } catch (e) { return 'none'; } })()`).catch(() => 'unknown');
  const close = () => { try { ws.close(); } catch {} chrome.kill('SIGKILL'); setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} }, 400); };
  return { ev, logs, close, gpu };
}
const jpg = (d) => Buffer.from(d.slice(d.indexOf(',') + 1), 'base64');
const FRAME = (t, q, label) => `(() => { const d = OP.frame(${t}, ${q}); ${label ? `const cv = document.getElementById('cv'), c = cv.getContext('2d'); c.setTransform(1,0,0,1,0,0); c.fillStyle = '#000'; c.fillRect(0, 0, 250, 86); c.fillStyle = '#fff'; c.font = '700 60px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText('${(+t).toFixed(2)}', 14, 64); return cv.toDataURL('image/jpeg', ${q});` : 'return d;'} })()`;

const srv = await serve(mode === 'preview' ? 8765 : 0), port = srv.address().port;
if (mode === 'preview') { console.log(`open http://127.0.0.1:${port}/  (Ctrl+C to stop)`); }
else {
  const P = await openPage(port);
  try {
    const dur = await P.ev('OP.duration()');
    if (mode === 'check') {
      console.log(`duration ${dur.toFixed(2)} s · WebGL renderer: ${P.gpu}`);
      const shots = await P.ev('OP.shots()');
      for (const s of shots) console.log(`${s.id.padEnd(5)} ${s.at.toFixed(2).padStart(6)} → ${s.end.toFixed(2).padStart(6)}  (${(s.end - s.at).toFixed(2)} s)  ${s.note}`);
      const caps = await P.ev('OP.captions()');
      console.log(`captions: ${caps.length}`); for (const c of caps.slice(0, 80)) console.log(`  ${c.s.toFixed(2).padStart(6)}–${c.e.toFixed(2).padEnd(6)} ${c.text}`);
      let bad = 0; const times = []; for (let t = 0; t < dur; t += 0.25) times.push(t);
      for (const [k, t] of times.entries()) {
        try { await P.ev(`OP.draw(${t})`); } catch (e) { bad++; console.log(`ERROR at ${t.toFixed(2)}: ${e.message.split('\n')[0]}`); }
        if (k % 8 === 0 || k === times.length - 1) progress({ current: k + 1, total: times.length, unit: 'check', message: `Validating animation at ${t.toFixed(2)} s of ${dur.toFixed(2)} s` });
      }
      if (P.logs.length) console.log(P.logs.join('\n'));
      const ok = !bad && !P.logs.length;
      console.log('@@RESULT ' + JSON.stringify({ ok, duration: dur, shots: shots.length, captions: caps.length, errors: bad + P.logs.length, gpu: P.gpu }));
      console.log(ok ? 'CHECK OK' : 'CHECK FAILED');
      if (!ok) process.exitCode = 3;
    } else if (mode === 'cues') {
      const cues = await P.ev('OP.cues()');
      fs.mkdirSync(path.join(ROOT, 'audio'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'audio/cues.json'), JSON.stringify({ duration: dur, cues }, null, 1));
      console.log(`audio/cues.json: ${cues.length} cues, ${dur.toFixed(2)} s`);
    } else if (mode === 'frames') {
      const dir = path.resolve(ROOT, rest[0] || 'review/frames'); fs.mkdirSync(dir, { recursive: true });
      const ts = (rest[1] || '0').split(',').map(Number);
      for (const t of ts) fs.writeFileSync(path.join(dir, `t${t.toFixed(2)}.jpg`), jpg(await P.ev(FRAME(Math.min(t, dur - 0.05), 0.92))));
      console.log(dir);
    } else if (mode === 'sheet') {
      const out = path.resolve(ROOT, rest[0] || 'review/sheet.jpg'), step = +(rest[1] || 1), cols = +(rest[2] || 8);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sheet-')); let n = 0; const total = Math.ceil(dur / step);
      for (let t = step / 2; t < dur; t += step) { fs.writeFileSync(path.join(tmp, `f${String(n++).padStart(4, '0')}.jpg`), jpg(await P.ev(FRAME(t, 0.8, true)))); progress({ current: n, total, unit: 'frame', message: `Contact sheet frame ${n} of ${total}` }); }
      const rows = Math.ceil(n / cols); fs.mkdirSync(path.dirname(out), { recursive: true });
      const r = spawnSync(FFMPEG, ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(tmp, 'f%04d.jpg'), '-vf', `scale=216:384,tile=${cols}x${rows}:padding=4:color=black`, '-frames:v', '1', '-q:v', '3', out]);
      fs.rmSync(tmp, { recursive: true, force: true });
      if (r.status) throw new Error('ffmpeg: ' + r.stderr); console.log(`${out} (${n} frames, every ${step} s)`);
    } else if (mode === 'video') {
      const out = path.resolve(ROOT, rest[0] || 'renders/video-only.mp4'); fs.mkdirSync(path.dirname(out), { recursive: true });
      const n = Math.round(dur * FPS);
      const ff = spawn(FFMPEG, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-an',
        '-c:v', 'libx264', '-preset', flags.has('--draft') ? 'ultrafast' : 'veryfast', '-crf', flags.has('--draft') ? '28' : '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
        '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
      let ffErr = null; ff.on('error', (e) => { ffErr = e; });
      const t0 = Date.now();
      for (let i = 0; i < n; i++) {
        if (ffErr) throw new Error('ffmpeg: ' + ffErr.message);
        const b = jpg(await P.ev(FRAME(i / FPS, flags.has('--draft') ? 0.8 : 0.93)));
        if (!ff.stdin.write(b)) await new Promise((r) => ff.stdin.once('drain', r));
        if (i % 15 === 0 || i === n - 1) {
          const el = (Date.now() - t0) / 1000, fps = (i + 1) / Math.max(el, 0.001);
          progress({ current: i + 1, total: n, unit: 'frame', message: `Capturing frame ${i + 1} of ${n} (${fps.toFixed(1)} fps)` });
        }
      }
      ff.stdin.end(); const code = await new Promise((r) => ff.on('close', r));
      if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
      if (P.logs.length) { console.log(P.logs.join('\n')); throw new Error('page errors during capture'); }
      console.log('@@RESULT ' + JSON.stringify({ frames: n, fps: FPS, seconds: +((Date.now() - t0) / 1000).toFixed(1), gpu: P.gpu, out }));
      console.log(`${out} (${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s, WebGL: ${P.gpu})`);
    } else console.log('modes: check · cues · sheet · frames · video · preview');
  } finally { P.close(); srv.close(); }
}
