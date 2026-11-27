// CineForge automation — publishing metadata (no model call, no network): hashtags, tags, description, captions (SRT).
// Everything here is checked before an upload: an invalid item blocks the upload instead of being sent.

const STOP = new Set(['the', 'and', 'of', 'to', 'in', 'a', 'an', 'is', 'are', 'was', 'how', 'why', 'what', 'does', 'do', 'did', 'it', 'its', 'for', 'with', 'from', 'that', 'this', 'on', 'at', 'by', 'be', 'or',
  'का', 'की', 'के', 'है', 'हैं', 'में', 'से', 'और', 'को', 'एक', 'यह', 'वह', 'कैसे', 'क्यों', 'क्या', 'हमारी', 'हमारा']);
const MAX_HASHTAGS = 15;   // YouTube reads at most 15 hashtags from a description

/** words that make a good hashtag: letters/digits only, no stop words, 3–30 characters */
function keywords(text) {
  return [...new Set(String(text || '').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length >= 3 && w.length <= 30 && !STOP.has(w) && !/^\d+$/.test(w)))];
}

/** hashtags: #Shorts first, then the story's own words (title first), then a language tag. Unique, max 15. */
export function buildHashtags({ title, topic, language }) {
  const out = ['#Shorts'];
  for (const w of [...keywords(title), ...keywords(topic)]) { const tag = '#' + w.replace(/^./, (c) => c.toUpperCase()); if (!out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag); if (out.length >= 8) break; }
  const lang = String(language || '');
  out.push(lang.startsWith('hi') ? '#Hindi' : lang === 'hinglish' ? '#Hinglish' : '#English');
  out.push('#Education');
  return [...new Set(out)].slice(0, MAX_HASHTAGS);
}

/** tags (keywords field): the hashtag words without '#', plus a few general terms; ≤ 500 characters in total */
export function buildTags({ hashtags, topic }) {
  const words = [...hashtags.map((h) => h.slice(1)), ...keywords(topic)];
  const out = []; let len = 0;
  for (const w of words) { if (out.some((x) => x.toLowerCase() === w.toLowerCase())) continue; if (len + w.length + 1 > 480) break; out.push(w); len += w.length + 1; }
  return out;
}

/** description: the opening narration, a plain disclosure, and the hashtags on their own last line */
export function buildDescription({ lines, hashtags, language }) {
  const body = (lines || []).map((l) => String(l.text || '').trim()).filter(Boolean).slice(0, 3).join(' ');
  const disclosure = 'Narration and visuals are AI-generated.';
  const parts = [body, disclosure, hashtags.join(' ')].filter(Boolean);
  return parts.join('\n\n').slice(0, 4900);
}

/** SRT from the narration lines (their real spoken timings): one cue per line, validated */
export function buildSrt(lines) {
  const cues = (lines || []).map((l, i) => ({ i: i + 1, start: Number(l.start), end: Number(l.end), text: String(l.text || '').replace(/\s+/g, ' ').trim() }));
  const problems = [];
  cues.forEach((c, k) => {
    if (!c.text) problems.push(`cue ${c.i} is empty`);
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end)) problems.push(`cue ${c.i} has no timing`);
    else if (c.end <= c.start) problems.push(`cue ${c.i} ends before it starts`);
    else if (c.end - c.start > 12) problems.push(`cue ${c.i} lasts ${(c.end - c.start).toFixed(1)} s (over 12 s)`);
    if (k > 0 && Number.isFinite(c.start) && c.start < cues[k - 1].end - 0.001) problems.push(`cue ${c.i} overlaps the previous cue`);
  });
  if (problems.length) return { ok: false, problems, srt: '' };
  const ts = (s) => { const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000), r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(r).padStart(3, '0')}`; };
  const srt = cues.map((c) => `${c.i}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
  return { ok: true, problems: [], srt, cues: cues.length };
}

/** every metadata field is checked before upload; any problem blocks the upload with its reason */
export function validatePublishMeta(m) {
  const p = [];
  if (!m.title || !m.title.trim()) p.push('title is empty');
  if (m.title && m.title.length > 100) p.push(`title is ${m.title.length} characters (max 100)`);
  if (!m.description || !m.description.trim()) p.push('description is empty');
  if (m.description && m.description.length > 5000) p.push('description is longer than 5000 characters');
  if (!Array.isArray(m.hashtags) || m.hashtags.length < 2) p.push('needs at least 2 hashtags');
  if (Array.isArray(m.hashtags) && m.hashtags.length > MAX_HASHTAGS) p.push(`more than ${MAX_HASHTAGS} hashtags`);
  if (!Array.isArray(m.hashtags) || !m.hashtags.every((h) => /^#[\p{L}\p{M}\p{N}]+$/u.test(h))) p.push('a hashtag contains a space or symbol');
  return { ok: p.length === 0, problems: p };
}
