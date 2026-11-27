// CineForge stage 1: narration → visual EVENTS. A narration segment (one sentence) becomes several events, one per shot.
// The planner targets 3–6 shots per sentence (see vocab.js); a sentence is split into segments by the caller, so a long
// narration gets more segments rather than more shots per sentence.
// Events come from the script-model provider (Groq) under a strict JSON schema; every closed choice is an enum, so later
// stages never guess from free text. Invalid output falls back to one event per segment and says so.
// This module is additive: nothing in the current storyboard pipeline calls it unless CINEFORGE_ENABLED is on.
import { chat } from '../groq.js';
import { CAMERA_MOVES, MOTIONS, SHOT_SIZES, LIGHTING, EFFECTS, TRANSITIONS, MIN_SHOTS_PER_SEGMENT, MAX_SHOTS_PER_SEGMENT } from './vocab.js';

export { CAMERA_MOVES, MOTIONS, SHOT_SIZES, LIGHTING, EFFECTS, TRANSITIONS };
export const MAX_EVENTS_PER_SEGMENT = MAX_SHOTS_PER_SEGMENT;

const ENUM_FIELDS = { motion: MOTIONS, camera: CAMERA_MOVES, shotSize: SHOT_SIZES, lighting: LIGHTING, effect: EFFECTS, transition: TRANSITIONS };
const TEXT_FIELDS = ['subject', 'action', 'environment', 'startState', 'endState'];

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
          startState: { type: 'string' },
          endState: { type: 'string' },
          motion: { type: 'string', enum: MOTIONS },
          camera: { type: 'string', enum: CAMERA_MOVES },
          shotSize: { type: 'string', enum: SHOT_SIZES },
          lighting: { type: 'string', enum: LIGHTING },
          effect: { type: 'string', enum: EFFECTS },
          transition: { type: 'string', enum: TRANSITIONS },
        },
        required: ['segmentId', 'subject', 'action', 'environment', 'startState', 'endState', 'motion', 'camera', 'shotSize', 'lighting', 'effect', 'transition'],
        additionalProperties: false,
      },
    },
  },
  required: ['events'],
  additionalProperties: false,
};

const SYSTEM = [
  'You are a film director breaking narration into a cinematic shot list for a documentary-style 3D animation.',
  `For each narration segment, produce ${MIN_SHOTS_PER_SEGMENT} to ${MAX_SHOTS_PER_SEGMENT} events, in order, each one a separate shot.`,
  'Break the sentence into its real physical events and staging: establish the setting, the approach, the transition or interaction,',
  'the climax or impact, and the aftermath, using only what the sentence describes. Do not invent plot.',
  'Each event has: a concrete action with a startState and an endState (what is where, moving which way, at what state), so the animation has a beginning and an end.',
  `motion: what the main subject physically does: ${MOTIONS.join(', ')}. Every event must include a real motion or an effect; do not write static-only shots.`,
  `camera: ${CAMERA_MOVES.join(', ')}. Choose the move that serves the event (impact → shake, reveal → crane, approach → push, orbit an object → orbit, follow → track, overview → aerial).`,
  `shotSize: ${SHOT_SIZES.join(', ')}. Vary the sizes across the shots; never use the same size twice in a row.`,
  `lighting: ${LIGHTING.join(', ')}. Use fire-glow or plasma-glow for atmospheric entry and impact, night-ambient for night scenes.`,
  `effect: ${EFFECTS.join(', ')}. Use fire-plasma for atmospheric entry, debris and shockwave for impacts, dust-cloud for aftermath; none otherwise.`,
  `transition: ${TRANSITIONS.join(', ')}, how this shot begins. Use cut by default, dissolve for a time jump, fade-black for a major change of place.`,
  'Keep subject and environment names identical across the shots of a segment.',
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
    for (const k of TEXT_FIELDS) {
      if (typeof e[k] !== 'string' || !e[k].trim()) errors.push(`event ${i}: ${k} is empty`);
    }
    for (const [k, allowed] of Object.entries(ENUM_FIELDS)) {
      if (!allowed.includes(e[k])) errors.push(`event ${i}: ${k} "${e[k]}" is not allowed`);
    }
    if (!ids.has(e.segmentId)) errors.push(`event ${i}: unknown segmentId "${e.segmentId}"`);
    perSeg.set(e.segmentId, (perSeg.get(e.segmentId) || 0) + 1);
  }
  for (const s of segments) {
    const n = perSeg.get(s.id) || 0;
    if (n === 0) errors.push(`segment ${s.id} has no event`);
    if (n > MAX_SHOTS_PER_SEGMENT) errors.push(`segment ${s.id} has ${n} shots (max ${MAX_SHOTS_PER_SEGMENT} per sentence)`);
  }
  const events = list.map((e, i) => ({ id: `E${String(i + 1).padStart(3, '0')}`, ...e }));
  return { ok: errors.length === 0, errors, events };
}

/** Deterministic fallback: one event per segment, static and plain. It never invents content and is marked as fallback. */
export function fallbackEvents(segments) {
  return segments.map((s, i) => ({
    id: `E${String(i + 1).padStart(3, '0')}`,
    segmentId: s.id,
    subject: s.subject || 'narration subject',
    action: s.text,
    environment: s.environment || 'unspecified',
    startState: 'as described',
    endState: 'as described',
    motion: 'stay',
    camera: 'static',
    shotSize: 'medium',
    lighting: 'sunlit',
    effect: 'none',
    transition: 'cut',
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
    const r = await chatFn({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], schema: EVENT_SCHEMA, temperature: 0.2, maxTokens: 4096 }, over);
    const data = JSON.parse(r.text);
    const v = validateEvents(data, segments);
    if (v.ok) return { source: 'groq', events: v.events, errors: [] };
    return { source: 'fallback', events: fallbackEvents(segments), errors: v.errors };
  } catch (e) {
    return { source: 'fallback', events: fallbackEvents(segments), errors: [`provider: ${e.message}`] };
  }
}
