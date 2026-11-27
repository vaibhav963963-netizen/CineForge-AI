// Shared 2D effects for the flat styles (Stick Story, Inside Out, Paper Atlas). Each effect is a deterministic function of the
// shot's progress p, drawn in the style's own palette, so the same plan always gives the same frames.

const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** kind: fire-plasma | debris | shockwave | dust-cloud. (x, y) is the impact or the subject's feet. */
export function drawFlatEffect(ctx, kind, p, x, y, pal) {
  ctx.save();
  if (kind === 'fire-plasma') {
    for (let i = 0; i < 46; i++) {
      const a = hash(i) * Math.PI * 2, d = 90 + hash(i + 9) * 260 * p, r = 16 + hash(i + 3) * 26;
      ctx.globalAlpha = 0.85 * (1 - 0.5 * p);
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y - 300 + Math.sin(a) * d * 0.9, r * (1 - 0.3 * p), 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? pal.fire : pal.fireHot; ctx.fill();
    }
  } else if (kind === 'debris') {
    const s = Math.max(0, (p - 0.75) / 0.25);
    for (let i = 0; i < 34; i++) {
      const vx = (hash(i) - 0.5) * 520, vy = -(260 + hash(i + 5) * 380), g = 1400;
      const px = x + vx * s, py = y + vy * s + 0.5 * g * s * s * 0.3;
      ctx.globalAlpha = 1 - 0.4 * s;
      ctx.fillStyle = pal.debris;
      ctx.fillRect(px - 9, py - 9, 18 + hash(i + 2) * 12, 16);
    }
  } else if (kind === 'shockwave') {
    const s = Math.max(0, (p - 0.7) / 0.3);
    ctx.globalAlpha = 0.9 * (1 - s);
    ctx.strokeStyle = pal.shock; ctx.lineWidth = 16 * (1 - s) + 3;
    ctx.beginPath(); ctx.ellipse(x, y, 60 + s * 620, 18 + s * 110, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (kind === 'dust-cloud') {
    const s = Math.min(1, p * 1.6);
    for (let i = 0; i < 30; i++) {
      const a = hash(i + 40) * Math.PI * 2, d = 40 + hash(i + 50) * 480 * s;
      ctx.globalAlpha = 0.55 * s;
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y - 20 + Math.sin(a) * d * 0.18, 40 + hash(i + 60) * 60, 0, Math.PI * 2);
      ctx.fillStyle = pal.dust; ctx.fill();
    }
  }
  ctx.restore();
}

export const blinkAt = (t, period = 3.4, len = 0.14) => {
  const ph = ((t % period) + period) % period;
  return ph >= len ? 0 : 1 - Math.abs(ph / len * 2 - 1);
};
export const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
