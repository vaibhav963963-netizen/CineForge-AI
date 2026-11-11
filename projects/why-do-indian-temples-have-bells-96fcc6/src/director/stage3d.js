// 3D stage for the WebGL styles (tall-tale, deep-dive, night-file): topic environments, props, the registered 3D
// characters (character3d.js archetypes) with physical actions, style lighting and camera language.
// Each environment is built once (cached) and shared by every shot that uses it; per-shot props/extras live in a
// group that is only visible while that shot renders.
import * as THREE from 'three';
import { createCharacter3D } from '../core/character3d.js';
import { createEnvironment3D } from '../core/environments3d.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02, ...o });
const glow = (color, i = 1.6) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.4 });
function mesh(geo, m, parent, [x, y, z] = [0, 0, 0], shadow = true) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; if (parent) parent.add(o); return o;
}
const box = (w, h, d, m, p, pos) => mesh(new THREE.BoxGeometry(w, h, d), m, p, pos);
const cyl = (rt, rb, h, m, p, pos, seg = 16) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m, p, pos);
const sph = (r, m, p, pos, seg = 24) => mesh(new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75)), m, p, pos);

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function skyDome(scene, top, bottom) {
  const tex = canvasTexture(8, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, top); gr.addColorStop(0.55, bottom); gr.addColorStop(1, bottom); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const s = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
  scene.add(s); return s;
}
function stars(scene, n = 1800, r = 250) {
  const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const u = rnd(i) * 2 - 1, a = rnd(i + 7) * Math.PI * 2, s = Math.sqrt(1 - u * u); p.set([r * s * Math.cos(a), r * u, r * s * Math.sin(a)], i * 3); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#FFFFFF', size: 0.9, sizeAttenuation: true, fog: false })));
}

// ── lighting per style ──────────────────────────────────────────────────────────────────────────────────────
function rig(scene, style, { target = [0, 1, 0], indoor = false, space = false } = {}) {
  const L = style.lighting, night = style.id === 'night-file';
  scene.add(new THREE.HemisphereLight(L.sky || '#FFFFFF', L.ground || '#555555', space ? 0.12 : (L.hemiI ?? 0.9)));
  let key;
  if (night) {
    key = new THREE.SpotLight(L.key, 160, 60, 0.7, 0.6, 1.2); key.position.set(target[0] + 1.5, target[1] + 7, target[2] + 3);
    // dim cool moonlight: keeps the one-light noir look but lets the set's shapes read (subjects must stay visible)
    const moon = new THREE.DirectionalLight('#8FA6C8', 0.9); moon.position.set(target[0] - 6, target[1] + 10, target[2] + 8); scene.add(moon);
  } else {
    key = new THREE.DirectionalLight(L.key, (L.keyI ?? 3) * (space ? 1.2 : 1)); key.position.set(target[0] + 6, target[1] + (indoor ? 8 : 12), target[2] + 7);
  }
  key.target.position.set(...target); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  if (key.shadow.camera.isOrthographicCamera) Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 0.5, far: 60 });
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(L.rim || '#BFD8FF', L.rimI ?? 2); rim.position.set(target[0] - 5, target[1] + 4, target[2] - 6); scene.add(rim);
  if (style.id === 'deep-dive') { const fill = new THREE.PointLight('#4FD1E8', 18, 14); fill.position.set(target[0] - 2, target[1] + 2, target[2] + 3); scene.add(fill); }
  return { key, rim };
}
function atmosphere(scene, style, sky) {
  const P = style.palette, L = style.lighting;
  if (style.id === 'night-file') { scene.background = new THREE.Color('#0B0E16'); scene.fog = new THREE.FogExp2('#0B0E16', 0.022); return; }
  if (style.id === 'deep-dive') { scene.background = new THREE.Color(P.bg); scene.fog = new THREE.FogExp2(P.bg, 0.028); skyDome(scene, '#0B1620', '#1F3B4A'); return; }
  scene.fog = new THREE.Fog(L.fog || '#D0E3F0', 30, 140);
  skyDome(scene, sky?.[0] || P.sky || '#3D8EE0', sky?.[1] || P.horizon || '#BFE4F7');
}
/** night-file: every surface falls toward black so only the single light reads */
function nightify(root) { root.traverse((o) => { if (o.isMesh && o.material && o.material.color && !o.userData.keepColor) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.6); } }); }

// ── environments ────────────────────────────────────────────────────────────────────────────────────────────
// each returns { scene, anchors: { lead, focus, ... }, update(t) }
const ENV3D = {
  cricket(style) {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); atmosphere(scene, style);
    const field = mesh(new THREE.CircleGeometry(42, 64), mat('#4FA03E'), g); field.rotation.x = -Math.PI / 2;
    for (let k = -5; k <= 5; k += 2) { const st = mesh(new THREE.PlaneGeometry(84, 3.6), mat('#5BB049'), g, [0, 0.005, k * 3.6], false); st.rotation.x = -Math.PI / 2; }
    const pitch = box(3, 0.04, 22, mat('#C9A66B'), g, [0, 0.02, 0]);
    for (const z of [-9.2, 9.2]) { box(3, 0.045, 0.06, mat('#FFFFFF'), g, [0, 0.03, z]); for (const x of [-0.11, 0, 0.11]) cyl(0.022, 0.022, 0.72, mat('#F4EFE4'), g, [x, 0.36, z + Math.sign(z) * 0.95]); box(0.26, 0.03, 0.03, mat('#E9C46A'), g, [0, 0.73, z + Math.sign(z) * 0.95]); }
    const rope = mesh(new THREE.TorusGeometry(36, 0.08, 6, 96), mat('#F4EFE4'), g, [0, 0.08, 0]); rope.rotation.x = Math.PI / 2;
    const crowdCols = ['#D8343F', '#3C6FB6', '#F2C230', '#F4EFE4', '#5E8C61', '#FF9933'];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2, r = 47, tier = new THREE.Group(); tier.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); tier.lookAt(0, 0, 0); g.add(tier);
      box(4.8, 2.4, 3, mat('#8A97A8'), tier, [0, 1.2, 0]); box(4.8, 2.4, 3, mat('#7A8798'), tier, [0, 3.0, -2.6]);
      for (let k = 0; k < 6; k++) sph(0.32, mat(crowdCols[(i + k) % 6]), tier, [-2 + k * 0.8, 2.75 + (k % 2) * 1.8, -0.4 - (k % 2) * 2.6], 8);
    }
    box(6, 4, 0.3, mat('#F4F4F4'), g, [0, 2, -40]);
    rig(scene, style, { target: [0, 1, 4] });
    return { scene, root: g, anchors: { lead: [0.35, 0, 8.4], leadFacing: Math.PI, bowler: [0.6, 0, -6], focus: [0, 1.1, 8.4], wide: [0, 1, 0] } };
  },
  temple(style) {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); atmosphere(scene, style, ['#F0A35E', '#F9DEB0']);
    const ground = mesh(new THREE.PlaneGeometry(80, 80), mat('#C9A27A'), g); ground.rotation.x = -Math.PI / 2;
    const stone = mat('#D7A46B'), stone2 = mat('#C68E55');
    box(10, 1, 9, stone2, g, [0, 0.5, -4]); for (let s = 0; s < 3; s++) box(4, 0.3, 0.6, stone, g, [0, 0.15 + s * 0.3, 0.6 - s * 0.55]);
    box(7, 3.2, 6, stone, g, [0, 2.6, -4.5]);
    for (let k = 0; k < 7; k++) { const r = 3.0 - k * 0.38; cyl(r * 0.92, r, 1.05, k % 2 ? stone : stone2, g, [0, 4.7 + k * 1.0, -5], 8); }
    const amalaka = mesh(new THREE.TorusGeometry(0.62, 0.28, 10, 18), mat('#E2B77F'), g, [0, 11.9, -5]); amalaka.rotation.x = Math.PI / 2;
    sph(0.32, mat('#E8C24A', { metalness: 0.6, roughness: 0.3 }), g, [0, 12.5, -5]);
    for (const x of [-3, -1.2, 1.2, 3]) cyl(0.24, 0.28, 3, mat('#E3C08F'), g, [x, 2.5, -1.1], 10);
    box(7.4, 0.4, 1.4, stone2, g, [0, 4.1, -1.1]);
    // the bell hangs from the porch beam and can swing
    // hung low enough that a raised hand reaches the clapper (bell mouth ≈ 2.1 m), as at a real temple entrance
    const bellPivot = new THREE.Group(); bellPivot.position.set(0, 3.5, -0.9); g.add(bellPivot);
    cyl(0.02, 0.02, 0.8, mat('#6B4A34'), bellPivot, [0, -0.4, 0], 6);
    const bellMat = mat('#D9A441', { metalness: 0.85, roughness: 0.28 });
    const bell = mesh(new THREE.LatheGeometry([[0, 0], [0.16, -0.02], [0.2, -0.18], [0.26, -0.42], [0.36, -0.58], [0.38, -0.62], [0, -0.62]].map(([x, y]) => new THREE.Vector2(x, y)), 24), bellMat, bellPivot, [0, -0.78, 0]);
    sph(0.06, mat('#8E6A22'), bellPivot, [0, -1.42, 0], 8);
    for (let k = 0; k < 8; k++) { const d = sph(0.06, glow('#FFB347', 2.5), g, [-3.4 + k, 1.06, 0.9], 8); d.userData.keepColor = true; }
    rig(scene, style, { target: [0, 2, -1] });
    return { scene, root: g, anchors: { lead: [0.9, 0, 1.6], leadFacing: Math.PI * 0.85, focus: [0, 2.2, -0.9], bell: bellPivot, wide: [0, 4, -3] }, bell: bellPivot };
  },
  space(style) {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); scene.background = new THREE.Color('#02030A'); stars(scene);
    const earthTex = canvasTexture(512, 256, (c, w, h) => { c.fillStyle = '#1F5FA8'; c.fillRect(0, 0, w, h); c.fillStyle = '#3E9B4F'; for (let i = 0; i < 26; i++) { c.beginPath(); c.ellipse(rnd(i) * w, h * 0.2 + rnd(i + 3) * h * 0.6, 20 + rnd(i + 5) * 50, 12 + rnd(i + 8) * 30, rnd(i) * 3, 0, 7); c.fill(); } c.fillStyle = 'rgba(255,255,255,0.55)'; for (let i = 0; i < 40; i++) { c.beginPath(); c.ellipse(rnd(i + 50) * w, rnd(i + 70) * h, 24 + rnd(i) * 40, 4 + rnd(i + 2) * 6, 0, 0, 7); c.fill(); } });
    const marsTex = canvasTexture(512, 256, (c, w, h) => { c.fillStyle = '#B5502C'; c.fillRect(0, 0, w, h); for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(${90 + rnd(i) * 60},${30 + rnd(i + 1) * 20},${20},${0.3 + rnd(i + 2) * 0.4})`; c.beginPath(); c.arc(rnd(i + 9) * w, rnd(i + 19) * h, 3 + rnd(i + 4) * 16, 0, 7); c.fill(); } });
    const earth = sph(4, new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.7 }), g, [-7, -1, -12], 48); earth.userData.keepColor = true;
    const mars = sph(2.6, new THREE.MeshStandardMaterial({ map: marsTex, roughness: 0.9 }), g, [9, 2.5, -30], 48); mars.userData.keepColor = true;
    for (const [r, y] of [[13, 0], [26, 0]]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 4, 160), new THREE.MeshBasicMaterial({ color: '#4FD1E8', transparent: true, opacity: 0.5 })); ring.rotation.x = Math.PI / 2; ring.position.set(-4, -3, -16); g.add(ring); }
    const sun = new THREE.PointLight('#FFF2D6', 400, 0, 1.2); sun.position.set(-30, 10, 20); scene.add(sun, new THREE.AmbientLight('#334', 0.4));
    const rim = new THREE.DirectionalLight(style.lighting.rim || '#4FD1E8', 1.4); rim.position.set(5, 3, -10); scene.add(rim);
    return { scene, root: g, anchors: { lead: [1.2, -1.2, 2], leadFacing: -0.3, focus: [0, 0, 0], earth, mars, wide: [0, 0, -12] }, update(t) { earth.rotation.y = t * 0.15; mars.rotation.y = t * 0.1; } };
  },
  launchpad(style) {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); atmosphere(scene, style, ['#5B8FD8', '#F4D9B0']);
    const ground = mesh(new THREE.PlaneGeometry(120, 120), mat('#9C8F7A'), g); ground.rotation.x = -Math.PI / 2;
    box(10, 0.6, 10, mat('#6E6E6E'), g, [0, 0.3, -6]);
    const tower = mat('#B0412E'); for (const [x, z] of [[-3.2, -4.2], [-3.2, -7.8], [-6, -4.2], [-6, -7.8]]) box(0.25, 22, 0.25, tower, g, [x, 11, z]);
    for (let y = 2; y < 22; y += 2.2) { box(3.0, 0.15, 0.15, tower, g, [-4.6, y, -4.2]); box(3.0, 0.15, 0.15, tower, g, [-4.6, y, -7.8]); }
    box(2.2, 0.3, 0.6, tower, g, [-2.2, 15, -6]);
    for (let k = 0; k < 6; k++) cyl(0.25, 0.25, 0.4, mat('#F4E4C1'), g, [8 + k * 0.8, 0.2, 2], 8);
    rig(scene, style, { target: [0, 6, -6] });
    return { scene, root: g, anchors: { lead: [4, 0, 4], leadFacing: -0.9, focus: [0, 8, -6], rocket: [0, 0.6, -6], wide: [0, 8, -6] } };
  },
  lab(style) {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); scene.background = new THREE.Color(style.id === 'night-file' ? '#05060A' : '#CFE0E6');
    const floor = mesh(new THREE.PlaneGeometry(20, 20), mat('#9AA6AA'), g); floor.rotation.x = -Math.PI / 2;
    box(20, 8, 0.2, mat('#DCE7EA'), g, [0, 4, -5]); box(0.2, 8, 20, mat('#D2DEE2'), g, [-6, 4, 0]);
    box(5, 2.6, 0.08, mat('#2F4F4F'), g, [0, 3.6, -4.85]);
    box(4.4, 0.12, 1.4, mat('#7D8B91'), g, [1, 1.0, -2.2]); for (const x of [-1, 3]) box(0.12, 1, 1.2, mat('#5D6B70'), g, [x, 0.5, -2.2]);
    const glass = new THREE.MeshPhysicalMaterial({ color: '#EAF6F8', transmission: 0.6, roughness: 0.1, transparent: true, opacity: 0.55 });
    const liquids = ['#4FD1E8', '#E57A8A', '#F2C230'];
    liquids.forEach((c, k) => { cyl(0.16, 0.16, 0.5, glass, g, [-0.2 + k * 0.6, 1.31, -2.2]); cyl(0.14, 0.14, 0.25, glow(c, 0.6), g, [-0.2 + k * 0.6, 1.19, -2.2]).userData.keepColor = true; });
    const mol = new THREE.Group(); mol.position.set(2.6, 1.9, -2.2); g.add(mol);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; sph(0.12, mat(k % 2 ? '#E57A8A' : '#4FD1E8'), mol, [Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0], 12); }
    rig(scene, style, { target: [0, 1.5, -2], indoor: true });
    return { scene, root: g, anchors: { lead: [-1.4, 0, -0.6], leadFacing: 0.4, focus: [0.5, 1.4, -2.2], wide: [0, 2, -2] }, update(t) { mol.rotation.y = t * 0.8; mol.rotation.x = t * 0.3; } };
  },
  city(style) {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); atmosphere(scene, style);
    const ground = mesh(new THREE.PlaneGeometry(140, 140), mat('#59606B'), g); ground.rotation.x = -Math.PI / 2;
    const winTex = canvasTexture(64, 128, (c, w, h) => { c.fillStyle = '#5F6F86'; c.fillRect(0, 0, w, h); for (let y = 6; y < h; y += 14) for (let x = 6; x < w; x += 16) { c.fillStyle = rnd(x * 7 + y) > 0.5 ? '#F2D37A' : '#A9C1D9'; c.fillRect(x, y, 9, 8); } });
    for (let i = 0; i < 26; i++) { const x = (i % 13 - 6) * 5.2, z = -16 - Math.floor(i / 13) * 9 - rnd(i) * 3, h = 6 + rnd(i + 4) * 22; const m = new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.6 }); mesh(new THREE.BoxGeometry(4.2, h, 4.2), m, g, [x, h / 2, z]).userData.keepColor = true; }
    // bank building (columns + pediment)
    const bank = new THREE.Group(); bank.position.set(0, 0, -6); g.add(bank);
    box(9, 0.6, 4, mat('#D8D2C4'), bank, [0, 0.3, 0]); for (let k = 0; k < 6; k++) cyl(0.28, 0.32, 4.2, mat('#EDE8DC'), bank, [-3.6 + k * 1.44, 2.7, 1.2], 12);
    box(9.4, 0.7, 4.4, mat('#D8D2C4'), bank, [0, 5.15, 0]); const ped = mesh(new THREE.CylinderGeometry(0.01, 5.4, 1.6, 3), mat('#D8D2C4'), bank, [0, 6.3, 0.2]); ped.rotation.y = Math.PI / 2; ped.scale.z = 0.5;
    box(8, 4.4, 3.4, mat('#C7C0B0'), bank, [0, 2.8, -0.4]);
    rig(scene, style, { target: [0, 2, -4] });
    return { scene, root: g, anchors: { lead: [2.2, 0, 1.5], leadFacing: -0.5, focus: [0, 2.6, -5], wide: [0, 4, -8] } };
  },
  village(style) {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); atmosphere(scene, style);
    const ground = mesh(new THREE.PlaneGeometry(140, 140), mat('#8FBF5E'), g); ground.rotation.x = -Math.PI / 2;
    for (let k = 0; k < 14; k++) box(30, 0.25, 0.5, mat(k % 2 ? '#6E9E43' : '#9CC46B'), g, [12, 0.12, -6 - k * 1.1]);
    const hut = (x, z, s) => { const h = new THREE.Group(); h.position.set(x, 0, z); h.scale.setScalar(s); g.add(h); cyl(1.6, 1.6, 2, mat('#D8B07A'), h, [0, 1, 0], 14); mesh(new THREE.ConeGeometry(2.2, 1.8, 14), mat('#A3824A'), h, [0, 2.9, 0]); box(0.7, 1.2, 0.1, mat('#5A4030'), h, [0, 0.6, 1.58]); };
    hut(-4, -5, 1); hut(-9, -9, 0.8);
    const tree = (x, z, s) => { cyl(0.2 * s, 0.28 * s, 2.6 * s, mat('#7A5232'), g, [x, 1.3 * s, z]); sph(1.5 * s, mat('#4E9A3C'), g, [x, 3.4 * s, z], 14); };
    tree(4, -4, 1.2); tree(-14, -14, 1.5); tree(16, -18, 1.3);
    cyl(0.9, 0.9, 0.9, mat('#9E9A90'), g, [2, 0.45, -1], 16);
    rig(scene, style, { target: [0, 1.5, -3] });
    return { scene, root: g, anchors: { lead: [0.4, 0, 1], leadFacing: 0, focus: [0, 1.3, 0], wide: [0, 2, -5] } };
  },
  room(style) {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); scene.background = new THREE.Color('#2B2520');
    const floor = mesh(new THREE.PlaneGeometry(14, 14), mat('#A87A50'), g); floor.rotation.x = -Math.PI / 2;
    box(14, 6, 0.2, mat('#E7D8BE'), g, [0, 3, -4]); box(0.2, 6, 14, mat('#DCCBAE'), g, [-5, 3, 0]);
    box(2.6, 2, 0.05, glow('#BFE3F2', 0.6), g, [1.8, 3.4, -3.88]).userData.keepColor = true;
    box(3, 0.6, 1.1, mat('#C96B5B'), g, [-1.6, 0.6, -2.8]); box(3, 0.9, 0.3, mat('#B45B4C'), g, [-1.6, 1.2, -3.3]);
    cyl(0.05, 0.05, 1.6, mat('#333'), g, [1.4, 0.8, -3]); mesh(new THREE.ConeGeometry(0.4, 0.45, 16, 1, true), glow('#FFE3A3', 0.9), g, [1.4, 1.75, -3]).userData.keepColor = true;
    rig(scene, style, { target: [0, 1.4, -2], indoor: true });
    return { scene, root: g, anchors: { lead: [0, 0, -0.6], leadFacing: 0, focus: [0, 1.3, -1], wide: [0, 1.6, -2] } };
  },
  night(style) {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); scene.background = new THREE.Color('#0B0E16'); scene.fog = new THREE.FogExp2('#0B0E16', 0.035);
    const ground = mesh(new THREE.PlaneGeometry(40, 40), mat('#1B1D26'), g); ground.rotation.x = -Math.PI / 2;
    box(0.4, 7, 30, mat('#171A24'), g, [-3, 3.5, -6]); box(0.4, 7, 30, mat('#171A24'), g, [3, 3.5, -6]);
    cyl(0.06, 0.08, 5, mat('#3A3D48'), g, [1.6, 2.5, -2]); sph(0.18, glow('#F1D9A6', 3), g, [1.2, 4.9, -2], 12).userData.keepColor = true;
    const cone = mesh(new THREE.ConeGeometry(2.4, 4.8, 32, 1, true), new THREE.MeshBasicMaterial({ color: '#F1D9A6', transparent: true, opacity: 0.08, depthWrite: false }), g, [1.2, 2.5, -2], false); cone.userData.keepColor = true;
    const spot = new THREE.SpotLight('#F1D9A6', 90, 14, 0.5, 0.5, 1.3); spot.position.set(1.2, 4.9, -2); spot.target.position.set(0.4, 0, -1.4); spot.castShadow = true; scene.add(spot, spot.target);
    const rim = new THREE.DirectionalLight('#E4322B', 1.6); rim.position.set(-3, 2, -6); scene.add(rim, new THREE.HemisphereLight('#1A2030', '#000000', 0.15));
    return { scene, root: g, anchors: { lead: [0.4, 0, -1.4], leadFacing: 0.2, focus: [0.3, 1.3, -1.6], wide: [0, 2, -6] } };
  },
  office(style) {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); scene.background = new THREE.Color('#C9D2D8');
    const floor = mesh(new THREE.PlaneGeometry(16, 16), mat('#8C7B6B'), g); floor.rotation.x = -Math.PI / 2;
    box(16, 6, 0.2, mat('#D9DEE2'), g, [0, 3, -4]);
    box(3.2, 0.1, 1.4, mat('#6B4A34'), g, [0.8, 1.0, -2.2]); for (const x of [-0.6, 2.2]) box(0.1, 1, 1.2, mat('#4E3626'), g, [x, 0.5, -2.2]);
    box(1.2, 0.75, 0.06, glow('#4FD1E8', 0.5), g, [0.8, 1.55, -2.6]).userData.keepColor = true;
    const board = new THREE.Group(); board.position.set(-2.4, 2.4, -3.85); g.add(board); box(2.6, 1.8, 0.05, mat('#FFFFFF'), board);
    [0.35, 0.55, 0.45, 0.8, 1].forEach((v, k) => box(0.3, 1.4 * v, 0.06, mat(['#4FD1E8', '#E57A8A', '#F2C230', '#5E8C61', '#D8343F'][k]), board, [-0.9 + k * 0.45, -0.75 + 0.7 * v, 0.05]));
    rig(scene, style, { target: [0, 1.5, -2], indoor: true });
    return { scene, root: g, anchors: { lead: [-0.6, 0, -0.6], leadFacing: 0.3, focus: [0, 1.4, -2], wide: [0, 1.8, -2] } };
  },
  mountains(style) {
    // snowfield, snow-capped peaks and a frozen glacial lake ringed by rocks (Himalayan settings)
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); atmosphere(scene, style, ['#2E4A6B', '#A9C1D6']);
    const snow = mesh(new THREE.PlaneGeometry(220, 220), mat('#DCE6EE', { roughness: 0.9 }), g); snow.rotation.x = -Math.PI / 2;
    const lake = mesh(new THREE.CircleGeometry(9, 56), mat('#8DB4CB', { roughness: 0.12, metalness: 0.15 }), g, [0, 0.02, -9], false); lake.rotation.x = -Math.PI / 2; lake.scale.set(1.5, 1, 1);
    for (let i = 0; i < 9; i++) { const c = box(2 + rnd(i) * 4, 0.01, 0.03, mat('#E8F2F8'), g, [-6 + rnd(i + 3) * 12, 0.035, -14 + rnd(i + 7) * 10]); c.rotation.y = rnd(i + 11) * 3; }
    // close enough to stay inside every style's fog range (night-file fog would swallow distant peaks)
    for (const [x, z, h, r] of [[-15, -25, 15, 8], [2, -31, 21, 11], [17, -26, 14, 7.5], [-28, -36, 18, 10], [30, -38, 17, 9]]) {
      mesh(new THREE.ConeGeometry(r, h, 7), mat('#5B6470', { roughness: 0.95 }), g, [x, h / 2, z]);
      mesh(new THREE.ConeGeometry(r * 0.46, h * 0.46, 7), mat('#F4F8FB'), g, [x, h * 0.77, z]);
    }
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rk = sph(0.35 + rnd(i) * 0.6, mat('#6B7280'), g, [Math.cos(a) * 13.8, 0.15, -9 + Math.sin(a) * 9.6], 8); rk.scale.y = 0.55; }
    rig(scene, style, { target: [0, 1, -6] });
    return { scene, root: g, anchors: { lead: [2.6, 0, 3.2], leadFacing: -0.3, focus: [0, 1, -7], wide: [0, 3, -9] } };
  },
  nature(style) {
    const scene = new THREE.Scene(), g = new THREE.Group(); scene.add(g); atmosphere(scene, style);
    const ground = mesh(new THREE.PlaneGeometry(160, 160), mat('#86C060'), g); ground.rotation.x = -Math.PI / 2;
    for (const [x, z, s] of [[-20, -40, 14], [10, -50, 18], [35, -36, 12]]) { const h = sph(s, mat('#6AAA4E'), g, [x, -s * 0.55, z], 20); h.scale.y = 0.6; }
    const river = mesh(new THREE.PlaneGeometry(5, 120), mat('#6FB3D6', { roughness: 0.2, metalness: 0.1 }), g, [6, 0.02, -20]); river.rotation.x = -Math.PI / 2;
    for (const [x, z, s] of [[-4, -6, 1.3], [-8, -12, 1.6], [12, -10, 1.2]]) { cyl(0.22 * s, 0.3 * s, 2.6 * s, mat('#7A5232'), g, [x, 1.3 * s, z]); sph(1.6 * s, mat('#4E9A3C'), g, [x, 3.4 * s, z], 14); }
    rig(scene, style, { target: [0, 1.5, -2] });
    return { scene, root: g, anchors: { lead: [0, 0, 0], leadFacing: 0, focus: [0, 1.3, 0], wide: [0, 3, -10] } };
  },
};
for (const k of ['street', 'palace', 'studio']) {
  ENV3D[k] = (style) => {
    const scene = new THREE.Scene(), g = createEnvironment3D(k); scene.add(g); atmosphere(scene, style);
    rig(scene, style, { target: [0, 1.2, 0], indoor: k === 'studio' });
    if (k === 'studio') scene.background = new THREE.Color(style.id === 'tall-tale' ? '#1B2433' : style.palette.bg);
    return { scene, root: g, anchors: { camScale: 1.6, lead: [0, 0, 0], leadFacing: 0, focus: [0, 1.3, 0], wide: [0, 1.5, -2] } };
  };
}
ENV3D.classroom = ENV3D.lab; ENV3D.market = ENV3D.street; ENV3D.bank = ENV3D.city; ENV3D.fort = ENV3D.palace; ENV3D.home = ENV3D.room; ENV3D.ocean = ENV3D.nature; ENV3D.lake = ENV3D.mountains; ENV3D.himalaya = ENV3D.mountains;
export const ENVIRONMENTS_3D = Object.keys(ENV3D);

// ── props ───────────────────────────────────────────────────────────────────────────────────────────────────
const PROP3D = {
  bat() { const g = new THREE.Group(); cyl(0.022, 0.022, 0.3, mat('#B5372E'), g, [0, 0.15, 0], 8); const b = box(0.11, 0.55, 0.04, mat('#E3C293'), g, [0, -0.27, 0]); b.geometry.translate(0, 0, 0); return g; },
  ball() { return sph(0.036, mat('#B71C1C', { roughness: 0.4 }), null, [0, 0, 0], 16); },
  stumps() { const g = new THREE.Group(); for (const x of [-0.11, 0, 0.11]) cyl(0.022, 0.022, 0.72, mat('#F4EFE4'), g, [x, 0.36, 0], 8); box(0.26, 0.03, 0.03, mat('#E9C46A'), g, [0, 0.73, 0]); return g; },
  rocket() {
    const g = new THREE.Group(), white = mat('#F4F1EA'), red = mat('#C62828');
    cyl(0.55, 0.55, 9, white, g, [0, 4.5, 0], 24); mesh(new THREE.ConeGeometry(0.55, 1.6, 24), red, g, [0, 9.8, 0]); cyl(0.56, 0.56, 0.4, mat('#E9762B'), g, [0, 6.2, 0], 24);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; cyl(0.2, 0.2, 3.2, mat('#E8E3D8'), g, [Math.cos(a) * 0.75, 1.8, Math.sin(a) * 0.75], 12); mesh(new THREE.ConeGeometry(0.2, 0.5, 12), red, g, [Math.cos(a) * 0.75, 3.65, Math.sin(a) * 0.75]); }
    const flame = mesh(new THREE.ConeGeometry(0.6, 2.6, 16), glow('#FFB347', 3), g, [0, -1.3, 0], false); flame.rotation.x = Math.PI; flame.userData.keepColor = true; flame.visible = false; g.userData.flame = flame;
    const smoke = new THREE.Group(); g.add(smoke); for (let k = 0; k < 10; k++) sph(0.8, mat('#D9D4CC', { transparent: true, opacity: 0.85 }), smoke, [Math.cos(k) * 1.6, 0.4, Math.sin(k) * 1.6], 10); smoke.visible = false; g.userData.smoke = smoke;
    return g;
  },
  satellite() { const g = new THREE.Group(); box(0.8, 0.8, 0.8, mat('#D9A441', { metalness: 0.7, roughness: 0.3 }), g); for (const d of [-1, 1]) box(1.8, 0.04, 0.6, mat('#2F5D8A', { metalness: 0.4 }), g, [d * 1.35, 0, 0]); const dish = mesh(new THREE.SphereGeometry(0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#E8E3D8'), g, [0, 0.55, 0]); dish.rotation.x = Math.PI; return g; },
  earth() { return sph(0.6, mat('#2F7FC1'), null); },
  mars() { return sph(0.45, mat('#C1532F'), null); },
  coins() { const g = new THREE.Group(); for (let k = 0; k < 8; k++) cyl(0.16, 0.16, 0.04, mat('#C9971C', { metalness: 0.35, roughness: 0.45 }), g, [rnd(k) * 0.03, 0.02 + k * 0.045, 0], 20); return g; },
  money() { const g = new THREE.Group(); for (let k = 0; k < 6; k++) box(0.42, 0.06, 0.2, mat('#7DBA6E'), g, [0, 0.03 + k * 0.065, 0]); return g; },
  moneybag() { const g = new THREE.Group(); sph(0.35, mat('#C9A15B'), g, [0, 0.33, 0], 16); mesh(new THREE.ConeGeometry(0.16, 0.25, 12), mat('#B48A45'), g, [0, 0.72, 0]); return g; },
  book() { return box(0.32, 0.06, 0.44, mat('#8E3B2E'), null); },
  scroll() { const g = new THREE.Group(); const s = cyl(0.06, 0.06, 0.6, mat('#EADBB5'), g, [0, 0, 0], 12); s.rotation.z = Math.PI / 2; return g; },
  laptop() { const g = new THREE.Group(); box(0.5, 0.02, 0.34, mat('#90A4AE'), g); const sc = box(0.5, 0.32, 0.02, glow('#4FD1E8', 0.5), g, [0, 0.16, -0.16]); sc.userData.keepColor = true; return g; },
  phone() { const g = new THREE.Group(); box(0.09, 0.18, 0.012, mat('#263238'), g); box(0.08, 0.16, 0.002, glow('#7FB8E6', 0.8), g, [0, 0, 0.007]).userData.keepColor = true; return g; },
  trophy() { const g = new THREE.Group(); const gold = mat('#E2B53B', { metalness: 0.85, roughness: 0.25 }); cyl(0.22, 0.08, 0.35, gold, g, [0, 0.45, 0], 20); cyl(0.04, 0.04, 0.2, gold, g, [0, 0.2, 0]); box(0.3, 0.1, 0.3, mat('#6B4A34'), g, [0, 0.05, 0]); return g; },
  globe() { const g = new THREE.Group(); sph(0.3, mat('#2F7FC1'), g, [0, 0.55, 0]); cyl(0.02, 0.02, 0.3, mat('#6B4A34'), g, [0, 0.15, 0]); return g; },
  bulb() { const g = new THREE.Group(); sph(0.25, glow('#FFE38A', 2), g, [0, 0.3, 0]).userData.keepColor = true; cyl(0.1, 0.1, 0.15, mat('#9AA4AA'), g, [0, 0.03, 0]); return g; },
  clock() { const g = new THREE.Group(); const f = cyl(0.4, 0.4, 0.06, mat('#F4EFE4'), g, [0, 0, 0], 32); f.rotation.x = Math.PI / 2; const hand = box(0.03, 0.3, 0.02, mat('#222'), g, [0, 0.13, 0.04]); g.userData.hand = hand; return g; },
  skull() { const g = new THREE.Group(); sph(0.2, mat('#EFE7D6'), g, [0, 0.25, 0], 16); box(0.2, 0.14, 0.18, mat('#EFE7D6'), g, [0, 0.02, 0]); for (const x of [-0.08, 0.08]) sph(0.05, mat('#2B2B2B'), g, [x, 0.28, 0.17], 8); return g; },
    crown() { const g = new THREE.Group(); cyl(0.22, 0.2, 0.18, mat('#E2B53B', { metalness: 0.9, roughness: 0.2 }), g, [0, 0.09, 0], 8); return g; },
  flag() { const g = new THREE.Group(); cyl(0.025, 0.025, 2.4, mat('#6B4A34'), g, [0, 1.2, 0], 8); const tex = canvasTexture(96, 64, (c) => { c.fillStyle = '#FF9933'; c.fillRect(0, 0, 96, 22); c.fillStyle = '#FFFFFF'; c.fillRect(0, 21, 96, 22); c.fillStyle = '#138808'; c.fillRect(0, 42, 96, 22); c.strokeStyle = '#000080'; c.lineWidth = 2; c.beginPath(); c.arc(48, 32, 8, 0, 7); c.stroke(); }); const cloth = mesh(new THREE.PlaneGeometry(1.2, 0.8, 12, 4), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }), g, [0.6, 2.0, 0]); cloth.userData.keepColor = true; g.userData.cloth = cloth; return g; },
  magnifier() { const g = new THREE.Group(); const r = mesh(new THREE.TorusGeometry(0.18, 0.025, 8, 24), mat('#6B4A34'), g); cyl(0.025, 0.025, 0.3, mat('#6B4A34'), g, [0, -0.33, 0], 8); return g; },
  brain() { const g = new THREE.Group(); for (const [x, y, z, r] of [[-0.15, 0, 0, 0.26], [0.15, 0, 0, 0.26], [0, 0.1, -0.1, 0.24], [0, -0.05, 0.12, 0.2]]) sph(r, glow('#E89AAE', 0.3), g, [x, y, z], 16); return g; },
  atom() { const g = new THREE.Group(); sph(0.12, glow('#4FD1E8', 1.5), g); for (let k = 0; k < 3; k++) { const ring = mesh(new THREE.TorusGeometry(0.5, 0.012, 6, 48), glow('#E57A8A', 1), g); ring.rotation.set(k * 1.05, k * 0.6, 0); } return g; },
  gear() { const g = new THREE.Group(); const c = cyl(0.4, 0.4, 0.12, mat('#90A4AE', { metalness: 0.7 }), g, [0, 0, 0], 24); c.rotation.x = Math.PI / 2; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; box(0.12, 0.14, 0.12, mat('#90A4AE', { metalness: 0.7 }), g, [Math.cos(a) * 0.46, Math.sin(a) * 0.46, 0]).rotation.z = a; } return g; },
  car() { const g = new THREE.Group(); box(1.8, 0.45, 0.9, mat('#D8343F'), g, [0, 0.45, 0]); box(1.0, 0.4, 0.82, mat('#C22E38'), g, [-0.1, 0.85, 0]); for (const [x, z] of [[-0.6, 0.45], [0.6, 0.45], [-0.6, -0.45], [0.6, -0.45]]) { const w = cyl(0.2, 0.2, 0.12, mat('#263238'), g, [x, 0.2, z], 16); w.rotation.x = Math.PI / 2; } return g; },
  tree() { const g = new THREE.Group(); cyl(0.2, 0.28, 2.6, mat('#7A5232'), g, [0, 1.3, 0]); sph(1.4, mat('#4E9A3C'), g, [0, 3.3, 0], 14); return g; },
  dna() { const g = new THREE.Group(); for (let k = 0; k < 16; k++) { const a = k * 0.55, y = k * 0.12; sph(0.05, glow('#4FD1E8', 1), g, [Math.cos(a) * 0.25, y, Math.sin(a) * 0.25], 8); sph(0.05, glow('#E57A8A', 1), g, [-Math.cos(a) * 0.25, y, -Math.sin(a) * 0.25], 8); } return g; },
  building() { const g = new THREE.Group(); box(2, 6, 2, mat('#9AA6B4'), g, [0, 3, 0]); return g; },
  bell() { const g = new THREE.Group(); mesh(new THREE.LatheGeometry([[0, 0], [0.12, -0.02], [0.16, -0.16], [0.26, -0.4], [0.28, -0.44], [0, -0.44]].map(([x, y]) => new THREE.Vector2(x, y)), 20), mat('#D9A441', { metalness: 0.85, roughness: 0.28 }), g, [0, 0.44, 0]); return g; },
  camera() { const g = new THREE.Group(); box(0.4, 0.26, 0.2, mat('#37474F'), g); const l = cyl(0.09, 0.09, 0.16, mat('#90A4AE'), g, [0, 0, 0.16], 16); l.rotation.x = Math.PI / 2; return g; },
};
PROP3D.temple_bell = PROP3D.bell; PROP3D.planet_earth = PROP3D.earth; PROP3D.planet_mars = PROP3D.mars; PROP3D.rupee = PROP3D.money; PROP3D.dollar = PROP3D.money; PROP3D.bank = PROP3D.building; PROP3D.chart = PROP3D.money;
export const PROPS_3D = Object.keys(PROP3D);
export function makeProp3D(kind) { const f = PROP3D[kind]; return f ? f() : null; }

// ── actors & actions ────────────────────────────────────────────────────────────────────────────────────────
const talkAmt = (t) => 0.3 + 0.7 * Math.abs(Math.sin(t * 14));
export function makeActor(spec, style) {
  // spec: { archetype, colors? } — extras are generic recoloured people, never a different registered character
  const cfg = spec.generic
    ? { archetype: 'desi_hero', shirt: spec.colors?.shirt || '#5C6BC0', vest: null, pants: spec.colors?.pants || '#37474F', trim: spec.colors?.trim || '#ECEFF1', hairColor: '#222', accessories: [] }
    : { archetype: spec.archetype };
  const a = createCharacter3D(cfg);
  if (style.id === 'night-file' && spec.generic) a.root.traverse((o) => { if (o.isMesh) { o.material = new THREE.MeshStandardMaterial({ color: '#0C0C0E', roughness: 0.9 }); } });
  return a;
}
/** pose an actor for an action at time t (lt = time in shot, d = shot length) */
export function act(a, action, t, lt, d, o = {}) {
  const talking = o.talk ?? true;
  switch (action) {
    case 'walk': a.setWalk(t, 5.5); break;
    case 'run': a.setWalk(t, 10); a.torso.rotation.x = 0.18; break;
    case 'explain': case 'think': case 'shock': case 'excited': case 'point': a.setGesture(action, t); break;
    case 'celebrate': a.setGesture('excited', t); break;
    case 'bat_swing': {
      a.setIdle(t); const ph = (lt * 0.9) % 1.6, back = Math.min(1, ph / 0.7), hit = clamp((ph - 0.75) / 0.18);
      const sw = lerp(lerp(-0.4, -2.2, eio(back)), 1.1, eio(hit));
      a.legL.hip.rotation.x = 0.25; a.legR.hip.rotation.x = -0.25; a.legL.knee.rotation.x = 0.35; a.legR.knee.rotation.x = 0.25;
      a.torso.rotation.y = lerp(0.5, -0.7, eio(hit)) * (ph > 0.7 ? 1 : back); a.hips.position.y = 0.88;
      for (const arm of [a.armL, a.armR]) { arm.shoulder.rotation.set(sw, 0, arm === a.armL ? 0.55 : -0.35); arm.elbow.rotation.set(-0.5, 0, 0); }
      a.neck.rotation.y = 0.5; break;
    }
    case 'bowl': {
      a.setWalk(t, 9); const ph = (lt * 1.1) % 1.4, wind = clamp(ph / 0.9);
      a.armR.shoulder.rotation.set(-Math.PI * 2 * eio(wind) + 0.3, 0, -0.2); a.armR.elbow.rotation.set(0, 0, 0);
      a.armL.shoulder.rotation.set(-1.4 * (1 - wind), 0, 0.3); a.torso.rotation.x = 0.2 * wind; break;
    }
    case 'ring_bell': { a.setIdle(t); const pull = (Math.sin(t * 3.2) + 1) / 2; a.armR.shoulder.rotation.set(-2.8 + pull * 0.9, 0.1, -0.2); a.armR.elbow.rotation.set(-0.25 - pull * 0.45, 0, 0); a.neck.rotation.x = -0.35; break; }
    case 'look_up': a.setIdle(t); a.neck.rotation.x = -0.45; break;
    case 'wave': a.setIdle(t); a.armR.shoulder.rotation.set(-2.7, 0, -0.4); a.armR.elbow.rotation.set(-0.6 + Math.sin(t * 10) * 0.5, 0, 0); break;
    case 'salute': a.setIdle(t); a.armR.shoulder.rotation.set(-2.3, 0.6, -0.9); a.armR.elbow.rotation.set(-2.2, 0, 0); break;
    case 'sad': a.setIdle(t); a.neck.rotation.x = 0.35; a.torso.rotation.x = 0.1; break;
    default: a.setIdle(t);
  }
  a.setTalk(talking && action !== 'bat_swing' && action !== 'bowl' ? talkAmt(t) : 0);
}

// ── camera language ─────────────────────────────────────────────────────────────────────────────────────────
// angle → distance/height relative to the focus point; move → how the camera travels over the shot.
const ANGLES = { wide: [8.5, 2.6], establishing: [14, 6], medium: [3.4, 1.55], close: [2.5, 1.6], low: [2.8, 0.45], high: [4.2, 5], aerial: [12, 11], ots: [2.4, 1.7] };
// subject size (m) → how far the camera stands for each angle (a 10 m rocket needs a very different distance than coins)
const SIZE_DIST = { establishing: 4, wide: 3, medium: 2, close: 1.25, low: 1.7, high: 2.2, aerial: 4, ots: 1.8 };
export const PROP_SIZE = { rocket: 10, building: 6, bank: 6, tree: 4.5, car: 2.2, flag: 2.6, satellite: 3.2, globe: 0.9, trophy: 0.8, stumps: 0.9 };
export function framingFor(angle, size) { const f = SIZE_DIST[angle] || 2; return [Math.max(2.2, size * f), Math.max(0.6, size * (angle === 'high' || angle === 'aerial' ? 1.1 : angle === 'low' ? 0.05 : 0.35)) + 1.3]; }
export function cameraAt(cam, shotCam, focus, lt, d, style, seed = 0, base = null, azScale = 1) {
  const I = style.camera.intensity ?? 1, k = eio(clamp(lt / Math.max(d, 0.01)));
  const [dist0, h0] = base || ANGLES[shotCam.angle] || ANGLES.medium;
  const side = (seed % 2 ? 1 : -1) * (0.35 + 0.25 * rnd(seed)) * azScale;   // azScale < 1: sets lined with walls (street) keep the camera on the open axis
  let az = side, dist = dist0, h = h0, tx = 0, ty = 0;
  switch (shotCam.move) {
    case 'push': dist = lerp(dist0 * (1 + 0.28 * I), dist0 * (1 - 0.12 * I), k); break;
    case 'pull': dist = lerp(dist0 * (1 - 0.1 * I), dist0 * (1 + 0.3 * I), k); break;
    case 'orbit': az = side + lerp(-0.5, 0.5, k) * I * 1.4; break;
    case 'crane': h = lerp(h0 + 3.5 * I, h0, k); dist = lerp(dist0 * 1.2, dist0, k); break;
    case 'pan': tx = lerp(-1.2, 1.2, k) * I; break;
    case 'track': tx = lerp(-0.8, 0.8, k) * I; az = side * 0.4; break;
    case 'punch': dist = dist0 * (lt < 0.25 ? lerp(1.18, 1, eio(lt / 0.25)) : lerp(1, 0.94, k)); break;
    default: dist = lerp(dist0 * 1.04, dist0 * 0.97, k); az = side + lerp(-0.05, 0.05, k);   // drift: never fully static
  }
  const f = focus;
  cam.position.set(f.x + Math.sin(az) * dist + tx, f.y + (h - 1.3), f.z + Math.cos(az) * dist);
  cam.lookAt(f.x + tx * 0.6, f.y + ty, f.z);
  return cam.position.distanceTo(f);
}

export class Stage3D {
  constructor(E, style) { this.E = E; this.style = style; this.envs = new Map(); }
  env(kind) {
    if (!ENV3D[kind]) kind = 'studio';
    if (!this.envs.has(kind)) {
      const e = ENV3D[kind](this.style);
      if (this.style.id === 'night-file' && kind !== 'space' && kind !== 'night') nightify(e.root);
      e.kind = kind; e.lead = null; this.envs.set(kind, e);
    }
    return this.envs.get(kind);
  }
  lead(env, archetype) {
    if (!archetype) return null;
    if (!env.lead) { env.lead = makeActor({ archetype }, this.style); env.scene.add(env.lead.root); }
    return env.lead;
  }
}
export const v3 = V3;
