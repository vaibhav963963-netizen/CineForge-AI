// CineForge style: Inside Out. Flat 2D shapes only: a simple hero, x-ray cutaways into the body, organs and props as clean vector
// shapes, bold 1–3 word captions with one yellow word. Drawn with the Inside Out kit (read-only).
import * as LIB from '../../../styles/inside-out/example/src/core/lib.js';
import * as K from '../../../styles/inside-out/example/src/core/kit.js';
import { drawFlatEffect, blinkAt, ease } from './flat-fx.js';

const PAL = { fire: '#F2703D', fireHot: '#FFD43B', debris: '#8C5A3C', shock: '#FFFFFF', dust: '#CFC6B3' };
const CAP = { y: 1400, size: 150, maxW: 900, stroke: 22, ink: '#1A1A1E', white: '#FFFFFF', yellow: '#FFD43B' };
/** the arm for the shot's motion, blended from the arm at rest by the ease of the shot */
function armFor(motion, k, t) {
  const target = { approach: K.ARM.mouth, impact: K.ARM.mouth, rise: K.ARM.point, cross: K.ARM.wave, recede: K.ARM.hip }[motion] || K.ARM.down;
  const a = K.armPose(K.ARM.down, target, k);
  const idle = 3 * Math.sin(t * 2.2);   // a small continuous breathing wobble, so the arm is never frozen
  return { e: [a.e[0] + idle, a.e[1]], h: [a.h[0] + idle * 1.6, a.h[1]] };
}

export const insideOut = {
  id: 'inside-out',
  label: 'Inside Out',
  mode: '2d',
  fonts: ['900 150px Inter'],
  render2D(ctx, { shot, p, t }) {
    LIB.setCtx(ctx);
    const k = ease(p);
    if (shot.set === 'stomach') {
      // the subject travels down the food path through the stomach
      K.insideStomach(t, 1);
      const [x, y] = K.foodAt(p);
      K.gum(x, y, 1.4, p * 3.1);
      if (shot.effect && shot.effect !== 'none') drawFlatEffect(ctx, shot.effect, p, x, y, PAL);
      return { pos: [x, y, 0] };
    }
    if (shot.set === 'xray') K.xray(t);
    else K.room();
    const xr = shot.set === 'xray';
    K.man({ x: 540, y: 900, s: 0.95, arm: armFor(shot.motion, k, t), armL: armFor(shot.motion, k, t), xray: xr, blink: blinkAt(t) });
    if (shot.effect && shot.effect !== 'none') {
      if (shot.effect === 'shockwave') K.shockLines(540, 1560, 80 + p * 520, 0.9 * (1 - p * 0.4));
      else if (shot.effect === 'debris' || shot.effect === 'fire-plasma') K.burst(540, 1420, 1 + p * 0.8, 0.9 * (1 - 0.5 * p));
      else drawFlatEffect(ctx, shot.effect, p, 540, 1560, PAL);
    }
    return { pos: [540, 1, 0] };
  },
  lightOverlay(ctx, name) {
    if (name === 'night-ambient') { ctx.save(); ctx.globalAlpha = 0.34; ctx.fillStyle = '#10204A'; ctx.fillRect(-400, -400, 1880, 2720); ctx.restore(); }
  },
  /** bold words, white with a thick ink outline, the marked word in yellow, centre lower third */
  drawCaption(out, text, lt = 0) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean).map((w) => ({ txt: w.replace(/\*/g, ''), hi: w.includes('*') }));
    if (!words.length) return;
    const sp = CAP.size * 0.24;
    out.save();
    out.font = `900 ${CAP.size}px Inter, sans-serif`; out.letterSpacing = '-1px';
    words.forEach((w) => (w.w = out.measureText(w.txt).width));
    const width = (ws) => ws.reduce((a, w) => a + w.w, 0) + sp * (ws.length - 1);
    let lines = [words];
    if (width(words) > CAP.maxW && words.length > 1) {
      let best = null;
      for (let i = 1; i < words.length; i++) { const a = words.slice(0, i), b = words.slice(i), m = Math.max(width(a), width(b)); if (!best || m < best.m) best = { m, l: [a, b] }; }
      lines = best.l;
    }
    const fit = Math.min(1, CAP.maxW / Math.max(...lines.map(width)));
    const pop = lt < 0.2 ? 0.65 + 0.35 * Math.min(1, lt / 0.2) : 1;
    out.translate(540, CAP.y); out.scale(pop * fit, pop * fit);
    out.textBaseline = 'middle'; out.textAlign = 'left'; out.lineJoin = 'round';
    const y0 = -(lines.length - 1) * CAP.size / 2;
    lines.forEach((ln, li) => {
      let x = -width(ln) / 2; const y = y0 + li * CAP.size;
      for (const w of ln) {
        out.lineWidth = CAP.stroke; out.strokeStyle = CAP.ink;
        out.strokeText(w.txt, x, y + 6); out.strokeText(w.txt, x, y);
        out.fillStyle = w.hi ? CAP.yellow : CAP.white; out.fillText(w.txt, x, y);
        x += w.w + sp;
      }
    });
    out.letterSpacing = '0px'; out.restore();
  },
};
