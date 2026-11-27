// CineForge stage 2c: Three.js renderer for timed shots. Runs in the browser (loaded by stage.html through an import map,
// the same vendored three.module.js that generated projects use). Subject meshes are keyed by subjectId, so one subject
// is one object across all of its shots (continuity). Camera and subject state come from motion.js (renderer-agnostic).
// Lighting presets and physical effects (fire-plasma, debris, shockwave, dust-cloud) are applied per shot. Effects are
// deterministic functions of progress through the shot, so the same plan always produces the same frames.
import * as THREE from 'three';
import { evaluateShot } from './motion.js';

// Placeholder look until the asset library exists: colours are chosen by a stable hash of the name (decorative only).
const PALETTE = [0xe8a25a, 0x7fc8ff, 0xf2e6a0, 0xff8f7a, 0xb9a6ff, 0x9be3a0];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const colorFor = (s) => PALETTE[hash(s) % PALETTE.length];
const GROUND_Y = -1.2;

/** Seeded random generator: the same seed always gives the same sequence (reproducible renders). */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** A soft, round sprite for particles (radial gradient), so points read as glowing embers rather than squares. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Lighting presets: each sets the key, fill and glow lights of the stage.
const LIGHTS = {
  sunlit: { key: 0xfff1d6, keyI: 2.2, keyPos: [4, 8, 6], fill: 1.3, glow: null },
  'backlit-rim': { key: 0x9fc4ff, keyI: 2.6, keyPos: [-4, 6, -8], fill: 0.9, glow: null },
  'night-ambient': { key: 0x6677aa, keyI: 0.6, keyPos: [3, 7, 5], fill: 0.5, glow: null },
  'fire-glow': { key: 0xfff1d6, keyI: 1.4, keyPos: [4, 8, 6], fill: 0.9, glow: { color: 0xff7a2a, intensity: 7 } },
  'plasma-glow': { key: 0xdff6ff, keyI: 1.4, keyPos: [4, 8, 6], fill: 0.9, glow: { color: 0x7fe9ff, intensity: 7 } },
};

// Starfield: deterministic, so every render of the same plan is identical.
function starfield(count = 900) {
  const r = rng(12345);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const rad = 60 + r() * 60, th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1);
    pos[i * 3] = rad * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = rad * Math.cos(ph) * 0.8 + 6;
    pos[i * 3 + 2] = rad * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, sizeAttenuation: true }));
}

export function createStage(canvas, { width = 540, height = 960 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060d);
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 200);
  camera.position.set(0, 1.6, 9);
  const hemi = new THREE.HemisphereLight(0xdde6ff, 0x222233, 1.3);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  const glow = new THREE.PointLight(0xffffff, 0, 14);
  scene.add(hemi, key, glow);
  scene.add(starfield());
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x2a2f3d, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_Y;
  scene.add(ground);
  return { renderer, scene, camera, hemi, key, glow, subjects: new Map(), effects: new Map(), width, height };
}

/** Apply a lighting preset (from the shot's `lighting`) to the stage lights. */
export function applyLighting(stage, name) {
  const L = LIGHTS[name];
  if (!L) throw new Error(`unknown lighting "${name}"`);
  stage.key.color.setHex(L.key); stage.key.intensity = L.keyI; stage.key.position.set(...L.keyPos);
  stage.hemi.intensity = L.fill;
  if (L.glow) { stage.glow.color.setHex(L.glow.color); stage.glow.intensity = L.glow.intensity; }
  else stage.glow.intensity = 0;
}

/** One mesh per subjectId, created on first use and reused by every later shot with that subject. */
export function subjectMesh(stage, subjectId, color = null) {
  if (!stage.subjects.has(subjectId)) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: color ?? colorFor(subjectId), roughness: 0.6, metalness: 0.1 }));
    mesh.visible = false;
    stage.scene.add(mesh);
    stage.subjects.set(subjectId, mesh);
  }
  return stage.subjects.get(subjectId);
}

/**
 * Effects for one shot, created once and kept. Each effect is a deterministic function of progress p (0..1) in the shot.
 * fire-plasma: glowing particles streaming off the subject's leading side.
 * debris: fragments launched from the impact point after the subject reaches the ground (ballistic, with gravity).
 * shockwave: an expanding ring on the ground after impact.
 * dust-cloud: a low cloud spreading across the ground.
 */
function effectGroup(stage, shot) {
  if (stage.effects.has(shot.id)) return stage.effects.get(shot.id);
  const group = new THREE.Group();
  group.visible = false;
  const seed = hash(shot.id) || 1;
  const r = rng(seed);
  const entry = { group, kind: shot.effect, update: () => {} };

  if (shot.effect === 'fire-plasma') {
    const n = 260, dir = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      dir.set([s * Math.cos(th), u, s * Math.sin(th)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({ color: 0xffa040, map: glowTexture(), size: 0.42, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, mat);
    group.add(pts);
    entry.update = (p, subjPos) => {
      const arr = g.attributes.position.array;
      for (let i = 0; i < n; i++) {
        const d = 1.1 + (p * 1.8) * (0.4 + (i % 7) * 0.09);   // fixed per particle: no random calls during updates
        arr[i * 3] = subjPos[0] + dir[i * 3] * d;
        arr[i * 3 + 1] = subjPos[1] + dir[i * 3 + 1] * d;
        arr[i * 3 + 2] = subjPos[2] + dir[i * 3 + 2] * d;
      }
      g.attributes.position.needsUpdate = true;
      mat.opacity = 0.9 * (1 - 0.5 * p);
    };
  } else if (shot.effect === 'debris') {
    const n = 140, vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      vel.set([(r() - 0.5) * 5, 3 + r() * 5, (r() - 0.5) * 5], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({ color: 0xd9a070, map: glowTexture(), size: 0.3, transparent: true, depthWrite: false, sizeAttenuation: true });
    group.add(new THREE.Points(g, mat));
    entry.update = (p, subjPos) => {
      // debris starts when the subject reaches the ground (last 20 % of the shot), then follows a ballistic arc
      const s = Math.max(0, (p - 0.8) / 0.2) * 1.2;
      const arr = g.attributes.position.array;
      for (let i = 0; i < n; i++) {
        arr[i * 3] = subjPos[0] + vel[i * 3] * s;
        arr[i * 3 + 1] = GROUND_Y + vel[i * 3 + 1] * s - 0.5 * 9.8 * s * s * 0.25;
        arr[i * 3 + 2] = subjPos[2] + vel[i * 3 + 2] * s;
      }
      g.attributes.position.needsUpdate = true;
    };
  } else if (shot.effect === 'shockwave') {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 96), mat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);
    entry.update = (p, subjPos) => {
      const s = Math.max(0, (p - 0.8) / 0.2);
      ring.position.set(subjPos[0], GROUND_Y + 0.02, subjPos[2]);
      ring.scale.setScalar(0.2 + s * 6);
      mat.opacity = 0.8 * (1 - s);
    };
  } else if (shot.effect === 'dust-cloud') {
    const n = 160, base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      base.set([Math.cos(a), r(), Math.sin(a)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({ color: 0x9a9080, map: glowTexture(), size: 1.1, transparent: true, opacity: 0, depthWrite: false });
    group.add(new THREE.Points(g, mat));
    entry.update = (p, subjPos) => {
      const spread = 0.5 + p * 4;
      const arr = g.attributes.position.array;
      for (let i = 0; i < n; i++) {
        arr[i * 3] = subjPos[0] + base[i * 3] * spread;
        arr[i * 3 + 1] = GROUND_Y + base[i * 3 + 1] * 0.6;
        arr[i * 3 + 2] = subjPos[2] + base[i * 3 + 2] * spread;
      }
      g.attributes.position.needsUpdate = true;
      mat.opacity = 0.55 * Math.min(1, p * 2);
    };
  }

  stage.scene.add(group);
  stage.effects.set(shot.id, entry);
  return entry;
}

/** The shot that is active at tSec (the last one that started), or null before the first shot. */
export function shotAt(shots, tSec) {
  let active = null;
  for (const s of shots) if (tSec >= s.start - 1e-9) active = s;
  return active && tSec <= active.end + 1e-9 ? active : null;
}

/** Set the stage to its state at tSec and render. Returns the evaluated state (for checks). */
export function renderAt(stage, shots, tSec) {
  const shot = shotAt(shots, tSec);
  for (const m of stage.subjects.values()) m.visible = false;
  for (const e of stage.effects.values()) e.group.visible = false;
  if (!shot) { stage.renderer.render(stage.scene, stage.camera); return null; }
  const st = evaluateShot(shot, tSec);
  applyLighting(stage, shot.lighting || 'sunlit');
  stage.camera.position.set(...st.camera.pos);
  stage.camera.lookAt(...st.camera.look);
  stage.camera.fov = st.camera.fov;
  stage.camera.updateProjectionMatrix();
  const mesh = subjectMesh(stage, st.subject.id);
  mesh.visible = true;
  mesh.position.set(...st.subject.pos);
  mesh.rotation.set(...st.subject.rot);
  if (shot.effect && shot.effect !== 'none') {
    const fx = effectGroup(stage, shot);
    fx.group.visible = true;
    fx.update(st.p, st.subject.pos);
  }
  if (shot.lighting === 'fire-glow' || shot.lighting === 'plasma-glow') stage.glow.position.set(st.subject.pos[0], st.subject.pos[1] + 0.5, st.subject.pos[2] + 1.5);
  stage.renderer.render(stage.scene, stage.camera);
  const p = mesh.position.clone().project(stage.camera);
  return { shotId: shot.id, p: st.p, camera: st.camera, subject: st.subject, screen: { x: (p.x + 1) / 2, y: (1 - p.y) / 2 }, effect: shot.effect, lighting: shot.lighting };
}
