// Captions in the Deep Dive style: Inter Black, white with a thick ink outline, ONE yellow word, centre lower third.
// The caption text comes from the shot ("*" marks the yellow word). Long text is split across two lines at the widest
// word boundary, as Deep Dive does. Drawn onto the 2D output canvas after the 3D frame.
export const CAP = { y: 1480, size: 118, maxW: 940, stroke: 22, yellow: '#FFD43B', white: '#FFFFFF', ink: '#111111' };

/** parse "What if you *swallowed gum?" → [{ txt, hi }] */
export function parseCaption(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).map((w) => ({ txt: w.replace(/\*/g, ''), hi: w.includes('*') }));
}

export function drawCaption(ctx, text, lt = 1) {
  const words = parseCaption(text);
  if (!words.length) return;
  const size = CAP.size, sp = size * 0.26;
  ctx.save();
  ctx.font = `900 ${size}px Inter, sans-serif`; ctx.letterSpacing = '-1px';
  words.forEach((w) => (w.w = ctx.measureText(w.txt).width));
  const width = (ws) => ws.reduce((a, w) => a + w.w, 0) + sp * (ws.length - 1);
  let lines = [words];
  if (width(words) > CAP.maxW && words.length > 1) {
    let best = null;
    for (let i = 1; i < words.length; i++) { const a = words.slice(0, i), b = words.slice(i), m = Math.max(width(a), width(b)); if (!best || m < best.m) best = { m, l: [a, b] }; }
    lines = best.l;
  }
  const fit = Math.min(1, CAP.maxW / Math.max(...lines.map(width)));
  const pop = lt < 0.2 ? 0.65 + 0.35 * Math.min(1, lt / 0.2) : 1;
  ctx.translate(540, CAP.y); ctx.scale(pop * fit, pop * fit);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
  const lh = size, y0 = -(lines.length - 1) * lh / 2;
  lines.forEach((ln, li) => {
    let x = -width(ln) / 2; const y = y0 + li * lh;
    for (const w of ln) {
      ctx.lineWidth = CAP.stroke; ctx.strokeStyle = CAP.ink;
      ctx.strokeText(w.txt, x, y + 6); ctx.strokeText(w.txt, x, y);
      ctx.fillStyle = w.hi ? CAP.yellow : CAP.white; ctx.fillText(w.txt, x, y);
      x += w.w + sp;
    }
  });
  ctx.letterSpacing = '0px'; ctx.restore();
}
