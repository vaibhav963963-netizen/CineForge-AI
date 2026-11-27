// Groq API client for SCRIPT WRITING ONLY (online). Video production never calls this module.
// Same interface as the local llm.js chat(): { messages, schema, temperature, maxTokens, onToken, signal } →
// { text, tokens, finishReason, truncated }. The API key is read on the backend from the central config, sent only
// in the Authorization header, and masked in every error message.
import { EventEmitter } from 'node:events';
import { CONFIG, redact } from './config.js';

/** every request / response / wait, for job progress and logs (never contains the key) */
export const activity = new EventEmitter();
const emit = (e) => { activity.emit('event', { at: new Date().toISOString(), ...e }); };

const sleep = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason || new Error('aborted')); }, { once: true }); });
export class GroqError extends Error { constructor(msg, { status = null, retryable = false, code = null } = {}) { super(redact(msg)); this.status = status; this.retryable = retryable; this.code = code; } }

const cfg = (over = {}) => ({ key: CONFIG.GROQ_API_KEY, model: CONFIG.GROQ_MODEL, base: CONFIG.GROQ_BASE_URL, timeout: CONFIG.SCRIPT_GENERATION_TIMEOUT, retries: CONFIG.SCRIPT_GENERATION_MAX_RETRIES, enabled: CONFIG.SCRIPT_GENERATION_ENABLED, ...over });
const reasoning = (model) => /gpt-oss|qwen3|deepseek-r1|reasoning/i.test(model);

/** one HTTP call with timeout + the caller's abort signal; network failures carry "fetch failed" so callers stop cleanly */
async function call(c, pathname, init, signal) {
  const ctl = new AbortController(), onAbort = () => ctl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(new GroqError(`Groq request timed out after ${c.timeout} ms`, { retryable: true, code: 'timeout' })), c.timeout);
  try {
    return await fetch(`${c.base}${pathname}`, { ...init, headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(init.headers || {}) }, signal: ctl.signal });
  } catch (e) {
    if (signal?.aborted) throw signal.reason || e;
    if (ctl.signal.reason instanceof GroqError) throw ctl.signal.reason;
    throw new GroqError(`Groq API unreachable (fetch failed — no internet connection?): ${e.cause?.code || e.message}`, { retryable: true, code: 'network' });
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}

let checked = null;   // { model, at, ids }
// tokens-per-minute pacing from Groq's own response headers (x-ratelimit-*-tokens); shared by every request
const budget = { limit: null, remaining: null, resetAt: 0, dailyLimit: null, dailyUsed: null, dailyRemaining: null, dailyResetAt: 0 };
export const dur = (v) => { const m = String(v || '').match(/(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?/); return m ? ((+m[1] || 0) * 60000 + (+m[2] || 0) * 1000 + (+m[3] || 0)) : 0; };
function noteLimits(h) {
  const lim = +h.get('x-ratelimit-limit-tokens'), rem = +h.get('x-ratelimit-remaining-tokens'), reset = dur(h.get('x-ratelimit-reset-tokens'));
  if (Number.isFinite(lim) && lim > 0) budget.limit = lim;
  if (Number.isFinite(rem)) { budget.remaining = rem; budget.resetAt = Date.now() + reset; }
  const dLim = +h.get('x-ratelimit-limit-tokens-per-day') || +h.get('x-ratelimit-limit-tokens-day');
  const dRem = +h.get('x-ratelimit-remaining-tokens-per-day') || +h.get('x-ratelimit-remaining-tokens-day');
  if (Number.isFinite(dLim) && dLim > 0) budget.dailyLimit = dLim;
  if (Number.isFinite(dRem)) budget.dailyRemaining = dRem;
}
export const rateBudget = () => ({ ...budget });
export function resetBudget() {
  budget.limit = null; budget.remaining = null; budget.resetAt = 0;
  budget.dailyLimit = null; budget.dailyUsed = null; budget.dailyRemaining = null; budget.dailyResetAt = 0;
}
/** key present, model available in THIS account — never substitutes another model */
export async function ensureReady(onStatus = () => {}, over = {}) {
  const c = cfg(over);
  if (!c.enabled) throw new GroqError('script generation is disabled (SCRIPT_GENERATION_ENABLED=false) — saved scripts can still be used for videos', { code: 'disabled' });
  // a placeholder ("PASTE_YOUR_…_HERE") is treated as no key — it is never sent to the API
  if (/^(PASTE|YOUR|CHANGE|REPLACE|XXX|TODO)|_HERE$/i.test(String(c.key))) c.key = '';
  if (!c.key) throw new GroqError('GROQ_API_KEY is empty — add your key to the .env file in the CineForge folder, then restart the studio', { code: 'no-key' });
  if (checked && checked.model === c.model && Date.now() - checked.at < 10 * 60 * 1000) return checked;
  onStatus(`Checking Groq model ${c.model}`);
  const r = await call(c, '/models', { method: 'GET' });
  if (r.status === 401 || r.status === 403) throw new GroqError(`Groq rejected the API key (HTTP ${r.status}) — check GROQ_API_KEY in .env`, { status: r.status, code: 'auth' });
  if (!r.ok) throw new GroqError(`Groq model list failed (HTTP ${r.status})`, { status: r.status, retryable: r.status >= 500 });
  const ids = ((await r.json()).data || []).map((m) => m.id).sort();
  if (!ids.includes(c.model)) {
    const like = ids.filter((id) => /gpt-oss|llama-3\.3-70b|llama-4|qwen|kimi|deepseek/i.test(id)).slice(0, 8);
    throw new GroqError(`the configured Groq model "${c.model}" is not available in your account — not switching automatically. Available text models include: ${like.join(', ') || ids.slice(0, 10).join(', ')}. Set GROQ_MODEL in .env to choose one.`, { code: 'model-unavailable' });
  }
  checked = { model: c.model, at: Date.now(), ids };
  return checked;
}

/** chat completion with structured output, bounded retries (429/5xx/network/timeout) and a reasoning-token budget */
export async function chat({ messages, schema, temperature = 0.8, maxTokens = 2048, onToken, signal }, over = {}) {
  const c = cfg(over);
  await ensureReady(() => {}, over);
  const think = reasoning(c.model);
  const body = {
    model: c.model, messages, temperature,
    // reasoning models spend completion tokens on thinking first; reserve room so the visible answer is not cut off
    max_completion_tokens: maxTokens + (think ? 1536 : 0),
    ...(think ? { reasoning_effort: 'medium', include_reasoning: false } : {}),
    ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: 'output', schema, strict: true } } } : {}),
  };
  let strictOk = true, last = null, validateFails = 0, rateWaits = 0, waitedMs = 0;
  for (let attempt = 0; attempt <= c.retries; attempt++) {
    if (signal?.aborted) throw signal.reason || new Error('aborted');
    // wait BEFORE sending when the per-minute token budget cannot hold this request (prompt estimate + reserved output)
    const need = Math.ceil(JSON.stringify(messages).length / 3.2) + body.max_completion_tokens;
    if (budget.remaining != null && need > budget.remaining && Date.now() < budget.resetAt) { const w = budget.resetAt - Date.now() + 250; waitedMs += w; emit({ type: 'wait', ms: w, reason: `token budget (${budget.remaining} left, needs ~${need})` }); await sleep(w, signal); budget.remaining = budget.limit; }
    const sentAt = Date.now(); emit({ type: 'request', tokensReserved: body.max_completion_tokens, promptChars: JSON.stringify(messages).length });
    let r;
    try { r = await call(c, '/chat/completions', { method: 'POST', body: JSON.stringify(body) }, signal); }
    catch (e) { if (signal?.aborted || !e.retryable || attempt === c.retries) throw e; last = e; await sleep(Math.min(30000, 1000 * 2 ** attempt), signal); continue; }
    noteLimits(r.headers); emit({ type: 'response', status: r.status, ms: Date.now() - sentAt, remainingTokens: budget.remaining });
    if (r.ok) {
      const j = await r.json(), ch = j.choices?.[0] || {}, text = String(ch.message?.content ?? '');
      const tokens = j.usage?.completion_tokens || 0;
      // cut off at max_completion_tokens with medium reasoning: same handling as the 400 case below (one logged retry, low reasoning)
      if (ch.finish_reason === 'length' && schema && think && body.reasoning_effort === 'medium') { body.reasoning_effort = 'low'; emit({ type: 'note', message: 'answer was cut off at the token limit with medium reasoning: retrying once with reasoning effort "low"' }); attempt--; continue; }
      if (onToken) onToken(tokens, text);
      return { text, tokens, promptTokens: j.usage?.prompt_tokens || 0, reasoningEffort: body.reasoning_effort || null, finishReason: ch.finish_reason || null, truncated: ch.finish_reason === 'length', model: j.model || c.model, strictSchema: strictOk };
    }
    const errText = redact((await r.text().catch(() => '')).slice(0, 400));
    emit({ type: 'error', status: r.status, detail: (errText.match(/"message"\s*:\s*"([^"]{0,160})/) || [])[1] || errText.slice(0, 160) });
    // 413 "Request too large … tokens per minute (TPM): Limit L, Requested R": the account's per-minute budget counts the
    // prompt PLUS the reserved output. Shrink only the reserved output (never the prompt) and retry, while the visible
    // answer still has its full maxTokens; otherwise report it plainly.
    const tpm = r.status === 413 && errText.match(/Limit (\d+), Requested (\d+)/);
    if (tpm) {
      const over = +tpm[2] - +tpm[1], next = body.max_completion_tokens - over - 64;
      if (next >= maxTokens + (think ? 256 : 0)) { body.max_completion_tokens = next; attempt--; continue; }
      throw new GroqError(`this request needs ${tpm[2]} tokens but your Groq account allows ${tpm[1]} tokens per minute for ${c.model} — a higher Groq tier (or a model with a larger limit) is needed for this step`, { status: 413, code: 'tpm-limit' });
    }
    // a schema feature the strict mode does not support (e.g. maxLength) → same schema without "strict"; the caller
    // still validates every answer, so quality checks are unchanged
    // "json_validate_failed": the model's answer did not match the schema and Groq returned nothing (seen on the large
    // Hindi/Hinglish script schema). Retry once as is, then without "strict" — every answer is still parsed and validated
    // by the caller, so nothing invalid can pass.
    // the answer did not fit: reasoning tokens + the script exceeded max_completion_tokens, and the per-minute budget (TPM)
    // allows no larger request. Retry ONCE with reasoning_effort "low" (fewer thinking tokens, same model, same prompt);
    // the switch is logged and returned with the result, never silent
    if (r.status === 400 && think && body.reasoning_effort === 'medium' && /max completion tokens reached|truncated to fit max_completion_tokens/i.test(errText)) {
      body.reasoning_effort = 'low'; emit({ type: 'note', message: 'answer did not fit the token limit with medium reasoning: retrying once with reasoning effort "low"' }); attempt--; continue;
    }
    if (r.status === 400 && schema && /json_validate_failed/.test(errText)) {
      validateFails++;
      if (validateFails === 1) { attempt--; continue; }
      if (strictOk) { strictOk = false; body.response_format = { type: 'json_schema', json_schema: { name: 'output', schema } }; attempt--; continue; }
      throw new GroqError(`Groq could not produce output matching the required structure (json_validate_failed, ${validateFails}×)`, { status: 400, code: 'json-invalid' });
    }
    if (r.status === 400 && schema && strictOk && /json_schema|strict|schema/i.test(errText)) { strictOk = false; body.response_format = { type: 'json_schema', json_schema: { name: 'output', schema } }; attempt--; continue; }
    if (r.status === 401 || r.status === 403) throw new GroqError(`Groq rejected the API key (HTTP ${r.status})`, { status: r.status, code: 'auth' });
    // a DAILY limit (tokens/requests per day) or "x-should-retry: false" cannot be waited out within a job: stop now with
    // Groq's own numbers instead of retrying (seen: TPD limit 200000 reached; the job sat in 90 s waits for 25 minutes)
    if (r.status === 429 && (/per day|\(TPD\)|\(RPD\)/i.test(errText) || r.headers.get('x-should-retry') === 'false')) {
      const lim = errText.match(/Limit (\d+), Used (\d+), Requested (\d+)/), again = errText.match(/try again in ([\dhms.]+)/i);
      const resetMs = again ? dur(again[1]) : (dur(r.headers.get('x-ratelimit-reset-tokens')) || 60000);
      const resetAt = Date.now() + resetMs;
      if (lim) {
        budget.dailyLimit = +lim[1];
        budget.dailyUsed = +lim[2];
        budget.dailyRemaining = Math.max(0, +lim[1] - +lim[2]);
      }
      budget.dailyResetAt = resetAt;
      throw new GroqError(`Groq daily limit reached for ${c.model}${lim ? ` (${lim[2]} of ${lim[1]} tokens used today, this step needs ${lim[3]})` : ''}${again ? ` — it frees up gradually; next request possible in about ${Math.ceil(dur(again[1]) / 60000)} min` : ''}. Saved scripts can still be turned into videos offline. For more scripts per day, a higher Groq tier is needed.`, { status: 429, code: 'daily-limit', resetMs, resetAt, limit: lim ? +lim[1] : null, used: lim ? +lim[2] : null, remaining: lim ? Math.max(0, +lim[1] - +lim[2]) : 0 });
    }
    // rate limit = wait the time Groq gives and try again (not a failure); bounded by count and by total waiting time
    if (r.status === 429 && rateWaits < 20 && waitedMs < 10 * 60 * 1000) {
      const m = errText.match(/try again in ([\dhms.]+)/i), ra = +r.headers.get('retry-after');
      const w = Math.min(90000, Math.max(1000, m ? dur(m[1]) + 300 : Number.isFinite(ra) && ra > 0 ? ra * 1000 : 15000));
      rateWaits++; waitedMs += w; emit({ type: 'wait', ms: w, reason: 'rate limit (HTTP 429)' }); await sleep(w, signal); attempt--; continue;
    }
    if (r.status === 429 || r.status >= 500) {
      last = new GroqError(`Groq HTTP ${r.status}${r.status === 429 ? ' (rate limit)' : ''}: ${errText.slice(0, 160)}`, { status: r.status, retryable: true, code: r.status === 429 ? 'rate-limit' : 'server' });
      if (attempt === c.retries) throw last;
      const ra = +r.headers.get('retry-after'); await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(60000, ra * 1000) : Math.min(30000, 1500 * 2 ** attempt), signal); continue;
    }
    throw new GroqError(`Groq HTTP ${r.status}: ${errText.slice(0, 200)}`, { status: r.status });
  }
  throw last || new GroqError('Groq request failed');
}

export function modelInfo() { return { name: `${CONFIG.GROQ_MODEL} (Groq API)`, file: null, license: 'Groq API terms; model licence per provider', runtime: 'Groq API (online)' }; }
