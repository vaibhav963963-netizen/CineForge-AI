// CineForge stage 1: narration → visual EVENTS. A narration segment (one sentence) becomes several events, one per shot.
// The planner targets 3–6 shots per sentence (see vocab.js); a sentence is split into segments by the caller, so a long
// narration gets more segments rather than more shots per sentence.
// Events come from the script-model provider (Groq) under a strict JSON schema; every closed choice is an enum, so later
// stages never guess from free text. Invalid output falls back to one event per segment and says so.
// This module is additive: nothing in the current storyboard pipeline calls it unless CINEFORGE_ENABLED is on.
import { chat } from '../groq.js';
import { CAMERA_MOVES, MOTIONS, SHOT_SIZES, LIGHTING, EFFECTS, TRANSITIONS, SETS, MIN_SHOTS_PER_SEGMENT, MAX_SHOTS_PER_SEGMENT } from './vocab.js';
import { shotCountBounds, MIN_SHOT_S } from './shot-planner.js';
import { STYLES, DEFAULT_STYLE, setsFor } from './styles.js';

export { CAMERA_MOVES, MOTIONS, SHOT_SIZES, LIGHTING, EFFECTS, TRANSITIONS, SETS };
export const MAX_EVENTS_PER_SEGMENT = MAX_SHOTS_PER_SEGMENT;

const TEXT_FIELDS = ['subject', 'action', 'environment', 'startState', 'endState', 'caption'];
const enumFields = (style) => ({ set: setsFor(style), motion: MOTIONS, camera: CAMERA_MOVES, shotSize: SHOT_SIZES, lighting: LIGHTING, effect: EFFECTS, transition: TRANSITIONS });

/** the event schema for a style: the set field allows only that style's sets */
export function eventSchema(style = DEFAULT_STYLE) {
  return {
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
          set: { type: 'string', enum: setsFor(style) },
          startState: { type: 'string' },
          endState: { type: 'string' },
          caption: { type: 'string' },
          motion: { type: 'string', enum: MOTIONS },
          camera: { type: 'string', enum: CAMERA_MOVES },
          shotSize: { type: 'string', enum: SHOT_SIZES },
          lighting: { type: 'string', enum: LIGHTING },
          effect: { type: 'string', enum: EFFECTS },
          transition: { type: 'string', enum: TRANSITIONS },
        },
        required: ['segmentId', 'subject', 'action', 'environment', 'set', 'startState', 'endState', 'caption', 'motion', 'camera', 'shotSize', 'lighting', 'effect', 'transition'],
        additionalProperties: false,
      },
    },
  },
  required: ['events'],
  additionalProperties: false,
  };
}

export const EVENT_SCHEMA = eventSchema(DEFAULT_STYLE);

/** the director's instructions for a style: the closed choices, and what each of the style's sets is for */
export function systemPrompt(style = DEFAULT_STYLE) {
  const help = STYLES[style].setHelp, setLine = Object.entries(help).map(([k, v]) => `${k} = ${v}`).join('; ');
  return [
  `You are a film director breaking narration into a cinematic shot list for the ${STYLES[style].label} visual style.`,
  `For each narration segment, produce ${MIN_SHOTS_PER_SEGMENT} to ${MAX_SHOTS_PER_SEGMENT} events, in order, each one a separate shot.`,
  'Break the sentence into its real physical events and staging: establish the setting, the approach, the transition or interaction,',
  'the climax or impact, and the aftermath, using only what the sentence describes. Do not invent plot.',
  'Each event has: a concrete action with a startState and an endState (what is where, moving which way, at what state), so the animation has a beginning and an end.',
  `motion: what the main subject physically does: ${MOTIONS.join(', ')}. Every event must include a real motion or an effect; do not write static-only shots.`,
  'For a person, the motion must be something the body does: rise = breathes in, fall = faints, impact = a jolt, approach or recede = walks or turns toward or away from the camera, cross = sways or walks across. Do not use stay for a person.',
  `camera: ${CAMERA_MOVES.join(', ')}. Choose the move that serves the event (impact → shake, reveal → crane, approach → push, orbit an object → orbit, follow → track, overview → aerial).`,
  `shotSize: ${SHOT_SIZES.join(', ')}. Vary the sizes across the shots; never use the same size twice in a row.`,
  `lighting: ${LIGHTING.join(', ')}. Use fire-glow or plasma-glow for atmospheric entry and impact, night-ambient for night scenes.`,
  `effect: ${EFFECTS.join(', ')}. Use fire-plasma for atmospheric entry, debris and shockwave for impacts, dust-cloud for aftermath; none otherwise.`,
  `transition: ${TRANSITIONS.join(', ')}, how this shot begins. Use cut by default, dissolve for a time jump, fade-black for a major change of place.`,
  `set: the place the shot is in, one of ${Object.keys(help).join(', ')}. ${setLine}.`,
  'caption: the on-screen text for this shot, 1 to 3 words taken from the narration, with ONE key word marked by *, for example "What if you *swallowed gum?" or "*gum stays inside".',
  `Each segment may give its length in seconds and its allowed shot count (shotsMin to shotsMax). Use a number of events inside that range; every shot lasts seconds / shots, and no shot may be shorter than ${MIN_SHOT_S} second.`,
  'Keep subject and environment names identical across the shots of a segment.',
  'Return JSON only, matching the schema.',
  ].join(' ');
}

/** Validate model output against the segments and the style's sets. Returns { ok, errors, events }. */
export function validateEvents(data, segments, { style = DEFAULT_STYLE } = {}) {
  const errors = [];
  const ids = new Set(segments.map((s) => s.id));
  const list = Array.isArray(data?.events) ? data.events : null;
  if (!list) return { ok: false, errors: ['output has no events array'], events: [] };
  const ENUM_FIELDS = enumFields(style);
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
export function fallbackEvents(segments, { style = DEFAULT_STYLE } = {}) {
  return segments.map((s, i) => ({
    id: `E${String(i + 1).padStart(3, '0')}`,
    segmentId: s.id,
    subject: s.subject || 'narration subject',
    action: s.text,
    environment: s.environment || 'unspecified',
    set: setsFor(style)[0],
    startState: 'as described',
    endState: 'as described',
    caption: String(s.text || '').split(/\s+/).slice(0, 3).join(' '),
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
export async function analyzeNarration(segments, { over = {}, chatFn = chat, feedback = null, style = DEFAULT_STYLE } = {}) {
  if (!Array.isArray(segments) || !segments.length) return { source: 'fallback', events: [], errors: ['no narration segments'] };
  const schema = eventSchema(style), system = systemPrompt(style);
  // feedback: the errors the caller found in the previous answer (e.g. a sentence with too few shots); the model fixes them
  // each sentence states its length and its allowed shot count, so the planner can budget the time (no shot under 1 s)
  const user = JSON.stringify({ segments: segments.map((s) => {
      if (!(s.seconds > 0)) return { id: s.id, text: s.text };
      const { min, max } = shotCountBounds(s.seconds);
      return { id: s.id, text: s.text, seconds: s.seconds, shotsMin: min, shotsMax: max };
    }) })
    + (feedback ? `\nThe previous answer was rejected for these reasons, so return a corrected full list: ${feedback}` : '');
  try {
    const r = await chatFn({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], schema, temperature: 0.2, maxTokens: 4096 }, over);
    const data = JSON.parse(r.text);
    const v = validateEvents(data, segments, { style });
    if (v.ok) return { source: 'groq', events: v.events, errors: [] };
    return { source: 'fallback', events: fallbackEvents(segments, { style }), errors: v.errors };
  } catch (e) {
    return { source: 'fallback', events: fallbackEvents(segments, { style }), errors: [`provider: ${e.message}`] };
  }
}
