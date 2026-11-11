// Auto-generated dynamic shots for: "The Neuroscience of Indian Temple Bells"
import * as THREE from 'three';
import { ctx, clamp, lerp, seg, eo, eio, eob } from './core/lib.js';
import { L, Wd, T } from './core/timing.js';
import { camera } from './core/engine.js';
import * as WD from './core/world.js';
import * as PR from './core/props.js';
import { Toon, PROPS } from './core/toon.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const mix = (a, b, k) => a.clone().lerp(b, k);
const talk = (t, on = 1) => (on ? 0.25 + 0.75 * Math.abs(Math.sin(t * 13)) * (0.6 + 0.4 * Math.sin(t * 5.3)) : 0);
const blink = (t, off = 0) => (((t + off) % 3.3) < 0.12 ? 1 : 0);

const LOOK = {
  theaster: { body: '#3C6FB6', hat: 'cap', hatCol: '#2A4E8A', neck: 'bowtie', neckCol: '#F2C230', pattern: 'vest', patCol: '#1E355B' },
  shivaji: { body: '#E87A30', hat: 'cap', hatCol: '#C95514', neck: 'scarf', neckCol: '#F2C230', pattern: 'vest', patCol: '#8A2E14', extra: ['mustache'] },
  chanakya: { body: '#E58A6A', hat: 'bun', hatCol: '#3A2A20', neck: 'scarf', neckCol: '#E8C77A', pattern: 'apron', patCol: '#FFF4E0', extra: ['glasses'] },
  desi_uncle: { body: '#C9603F', hat: 'cap', hatCol: '#2E4E8A', neck: 'collar', pattern: 'vest', patCol: '#2B5E73', extra: ['mustache', 'glasses'] },
  indian_techie: { body: '#2A9D8F', hat: 'beanie', hatCol: '#264653', neck: 'collar', pattern: 'plain', extra: ['freckles'] },
  curious_student: { body: '#F4A261', hat: 'bow', hatCol: '#E76F51', neck: 'collar', pattern: 'stripes', patCol: '#264653' },
  authority: { body: '#4A4560', hat: 'tophat', hatCol: '#2A2638', neck: 'tie', neckCol: '#D8343F', extra: ['mustache'] },
  companion: { body: '#6FA35A', hat: 'cap', hatCol: '#4A7A3A', neck: 'collar' }
};

const person = (k, opts) => new Toon({ ...(LOOK[k] || LOOK.theaster), extra: [...(LOOK[k]?.extra || [])] }, opts);

export function buildShots(E) {
  const S = [], CUES = [], add = (o) => (S.push(o), o), cue = (t, type, o = {}) => CUES.push({ t: +t.toFixed(3), type, ...o });
  const cut = (i) => (i === 0 ? 0 : L(i) - 0.06);
  const cam = camera(36);
  const LOOKS = {
    street: { bloom: 0.18, aperture: 0.0012, maxblur: 0.008 },
    room: { bloom: 0.25, aperture: 0.001, maxblur: 0.008 }
  };
  const shoot = (scene, people, from, to, at, at2, k, look, focus) => {
    if (cam.fov !== (look.fov || 36)) { cam.fov = look.fov || 36; cam.updateProjectionMatrix(); }
    cam.position.copy(mix(from, to, k)); cam.lookAt(at2 ? mix(at, at2, k) : at);
    people.forEach((p) => p.face(cam));
    E.render(scene, cam, { ...look, focus: focus ?? cam.position.distanceTo(at2 ? mix(at, at2, k) : at) });
  };

  const SHOP_ORDER = [
    ['ACADEMY', '#C9603F', 'brick', '#D8343F'], ['HALL', '#7FA36A', 'brick', '#2E4E8A'],
    ['PALACE', '#C7B79A', 'brick', '#2A4E8A'], ['LIBRARY', '#B98ACF', 'wood', '#F2C230']
  ];
  const ST = WD.mainStreet(E, { shops: SHOP_ORDER });
  ST.sun.key.target.position.set(-4, 0, 0); ST.sun.key.position.set(5, 13, 6);
  const BLD = ST.buildings[1] || ST.buildings[0];

  const hero = person("theaster");
  const comp = person('companion');
  [hero, comp].forEach((p) => ST.scene.add(p.group));
  const streetPeople = () => [...ST.people, hero, comp];

  const viewSnap = (scene, from, look) => {
    const c = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 800);
    c.position.copy(from); c.lookAt(look);
    const t = WD.snapshot(E, scene, c); t.wrapS = THREE.RepeatWrapping; return t;
  };
  const OF = WD.interior(E, {
    w: 6, depth: 7, wall: '#2E4E8A', motif: '#3A5E9C', ceiling: '#2A2638', floor: '#7A3E24',
    signText: 'COUNCIL', counterOn: false, view: viewSnap(ST.scene, V3(0, 6, 6), V3(0, 3, -40))
  });
  const desk = PR.desk(2.4); desk.position.set(0, 0, -3.2); OF.scene.add(desk);
  const ofHero = person("theaster"); ofHero.at(-1.4, 0, -2.4); OF.scene.add(ofHero.group);
  const ofAuth = person('authority'); ofAuth.at(0, 0, -4.0); OF.scene.add(ofAuth.group);
  const officePeople = [ofHero, ofAuth];

  // S00: Line 0
  add({ id: 'S00', at: cut(0), note: 'Scene beat 0', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    const bz = BLD.z;
    hero.at(-5.0, 0.18, bz - 1.2);
    hero.set({ mood: 'proud', talk: talk(t), armL: [30, 20], armR: [40, -40], blink: blink(t) });
    comp.at(-3.6, 0.18, bz - 2.5 + k * 1.2);
    comp.set({ legs: 'walk', phase: t * 7, mood: 'happy', blink: blink(t, 1) });
    shoot(ST.scene, streetPeople(), V3(1.5, 4.5, bz - 12), V3(-1.2, 2.4, bz - 7), V3(-4.0, 2.2, bz), V3(-4.8, 1.4, bz - 1.2), k, LOOKS.street);
    blit();
  } });
  cue(cut(0), 'whoosh');
  cue(cut(0) + 0.25, 'whoosh', { gain: 0.7 });

  // S01: Line 1
  add({ id: 'S01', at: cut(1), note: 'Scene beat 1', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    const bz = BLD.z;
    hero.at(-5.0, 0.18, bz - 1.2);
    hero.set({ mood: 'smug', talk: talk(t), armL: [30, 20], armR: [40, -40], blink: blink(t) });
    comp.at(-3.6, 0.18, bz - 2.5 + k * 1.2);
    comp.set({ legs: 'walk', phase: t * 7, mood: 'happy', blink: blink(t, 1) });
    shoot(ST.scene, streetPeople(), V3(1.5, 4.5, bz - 12), V3(-1.2, 2.4, bz - 7), V3(-4.0, 2.2, bz), V3(-4.8, 1.4, bz - 1.2), k, LOOKS.street);
    blit();
  } });
  cue(cut(1), 'whoosh');
  cue(cut(1) + 0.25, 'ding', { gain: 0.7 });

  // S02: Line 2
  add({ id: 'S02', at: cut(2), note: 'Scene beat 2', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    ofHero.at(-1.2 + k * 0.3, 0, -2.4);
    ofHero.set({ mood: 'happy', talk: talk(t), armR: [50, -50], blink: blink(t) });
    ofAuth.set({ mood: 'happy', blink: blink(t, 1) });
    shoot(OF.scene, officePeople, V3(-1.8, 2.0, -1.0), V3(-1.2, 1.85, -1.4), V3(0, 1.5, -3.5), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(2), 'whoosh');
  cue(cut(2) + 0.25, 'pop', { gain: 0.7 });

  // S03: Line 3
  add({ id: 'S03', at: cut(3), note: 'Scene beat 3', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    ofHero.at(-1.2 + k * 0.3, 0, -2.4);
    ofHero.set({ mood: 'shock', talk: talk(t), armR: [50, -50], blink: blink(t) });
    ofAuth.set({ mood: 'shock', blink: blink(t, 1) });
    shoot(OF.scene, officePeople, V3(-1.8, 2.0, -1.0), V3(-1.2, 1.85, -1.4), V3(0, 1.5, -3.5), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(3), 'whoosh');
  cue(cut(3) + 0.25, 'sparkle', { gain: 0.7 });

  // S04: Line 4
  add({ id: 'S04', at: cut(4), note: 'Scene beat 4', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    ofHero.at(-1.2 + k * 0.3, 0, -2.4);
    ofHero.set({ mood: 'worried', talk: talk(t), armR: [50, -50], blink: blink(t) });
    ofAuth.set({ mood: 'happy', blink: blink(t, 1) });
    shoot(OF.scene, officePeople, V3(-1.8, 2.0, -1.0), V3(-1.2, 1.85, -1.4), V3(0, 1.5, -3.5), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(4), 'whoosh');
  cue(cut(4) + 0.25, 'slam', { gain: 0.7 });

  // S05: Line 5
  add({ id: 'S05', at: cut(5), note: 'Scene beat 5', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    ofHero.at(-1.2 + k * 0.3, 0, -2.4);
    ofHero.set({ mood: 'laugh', talk: talk(t), armR: [50, -50], blink: blink(t) });
    ofAuth.set({ mood: 'shock', blink: blink(t, 1) });
    shoot(OF.scene, officePeople, V3(-1.8, 2.0, -1.0), V3(-1.2, 1.85, -1.4), V3(0, 1.5, -3.5), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(5), 'whoosh');
  cue(cut(5) + 0.25, 'slide', { gain: 0.7 });

  // S06: Line 6
  add({ id: 'S06', at: cut(6), note: 'Scene beat 6', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    ofHero.at(-1.2 + k * 0.3, 0, -2.4);
    ofHero.set({ mood: 'proud', talk: talk(t), armR: [50, -50], blink: blink(t) });
    ofAuth.set({ mood: 'happy', blink: blink(t, 1) });
    shoot(OF.scene, officePeople, V3(-1.8, 2.0, -1.0), V3(-1.2, 1.85, -1.4), V3(0, 1.5, -3.5), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(6), 'whoosh');
  cue(cut(6) + 0.25, 'whoosh', { gain: 0.7 });

  // S07: Line 7
  add({ id: 'S07', at: cut(7), note: 'Scene beat 7', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    ofHero.at(-1.2 + k * 0.3, 0, -2.4);
    ofHero.set({ mood: 'smug', talk: talk(t), armR: [50, -50], blink: blink(t) });
    ofAuth.set({ mood: 'shock', blink: blink(t, 1) });
    shoot(OF.scene, officePeople, V3(-1.8, 2.0, -1.0), V3(-1.2, 1.85, -1.4), V3(0, 1.5, -3.5), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(7), 'whoosh');
  cue(cut(7) + 0.25, 'ding', { gain: 0.7 });

  // S08: Line 8
  add({ id: 'S08', at: cut(8), note: 'Scene beat 8', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    const bz = BLD.z;
    hero.at(-5.0, 0.18, bz - 1.2);
    hero.set({ mood: 'happy', talk: talk(t), armL: [30, 20], armR: [40, -40], blink: blink(t) });
    comp.at(-3.6, 0.18, bz - 2.5 + k * 1.2);
    comp.set({ legs: 'walk', phase: t * 7, mood: 'happy', blink: blink(t, 1) });
    shoot(ST.scene, streetPeople(), V3(1.5, 4.5, bz - 12), V3(-1.2, 2.4, bz - 7), V3(-4.0, 2.2, bz), V3(-4.8, 1.4, bz - 1.2), k, LOOKS.street);
    blit();
  } });
  cue(cut(8), 'whoosh');
  cue(cut(8) + 0.25, 'pop', { gain: 0.7 });

  // S09: Line 9
  add({ id: 'S09', at: cut(9), note: 'Scene beat 9', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    const bz = BLD.z;
    hero.at(-5.0, 0.18, bz - 1.2);
    hero.set({ mood: 'shock', talk: talk(t), armL: [30, 20], armR: [40, -40], blink: blink(t) });
    comp.at(-3.6, 0.18, bz - 2.5 + k * 1.2);
    comp.set({ legs: 'walk', phase: t * 7, mood: 'happy', blink: blink(t, 1) });
    shoot(ST.scene, streetPeople(), V3(1.5, 4.5, bz - 12), V3(-1.2, 2.4, bz - 7), V3(-4.0, 2.2, bz), V3(-4.8, 1.4, bz - 1.2), k, LOOKS.street);
    blit();
  } });
  cue(cut(9), 'whoosh');
  cue(cut(9) + 0.25, 'sparkle', { gain: 0.7 });

  return { shots: S, cues: CUES };
}
