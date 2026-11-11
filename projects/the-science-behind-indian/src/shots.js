// Auto-generated 100% True 3D Cinematic Shots for: "The Science Behind Indian Temple Bells"
import * as THREE from 'three';
import { clamp, lerp, eo, eio, eob } from './core/lib.js';
import { L, Wd } from './core/timing.js';
import { camera, lightRig } from './core/engine.js';
import { createCharacter3D } from './core/character3d.js';
import { createEnvironment3D } from './core/environments3d.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const mixV3 = (a, b, k) => a.clone().lerp(b, k);
const talk = (t, on = 1) => (on ? 0.3 + 0.7 * Math.abs(Math.sin(t * 14)) : 0);

export function buildShots(E) {
  const S = [];
  const CUES = [];
  const add = (o) => (S.push(o), o);
  const cue = (t, type, o = {}) => CUES.push({ t: +t.toFixed(3), type, ...o });
  const cut = (i) => (i === 0 ? 0 : L(i) - 0.05);

  // 1. Master 3D Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#F7E7CE');
  scene.fog = new THREE.FogExp2('#D0E3F0', 0.012);

  // 2. 3D Environment & Lighting
  const arena = createEnvironment3D('palace');
  scene.add(arena);

  lightRig(scene, {
    key: '#FFF0D4',
    keyI: 3.6,
    keyPos: [6, 14, 8],
    target: [0, 1.2, 0],
    rimCol: '#90CAF9',
    rimI: 2.4,
    sky: '#E3F2FD',
    ground: '#5D4037',
    hemiI: 1.0,
    shadowBox: 14
  });

  // 3. True 3D Humanoid Character Rig
  const hero = createCharacter3D({ archetype: 'chanakya_scholar' });
  hero.root.position.set(0, 0, 0);
  scene.add(hero.root);

  const cam = camera(36);

  const LOOKS = {
    wide: { bloom: 0.28, aperture: 0.0008, maxblur: 0.006, warm: 0.03, sat: 1.15 },
    medium: { bloom: 0.32, aperture: 0.0016, maxblur: 0.007, warm: 0.04, sat: 1.18 },
    dramatic: { bloom: 0.40, aperture: 0.0022, maxblur: 0.009, warm: 0.05, sat: 1.22 }
  };

  const shoot = (from, to, at, at2, k, look, focusDist) => {
    cam.position.copy(mixV3(from, to, k));
    const target = at2 ? mixV3(at, at2, k) : at;
    cam.lookAt(target);
    E.render(scene, cam, {
      ...look,
      focus: focusDist ?? cam.position.distanceTo(target)
    });
  };

  // S01: Establishing Crane Shot (Line 0)
  add({ id: 'S01', at: cut(0), note: '3D crane establishing shot', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d, 0, 1));
    hero.root.position.set(0, 0, 0);
    hero.setIdle(t);
    hero.setTalk(talk(t));
    const camFrom = V3(3.2, 6.5, 9.5);
    const camTo = V3(1.2, 2.2, 6.2);
    const lookFrom = V3(0, 1.4, 0);
    const lookTo = V3(0, 1.2, 0);
    shoot(camFrom, camTo, lookFrom, lookTo, k, LOOKS.wide);
    blit();
  } });
  cue(cut(0), 'whoosh', { gain: 0.7 });
  cue(cut(0) + 0.3, 'tock', { gain: 0.6 });

  // S02: Medium Explaining Push-in (Line 1)
  add({ id: 'S02', at: cut(1), note: 'Medium push-in with 3D explaining gesture', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d, 0, 1));
    hero.root.position.set(0, 0, 0);
    hero.setGesture('explain', t);
    hero.setTalk(talk(t));
    const camFrom = V3(-1.8, 1.4, 4.5);
    const camTo = V3(-0.6, 1.35, 3.2);
    const target = V3(0, 1.3, 0);
    shoot(camFrom, camTo, target, null, k, LOOKS.medium);
    blit();
  } });
  cue(cut(1), 'whoosh', { gain: 0.8 });
  cue(cut(1) + 0.25, 'pop', { gain: 0.6 });

  // S03: Dynamic 45-deg Angle (Line 2)
  add({ id: 'S03', at: cut(2), note: '45-degree angle profile with DoF blur', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d, 0, 1));
    hero.root.position.set(0, 0, 0);
    hero.setGesture('think', t);
    hero.setTalk(talk(t));
    const camFrom = V3(2.6, 1.6, 3.8);
    const camTo = V3(1.6, 1.45, 2.8);
    const target = V3(0, 1.3, 0);
    shoot(camFrom, camTo, target, null, k, LOOKS.dramatic);
    blit();
  } });
  cue(cut(2), 'whoosh', { gain: 0.7 });
  cue(cut(2) + 0.25, 'sparkle', { gain: 0.6 });

  // S04: Dramatic Low Angle (Line 3)
  add({ id: 'S04', at: cut(3), note: 'Heroic low-angle reaction shot', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d, 0, 1));
    hero.root.position.set(0, 0, 0);
    hero.setGesture('shock', t);
    hero.setTalk(talk(t));
    const camFrom = V3(-1.4, 0.75, 2.8);
    const camTo = V3(-0.5, 0.9, 2.1);
    const target = V3(0, 1.35, 0);
    shoot(camFrom, camTo, target, null, k, LOOKS.dramatic);
    blit();
  } });
  cue(cut(3), 'whoosh', { gain: 0.9 });
  cue(cut(3) + 0.3, 'slam', { gain: 0.8 });

  // S05: Expressive Close-Up (Line 4)
  add({ id: 'S05', at: cut(4), note: 'Expressive close-up on 3D character face', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d, 0, 1));
    hero.root.position.set(0, 0, 0);
    hero.setGesture('excited', t);
    hero.setTalk(talk(t));
    const camFrom = V3(0.2, 1.35, 2.0);
    const camTo = V3(-0.1, 1.38, 1.55);
    const target = V3(0, 1.38, 0);
    shoot(camFrom, camTo, target, null, k, LOOKS.dramatic, 1.7);
    blit();
  } });
  cue(cut(4), 'whoosh', { gain: 0.8 });
  cue(cut(4) + 0.25, 'slam', { gain: 0.9 });

  // S06: Lateral Tracking Walk (Line 5)
  add({ id: 'S06', at: cut(5), note: '3D bipedal walk cycle tracking camera', draw(lt, d, t, blit) {
    const k = clamp(lt / d, 0, 1);
    const walkZ = lerp(-2.0, 2.0, k);
    hero.root.position.set(0, 0, walkZ);
    hero.setWalk(t, 5.5);
    hero.setTalk(talk(t));
    const camFrom = V3(-3.2, 1.3, walkZ + 1.2);
    const target = V3(0, 1.2, walkZ);
    shoot(camFrom, camFrom, target, null, 0, LOOKS.medium, 3.2);
    blit();
  } });
  cue(cut(5), 'whoosh', { gain: 0.7 });
  cue(cut(5) + 0.3, 'pop', { gain: 0.6 });

  // S07: 180-Degree Orbit Celebration (Line 6)
  add({ id: 'S07', at: cut(6), note: '180-degree camera orbit celebration', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d, 0, 1));
    hero.root.position.set(0, 0, 0);
    hero.setGesture('excited', t);
    hero.setTalk(talk(t));
    const radius = 2.8;
    const angle = lerp(Math.PI * 0.2, Math.PI * 1.15, k);
    const camX = Math.sin(angle) * radius;
    const camZ = Math.cos(angle) * radius;
    const camPos = V3(camX, lerp(1.3, 1.7, Math.sin(k * Math.PI)), camZ);
    const target = V3(0, 1.25, 0);
    shoot(camPos, camPos, target, null, 0, LOOKS.wide, radius);
    blit();
  } });
  cue(cut(6), 'whoosh', { gain: 0.7 });
  cue(cut(6) + 0.3, 'sparkle', { gain: 0.8 });
  cue(cut(6) + 1.2, 'tock', { gain: 0.6 });

  // S08: Establishing Crane Shot (Line 7)
  add({ id: 'S08', at: cut(7), note: '3D crane establishing shot', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d, 0, 1));
    hero.root.position.set(0, 0, 0);
    hero.setIdle(t);
    hero.setTalk(talk(t));
    const camFrom = V3(3.2, 6.5, 9.5);
    const camTo = V3(1.2, 2.2, 6.2);
    const lookFrom = V3(0, 1.4, 0);
    const lookTo = V3(0, 1.2, 0);
    shoot(camFrom, camTo, lookFrom, lookTo, k, LOOKS.wide);
    blit();
  } });
  cue(cut(7), 'whoosh', { gain: 0.7 });
  cue(cut(7) + 0.3, 'tock', { gain: 0.6 });

  // S09: Medium Explaining Push-in (Line 8)
  add({ id: 'S09', at: cut(8), note: 'Medium push-in with 3D explaining gesture', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d, 0, 1));
    hero.root.position.set(0, 0, 0);
    hero.setGesture('explain', t);
    hero.setTalk(talk(t));
    const camFrom = V3(-1.8, 1.4, 4.5);
    const camTo = V3(-0.6, 1.35, 3.2);
    const target = V3(0, 1.3, 0);
    shoot(camFrom, camTo, target, null, k, LOOKS.medium);
    blit();
  } });
  cue(cut(8), 'whoosh', { gain: 0.8 });
  cue(cut(8) + 0.25, 'pop', { gain: 0.6 });

  return { shots: S, cues: CUES };
}
