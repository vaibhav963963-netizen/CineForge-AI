// CineForge automation — automatic format per video and similarity checks, so consecutive videos differ in
// style, tone (personality), voice, language and length, and no topic repeats a near-identical earlier one.
// Pure functions except pickFormat/similarTopic reading the run history from the database.

const STYLES = ['deep-dive', 'inside-out', 'night-file', 'paper-atlas', 'stick-story', 'tall-tale'];
const PERSONALITIES = ['desi-storyteller', 'energetic-youtuber', 'mumbai-conversational', 'dramatic-mythology', 'educational', 'suspense', 'documentary'];
const DURATIONS = [30, 45, 60];
const DEVANAGARI = /[ऀ-ॿ]/;
const STOP = new Set(['the', 'and', 'of', 'to', 'in', 'a', 'an', 'is', 'are', 'was', 'how', 'why', 'what', 'does', 'do', 'did', 'it', 'its', 'for', 'with', 'from', 'that', 'this', 'on', 'at', 'by', 'be', 'or', 'can', 'you', 'your', 'we', 'our',
  'का', 'की', 'के', 'है', 'हैं', 'में', 'से', 'और', 'को', 'एक', 'यह', 'वह', 'कैसे', 'क्यों', 'क्या', 'हमारी', 'हमारा', 'कि', 'पर']);

/** the words that identify a topic (lower-case, no stop words) */
export function topicWords(topic) {
  return [...new Set(String(topic || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)))];
}

/** 0..1 overlap between two topics; 1 means the same words */
export function topicSimilarity(a, b) {
  const A = new Set(topicWords(a)), B = new Set(topicWords(b));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.min(A.size, B.size);   // the smaller topic inside the larger one counts as the same theme
}

/** the earlier topic this one is too close to (≥ 0.5 of its words), or null */
export function similarTopic(topic, previous = []) {
  let best = null, score = 0;
  for (const p of previous) { const s = topicSimilarity(topic, p); if (s > score) { score = s; best = p; } }
  return score >= 0.5 ? { topic: best, score: Math.round(score * 100) / 100 } : null;
}

/** the format used by the last runs (newest first), read from the topic checkpoints */
export function recentFormats(db, limit = 30) {
  try {
    return db.prepare("SELECT data FROM checkpoints WHERE stage = 'topic' AND status = 'done' ORDER BY at DESC LIMIT ?").all(limit)
      .map((r) => JSON.parse(r.data || '{}').format).filter(Boolean);
  } catch { return []; }
}

/** least recently used item of a list (ties → list order) */
function leastRecent(items, key, recent) {
  const last = new Map();
  recent.forEach((f, i) => { if (f && f[key] !== undefined && !last.has(f[key])) last.set(f[key], i); });
  // never-used items first, then the one used longest ago
  return [...items].sort((a, b) => (last.has(b) ? last.get(b) : Infinity) - (last.has(a) ? last.get(a) : Infinity))[0];
}

/** among options that FIT, never the previous video's value when another exists; otherwise the least recently used */
function pickFitting(options, key, recent) {
  const prev = recent[0]?.[key];
  const fresh = options.filter((o) => o !== prev);
  return leastRecent(fresh.length ? fresh : options, key, recent);
}

/** every option the studio has right now, with the descriptions the model judges fit from (nothing topic-specific) */
export function formatOptions(catalog) {
  const c = catalog;
  return {
    languages: c.languages.filter((l) => l.available).map((l) => ({ id: l.id, about: l.name, code: l.code })),
    personalities: c.personalities.map((p) => ({ id: p.id, about: `${p.name}: ${p.blurb}`, codes: p.languageCodes })),
    styles: c.styles.filter((x) => x.available !== false).map((x) => ({ id: x.id, about: `${x.name}: ${x.summary || ''}` })),
    characters: c.characters.filter((x) => x.available !== false).map((x) => ({ id: x.id, about: [x.name, x.title, x.role].filter(Boolean).join(' — ') })),
    voices: c.voices.map((v) => ({ id: v.id, lang: v.language, about: `${v.gender || ''}, ${v.accent || ''}, ${v.notes || ''}` })),
    duration: { min: Math.max(15, c.duration.min), max: Math.min(60, c.duration.max) },   // a Short is at most 60 s
  };
}

const list = (xs) => xs.map((x) => `- ${x.id}: ${x.about}`).join('\n');

/** ask the script model which options suit THIS topic: a ranked shortlist per setting */
async function askFit(topic, o, chat) {
  const ids = (xs) => ({ type: 'array', items: { type: 'string', enum: xs.map((x) => x.id) }, minItems: 1, maxItems: 3 });
  const schema = { type: 'object', additionalProperties: false, required: ['languages', 'styles', 'personalities', 'characters', 'voiceGender', 'durationSeconds', 'reason'],
    properties: { languages: ids(o.languages), styles: ids(o.styles), personalities: ids(o.personalities), characters: ids(o.characters),
      voiceGender: { type: 'string', enum: ['Female', 'Male', 'any'] }, durationSeconds: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 3 }, reason: { type: 'string' } } };
  const prompt = `You choose the production settings for a YouTube Short about this topic:\n"${topic}"\n\n`
    + `For each setting list the 1–3 options that genuinely fit THIS topic, best first. Leave out anything that would feel wrong for it `
    + `(tone, visual look, character who would naturally present it, audience language). Several fitting options are good: the videos must vary.\n\n`
    + `LANGUAGES (narration):\n${list(o.languages)}\n\nVISUAL STYLES:\n${list(o.styles)}\n\nNARRATION PERSONALITIES:\n${list(o.personalities)}\n\n`
    + `LEAD CHARACTERS ("none" = no on-screen character):\n${list(o.characters)}\n\n`
    + `voiceGender: the narrator voice that suits the topic, or "any".\n`
    + `durationSeconds: 1–3 lengths between ${o.duration.min} and ${o.duration.max} that the topic can fill with real substance (simple fact → short, rich story → longer).\n`
    + `reason: one short sentence.\nIf the topic is written in Devanagari, do not choose English. Answer with JSON only.`;
  const r = await chat({ messages: [{ role: 'user', content: prompt }], schema, temperature: 0.3, maxTokens: 600 });
  const m = String(r.text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('the model gave no settings');
  return JSON.parse(m[0]);
}

/**
 * One format for one topic. The script model judges which of the studio's real options fit the topic (fit first);
 * the code keeps only valid ids and then varies them against the previous videos (variety second).
 * No fallback to blind picks: if the model cannot answer, the stage fails and the run retries later.
 */
export async function chooseFormat(topic, recent = [], catalog, chat) {
  const o = formatOptions(catalog);
  const fit = await askFit(topic, o, chat);
  const valid = (xs, opts) => [...new Set((xs || []).filter((x) => opts.some((q) => q.id === x)))];
  const deva = DEVANAGARI.test(topic || '');
  let langs = valid(fit.languages, o.languages).filter((l) => !(deva && l === 'en'));
  if (!langs.length) throw new Error('the model chose no usable language');
  const language = pickFitting(langs, 'language', recent);
  const code = o.languages.find((l) => l.id === language).code;
  const pers = valid(fit.personalities, o.personalities).filter((p) => o.personalities.find((q) => q.id === p).codes.includes(code));
  const styles = valid(fit.styles, o.styles), chars = valid(fit.characters, o.characters);
  if (!pers.length || !styles.length || !chars.length) throw new Error('the model chose no usable style, personality or character');
  const durs = [...new Set((fit.durationSeconds || []).map((d) => Math.round(Math.min(o.duration.max, Math.max(o.duration.min, d)) / 5) * 5))];
  const langVoices = o.voices.filter((v) => catalog.languages.find((l) => l.id === language).voiceLangs.includes(v.lang));
  const gendered = fit.voiceGender === 'any' ? langVoices : langVoices.filter((v) => v.about.startsWith(fit.voiceGender));
  const pool = (gendered.length ? gendered : langVoices).map((v) => v.id);
  if (!pool.length) throw new Error(`no installed voice speaks ${language}`);
  return {
    language, style: pickFitting(styles, 'style', recent), personality: pickFitting(pers, 'personality', recent),
    character: pickFitting(chars, 'character', recent), voice: pickFitting(pool, 'voice', recent),
    durationSeconds: pickFitting(durs.length ? durs : [o.duration.min], 'durationSeconds', recent), why: String(fit.reason || '').slice(0, 200),
  };
}

export const FORMAT_OPTIONS = { STYLES, PERSONALITIES, DURATIONS };
