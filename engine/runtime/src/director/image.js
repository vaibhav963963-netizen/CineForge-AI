// Generated stills (ComfyUI output in generated-images/): loaded once, given the style's treatment once (precomputed
// into an offscreen canvas), then moved with a camera every frame. Hybrid shots in 3D styles use the image as a
// backdrop plane behind real 3D actors (parallax), in 2D styles as the background behind a 2D figure.
import * as lib from '../core/lib.js';
const { W, H, clamp, lerp, eio, eo, rnd } = lib;

export function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(`image missing: ${src}`)); im.src = src + '?v=' + Date.now(); });
}

const FILTER = {
  'tall-tale': 'saturate(1.18) contrast(1.04)',
  'deep-dive': 'saturate(1.08) contrast(1.1) brightness(0.98)',
  'night-file': 'grayscale(0.45) contrast(1.15) brightness(1.35)',   // AI noir images are already dark: lift, don't crush
  'inside-out': 'saturate(1.35) contrast(1.2)',
  'stick-story': 'saturate(0.9) contrast(1.08)',
  'paper-atlas': 'sepia(0.45) saturate(0.75) contrast(1.05)',
};

/** style treatment, computed once per image */
export function stylize(img, style) {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.filter = FILTER[style.id] || 'none'; g.drawImage(img, 0, 0); g.filter = 'none';
  const w = c.width, h = c.height;
  if (style.id === 'night-file') { g.globalCompositeOperation = 'multiply'; g.fillStyle = '#E4D8D2'; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
  if (style.id === 'paper-atlas') {
    g.globalCompositeOperation = 'multiply'; g.fillStyle = '#E9DCBC'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(120,90,50,${0.04 + rnd(i) * 0.05})`; g.beginPath(); g.ellipse(rnd(i + 3) * w, rnd(i + 9) * h, 30 + rnd(i) * 120, 20 + rnd(i + 1) * 90, 0, 0, 7); g.fill(); }
    g.globalCompositeOperation = 'source-over';
  }
  if (style.id === 'inside-out' || style.id === 'stick-story') {
    // flatten: posterize the luminance a little so photographic texture reads as flat colour
    const d = g.getImageData(0, 0, w, h), a = d.data, q = style.id === 'inside-out' ? 42 : 28;
    for (let i = 0; i < a.length; i += 4) { a[i] = Math.round(a[i] / q) * q; a[i + 1] = Math.round(a[i + 1] / q) * q; a[i + 2] = Math.round(a[i + 2] / q) * q; }
    g.putImageData(d, 0, 0);
  }
  return c;
}

/** draw an image to cover the frame with a camera move. move: push | pull | pan | tilt | drift | punch */
export function drawCover(src, lt, d, move = 'push', intensity = 1, seed = 0) {
  const ctx = lib.ctx;
  const k = eio(clamp(lt / Math.max(d, 0.01))), I = intensity;
  const base = Math.max(W / src.width, H / src.height);
  let z = 1.06, dx = 0, dy = 0;
  switch (move) {
    case 'push': z = lerp(1.04, 1.04 + 0.16 * I, k); break;
    case 'pull': z = lerp(1.04 + 0.16 * I, 1.04, k); break;
    case 'pan': z = 1.14; dx = lerp(-1, 1, k) * 60 * I * (seed % 2 ? 1 : -1); break;
    case 'tilt': z = 1.14; dy = lerp(1, -1, k) * 90 * I; break;
    case 'punch': z = lt < 0.25 ? lerp(1.22, 1.08, eo(lt / 0.25)) : lerp(1.08, 1.12, k); break;
    default: z = lerp(1.05, 1.1, k); dx = lerp(-12, 12, k);
  }
  const s = base * z, w = src.width * s, h = src.height * s;
  ctx.drawImage(src, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
}

/** frame around an image in 2D styles (paper edge / ink border) */
export function frame2d(style) {
  const ctx = lib.ctx;
  if (style.id === 'paper-atlas') { ctx.save(); ctx.strokeStyle = 'rgba(62,44,30,0.55)'; ctx.lineWidth = 26; ctx.strokeRect(13, 13, W - 26, H - 26); ctx.restore(); }
  if (style.id === 'inside-out') { ctx.save(); ctx.strokeStyle = style.palette.ink; ctx.lineWidth = 18; ctx.strokeRect(9, 9, W - 18, H - 18); ctx.restore(); }
}

/** 3D: a lit stage with the image as a backdrop plane (unlit, true colours) + a shadow-catching floor */
export function backdropStage(THREE, tex, style) {
  // the generated still IS the background (same 9:16 frame as the video): it always fills the shot. A world-space
  // plane let orbit/drift/wide cameras see past its edge into a flat colour (seen Nov 12: character on plain blue).
  const scene = new THREE.Scene(); scene.background = tex;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.35 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const L = style.lighting;
  scene.add(new THREE.HemisphereLight(L.sky || '#FFF', L.ground || '#555', (L.hemiI ?? 0.9)));
  const key = new THREE.DirectionalLight(L.key || '#FFF', L.keyI ?? 3); key.position.set(3, 7, 5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 }); scene.add(key);
  const rim = new THREE.DirectionalLight(L.rim || '#BFD8FF', L.rimI ?? 2); rim.position.set(-3, 3, -2); scene.add(rim);
  return { scene, anchors: { lead: [0.3, 0, 0.6], leadFacing: -0.15, focus: [0.2, 1.25, 0.4] } };
}
