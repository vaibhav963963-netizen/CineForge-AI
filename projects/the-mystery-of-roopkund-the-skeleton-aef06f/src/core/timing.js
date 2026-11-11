// Timing: everything on screen is placed on the narration's clock.
//   audio/lines.json  { duration, lines: [{ i, text, say, start, end }] }   (voice.py: exact line times)
//   audio/words.json  [{ w, line, s, e }]                                  (words.py: Whisper word times)
// Normalisation is Unicode-aware, so Devanagari words are matched instead of being stripped to nothing.
export const T = { dur: 0, lines: [], words: [] };
export const norm = (w) => String(w).normalize('NFC').toLowerCase().replace(/[़]/g, '').replace(/[\s.,!?;:"'“”‘’()[\]{}«»।॥…\-–—*|]+/g, '');

export async function loadTiming() {
  const get = async (f) => { const r = await fetch(f, { cache: 'no-store' }); if (!r.ok) throw new Error(`missing ${f}: the narration stages have not run`); return r.json(); };
  const lines = await get('audio/lines.json'), words = await get('audio/words.json');
  T.lines = lines.lines; T.words = words; T.dur = lines.duration;
  return T;
}
export const L = (i) => { const l = T.lines[i]; if (!l) return T.lines[T.lines.length - 1]?.end || 0; return l.start; };
export const Le = (i) => { const l = T.lines[i]; if (!l) return T.dur || 0; return l.end; };
export function Wd(word, line, which = 's') {
  const n = norm(word);
  const hit = T.words.find((w) => (line == null || w.line === line) && norm(w.w).startsWith(n));
  if (!hit) return (line != null && T.lines[line]) ? T.lines[line].start + 0.15 : 0;
  return hit[which];
}
export const lineWords = (i) => T.words.filter((w) => w.line === i);
