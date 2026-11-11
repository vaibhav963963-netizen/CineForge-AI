// Shared 2D canvas helpers for the studio runtime. `ctx` is the output canvas (set once by main.js); painters can
// temporarily swap it with setCtx() to draw into offscreen canvases.
export const W = 1080, H = 1920;
export let ctx = null;
export function setCtx(c) { const prev = ctx; ctx = c; return prev; }

// ── math ──
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const seg = (t, a, b) => clamp((t - a) / ((b - a) || 1e-6));
export const eo = (t) => 1 - Math.pow(1 - t, 3);
export const ei = (t) => t * t * t;
export const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const eob = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
export const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export const TAU = Math.PI * 2;
export const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

// ── colour ──
export function hexToRgb(hex) {
  const h = hex.replace('#', ''), n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (hex, a = 1) => { if (!hex || hex.startsWith('rgb')) return hex; const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
/** k < 0 darkens, k > 0 lightens (−1..1) */
export function shade(hex, k) {
  if (!hex || hex.startsWith('rgb')) return hex;
  const c = hexToRgb(hex).map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k));
  return '#' + c.map((v) => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('');
}
export function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return '#' + A.map((v, i) => Math.round(lerp(v, B[i], t)).toString(16).padStart(2, '0')).join(''); }

// ── primitives ──
export function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
export function circle(x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); if (fill) { ctx.fillStyle = fill; ctx.fill(); } }
export function ell(x, y, rx, ry, fill, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot, 0, TAU); if (fill) { ctx.fillStyle = fill; ctx.fill(); } }
export function line(pts, color, w, cap = 'round') {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = cap; ctx.lineJoin = 'round'; ctx.stroke();
}
export function fillAll(color) { ctx.fillStyle = color; ctx.fillRect(-400, -400, W + 800, H + 800); }

/** grapheme clusters (Devanagari conjuncts + matras stay together) */
const SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export const graphemes = (s) => (SEG ? [...SEG.segment(s)].map((x) => x.segment) : [...s]);
export const isDeva = (s) => /[ऀ-ॿ]/.test(s);
