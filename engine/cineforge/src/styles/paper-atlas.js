// CineForge style: Paper Atlas. History told in cut paper: every shape is paper on aged parchment with a light edge and a soft
// shadow, maps with crimson routes, gold date ribbons, a serif caption strip. Drawn with the Paper Atlas kit (read-only).
import * as LIB from '../../../styles/paper-atlas/example/src/core/lib.js';
import * as K from '../../../styles/paper-atlas/example/src/core/kit.js';
import { drawFlatEffect, blinkAt, ease } from './flat-fx.js';

const PAL = { fire: '#B83227', fireHot: '#E67E22', debris: '#7A4E2A', shock: '#F5E6C8', dust: '#D9CBB0' };
const lerp = (a, b, t) => a + (b - a) * t;

/** the figure's place, size, walk and arm for the shot's motion at progress p */
function placement(motion, p) {
  const k = ease(p), walk = p * Math.PI * 4;
  switch (motion) {
    case 'approach': return { x: 540, h: lerp(560, 880, k), walk, arm: 0 };
    case 'recede':   return { x: 540, h: lerp(880, 560, k), walk, arm: 0 };
    case 'cross':    return { x: lerp(200, 880, k), h: 760, walk, arm: 0 };
    case 'rise':     return { x: 540, h: 760, arm: 100 * p };   // linear, so it never looks frozen
    case 'fall':     return { x: 540, h: 760, arm: -10 * k };
    case 'impact':   return { x: 540, h: 760, arm: 110 * Math.exp(-p * 3) };
    default:         return { x: 540, h: 760, arm: 0 };
  }
}

export const paperAtlas = {
  id: 'paper-atlas',
  label: 'Paper Atlas',
  mode: '2d',
  fonts: ['700 88px Caladea'],
  render2D(ctx, { shot, p, t }) {
    LIB.setCtx(ctx);
    if (shot.set === 'harbor') K.harbor(t, lerp(180, 900, ease(p)));
    else if (shot.set === 'map') K.map({ seed: 3 });
    else K.hall();
    const pl = placement(shot.motion, p);
    const idle = 2.2 * Math.sin(t * 2.5);   // a small continuous wobble of the raised arm, so the cut-out never freezes
    K.figure({ x: pl.x, y: 1600, h: pl.h, dir: 1, role: 'merchant', walk: pl.walk, arm: pl.arm + idle });
    if (shot.effect && shot.effect !== 'none') drawFlatEffect(ctx, shot.effect, p, pl.x, 1600, PAL);
    return { pos: [pl.x, 1, 0] };
  },
  /** the night is the same parchment under a navy wash */
  lightOverlay(ctx, name) {
    if (name === 'night-ambient') { ctx.save(); ctx.globalAlpha = 0.36; ctx.fillStyle = '#1A2A5A'; ctx.fillRect(-400, -400, 1880, 2720); ctx.restore(); }
  },
  /** the caption strip on torn paper: the words in ink, the marked word in crimson */
  drawCaption(out, text) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean).map((w) => ({ txt: w.replace(/\*/g, ''), hi: w.includes('*') }));
    if (!words.length) return;
    LIB.setCtx(out);
    K.captionStrip(words, 540, 1640, 1, K.CAPLOOK);
  },
};
