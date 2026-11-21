// Gemini client: model check (no silent switch), rerouted model refused, structured JSON request, key only in the
// x-goog-api-key header, daily quota stops at once, per-minute 429 waits, schema fallback, placeholder key never sent.
// Simulated Gemini server (global fetch) — no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chat, ensureReady } from '../dashboard/lib/gemini.js';

const KEY = 'AIza' + 'SyTESTKEY0123456789abcdefghijkLMNO';
const over = { key: KEY, model: 'gemini-2.5-flash', base: 'https://gemini.test/v1beta', timeout: 5000, retries: 3, enabled: true };
const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const MODELS = { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-4-hydrogen', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] };
const ok = (text, modelVersion = 'gemini-2.5-flash') => resp(200, { modelVersion, candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { candidatesTokenCount: 7 } });
function serve(replies) { const calls = []; globalThis.fetch = async (url, init) => { calls.push({ url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null }); if (/\/models\?/.test(String(url))) return resp(200, MODELS); const r = replies.shift(); return typeof r === 'function' ? r() : r; }; return calls; }
const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
const msgs = [{ role: 'system', content: 'You write JSON.' }, { role: 'user', content: 'hi' }];

test('model check: a model not offered to the key is an error naming alternatives — never a silent switch', async () => {
  serve([]);
  await assert.rejects(ensureReady(() => {}, { ...over, model: 'gemini-9-nope' }), (e) => e.code === 'model-unavailable' && /not switching automatically/.test(e.message) && /gemini-4-hydrogen/.test(e.message));
  await assert.rejects(ensureReady(() => {}, { ...over, key: '' }), (e) => e.code === 'no-key');
});
test('a placeholder key ("PASTE_YOUR_GEMINI_API_KEY_HERE") is treated as no key and never sent', async () => {
  const calls = serve([]);
  await assert.rejects(ensureReady(() => {}, { ...over, key: 'PASTE_YOUR_GEMINI_API_KEY_HERE' }), (e) => e.code === 'no-key');
  assert.equal(calls.length, 0);
});
test('request: system → systemInstruction, JSON schema requested, key only in the x-goog-api-key header (never in the URL)', async () => {
  const calls = serve([ok('{"a":"x"}')]);
  const r = await chat({ messages: msgs, schema, maxTokens: 50 }, over);
  assert.equal(r.text, '{"a":"x"}'); assert.equal(r.model, 'gemini-2.5-flash');
  const c = calls.find((x) => /:generateContent$/.test(x.url));
  assert.equal(c.body.systemInstruction.parts[0].text, 'You write JSON.'); assert.equal(c.body.contents[0].role, 'user');
  assert.equal(c.body.generationConfig.responseMimeType, 'application/json'); assert.deepEqual(c.body.generationConfig.responseJsonSchema, schema);
  assert.equal(c.headers['x-goog-api-key'], KEY); for (const x of calls) assert.ok(!x.url.includes(KEY), 'key never in a URL');
});
test('a REROUTED model (Google answered with another model) is refused — the configured model is never silently replaced', async () => {
  serve([ok('{"a":"x"}', 'gemini-3.5-flash-lite')]);
  await assert.rejects(chat({ messages: msgs, schema, maxTokens: 50 }, over), (e) => e.code === 'model-rerouted' && /gemini-3\.5-flash-lite/.test(e.message));
});
test('daily quota (RESOURCE_EXHAUSTED per day): stops at once, no retry loop, key not in the message', async () => {
  const daily = resp(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: `Quota exceeded for metric: generate_content_free_tier_requests, limit: 250 ${KEY}`, details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
  const calls = serve([daily, ok('{"a":"never"}')]);
  await assert.rejects(chat({ messages: msgs, schema, maxTokens: 50 }, over), (e) => e.code === 'daily-limit' && /midnight Pacific/.test(e.message) && !e.message.includes(KEY));
  assert.equal(calls.filter((x) => /:generateContent$/.test(x.url)).length, 1);
});
test('per-minute 429 with RetryInfo: waits the time Google gives, then succeeds', async () => {
  const rpm = resp(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded per minute', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1s' }] } });
  serve([rpm, ok('{"a":"w"}')]);
  const t0 = Date.now(); const r = await chat({ messages: msgs, schema, maxTokens: 50 }, over);
  assert.equal(r.text, '{"a":"w"}'); assert.ok(Date.now() - t0 >= 1000);
});
test('a model that rejects responseJsonSchema: retried in JSON mode (the caller still validates); MAX_TOKENS is reported as cut off', async () => {
  const calls = serve([resp(400, { error: { code: 400, message: 'Invalid JSON payload: unknown field responseJsonSchema' } }), resp(200, { modelVersion: 'gemini-2.5-flash', candidates: [{ content: { parts: [{ text: '{"a":' }] }, finishReason: 'MAX_TOKENS' }] })]);
  const r = await chat({ messages: msgs, schema, maxTokens: 50 }, over);
  assert.equal(r.truncated, true);
  const gc = calls.filter((x) => /:generateContent$/.test(x.url)); assert.equal(gc.length, 2); assert.equal(gc[1].body.generationConfig.responseJsonSchema, undefined);
});
