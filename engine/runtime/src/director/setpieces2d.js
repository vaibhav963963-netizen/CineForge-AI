// Set pieces (2D styles): the same four worlds and actions as setpieces3d.js, drawn through the style skin S
// (inside-out = bold outlines, paper-atlas = cut paper with shadows, stick-story = flat illustration), so the CONTENT
// follows the narration while each style keeps its own visual language.
import * as lib from '../core/lib.js';
const { W, H, clamp, lerp, eo, eio, rnd, TAU } = lib;
const ctx = () => lib.ctx;

function sky(S, top, bottom) {
  const c = ctx(), g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, S.tone(top)); g.addColorStop(1, S.tone(bottom)); c.fillStyle = g; c.fillRect(-400, -400, W + 800, H + 800);
  if (S.id === 'paper-atlas') S.background(false);   // paper fibres under the colour
  if (S.id === 'paper-atlas') { c.fillStyle = lib.rgba(S.tone(bottom), 0.55); c.fillRect(-400, -400, W + 800, H + 800); }
}
function stars(n, t) { const c = ctx(); for (let i = 0; i < n; i++) { c.fillStyle = `rgba(255,255,255,${0.35 + 0.4 * Math.abs(Math.sin(t * 1.5 + i))})`; c.fillRect(rnd(i) * W, rnd(i + 1) * H, 3, 3); } }
function glow(x, y, r, color, a = 1) { const c = ctx(), g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, lib.rgba(color, a)); g.addColorStop(1, lib.rgba(color, 0)); c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
function label(S, text, x, y) { const c = ctx(); c.save(); c.font = '700 40px Inter'; c.textAlign = 'center'; c.fillStyle = S.P.ink; c.globalAlpha = 0.85; c.fillText(text, x, y); c.restore(); }

// ── cosmic ───────────────────────────────────────────────────────────────────────────────────────────────
function planet(S, x, y, r, st, t) {
  // st: { molten, crust, ocean, land, clouds, atmo }
  if (st.atmo) glow(x, y, r * 1.3, '#6FB7FF', 0.5 * st.atmo);
  if (st.molten > 0.05) glow(x, y, r * 1.5, '#FF6A1A', 0.55 * st.molten);
  S.circ(x, y, r, lib.mix(lib.mix('#C2411A', '#5A4636', st.crust), '#1D5C9E', st.ocean * 0.85), { shadow: 1 });
  const c = ctx(); c.save(); c.beginPath(); c.arc(x, y, r, 0, TAU); c.clip();
  if (st.molten > 0.05) { c.strokeStyle = lib.rgba('#FFC23D', st.molten); c.lineWidth = 6; for (let i = 0; i < 14; i++) { let px = x - r + rnd(i) * 2 * r + Math.sin(t * 0.3) * 20, py = y - r + rnd(i + 1) * 2 * r; c.beginPath(); c.moveTo(px, py); for (let k = 0; k < 4; k++) { px += (rnd(i * 4 + k) - 0.5) * 120; py += (rnd(i * 3 + k) - 0.5) * 80; c.lineTo(px, py); } c.stroke(); } }
  if (st.land > 0.05) for (let i = 0; i < 7; i++) { c.globalAlpha = st.land; S.oval(x - r + rnd(i + 4) * 2 * r + ((t * 18) % (2 * r)) - r * 0.5, y - r * 0.6 + rnd(i + 5) * r * 1.2, 50 + rnd(i) * 90, 30 + rnd(i + 2) * 50, '#3F8F4A', { shadow: 0.2, outline: false }); }
  if (st.clouds > 0.05) { c.globalAlpha = st.clouds * 0.8; for (let i = 0; i < 9; i++) S.oval(x - r + rnd(i + 20) * 2 * r + ((t * 30) % 200) - 100, y - r * 0.7 + rnd(i + 21) * r * 1.4, 70 + rnd(i) * 70, 16, '#FFFFFF', { shadow: 0, outline: false }); }
  c.globalAlpha = 1; c.fillStyle = 'rgba(0,0,0,0.28)'; c.beginPath(); c.arc(x + r * 0.35, y + r * 0.2, r * 1.02, 0, TAU); c.fill();
  c.restore();
}
const COSMIC = {
  disk(S, k, t) {
    sky(S, '#070A1C', '#1A0E2A'); stars(140, t);
    const cx = 540, cy = 960;
    for (let i = 0; i < 900; i++) { const r = 90 + rnd(i) * 470, a = rnd(i + 1) * TAU + t * (0.9 / Math.pow(r / 90, 1.5)), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.36; const hot = clamp(1 - r / 380); ctx().fillStyle = lib.rgba(hot > 0.4 ? '#FFB46B' : hot > 0.1 ? '#C98B5E' : '#8A93B8', 0.7); ctx().fillRect(x, y, 4, 4); }
    glow(cx, cy, 260, '#FF9A3D', 0.6); S.circ(cx, cy, 70 + Math.sin(t * 2) * 3, '#FFD27A', { shadow: 0.4 });
  },
  accrete(S, k, t) {
    sky(S, '#070A1C', '#1A0E2A'); stars(120, t); glow(120, 260, 200, '#FFB347', 0.5);
    const centres = [[330, 760], [760, 1080], [480, 1400]];
    for (let i = 0; i < 60; i++) { const c = centres[i % 3], g = eio(clamp(k * 1.2 - (i % 9) * 0.03)); const fx = 540 + Math.cos(rnd(i) * TAU + t * 0.3) * (200 + rnd(i + 1) * 300), fy = 960 + Math.sin(rnd(i) * TAU + t * 0.3) * (300 + rnd(i + 2) * 400);
      S.circ(lerp(fx, c[0] + Math.cos(i) * 20, g), lerp(fy, c[1] + Math.sin(i) * 20, g), lerp(9 + rnd(i) * 8, 5, g), i % 2 ? '#8A7563' : '#6F5E52', { shadow: 0.3, lw: 3 }); }
    centres.forEach((c, i) => S.circ(c[0], c[1], lerp(14, 60 - i * 10, eio(k)), '#7B6656', { shadow: 1 }));
  },
  impact(S, k, t) {
    sky(S, '#070A1C', '#1A0E2A'); stars(120, t); const hit = 0.55, a = clamp(k / hit), after = clamp((k - hit) / (1 - hit));
    planet(S, 600, 1060, 280, { molten: 0.6, crust: 0.4 }, t);
    if (k < hit + 0.05) planet(S, lerp(-100, 330, eio(a)), lerp(400, 820, eio(a)), 150, { molten: 0.3 + a * 0.4, crust: 0.7 }, t);
    if (k > hit) { glow(360, 850, lerp(40, 700, eo(after)), '#FFF1C2', 1 - after); for (let i = 0; i < 160; i++) { const ang = rnd(i) * TAU, d = lerp(0, 380 + rnd(i + 1) * 300, eo(after)); S.circ(360 + Math.cos(ang) * d, 850 + Math.sin(ang) * d * 0.7, 5 + rnd(i + 2) * 7, i % 2 ? '#FFB46B' : '#9C8B7A', { shadow: 0, outline: false }); } }
  },
  moon(S, k, t) {
    sky(S, '#070A1C', '#1A0E2A'); stars(120, t); const g = eio(k);
    planet(S, 540, 1000, 250, { molten: 0.3, crust: 0.7 }, t);
    const ma = t * 0.35, mx = 540 + Math.cos(ma) * 400, my = 1000 + Math.sin(ma) * 140;
    for (let i = 0; i < 260; i++) { const a = rnd(i) * TAU + t * 0.35, r = lerp(330 + rnd(i + 1) * 150, 400, g); const x = lerp(540 + Math.cos(a) * r, mx + (rnd(i + 2) - 0.5) * 80, g * rnd(i + 3)), y = lerp(1000 + Math.sin(a) * r * 0.35, my + (rnd(i + 4) - 0.5) * 80, g * rnd(i + 3)); S.circ(x, y, 4, '#B9A894', { shadow: 0, outline: false }); }
    S.circ(mx, my, lerp(8, 70, g), '#C9C4BA', { shadow: 0.6 });
  },
  molten(S, k, t) {
    sky(S, '#0A0610', '#24080A'); stars(80, t); planet(S, 540, 980, 360 + eio(k) * 30, { molten: 1, crust: 0.1 }, t);
    for (let i = 0; i < 6; i++) { const ph = (t * 0.7 + i * 0.37) % 1, a = rnd(i) * TAU, x = 540 + Math.cos(a) * 330, y = 980 + Math.sin(a) * 330; if (ph < 0.45) glow(x, y, 40 + ph * 160, '#FFB02E', Math.sin(ph / 0.45 * Math.PI)); }
  },
  cooling(S, k, t) {
    const g = eio(k); sky(S, '#070A1C', '#14102A'); stars(100, t);
    planet(S, 540, 980, 370, { molten: lerp(0.8, 0.05, g), crust: lerp(0.3, 1, g), ocean: clamp((g - 0.35) / 0.65) }, t);
    for (let i = 0; i < 40; i++) { const a = rnd(i) * TAU, r = 380 + ((t * 40 + i * 13) % 120); ctx().fillStyle = `rgba(230,236,240,${Math.sin(g * Math.PI) * 0.4})`; ctx().beginPath(); ctx().arc(540 + Math.cos(a) * r, 980 + Math.sin(a) * r, 16, 0, TAU); ctx().fill(); }
  },
  atmosphere(S, k, t) { const g = eio(k); sky(S, '#070A1C', '#101A33'); stars(100, t); planet(S, 540, 980, 370, { crust: 1, ocean: 1, land: g * 0.6, clouds: lerp(0.2, 1, g), atmo: lerp(0.2, 1, g) }, t); },
  compare(S, k, t) {
    sky(S, '#070A1C', '#14102A'); stars(110, t); const g = eio(clamp(k * 1.4));
    const cut = (x, y, rs, cols) => rs.forEach((r, i) => S.circ(x, y, r, cols[i], { shadow: i ? 0.2 : 1 }));
    cut(lerp(400, 330, g), 820, [260, 215, 125, 65], ['#5A4636', '#C0612E', '#E8A33A', '#FFE08A']);
    cut(lerp(680, 770, g), 1300, [140, 117, 35], ['#8E8A82', '#C0612E', '#A0532A']);
    const c = ctx(); c.save(); c.globalAlpha = 0.5 + 0.5 * Math.sin(t * 4); S.stroke([[lerp(400, 330, g) + 150, 900], [lerp(680, 770, g) - 60, 1240]], '#FFE08A', 8); c.restore();
  },
  collapse(S, k, t) { return COSMIC.disk(S, k, t); },
  core(S, k, t) { return COSMIC.molten(S, k, t); },
  life(S, k, t) { sky(S, '#070A1C', '#101A33'); stars(120, t); planet(S, 520, 1000, 360, { crust: 1, ocean: 1, land: 1, clouds: 0.8, atmo: 1 }, t); S.circ(900, 520, 70, '#C9C4BA', { shadow: 0.6 }); },
};
COSMIC.overview = COSMIC.life;

// ── micro ────────────────────────────────────────────────────────────────────────────────────────────────
function virus(S, x, y, r, t, col = '#5FA84A', spike = '#E8D24A') {
  for (let i = 0; i < 16; i++) { const a = i / 16 * TAU + t * 0.3; S.stroke([[x + Math.cos(a) * r, y + Math.sin(a) * r], [x + Math.cos(a) * (r + 26), y + Math.sin(a) * (r + 26)]], spike, 8); S.circ(x + Math.cos(a) * (r + 30), y + Math.sin(a) * (r + 30), 10, spike, { shadow: 0.2, lw: 3 }); }
  S.circ(x, y, r, col, { shadow: 0.8 });
}
function antibody(S, x, y, a, s = 1) {
  const c = ctx(); c.save(); c.translate(x, y); c.rotate(a); c.scale(s, s);
  S.stroke([[0, 40], [0, 0]], '#F4F1FF', 12); S.stroke([[0, 0], [-24, -30]], '#F4F1FF', 12); S.stroke([[0, 0], [24, -30]], '#F4F1FF', 12);
  c.restore();
}
function bcell(S, x, y, r, t) { S.circ(x, y, r, '#7FB2FF', { shadow: 1 }); S.circ(x + Math.sin(t) * 6, y, r * 0.45, '#3B5FC4', { shadow: 0.3 }); }
function plasma(S, t) {
  sky(S, '#6A1A2C', '#2A0812');
  for (let i = 0; i < 12; i++) { const x = ((rnd(i) * W + t * 40 * (0.5 + rnd(i + 1))) % (W + 300)) - 150, y = rnd(i + 2) * H; S.oval(x, y, 70, 46, '#B5223A', { shadow: 0.4 }, rnd(i) * 3); S.oval(x, y, 30, 18, '#8E1A2E', { shadow: 0, outline: false }, rnd(i) * 3); }
  for (let i = 0; i < 80; i++) { ctx().fillStyle = 'rgba(255,170,185,0.35)'; ctx().fillRect(((rnd(i) * W + t * 60) % W), rnd(i + 3) * H, 5, 5); }
}
const MICRO = {
  inject(S, k, t, booster) {
    plasma(S, t); const push = clamp((k - 0.3) / 0.55);
    const c = ctx(); c.save(); c.translate(lerp(760, 640, eio(k)), lerp(160, 420, eio(clamp(k * 1.6)))); c.rotate(0.45);
    S.round(-60, -340, 120, 420, 26, '#DDEFFF', { shadow: 0.8 }); S.round(-48, lerp(-300, -120, push), 96, lerp(330, 150, push), 18, '#9FE2FF', { shadow: 0 });
    S.rect(-10, 80, 20, 220, '#C9D1D9', { shadow: 0.3 }); S.round(-70, lerp(-370, -170, push), 140, 34, 10, '#5A6470', { shadow: 0.5 }); c.restore();
    for (let i = 0; i < 10; i++) { const g = clamp(push * 1.3 - i * 0.05); if (g <= 0) continue; virus(S, lerp(520, 200 + (i % 5) * 170, eo(g)), lerp(760, 1000 + (i / 5 | 0) * 300, eo(g)), 34, t, '#7A8F72', '#B9AE6A'); }
    if (booster) for (let i = 0; i < 6; i++) { const g = eo(clamp(k * 1.3 - i * 0.08)); S.circ(220 + (i % 3) * 300, 1560 + (i / 3 | 0) * 170, lerp(20, 70, g), '#B79CFF', { shadow: 0.6 }); }
  },
  booster(S, k, t) { MICRO.inject(S, k, t, true); },
  antigen(S, k, t) {
    plasma(S, t); bcell(S, 300, 1150, 230, t);
    for (let i = 0; i < 9; i++) virus(S, lerp(1150, 640 + (i % 3) * 140, eio(clamp(k * 1.3 - i * 0.05))), 860 + (i / 3 | 0) * 170, 40, t + i, '#7A8F72', '#B9AE6A');
  },
  antibody(S, k, t) {
    plasma(S, t); bcell(S, 260, 1380, 210, t); const vx = 700, vy = 860; virus(S, vx, vy, 120, t);
    for (let i = 0; i < 18; i++) { const a = i / 18 * TAU, g = eio(clamp(k * 1.4 - i * 0.02)), tx = vx + Math.cos(a) * 200, ty = vy + Math.sin(a) * 200; antibody(S, lerp(300 + (rnd(i) - 0.5) * 200, tx, g), lerp(1300 + (rnd(i + 1) - 0.5) * 200, ty, g), a + Math.PI / 2 + Math.PI, 1); }
  },
  tcell(S, k, t) {
    plasma(S, t); virus(S, 760, 760, 110, t); bcell(S, 260, 760, 170, t);
    const x = lerp(420, 560, eio(k)), y = 1300; for (let i = 0; i < 22; i++) { const a = i / 22 * TAU; S.stroke([[x + Math.cos(a) * 170, y + Math.sin(a) * 170], [x + Math.cos(a) * 205, y + Math.sin(a) * 205]], '#6ACB9F', 12); }
    S.circ(x, y, 175, '#9BE7C4', { shadow: 1 });
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, g = eio(clamp(k * 1.5 - 0.3 - i * 0.03)); antibody(S, lerp(330, 760 + Math.cos(a) * 190, g), lerp(820, 760 + Math.sin(a) * 190, g), a + Math.PI * 1.5, 0.9); }
  },
  memory(S, k, t) {
    plasma(S, t); const vx = lerp(1250, 720, eio(clamp(k * 1.6))), vy = 760; virus(S, vx, vy, 110, t);
    for (let i = 0; i < 6; i++) { const x = 180 + (i % 3) * 200, y = 1260 + (i / 3 | 0) * 240; glow(x, y, 130, '#C9B6FF', 0.4 + 0.3 * Math.sin(t * 3 + i)); S.circ(x, y, 85, '#B79CFF', { shadow: 0.8 }); }
    const g0 = clamp((k - 0.3) / 0.7); for (let i = 0; i < 24; i++) { const a = i / 24 * TAU, g = eio(clamp(g0 * 1.5 - i * 0.01)); antibody(S, lerp(380, vx + Math.cos(a) * 190, g), lerp(1300, vy + Math.sin(a) * 190, g), a + Math.PI * 1.5, 0.85); }
  },
  herd(S, k, t) {
    sky(S, '#E8F1F7', '#CBDDE8');
    const pos = []; for (let r = 0; r < 7; r++) for (let c = 0; c < 6; c++) pos.push([140 + c * 160 + (r % 2) * 40, 520 + r * 190]);
    pos.forEach(([x, y], i) => { const prot = rnd(i * 7) > 0.18; if (prot) glow(x, y - 40, 95, '#6FD3FF', 0.45); S.circ(x, y - 95, 30, '#F1C9A5', { shadow: 0.3, lw: 3 }); S.round(x - 30, y - 62, 60, 100, 26, prot ? '#4F9BD9' : '#E8B27A', { shadow: 0.4, lw: 3 }); });
    const path = [pos[13], pos[20], pos[27], pos[22]], hop = k * 3, idx = Math.floor(hop), fr = hop - idx, a = path[idx % 4], b = path[(idx + 1) % 4];
    virus(S, lerp(a[0], b[0], eio(fr)), lerp(a[1], b[1], eio(fr)) - 200 - Math.sin(fr * Math.PI) * 120, 34, t);
  },
};
MICRO.overview = MICRO.antibody;

// ── octopus ──────────────────────────────────────────────────────────────────────────────────────────────
function sea(S, t) {
  sky(S, '#2C8FB8', '#0B3550'); const c = ctx();
  for (let i = 0; i < 7; i++) { c.fillStyle = `rgba(255,255,255,${0.06 + 0.04 * Math.sin(t + i)})`; c.beginPath(); c.moveTo(80 + i * 160 + Math.sin(t * 0.5 + i) * 40, -50); c.lineTo(160 + i * 160, -50); c.lineTo(i * 170 + 300, H); c.lineTo(i * 170 + 160, H); c.fill(); }
  S.rect(-200, 1560, W + 400, 600, '#C7B48A', { shadow: 0.6 });
  for (let i = 0; i < 9; i++) S.oval(rnd(i) * W, 1560 - rnd(i + 1) * 60, 80 + rnd(i + 2) * 120, 60 + rnd(i + 3) * 50, ['#6E7466', '#7D6D5C', '#5D6C6A'][i % 3], { shadow: 0.6 });
  for (let i = 0; i < 30; i++) { const y = H - ((t * 90 + i * 70) % H); S.circ(rnd(i) * W + Math.sin(t + i) * 10, y, 6 + rnd(i + 1) * 6, '#E8FBFF', { shadow: 0, outline: false }); }
}
function octo(S, x, y, s, t, { color = '#D2552E', mode = 'rest', k = 0, alpha = 1, squeeze = 1 } = {}) {
  const c = ctx(); c.save(); c.globalAlpha = alpha; c.translate(x, y); c.scale(s * squeeze, s);
  for (let i = 0; i < 8; i++) {
    const base = (i - 3.5) * 0.32, pts = [];
    for (let u = 0; u <= 1.001; u += 0.1) { const w = Math.sin(t * 2.2 + i - u * 4) * 30 * u; let px = Math.sin(base) * u * 260 + w, py = 60 + u * 170 - Math.cos(base) * 0 + (mode === 'swim' ? -u * 330 : 0); if (mode === 'solve' && i < 3) { px = lerp(0, 230, u) + Math.sin(u * 3) * 20; py = lerp(40, -60 - i * 40, u) + w * 0.3; } pts.push([px, py]); }
    for (let j = 0; j < pts.length - 1; j++) S.stroke([pts[j], pts[j + 1]], color, lerp(34, 8, j / pts.length));
  }
  S.oval(0, -60, 110, 150, color, { shadow: 0.8 }); S.circ(0, 40, 86, color, { shadow: 0.3 });
  for (const sx of [-1, 1]) { S.circ(sx * 44, 20, 20, '#F3E9C8', { shadow: 0, lw: 3 }); S.rect(sx * 44 - 12, 16, 24, 8, '#111', { shadow: 0, outline: false }); }
  c.restore();
}
const OCTOPUS = {
  camouflage(S, k, t) {
    sea(S, t); S.oval(540, 1250, 360, 260, '#6E7466', { shadow: 1 }); for (let i = 0; i < 26; i++) S.circ(250 + rnd(i) * 580, 1060 + rnd(i + 1) * 380, 10 + rnd(i + 2) * 22, i % 2 ? '#4E5648' : '#8A7C66', { shadow: 0, outline: false });
    const g = eio(clamp((k - 0.15) / 0.7)); octo(S, 540, 1080, 1, t, { color: lib.mix('#D2552E', '#717765', g) });
    const c = ctx(); c.save(); c.globalAlpha = g * 0.8; for (let i = 0; i < 16; i++) S.circ(460 + rnd(i) * 160, 960 + rnd(i + 1) * 200, 8 + rnd(i + 2) * 14, i % 2 ? '#4E5648' : '#8A7C66', { shadow: 0, outline: false }); c.restore();
  },
  squeeze(S, k, t) {
    sea(S, t); const g = eio(k), thin = Math.sin(clamp((k - 0.2) / 0.6) * Math.PI);
    S.poly([[-100, 400], [470, 420], [500, 1600], [-100, 1600]], '#5E625A', { shadow: 1 }); S.poly([[610, 420], [1180, 400], [1180, 1600], [580, 1600]], '#5E625A', { shadow: 1 });
    octo(S, 540, lerp(1500, 600, g), 0.8, t, { squeeze: lerp(1, 0.3, thin), color: '#C8572E' });
  },
  solve(S, k, t) {
    sea(S, t); const g = clamp((k - 0.25) / 0.6);
    S.round(640, 900, 260, 360, 40, '#DDF3FF', { shadow: 0.5 }); S.oval(770, 1180, 60, 30, '#D64A2A', { shadow: 0.3 });
    const c = ctx(); c.save(); c.translate(770, 880 - Math.max(0, g - 0.75) * 400); c.rotate(Math.sin(g * 25) * 0.2); S.round(-150, -30, 300, 60, 16, '#C9A227', { shadow: 0.5 }); c.restore();
    octo(S, 380, 1130, 0.95, t, { mode: 'solve', color: '#C8572E' });
  },
  hearts(S, k, t) {
    sea(S, t); octo(S, 540, 1020, 1.6, t, { alpha: 0.45, color: '#D2552E' });
    const beat = (o) => 1 + 0.25 * Math.max(0, Math.sin(t * 6 + o));
    [[430, 900, 0], [650, 900, 0], [540, 800, 1.6]].forEach(([x, y, o], i) => { glow(x, y, 80, '#2F7BFF', 0.5); S.circ(x, y, 42 * beat(o), i < 2 ? '#2F7BFF' : '#5AA0FF', { shadow: 0.5 }); });
    for (const x of [330, 750]) S.oval(x, 920, 36, 80, '#E8A0A0', { shadow: 0.4 });
    for (let j = 0; j < 60; j++) { const u = (t * 0.4 + j / 60) % 1, side = j % 3, from = [[430, 900], [650, 900], [540, 800]][side], to = side < 2 ? [[330, 920], [750, 920]][side] : [540 + Math.cos(j) * 300, 1260]; S.circ(lerp(from[0], to[0], u), lerp(from[1], to[1], u), 7, '#4F9BFF', { shadow: 0, outline: false }); }
  },
  swim(S, k, t) { sea(S, t); octo(S, lerp(-100, 1180, eio(k)), 900 + Math.sin(t * 3) * 40, 0.9, t, { mode: 'swim', color: '#C8572E' }); },
  arms(S, k, t) {
    sea(S, t); octo(S, 540, 1000, 1.3, t, { color: '#C8572E' });
    for (let i = 0; i < 90; i++) { const a = (i % 8 - 3.5) * 0.32, u = (i / 8 | 0) / 11; glow(540 + Math.sin(a) * u * 340 * 1.3, 1000 + (60 + u * 170) * 1.3, 18, '#FFE08A', 0.5 + 0.5 * Math.sin(t * 5 + i)); }
  },
};
OCTOPUS.overview = (S, k, t) => { sea(S, t); octo(S, lerp(500, 580, eio(k)), 1080, 1.05, t, { color: '#C8572E' }); };

// ── optics ───────────────────────────────────────────────────────────────────────────────────────────────
const SPECTRUM = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#3949AB', '#8E24AA'];
function landscape(S, t, rain = true) {
  sky(S, '#6F8FAF', '#C9D7E2'); S.oval(250, 1500, 520, 220, '#5C7F4A', { shadow: 0.5 }); S.oval(850, 1540, 560, 240, '#4E7140', { shadow: 0.5 }); S.rect(-200, 1560, W + 400, 600, '#5C7F4A', { shadow: 0.3 });
  if (rain) { const c = ctx(); c.strokeStyle = 'rgba(230,240,250,0.55)'; c.lineWidth = 3; for (let i = 0; i < 160; i++) { const x = rnd(i) * W, y = (rnd(i + 1) * H + t * 900) % H; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 8, y + 34); c.stroke(); } }
}
function ray(S, a, b, color, w = 12, f = 1) { S.stroke([a, [lerp(a[0], b[0], f), lerp(a[1], b[1], f)]], color, w); }
function droplet(S, k, stage) {
  sky(S, '#20354A', '#0E1A26'); const cx = 560, cy = 900, R = 300;
  glow(cx, cy, R * 1.2, '#CFE9FF', 0.15); { const c = ctx(); c.save(); c.globalAlpha = 0.3; S.circ(cx, cy, R, '#CFE9FF', { shadow: 0.6 }); c.restore(); }
  const p0 = [0, 660], p1 = [cx - R * 0.86, 660], p2 = [cx + R * 0.72, cy + R * 0.68], p3 = [cx - R * 0.3, cy + R * 0.95], g = eio(k);
  ray(S, p0, p1, '#FFFFFF', 14); ray(S, p1, p2, '#FFFFFF', 12, stage === 'refract' ? clamp(g * 1.4) : 1);
  if (stage !== 'refract') ray(S, p2, p3, '#FFFFFF', 12, stage === 'reflect' ? clamp(g * 1.4) : 1);
  if (stage === 'disperse') SPECTRUM.forEach((c, i) => ray(S, p3, [0, 1500 + i * 60], c, 10, clamp(g * 1.3 - i * 0.03)));
}
const OPTICS = {
  sunrain(S, k, t) { landscape(S, t); glow(lerp(80, 160, eio(k)), 300, 220, '#FFF4D0', 0.9); S.circ(lerp(80, 160, eio(k)), 300, 70, '#FFE38A', { shadow: 0 }); },
  refract(S, k) { droplet(S, k, 'refract'); },
  reflect(S, k) { droplet(S, k, 'reflect'); },
  disperse(S, k) { droplet(S, k, 'disperse'); },
  rainbow(S, k, t) {
    landscape(S, t, k < 0.6); const c = ctx(), a = eo(clamp(k * 1.5));
    SPECTRUM.forEach((col, i) => { c.strokeStyle = lib.rgba(S.tone(col), 0.8 * a); c.lineWidth = 30; c.beginPath(); c.arc(540, 1560, 760 - i * 30, Math.PI, TAU); c.stroke(); });
  },
};
OPTICS.overview = OPTICS.rainbow;

const WORLDS2D = { cosmic: COSMIC, micro: MICRO, octopus: OCTOPUS, optics: OPTICS };
export const SETPIECE_WORLDS_2D = Object.keys(WORLDS2D);
/** draws the world's action at progress k (0..1) into lib.ctx; returns false when the world/action is unknown */
export function setpiece2d(S, world, action, k, t) {
  const w = WORLDS2D[world]; if (!w) return false;
  (w[action] || w.overview)(S, k, t); return true;
}
/** where a lead character can stand in the scene (world-specific; null = the character does not belong here) */
export const LEAD_SPOT_2D = { optics: { sunrain: [300, 1640, 560], rainbow: [300, 1680, 560] } };
