// Characters screen: renders each character with the SAME code the videos use (engine character3d.js, three r170),
// in the chosen appearance. One shared WebGL renderer draws every card into an <img>.
import * as THREE from 'three';
import { createCharacter3D } from '/engine3d/character3d.js';

const W = 420, H = 540;
let R = null;
function renderer() {
  if (R) return R;
  R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  R.setSize(W, H); R.setPixelRatio(1.5); R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05;
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  return R;
}

/** PNG data URL of the character (archetype + look overrides), upper-body framing, idle pose */
export function portrait(archetype, overrides = null, accent = '#F59E0B') {
  const r = renderer(), scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#3a3028', 1.1));
  const key = new THREE.DirectionalLight('#fff1dc', 2.6); key.position.set(1.6, 3.2, 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); scene.add(key);
  const rim = new THREE.DirectionalLight(accent, 1.8); rim.position.set(-2, 2.4, -2.5); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.ShadowMaterial({ opacity: 0.35 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const ch = createCharacter3D({ archetype, ...(overrides || {}) });
  ch.root.rotation.y = -0.28; scene.add(ch.root);
  ch.setIdle?.(0.6); ch.setTalk?.(0.25);
  const cam = new THREE.PerspectiveCamera(28, W / H, 0.05, 20); cam.position.set(0.4, 1.38, 3.6); cam.lookAt(0, 1.32, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
  return url;
}

/** fill every <img data-char3d> on the page (data-archetype, data-look JSON overrides, data-accent) */
export function fill(root = document) {
  for (const img of root.querySelectorAll('img[data-char3d]')) {
    try { img.src = portrait(img.dataset.archetype, img.dataset.look ? JSON.parse(img.dataset.look) : null, img.dataset.accent); img.classList.add('ready'); }
    catch (e) { console.error('character preview failed', e); }
  }
}
window.CharPreview = { portrait, fill };
window.dispatchEvent(new Event('charpreview-ready'));
