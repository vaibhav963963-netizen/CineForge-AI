// CineForge stage 1: narration → visual EVENTS (not one visual per line).
// A narration segment can produce several events; a short segment can produce one. Events are produced by the
// script-model provider (Groq, per the provider decision) under a strict JSON schema, then validated here.
// If the provider fails or its output does not validate, the analyzer falls back to one event per segment and says so.
// This module is new and additive: nothing in the current storyboard pipeline calls it unless CINEFORGE_ENABLED is on.
import { chat } from '../groq.js';

export const MAX_EVENTS_PER_SEGMENT = 6;

export const EVENT_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          segmentId: { type: 'string' },
          subject: { type: 'string' },
          action: { type: 'string' },
          environment: { type: 'string' },
          camera: { type: 'string' },
        },
        required: ['segmentId', 'subject', 'action', 'environment', 'camera'],
        additionalProperties: false,
      },
    },
  },
  required: ['events'],
  additionalProperties: false,
};

const SYSTEM = [
  'You are a film director planning visual events for a short animated video.',
  'Read each narration segment and list every distinct visual event it describes, in order.',
  'One segment can contain several events (for example approach, entry, impact). A short segment can contain one.',
  'Use only what the narration describes; do not invent events. Keep subject and environment names consistent across segments.',
  'camera: one short phrase, such as "wide establishing", "slow push-in", "orbit", "impact close-up".',
  'Return JSON only, matching the schema.',
].join(' ');

/** Validate model output against the segments. Returns { ok, errors, events }. */
export function validateEvents(data, segments) {
  const errors = [];
  const ids = new Set(segments.map((s) => s.id));
  const list = Array.isArray(data?.events) ? data.events : null;
  if (!list) return { ok: false, errors: ['output has no events array'], events: [] };
  const perSeg = new Map();
  for (const [i, e] of list.entries()) {
    for (const k of ['segmentId', 'subject', 'action', 'environment', 'camera']) {
      if (typeof e[k] !== 'string' || !e[k].trim()) errors.push(`event ${i}: ${k} is empty`);
    }
    if (!ids.has(e.segmentId)) errors.push(`event ${i}: unknown segmentId "${e.segmentId}"`);
    perSeg.set(e.segmentId, (perSeg.get(e.segmentId) || 0) + 1);
  }
  for (const s of segments) {
    const n = perSeg.get(s.id) || 0;
    if (n === 0) errors.push(`segment ${s.id} has no event`);
    if (n > MAX_EVENTS_PER_SEGMENT) errors.push(`segment ${s.id} has ${n} events (max ${MAX_EVENTS_PER_SEGMENT})`);
  }
  const events = list.map((e, i) => ({ id: `E${String(i + 1).padStart(3, '0')}`, ...e }));
  return { ok: errors.length === 0, errors, events };
}

/** Deterministic fallback: one event per segment. Never invents content; marked as fallback. */
export function fallbackEvents(segments) {
  return segments.map((s, i) => ({
    id: `E${String(i + 1).padStart(3, '0')}`,
    segmentId: s.id,
    subject: s.subject || 'narration subject',
    action: s.text,
    environment: s.environment || 'unspecified',
    camera: 'medium',
  }));
}

/**
 * segments: [{ id, text }]. Returns { source: 'groq'|'fallback', events, errors }.
 * chatFn is injectable for tests; production uses the Groq client.
 */
export async function analyzeNarration(segments, { over = {}, chatFn = chat } = {}) {
  if (!Array.isArray(segments) || !segments.length) return { source: 'fallback', events: [], errors: ['no narration segments'] };
  const user = JSON.stringify({ segments: segments.map((s) => ({ id: s.id, text: s.text })) });
  try {
    const r = await chatFn({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], schema: EVENT_SCHEMA, temperature: 0.2, maxTokens: 2048 }, over);
    const data = JSON.parse(r.text);
    const v = validateEvents(data, segments);
    if (v.ok) return { source: 'groq', events: v.events, errors: [] };
    return { source: 'fallback', events: fallbackEvents(segments), errors: v.errors };
  } catch (e) {
    return { source: 'fallback', events: fallbackEvents(segments), errors: [`provider: ${e.message}`] };
  }
}
