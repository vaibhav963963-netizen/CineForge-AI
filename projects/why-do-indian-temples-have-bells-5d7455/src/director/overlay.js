// Information overlays drawn on the 2D canvas in the style's own typography: big numbers (count up), comparisons
// (bars grow), numbered steps, dates, titles, labels, and two diagrams (orbit transfer, route between places).
import { ctx, W, H, TAU, clamp, lerp, seg, eo, eob, rgba, shade, rr, circle, line, graphemes, isDeva, rnd } from '../core/lib.js';

let STYLE = null, LANG = null;
export function setOverlayStyle(style, language) { STYLE = style; LANG = language; }

const fam = (text, kind = 'label') => {
  if (isDeva(text || '')) return `'StudioDeva', 'Nirmala UI', sans-serif`;
  const t = STYLE.typography; return `'${kind === 'title' ? t.title : t.label}', sans-serif`;
};
const weight = (text, kind = 'label') => (isDeva(text || '') ? 800 : kind === 'title' ? STYLE.typography.titleWeight : STYLE.typography.labelWeight);
function text(str, x, y, size, color, { kind = 'label', align = 'center', stroke = null, sw = 0, maxW = 960 } = {}) {
  ctx.save(); ctx.font = `${weight(str, kind)} ${size}px ${fam(str, kind)}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  const w = ctx.measureText(str).width, sc = Math.min(1, maxW / Math.max(1, w));
  ctx.translate(x, y); ctx.scale(sc, sc);
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = sw; ctx.strokeStyle = stroke; ctx.strokeText(str, 0, 0); }
  ctx.fillStyle = color; ctx.fillText(str, 0, 0); ctx.restore();
  return w * sc;
}

/** card behind overlay text, in the style's material */
function card(x, y, w, h, { accent = false } = {}) {
  const P = STYLE.palette, id = STYLE.id;
  ctx.save();
  if (id === 'paper-atlas') {
    ctx.shadowColor = 'rgba(52,34,18,0.4)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 8;
    ctx.beginPath(); const n = 14; ctx.moveTo(x - w / 2, y - h / 2);
    for (let i = 1; i <= n; i++) ctx.lineTo(x - w / 2 + (w * i) / n, y - h / 2 + rnd(i + x) * 8);
    for (let i = n; i >= 0; i--) ctx.lineTo(x - w / 2 + (w * i) / n, y + h / 2 - rnd(i + 40 + x) * 8);
    ctx.closePath(); ctx.fillStyle = accent ? P.accent : P.paper; ctx.fill();
  } else if (id === 'night-file') {
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 40; rr(x - w / 2, y - h / 2, w, h, 4); ctx.fillStyle = P.paper; ctx.fill();
  } else if (id === 'stick-story') {
    rr(x - w / 2, y - h / 2, w, h, 26); ctx.fillStyle = accent ? P.accent : 'rgba(22,22,26,0.92)'; ctx.fill();
  } else if (id === 'inside-out') {
    rr(x - w / 2, y - h / 2, w, h, Math.min(h / 2, 46)); ctx.fillStyle = accent ? P.accent : P.ink; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = P.ink; ctx.stroke();
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24; rr(x - w / 2, y - h / 2, w, h, 26); ctx.fillStyle = accent ? P.accent : 'rgba(14,20,28,0.86)'; ctx.fill();
  }
  ctx.restore();
}
const cardText = (accent) => { const id = STYLE.id, P = STYLE.palette; if (id === 'paper-atlas' || id === 'night-file') return P.ink; if (accent) return P.ink; return '#FFFFFF'; };
const hiColor = () => STYLE.captions.hi || STYLE.palette.accent;

function numberParts(v) { const m = String(v).match(/^(\D*?)([\d,.]+)(.*)$/); if (!m) return null; const n = parseFloat(m[2].replace(/,/g, '')); return Number.isFinite(n) ? { pre: m[1], n, post: m[3], dec: (m[2].split('.')[1] || '').length } : null; }

const DRAW = {
  number(o, lt) {
    const k = eob(seg(lt, 0, 0.35)), y = o.y ?? 560;
    const parts = numberParts(o.value);
    // a factual number must read correctly: a short tick-up that lands on the true value within 0.35 s
    const shown = parts ? `${parts.pre}${(lt >= 0.35 ? parts.n : parts.n * eo(seg(lt, 0, 0.35))).toLocaleString('en-IN', { maximumFractionDigits: parts.dec })}${parts.post}` : String(o.value);
    ctx.save(); ctx.translate(540, y); ctx.scale(k, k);
    card(0, 0, 900, o.label ? 330 : 240, { accent: false });
    text(shown, 0, o.label ? -40 : 0, 150, STYLE.id === 'paper-atlas' ? STYLE.palette.primary : hiColor(), { kind: 'title', maxW: 820 });
    if (o.label) text(o.label, 0, 95, 58, cardText(false), { maxW: 820 });
    ctx.restore();
  },
  comparison(o, lt) {
    const items = (o.items || []).slice(0, 3), y0 = o.y ?? 250, maxV = Math.max(...items.map((i) => +i.value || 0), 1);
    card(540, y0 + items.length * 85 - 30, 960, items.length * 170 + 60);
    items.forEach((it, i) => {
      const y = y0 + i * 170, g = eo(seg(lt, 0.15 + i * 0.25, 0.9 + i * 0.25)), w = 760 * (+it.value || 0) / maxV * g;
      text(it.label, 100, y, 54, cardText(false), { align: 'left', maxW: 860 });
      rr(100, y + 40, Math.max(8, w), 74, 16); ctx.fillStyle = i === items.length - 1 ? hiColor() : shade(STYLE.palette.secondary || '#4FD1E8', 0); ctx.fill();
      if (g > 0.3) text(it.display || String(it.value), 100 + Math.max(8, w) + 20, y + 77, 50, cardText(false), { align: 'left', maxW: 300 });
    });
  },
  steps(o, lt) {
    const k = eob(seg(lt, 0, 0.3)), y = o.y ?? 360;
    ctx.save(); ctx.translate(540, y); ctx.scale(k, k);
    card(0, 0, 860, 210, { accent: true });
    circle(-330, 0, 70, STYLE.palette.ink); text(String(o.n || 1), -330, 4, 90, STYLE.palette.accent, { kind: 'title' });
    text(o.text || '', 60, 0, 70, STYLE.palette.ink, { maxW: 600 });
    ctx.restore();
  },
  date(o, lt) {
    const id = STYLE.id, P = STYLE.palette, x = 90, y = o.y ?? 300;
    if (id === 'night-file') {
      const full = `${o.text || ''}`, n = graphemes(full).length, shown = graphemes(full).slice(0, Math.ceil(n * clamp(lt / 0.8))).join('');
      text(shown, x, y, 70, P.text, { align: 'left', maxW: 900 });
      if (o.sub) text(o.sub, x, y + 80, 44, P.primary, { align: 'left', maxW: 900 });
      return;
    }
    const k = eob(seg(lt, 0, 0.35));
    ctx.save(); ctx.translate(540, y); ctx.scale(k, k);
    if (id === 'paper-atlas') { card(0, 0, 640, 170, { accent: true }); text(o.text, 0, -6, 92, P.ink, { kind: 'title', maxW: 580 }); }
    else { card(0, 0, 700, 160, { accent: true }); text(o.text, 0, 0, 82, STYLE.id === 'deep-dive' || STYLE.id === 'tall-tale' ? '#111' : P.ink, { kind: 'title', maxW: 640 }); }
    if (o.sub) text(o.sub, 0, 130, 48, id === 'paper-atlas' ? P.ink : '#FFFFFF', { maxW: 800, stroke: id === 'paper-atlas' ? null : '#000', sw: 10 });
    ctx.restore();
  },
  title(o, lt) {
    const k = eob(seg(lt, 0, 0.4)), y = o.y ?? 520;
    ctx.save(); ctx.translate(540, y); ctx.scale(k, k);
    const P = STYLE.palette, light = STYLE.id === 'paper-atlas' || STYLE.id === 'stick-story' || STYLE.id === 'inside-out';
    text(o.text || '', 0, 0, 104, light ? P.ink : '#FFFFFF', { kind: 'title', maxW: 960, stroke: light ? null : '#000000', sw: 14 });
    if (o.sub) text(o.sub, 0, 120, 56, hiColor(), { maxW: 900, stroke: light ? null : '#000', sw: 10 });
    ctx.restore();
  },
  label(o, lt) {
    const k = eob(seg(lt, 0.1, 0.4)), x = o.x ?? 540, y = o.y ?? 420;
    if (o.tx !== undefined) line([[x, y + 50], [o.tx, o.ty]], STYLE.palette.ink === '#0A0A0A' ? STYLE.palette.text : STYLE.palette.ink, 6);
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.font = `${weight(o.text)} 56px ${fam(o.text)}`; const w = Math.min(900, ctx.measureText(o.text).width + 80);
    card(0, 0, w, 110); text(o.text, 0, 2, 56, cardText(false), { maxW: w - 50 });
    ctx.restore();
  },
  orbit(o, lt, d, t) {
    // Hohmann-style transfer: Earth orbit → transfer ellipse → Mars orbit, spacecraft travelling along it
    const P = STYLE.palette, cx = 540, cy = 980, r1 = 210, r2 = 400, k = eo(seg(lt, 0.2, d * 0.85));
    const ink = '#FFFFFF';   // orbit diagrams always sit on a dark space background
    circle(cx, cy, 56, '#F6C445');
    for (const [r, col] of [[r1, '#2F7FC1'], [r2, '#C1532F']]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.strokeStyle = rgba(col, 0.8); ctx.lineWidth = 6; ctx.setLineDash([18, 14]); ctx.stroke(); ctx.setLineDash([]); }
    const a = (r1 + r2) / 2, c = (r2 - r1) / 2;
    ctx.beginPath(); ctx.ellipse(cx - c, cy, a, Math.sqrt(a * a - c * c), 0, 0, Math.PI * k, false); ctx.strokeStyle = hiColor(); ctx.lineWidth = 10; ctx.stroke();
    const th = Math.PI * k, sx = cx - c + Math.cos(th) * a, sy = cy + Math.sin(th) * Math.sqrt(a * a - c * c);
    circle(cx + r1, cy, 30, '#2F7FC1'); circle(cx - r2 * Math.cos(t * 0.05), cy - r2 * Math.sin(-0.02), 26, '#C1532F');
    circle(sx, sy, 16, '#FFFFFF'); circle(sx, sy, 8, hiColor());
    const lb = o.labels || (LANG && LANG.code === 'hi' ? ['पृथ्वी', 'मंगल'] : ['Earth', 'Mars']); text(lb[0], cx + r1, cy + 72, 46, ink, { stroke: STYLE.dimension === '2d' ? null : '#000', sw: 8 }); text(lb[1], cx - r2, cy + 72, 46, ink, { stroke: STYLE.dimension === '2d' ? null : '#000', sw: 8 });
  },
  route(o, lt, d) {
    const pts = (o.points || [[260, 1300], [540, 760], [820, 1100]]), k = eo(seg(lt, 0.15, d * 0.8)), P = STYLE.palette;
    const total = pts.length - 1, upto = k * total;
    ctx.setLineDash([22, 16]); ctx.lineWidth = 12; ctx.strokeStyle = P.primary; ctx.beginPath(); ctx.moveTo(...pts[0]);
    for (let i = 1; i <= Math.ceil(upto) && i < pts.length; i++) { const f = Math.min(1, upto - (i - 1)); ctx.lineTo(lerp(pts[i - 1][0], pts[i][0], f), lerp(pts[i - 1][1], pts[i][1], f)); }
    ctx.stroke(); ctx.setLineDash([]);
    pts.forEach((p, i) => { if (i <= upto + 0.01) { circle(p[0], p[1], 26, P.primary); circle(p[0], p[1], 11, P.paper || '#FFF'); if (o.labels && o.labels[i]) text(o.labels[i], p[0], p[1] - 70, 50, P.ink === '#0A0A0A' ? '#FFF' : P.ink, { maxW: 420 }); } });
  },
};

export function drawOverlay(o, lt, d, t) { if (!o || !DRAW[o.type]) return; ctx.save(); DRAW[o.type](o, lt, d, t); ctx.restore(); }
export const OVERLAY_TYPES = Object.keys(DRAW);
