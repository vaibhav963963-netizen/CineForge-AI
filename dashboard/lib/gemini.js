// Google Gemini API client for SCRIPT WRITING ONLY (online). Video production never calls this module.
// Official Gemini REST API (generativelanguage.googleapis.com, the API the official SDKs call). Same interface as the
// other script-model clients: chat({ messages, schema, temperature, maxTokens, onToken, signal }) →
// { text, tokens, finishReason, truncated, model }. The key travels only in the x-goog-api-key header (never in a URL)
// and is masked in every message.
import { EventEmitter } from 'node:events';
import { CONFIG, redact } from './config.js';

export const activity = new EventEmitter();
const emit = (e) => activity.emit('event', { at: new Date().toISOString(), ...e });
export class GeminiError extends Error { constructor(msg, { status = null, retryable = false, code = null } = {}) { super(redact(msg)); this.status = status; this.retryable = retryable; this.code = code; } }
const sleep = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason || new Error('aborted')); }, { once: true }); });
const cfg = (over = {}) => ({ key: CONFIG.GEMINI_API_KEY, model: CONFIG.GEMINI_MODEL, base: CONFIG.GEMINI_BASE_URL, timeout: CONFIG.SCRIPT_GENERATION_TIMEOUT, retries: CONFIG.SCRIPT_GENERATION_MAX_RETRIES, enabled: CONFIG.SCRIPT_GENERATION_ENABLED, ...over });
const dur = (v) => { const m = String(v || '').match(/^([\d.]+)s$/); return m ? +m[1] * 1000 : 0; };

async function call(c, pathname, init, signal) {
  const ctl = new AbortController(), onAbort = () => ctl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(new GeminiError(`Gemini request timed out after ${c.timeout} ms`, { retryable: true, code: 'timeout' })), c.timeout);
  try { return await fetch(`${c.base}${pathname}`, { ...init, headers: { 'x-goog-api-key': c.key, 'Content-Type': 'application/json', ...(init.headers || {}) }, signal: ctl.signal }); }
  catch (e) {
    if (signal?.aborted) throw signal.reason || e;
    if (ctl.signal.reason instanceof GeminiError) throw ctl.signal.reason;
    throw new GeminiError(`Gemini API unreachable (fetch failed — no internet connection?): ${e.cause?.code || e.message}`, { retryable: true, code: 'network' });
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}

let checked = null;
/** key present, model offered to THIS key — never substitutes another model */
export async function ensureReady(onStatus = () => {}, over = {}) {
  const c = cfg(over);
  if (!c.enabled) throw new GeminiError('script generation is disabled (SCRIPT_GENERATION_ENABLED=false) — saved scripts can still be used for videos', { code: 'disabled' });
  // a placeholder ("PASTE_YOUR_…_HERE") is treated as no key — it is never sent to the API
  if (/^(PASTE|YOUR|CHANGE|REPLACE|XXX|TODO)|_HERE$/i.test(String(c.key))) c.key = '';
  if (!c.key) throw new GeminiError('GEMINI_API_KEY is empty — add your key to the .env file in the CineForge folder, then restart the studio', { code: 'no-key' });
  if (checked && checked.model === c.model && Date.now() - checked.at < 10 * 60 * 1000) return checked;
  onStatus(`Checking Gemini model ${c.model}`);
  const ids = []; let page = '';
  for (let i = 0; i < 10; i++) {
    const r = await call(c, `/models?pageSize=1000${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`, { method: 'GET' });
    if (r.status === 400 || r.status === 401 || r.status === 403) throw new GeminiError(`Google rejected the API key (HTTP ${r.status}) — check GEMINI_API_KEY in .env`, { status: r.status, code: 'auth' });
    if (!r.ok) throw new GeminiError(`Gemini model list failed (HTTP ${r.status})`, { status: r.status, retryable: r.status >= 500 });
    const j = await r.json();
    for (const m of j.models || []) if ((m.supportedGenerationMethods || []).includes('generateContent')) ids.push(String(m.name).replace(/^models\//, ''));
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  if (!ids.includes(c.model)) {
    const like = ids.filter((id) => /^gemini-(4|3\.\d)/.test(id) && !/tts|image|live|embedding|audio/.test(id)).slice(0, 10);
    throw new GeminiError(`the configured Gemini model "${c.model}" is not available to your API key — not switching automatically. Available text models include: ${like.join(', ') || ids.slice(0, 10).join(', ')}. Set GEMINI_MODEL in .env to choose one.`, { code: 'model-unavailable' });
  }
  checked = { model: c.model, at: Date.now(), ids: ids.sort() };
  return checked;
}

/** OpenAI-style messages → Gemini systemInstruction + contents */
function toGemini(messages) {
  const sys = messages.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: (Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]).map((p) => (p.type === 'image_url' ? (() => { const [, mime, data] = String(p.image_url.url).match(/^data:([^;]+);base64,(.*)$/) || []; return { inlineData: { mimeType: mime, data } }; })() : { text: String(p.text ?? p) })) }));
  return { ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}), contents };
}
/** a per-DAY quota cannot be waited out inside a job (Google resets daily quotas at midnight Pacific) */
const isDaily = (err) => JSON.stringify(err || {}).match(/PerDay|per day|_per_day|RequestsPerDay|daily/i);

export async function chat({ messages, schema, temperature = 0.8, maxTokens = 2048, onToken, signal }, over = {}) {
  const c = cfg(over);
  await ensureReady(() => {}, over);
  const body = { ...toGemini(messages), generationConfig: { temperature, maxOutputTokens: maxTokens + 2048, ...(schema ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}), ...(CONFIG.GEMINI_THINKING_LEVEL && CONFIG.GEMINI_THINKING_LEVEL !== 'default' ? { thinkingConfig: { thinkingLevel: CONFIG.GEMINI_THINKING_LEVEL } } : {}) } };
  let last = null, rateWaits = 0, waitedMs = 0, plainSchema = false;
  for (let attempt = 0; attempt <= c.retries; attempt++) {
    if (signal?.aborted) throw signal.reason || new Error('aborted');
    const sentAt = Date.now(); emit({ type: 'request', tokensReserved: body.generationConfig.maxOutputTokens, promptChars: JSON.stringify(messages).length });
    let r;
    try { r = await call(c, `/models/${encodeURIComponent(c.model)}:generateContent`, { method: 'POST', body: JSON.stringify(body) }, signal); }
    catch (e) { if (signal?.aborted || !e.retryable || attempt === c.retries) throw e; last = e; await sleep(Math.min(30000, 1000 * 2 ** attempt), signal); continue; }
    emit({ type: 'response', status: r.status, ms: Date.now() - sentAt });
    if (r.ok) {
      const j = await r.json(), cand = j.candidates?.[0] || {}, text = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      // Google may route a deprecated model to another one: that is a model switch, refused (never silent)
      const used = String(j.modelVersion || c.model);
      if (!used.startsWith(c.model)) throw new GeminiError(`Google answered with "${used}" instead of the configured "${c.model}" (the model was rerouted) — not accepted. Set GEMINI_MODEL in .env to the model you want.`, { code: 'model-rerouted' });
      if (!cand.content && j.promptFeedback?.blockReason) throw new GeminiError(`Gemini blocked the request (${j.promptFeedback.blockReason})`, { code: 'blocked' });
      const tokens = j.usageMetadata?.candidatesTokenCount || 0;
      if (onToken) onToken(tokens, text);
      return { text, tokens, promptTokens: j.usageMetadata?.promptTokenCount || 0, finishReason: cand.finishReason || null, truncated: cand.finishReason === 'MAX_TOKENS', model: used };
    }
    const raw = await r.text().catch(() => ''); let err = null; try { err = JSON.parse(raw).error; } catch {}
    const msg = redact(String(err?.message || raw).slice(0, 300));
    if (r.status === 400 && schema && !plainSchema && /responseJsonSchema|response_json_schema|schema/i.test(msg)) {
      // this model does not take a JSON Schema: same request with JSON mode; the caller validates every answer
      plainSchema = true; delete body.generationConfig.responseJsonSchema; attempt--; continue;
    }
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      if (/API key|API_KEY|permission/i.test(msg)) throw new GeminiError(`Google rejected the API key (HTTP ${r.status})`, { status: r.status, code: 'auth' });
      throw new GeminiError(`Gemini HTTP ${r.status}: ${msg}`, { status: r.status });
    }
    if (r.status === 429) {
      if (isDaily(err)) throw new GeminiError(`Gemini daily quota reached for ${c.model} (${msg.slice(0, 160)}). Daily quotas reset at midnight Pacific time. Saved scripts can still be turned into videos offline; a paid tier raises the limit.`, { status: 429, code: 'daily-limit' });
      const retry = (err?.details || []).find((d) => /RetryInfo/.test(d['@type'] || ''))?.retryDelay, w = Math.min(90000, Math.max(1000, dur(retry) + 300 || 15000));
      if (rateWaits < 20 && waitedMs < 10 * 60 * 1000) { rateWaits++; waitedMs += w; emit({ type: 'wait', ms: w, reason: 'rate limit (HTTP 429)' }); await sleep(w, signal); attempt--; continue; }
      throw new GeminiError(`Gemini rate limit persisted after ${rateWaits} waits: ${msg.slice(0, 160)}`, { status: 429, code: 'rate-limit' });
    }
    if (r.status >= 500) { last = new GeminiError(`Gemini HTTP ${r.status}: ${msg.slice(0, 160)}`, { status: r.status, retryable: true, code: 'server' }); if (attempt === c.retries) throw last; await sleep(Math.min(30000, 1500 * 2 ** attempt), signal); continue; }
    throw new GeminiError(`Gemini HTTP ${r.status}: ${msg}`, { status: r.status });
  }
  throw last || new GeminiError('Gemini request failed');
}

export function modelInfo() { return { name: `${CONFIG.GEMINI_MODEL} (Google Gemini API)`, file: null, license: 'Google Gemini API terms', runtime: 'Google Gemini API (online)' }; }
