// Local script model: llama.cpp's llama-server (runtime/llama.cpp) with a GGUF model from models/llm.
// Started on demand, bound to 127.0.0.1 only, stopped after a short idle period so the 6 GB GPU is free again for
// ComfyUI and WebGL capture. No cloud API is ever called.
import { spawn } from 'node:child_process';
import { getCatalog } from './catalog.js';
import { STUDIO_CONFIG } from './workspace.js';
import { killTree } from './jobs.js';

const PORT = STUDIO_CONFIG.services.llmPort || 8091;
const BASE = `http://127.0.0.1:${PORT}`;
let proc = null, starting = null, idleTimer = null, busy = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function healthy() { try { const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } }

export async function ensureServer(onStatus = () => {}) {
  clearTimeout(idleTimer);
  if (proc && proc.exitCode === null && await healthy()) return;
  if (starting) return starting;
  const llm = getCatalog(true)._internal.llm;
  if (!llm.ready) throw new Error(`local script model unavailable: ${llm.reason}`);
  starting = (async () => {
    onStatus('Starting local script model (llama.cpp)');
    const log = [];
    proc = spawn(llm.exe, ['-m', llm.model, '--host', '127.0.0.1', '--port', String(PORT), '-c', '8192', '-ngl', '99', '--no-webui', '-np', '1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (b) => { log.push(...b.toString().split(/\r?\n/).filter(Boolean)); if (log.length > 60) log.splice(0, log.length - 60); };
    proc.stdout.on('data', keep); proc.stderr.on('data', keep);
    for (let i = 0; i < 240; i++) {
      if (proc.exitCode !== null) throw new Error(`llama-server exited (${proc.exitCode}): ${log.slice(-6).join(' | ')}`);
      if (await healthy()) { onStatus('Script model loaded'); return; }
      await sleep(500);
    }
    throw new Error('llama-server did not become ready within 120 s');
  })();
  try { await starting; } finally { starting = null; }
}

export function stopServer() { clearTimeout(idleTimer); if (proc) { killTree(proc, { sync: true }); proc = null; } }
// never leave the model server (≈3 GB of VRAM) running after this process ends
process.on('exit', () => { if (proc) killTree(proc, { sync: true }); });
function scheduleIdleStop() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!busy) stopServer(); }, 90_000); }

/**
 * Chat completion, streamed so progress is real (tokens generated so far).
 * schema → constrained JSON output (llama.cpp converts it to a grammar).
 */
export async function chat({ messages, schema, temperature = 0.8, maxTokens = 2048, onToken, signal }) {
  busy++;
  try {
    const body = { messages, temperature, top_p: 0.95, max_tokens: maxTokens, stream: true, cache_prompt: true,
      ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: 'output', schema, strict: true } } } : {}) };
    const r = await fetch(`${BASE}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!r.ok) throw new Error(`script model HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    let text = '', tokens = 0, buf = '';
    const dec = new TextDecoder();
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim(); if (data === '[DONE]') continue;
        try { const j = JSON.parse(data); const d = j.choices?.[0]?.delta?.content; if (d) { text += d; tokens++; if (onToken) onToken(tokens, text); } } catch {}
      }
    }
    return { text, tokens };
  } finally { busy--; scheduleIdleStop(); }
}

export function modelInfo() { const l = getCatalog()._internal.llm; return { name: l.name, file: l.model ? l.model.split(/[\\/]/).pop() : null, license: l.license, runtime: 'llama.cpp (Vulkan)' }; }
