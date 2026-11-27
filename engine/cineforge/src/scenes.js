// CineForge sets and effects, built with the Deep Dive 3D engine (read-only import: nothing in the Deep Dive folders is
// changed). Each set is built once and returns { scene, light, lights }. The subject (asteroid) is ONE object that the
// main loop moves between sets, so its identity is continuous across shots. Effects are deterministic functions of the
// shot's progress p (0..1), so the same plan always renders the same frames.
import * as THREE from 'three';
import { lightRig, W } from '../../styles/deep-dive/example/src/core/engine.js';
import { noise3 } from '../../styles/deep-dive/example/src/core/sdf.js';
import * as SETS from '../../styles/deep-dive/example/src/core/sets.js';
import { Human } from '../../styles/deep-dive/example/src/core/human.js';

const GROUND_Y = -1.0;   // the surface the subject lands on (its centre sits at y = 0 when it touches down)

/** seeded random: the same seed gives the same sequence, so renders are reproducible */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}
export const hash = (str) => [...String(str)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** a soft round sprite, so particles read as glowing embers */
export function glowSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.35, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function canvasTex(w, h, draw, rep = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.anisotropy = 8; return t;
}
const shadowed = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
/** the Deep Dive light rig, plus a handle to its hemisphere light (lightRig does not return it) */
function rig(scene, opts) {
  const L = lightRig(scene, opts);
  L.hemi = L.group.children.find((c) => c.isHemisphereLight);
  return L;
}

/** the subject: a lumpy rock with a faint emissive hot skin (strength set by the shot's lighting) */
export function makeAsteroid(seedKey) {
  // a UV sphere has shared vertices, so computeVertexNormals gives smooth shading (an icosphere gave faceted flat normals)
  const geo = new THREE.SphereGeometry(1, 160, 120), pos = geo.attributes.position;
  const seed = hash(seedKey) % 9;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = 1 + 0.2 * noise3(x * 1.6 + 3, y * 1.6, z * 1.6) + 0.06 * noise3(x * 5, y * 5, z * 5 + seed);
    pos.setXYZ(i, x * n, y * n * 0.92, z * n);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: '#5a524c', roughness: 0.95, metalness: 0.05, emissive: '#ff6a1a', emissiveIntensity: 0.0 });
  const mesh = shadowed(new THREE.Mesh(geo, mat));
  mesh.userData.mat = mat;
  return mesh;
}

/** planet below the frame: the curved surface, land and oceans, plus a blue atmosphere rim that thickens on entry */
function planet(scene, { haze = 0 } = {}) {
  // continents from 3D noise sampled on the sphere itself (no UV pinching at the poles)
  const tex = canvasTex(1024, 512, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, th = u * Math.PI * 2, ph = v * Math.PI;
      const px = -Math.cos(th) * Math.sin(ph), py = Math.cos(ph), pz = Math.sin(th) * Math.sin(ph);
      const e = 0.6 * noise3(px * 1.8 + 5, py * 1.8, pz * 1.8) + 0.4 * noise3(px * 4.2, py * 4.2, pz * 4.2);
      const land = e > 0.05, shade = 0.8 + 0.2 * noise3(px * 9, py * 9, pz * 9);
      const c = land ? (e > 0.3 ? [150, 140, 92] : [72, 128, 66]) : [28, 92, 170];
      const i = (y * w + x) * 4;
      img.data[i] = c[0] * shade; img.data[i + 1] = c[1] * shade; img.data[i + 2] = c[2] * shade; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, [1, 1]);
  const R = 9;
  const earth = shadowed(new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 })));
  earth.position.set(0, GROUND_Y - R, 0);
  scene.add(earth);
  const rim = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 96, 64), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { uHaze: { value: haze } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform float uHaze; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0); gl_FragColor = vec4(vec3(0.35,0.7,1.0) * f * (0.9 + uHaze*1.6), 1.0); }',
  }));
  rim.position.copy(earth.position);
  scene.add(rim);
  return { earth, rim };
}

/** SPACE: stars, the curved planet below, a cold key light from the sun */
export function buildSpace(E) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#03040a');
  scene.environment = E.envMap; scene.environmentIntensity = 0.25;
  const r = rng(12345), n = 1400, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const rad = 70 + r() * 80, th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1); pos.set([rad * Math.sin(ph) * Math.cos(th), rad * Math.cos(ph) * 0.7 + 10, rad * Math.sin(ph) * Math.sin(th)], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, sizeAttenuation: true, transparent: true, opacity: 0.9 })));
  const pl = planet(scene, { haze: 0 });
  const L = rig(scene, { key: '#FFF2E0', keyI: 3.4, keyPos: [6, 9, 5], target: [0, 0, 0], rimCol: '#8FB8FF', rimI: 1.6, hemiI: 0.35, shadowBox: 9, sky: '#CFE0FF', ground: '#101826' });
  return { scene, light: L, planet: pl, kind: 'space' };
}

/** ATMOSPHERE: the same planet, closer, with a thick haze and a warm sunrise key */
export function buildAtmosphere(E) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1a33');
  scene.environment = E.envMap; scene.environmentIntensity = 0.3;
  const pl = planet(scene, { haze: 1 });
  const L = rig(scene, { key: '#FFD2A0', keyI: 3.0, keyPos: [-5, 5, 6], target: [0, 0, 0], rimCol: '#7FC4FF', rimI: 2.0, hemiI: 0.5, shadowBox: 9, sky: '#A8D8FF', ground: '#1A2638' });
  return { scene, light: L, planet: pl, kind: 'atmosphere' };
}

/** GROUND: the surface at the impact site, a dusk sky, a shallow crater */
export function buildGround(E) {
  const scene = new THREE.Scene();
  scene.background = canvasTex(64, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1b1530'); gr.addColorStop(0.7, '#8c4a3a'); gr.addColorStop(1, '#e09a5a'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  scene.environment = E.envMap; scene.environmentIntensity = 0.35;
  const soil = canvasTex(1024, 1024, (g, w, h) => { g.fillStyle = '#6e5a46'; g.fillRect(0, 0, w, h); const r = rng(11); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${40 + r() * 60},${30 + r() * 40},${20 + r() * 30},0.25)`; g.beginPath(); g.arc(r() * w, r() * h, 2 + r() * 14, 0, Math.PI * 2); g.fill(); } }, [6, 6]);
  const ground = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ map: soil, roughness: 1 })));
  ground.rotation.x = -Math.PI / 2; ground.position.y = GROUND_Y; scene.add(ground);
  const crater = new THREE.Mesh(new THREE.CircleGeometry(2.6, 64), new THREE.MeshStandardMaterial({ color: '#3a2d25', roughness: 1 }));
  crater.rotation.x = -Math.PI / 2; crater.position.set(0, GROUND_Y + 0.01, 0); scene.add(crater);
  const rimRing = shadowed(new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.25, 16, 96), new THREE.MeshStandardMaterial({ color: '#7a6250', roughness: 0.9 })));
  rimRing.rotation.x = -Math.PI / 2; rimRing.scale.set(1, 1, 0.28); rimRing.position.set(0, GROUND_Y + 0.05, 0); scene.add(rimRing);
  const L = rig(scene, { key: '#FFB36B', keyI: 3.4, keyPos: [-6, 2.2, 3], target: [0, 0, 0], rimCol: '#FF9A5A', rimI: 1.4, hemiI: 0.5, shadowBox: 8, sky: '#FFB38A', ground: '#3a2a20' });
  return { scene, light: L, kind: 'ground' };
}

/** the lights of a Deep Dive scene (read from the scene graph: the Deep Dive builders do not return them all) */
function collectLights(scene) {
  const dirs = [], hemis = [];
  scene.traverse((o) => { if (o.isDirectionalLight) dirs.push(o); if (o.isHemisphereLight) hemis.push(o); });
  return { key: dirs[0], rim: dirs[1], hemi: hemis[0] };
}
/** KITCHEN: the Deep Dive kitchen (warm low sun through a window), used as it is */
export function buildKitchen(E) {
  const K = SETS.kitchen(E);
  return { scene: K.scene, light: collectLights(K.scene), kind: 'kitchen', look: { bloom: 0.2, aperture: 0.003 } };
}
/** X-RAY: the Deep Dive x-ray stage (dark blue, cyan glass body) */
export function buildXray(E) {
  const X = SETS.xrayStage(E);
  return { scene: X.scene, light: collectLights(X.scene), kind: 'xray', look: { bloom: 0.55, bloomThreshold: 0.4, vignette: 0.45, aperture: 0.0015 } };
}
/** the person: one Deep Dive Human, kept across the kitchen and the x-ray (setXray switches its look) */
export function makePerson() {
  const h = new Human({ face: true });
  h.userData = { insides: SETS.insides(), xmat: SETS.xrayMaterial() };
  h.spine.add(h.userData.insides.group);
  h.userData.insides.group.visible = false;
  return h;
}
/** switch the person between skin (kitchen) and x-ray glass with bones and organs (x-ray), as shots.js does */
export function setPersonXray(h, on) {
  h.setBodyMaterial(on ? h.userData.xmat : null);
  h.userData.insides.group.visible = on;
}

export const SET_BUILDERS = { space: buildSpace, atmosphere: buildAtmosphere, ground: buildGround, kitchen: buildKitchen, xray: buildXray };
export const PERSON_SETS = new Set(['kitchen', 'xray']);

/**
 * Effects for one shot. Each returns { group, update(p, subjPos) }; the group is added to the set's scene while the shot is on.
 * fire-plasma: glowing particles streaming back from the subject.
 * debris: rock fragments launched from the impact point after the subject reaches the ground (ballistic).
 * shockwave: an expanding ring on the ground after impact.
 * dust-cloud: a low cloud spreading across the ground.
 */
export function buildEffect(kind, seedKey) {
  const group = new THREE.Group();
  const r = rng(hash(seedKey) || 1);
  if (kind === 'fire-plasma') {
    const n = 320, dir = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u); dir.set([s * Math.cos(th), u, s * Math.sin(th)], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({ color: 0xffa050, map: glowSprite(), size: 0.55, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    group.add(new THREE.Points(g, mat));
    return { group, update(p, s) { const a = g.attributes.position.array; for (let i = 0; i < n; i++) { const d = 1.0 + p * 1.6 * (0.4 + (i % 7) * 0.09); a[i * 3] = s[0] + dir[i * 3] * d; a[i * 3 + 1] = s[1] + dir[i * 3 + 1] * d; a[i * 3 + 2] = s[2] + dir[i * 3 + 2] * d; } g.attributes.position.needsUpdate = true; mat.opacity = 0.9 * (1 - 0.5 * p); } };
  }
  if (kind === 'debris') {
    const n = 90, vel = new Float32Array(n * 3), geo = new THREE.IcosahedronGeometry(0.09, 0), mat = new THREE.MeshStandardMaterial({ color: '#4d4540', roughness: 0.95 });
    const inst = new THREE.InstancedMesh(geo, mat, n); group.add(inst);
    for (let i = 0; i < n; i++) vel.set([(r() - 0.5) * 5, 3 + r() * 5, (r() - 0.5) * 5], i * 3);
    const m = new THREE.Matrix4(), v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    const ember = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffa050, map: glowSprite(), size: 0.3, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ember.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); group.add(ember);
    return { group, update(p, s) {
      const k = Math.max(0, (p - 0.8) / 0.2) * 1.2;
      for (let i = 0; i < n; i++) {
        v.set(s[0] + vel[i * 3] * k, GROUND_Y + vel[i * 3 + 1] * k - 0.5 * 9.8 * k * k * 0.25, s[2] + vel[i * 3 + 2] * k);
        q.setFromEuler(new THREE.Euler(i * 0.7 + k * 3, i * 1.3, 0)); m.compose(v, q, sc); inst.setMatrixAt(i, m);
        ember.geometry.attributes.position.array.set([v.x, v.y, v.z], i * 3);
      }
      inst.instanceMatrix.needsUpdate = true; ember.geometry.attributes.position.needsUpdate = true; mat.opacity = 1; ember.material.opacity = 0.9 * (k > 0 ? 1 : 0);
    } };
  }
  if (kind === 'shockwave') {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 128), mat); ring.rotation.x = -Math.PI / 2; group.add(ring);
    return { group, update(p, s) { const k = Math.max(0, (p - 0.8) / 0.2); ring.position.set(s[0], GROUND_Y + 0.03, s[2]); ring.scale.setScalar(0.2 + k * 6); mat.opacity = 0.8 * (1 - k); } };
  }
  if (kind === 'dust-cloud') {
    const n = 220, base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2; base.set([Math.cos(a), r(), Math.sin(a)], i * 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({ color: 0xb09a84, map: glowSprite(), size: 1.2, transparent: true, opacity: 0, depthWrite: false });
    group.add(new THREE.Points(g, mat));
    return { group, update(p, s) { const spread = 0.5 + p * 4, a = g.attributes.position.array; for (let i = 0; i < n; i++) { a[i * 3] = s[0] + base[i * 3] * spread; a[i * 3 + 1] = GROUND_Y + base[i * 3 + 1] * 0.7; a[i * 3 + 2] = s[2] + base[i * 3 + 2] * spread; } g.attributes.position.needsUpdate = true; mat.opacity = 0.55 * Math.min(1, p * 2); } };
  }
  return null;
}
export { GROUND_Y, W };
