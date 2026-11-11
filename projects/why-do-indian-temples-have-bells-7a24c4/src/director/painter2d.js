// 2D painter: environments, props and figures for the 2D styles, drawn through a style "skin":
//   inside-out  → flat vector shapes with ink outlines, cream background, pink/cyan/yellow palette, no gradients
//   stick-story → flat illustrated rooms, ink-black stick people with big white eyes, gold accents
//   paper-atlas → every shape is cut paper (light edge + soft drop shadow) on aged parchment, muted colours
// Coordinates are the 1080x1920 frame; GROUND is where people stand in a wide shot.
import { ctx, W, H, TAU, clamp, lerp, rnd, mix, shade, rgba, circle, ell, rr, line, fillAll } from '../core/lib.js';

export const GROUND = 1460, HORIZON = 1080;

export function makeSkin(style) {
  const P = style.palette, id = style.id;
  const tone = id === 'paper-atlas' ? (c) => mix(c, '#B89E74', 0.32) : id === 'stick-story' ? (c) => mix(c, '#EDE6D8', 0.1) : (c) => c;
  const S = {
    id, P, tone,
    ink: P.ink,
    /** draw a closed path in the skin's way. opts: { outline: true, shadow: 1, edge: true } */
    fill(path, color, o = {}) {
      const col = tone(color);
      if (id === 'paper-atlas') {
        ctx.save(); ctx.shadowColor = 'rgba(52,34,18,0.38)'; ctx.shadowBlur = 14 * (o.shadow ?? 1); ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 7 * (o.shadow ?? 1);
        path(); ctx.fillStyle = col; ctx.fill(); ctx.restore();
        if (o.edge !== false) { path(); ctx.strokeStyle = 'rgba(255,247,228,0.55)'; ctx.lineWidth = 4; ctx.stroke(); }
      } else {
        path(); ctx.fillStyle = col; ctx.fill();
        const outline = o.outline ?? (id === 'inside-out');
        if (outline) { path(); ctx.strokeStyle = P.ink; ctx.lineWidth = o.lw || (id === 'inside-out' ? 7 : 4); ctx.lineJoin = 'round'; ctx.stroke(); }
      }
    },
    rect(x, y, w, h, c, o) { S.fill(() => { ctx.beginPath(); ctx.rect(x, y, w, h); }, c, o); },
    round(x, y, w, h, r, c, o) { S.fill(() => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }, c, o); },
    circ(x, y, r, c, o) { S.fill(() => { ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, TAU); }, c, o); },
    oval(x, y, rx, ry, c, o, rot = 0) { S.fill(() => { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); }, c, o); },
    poly(pts, c, o) { S.fill(() => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); }, c, o); },
    stroke(pts, c, w) { line(pts, tone(c), w); },
    background(night = false) {
      if (id === 'paper-atlas') {
        fillAll(P.bg);
        for (let i = 0; i < 70; i++) { ctx.fillStyle = `rgba(120,90,50,${0.03 + rnd(i) * 0.05})`; ctx.beginPath(); ctx.ellipse(rnd(i + 3) * W, rnd(i + 9) * H, 40 + rnd(i + 5) * 160, 30 + rnd(i + 7) * 110, rnd(i) * 3, 0, TAU); ctx.fill(); }
        if (night) { ctx.fillStyle = 'rgba(47,53,80,0.86)'; ctx.fillRect(-300, -300, W + 600, H + 600); }
      } else if (id === 'stick-story') { fillAll(night ? '#2E3445' : P.bg); }
      else { fillAll(night ? '#1F2A44' : P.bg); }
    },
  };
  return S;
}

// ── environments ────────────────────────────────────────────────────────────────────────────────────────────
function skyBands(S, top, low, night) {
  S.rect(-200, -200, W + 400, HORIZON + 200, night ? '#1E2540' : top, { outline: false, shadow: 0, edge: false });
  S.rect(-200, HORIZON - 260, W + 400, 260, night ? '#283157' : low, { outline: false, shadow: 0, edge: false });
  if (night) for (let i = 0; i < 40; i++) circle(rnd(i) * W, rnd(i + 30) * (HORIZON - 300), 2 + rnd(i + 7) * 3, '#E9E4D0');
}
function groundBand(S, color, y = HORIZON) { S.rect(-200, y, W + 400, H - y + 200, color, { outline: false, shadow: 0.4 }); }

const ENV2D = {
  studio(S, t, o) { S.background(o.night); S.circ(540, 900, 520, S.P.secondary + '22', { outline: false, shadow: 0 }); groundBand(S, shade(S.P.ground, -0.05), 1380); },
  cricket(S, t, o) {
    skyBands(S, S.P.sky, S.P.horizon || '#DDEFF5', o.night);
    // stands with crowd
    S.poly([[-100, 720], [1180, 720], [1180, 980], [-100, 980]], '#7A8BA0', { outline: S.id === 'inside-out' });
    for (let i = 0; i < 90; i++) { const x = (i % 30) * 38 + (Math.floor(i / 30) % 2) * 19, y = 760 + Math.floor(i / 30) * 70 + Math.sin(t * 6 + i) * 3; circle(x, y, 13, S.tone(['#D8343F', '#3C6FB6', '#F2C230', '#F4EFE4', '#5E8C61'][i % 5])); }
    // field with mowing stripes
    S.rect(-200, 980, W + 400, H, '#5FAE4B', { outline: false });
    for (let k = 0; k < 8; k++) if (k % 2) { ctx.fillStyle = S.tone('#6BBF56'); ctx.fillRect(-200, 980 + k * 120, W + 400, 120); }
    // boundary rope
    ctx.beginPath(); ctx.ellipse(540, 2300, 1300, 1290, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.strokeStyle = S.tone('#F4EFE4'); ctx.lineWidth = 10; ctx.stroke();
    // pitch in perspective + creases
    S.poly([[470, 1010], [610, 1010], [800, 1920], [280, 1920]], '#C9A66B', { outline: S.id === 'inside-out' });
    S.stroke([[455, 1060], [625, 1060]], '#FFFFFF', 5); S.stroke([[330, 1720], [750, 1720]], '#FFFFFF', 8);
    stumps(S, 540, 1062, 0.45); stumps(S, 540, 1730, 1.1);
  },
  space(S, t, o) {
    fillAll(S.id === 'paper-atlas' ? '#2F3550' : '#0B1026');
    for (let i = 0; i < 160; i++) { const tw = 0.6 + 0.4 * Math.sin(t * 3 + i); circle(rnd(i) * W, rnd(i + 99) * H, (1 + rnd(i + 5) * 3) * tw, S.id === 'paper-atlas' ? '#E9DCBC' : '#FFFFFF'); }
  },
  launchpad(S, t, o) {
    skyBands(S, S.P.sky, S.P.horizon || '#DDEFF5', o.night); groundBand(S, '#9C8F7A', 1300);
    S.rect(160, 520, 70, 800, '#B0412E', {}); for (let y = 560; y < 1300; y += 90) S.stroke([[160, y], [230, y + 80]], '#7A2A1E', 6);
    S.rect(230, 700, 130, 26, '#B0412E', {}); S.rect(100, 1290, 880, 40, '#6E6E6E', {});
  },
  temple(S, t, o) {
    skyBands(S, o.night ? '#1E2540' : '#F6C98B', o.night ? '#283157' : '#F9DEB0', o.night); groundBand(S, '#C9A27A', 1320);
    S.rect(140, 1180, 800, 150, '#B98B5E', {}); S.rect(200, 1110, 680, 80, '#C99B6E', {});
    for (let k = 0; k < 6; k++) { const w = 420 - k * 62, y = 1110 - k * 95; S.round(540 - w / 2, y - 100, w, 104, 24, k % 2 ? '#D9A96F' : '#C8935C', {}); }
    S.oval(540, 500, 70, 30, '#E2B77F', {}); S.circ(540, 455, 22, '#E8C24A', {});
    S.stroke([[540, 440], [540, 330]], '#5A4030', 6); S.poly([[540, 330], [640, 360], [540, 392]], '#E9762B', {});
    for (const x of [260, 820]) S.rect(x - 22, 900, 44, 220, '#E3C08F', {});
  },
  lab(S, t, o) {
    S.rect(-200, -200, W + 400, 1300, S.id === 'paper-atlas' ? '#D8CBA8' : '#DCE7EA', { outline: false });
    groundBand(S, '#A9B4B8', 1300);
    S.round(120, 360, 840, 420, 18, '#2F4F4F', {});
    for (let i = 0; i < 5; i++) S.stroke([[180, 430 + i * 70], [180 + 200 + rnd(i) * 480, 430 + i * 70]], '#E8F0EC', 6);
    S.rect(80, 1150, 920, 40, '#7D8B91', {}); S.rect(120, 1190, 30, 160, '#5D6B70', {}); S.rect(930, 1190, 30, 160, '#5D6B70', {});
    beaker(S, 260, 1150, 1, '#4FD1E8', t); beaker(S, 420, 1150, 0.8, '#E57A8A', t + 1); beaker(S, 820, 1150, 1.1, '#F2C230', t + 2);
  },
  city(S, t, o) {
    skyBands(S, o.night ? '#1E2540' : S.P.sky, S.P.horizon || '#DDEFF5', o.night);
    for (let i = 0; i < 9; i++) { const x = -40 + i * 130, h = 380 + rnd(i) * 520, c = ['#7A8BA0', '#5F6F86', '#8E9AAF', '#6B7A92'][i % 4]; S.rect(x, 1240 - h, 120, h, c, {}); for (let y = 1240 - h + 30; y < 1220; y += 60) for (let k = 0; k < 3; k++) { ctx.fillStyle = o.night && rnd(i * 31 + y + k) > 0.4 ? '#F2D37A' : rgba('#FFFFFF', 0.55); ctx.fillRect(x + 14 + k * 34, y, 22, 32); } }
    groundBand(S, '#59606B', 1240); for (let x = 0; x < W; x += 160) S.rect(x, 1420, 90, 14, '#E8E3D0', { outline: false });
  },
  village(S, t, o) {
    skyBands(S, S.P.sky, S.P.horizon || '#DDEFF5', o.night);
    S.oval(250, 1120, 520, 220, '#8DBF6A', {}); S.oval(860, 1140, 520, 240, '#7AB35B', {});
    groundBand(S, '#9CC46B', 1160); for (let k = 0; k < 9; k++) S.stroke([[-50, 1220 + k * 80], [1130, 1200 + k * 84]], '#7FA852', 8);
    hut(S, 260, 1230, 1); hut(S, 780, 1180, 0.75); tree(S, 940, 1240, 1.1);
  },
  room(S, t, o) {
    S.rect(-200, -200, W + 400, 1380, o.night ? '#3A3F55' : (S.id === 'stick-story' ? '#E7DCC6' : '#EADFCB'), { outline: false });
    groundBand(S, o.night ? '#4A4036' : '#B68A5C', 1180);
    S.round(560, 380, 380, 420, 10, o.night ? '#1E2540' : '#BFE3F2', {}); S.stroke([[750, 380], [750, 800]], S.P.ink, 8); S.stroke([[560, 590], [940, 590]], S.P.ink, 8);
    S.round(100, 1000, 460, 200, 40, '#C96B5B', {}); S.round(80, 940, 90, 260, 30, '#B45B4C', {}); S.round(490, 940, 90, 260, 30, '#B45B4C', {});
  },
  palace(S, t, o) {
    skyBands(S, o.night ? '#1E2540' : '#F3CF92', o.night ? '#283157' : '#F7DDB0', o.night); groundBand(S, '#C79B66', 1300);
    S.rect(60, 760, 960, 560, '#C98E58', {});
    for (let x = 60; x < 1020; x += 80) S.rect(x, 720, 50, 50, '#C98E58', {});
    for (const x of [40, 900]) { S.rect(x, 600, 140, 720, '#B97C48', {}); S.poly([[x - 10, 600], [x + 70, 470], [x + 150, 600]], '#9E5F35', {}); }
    S.fill(() => { ctx.beginPath(); ctx.moveTo(420, 1320); ctx.lineTo(420, 1080); ctx.arc(540, 1080, 120, Math.PI, 0); ctx.lineTo(660, 1320); ctx.closePath(); }, '#3E2C1E', {});
    S.stroke([[540, 520], [540, 380]], '#5A4030', 6); S.poly([[540, 380], [660, 410], [540, 445]], '#E9762B', {});
  },
  street(S, t, o) {
    skyBands(S, S.P.sky, S.P.horizon || '#DDEFF5', o.night);
    const cols = ['#E9A15B', '#7FB3C8', '#E6C35C', '#C98BA6', '#9CC08A'];
    for (let i = 0; i < 6; i++) { const x = -60 + i * 200, h = 520 + rnd(i + 2) * 260; S.rect(x, 1260 - h, 190, h, cols[i % 5], {}); for (const yy of [1260 - h + 70, 1260 - h + 260]) S.rect(x + 40, yy, 110, 120, o.night ? '#F2D37A' : '#3E4A5A', {}); S.rect(x + 10, 1260 - h + 210, 170, 24, shade(cols[i % 5], -0.3), {}); }
    S.stroke([[-50, 520], [1130, 600]], '#2A2A33', 4); S.stroke([[-50, 560], [1130, 520]], '#2A2A33', 4);
    groundBand(S, '#9A8A76', 1260);
  },
  night(S, t, o) {
    fillAll('#0D0F16'); S.rect(-200, -200, 380, H + 400, '#171A24', { outline: false }); S.rect(900, -200, 380, H + 400, '#171A24', { outline: false });
    groundBand(S, '#1B1D26', 1300); S.stroke([[540, 200], [540, 520]], '#3A3D48', 14); S.circ(540, 540, 34, '#F1D9A6', {});
    ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = '#F1D9A6'; ctx.beginPath(); ctx.moveTo(510, 560); ctx.lineTo(240, 1460); ctx.lineTo(840, 1460); ctx.lineTo(570, 560); ctx.fill(); ctx.restore();
  },
  office(S, t, o) {
    S.rect(-200, -200, W + 400, 1260, '#D9DEE2', { outline: false }); groundBand(S, '#8C7B6B', 1240);
    for (let k = 0; k < 7; k++) S.rect(620, 300 + k * 52, 340, 30, '#C3CAD0', {});
    S.round(110, 380, 400, 300, 10, '#FFFFFF', {}); chart(S, 310, 640, 0.9, t);
    S.rect(80, 1120, 920, 40, '#6B4A34', {}); S.round(420, 900, 260, 200, 12, '#263238', {}); S.rect(530, 1100, 40, 24, '#455A64', {});
  },
  mountains(S, t, o) {
    skyBands(S, o.night ? '#1E2540' : '#9FC3DD', o.night ? '#283157' : '#DCE8F0', o.night);
    for (const [x, w, h] of [[120, 420, 520], [560, 520, 640], [960, 440, 500]]) { S.poly([[x - w / 2, 1180], [x, 1180 - h], [x + w / 2, 1180]], '#6B7584', {}); S.poly([[x - w * 0.16, 1180 - h * 0.68], [x, 1180 - h], [x + w * 0.16, 1180 - h * 0.68], [x + w * 0.05, 1180 - h * 0.6], [x - w * 0.06, 1180 - h * 0.63]], '#F4F8FB', {}); }
    groundBand(S, '#EEF3F7', 1180); S.oval(540, 1390, 430, 130, '#8DB4CB', {});
    for (let k = 0; k < 4; k++) S.stroke([[400 + k * 70, 1350 + k * 12], [470 + k * 80, 1380 + k * 10]], '#E8F2F8', 4);
    for (let k = 0; k < 9; k++) S.oval(140 + k * 100, 1520 + (k % 2) * 30, 34, 18, '#7A828E', {});
  },
  nature(S, t, o) {
    skyBands(S, S.P.sky, S.P.horizon || '#DDEFF5', o.night); S.circ(860, 330, 90, '#F6C445', {});
    S.oval(200, 1150, 560, 260, '#79B85A', {}); S.oval(900, 1180, 560, 280, '#6AAA4E', {});
    groundBand(S, '#86C060', 1200); S.poly([[420, 1200], [660, 1200], [900, 1920], [180, 1920]], '#6FB3D6', {});
    tree(S, 140, 1260, 1.2); tree(S, 980, 1300, 1);
  },
};
ENV2D.lake = ENV2D.mountains; ENV2D.himalaya = ENV2D.mountains; ENV2D.classroom = ENV2D.lab; ENV2D.market = ENV2D.street; ENV2D.bank = ENV2D.city; ENV2D.fort = ENV2D.palace; ENV2D.home = ENV2D.room; ENV2D.ocean = ENV2D.nature;

export function environment2d(S, kind, t, o = {}) { (ENV2D[kind] || ENV2D.studio)(S, t, o); }
export const ENVIRONMENTS_2D = Object.keys(ENV2D);

// ── props ───────────────────────────────────────────────────────────────────────────────────────────────────
function stumps(S, x, y, s) { for (const dx of [-1, 0, 1]) S.rect(x + dx * 16 * s - 4 * s, y - 120 * s, 8 * s, 120 * s, '#F4EFE4', { lw: 3 }); S.rect(x - 26 * s, y - 126 * s, 52 * s, 6 * s, '#E9C46A', { lw: 2 }); }
function beaker(S, x, y, s, liquid, t) { S.fill(() => { ctx.beginPath(); ctx.moveTo(x - 40 * s, y - 150 * s); ctx.lineTo(x - 40 * s, y); ctx.lineTo(x + 40 * s, y); ctx.lineTo(x + 40 * s, y - 150 * s); }, '#EAF6F8', {}); S.rect(x - 38 * s, y - 70 * s, 76 * s, 68 * s, liquid, { outline: false }); for (let i = 0; i < 3; i++) circle(x + (i - 1) * 18 * s, y - 80 * s - ((t * 60 + i * 40) % (60 * s)), 5 * s, rgba('#FFFFFF', 0.8)); }
function hut(S, x, y, s) { S.rect(x - 120 * s, y - 160 * s, 240 * s, 160 * s, '#D8B07A', {}); S.poly([[x - 160 * s, y - 150 * s], [x, y - 300 * s], [x + 160 * s, y - 150 * s]], '#A3824A', {}); S.rect(x - 30 * s, y - 100 * s, 60 * s, 100 * s, '#5A4030', {}); }
function tree(S, x, y, s) { S.rect(x - 16 * s, y - 220 * s, 32 * s, 220 * s, '#7A5232', {}); S.circ(x, y - 280 * s, 110 * s, '#4E9A3C', {}); S.circ(x - 70 * s, y - 220 * s, 70 * s, '#5BAE4A', {}); S.circ(x + 70 * s, y - 230 * s, 75 * s, '#479238', {}); }
function chart(S, x, y, s, t) { const h = [0.35, 0.55, 0.45, 0.8, 1]; h.forEach((v, i) => S.rect(x - 150 * s + i * 62 * s, y - 220 * s * v * clamp(t * 1.5 - i * 0.15), 44 * s, 220 * s * v * clamp(t * 1.5 - i * 0.15), ['#4FD1E8', '#E57A8A', '#F2C230', '#5E8C61', '#D8343F'][i], { lw: 3 })); }

const PROPS2D = {
  bat(S, x, y, s, t, o) { ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot || 0); S.round(-14 * s, -40 * s, 28 * s, 60 * s, 8 * s, '#B5372E', { lw: 3 }); S.round(-26 * s, 20 * s, 52 * s, 210 * s, 14 * s, '#E3C293', { lw: 4 }); ctx.restore(); },
  ball(S, x, y, s) { S.circ(x, y, 22 * s, '#C62828', { lw: 3 }); S.stroke([[x - 14 * s, y - 14 * s], [x + 14 * s, y + 14 * s]], '#F4EFE4', 3 * s); },
  stumps(S, x, y, s) { stumps(S, x, y, s); },
  bell(S, x, y, s, t, o) { const sw = Math.sin(t * 7) * 0.35 * (o.swing ?? 1); ctx.save(); ctx.translate(x, y); S.stroke([[0, -200 * s], [0, -60 * s]], '#6B4A34', 6 * s); ctx.rotate(sw); S.fill(() => { ctx.beginPath(); ctx.moveTo(-26 * s, -70 * s); ctx.quadraticCurveTo(-34 * s, 20 * s, -90 * s, 80 * s); ctx.lineTo(90 * s, 80 * s); ctx.quadraticCurveTo(34 * s, 20 * s, 26 * s, -70 * s); ctx.closePath(); }, '#D9A441', {}); S.circ(0, 92 * s, 16 * s, '#8E6A22', {}); ctx.restore(); if (o.ring) for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(x, y + 20 * s, (110 + k * 50 + (t * 180) % 50) * s, -0.5, 0.5); ctx.strokeStyle = rgba(S.P.accent, 0.6 - k * 0.18); ctx.lineWidth = 6 * s; ctx.stroke(); } },
  rocket(S, x, y, s, t, o) { const lift = o.launch ? Math.pow(Math.max(0, t - 0.4), 2) * 260 : 0; ctx.save(); ctx.translate(x, y - lift); S.round(-50 * s, -560 * s, 100 * s, 520 * s, 20 * s, '#F4F1EA', {}); S.poly([[-50 * s, -560 * s], [0, -720 * s], [50 * s, -560 * s]], '#D8343F', {}); S.rect(-50 * s, -360 * s, 100 * s, 30 * s, '#E9762B', { lw: 3 }); for (const d of [-1, 1]) { S.round(d * 70 * s - 22 * s, -300 * s, 44 * s, 260 * s, 14 * s, '#E8E3D8', {}); S.poly([[d * 50 * s, -120 * s], [d * 130 * s, -20 * s], [d * 50 * s, -40 * s]], '#D8343F', {}); } if (o.launch && t > 0.2) for (let k = 0; k < 5; k++) { const fl = 1 + 0.2 * Math.sin(t * 40 + k); S.oval(0, (-10 + k * 50) * s, (60 - k * 6) * s * fl, (90 + k * 30) * s, k < 2 ? '#F2C230' : '#E9762B', { outline: false }); } ctx.restore(); if (o.launch) for (let k = 0; k < 8; k++) S.circ(x + (k - 3.5) * 70 * s, y + 20 * s - rnd(k) * 40, (70 + rnd(k + 3) * 50) * s * clamp(t * 2), '#D9D4CC', { outline: false }); },
  satellite(S, x, y, s, t) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t) * 0.1); S.round(-60 * s, -60 * s, 120 * s, 120 * s, 12 * s, '#D9A441', {}); for (const d of [-1, 1]) { S.rect(d * 70 * s + (d < 0 ? -200 * s : 0), -36 * s, 200 * s, 72 * s, '#2F5D8A', {}); for (let k = 1; k < 4; k++) S.stroke([[d * 70 * s + (d < 0 ? -200 * s : 0) + k * 50 * s, -36 * s], [d * 70 * s + (d < 0 ? -200 * s : 0) + k * 50 * s, 36 * s]], '#A8C8E8', 3 * s); } S.oval(0, -90 * s, 46 * s, 16 * s, '#E8E3D8', {}); ctx.restore(); },
  earth(S, x, y, s, t) { S.circ(x, y, 220 * s, '#2F7FC1', {}); ctx.save(); ctx.beginPath(); ctx.arc(x, y, 214 * s, 0, TAU); ctx.clip(); const off = (t * 40) % 300; for (const [dx, dy, rx, ry] of [[-60, -40, 90, 60], [80, 50, 70, 100], [-120, 110, 60, 40], [140, -120, 50, 40]]) S.oval(x + (dx * s + off) % (440 * s) - 100 * s, y + dy * s, rx * s, ry * s, '#4CA65A', { outline: false, shadow: 0 }); ctx.restore(); },
  mars(S, x, y, s) { S.circ(x, y, 170 * s, '#C1532F', {}); for (const [dx, dy, r] of [[-50, -30, 26], [40, 50, 34], [60, -70, 18]]) S.circ(x + dx * s, y + dy * s, r * s, '#A3401F', { outline: false, shadow: 0 }); },
  moon(S, x, y, s) { S.circ(x, y, 120 * s, '#D9D6CF', {}); S.circ(x - 30 * s, y - 20 * s, 22 * s, '#BDB8AE', { outline: false, shadow: 0 }); },
  sun(S, x, y, s, t) { for (let k = 0; k < 12; k++) { const a = k / 12 * TAU + t * 0.3; S.stroke([[x + Math.cos(a) * 150 * s, y + Math.sin(a) * 150 * s], [x + Math.cos(a) * 210 * s, y + Math.sin(a) * 210 * s]], '#F2C230', 14 * s); } S.circ(x, y, 120 * s, '#F6C445', {}); },
  coins(S, x, y, s, t) { for (let k = 0; k < 6; k++) S.oval(x, y - k * 26 * s * clamp(t * 3 - k * 0.2 + 0.5), 80 * s, 26 * s, '#E2B53B', { lw: 3 }); },
  money(S, x, y, s) { for (let k = 0; k < 5; k++) S.round(x - 130 * s + k * 6, y - k * 30 * s, 260 * s, 110 * s, 8 * s, '#7DBA6E', { lw: 3 }); S.circ(x + 24, y - 120 * s + 55 * s, 34 * s, '#5E9A52', { lw: 3 }); },
  moneybag(S, x, y, s) { S.circ(x, y, 120 * s, '#C9A15B', {}); S.poly([[x - 50 * s, y - 100 * s], [x, y - 160 * s], [x + 50 * s, y - 100 * s]], '#B48A45', {}); },
  book(S, x, y, s) { S.round(x - 110 * s, y - 150 * s, 220 * s, 300 * s, 10 * s, '#8E3B2E', {}); S.rect(x - 90 * s, y - 150 * s, 12 * s, 300 * s, '#E9DCBC', { outline: false }); },
  scroll(S, x, y, s) { S.rect(x - 140 * s, y - 90 * s, 280 * s, 180 * s, '#EADBB5', {}); S.round(x - 160 * s, y - 110 * s, 40 * s, 220 * s, 20 * s, '#C9A66B', {}); S.round(x + 120 * s, y - 110 * s, 40 * s, 220 * s, 20 * s, '#C9A66B', {}); for (let k = 0; k < 4; k++) S.stroke([[x - 100 * s, y - 50 * s + k * 34 * s], [x + 100 * s - rnd(k) * 60 * s, y - 50 * s + k * 34 * s]], '#7A5A3A', 5 * s); },
  laptop(S, x, y, s) { S.round(x - 170 * s, y - 230 * s, 340 * s, 220 * s, 12 * s, '#37474F', {}); S.rect(x - 150 * s, y - 210 * s, 300 * s, 180 * s, '#4FD1E8', { outline: false }); S.round(x - 210 * s, y - 10 * s, 420 * s, 30 * s, 8 * s, '#90A4AE', {}); },
  phone(S, x, y, s) { S.round(x - 70 * s, y - 140 * s, 140 * s, 280 * s, 22 * s, '#263238', {}); S.round(x - 58 * s, y - 120 * s, 116 * s, 230 * s, 10 * s, '#7FB8E6', { outline: false }); },
  trophy(S, x, y, s) { S.fill(() => { ctx.beginPath(); ctx.moveTo(x - 90 * s, y - 220 * s); ctx.lineTo(x + 90 * s, y - 220 * s); ctx.quadraticCurveTo(x + 80 * s, y - 60 * s, x, y - 50 * s); ctx.quadraticCurveTo(x - 80 * s, y - 60 * s, x - 90 * s, y - 220 * s); }, '#E2B53B', {}); S.rect(x - 16 * s, y - 50 * s, 32 * s, 60 * s, '#C99A2E', {}); S.rect(x - 70 * s, y + 10 * s, 140 * s, 36 * s, '#6B4A34', {}); },
  globe(S, x, y, s, t) { PROPS2D.earth(S, x, y, s * 0.8, t); S.stroke([[x - 200 * s, y + 200 * s], [x + 200 * s, y - 200 * s]], '#6B4A34', 6 * s); },
  bulb(S, x, y, s, t) { const on = 0.6 + 0.4 * Math.sin(t * 6); S.circ(x, y, 110 * s, mix('#F2D37A', '#FFF6C9', on), {}); S.rect(x - 44 * s, y + 90 * s, 88 * s, 70 * s, '#9AA4AA', {}); },
  chart(S, x, y, s, t) { chart(S, x, y, s, t); },
  clock(S, x, y, s, t) { S.circ(x, y, 130 * s, '#F4EFE4', { lw: 6 }); S.stroke([[x, y], [x + Math.cos(t * 2 - 1.5) * 90 * s, y + Math.sin(t * 2 - 1.5) * 90 * s]], S.P.ink, 8 * s); S.stroke([[x, y], [x + Math.cos(t * 0.3) * 60 * s, y + Math.sin(t * 0.3) * 60 * s]], S.P.ink, 10 * s); },
  building(S, x, y, s) { S.rect(x - 150 * s, y - 420 * s, 300 * s, 420 * s, '#9AA6B4', {}); for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) S.rect(x - 120 * s + c * 90 * s, y - 390 * s + r * 64 * s, 60 * s, 40 * s, '#E3EDF5', { outline: false }); },
  bank(S, x, y, s) { S.rect(x - 220 * s, y - 60 * s, 440 * s, 60 * s, '#D8D2C4', {}); for (let k = 0; k < 5; k++) S.rect(x - 190 * s + k * 90 * s, y - 330 * s, 40 * s, 270 * s, '#EDE8DC', {}); S.poly([[x - 250 * s, y - 330 * s], [x, y - 460 * s], [x + 250 * s, y - 330 * s]], '#D8D2C4', {}); },
  skull(S, x, y, s) { S.circ(x, y, 90 * s, '#EFE7D6', {}); S.rect(x - 45 * s, y + 55 * s, 90 * s, 50 * s, '#EFE7D6', {}); S.circ(x - 34 * s, y - 6 * s, 24 * s, '#2B2B2B', {}); S.circ(x + 34 * s, y - 6 * s, 24 * s, '#2B2B2B', {}); },
    crown(S, x, y, s) { S.poly([[x - 120 * s, y], [x - 120 * s, y - 110 * s], [x - 60 * s, y - 50 * s], [x, y - 140 * s], [x + 60 * s, y - 50 * s], [x + 120 * s, y - 110 * s], [x + 120 * s, y]], '#E2B53B', {}); },
  flag(S, x, y, s, t) { S.stroke([[x, y], [x, y - 360 * s]], '#6B4A34', 8 * s); const wv = (k) => Math.sin(t * 5 + k) * 10 * s; for (const [i, c] of [[0, '#FF9933'], [1, '#FFFFFF'], [2, '#138808']]) S.poly([[x, y - 360 * s + i * 60 * s], [x + 240 * s, y - 360 * s + i * 60 * s + wv(1)], [x + 240 * s, y - 300 * s + i * 60 * s + wv(1)], [x, y - 300 * s + i * 60 * s]], c, { lw: 2 }); circle(x + 120 * s, y - 270 * s + wv(0.5) / 2, 18 * s); ctx.strokeStyle = '#000080'; ctx.lineWidth = 3; ctx.stroke(); },
  magnifier(S, x, y, s) { S.stroke([[x + 60 * s, y + 60 * s], [x + 160 * s, y + 160 * s]], '#6B4A34', 26 * s); S.circ(x, y, 100 * s, rgba('#DDF1F7', 0.85), { lw: 10 }); },
  question(S, x, y, s, t) { const b = 1 + 0.08 * Math.sin(t * 5); ctx.save(); ctx.translate(x, y); ctx.scale(b, b); ctx.font = `900 ${300 * s}px Inter`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 16 * s; ctx.strokeStyle = S.P.ink; ctx.strokeText('?', 0, 0); ctx.fillStyle = S.tone(S.P.accent); ctx.fillText('?', 0, 0); ctx.restore(); },
  brain(S, x, y, s) { for (const [dx, dy, r] of [[-60, -20, 90], [50, -30, 95], [-20, 40, 80], [70, 40, 70]]) S.circ(x + dx * s, y + dy * s, r * s, '#E89AAE', {}); },
  atom(S, x, y, s, t) { for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(x, y, 180 * s, 60 * s, k * Math.PI / 3 + t * 0.3, 0, TAU); ctx.strokeStyle = S.tone(S.P.secondary); ctx.lineWidth = 8 * s; ctx.stroke(); } S.circ(x, y, 34 * s, S.P.primary, {}); },
  gear(S, x, y, s, t) { ctx.save(); ctx.translate(x, y); ctx.rotate(t * 1.2); S.fill(() => { ctx.beginPath(); for (let k = 0; k < 24; k++) { const a = k / 24 * TAU, r = (k % 2 ? 130 : 160) * s; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); }, '#90A4AE', {}); S.circ(0, 0, 50 * s, S.P.bg, {}); ctx.restore(); },
  car(S, x, y, s) { S.round(x - 200 * s, y - 120 * s, 400 * s, 90 * s, 24 * s, '#D8343F', {}); S.round(x - 120 * s, y - 200 * s, 220 * s, 100 * s, 30 * s, '#C22E38', {}); S.circ(x - 120 * s, y - 30 * s, 40 * s, '#263238', {}); S.circ(x + 120 * s, y - 30 * s, 40 * s, '#263238', {}); },
  tree(S, x, y, s) { tree(S, x, y, s); },
  dna(S, x, y, s, t) { for (let k = 0; k < 14; k++) { const yy = y - 300 * s + k * 44 * s, ph = k * 0.6 + t * 2; const a = Math.sin(ph) * 90 * s; S.stroke([[x - a, yy], [x + a, yy]], '#B0BEC5', 6 * s); S.circ(x - a, yy, 14 * s, '#4FD1E8', { lw: 2 }); S.circ(x + a, yy, 14 * s, '#E57A8A', { lw: 2 }); } },
  check(S, x, y, s) { S.stroke([[x - 80 * s, y], [x - 20 * s, y + 70 * s], [x + 100 * s, y - 80 * s]], '#3A9D5D', 30 * s); },
  cross(S, x, y, s) { S.stroke([[x - 80 * s, y - 80 * s], [x + 80 * s, y + 80 * s]], S.P.danger || '#D62839', 30 * s); S.stroke([[x + 80 * s, y - 80 * s], [x - 80 * s, y + 80 * s]], S.P.danger || '#D62839', 30 * s); },
  camera(S, x, y, s) { S.round(x - 160 * s, y - 90 * s, 320 * s, 180 * s, 16 * s, '#37474F', {}); S.circ(x, y, 60 * s, '#90A4AE', {}); S.rect(x + 160 * s, y - 50 * s, 60 * s, 100 * s, '#37474F', {}); },
  film(S, x, y, s) { S.rect(x - 220 * s, y - 120 * s, 440 * s, 240 * s, '#222', {}); for (let k = 0; k < 8; k++) { S.rect(x - 200 * s + k * 55 * s, y - 108 * s, 30 * s, 22 * s, '#EEE', { outline: false }); S.rect(x - 200 * s + k * 55 * s, y + 86 * s, 30 * s, 22 * s, '#EEE', { outline: false }); } S.rect(x - 180 * s, y - 70 * s, 360 * s, 140 * s, '#7FB8E6', { outline: false }); },
  temple_bell: null,
};
PROPS2D.temple_bell = PROPS2D.bell; PROPS2D.planet_earth = PROPS2D.earth; PROPS2D.planet_mars = PROPS2D.mars; PROPS2D.rupee = PROPS2D.money; PROPS2D.dollar = PROPS2D.money;

export function prop2d(S, kind, x, y, s, t, o = {}) { const f = PROPS2D[kind]; if (f) f(S, x, y, s, t, o); }
export const PROPS_2D = Object.keys(PROPS2D);

// ── figures ─────────────────────────────────────────────────────────────────────────────────────────────────
// Pose = joint angles in radians (0 = limb hanging straight down; positive = forward/up toward the viewer's right
// for the right arm). Actions are functions of time so every figure keeps moving.
export function pose2d(action, t, k = 0) {
  const b = Math.sin(t * 4.5), s = Math.sin(t * 9);
  const P = { sL: 0.15, eL: 0.25, sR: -0.15, eR: -0.25, hL: 0.04, kL: 0, hR: -0.04, kR: 0, lean: Math.sin(t * 1.3) * 0.02, tilt: Math.sin(t * 1.1) * 0.05, bob: 0, mouth: 0.3 + 0.7 * Math.abs(Math.sin(t * 13)), mood: 'calm', look: 0 };
  switch (action) {
    case 'explain': Object.assign(P, { sR: -1.1 + b * 0.18, eR: -0.9, sL: 0.8 - b * 0.1, eL: 0.7, mood: 'happy' }); break;
    case 'point': Object.assign(P, { sR: -1.5, eR: -0.05, mood: 'determined', look: 1 }); break;
    case 'think': Object.assign(P, { sR: -2.2, eR: -2.2, sL: 0.4, eL: 1.2, tilt: 0.15, mood: 'worried', mouth: 0 }); break;
    case 'shock': Object.assign(P, { sR: -2.3, eR: -0.6, sL: 2.3, eL: 0.6, lean: -0.08, mood: 'scared', mouth: 1 }); break;
    case 'excited': case 'celebrate': Object.assign(P, { sR: -2.8 + b * 0.2, eR: -0.2, sL: 2.8 - b * 0.2, eL: 0.2, bob: Math.abs(Math.sin(t * 8)) * 26, mood: 'happy', mouth: 1 }); break;
    case 'walk': case 'run': { const sp = action === 'run' ? 11 : 6.5, a = Math.sin(t * sp) * (action === 'run' ? 0.9 : 0.55); Object.assign(P, { hL: a, hR: -a, kL: Math.max(0, -a) * 1.1, kR: Math.max(0, a) * 1.1, sL: -a * 0.9, sR: a * 0.9, eL: 0.4, eR: -0.4, bob: Math.abs(Math.sin(t * sp)) * 14, lean: action === 'run' ? 0.12 : 0.03 }); break; }
    case 'bat_swing': { const ph = (t * 1.4) % 1, sw = ph < 0.55 ? -0.4 + ph / 0.55 * 0.2 : -0.2 + Math.min(1, (ph - 0.55) / 0.15) * -2.6; Object.assign(P, { sR: sw, eR: -0.3, sL: -sw * 0.2 - 0.6, eL: -0.6, hL: 0.25, hR: -0.25, kL: 0.3, kR: 0.2, lean: 0.12, mood: 'determined', mouth: 0 }); break; }
    case 'bowl': { const ph = (t * 1.2) % 1, a = -Math.PI * 2 * Math.min(1, ph / 0.6); Object.assign(P, { sR: a, eR: 0, sL: 1.2, eL: 0.4, hL: 0.5, hR: -0.3, kR: 0.4, lean: 0.15, mood: 'determined', mouth: 0 }); break; }
    case 'ring_bell': Object.assign(P, { sR: -2.9 + Math.sin(t * 7) * 0.25, eR: -0.2, look: -1, tilt: -0.15, mood: 'calm', mouth: 0 }); break;
    case 'look_up': Object.assign(P, { tilt: -0.25, mood: 'happy', mouth: 0.2, look: -1 }); break;
    case 'wave': Object.assign(P, { sR: -2.6, eR: -0.6 + Math.sin(t * 10) * 0.5, mood: 'happy' }); break;
    case 'salute': Object.assign(P, { sR: -2.4, eR: -2.4, mood: 'determined', mouth: 0 }); break;
    case 'sad': Object.assign(P, { tilt: 0.25, lean: 0.06, mood: 'worried', mouth: 0 }); break;
    default: break;   // idle / talk
  }
  if (action === 'idle') P.mouth = 0;
  return P;
}

/**
 * one figure. o = { x, y (feet), h (height px), dir (1 | -1), colors: { skin, shirt, pants, hair, accent }, accessory,
 *                   action, t, talk, hold: 'bat' | 'ball' | null, skinOverride }
 */
export function figure2d(S, o) {
  const h = o.h || 760, dir = o.dir || 1, c = o.colors || {}, P = pose2d(o.action || 'idle', o.t || 0);
  if (!o.talk) P.mouth = P.mood === 'scared' ? 1 : 0;
  const ink = S.P.ink, stick = S.id === 'stick-story';
  const y = o.y - P.bob, hipY = y - h * 0.47, shY = y - h * 0.79, headR = stick ? h * 0.13 : h * 0.115, headY = shY - headR * 1.15;
  const U = h * 0.17, F = h * 0.16, TH = h * 0.24, SH = h * 0.23;
  const lw = stick ? h * 0.034 : h * 0.07;
  const limbCol = (part) => (stick ? ink : part === 'arm' ? (c.skin || '#E8B89A') : (c.pants || '#1F2A44'));
  const sleeve = stick ? ink : (c.shirt || '#3A7BD5');
  ctx.save(); ctx.translate(o.x, 0); ctx.scale(dir, 1); ctx.translate(0, 0); ctx.rotate(P.lean);
  const limb = (x0, y0, a1, a2, L1, L2, col, col1) => {
    const x1 = x0 + Math.sin(a1) * L1, y1 = y0 + Math.cos(a1) * L1, x2 = x1 + Math.sin(a1 + a2) * L2, y2 = y1 + Math.cos(a1 + a2) * L2;
    if (!stick && S.id !== 'paper-atlas') { line([[x0, y0], [x1, y1], [x2, y2]], ink, lw + 10); }
    line([[x0, y0], [x1, y1]], S.tone(col1 || col), lw); line([[x1, y1], [x2, y2]], S.tone(col), lw);
    return [x2, y2];
  };
  // legs
  limb(-h * 0.05, hipY, P.hL, P.kL, TH, SH, limbCol('leg'));
  limb(h * 0.05, hipY, P.hR, P.kR, TH, SH, limbCol('leg'));
  // body
  if (stick) line([[0, hipY], [0, shY]], ink, lw * 1.05);
  else {
    S.round(-h * 0.11, shY - h * 0.02, h * 0.22, hipY - shY + h * 0.05, h * 0.06, c.shirt || '#3A7BD5', {});
    if (c.accent && o.accessory !== 'none') S.rect(-h * 0.11, hipY - h * 0.03, h * 0.22, h * 0.035, c.accent, { outline: false });
  }
  // arms (back arm first)
  const handL = limb(-h * 0.1, shY + h * 0.02, P.sL, P.eL, U, F, limbCol('arm'), sleeve);
  const handR = limb(h * 0.1, shY + h * 0.02, P.sR, P.eR, U, F, limbCol('arm'), sleeve);
  if (o.hold === 'bat') PROPS2D.bat(S, handR[0], handR[1], h / 900, o.t, { rot: Math.PI - (P.sR + P.eR) });
  if (o.hold === 'ball') PROPS2D.ball(S, handR[0], handR[1], h / 900);
  // head
  ctx.save(); ctx.translate(0, headY); ctx.rotate(P.tilt);
  if (stick) { circle(0, 0, headR, ink); if (o.glow) { ctx.strokeStyle = 'rgba(255,214,140,0.5)'; ctx.lineWidth = 8; ctx.stroke(); } }
  else S.circ(0, 0, headR, c.skin || '#E8B89A', {});
  if (!stick && c.hair) S.fill(() => { ctx.beginPath(); ctx.arc(0, -headR * 0.15, headR * 1.02, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); }, c.hair, { outline: false });
  // face (eyes look toward the camera / up)
  const ey = P.look < 0 ? -headR * 0.22 : -headR * 0.05, ex = headR * 0.36;
  const eyeR = stick ? headR * 0.3 : headR * 0.13;
  for (const sx of [-1, 1]) {
    if (stick) { circle(sx * ex, ey, eyeR, '#FFFFFF'); circle(sx * ex + headR * 0.08, ey + (P.look < 0 ? -eyeR * 0.4 : 0), eyeR * 0.45, ink); }
    else { circle(sx * ex, ey, eyeR, ink); circle(sx * ex + eyeR * 0.3, ey - eyeR * 0.3, eyeR * 0.35, '#FFFFFF'); }
    if (!stick) { const br = P.mood === 'worried' ? -0.25 * sx : P.mood === 'determined' ? 0.25 * sx : 0; line([[sx * ex - headR * 0.16, ey - headR * 0.28 - br * 10], [sx * ex + headR * 0.16, ey - headR * 0.28 + br * 10]], ink, headR * 0.07); }
  }
  if (!stick) {
    const my = headR * 0.42, mo = P.mouth;
    if (mo > 0.15) ell(0, my, headR * 0.2, headR * (0.06 + 0.16 * mo), '#6B2A2A');
    else { ctx.beginPath(); ctx.arc(0, my - headR * 0.12, headR * 0.22, 0.2 * Math.PI, 0.8 * Math.PI); ctx.strokeStyle = ink; ctx.lineWidth = headR * 0.07; ctx.stroke(); }
  }
  // signature accessory keeps the character recognisable in every style
  const acc = o.accessory;
  if (acc === 'cap') { S.fill(() => { ctx.beginPath(); ctx.arc(0, -headR * 0.25, headR * 1.02, Math.PI, 0); ctx.closePath(); }, c.accent || '#1E88E5', {}); S.round(0, -headR * 0.33, headR * 1.25, headR * 0.2, headR * 0.1, c.accent2 || '#FFD54F', {}); }
  else if (acc === 'turban') { S.oval(0, -headR * 0.75, headR * 1.15, headR * 0.6, c.accent || '#E65100', {}); S.circ(0, -headR * 1.1, headR * 0.16, '#FFD700', {}); }
  else if (acc === 'bun') S.circ(0, -headR * 1.15, headR * 0.38, c.hair || '#212121', {});
  else if (acc === 'glasses') { for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(sx * ex, ey, headR * 0.24, 0, TAU); ctx.strokeStyle = stick ? '#FFFFFF' : ink; ctx.lineWidth = headR * 0.06; ctx.stroke(); } }
  else if (acc === 'headphones') { ctx.beginPath(); ctx.arc(0, 0, headR * 1.12, Math.PI * 1.1, Math.PI * 1.9); ctx.strokeStyle = stick ? '#00E5FF' : '#212121'; ctx.lineWidth = headR * 0.14; ctx.stroke(); }
  else if (acc === 'helmet') { S.circ(0, 0, headR * 1.25, rgba('#E8F4FF', 0.45), { lw: 5 }); }
  ctx.restore();
  ctx.restore();
  return { headX: o.x, headY, handR: [o.x + dir * handR[0], handR[1]] };
}
