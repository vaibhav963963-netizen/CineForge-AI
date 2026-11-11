// Captions driven by the style profile (scene.style.captions): font, size, colours, outline, highlight colour,
// rounded box / torn paper strip, upper-casing, pop-in or typewriter reveal. Works for Latin and Devanagari:
//  · Devanagari captions use the bundled Devanagari font (StudioDeva); Inter/Caladea/FreeMono have no Devanagari glyphs
//  · chunks keep Hindi postpositions (का, के, में, है ...) with the word before them
//  · the typewriter reveal advances by grapheme cluster so conjuncts and matras never break
// A script line may set "caps": "He bet | his *life | savings" to choose chunks and the highlighted word.
import { ctx, W, clamp, lerp, seg, eob, graphemes, isDeva, rr, rnd } from './lib.js';
import { T, lineWords, norm } from './timing.js';

let caps = [], LOOK = null, SCRIPT_DEVA = false;
const SHORT_EN = /^(a|an|the|to|of|in|on|at|by|and|but|or|so|is|it|he|she|we|i|his|her|my|no|up|for|was|its)$/i;
const SHORT_HI_ATTACH = new Set(['का', 'के', 'की', 'को', 'में', 'से', 'ने', 'पर', 'है', 'हैं', 'था', 'थी', 'थे', 'तो', 'भी', 'ही', 'ना', 'न', 'ka', 'ke', 'ki', 'ko', 'mein', 'me', 'se', 'ne', 'par', 'hai', 'hain', 'tha', 'thi', 'the', 'toh', 'bhi', 'hi']);

const fontFor = (text) => {
  const deva = SCRIPT_DEVA || isDeva(text);
  const fam = deva ? `'StudioDeva', 'Nirmala UI', 'Mangal', sans-serif` : `'${LOOK.font}', sans-serif`;
  return `${deva ? 800 : LOOK.weight} ${LOOK.size}px ${fam}`;
};

function autoChunks(words) {
  const out = [], max = Math.max(1, LOOK.maxWords || 2);
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i], bare = w.replace(/[.,!?;:"'“”‘’।॥]/g, '');
    cur.push(i);
    const next = words[i + 1], nextBare = next ? next.replace(/[.,!?;:"'“”‘’।॥]/g, '') : '';
    const endsClause = /[,.!?;:।॥]$/.test(w);
    const nextAttaches = next && SHORT_HI_ATTACH.has(nextBare.toLowerCase());
    const thisIsShort = SHORT_EN.test(bare) && !endsClause;
    if (!next) { out.push(cur); cur = []; continue; }
    if (nextAttaches && cur.length < max + 1) continue;          // keep "मंगल ग्रह तक" / "mission ka" together
    if (thisIsShort && cur.length < max + 1) continue;          // "a single", "the whole"
    if (endsClause || cur.length >= max) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

function pickHighlight(words) {
  if (!LOOK.hi) return -1;
  let best = -1, bl = 0;
  words.forEach((w, k) => { const n = graphemes(w.replace(/[^\p{L}\p{N}\p{M}]/gu, '')).length; const isShort = SHORT_EN.test(w) || SHORT_HI_ATTACH.has(w.toLowerCase()); if (!isShort && n > bl) { bl = n; best = k; } });
  return best;
}

export function buildCaptions(script, look, language) {
  LOOK = look; SCRIPT_DEVA = language && language.captionScript === 'Deva';
  caps = [];
  script.lines.forEach((ln, i) => {
    const ws = lineWords(i); if (!ws.length) return;
    const display = ws.map((w) => w.w);
    let chunks;
    if (ln.caps) {
      // explicit chunks: map each chunk's first word to the spoken word list
      chunks = []; let from = 0;
      ln.caps.split('|').map((c) => c.trim()).filter(Boolean).forEach((c, j) => {
        const toks = c.split(/\s+/), first = norm(toks[0].replace('*', ''));
        let idx = j === 0 ? 0 : ws.findIndex((w, k) => k > from && norm(w.w) === first);
        if (idx < 0) idx = Math.min(ws.length - 1, from + 1);
        from = idx;
        chunks.push({ start: idx, words: toks.map((t) => ({ txt: t.replace(/\*/g, ''), hi: t.includes('*') })) });
      });
    } else {
      chunks = autoChunks(display).map((idxs) => {
        const words = idxs.map((k) => ({ txt: display[k], hi: false }));
        const h = pickHighlight(words.map((x) => x.txt)); if (h >= 0) words[h].hi = true;
        return { start: idxs[0], words };
      });
    }
    chunks.forEach((c) => caps.push({ line: i, s: ws[c.start].s - 0.04, words: c.words }));
  });
  caps.forEach((c, k) => { const next = caps[k + 1], lineEnd = T.lines[c.line].end; c.e = next ? (next.s - lineEnd > 0.6 && next.line !== c.line ? lineEnd + 0.3 : next.s) : T.dur; });
  return caps;
}
export const captionList = () => caps.map((c) => ({ ...c, text: c.words.map((w) => w.txt).join(' ') }));

function tornStrip(x, y, w, h, color, seed) {
  ctx.beginPath(); const n = 18;
  ctx.moveTo(x, y + rnd(seed) * 6);
  for (let i = 1; i <= n; i++) ctx.lineTo(x + (w * i) / n, y + rnd(seed + i) * 8);
  for (let i = n; i >= 0; i--) ctx.lineTo(x + (w * i) / n, y + h - rnd(seed + 40 + i) * 8);
  ctx.closePath(); ctx.fillStyle = color; ctx.shadowColor = 'rgba(40,25,10,0.35)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6; ctx.fill(); ctx.shadowColor = 'transparent';
}

export function drawCaption(t) {
  const c = caps.find((c) => t >= c.s && t < c.e); if (!c) return;
  const L = LOOK, lt = t - c.s;
  const words = c.words.map((w) => ({ ...w, txt: L.upper && !isDeva(w.txt) ? w.txt.toUpperCase() : w.txt }));
  ctx.save();
  ctx.font = fontFor(words.map((w) => w.txt).join(' ')); ctx.letterSpacing = '0px';
  const sp = L.size * 0.26;
  words.forEach((w) => (w.w = ctx.measureText(w.txt).width));
  const width = (ws) => ws.reduce((a, w) => a + w.w, 0) + sp * (ws.length - 1);
  const maxW = L.maxW || 940;
  let rows = [words];
  if (width(words) > maxW && words.length > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) { const a = words.slice(0, i), b = words.slice(i), m = Math.max(width(a), width(b)); if (!best || m < best.m) best = { m, l: [a, b] }; }
    rows = best.l;
  }
  const fit = Math.min(1, maxW / Math.max(...rows.map(width)));
  const pop = L.pop ? (lt < 0.18 ? lerp(0.7, 1, eob(seg(lt, 0, 0.18))) : 1) : 1;
  const sc = pop * fit, lh = L.size * 1.12;
  // typewriter: reveal graphemes over 0.4 s
  let budget = Infinity;
  if (L.typeOn) budget = Math.floor(clamp(lt / 0.4) * words.reduce((a, w) => a + graphemes(w.txt).length, 0)) + 1;
  ctx.translate(W / 2, L.y); ctx.scale(sc, sc);
  if (L.box) {
    const bw = Math.max(...rows.map(width)) + L.box.pad * 2, bh = rows.length * lh + L.box.pad * 1.2;
    if (L.box.torn) tornStrip(-bw / 2, -bh / 2, bw, bh, L.box.color, Math.floor(c.s * 10));
    else { rr(-bw / 2, -bh / 2, bw, bh, L.box.radius); ctx.fillStyle = L.box.color; ctx.fill(); }
  }
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
  const y0 = -(rows.length - 1) * lh / 2;
  rows.forEach((row, ri) => {
    let x = -width(row) / 2; const y = y0 + ri * lh;
    for (const w of row) {
      let txt = w.txt;
      if (budget !== Infinity) { const g = graphemes(txt); txt = g.slice(0, Math.max(0, budget)).join(''); budget -= g.length; }
      if (txt) {
        if (L.stroke && L.strokeW) { ctx.lineWidth = L.strokeW; ctx.strokeStyle = L.stroke; ctx.strokeText(txt, x, y + L.strokeW * 0.25); ctx.strokeText(txt, x, y); }
        ctx.fillStyle = w.hi && L.hi ? L.hi : L.fill; ctx.fillText(txt, x, y);
      }
      x += w.w + sp;
    }
  });
  ctx.restore();
}
