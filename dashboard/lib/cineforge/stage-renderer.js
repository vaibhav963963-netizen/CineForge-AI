// CineForge stage 2c: Three.js renderer for timed shots. Runs in the browser (loaded by stage.html through an import map,
// the same vendored three.module.js that generated projects use). Subject meshes are keyed by subjectId, so one subject
// is one object across all of its shots (continuity). Camera and subject state come from motion.js (renderer-agnostic).
import * as THREE from 'three';
import { evaluateShot } from './motion.js';

// Placeholder look until the asset library exists: colours are chosen by a stable hash of the name (decorative only).
// They carry NO semantic meaning. Palette is bright enough to contrast with the dark set.
const PALETTE = [0xe8a25a, 0x7fc8ff, 0xf2e6a0, 0xff8f7a, 0xb9a6ff, 0x9be3a0];
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const colorFor = (s) => PALETTE[hash(s) % PALETTE.length];

// Deterministic starfield (seeded, so every render of the same plan is identical).
function starfield(count = 900) {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 60 + rnd() * 60, th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.8 + 6;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
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
  scene.add(new THREE.HemisphereLight(0xdde6ff, 0x222233, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 8, 6);
  scene.add(key);
  scene.add(starfield());
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x2a2f3d, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.2;
  scene.add(ground);
  return { renderer, scene, camera, subjects: new Map(), width, height };
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
  if (!shot) { stage.renderer.render(stage.scene, stage.camera); return null; }
  const st = evaluateShot(shot, tSec);
  stage.camera.position.set(...st.camera.pos);
  stage.camera.lookAt(...st.camera.look);
  stage.camera.fov = st.camera.fov;
  stage.camera.updateProjectionMatrix();
  const mesh = subjectMesh(stage, st.subject.id);
  mesh.visible = true;
  mesh.position.set(...st.subject.pos);
  mesh.rotation.set(...st.subject.rot);
  stage.renderer.render(stage.scene, stage.camera);
  const p = mesh.position.clone().project(stage.camera);
  return { shotId: shot.id, p: st.p, camera: st.camera, subject: st.subject, screen: { x: (p.x + 1) / 2, y: (1 - p.y) / 2 } };
}
