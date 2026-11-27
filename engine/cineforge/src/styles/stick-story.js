// CineForge style: Stick Story. Black stick people whose big white eyes do the acting, flat illustrated rooms (living room,
// kitchen, hallway), a caption bar with one gold word. Rooms and people are drawn with the Stick Story kit (read-only).
import * as LIB from '../../../styles/stick-story/example/src/core/lib.js';
import * as K from '../../../styles/stick-story/example/src/core/kit.js';
import { drawFlatEffect, blinkAt, ease } from './flat-fx.js';

const PAL = { fire: '#F59A3B', fireHot: '#FFD36B', debris: '#2B2B33', shock: '#FFFFFF', dust: '#BDB6A8' };
const MOOD = { stay: 'determined', approach: 'determined', recede: 'worried', cross: 'happy', rise: 'happy', fall: 'sleepy', impact: 'scared' };
const lerp = (a, b, t) => a + (b - a) * t;

/** the room for a set. Night is shown by the light overlay, the rooms stay the same. */
const ROOM = {
  living: () => K.livingRoom({ lampOn: true }),
  kitchen: () => K.kitchen({}),
  hallway: () => K.hallway({ a: '4A', b: '4B' }),
};

/** the person's place, size and pose for the shot's motion at progress p */
function placement(motion, p) {
  const k = ease(p), walk = p * Math.PI * 4;
  switch (motion) {
    case 'approach': return { x: 540, h: lerp(430, 760, k), walk, arms: { L: [28, 55], R: [18, 75] } };
    case 'recede':   return { x: 540, h: lerp(760, 430, k), walk, arms: { L: [-14, 20], R: [14, 20] } };
    case 'cross':    return { x: lerp(190, 890, k), h: 640, walk, arms: { L: [-12, 16], R: [12, 16] } };
    case 'rise':     return { x: 540, h: 640, arms: { L: [150 * p, 20], R: [150 * p, 20] } };   // linear, so it never looks frozen
    case 'fall':     return { x: 540, h: 640, arms: { L: [-30, 10], R: [-40, 10] }, lean: 26 * k };
    case 'impact':   return { x: 540, h: 640, arms: { L: [120, 110], R: [120, 110] }, lean: 6 * Math.sin(p * 30) * Math.exp(-p * 4) };
    default:         return { x: 540, h: 640 };
  }
}

export const stickStory = {
  id: 'stick-story',
  label: 'Stick Story',
  mode: '2d',
  fonts: ['800 92px Inter', '900 54px Inter'],
  /** draws the room and the person for this shot (the canvas is already zoomed and panned by the camera) */
  render2D(ctx, { shot, p, t }) {
    LIB.setCtx(ctx);
    (ROOM[shot.set] || ROOM.living)();
    const pl = placement(shot.motion, p);
    // every frame moves a little: a breathing sway, so the figure is never frozen between poses
    const idle = 1.2 * Math.sin(t * 2.6);
    K.person({ x: pl.x, y: K.GROUND, h: pl.h, dir: 1, walk: pl.walk, arms: pl.arms, lean: (pl.lean || 0) + idle, mood: MOOD[shot.motion] || 'determined', blink: blinkAt(t), look: [0.3, 0] });
    if (shot.effect && shot.effect !== 'none') drawFlatEffect(ctx, shot.effect, p, pl.x, K.GROUND, PAL);
    return { pos: [pl.x, 1, 0] };
  },
  /** a warm night wash for the night lighting (the rooms do not change) */
  lightOverlay(ctx, name, p) {
    if (name === 'night-ambient') { ctx.save(); ctx.globalAlpha = 0.38; ctx.fillStyle = '#0A1A38'; ctx.fillRect(-400, -400, 1880, 2720); ctx.restore(); }
    else if (name === 'fire-glow' || name === 'plasma-glow') { ctx.save(); ctx.globalAlpha = 0.18; ctx.fillStyle = '#FFB060'; ctx.fillRect(-400, -400, 1880, 2720); ctx.restore(); }
  },
  /** the caption bar: its words in white, the marked word in gold, in the Stick Story bar */
  drawCaption(out, text) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean).map((w) => ({ txt: w.replace(/\*/g, ''), hi: w.includes('*') }));
    if (!words.length) return;
    LIB.setCtx(out);
    K.captionBar(words, 540, 1690, 1, K.CAPLOOK);
  },
};
