// Director: compiles scenes/scene.json (the storyboard + style profile + character) into frame-exact shots.
// A shot is { id, at, note, draw(lt, d, t, blit) }; main.js picks the shot for film time t. Rendering method per shot:
//   scene3d / character → 3D environment + registered 3D character acting + props   (WebGL styles)
//   scene2d             → 2D environment + 2D figure in the character's colours + props, drawn in the style skin
//   image               → generated still with a camera move and the style treatment
//   hybrid              → generated still as backdrop + the character acting in front (3D parallax / 2D figure)
//   infographic         → style-typed numbers / comparisons / steps / diagrams over a defocused environment
import * as lib from '../core/lib.js';
import { makeSkin, environment2d, prop2d, figure2d, GROUND } from './painter2d.js';
import { drawOverlay, setOverlayStyle } from './overlay.js';
import { loadImage, stylize, drawCover, frame2d, backdropStage } from './image.js';
const { W, H, clamp, lerp, seg, eo, eio, eob, rnd } = lib;

// how big each 3D environment is: scales the camera distance of shots that frame the place rather than a subject
const ENV_CAM_SCALE = { cricket: 2.4, temple: 2.2, space: 2, launchpad: 3.2, lab: 1.2, classroom: 1.2, city: 2.6, bank: 2.6, village: 2.2, room: 1.2, home: 1.2, night: 1.3, office: 1.2, nature: 2.6, ocean: 2.6, street: 1.6, market: 1.6, palace: 1.8, fort: 1.8, studio: 1.4 };
const HAND_PROPS = new Set(['phone', 'ball', 'magnifier', 'scroll']);
const GROUND_PROPS = new Set(['car', 'tree', 'building', 'bank', 'flag', 'rocket', 'stumps']);
const ENV_NATIVE = { cricket: ['stumps'], temple: ['bell', 'temple_bell'], space: ['earth', 'planet_earth', 'mars', 'planet_mars'] };

// 2D layout per environment: where people stand (x, feet y, height) and where things go
const LAYOUT2D = {
  cricket: { lead: [430, 1760, 760], extra: [700, 1150, 300], prop: [800, 1250] },
  temple: { lead: [330, 1500, 640], extra: [800, 1500, 600], bell: [610, 760], prop: [760, 1050] },
  launchpad: { lead: [830, 1640, 520], extra: [640, 1640, 480], rocket: [520, 1300], prop: [820, 1000] },
  space: { lead: [540, 1560, 620], extra: [760, 1560, 560], earth: [230, 1380], mars: [840, 520], satellite: [560, 820], prop: [560, 820] },
  default: { lead: [520, GROUND, 760], extra: [840, GROUND, 700], prop: [800, 1020] },
};

function grade2d(style, t, strength = 1) {
  const ctx = lib.ctx, g = style.grade || {}, v = (g.vignette ?? 0) * strength;
  if (v > 0.01) { const r = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.25, W / 2, H * 0.5, H * 0.75); r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, style.id === 'paper-atlas' ? `rgba(70,45,20,${v})` : `rgba(0,0,0,${v})`); ctx.fillStyle = r; ctx.fillRect(0, 0, W, H); }
  const gr = (g.grain ?? 0) * strength;
  if (gr > 0.004) { const n = Math.round(1400 * gr / 0.02); ctx.fillStyle = `rgba(255,255,255,${Math.min(0.25, gr * 3)})`; for (let i = 0; i < n; i++) ctx.fillRect(rnd(i + t * 997) * W, rnd(i * 3 + t * 131) * H, 2, 2); }
}

let fx = null;
function transitionIn(type, lt, dur, style) {
  if (!type || type === 'cut' || lt >= dur) return;
  const ctx = lib.ctx, cv = ctx.canvas, p = clamp(lt / dur);
  if (!fx) { fx = document.createElement('canvas'); fx.width = W; fx.height = H; }
  const f = fx.getContext('2d');
  switch (type) {
    case 'whip': f.clearRect(0, 0, W, H); f.drawImage(cv, 0, 0); for (let k = 1; k <= 4; k++) { ctx.globalAlpha = 0.2 * (1 - p); ctx.drawImage(fx, (1 - eo(p)) * 70 * k, 0); } ctx.globalAlpha = 1; break;
    case 'flash': ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - eo(p))})`; ctx.fillRect(0, 0, W, H); break;
    case 'black': ctx.fillStyle = `rgba(0,0,0,${1 - eo(p)})`; ctx.fillRect(0, 0, W, H); break;
    case 'pop': { f.clearRect(0, 0, W, H); f.drawImage(cv, 0, 0); const s = lerp(1.1, 1, eob(p)); ctx.fillStyle = style.palette.bg; ctx.fillRect(0, 0, W, H); ctx.drawImage(fx, (W - W * s) / 2, (H - H * s) / 2, W * s, H * s); break; }
    case 'wipe': ctx.fillStyle = style.palette.ink; ctx.fillRect(W * eo(p), 0, W, H); break;
    case 'slide': { const x = W * eo(p); ctx.save(); ctx.shadowColor = 'rgba(52,34,18,0.5)'; ctx.shadowBlur = 30; ctx.fillStyle = style.palette.paper || style.palette.bg; ctx.fillRect(x, 0, W, H); ctx.restore(); break; }
    default: break;
  }
}

const ZOOM = { wide: 1, establishing: 0.96, medium: 1.32, close: 1.95, low: 1.22, high: 1.05, aerial: 1, ots: 1.45 };
function camera2d(spec, lt, d, focus, style, seed) {
  const ctx = lib.ctx, I = style.camera.intensity ?? 1, k = eio(clamp(lt / Math.max(d, 0.01)));
  let z = ZOOM[spec.angle] || 1.2, [fx_, fy] = focus, dx = 0, dy = 0;
  switch (spec.move) {
    case 'push': z *= lerp(1, 1 + 0.14 * I, k); break;
    case 'pull': z *= lerp(1 + 0.14 * I, 1, k); break;
    case 'pan': case 'track': dx = lerp(-70, 70, k) * I * (seed % 2 ? 1 : -1); break;
    case 'crane': case 'tilt': dy = lerp(-120, 0, k) * I; break;
    case 'punch': z *= lt < 0.22 ? lerp(1.16, 1, eob(lt / 0.22)) : lerp(1, 1.05, k); break;
    default: z *= lerp(1, 1.05, k); dx = lerp(-12, 12, k);
  }
  if (spec.angle === 'wide' || spec.angle === 'establishing' || spec.angle === 'aerial') { fx_ = 540; fy = 960; }
  // keep the frame inside the painted area
  const hw = W / 2 / z, hh = H / 2 / z;
  const cx = clamp(fx_ + dx, hw - 160, W - hw + 160), cy = clamp(fy + dy, hh - 160, H - hh + 160);
  ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-cx, -cy);
}

export async function buildDirector({ scene, E, three }) {
  const style = scene.style, is3d = style.renderer === 'webgl' && !!E && !!three;
  setOverlayStyle(style, scene.language);
  const S2 = makeSkin(style), C = scene.character || { mode: 'none' };
  const hasLead = C.mode && C.mode !== 'none';
  const shots = [], CUES = [];
  const cue = (t, type, o = {}) => CUES.push({ t: +Math.max(0, t).toFixed(3), type, ...o });
  const images = new Map();
  for (const sh of scene.shots) if (sh.image) images.set(sh.id, stylize(await loadImage(sh.image), style));

  let THREE, stage, S3, cam;
  if (is3d) { THREE = three.THREE; S3 = three.stage; stage = new S3.Stage3D(E, style); cam = three.camera(32); }
  const envSets = new Map();   // env scene → [sets]

  const figColors = { skin: C.colors?.skin, shirt: C.colors?.shirt, pants: C.colors?.pants, hair: C.colors?.hair, accent: C.colors?.accent, accent2: C.colors?.accent2 };
  const extraColors = (k) => ({ skin: ['#C68652', '#E0AC69', '#8D5524'][k % 3], shirt: ['#5C6BC0', '#26A69A', '#8D6E63'][k % 3], pants: '#37474F', hair: '#222' });

  scene.shots.forEach((sh, i) => {
    const at = i === 0 ? 0 : sh.start, method = sh.method, camSpec = sh.camera || { angle: 'medium', move: 'push' };
    const leadCast = hasLead ? (sh.cast || []).find((c) => c.role === 'lead') : null;
    const extrasCast = (sh.cast || []).filter((c) => c.role !== 'lead').slice(0, 2);
    const objects = (sh.objects || []).filter((o) => !(ENV_NATIVE[sh.environment] || []).includes(o));
    const transition = i === 0 ? 'black' : (sh.transition || style.transition.type);
    const trDur = style.transition.duration || 0.2;
    let drawCore;

    // ── 3D shots ──────────────────────────────────────────────────────────────────────────────────────────
    if (is3d && method !== 'image' && method !== 'infographic' && !(method === 'hybrid' && !images.has(sh.id))) {
      let env;
      if (method === 'hybrid') { const tex = new THREE.CanvasTexture(images.get(sh.id)); tex.colorSpace = THREE.SRGBColorSpace; env = backdropStage(THREE, tex, style); }
      else env = stage.env(sh.environment);
      const set = new THREE.Group(); set.visible = false; env.scene.add(set);
      if (!envSets.has(env.scene)) envSets.set(env.scene, []); envSets.get(env.scene).push(set);
      const lead = leadCast ? (method === 'hybrid' ? (() => { const a = S3.makeActor({ archetype: C.archetype }, style); set.add(a.root); return a; })() : stage.lead(env, C.archetype)) : null;
      const A = env.anchors || {};
      const leadPos = leadCast?.position && A[leadCast.position] && Array.isArray(A[leadCast.position]) ? A[leadCast.position] : (A.lead || [0, 0, 0]);
      const extras = extrasCast.map((c, k) => {
        const a = S3.makeActor({ generic: true, colors: extraColors(k) }, style); set.add(a.root);
        const p = (c.position && Array.isArray(A[c.position])) ? A[c.position] : [leadPos[0] + (k ? -1.4 : 1.4), 0, leadPos[2] - 1.2];
        a.root.position.set(...p); a.root.rotation.y = c.facing ?? (c.position === 'bowler' ? 0 : -0.3 * (k ? -1 : 1));
        return { a, c };
      });
      // props: hand → lead's hands; ground → on the ground; others presented on a slow-turning plinth
      const attach = [], props = [];
      objects.forEach((kind, k) => {
        const p = S3.makeProp3D(kind); if (!p) return;
        if (kind === 'bat' && lead) { p.rotation.set(Math.PI, 0, 0); p.position.set(0, -0.05, 0.02); attach.push([lead.armR.hand, p]); return; }
        if (HAND_PROPS.has(kind) && lead && kind !== 'ball') { p.position.set(0, -0.06, 0.05); attach.push([lead.armL.hand, p]); return; }
        if (kind === 'rocket') { const rp = A.rocket || [leadPos[0] - 3, 0, leadPos[2] - 4]; p.position.set(...rp); if (!A.rocket) p.scale.setScalar(0.35); set.add(p); props.push({ kind, p, base: p.position.clone() }); return; }
        if (kind === 'ball') { set.add(p); props.push({ kind, p, base: new THREE.Vector3(...leadPos) }); return; }
        if (kind === 'satellite') { p.position.set(0, 0.5, 0); set.add(p); props.push({ kind, p, base: p.position.clone() }); return; }
        if (GROUND_PROPS.has(kind)) { const big = (S3.PROP_SIZE[kind] || 1) > 3; p.position.set(leadPos[0] + (big ? 3.2 : 1.3) + k * 0.9, 0, leadPos[2] - (big ? 3 : 0.9) - k * 0.5); set.add(p); props.push({ kind, p, base: p.position.clone() }); return; }
        const side = lead ? 1 : 0, px = leadPos[0] + (lead ? 0.95 : (k - (objects.length - 1) / 2) * 1.1), pz = leadPos[2] + (lead ? 0.35 : 0);
        p.position.set(px + k * 0.15 * side, lead ? 1.15 : 1.0, pz); set.add(p); props.push({ kind, p, base: p.position.clone(), spin: true });
      });
      // what the camera frames: the character when present, else the main prop at a distance that fits its real
      // size, else the place itself at the environment's scale. Returns [focus point, [distance, height] | null].
      const mainProp = props.find((x) => x.kind !== 'ball') || null;
      const focusFor = () => {
        const ang = camSpec.angle;
        if (lead && ang !== 'establishing' && ang !== 'aerial') return [new THREE.Vector3(leadPos[0], ang === 'close' ? 1.55 : 1.2, leadPos[2]), null];
        if (mainProp) {
          const size = S3.PROP_SIZE[mainProp.kind] || 0.7, p = mainProp.p.getWorldPosition(new THREE.Vector3());
          p.y += mainProp.kind === 'rocket' ? 5 : size * 0.35;
          return [p, S3.framingFor(ang, size)];
        }
        const sc = ENV_CAM_SCALE[sh.environment] || 1.5, [dd, hh] = ({ wide: [8.5, 2.6], establishing: [14, 6], medium: [3.4, 1.55], close: [1.6, 1.5], low: [2.8, 0.45], high: [4.2, 5], aerial: [12, 11], ots: [2.4, 1.7] })[ang] || [3.4, 1.55];
        return [new THREE.Vector3(...(A.wide || A.focus || [0, 1.2, 0])), [dd * sc, hh * Math.sqrt(sc)]];
      };
      drawCore = (lt, d, t, blit) => {
        for (const s of envSets.get(env.scene)) s.visible = s === set;
        if (env.lead) env.lead.root.visible = !!lead && lead === env.lead;
        for (const [parent, obj] of attach) if (obj.parent !== parent) parent.add(obj);
        if (env.lead) for (const h of [env.lead.armL.hand, env.lead.armR.hand]) for (const c of [...h.children]) if (c.userData.isProp && !attach.some(([, o]) => o === c)) h.remove(c);
        attach.forEach(([, o]) => (o.userData.isProp = true));
        if (lead) { lead.root.position.set(...leadPos); lead.root.rotation.y = leadCast.facing ?? A.leadFacing ?? 0; S3.act(lead, leadCast.action || 'talk', t, lt, d, { talk: leadCast.talk !== false }); if (leadCast.action === 'walk' || leadCast.action === 'run') lead.root.position.z += lerp(-1.2, 1.2, clamp(lt / d)) * (leadCast.action === 'run' ? 2 : 1); }
        extras.forEach(({ a, c }) => S3.act(a, c.action || 'idle', t + 1.3, lt, d, { talk: false }));
        for (const pr of props) {
          if (pr.spin) { pr.p.rotation.y = t * 0.8; pr.p.position.y = pr.base.y + Math.sin(t * 2) * 0.04; }
          if (pr.kind === 'rocket' && sh.action === 'launch') { const k = Math.max(0, lt - d * 0.25); pr.p.position.y = pr.base.y + k * k * 1.6; pr.p.userData.flame.visible = lt > d * 0.18; pr.p.userData.smoke.visible = lt > d * 0.12; pr.p.userData.smoke.scale.setScalar(1 + lt * 0.8); pr.p.userData.flame.scale.y = 1 + 0.25 * Math.sin(t * 40); }
          if (pr.kind === 'flag' && pr.p.userData.cloth) { const c = pr.p.userData.cloth; c.rotation.y = Math.sin(t * 3.1) * 0.22; c.rotation.z = Math.sin(t * 2.3) * 0.04; }
          if (pr.kind === 'satellite') { pr.p.rotation.y = t * 0.4; pr.p.position.x = pr.base.x + lerp(-1.5, 1.5, clamp(lt / d)); }
          if (pr.kind === 'ball') { const ph = (lt * 0.9) % 1.6, from = new THREE.Vector3(...(A.bowler || [0, 0, -6])).add(new THREE.Vector3(0, 2, 0)), to = new THREE.Vector3(leadPos[0] + 0.2, 0.9, leadPos[2]); if (ph < 0.75) pr.p.position.lerpVectors(from, to, ph / 0.75).add(new THREE.Vector3(0, Math.sin(ph / 0.75 * Math.PI) * 0.6, 0)); else { const k = (ph - 0.75) / 0.85; pr.p.position.set(to.x - k * 8, to.y + Math.sin(k * Math.PI) * 6, to.z - k * 16); } }
        }
        if (env.bell) env.bell.rotation.z = (leadCast?.action === 'ring_bell' || sh.action === 'swing') ? Math.sin(t * 7) * 0.32 : Math.sin(t * 1.5) * 0.03;
        if (env.update) env.update(t);
        const [f, base] = focusFor(), dist = S3.cameraAt(cam, camSpec, f, lt, d, style, i, base);
        const g = style.grade;
        E.render(env.scene, cam, { bloom: g.bloom, bloomThreshold: g.bloomThreshold, aperture: g.aperture ?? 0.0015, maxblur: 0.008, focus: dist, exposure: g.exposure, vignette: g.vignette, grain: g.grain, warm: g.warm, sat: g.sat, t });
        blit();
      };
    }
    // ── image / hybrid (2D) ──────────────────────────────────────────────────────────────────────────────
    else if ((method === 'image' || method === 'hybrid') && images.has(sh.id)) {
      const img = images.get(sh.id), lay = LAYOUT2D.default;
      drawCore = (lt, d, t) => {
        drawCover(img, lt, d, camSpec.move === 'pan' || camSpec.move === 'tilt' ? camSpec.move : camSpec.move === 'pull' ? 'pull' : camSpec.move === 'punch' ? 'punch' : 'push', style.camera.intensity ?? 1, i);
        if (method === 'hybrid' && leadCast) figure2d(S2, { x: 300, y: 1880, h: 900, dir: 1, colors: figColors, accessory: C.accessory, action: leadCast.action || 'explain', t, talk: true, hold: objects.includes('bat') ? 'bat' : null });
        if (!is3d) frame2d(style); else grade2d(style, t, 1);
      };
    }
    // ── 2D scenes (2D styles) ───────────────────────────────────────────────────────────────────────────
    else if (!is3d && method !== 'infographic') {
      const lay = LAYOUT2D[sh.environment] || LAYOUT2D.default, night = !!sh.night || style.id === 'night-file';
      drawCore = (lt, d, t) => {
        const ctx = lib.ctx; ctx.save();
        const focus = leadCast ? [lay.lead[0], lay.lead[1] - lay.lead[2] * (camSpec.angle === 'close' ? 0.86 : 0.62)] : [540, 960];
        camera2d(camSpec, lt, d, focus, style, i);
        environment2d(S2, sh.environment, t, { night });
        if (sh.environment === 'space') { prop2d(S2, 'earth', lay.earth[0], lay.earth[1], 1, t); prop2d(S2, 'mars', lay.mars[0], lay.mars[1], 0.9, t); }
        if (sh.environment === 'temple') prop2d(S2, 'bell', lay.bell[0], lay.bell[1], 1, t, { swing: leadCast?.action === 'ring_bell' || sh.action === 'swing' ? 1 : 0.1, ring: leadCast?.action === 'ring_bell' || sh.action === 'swing' });
        objects.forEach((kind, k) => {
          if ((kind === 'bat' && leadCast) || (HAND_PROPS.has(kind) && leadCast && kind !== 'ball')) return;
          if (kind === 'rocket') return prop2d(S2, 'rocket', (lay.rocket || [540, 1300])[0], (lay.rocket || [540, 1300])[1], sh.environment === 'launchpad' ? 1.2 : 0.7, clamp(lt / d), { launch: sh.action === 'launch' });
          if (kind === 'satellite') return prop2d(S2, 'satellite', (lay.satellite || lay.prop)[0] + lerp(-120, 120, clamp(lt / d)), (lay.satellite || lay.prop)[1], 1, t);
          if (kind === 'ball' && sh.environment === 'cricket') { const ph = (lt * 0.9) % 1.6; const [bx, by] = ph < 0.75 ? [lerp(lay.extra[0], lay.lead[0] + 80, ph / 0.75), lerp(lay.extra[1] - 200, lay.lead[1] - 330, ph / 0.75) - Math.sin(ph / 0.75 * Math.PI) * 120] : [lay.lead[0] + 80 + (ph - 0.75) * 900, lay.lead[1] - 330 - Math.sin((ph - 0.75) / 0.85 * Math.PI) * 700]; return prop2d(S2, 'ball', bx, by, 1.2 * (ph < 0.75 ? lerp(0.5, 1, ph / 0.75) : 1), t); }
          const px = leadCast ? lay.prop[0] - k * 40 : 540 + (k - (objects.length - 1) / 2) * 330, py = GROUND_PROPS.has(kind) ? GROUND : (leadCast ? lay.prop[1] : 1000) + Math.sin(t * 2 + k) * 10;
          prop2d(S2, kind, px, py, GROUND_PROPS.has(kind) ? 0.9 : 0.85, kind === 'chart' || kind === 'coins' ? clamp(lt / d) : t, {});
        });
        extrasCast.forEach((c, k) => { const p = k === 0 ? lay.extra : [lay.extra[0] - 200, lay.extra[1], lay.extra[2] * 0.95]; figure2d(S2, { x: p[0], y: p[1], h: p[2], dir: -1, colors: extraColors(k), accessory: 'none', action: c.action || 'idle', t: t + 1.1, talk: false, hold: c.action === 'bowl' ? null : null, glow: night }); });
        if (leadCast) figure2d(S2, { x: lay.lead[0], y: lay.lead[1], h: lay.lead[2], dir: leadCast.dir || 1, colors: figColors, accessory: C.accessory, action: leadCast.action || 'talk', t, talk: leadCast.talk !== false, hold: objects.includes('bat') ? 'bat' : objects.find((o) => HAND_PROPS.has(o) && o !== 'ball') ? null : null, glow: night });
        ctx.restore();
        objects.filter((o) => HAND_PROPS.has(o) && o !== 'ball' && leadCast).forEach((kind) => prop2d(S2, kind, lay.lead[0] + 150, lay.lead[1] - lay.lead[2] * 0.55, 0.7, t));
      };
    }
    // ── infographic over a defocused environment ────────────────────────────────────────────────────────
    else {
      const env = is3d ? stage.env(sh.environment || 'studio') : null;
      if (is3d) { const set = new THREE.Group(); env.scene.add(set); if (!envSets.has(env.scene)) envSets.set(env.scene, []); envSets.get(env.scene).push(set); drawCore = (lt, d, t, blit) => { for (const s of envSets.get(env.scene)) s.visible = s === set; if (env.lead) env.lead.root.visible = false; if (env.update) env.update(t); const dist = S3.cameraAt(cam, { angle: 'wide', move: 'drift' }, new THREE.Vector3(...(env.anchors.wide || [0, 1.5, 0])), lt, d, style, i); E.render(env.scene, cam, { ...style.grade, aperture: 0.02, maxblur: 0.02, focus: dist * 0.3, t }); blit(); lib.ctx.fillStyle = 'rgba(0,0,0,0.28)'; lib.ctx.fillRect(0, 0, W, H); }; }
      else drawCore = (lt, d, t) => { const ctx = lib.ctx; ctx.save(); camera2d({ angle: 'wide', move: 'drift' }, lt, d, [540, 960], style, i); environment2d(S2, sh.environment || 'studio', t, { night: !!sh.night }); ctx.restore(); ctx.fillStyle = lib.rgba(style.palette.bg, 0.45); ctx.fillRect(0, 0, W, H); };
    }

    const overlays = Array.isArray(sh.overlay) ? sh.overlay : sh.overlay ? [sh.overlay] : [];
    shots.push({
      id: sh.id, at, note: `${method} · ${sh.environment || '-'} · ${sh.visualObjective || ''}`.slice(0, 140),
      draw(lt, d, t, blit) {
        drawCore(lt, d, t, blit || (() => {}));
        for (const o of overlays) drawOverlay(o, lt - (o.delay || 0), d, t);
        if (!is3d && method !== 'image' && method !== 'hybrid') grade2d(style, t, 1);
        transitionIn(transition, lt, trDur, style);
      },
    });

    // sound design tied to what is on screen
    const sfx = style.sfx || ['whoosh'];
    if (i > 0) cue(at, transition === 'black' ? 'tock' : 'whoosh', { gain: 0.7 });
    const acts = [leadCast?.action, ...extrasCast.map((c) => c.action), sh.action];
    const dur = sh.end - sh.start;
    if (acts.includes('bat_swing')) for (let k = at + 0.75 / 0.9; k < sh.end; k += 1.6 / 0.9) cue(k, 'slam', { gain: 0.8 });
    if (acts.includes('ring_bell') || acts.includes('swing')) for (let k = at + 0.2; k < sh.end; k += 0.9) cue(k, 'ding', { gain: 0.55 });
    if (acts.includes('launch')) { cue(at + dur * 0.15, 'sizzle', { gain: 0.8, dur: Math.max(1, dur * 0.8) }); cue(at + dur * 0.25, 'whoosh', { gain: 0.9 }); }
    if (acts.includes('excited') || acts.includes('celebrate')) cue(at + 0.3, sfx.includes('sparkle') ? 'sparkle' : 'pop', { gain: 0.6 });
    if (acts.includes('shock')) cue(at + 0.2, 'slam', { gain: 0.6 });
    for (const o of overlays) cue(at + (o.delay || 0) + 0.05, o.type === 'date' && style.id === 'night-file' ? 'tock' : 'pop', { gain: 0.6 });
  });
  return { shots, cues: CUES };
}
