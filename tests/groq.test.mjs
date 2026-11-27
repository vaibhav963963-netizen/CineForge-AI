// Groq client: model check (no silent switch), structured output, daily-limit stop, 413 shrink, json_validate retry,
// rate-limit wait, and the key never appearing in errors. Uses a simulated Groq server (global fetch), no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chat, ensureReady, rateBudget, resetBudget } from '../dashboard/lib/groq.js';
// queue state lives in lib/sbqueue.js: importing dashboard/server.js would start a studio server (port 3000) and never exit
import { pauseScriptBookQueue, resumeScriptBookQueue, getScriptBookQueueStatus } from '../dashboard/lib/sbqueue.js';

const KEY = 'gsk_' + 'TESTKEY0123456789abcdefABCDEF';
const over = { key: KEY, model: 'openai/gpt-oss-120b', base: 'https://groq.test/openai/v1', timeout: 5000, retries: 3, enabled: true };
const hdr = (h = {}) => new Headers({ 'x-ratelimit-limit-tokens': '8000', 'x-ratelimit-remaining-tokens': '7000', 'x-ratelimit-reset-tokens': '1s', ...h });
const resp = (status, body, h) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: hdr(h) });
const MODELS = { data: [{ id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b' }] };
const ok = (content) => resp(200, { model: 'openai/gpt-oss-120b', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { completion_tokens: 5 } });
function serve(chatReplies) { const calls = []; globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization }); if (String(url).endsWith('/models')) return resp(200, MODELS); const r = chatReplies.shift(); return typeof r === 'function' ? r() : r; }; return calls; }
const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };

test('model check: an unavailable model is an error that names alternatives — never a silent switch', async () => {
  serve([]);
  await assert.rejects(ensureReady(() => {}, { ...over, model: 'no/such-model' }), (e) => e.code === 'model-unavailable' && /not switching automatically/.test(e.message) && /gpt-oss-20b/.test(e.message));
  await assert.rejects(ensureReady(() => {}, { ...over, key: '' }), (e) => e.code === 'no-key');
});
test('structured output: strict JSON schema is requested, the key only travels in the Authorization header', async () => {
  const calls = serve([ok('{"a":"x"}')]);
  const r = await chat({ messages: [{ role: 'user', content: 'hi' }], schema, maxTokens: 50 }, over);
  assert.equal(r.text, '{"a":"x"}'); const c = calls.find((x) => x.url.endsWith('/chat/completions'));
  assert.equal(c.body.response_format.json_schema.strict, true); assert.equal(c.auth, `Bearer ${KEY}`); assert.ok(!JSON.stringify(c.body).includes(KEY));
});
test('daily limit (TPD): stops at once with Groq\'s numbers — no retry loop — and the key is not in the message', async () => {
  const tpd = resp(429, { error: { message: `Rate limit reached for model \`openai/gpt-oss-120b\` in organization \`org_x\` on tokens per day (TPD): Limit 200000, Used 198849, Requested 3222. Please try again in 14m54.6s. key ${KEY}`, type: 'tokens' } }, { 'x-should-retry': 'false', 'retry-after': '895' });
  const calls = serve([tpd, ok('{"a":"never"}')]);
  await assert.rejects(chat({ messages: [{ role: 'user', content: 'hi' }], schema, maxTokens: 50 }, over), (e) => e.code === 'daily-limit' && /198849 of 200000/.test(e.message) && /15 min/.test(e.message) && !e.message.includes(KEY));
  assert.equal(calls.filter((x) => x.url.endsWith('/chat/completions')).length, 1);
});
test('413 tokens-per-minute: only the reserved output shrinks (never the prompt) and the request is retried', async () => {
  const calls = serve([resp(413, { error: { message: 'Request too large … tokens per minute (TPM): Limit 8000, Requested 8657' } }), ok('{"a":"y"}')]);
  const r = await chat({ messages: [{ role: 'user', content: 'hi' }], schema, maxTokens: 2000 }, over);
  assert.equal(r.text, '{"a":"y"}'); const [a, b] = calls.filter((x) => x.url.endsWith('/chat/completions'));
  assert.equal(b.body.max_completion_tokens, a.body.max_completion_tokens - 657 - 64); assert.deepEqual(a.body.messages, b.body.messages);
});
test('json_validate_failed: retried, then without strict; every answer is still returned for the caller to validate', async () => {
  const bad = () => resp(400, { error: { message: 'Failed to validate JSON.', code: 'json_validate_failed' } });
  const calls = serve([bad, bad, ok('{"a":"z"}')]);
  const r = await chat({ messages: [{ role: 'user', content: 'hi' }], schema, maxTokens: 50 }, over);
  assert.equal(r.text, '{"a":"z"}'); assert.equal(r.strictSchema, false);
  const cc = calls.filter((x) => x.url.endsWith('/chat/completions')); assert.equal(cc.length, 3); assert.equal(cc[2].body.response_format.json_schema.strict, undefined);
});
test('per-minute rate limit (429 without a daily limit): waits the time Groq gives, then succeeds', async () => {
  const calls = serve([resp(429, { error: { message: 'Rate limit reached on tokens per minute (TPM). Please try again in 1.2s.' } }), ok('{"a":"w"}')]);
  const t0 = Date.now(); const r = await chat({ messages: [{ role: 'user', content: 'hi' }], schema, maxTokens: 50 }, over);
  assert.equal(r.text, '{"a":"w"}'); assert.ok(Date.now() - t0 >= 1000); assert.equal(calls.filter((x) => x.url.endsWith('/chat/completions')).length, 2);
});

test('issue 11: 429 daily-limit error records budget, pauses queue with reset time and resumes', async () => {
  resetBudget();
  const tpd = resp(429, {
    error: {
      message: `Rate limit reached for model \`openai/gpt-oss-120b\` on tokens per day (TPD): Limit 200000, Used 199500, Requested 1000. Please try again in 12m30s.`,
      type: 'tokens',
    },
  }, { 'x-should-retry': 'false', 'x-ratelimit-reset-tokens': '750s' });

  serve([tpd]);
  let caught = null;
  try {
    await chat({ messages: [{ role: 'user', content: 'hi' }], schema, maxTokens: 50 }, over);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught);
  assert.equal(caught.code, 'daily-limit');
  assert.ok(caught.resetAt > Date.now());

  const b = rateBudget();
  assert.equal(b.dailyLimit, 200000);
  assert.equal(b.dailyUsed, 199500);
  assert.equal(b.dailyRemaining, 500);
  assert.ok(b.dailyResetAt > Date.now());

  // Confirm queue pauses with reset time
  pauseScriptBookQueue(caught.resetAt);
  const st = getScriptBookQueueStatus();
  assert.equal(st.paused, true);
  assert.ok(st.remainingMs > 0);
  assert.equal(st.pausedUntil, new Date(caught.resetAt).toISOString());

  // Confirm queue resumes
  resumeScriptBookQueue();
  const st2 = getScriptBookQueueStatus();
  assert.equal(st2.paused, false);
});

