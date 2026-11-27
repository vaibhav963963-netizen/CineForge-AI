// Set pieces (WebGL styles): purpose-built, animated 3D scenes that SHOW what a line narrates, instead of a stock
// environment picked by keyword. Four parametric worlds, each with actions:
//   cosmic  disk · accrete · impact · moon · molten · cooling · atmosphere · life · overview
//   micro   inject · antigen · antibody · tcell · memory · booster · herd · overview
//   octopus camouflage · squeeze · solve · hearts · swim · arms · overview
//   optics  sunrain · refract · reflect · disperse · rainbow · overview
// A world is built once per video (cached) and every shot of that world sets its state from (action, progress k),
// so consecutive shots share one continuous set (same planet, same octopus, same cells) — continuity by design.
import * as THREE from 'three';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const eo = (t) => 1 - Math.pow(1 - t, 3);
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.02, ...o });
const emis = (color, i = 1.5, o = {}) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.5, ...o });
function tex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function glowSprite(color, size, opacity = 1) {
  const t = tex(128, 128, (c, w) => { const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, color); g.addColorStop(0.35, color + 'AA'); g.addColorStop(1, color + '00'); c.fillStyle = g; c.fillRect(0, 0, w, w); });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size); return s;
}
function points(n, place, size, color, o = {}) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) { const [x, y, z, cc] = place(i); pos.set([x, y, z], i * 3); c.set(cc || color); col.set([c.r, c.g, c.b], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const dot = tex(32, 32, (cx, w) => { const gr = cx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, w, w); });
  return new THREE.Points(g, new THREE.PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending, opacity: o.opacity ?? 1, sizeAttenuation: true }));
}
function rock(r, seed, color) {
  const g = new THREE.IcosahedronGeometry(r, 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const v = V(p.getX(i), p.getY(i), p.getZ(i)); v.multiplyScalar(1 + (rnd(seed + i * 0.37) - 0.5) * 0.35); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return new THREE.Mesh(g, std(color, { roughness: 0.95, flatShading: true }));
}
function background(scene, top, bottom) {
  scene.background = tex(16, 512, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, top); g.addColorStop(1, bottom); c.fillStyle = g; c.fillRect(0, 0, w, h); });
}
function starfield(n = 2200) {
  return points(n, (i) => { const u = rnd(i) * 2 - 1, th = rnd(i + 0.5) * Math.PI * 2, r = 260 + rnd(i + 0.9) * 80, s = Math.sqrt(1 - u * u); return [r * s * Math.cos(th), r * u, r * s * Math.sin(th), rnd(i + 3) > 0.8 ? '#FFD9A8' : '#CFE3FF']; }, 1.6, '#fff', { opacity: 0.9 });
}

// ── planet textures (canvas, procedural) ─────────────────────────────────────────────────────────────────
// ── procedural noise: periodic value noise (seamless around the sphere) for planet surfaces ────────────
const hashP = (x, y, P) => { const xm = ((x % P) + P) % P; const q = Math.sin(xm * 127.1 + y * 311.7) * 43758.5453; return q - Math.floor(q); };
const vnP = (x, y, P) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hashP(xi, yi, P), b = hashP(xi + 1, yi, P), c = hashP(xi, yi + 1, P), d = hashP(xi + 1, yi + 1, P); return lerp(lerp(a, b, u), lerp(c, d, u), v); };
const fbmP = (u, v, oct = 5) => { let s = 0, a = 0.5; for (let o = 0; o < oct; o++) { const f = 1 << o; s += a * vnP(u * 4 * f, v * 4 * f, 4 * f); a *= 0.5; } return s; };
/** a canvas texture painted per pixel from shade(u, v) → [r, g, b] (u, v in 0..1) */
function noiseTex(w, h, shade) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const cx = c.getContext('2d'), img = cx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = shade(x / w, y / h), i = (y * w + x) * 4; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255; }
  cx.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// molten surface: dark plates separated by bright, branching cracks where the magma shows through
const lavaShade = (u, v) => {
  const n = fbmP(u, v, 5);
  const ridge1 = 1 - Math.abs(fbmP(u + 0.37, v + 0.11, 4) * 2 - 1);
  const ridge2 = 1 - Math.abs(fbmP(u * 2 + 0.81, v * 2 + 0.43, 3) * 2 - 1);
  const ridge = ridge1 * 0.7 + ridge2 * 0.3;
  const crack = clamp((ridge - 0.62) * 4.0);
  const hotCore = clamp((ridge - 0.78) * 6.0);
  const plate = 0.5 + 0.5 * (n - 0.5) * 2;
  const crustColor = [lerp(28, 48, plate), lerp(18, 28, plate), lerp(14, 22, plate)];
  const magmaColor = [lerp(230, 255, hotCore), lerp(90, 240, hotCore), lerp(10, 160, hotCore)];
  return [
    lerp(crustColor[0], magmaColor[0], crack),
    lerp(crustColor[1], magmaColor[1], crack),
    lerp(crustColor[2], magmaColor[2], crack),
  ];
};
// solidified crust: grey-brown basaltic rock with highlands, crater rims, and fine mottling
const crustShade = (u, v) => {
  const n = fbmP(u, v, 6);
  const m = fbmP(u + 0.5, v + 0.2, 4);
  const fine = fbmP(u * 3 + 0.1, v * 3 + 0.7, 3);
  const crater = Math.sin(n * 18) * 0.5 + 0.5;
  const highland = clamp((n - 0.48) * 3);
  const baseR = lerp(52, 98, highland) + m * 24 + fine * 12 + crater * 10;
  const baseG = lerp(44, 82, highland) + m * 18 + fine * 10 + crater * 8;
  const baseB = lerp(36, 68, highland) + m * 14 + fine * 8 + crater * 6;
  return [baseR, baseG, baseB];
};
function lavaTex() { return noiseTex(1024, 512, lavaShade); }
function crustTex() { return noiseTex(1024, 512, crustShade); }
function oceanTex() {   // alpha = water: grows over the crust as the planet cools
  return tex(1024, 512, (c, w, h) => {
    c.fillStyle = '#1D5C9E'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { c.fillStyle = 'rgba(0,0,0,1)'; c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.ellipse(rnd(i) * w, h * 0.18 + rnd(i + 3) * h * 0.64, 40 + rnd(i + 1) * 110, 25 + rnd(i + 2) * 60, rnd(i + 4) * 3, 0, 7); c.fill(); }
    c.globalCompositeOperation = 'source-over';
  });
}
// Earth: detailed noise-based continents with coastal shelves, mountain ranges, biomes, and polar ice
const earthShade = (u, v) => {
  const n = fbmP(u, v, 6);
  const dn = fbmP(u + 0.21, v + 0.63, 4);
  const micro = fbmP(u * 2 + 0.4, v * 2 + 0.8, 3);
  const land = clamp((n - 0.5) * 12 + 0.5);
  const shelf = clamp((n - 0.46) * 16);
  const deepSea = [16, 54, 118];
  const shallowSea = [38, 128, 168];
  const sea = [lerp(deepSea[0], shallowSea[0], shelf), lerp(deepSea[1], shallowSea[1], shelf), lerp(deepSea[2], shallowSea[2], shelf)];
  const lat = Math.abs(v - 0.5);
  const desert = clamp(1 - Math.abs(lat - 0.22) * 8) * clamp(1 - dn * 1.2);
  const green = [46 + micro * 25, 118 + dn * 40, 42 + micro * 20];
  const savannah = [162 + micro * 30, 138 + micro * 20, 72 + micro * 15];
  const mountColor = [124 + micro * 30, 102 + micro * 25, 78 + micro * 20];
  const snow = [238, 242, 248];
  const mount = clamp((dn - 0.52) * 5);
  const alpineSnow = clamp((dn - 0.68) * 7);
  let ground = [lerp(green[0], savannah[0], desert), lerp(green[1], savannah[1], desert), lerp(green[2], savannah[2], desert)];
  ground = [lerp(ground[0], mountColor[0], mount), lerp(ground[1], mountColor[1], mount), lerp(ground[2], mountColor[2], mount)];
  ground = [lerp(ground[0], snow[0], alpineSnow), lerp(ground[1], snow[1], alpineSnow), lerp(ground[2], snow[2], alpineSnow)];
  const iceRagged = fbmP(u * 2 + 0.1, v * 2 + 0.9, 3) * 0.08;
  const ice = clamp((lat + iceRagged - 0.41) * 18);
  return [
    lerp(lerp(sea[0], ground[0], land), 242, ice),
    lerp(lerp(sea[1], ground[1], land), 246, ice),
    lerp(lerp(sea[2], ground[2], land), 250, ice),
  ];
};
function earthTex() { return noiseTex(1024, 512, earthShade); }
function cloudTex() {
  return tex(1024, 512, (c, w, h) => { c.clearRect(0, 0, w, h); for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(255,255,255,${0.12 + rnd(i) * 0.25})`; c.beginPath(); c.ellipse(rnd(i + 1) * w, rnd(i + 2) * h, 20 + rnd(i + 3) * 70, 6 + rnd(i + 4) * 16, 0, 0, 7); c.fill(); } });
}

// ── worlds ───────────────────────────────────────────────────────────────────────────────────────────────
// ── cinematic camera rig (cosmic set pieces): every scene has a deliberate move, eased, with a slow drift ────────
// k = progress through the scene (0..1), t = film time. Moves: push-in, orbit, crane, tracking, low/high angles, and a
// shake that peaks at the Theia impact. Positions stay outside the bodies they frame (no clipping).
const ease01 = (x) => { const c = clamp(x); return c * c * (3 - 2 * c); };
const drift = (t, a) => [Math.sin(t * 0.7) * a, Math.cos(t * 0.53) * a * 0.6, Math.sin(t * 0.41) * a * 0.5];
const RIG_COSMIC = {
  // the cloud falls inward: the camera crane-down from a wide view into the collapsing dust
  collapse: (k, t) => { const e = ease01(k), d = drift(t, 0.25); return { pos: [lerp(-8, 4, e) + d[0], lerp(24, 13, e) + d[1], lerp(46, 31, e) + d[2]], look: [0, 0, 0] }; },
  // the disk: a slow orbit around the young Sun, descending from a high angle
  disk: (k, t) => { const e = ease01(k), a = lerp(-0.7, 0.8, e), h = lerp(18, 8, e), d = drift(t, 0.3); return { pos: [Math.sin(a) * 40 + d[0], h + d[1], Math.cos(a) * 40 + d[2]], look: [0, 0, 0] }; },
  // planetesimals: a lateral tracking shot across the growing bodies, low and steady
  accrete: (k, t) => { const e = ease01(k), d = drift(t, 0.2); return { pos: [lerp(-16, 12, e) + d[0], lerp(3, 9, e) + d[1], 26 + d[2]], look: [lerp(-4, 4, e), 0, 0] }; },
  // the cross-section: a straight-on push-in so the sinking iron reads clearly
  core: (k, t) => { const e = ease01(k), d = drift(t, 0.12); return { pos: [d[0], 1.4 + 0.8 * e + d[1], lerp(18, 14, e) + d[2]], look: [0, 0, 0] }; },
  // the molten planet: a low-angle hero orbit that rises slowly
  molten: (k, t) => { const e = ease01(k), a = lerp(0.2, 1.3, e), d = drift(t, 0.15); return { pos: [Math.sin(a) * 14 + d[0], lerp(-1.5, 2.5, e) + d[1], Math.cos(a) * 14 + d[2]], look: [0, 0, 0] }; },
  // Theia strikes: a fast push-in and a shake that peaks at the moment of impact (k ≈ 0.55)
  impact: (k, t) => { const e = ease01(k), amp = 0.4 * Math.exp(-Math.pow((k - 0.55) / 0.12, 2)), sh = [Math.sin(t * 41) * amp, Math.cos(t * 37) * amp, 0]; return { pos: [lerp(3, 0, e) + sh[0], lerp(4, 3, e) + sh[1], lerp(34, 28, e)], look: [0, 0, 0] }; },
  // the Moon forms: a crane up from the ring level to a wide view
  moon: (k, t) => { const e = ease01(k), d = drift(t, 0.2); return { pos: [d[0], lerp(14, 24, e) + d[1], lerp(38, 48, e) + d[2]], look: [0, 0, 0] }; },
  // cooling: a slow high-angle descent onto the surface
  cooling: (k, t) => { const e = ease01(k), d = drift(t, 0.2); return { pos: [lerp(-6, 6, e) + d[0], lerp(16, 6, e) + d[1], lerp(18, 13, e) + d[2]], look: [0, 0, 0] }; },
  // the atmosphere: a close orbit around the limb of the planet
  atmosphere: (k, t) => { const e = ease01(k), a = lerp(-0.5, 0.7, e), d = drift(t, 0.15); return { pos: [Math.sin(a) * 11 + d[0], 2 + d[1], Math.cos(a) * 11 + d[2]], look: [0, 0, 0] }; },
  // Earth and Moon compared: a symmetric push-in
  compare: (k, t) => { const e = ease01(k), d = drift(t, 0.1); return { pos: [d[0], 1.5 + d[1], lerp(19, 14, e) + d[2]], look: [0, 1.5, 0] }; },
  // the finished planet: a slow pull-back reveal
  life: (k, t) => { const e = ease01(k), d = drift(t, 0.25); return { pos: [lerp(2, -2, e) + d[0], 2.5 + d[1], lerp(14, 22, e) + d[2]], look: [0, 0, 0] }; },
};
RIG_COSMIC.overview = RIG_COSMIC.life;

const WORLDS = {
  cosmic(style) {
    const scene = new THREE.Scene(); background(scene, '#04060F', '#120A1E'); scene.add(starfield());
    scene.add(new THREE.AmbientLight('#3A4466', 0.5));
    const sunLight = new THREE.PointLight('#FFE7C2', 900, 0, 1.6); scene.add(sunLight);
    // young Sun
    const sun = new THREE.Group(); scene.add(sun);
    sun.add(new THREE.Mesh(new THREE.SphereGeometry(2.2, 48, 32), new THREE.MeshBasicMaterial({ color: '#FFD27A' })));
    sun.add(glowSprite('#FFB347', 14, 0.9), glowSprite('#FF7A1A', 26, 0.45));
    // protoplanetary disk: annuli rotating at Keplerian speeds (inner faster)
    const disk = new THREE.Group(); scene.add(disk); const rings = [];
    for (let a = 0; a < 14; a++) {
      const r0 = 4 + a * 2.1, n = 700;
      const p = points(n, (i) => { const th = rnd(a * 999 + i) * Math.PI * 2, r = r0 + rnd(a * 77 + i) * 2.1; const hot = clamp(1 - a / 9); return [Math.cos(th) * r, (rnd(i + a) - 0.5) * (0.25 + a * 0.05), Math.sin(th) * r, hot > 0.5 ? '#FFB46B' : hot > 0.15 ? '#C98B5E' : '#8A93B8']; }, 0.55, '#fff', { opacity: 0.85 });
      disk.add(p); rings.push({ p, w: 0.9 / Math.pow(r0 / 4, 1.5) });
    }
    disk.rotation.x = 0.32;
    // planetesimals → growing bodies
    const clumps = new THREE.Group(); scene.add(clumps); const bodies = [];
    for (let i = 0; i < 46; i++) { const m = rock(0.18 + rnd(i) * 0.35, i, i % 3 ? '#7B6656' : '#5E5048'); clumps.add(m); bodies.push({ m, a: rnd(i + 1) * Math.PI * 2, r: 7 + rnd(i + 2) * 9, y: (rnd(i + 3) - 0.5) * 1.6, tgt: i % 5 }); }
    // the planet (proto-Earth → molten → cooling → oceans → atmosphere)
    const planet = new THREE.Group(); scene.add(planet);
    const lava = lavaTex(), crust = crustTex();
    const surf = new THREE.Mesh(new THREE.SphereGeometry(4, 96, 64), new THREE.MeshStandardMaterial({ map: lava, emissiveMap: lava, emissive: '#FFFFFF', emissiveIntensity: 1.4, roughness: 0.9 }));
    planet.add(surf);
    const crustMesh = new THREE.Mesh(new THREE.SphereGeometry(4.01, 96, 64), new THREE.MeshStandardMaterial({ map: crust, transparent: true, opacity: 0, roughness: 0.95 })); planet.add(crustMesh);
    const ocean = new THREE.Mesh(new THREE.SphereGeometry(4.02, 96, 64), new THREE.MeshStandardMaterial({ map: oceanTex(), transparent: true, opacity: 0, roughness: 0.35, metalness: 0.1 })); planet.add(ocean);
    const earth = new THREE.Mesh(new THREE.SphereGeometry(4.03, 96, 64), new THREE.MeshStandardMaterial({ map: earthTex(), transparent: true, opacity: 0, roughness: 0.6 })); planet.add(earth);
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(4.12, 64, 48), new THREE.MeshStandardMaterial({ map: cloudTex(), transparent: true, opacity: 0, depthWrite: false })); planet.add(clouds);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(4.5, 64, 48), new THREE.MeshBasicMaterial({ color: '#6FB7FF', transparent: true, opacity: 0, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })); planet.add(atmo);
    const heat = glowSprite('#FF6A1A', 13, 0); planet.add(heat);
    // iron droplets sink from the molten surface to the core (molten shot); their paths are computed per frame
    const ironDirs = Array.from({ length: 180 }, (_, i) => { const u = rnd(i + 300) * 2 - 1, th = rnd(i + 301) * 6.28, q = Math.sqrt(1 - u * u); return V(q * Math.cos(th), u, q * Math.sin(th)); });
    const iron = points(180, () => [0, 0, 0, '#FFE6A0'], 0.24, '#fff', { opacity: 0 }); planet.add(iron);
    // rain falling onto the cooling crust (cooling shot)
    const rain2 = points(420, (i) => [(rnd(i) - 0.5) * 9, 6, (rnd(i + 1) - 0.5) * 9, '#BFD9F2'], 0.2, '#fff', { opacity: 0 }); scene.add(rain2);
    // collision glows where the growing bodies meet (accretion shot)
    const coll = [0, 1, 2, 3, 4].map(() => { const sp = glowSprite('#FFB347', 2.2, 0); scene.add(sp); return sp; });
    // the dust cloud that collapses into the disk: each particle moves from a wide sphere to the disk plane
    const cloudSeed = Array.from({ length: 2400 }, (_, i) => ({ r: 14 + rnd(i) * 10, rd: 4 + rnd(i + 1) * 9, th: rnd(i + 2) * 6.28, y: (rnd(i + 3) - 0.5) * 14, yd: (rnd(i + 4) - 0.5) * 0.6 }));
    const cloud = points(cloudSeed.length, (i) => [0, 0, 0, rnd(i + 5) > 0.7 ? '#FFD39A' : '#B58B6A'], 0.6, '#fff', { opacity: 0.95 }); scene.add(cloud);
    // a glowing dust nebula and a bright core, so the collapsing cloud is visible from the first frame
    const cloudGlow = glowSprite('#FF9A3D', 34, 0); cloudGlow.position.set(0, 0, -6); scene.add(cloudGlow);
    const cloudCore = glowSprite('#FFE3A8', 3.5, 0); scene.add(cloudCore);
    // iron droplets sinking through a cross-section of the Earth (core action)
    const coreSeed = Array.from({ length: 140 }, (_, i) => ({ a: rnd(i + 600) * 6.28, r: 3.4 + rnd(i + 601) * 0.6, z: (rnd(i + 602) - 0.5) * 0.3 }));
    const coreIron = points(coreSeed.length, (i) => [0, 0, 0, rnd(i) > 0.4 ? '#FFAA33' : '#FF7711'], 0.65, '#fff', { opacity: 0 }); scene.add(coreIron);
    const steam = points(500, (i) => { const u = rnd(i) * 2 - 1, th = rnd(i + 1) * 6.28, s = Math.sqrt(1 - u * u), r = 4.3 + rnd(i + 2) * 0.9; return [r * s * Math.cos(th), r * u, r * s * Math.sin(th), '#DDE6EE']; }, 0.5, '#fff', { opacity: 0, additive: false }); planet.add(steam);
    const volcanoes = []; for (let i = 0; i < 7; i++) { const s = glowSprite('#FFB02E', 1.4, 0); const u = rnd(i + 40) * 1.6 - 0.8, th = rnd(i + 41) * 6.28, q = Math.sqrt(1 - u * u); s.position.set(4.1 * q * Math.cos(th), 4.1 * u, 4.1 * q * Math.sin(th)); planet.add(s); volcanoes.push(s); }
    // impactor (Theia) and debris
    const theia = rock(2.2, 77, '#8C6F5A'); theia.material = new THREE.MeshStandardMaterial({ map: crust, roughness: 0.9, emissive: '#FF5A1A', emissiveIntensity: 0 }); scene.add(theia);
    const flash = glowSprite('#FFF1C2', 2, 0); scene.add(flash);
    const debris = points(2600, (i) => { const u = rnd(i) * 2 - 1, th = rnd(i + 1) * 6.28, s = Math.sqrt(1 - u * u); return [s * Math.cos(th), u * 0.35, s * Math.sin(th), rnd(i + 2) > 0.5 ? '#FFB46B' : '#9C8B7A']; }, 0.35, '#fff');
    const dpos = debris.geometry.attributes.position.array.slice(); scene.add(debris);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 32), std('#B9B4AA', { roughness: 1 })); scene.add(moon);
    // cutaway slices (Earth and Moon interiors): concentric layers on a disc facing the camera
    const slice = (layers) => { const g = new THREE.Group(); layers.forEach(([r, c], i) => { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 64), new THREE.MeshBasicMaterial({ color: c })); m.position.z = i * 0.01; g.add(m); }); return g; };
    const cutE = slice([[4, '#5A4636'], [3.3, '#C0612E'], [1.9, '#E8A33A'], [1.0, '#FFE08A']]), cutM = slice([[1.8, '#8E8A82'], [1.5, '#C0612E'], [0.45, '#A0532A']]);
    scene.add(cutE, cutM);
    const hide = () => { for (const o of [sun, disk, clumps, planet, theia, flash, debris, moon, cutE, cutM, rain2, iron, cloud, coreIron, cloudGlow, cloudCore]) o.visible = false; coll.forEach((c) => (c.visible = false)); };
    const setPlanet = ({ molten = 0, crustA = 0, oceanA = 0, earthA = 0, cloudA = 0, atmoA = 0, steamA = 0, heatA = 0 }) => {
      surf.material.emissiveIntensity = 0.25 + molten * 1.6; crustMesh.material.opacity = crustA; ocean.material.opacity = oceanA; earth.material.opacity = earthA;
      clouds.material.opacity = cloudA; atmo.material.opacity = atmoA * 0.35; steam.material.opacity = steamA; heat.material.opacity = heatA;
    };
    return {
      scene, actions: ['disk', 'accrete', 'impact', 'moon', 'compare', 'molten', 'cooling', 'atmosphere', 'life', 'overview'],
      set(action, k, t) {
        // a Moon shot begins with the impact that makes the debris: Theia strikes first (first 45%), then the ring gathers into the Moon
        if (action === 'moon') { if (k < 0.45) { action = 'impact'; k = k / 0.45; } else { k = (k - 0.45) / 0.55; } }
        hide(); sunLight.position.set(-40, 10, 30); sunLight.intensity = 900;
        planet.position.set(0, 0, 0); planet.scale.setScalar(1); planet.rotation.y = t * 0.12;
        const cam = { pos: V(0, 6, 26), look: V(0, 0, 0) };
        if (action === 'disk') {
          sun.visible = disk.visible = true; sun.position.set(0, 0, 0); sunLight.position.set(0, 0, 0); sunLight.intensity = 1600;
          rings.forEach((r) => (r.p.rotation.y = t * r.w));
          sun.children[1].scale.setScalar(14 + Math.sin(t * 2) * 0.6);
          const a = lerp(-0.5, 0.5, eio(k)); cam.pos.set(Math.sin(a) * 42, lerp(16, 11, eio(k)), Math.cos(a) * 42);
        } else if (action === 'collapse') {
          // the cloud contracts under its own gravity and flattens into a spinning disk; particles follow their own paths
          cloud.visible = true; const g = eio(k), cp = cloud.geometry.attributes.position.array;
          cloudGlow.visible = cloudCore.visible = true; cloudGlow.material.opacity = 0.3 + 0.25 * g; cloudCore.material.opacity = 0.2 + 0.25 * g; cloudCore.scale.setScalar(2.2 + 2.5 * g);
          cloudSeed.forEach((q, i) => { const r = lerp(q.r, q.rd, g), th = q.th + t * 0.25 * (1 + q.rd / 6), y = lerp(q.y, q.yd, g); cp[i * 3] = Math.cos(th) * r; cp[i * 3 + 1] = y; cp[i * 3 + 2] = Math.sin(th) * r; });
          cloud.geometry.attributes.position.needsUpdate = true; cloud.material.opacity = 0.85 * (1 - 0.3 * g);
          sunLight.position.set(-30, 10, 20);
          cam.pos.set(lerp(0, 3, g), lerp(20, 10, g), lerp(40, 27, g)); cam.look.set(0, 0, 0);
        } else if (action === 'core') {
          // cross-section of the molten Earth: iron droplets sink from the mantle to the centre, lighter rock stays out
          cutE.visible = coreIron.visible = true; cutE.position.set(0, 0, -0.5); cutE.scale.setScalar(1.25); cutE.children.forEach((m, j) => (m.material.opacity = 1));
          const ci = coreIron.geometry.attributes.position.array; coreIron.material.opacity = 0.95;
          coreSeed.forEach((q, i) => { const gi = clamp(k * 1.3 - i * 0.005), r = lerp(q.r, 0.35, eio(gi)), a = q.a + gi * 0.6; ci[i * 3] = Math.cos(a) * r; ci[i * 3 + 1] = Math.sin(a) * r * 1.0; ci[i * 3 + 2] = q.z + 0.35; });
          coreIron.geometry.attributes.position.needsUpdate = true;
          cam.pos.set(0, 0.6, lerp(12, 10, eio(k))); cam.look.set(0, 0, 0);
        } else if (action === 'accrete') {
          sun.visible = false; clumps.visible = true; disk.visible = false; sunLight.position.set(-30, 0, -40);   // the Sun is off-frame here: its glow sprites filled the view
          // clumps spiral toward five growing centres; the centres grow as the shot goes on
          bodies.forEach((b, i) => {
            const c = [V(-5, 0, 2), V(4, 1, -3), V(0, -1, 5), V(7, 0, 4), V(-3, 1, -6)][b.tgt], g = eio(clamp(k * 1.15 - (i % 7) * 0.03));
            const free = V(Math.cos(b.a + t * 0.2) * b.r * 0.6, b.y, Math.sin(b.a + t * 0.2) * b.r * 0.6);
            b.m.position.lerpVectors(free, c.clone().add(V(Math.cos(i) * 0.4, Math.sin(i) * 0.4, 0)), g);
            b.m.scale.setScalar(i < 5 ? lerp(1, 4.2, g) : lerp(1, 0.35, g)); b.m.rotation.set(t * 0.3 + i, t * 0.2, 0);
            if (b.m.material.emissive) { b.m.material.emissive.set('#7A3A10'); b.m.material.emissiveIntensity = 0.5 + 0.5 * g; }
          });
          const cen = [V(-5, 0, 2), V(4, 1, -3), V(0, -1, 5), V(7, 0, 4), V(-3, 1, -6)];
          coll.forEach((sp, j) => { const p = 0.5 + 0.5 * Math.sin(t * 6 + j * 1.7); sp.visible = true; sp.position.copy(cen[j]); sp.scale.setScalar(2 + p * 3); sp.material.opacity = clamp((k - 0.2) * 1.6) * (0.35 + 0.65 * p); });
          cam.pos.set(lerp(-6, 6, eio(k)), 9, 24); cam.look.set(0, 0, 0);
          planet.visible = theia.visible = flash.visible = debris.visible = true;
          setPlanet({ molten: 0.55, crustA: 0.35, heatA: 0.25 });
          const hit = 0.55, a = clamp(k / hit);
          theia.position.lerpVectors(V(-26, 6, -10), V(-5.4, 0.9, -1.2), eio(a)); theia.rotation.set(t * 0.4, t * 0.6, 0); theia.visible = k < hit + 0.08;
          theia.material.emissiveIntensity = a * 0.8;
          const after = clamp((k - hit) / (1 - hit));
          flash.position.set(-3.6, 0.6, -0.8); flash.scale.setScalar(lerp(2, 30, eo(after))); flash.material.opacity = k > hit ? (1 - after) * 1.2 : 0;
          const arr = debris.geometry.attributes.position.array, R = lerp(0, 11, eo(after));
          for (let i = 0; i < arr.length; i += 3) { arr[i] = -3.6 + dpos[i] * R * (0.4 + rnd(i) * 0.9); arr[i + 1] = 0.6 + dpos[i + 1] * R * (0.4 + rnd(i + 1)); arr[i + 2] = -0.8 + dpos[i + 2] * R * (0.4 + rnd(i + 2) * 0.9); }
          debris.geometry.attributes.position.needsUpdate = true; debris.material.opacity = k > hit ? 1 : 0;
          cam.pos.set(lerp(6, 3, eio(k)), 4, lerp(26, 21, eio(k)));
        } else if (action === 'moon') {
          planet.visible = debris.visible = moon.visible = true;
          setPlanet({ molten: 0.35, crustA: 0.6, heatA: 0.12 });
          const arr = debris.geometry.attributes.position.array, g = eio(k);
          for (let i = 0, j = 0; i < arr.length; i += 3, j++) {
            const th = (j / (arr.length / 3)) * Math.PI * 2 * 7 + t * 0.35, r = lerp(7 + rnd(j) * 4, 9.5, g), clump = g * 0.92;
            const ring = V(Math.cos(th) * r, (rnd(j + 5) - 0.5) * lerp(1.2, 0.2, g), Math.sin(th) * r);
            const mp = V(Math.cos(t * 0.35) * 9.5, 0, Math.sin(t * 0.35) * 9.5);
            const p = ring.lerp(mp.add(V((rnd(j) - 0.5) * 1.4, (rnd(j + 1) - 0.5) * 1.4, (rnd(j + 2) - 0.5) * 1.4)), clump * (rnd(j + 3) * 0.5 + 0.5));
            arr[i] = p.x; arr[i + 1] = p.y; arr[i + 2] = p.z;
          }
          debris.geometry.attributes.position.needsUpdate = true; debris.material.opacity = lerp(1, 0.35, g);
          moon.position.set(Math.cos(t * 0.35) * 9.5, 0, Math.sin(t * 0.35) * 9.5); moon.scale.setScalar(lerp(0.15, 1, g));
          cam.pos.set(0, lerp(14, 7, eio(k)), lerp(27, 23, eio(k)));
        } else if (action === 'compare') {
          cutE.visible = cutM.visible = true; const g = eio(clamp(k * 1.4));
          cutE.position.set(lerp(-3.2, -4.6, g), 1.5, 0); cutM.position.set(lerp(3.2, 4.6, g), 1.5, 0);
          cutE.scale.setScalar(0.9); cutM.scale.setScalar(1.6);
          cutE.children[1].scale.setScalar(1 + 0.05 * Math.sin(t * 4)); cutM.children[1].scale.setScalar(1 + 0.05 * Math.sin(t * 4));   // the shared mantle pulses on both
          cam.pos.set(0, 1.5, 16); cam.look.set(0, 1.5, 0);
        } else if (action === 'molten') {
          planet.visible = true; setPlanet({ molten: 1, heatA: 0.6 });
          // heavy iron sinks through the molten mantle to the core while lighter material stays near the surface
          iron.visible = true; iron.material.opacity = 0.95; const ip = iron.geometry.attributes.position.array;
          ironDirs.forEach((d, i) => { const gi = clamp(k * 1.25 - i * 0.004), r = lerp(4.05, 1.0, eio(gi)); ip[i * 3] = d.x * r; ip[i * 3 + 1] = d.y * r; ip[i * 3 + 2] = d.z * r; });
          iron.geometry.attributes.position.needsUpdate = true;
          volcanoes.forEach((v, i) => { const ph = (t * 0.7 + i * 0.37) % 1; v.material.opacity = ph < 0.4 ? Math.sin(ph / 0.4 * Math.PI) : 0; v.scale.setScalar(1 + ph * 2.5); });
          sunLight.intensity = 400;
          cam.pos.set(Math.sin(t * 0.05) * 3, 2, lerp(13, 11, eio(k)));
        } else if (action === 'cooling') {
          planet.visible = true; const g = eio(k);
          // rain falls from the steam-filled sky onto the crust once it is cool enough to hold water
          rain2.visible = g > 0.3; rain2.material.opacity = 0.7 * clamp((g - 0.3) / 0.3);
          const rp = rain2.geometry.attributes.position.array;
          for (let i = 0; i < 420; i++) { const ph = (t * 0.8 + rnd(i + 500)) % 1, x = rp[i * 3], z = rp[i * 3 + 2]; rp[i * 3 + 1] = lerp(11, 4.3, ph); rp[i * 3] = x; rp[i * 3 + 2] = z; }
          rain2.geometry.attributes.position.needsUpdate = true;
          setPlanet({ molten: lerp(0.8, 0.05, g), crustA: lerp(0.2, 1, g), oceanA: clamp((g - 0.35) / 0.65), steamA: Math.sin(g * Math.PI) * 0.8, heatA: lerp(0.4, 0, g) });
          cam.pos.set(3, 3, lerp(14, 12, g));
        } else if (action === 'atmosphere') {
          planet.visible = true; const g = eio(k);
          setPlanet({ crustA: 1, oceanA: 1, earthA: g * 0.6, cloudA: lerp(0.15, 0.9, g), atmoA: lerp(0.2, 1, g) });
          clouds.rotation.y = t * 0.03;
          cam.pos.set(-4, 2, lerp(13.5, 11.5, g));
        } else {   // life / overview: the finished blue planet and its Moon
          planet.visible = moon.visible = true; setPlanet({ crustA: 1, oceanA: 1, earthA: 1, cloudA: 0.8, atmoA: 1 });
          clouds.rotation.y = t * 0.03; moon.position.set(9, 2, -6); moon.scale.setScalar(1);
          cam.pos.set(lerp(2, -2, eio(k)), 2.5, lerp(14, 18, eio(k)));
        }
        // cinematic move for this scene (replaces the basic camera above); impact shakes, the rest drift gently
        const rig = (RIG_COSMIC[action] || RIG_COSMIC.life)(k, t);
        cam.pos.set(...rig.pos); cam.look.set(...rig.look);
        return cam;
      },
    };
  },

  micro(style) {
    const scene = new THREE.Scene(); background(scene, '#3A0E1A', '#12040A');
    scene.fog = new THREE.FogExp2('#2A0912', 0.028);
    scene.add(new THREE.AmbientLight('#FFB8C8', 0.6));
    const key = new THREE.DirectionalLight('#FFE4EC', 2.4); key.position.set(6, 10, 8); scene.add(key);
    const rim = new THREE.DirectionalLight('#7FD8FF', 1.6); rim.position.set(-8, 2, -6); scene.add(rim);
    // plasma: drifting platelets / particles
    const plasma = points(1400, (i) => [(rnd(i) - 0.5) * 60, (rnd(i + 1) - 0.5) * 40, (rnd(i + 2) - 0.5) * 50, rnd(i + 3) > 0.7 ? '#FF9AA8' : '#C2405A'], 0.45, '#fff', { opacity: 0.7 }); scene.add(plasma);
    const rbc = new THREE.Group(); scene.add(rbc);
    const rbcGeo = new THREE.TorusGeometry(1.0, 0.55, 20, 40);
    for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(rbcGeo, std('#B5223A', { roughness: 0.55 })); m.position.set((rnd(i) - 0.5) * 34, (rnd(i + 1) - 0.5) * 22, -12 - rnd(i + 2) * 18); m.rotation.set(rnd(i) * 3, rnd(i + 1) * 3, 0); rbc.add(m); }
    // virus: capsid + spike proteins
    function virus(color, spikeColor, r = 1.2) {
      const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 3), std(color, { roughness: 0.6 })));
      const sp = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), cap = new THREE.SphereGeometry(0.14, 10, 8), m = std(spikeColor);
      for (let i = 0; i < 46; i++) { const u = rnd(i) * 2 - 1, th = rnd(i + 0.3) * 6.28, s = Math.sqrt(1 - u * u), n = V(s * Math.cos(th), u, s * Math.sin(th));
        const st = new THREE.Mesh(sp, m); st.position.copy(n.clone().multiplyScalar(r + 0.22)); st.quaternion.setFromUnitVectors(V(0, 1, 0), n); g.add(st);
        const c = new THREE.Mesh(cap, m); c.position.copy(n.clone().multiplyScalar(r + 0.5)); g.add(c); }
      return g;
    }
    const pathogen = virus('#5FA84A', '#E8D24A'); scene.add(pathogen);
    const fragments = new THREE.Group(); scene.add(fragments);   // harmless antigen pieces (vaccine)
    for (let i = 0; i < 9; i++) { const f = virus('#7A8F72', '#B9AE6A', 0.45); f.children[0].material = std('#7A8F72', { transparent: true, opacity: 0.8 }); f.position.set((rnd(i) - 0.5) * 8, (rnd(i + 1) - 0.5) * 6, (rnd(i + 2) - 0.5) * 4); fragments.add(f); }
    // B cell + antibodies (Y)
    const bcell = new THREE.Group(); scene.add(bcell);
    bcell.add(new THREE.Mesh(new THREE.SphereGeometry(2.4, 48, 32), std('#7FB2FF', { roughness: 0.45, transparent: true, opacity: 0.92 })));
    bcell.add(new THREE.Mesh(new THREE.SphereGeometry(1.2, 32, 24), std('#3B5FC4', { roughness: 0.5 })));
    function antibody(color = '#F4F1FF') {
      const g = new THREE.Group(), m = emis(color, 0.5), arm = new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8);
      const stem = new THREE.Mesh(arm, m); stem.position.y = -0.35; g.add(stem);
      for (const s of [-1, 1]) { const a = new THREE.Mesh(arm, m); a.position.set(s * 0.25, 0.25, 0); a.rotation.z = -s * 0.6; g.add(a); }
      return g;
    }
    const abs = []; for (let i = 0; i < 26; i++) { const a = antibody(); scene.add(a); abs.push(a); }
    const tcell = new THREE.Group(); scene.add(tcell);
    { const body = new THREE.Mesh(new THREE.IcosahedronGeometry(2.0, 3), std('#9BE7C4', { roughness: 0.5 })); tcell.add(body);
      for (let i = 0; i < 40; i++) { const u = rnd(i + 50) * 2 - 1, th = rnd(i + 51) * 6.28, s = Math.sqrt(1 - u * u), n = V(s * Math.cos(th), u, s * Math.sin(th)); const v = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 6), std('#6ACB9F')); v.position.copy(n.clone().multiplyScalar(2.1)); v.quaternion.setFromUnitVectors(V(0, 1, 0), n); tcell.add(v); } }
    const memory = []; for (let i = 0; i < 6; i++) { const m = new THREE.Group(); m.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 32, 24), std('#B79CFF', { roughness: 0.4 }))); const halo = glowSprite('#C9B6FF', 4.2, 0.55); m.add(halo); scene.add(m); memory.push(m); }
    const syringe = new THREE.Group(); scene.add(syringe);
    { const glass = new THREE.MeshPhysicalMaterial({ color: '#DDEFFF', transparent: true, opacity: 0.45, roughness: 0.1 }); syringe.add(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 6, 32), glass));
      const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 4, 32), emis('#9FE2FF', 0.4, { transparent: true, opacity: 0.7 })); fluid.position.y = -0.8; syringe.add(fluid); syringe.userData.fluid = fluid;
      const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.5, 8), std('#C9D1D9', { metalness: 0.9, roughness: 0.2 })); needle.position.y = -4.7; syringe.add(needle);
      const plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 24), std('#5A6470')); plunger.position.y = 1.4; syringe.add(plunger); syringe.userData.plunger = plunger; }
    // herd immunity: a crowd of simple people, most protected (shield glow), a virus that cannot spread
    const crowd = new THREE.Group(); scene.add(crowd); const ppl = [];
    for (let x = 0; x < 9; x++) for (let z = 0; z < 7; z++) { const g = new THREE.Group(), prot = rnd(x * 13 + z) > 0.18; const col = prot ? '#8FD3FF' : '#E8B27A';
      g.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.7, 6, 12), std(col))); const h = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), std('#F1C9A5')); h.position.y = 0.75; g.add(h);
      if (prot) { const s = glowSprite('#6FD3FF', 1.9, 0.35); s.position.y = 0.3; g.add(s); }
      g.position.set((x - 4) * 1.5, 0, (z - 3) * 1.5); g.userData.prot = prot; crowd.add(g); ppl.push(g); }
    const hide = () => { for (const o of [pathogen, fragments, bcell, tcell, syringe, crowd, ...memory, ...abs]) o.visible = false; rbc.visible = plasma.visible = true; };
    const flow = (t) => { plasma.position.x = (t * 1.2) % 10 - 5; rbc.children.forEach((m, i) => { m.position.x = ((m.position.x + 17 + 0.04) % 34) - 17; m.rotation.x += 0.004; }); };
    const bind = (k, target, n, spread = 7) => abs.slice(0, n).forEach((a, i) => {
      a.visible = true; const u = rnd(i) * 2 - 1, th = rnd(i + 2) * 6.28, s = Math.sqrt(1 - u * u), dir = V(s * Math.cos(th), u, s * Math.sin(th));
      const from = V(-6, -1, 2).add(dir.clone().multiplyScalar(1.5)), to = target.clone().add(dir.clone().multiplyScalar(1.85)), g = eio(clamp(k * 1.4 - i * 0.02));
      a.position.lerpVectors(from.add(V(0, 0, (rnd(i + 9) - 0.5) * spread)), to, g); a.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().negate());
    });
    return {
      scene, actions: ['inject', 'antigen', 'antibody', 'tcell', 'memory', 'booster', 'herd', 'overview'],
      set(action, k, t) {
        hide(); flow(t); const cam = { pos: V(0, 1.5, 15), look: V(0, 0, 0) };
        if (action === 'inject' || action === 'booster') {
          syringe.visible = fragments.visible = true; syringe.position.set(lerp(2.5, 1.2, eio(k)), lerp(9, 5.6, eio(clamp(k * 1.6))), 0); syringe.rotation.z = 0.35;
          const push = clamp((k - 0.35) / 0.5); syringe.userData.plunger.position.y = lerp(1.4, -1.6, push); syringe.userData.fluid.scale.y = lerp(1, 0.2, push); syringe.userData.fluid.position.y = lerp(-0.8, -2.4, push);
          fragments.children.forEach((f, i) => { const g = clamp(push * 1.3 - i * 0.05); f.position.set(lerp(0.2, (rnd(i) - 0.5) * 9, eo(g)), lerp(1.2, (rnd(i + 1) - 0.5) * 6, eo(g)), (rnd(i + 2) - 0.5) * 3); f.scale.setScalar(g > 0 ? 1 : 0.001); f.rotation.y = t * 0.5 + i; });
          if (action === 'booster') memory.forEach((m, i) => { m.visible = true; const g = clamp(k * 1.3 - i * 0.08); m.position.set(-6 + (i % 3) * 2.6, -3 + Math.floor(i / 3) * 2.6, -2); m.scale.setScalar(lerp(0.4, 1, eo(g))); });
          cam.pos.set(lerp(-2, 1, eio(k)), 1, 16);
        } else if (action === 'antigen') {
          fragments.visible = bcell.visible = true; bcell.position.set(-5, -1, 0); bcell.rotation.y = t * 0.2;
          fragments.children.forEach((f, i) => { f.position.set(lerp(6, 1 + (i % 3) * 1.2, eio(clamp(k * 1.3 - i * 0.05))), (i % 3 - 1) * 1.6, ((i / 3 | 0) - 1) * 1.4); f.rotation.y = t * 0.6 + i; f.scale.setScalar(1); });
          cam.pos.set(0, 2, lerp(17, 14, eio(k)));
        } else if (action === 'antibody') {
          pathogen.visible = bcell.visible = true; pathogen.position.set(3, 0.5, 0); pathogen.rotation.set(t * 0.2, t * 0.3, 0);
          bcell.position.set(-6.5, -1.5, 1); bcell.rotation.y = t * 0.15; bind(k, pathogen.position, 22);
          pathogen.scale.setScalar(k > 0.85 ? lerp(1, 0.92, (k - 0.85) / 0.15) : 1);
          cam.pos.set(lerp(-1, 2, eio(k)), 1.5, lerp(16, 12.5, eio(k))); cam.look.set(lerp(-2, 2, eio(k)), 0, 0);
        } else if (action === 'tcell') {
          pathogen.visible = tcell.visible = bcell.visible = true; pathogen.position.set(3.5, 1, -1); pathogen.rotation.y = t * 0.3;
          tcell.position.set(lerp(-1, 0.6, eio(k)), -2.6, 0); tcell.rotation.y = t * 0.25; bcell.position.set(-5.5, 1.2, -1);
          bind(clamp(k - 0.25), pathogen.position, 10);
          cam.pos.set(0, 1, 15.5);
        } else if (action === 'memory') {
          pathogen.visible = true; pathogen.position.set(lerp(9, 3, eio(clamp(k * 1.6))), 0.5, 0); pathogen.rotation.y = t * 0.3;
          memory.forEach((m, i) => { m.visible = true; m.position.set(-6 + (i % 3) * 2.4, -2.4 + Math.floor(i / 3) * 3.2, -1); m.children[1].material.opacity = 0.35 + 0.35 * Math.sin(t * 3 + i); });
          bind(clamp((k - 0.3) / 0.7) * 1.2, pathogen.position, 26, 3);   // a second encounter: fast, many antibodies
          cam.pos.set(-1, 1, 16);
        } else if (action === 'herd') {
          crowd.visible = true; rbc.visible = plasma.visible = false; pathogen.visible = true; pathogen.scale.setScalar(0.45);
          const hop = k * 3, idx = Math.floor(hop), fr = hop - idx, path = [ppl[31], ppl[14], ppl[47], ppl[40]];
          const a = path[idx % 4].position, b = path[(idx + 1) % 4].position;
          pathogen.position.set(lerp(a.x, b.x, eio(fr)), 1.6 + Math.sin(fr * Math.PI) * 1.5, lerp(a.z, b.z, eio(fr))); pathogen.rotation.y = t;
          ppl.forEach((p, i) => { p.position.y = Math.abs(Math.sin(t * 2 + i)) * 0.05; });
          cam.pos.set(lerp(-3, 3, eio(k)), 9, 13); cam.look.set(0, 0, 0);
        } else {   // overview: the immune scene with a pathogen in the bloodstream
          pathogen.visible = bcell.visible = true; pathogen.position.set(2.5, 0.5, 0); pathogen.rotation.y = t * 0.3; bcell.position.set(-5, -1, -1);
          cam.pos.set(lerp(-2, 2, eio(k)), 1.5, 15);
        }
        return cam;
      },
    };
  },

  octopus(style) {
    const scene = new THREE.Scene(); background(scene, '#0E5577', '#04182A'); scene.fog = new THREE.FogExp2('#08344C', 0.035);
    scene.add(new THREE.HemisphereLight('#9FE3FF', '#1A2A2A', 1.2));
    const sunL = new THREE.DirectionalLight('#DFF6FF', 2.6); sunL.position.set(4, 14, 6); scene.add(sunL);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120, 60, 60), std('#C7B48A', { roughness: 1 }));
    { const p = floor.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, (rnd(i) - 0.5) * 0.35 + Math.sin(p.getX(i) * 0.3) * 0.2); floor.geometry.computeVertexNormals(); }
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const reef = new THREE.Group(); scene.add(reef);
    for (let i = 0; i < 26; i++) { const r = rock(0.6 + rnd(i) * 1.6, i + 200, ['#6E7466', '#7D6D5C', '#5D6C6A'][i % 3]); r.position.set((rnd(i + 1) - 0.5) * 40, 0.2, -6 - rnd(i + 2) * 24); reef.add(r); }
    for (let i = 0; i < 18; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.25, 2 + rnd(i) * 2, 6), std(['#E46A6A', '#F2A65A', '#B76BD6'][i % 3])); c.position.set((rnd(i + 5) - 0.5) * 30, 1, -5 - rnd(i + 6) * 20); reef.add(c); }
    const bubbles = points(500, (i) => [(rnd(i) - 0.5) * 30, rnd(i + 1) * 16, (rnd(i + 2) - 0.5) * 20, '#E8FBFF'], 0.18, '#fff', { opacity: 0.6 }); scene.add(bubbles);
    const motes = points(1200, (i) => [(rnd(i) - 0.5) * 50, rnd(i + 1) * 20, (rnd(i + 2) - 0.5) * 40, '#BFEFFF'], 0.08, '#fff', { opacity: 0.5 }); scene.add(motes);
    // the octopus: mantle + eyes + 8 tapering arms (tube geometry rebuilt each frame from an animated curve)
    const oct = new THREE.Group(); scene.add(oct);
    const skinCanvas = document.createElement('canvas'); skinCanvas.width = skinCanvas.height = 256; const skinTex = new THREE.CanvasTexture(skinCanvas); skinTex.colorSpace = THREE.SRGBColorSpace;
    const skin = new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.55, transparent: true, opacity: 1 });
    const paintSkin = (camo, flash = 0) => {   // camo 0 = red-orange, 1 = matches the mottled rock
      const c = skinCanvas.getContext('2d'), base = new THREE.Color('#D2552E').lerp(new THREE.Color('#6E7466'), camo).lerp(new THREE.Color('#FFFFFF'), flash * 0.3);
      c.fillStyle = '#' + base.getHexString(); c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 160; i++) { const s = new THREE.Color('#A8371C').lerp(new THREE.Color(i % 2 ? '#4E5648' : '#8A7C66'), camo); c.fillStyle = `#${s.getHexString()}`; c.globalAlpha = 0.35 + camo * 0.35; c.beginPath(); c.arc(rnd(i) * 256, rnd(i + 1) * 256, 3 + rnd(i + 2) * (6 + camo * 12), 0, 7); c.fill(); }
      c.globalAlpha = 1; skinTex.needsUpdate = true;
    };
    paintSkin(0);
    const mantle = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), skin); mantle.scale.set(1.1, 1.45, 1.05); mantle.position.set(0, 1.9, -0.2); oct.add(mantle);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.85, 40, 28), skin); head.position.set(0, 0.9, 0.35); oct.add(head);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), std('#F3E9C8')); e.position.set(s * 0.52, 1.1, 0.95); oct.add(e); const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), std('#111')); p.position.set(s * 0.52, 1.1, 1.13); oct.add(p); }
    const arms = []; for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.BufferGeometry(), skin); oct.add(m); arms.push(m); }
    const armCurve = (i, t, mode, k) => {
      const a0 = (i / 8) * Math.PI * 2 + 0.2, pts = [];
      for (let s = 0; s <= 10; s++) {
        const u = s / 10, wave = Math.sin(t * 2.2 + i * 0.8 - u * 4) * 0.35 * u;
        let r = 0.5 + u * 2.6, y = 0.55 - u * 0.45 + Math.max(0, u - 0.4) * 0.05, a = a0 + wave;
        if (mode === 'squeeze') { r = 0.4 + u * 2.4; a = Math.PI * 0.5 + (i - 3.5) * 0.06 + wave * 0.3; y = 0.4; }
        if (mode === 'solve' && i < 3) { const tgt = V(2.1, 1.2 + i * 0.35, 0.4); const st = V(Math.cos(a0) * 0.5, 0.6, Math.sin(a0) * 0.5); const p = st.lerp(tgt, u); p.y += Math.sin(u * Math.PI) * 0.6 + Math.sin(t * 3 + i) * 0.05 * u; pts.push(p); continue; }
        if (mode === 'swim') { r = 0.4 + u * 2.9; y = 0.6 + u * 2.3 * (0.7 + 0.3 * Math.sin(t * 3)); a = a0 * 0.25 + Math.PI * 1.5 + (i - 3.5) * 0.07; }
        pts.push(V(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      return new THREE.CatmullRomCurve3(pts);
    };
    const buildArms = (t, mode, k) => arms.forEach((m, i) => {
      const g = new THREE.TubeGeometry(armCurve(i, t, mode, k), 40, 0.22, 10, false), p = g.attributes.position, n = g.attributes.normal;
      for (let v = 0; v < p.count; v++) { const seg = Math.floor(v / 11) / 40, sh = lerp(1, 0.18, seg), cx = 0; // taper toward the tip
        const ring = Math.floor(v / 11), center = g.parameters.path.getPointAt(Math.min(1, ring / 40));
        p.setXYZ(v, center.x + (p.getX(v) - center.x) * sh, center.y + (p.getY(v) - center.y) * sh, center.z + (p.getZ(v) - center.z) * sh); }
      g.computeVertexNormals(); m.geometry.dispose(); m.geometry = g;
    });
    // camouflage rock, narrow gap (two slabs), jar with lid, hearts cutaway
    const camoRock = rock(2.6, 999, '#6E7466'); camoRock.position.set(0, 1.0, -2.2); scene.add(camoRock);
    const slabs = new THREE.Group(); scene.add(slabs);
    for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 3), std('#5E625A', { roughness: 1, flatShading: true })); b.position.set(s * 2.18, 2.5, -1); slabs.add(b); }
    const jar = new THREE.Group(); scene.add(jar);
    jar.add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.9, 40, 1, true), new THREE.MeshPhysicalMaterial({ color: '#DDF3FF', transparent: true, opacity: 0.35, roughness: 0.05, side: THREE.DoubleSide })));
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.25, 40), std('#C9A227', { metalness: 0.6, roughness: 0.3 })); lid.position.y = 1.05; jar.add(lid);
    const crab = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 14), std('#D64A2A')); crab.scale.set(1.3, 0.6, 1); crab.position.y = -0.6; jar.add(crab);
    const hearts = new THREE.Group(); oct.add(hearts);
    const heartGeo = new THREE.SphereGeometry(0.28, 24, 16);
    const hs = [[-0.55, 1.7, 0.2, '#2F7BFF'], [0.55, 1.7, 0.2, '#2F7BFF'], [0, 2.1, -0.1, '#5AA0FF']].map(([x, y, z, c]) => { const h = new THREE.Mesh(heartGeo, emis(c, 1.2)); h.position.set(x, y, z); hearts.add(h); return h; });
    const gills = [-1, 1].map((s) => { const g = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), std('#E8A0A0')); g.scale.set(0.6, 1.4, 0.5); g.position.set(s * 0.95, 1.65, 0.1); hearts.add(g); return g; });
    const blood = points(260, (i) => [0, 0, 0, '#4F9BFF'], 0.12, '#fff'); hearts.add(blood);
    const neurons = points(900, (i) => [0, 0, 0, '#FFE08A'], 0.14, '#fff'); oct.add(neurons);
    const hide = () => { for (const o of [camoRock, slabs, jar]) o.visible = false; hearts.visible = neurons.visible = false; skin.opacity = 1; };
    return {
      scene, actions: ['camouflage', 'squeeze', 'solve', 'hearts', 'swim', 'arms', 'overview'],
      set(action, k, t) {
        hide(); bubbles.position.y = (t * 0.6) % 4; motes.rotation.y = t * 0.01;
        oct.position.set(0, 0, 0); oct.rotation.set(0, 0, 0); oct.scale.set(1, 1, 1);
        const cam = { pos: V(0, 3, 10), look: V(0, 1.4, 0) };
        let mode = 'rest';
        if (action === 'camouflage') {
          camoRock.visible = true; oct.position.set(0, 2.9, -1.4); oct.rotation.x = -0.2;
          const g = eio(clamp((k - 0.15) / 0.7)); paintSkin(g); mantle.scale.set(1.1, lerp(1.45, 1.2, g), 1.05);
          cam.pos.set(lerp(1.5, -1, eio(k)), 4.6, lerp(9, 7.5, eio(k))); cam.look.set(0, 2.6, -1.4);
        } else if (action === 'squeeze') {
          slabs.visible = true; mode = 'squeeze'; paintSkin(0.15);
          const g = eio(k), thin = Math.sin(clamp((k - 0.2) / 0.6) * Math.PI);
          oct.position.set(0, 0.2, lerp(3.5, -4.5, g)); oct.rotation.y = Math.PI; oct.scale.set(lerp(1, 0.32, thin), 1, 1);
          cam.pos.set(5.5, 4, 6); cam.look.set(0, 1.4, lerp(2, -2.5, g));
        } else if (action === 'solve') {
          jar.visible = true; mode = 'solve'; paintSkin(0.1); jar.position.set(2.1, 1.0, 0.4);
          const g = clamp((k - 0.25) / 0.6); lid.rotation.y = g * Math.PI * 4; lid.position.y = 1.05 + Math.max(0, g - 0.75) * 4;
          crab.position.y = -0.6 + Math.sin(t * 6) * 0.03;
          cam.pos.set(lerp(1.5, 2.5, eio(k)), 2.8, 6.8); cam.look.set(1.1, 1.2, 0.2);
        } else if (action === 'hearts') {
          hearts.visible = true; skin.opacity = 0.32; paintSkin(0.05);
          hs.forEach((h, i) => h.scale.setScalar(1 + 0.22 * Math.max(0, Math.sin(t * 6 + (i < 2 ? 0 : 1.6)))));
          const arr = blood.geometry.attributes.position.array;
          for (let j = 0; j < arr.length / 3; j++) { const u = ((t * 0.35 + j / 260) % 1), side = j % 3; const from = side < 2 ? hs[side].position : hs[2].position, to = side < 2 ? gills[side].position : V(Math.cos(j) * 1.8, 0.4, Math.sin(j) * 1.8); arr[j * 3] = lerp(from.x, to.x, u); arr[j * 3 + 1] = lerp(from.y, to.y, u) + Math.sin(u * 3.14) * 0.2; arr[j * 3 + 2] = lerp(from.z, to.z, u) + 0.35; }
          blood.geometry.attributes.position.needsUpdate = true;
          cam.pos.set(lerp(-1.2, 1.2, eio(k)), 2.3, lerp(6.2, 5.2, eio(k))); cam.look.set(0, 1.8, 0);
        } else if (action === 'swim') {
          mode = 'swim'; paintSkin(0.1); const g = eio(k);
          oct.position.set(lerp(-6, 6, g), 3 + Math.sin(t * 3) * 0.3, -1); oct.rotation.z = -Math.PI / 2; oct.rotation.y = Math.PI / 2;
          cam.pos.set(0, 3.6, 11); cam.look.set(lerp(-3, 3, g), 3, -1);
        } else if (action === 'arms') {
          neurons.visible = true; paintSkin(0.05); skin.opacity = 0.6;
          const arr = neurons.geometry.attributes.position.array;
          for (let j = 0; j < arr.length / 3; j++) { const i = j % 8, u = ((j / 8) % 112) / 112, c = armCurve(i, t, 'rest', k).getPointAt(u); arr[j * 3] = c.x; arr[j * 3 + 1] = c.y + 0.15; arr[j * 3 + 2] = c.z; }
          neurons.geometry.attributes.position.needsUpdate = true; neurons.material.opacity = 0.55 + 0.45 * Math.sin(t * 5);
          cam.pos.set(Math.sin(t * 0.1) * 2, 5.5, 6.5); cam.look.set(0, 0.6, 0);
        } else {
          paintSkin(0.1); cam.pos.set(lerp(-2, 2, eio(k)), 2.6, lerp(9, 7.5, eio(k)));
        }
        buildArms(t, mode, k);
        return cam;
      },
    };
  },

  optics(style) {
    const scene = new THREE.Scene(); background(scene, '#4E6E8E', '#B9C9D6');
    scene.add(new THREE.HemisphereLight('#E9F2FF', '#4B5A45', 1.3));
    const sunL = new THREE.DirectionalLight('#FFF2D6', 2.8); sunL.position.set(-10, 8, 12); scene.add(sunL);
    const land = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), std('#5C7F4A', { roughness: 1 })); land.rotation.x = -Math.PI / 2; land.position.y = -6; scene.add(land);
    const hills = new THREE.Group(); scene.add(hills); for (let i = 0; i < 9; i++) { const h = new THREE.Mesh(new THREE.SphereGeometry(18 + rnd(i) * 14, 24, 16), std('#4E7140', { roughness: 1 })); h.position.set((i - 4) * 26, -20, -90 - rnd(i + 1) * 30); hills.add(h); }
    const rain = points(2600, (i) => [(rnd(i) - 0.5) * 120, rnd(i + 1) * 60 - 6, -40 - rnd(i + 2) * 60, '#D8E6F2'], 0.25, '#fff', { opacity: 0.55 }); scene.add(rain);
    const COLORS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5', '#3949AB', '#8E24AA'];
    const bow = new THREE.Group(); scene.add(bow);
    COLORS.forEach((c, i) => { const m = new THREE.Mesh(new THREE.TorusGeometry(52 - i * 1.4, 0.7, 8, 120, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false })); m.position.set(0, -6, -110); bow.add(m); });
    // the droplet close-up: a glass sphere with a light ray traced through it
    const drop = new THREE.Group(); scene.add(drop);
    drop.add(new THREE.Mesh(new THREE.SphereGeometry(3, 64, 48), new THREE.MeshPhysicalMaterial({ color: '#CFE9FF', transparent: true, opacity: 0.28, roughness: 0.02, metalness: 0, clearcoat: 1 })));
    drop.add(new THREE.Mesh(new THREE.SphereGeometry(3.02, 64, 48), new THREE.MeshBasicMaterial({ color: '#E8F6FF', wireframe: false, transparent: true, opacity: 0.06, side: THREE.BackSide })));
    const beam = (color, w = 0.08) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(w, w, 1, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })); drop.add(m); return m; };
    const place = (m, a, b, f = 1) => { const d = b.clone().sub(a), L = d.length() * f; m.scale.set(1, Math.max(0.0001, L), 1); m.position.copy(a.clone().add(d.clone().multiplyScalar(f / 2))); m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize()); m.visible = L > 0.001; };
    const white = beam('#FFFFFF', 0.12), inside = beam('#FFFFFF', 0.1), back = beam('#FFFFFF', 0.1);
    const out = COLORS.map((c) => beam(c, 0.07));
    const P0 = V(-9, 1.6, 0), P1 = V(-2.55, 1.6, 0), P2 = V(2.2, -2.04, 0), P3 = V(-1.2, -2.75, 0);
    const exits = COLORS.map((_, i) => V(-9, -5.5 - i * 0.55, 0));
    const sunDisc = glowSprite('#FFF4D0', 10, 1); scene.add(sunDisc);
    const hide = () => { for (const o of [white, inside, back, ...out]) o.visible = false; bow.children.forEach((m) => (m.material.opacity = 0)); drop.visible = false; rain.visible = true; };
    return {
      scene, actions: ['sunrain', 'refract', 'reflect', 'disperse', 'rainbow', 'overview'],
      set(action, k, t) {
        hide(); const arr = rain.geometry.attributes.position.array; for (let i = 1; i < arr.length; i += 3) { arr[i] -= 0.9; if (arr[i] < -6) arr[i] += 60; } rain.geometry.attributes.position.needsUpdate = true;
        const cam = { pos: V(0, 2, 40), look: V(0, 4, -100) };
        sunDisc.position.set(-60, 40, 80); sunDisc.visible = false;
        if (['refract', 'reflect', 'disperse'].includes(action)) {
          drop.visible = true; drop.position.set(0, 0, 0); rain.visible = false; scene.background.offset && 0;
          const g = eio(k);
          if (action === 'refract') { place(white, P0, P1, 1); place(inside, P1, P2, clamp(g * 1.4)); }
          if (action === 'reflect') { place(white, P0, P1, 1); place(inside, P1, P2, 1); place(back, P2, P3, clamp(g * 1.4)); }
          if (action === 'disperse') { place(white, P0, P1, 1); place(inside, P1, P2, 1); place(back, P2, P3, 1); out.forEach((m, i) => place(m, P3, exits[i], clamp(g * 1.3 - i * 0.03))); }
          drop.rotation.y = Math.sin(t * 0.3) * 0.08;
          cam.pos.set(lerp(-1, 1, g), 0.5, lerp(17, 14.5, g)); cam.look.set(-1.5, -0.6, 0);
        } else if (action === 'rainbow' || action === 'overview') {
          bow.children.forEach((m) => (m.material.opacity = 0.75 * eo(clamp(k * 1.5))));
          cam.pos.set(0, lerp(0, 3, eio(k)), lerp(30, 40, eio(k))); cam.look.set(0, 10, -100);
        } else {   // sunrain: sunlight from behind the viewer meets falling rain
          sunDisc.visible = true; cam.pos.set(lerp(-10, 0, eio(k)), 4, 30); cam.look.set(0, 6, -60);
        }
        return cam;
      },
    };
  },
};

export const SETPIECE_WORLDS_3D = Object.keys(WORLDS);
const cache = new Map();
/** the world's scene + a camera target for (action, progress k in 0..1, film time t) */
export function setpiece3d(world, style) {
  if (!cache.has(world)) cache.set(world, WORLDS[world](style));
  return cache.get(world);
}
