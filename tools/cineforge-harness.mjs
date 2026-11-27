// Shared harness for the CineForge stage: serves the stage page and vendored Three.js, runs headless Chrome with WebGL,
// and collects the page's result (and optional frame uploads). Used by tests/cineforge-stage.render.test.mjs and
// tools/cineforge-video.mjs. Node 22+, no npm packages.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const CINE = path.join(ROOT, 'dashboard', 'lib', 'cineforge');
export const THREE_MODULE = path.join(ROOT, 'engine', 'styles', 'deep-dive', 'example', 'vendor', 'three.module.js');

export function findChrome() {
  return [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && fs.existsSync(p)) || null;
}

/**
 * Serve the stage. plan is returned at /plan.json. onFrame(index, buffer) receives JPEG frames posted by the page.
 * Resolves to { server, url }.
 */
export function serveStage(plan, { onFrame = null } = {}) {
  const routes = {
    '/': [path.join(CINE, 'stage.html'), 'text/html'],
    '/stage.html': [path.join(CINE, 'stage.html'), 'text/html'],
    '/stage-renderer.js': [path.join(CINE, 'stage-renderer.js'), 'text/javascript'],
    '/stage-runner.js': [path.join(CINE, 'stage-runner.js'), 'text/javascript'],
    '/motion.js': [path.join(CINE, 'motion.js'), 'text/javascript'],
    '/vocab.js': [path.join(CINE, 'vocab.js'), 'text/javascript'],
    '/vendor/three.module.js': [THREE_MODULE, 'text/javascript'],
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/plan.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(plan)); }
    if (u.pathname === '/frame' && req.method === 'POST' && onFrame) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { onFrame(Number(u.searchParams.get('i')), Buffer.concat(chunks)); res.writeHead(204); res.end(); });
      return;
    }
    const r = routes[u.pathname];
    if (!r) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': r[1] });
    fs.createReadStream(r[0]).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/stage.html` })));
}

/** Run headless Chrome with WebGL on url and return the DOM after the page has finished (virtual time). */
export function runChrome(url, { width = 540, height = 960, timeoutMs = 170000 } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('no Chrome/Edge found');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-stage-'));
  const args = ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${width},${height}`,
    '--virtual-time-budget=600000', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--dump-dom', url];
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('chrome timed out')); }, timeoutMs);
    child.on('close', () => { clearTimeout(timer); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} resolve(out); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Extract and parse the JSON result the stage page writes into <pre id="out">. */
export function parseStageResult(dom) {
  const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) throw new Error('stage page produced no result');
  const text = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(text);
}
