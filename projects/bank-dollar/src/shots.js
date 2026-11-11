// THE MAN WHO BOUGHT A BANK FOR $1: the shot list (Tall Tale 3D style)
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

// Characters
const LOOK = {
  theaster: { body: '#3C6FB6', hat: 'cap', hatCol: '#2A4E8A', neck: 'bowtie', neckCol: '#F2C230', pattern: 'vest', patCol: '#1E355B' },
  mayor: { body: '#4A4560', hat: 'tophat', hatCol: '#2A2638', neck: 'tie', neckCol: '#D8343F', extra: ['mustache'] },
  banker: { body: '#7A5236', hat: 'bowler', hatCol: '#3A2A20', neck: 'bowtie', neckCol: '#3C6FB6', extra: ['glasses'] },
  collector: { body: '#E58A6A', hat: 'boater', hatCol: '#E8C77A', neck: 'collar', extra: ['monocle'] },
  citizen: { body: '#6FA35A', hat: 'cap', hatCol: '#4A7A3A', neck: 'collar' },
};
const person = (k, opts) => new Toon({ ...LOOK[k], extra: [...(LOOK[k].extra || [])] }, opts);

export function buildShots(E) {
  const S = [], CUES = [], add = (o) => (S.push(o), o), cue = (t, type, o = {}) => CUES.push({ t: +t.toFixed(3), type, ...o });
  const cut = (i) => (i === 0 ? 0 : L(i) - 0.06);
  const cam = camera(36);
  const LOOKS = {
    street: { bloom: 0.18, aperture: 0.0012, maxblur: 0.008 },
    room: { bloom: 0.25, aperture: 0.001, maxblur: 0.008 },
    vault: { bloom: 0.35, aperture: 0.0015, maxblur: 0.009 }
  };
  const shoot = (scene, people, from, to, at, at2, k, look, focus) => {
    if (cam.fov !== (look.fov || 36)) { cam.fov = look.fov || 36; cam.updateProjectionMatrix(); }
    cam.position.copy(mix(from, to, k)); cam.lookAt(at2 ? mix(at, at2, k) : at);
    people.forEach((p) => p.face(cam));
    E.render(scene, cam, { ...look, focus: focus ?? cam.position.distanceTo(at2 ? mix(at, at2, k) : at) });
  };

  // Sets
  const SHOP_ORDER = [
    ['BAKERY', '#C9603F', 'brick', '#D8343F'], ['CAFE', '#E58A6A', 'wood', '#2E4E3F'],
    ['STONY BANK', '#C7B79A', 'brick', '#2A4E8A'], ['CITY HALL', '#7FA36A', 'brick', '#D8343F'],
    ['GALLERY', '#B98ACF', 'wood', '#F2C230'], ['HOTEL', '#9E4A3A', 'brick', null]
  ];
  const ST = WD.mainStreet(E, { shops: SHOP_ORDER });
  ST.sun.key.target.position.set(-4, 0, 0); ST.sun.key.position.set(5, 13, 6);
  const BK = ST.buildings.find((b) => b.name === 'STONY BANK') || ST.buildings[2];

  const stHero = person('theaster');
  const stCitizen = person('citizen');
  [stHero, stCitizen].forEach((p) => ST.scene.add(p.group));
  const streetPeople = () => [...ST.people, stHero, stCitizen];

  // City Hall Office
  const viewSnap = (scene, from, look) => {
    const c = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 800);
    c.position.copy(from); c.lookAt(look);
    const t = WD.snapshot(E, scene, c); t.wrapS = THREE.RepeatWrapping; return t;
  };
  const OF = WD.interior(E, {
    w: 6, depth: 7, wall: '#2E4E8A', motif: '#3A5E9C', ceiling: '#2A2638', floor: '#7A3E24',
    signText: 'CITY HALL', counterOn: false, view: viewSnap(ST.scene, V3(0, 6, 6), V3(0, 3, -40))
  });
  const desk = PR.desk(2.4); desk.position.set(0, 0, -3.2); OF.scene.add(desk);
  const ofMayor = person('mayor'); ofMayor.at(0, 0, -4.0); OF.scene.add(ofMayor.group);
  const ofHero = person('theaster'); ofHero.at(-1.4, 0, -2.4); OF.scene.add(ofHero.group);
  const ofBanker = person('banker'); ofBanker.at(1.4, 0, -2.4); ofBanker.group.visible = false; OF.scene.add(ofBanker.group);
  const ofCollector = person('collector'); ofCollector.at(1.4, 0, -2.4); ofCollector.group.visible = false; OF.scene.add(ofCollector.group);
  const officePeople = [ofMayor, ofHero, ofBanker, ofCollector];

  // Old Bank Interior / Vault
  const IN = WD.interior(E, {
    w: 6, depth: 7, wall: '#5C5446', motif: '#6E6454', ceiling: '#3A342B', floor: '#423B30',
    signText: 'VAULT & MARBLE', counterOn: true, view: viewSnap(ST.scene, V3(2, 2, -10), V3(-3, 2, 10))
  });
  const inHero = person('theaster'); inHero.at(1.8, 0, -2.4); IN.scene.add(inHero.group);
  const inCollector = person('collector'); inCollector.at(3.6, 0, -2.5); IN.scene.add(inCollector.group);
  const inPeople = [inHero, inCollector];

  // ── S00: "In 2013, an artist in Chicago bought an entire historic bank" ──
  add({ id: 'S00', at: cut(0), note: 'Crane down main street to the historic bank, Theaster standing proud', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    const bz = BK.z;
    stHero.at(-5.0, 0.18, bz - 1.2);
    stHero.set({ mood: 'proud', armL: [25, 10], armR: [25, 10], blink: blink(t) });
    stCitizen.at(-3.6, 0.18, bz - 3.0 + k * 1.5);
    stCitizen.set({ legs: 'walk', phase: t * 7, mood: 'happy', blink: blink(t, 1) });
    shoot(ST.scene, streetPeople(), V3(2.0, 7.5, bz - 18), V3(-1.8, 2.2, bz - 6.5), V3(-4.0, 3.5, bz), V3(-4.8, 1.4, bz - 1.2), k, { ...LOOKS.street, fov: 42 });
    blit();
  } });
  cue(cut(0) + 0.05, 'whoosh', { gain: 0.6 });
  cue(Wd('2013', 0), 'ding', { gain: 0.7 });

  // ── S01: "for one single dollar." ──
  add({ id: 'S01', at: cut(1), note: 'Punch-in on Theaster holding a green single dollar bill', draw(lt, d, t, blit) {
    const k = eo(clamp(lt / d));
    const bz = BK.z;
    stHero.at(-5.0, 0.18, bz - 1.2);
    stHero.set({ mood: 'smug', armR: [70, -60], holdR: PROPS.bill, blink: blink(t) });
    shoot(ST.scene, streetPeople(), V3(-3.2, 1.8, bz - 3.2), V3(-3.8, 1.6, bz - 2.5), V3(-4.9, 1.45, bz - 1.2), null, k, LOOKS.street, 1.6);
    blit();
  } });
  cue(cut(1), 'whoosh');
  cue(Wd('dollar', 1), 'sparkle', { gain: 0.8 });

  // ── S02: "The city was about to bulldoze the crumbling building," ──
  add({ id: 'S02', at: cut(2), note: 'City Hall: Mayor worried behind desk with demolition notice', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    ofMayor.group.visible = true; ofHero.group.visible = false; ofBanker.group.visible = false; ofCollector.group.visible = false;
    ofMayor.set({ mood: 'worried', armR: [40, -80], holdR: PROPS.paper('DEMOLISH'), sweat: 1, blink: blink(t) });
    shoot(OF.scene, officePeople, V3(-0.5, 2.1, -1.0), V3(-0.2, 1.9, -1.8), V3(0, 1.5, -4.0), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(2), 'whoosh');
  cue(Wd('bulldoze', 2), 'slam', { gain: 0.7 });

  // ── S03: "because the roof was leaking and repairs cost millions." ──
  add({ id: 'S03', at: cut(3), note: 'Inside the crumbling building, mayor sweating over costs', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    inHero.at(1.5, 0, -2.6); inHero.group.visible = true; inCollector.group.visible = false;
    inHero.set({ mood: 'worried', armL: [30, -30], armR: [30, 30], blink: blink(t) });
    shoot(IN.scene, inPeople, V3(0, 2.2, 0.5), V3(0.5, 2.0, -0.6), V3(1.8, 1.6, -2.5), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(3), 'whoosh');
  cue(Wd('leaking', 3), 'plop', { gain: 0.7 });
  cue(Wd('millions', 3), 'boing', { gain: 0.6 });

  // ── S04: "So Theaster Gates offered them a single buck," ──
  add({ id: 'S04', at: cut(4), note: 'Theaster steps into City Hall offering his $1 bill to the mayor', draw(lt, d, t, blit) {
    const k = eo(clamp(lt / d));
    ofMayor.group.visible = true; ofHero.group.visible = true; ofBanker.group.visible = false; ofCollector.group.visible = false;
    ofMayor.set({ mood: 'shock', armL: [20, 20], armR: [20, 20], sweat: 1, blink: blink(t) });
    ofHero.at(-1.2 + k * 0.4, 0, -2.4);
    ofHero.set({ mood: 'smug', armR: [60, -70], holdR: PROPS.bill, blink: blink(t, 1) });
    shoot(OF.scene, officePeople, V3(-2.2, 2.1, -0.8), V3(-1.6, 1.9, -1.2), V3(-0.4, 1.5, -3.2), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(4), 'whoosh');
  cue(Wd('buck', 4), 'pop', { gain: 0.7 });

  // ── S05: "and City Hall handed him the keys." ──
  add({ id: 'S05', at: cut(5), note: 'Mayor happily hands over a giant golden key', draw(lt, d, t, blit) {
    const k = eo(clamp(lt / d));
    ofMayor.group.visible = true; ofHero.group.visible = true; ofBanker.group.visible = false; ofCollector.group.visible = false;
    ofMayor.set({ mood: 'happy', armL: [70, -80], holdL: PROPS.key, blink: blink(t) });
    ofHero.set({ mood: 'happy', armL: [50, -50], armR: [50, -50], blink: blink(t, 1) });
    shoot(OF.scene, officePeople, V3(-0.3, 1.9, -1.6), V3(-0.1, 1.8, -2.0), V3(0, 1.45, -3.4), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(5), 'whoosh');
  cue(Wd('keys', 5), 'ding', { gain: 0.8 });

  // ── S06: "The catch? He had no money, and banks refused to give him a loan." ──
  add({ id: 'S06', at: cut(6), note: 'Wall Street banker laughs smugly, crossing arms with refusal', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    ofMayor.group.visible = false; ofHero.group.visible = true; ofBanker.group.visible = true; ofCollector.group.visible = false;
    ofBanker.at(0.8, 0, -2.6); ofHero.at(-1.0, 0, -2.4);
    ofHero.set({ mood: 'worried', armL: [20, 20], sweat: 1, blink: blink(t) });
    ofBanker.set({ mood: 'smug', armL: [40, -70], armR: [40, -70], blink: blink(t, 1.2) });
    shoot(OF.scene, officePeople, V3(0.2, 2.0, -0.6), V3(0.0, 1.85, -1.2), V3(0.1, 1.5, -2.5), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(6), 'whoosh');
  cue(Wd('refused', 6), 'thud', { gain: 0.7 });

  // ── S07: "So he salvaged the discarded marble slabs from the walls," ──
  add({ id: 'S07', at: cut(7), note: 'Theaster inside the bank inspecting salvageable marble slabs', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    inHero.at(1.8, 0, -2.4); inHero.group.visible = true; inCollector.group.visible = false;
    inHero.set({ mood: 'happy', armR: [60, -50], holdR: PROPS.paper('MARBLE'), blink: blink(t) });
    shoot(IN.scene, inPeople, V3(0.5, 2.1, 0.2), V3(1.0, 1.9, -0.8), V3(2.0, 1.5, -2.4), null, k, LOOKS.vault);
    blit();
  } });
  cue(cut(7), 'whoosh');
  cue(Wd('marble', 7), 'slide', { dur: 0.8, gain: 0.5 });

  // ── S08: "engraved them as artistic bank bonds," ──
  add({ id: 'S08', at: cut(8), note: 'Close-up on Theaster presenting the engraved Bank Bond', draw(lt, d, t, blit) {
    const k = eo(clamp(lt / d));
    inHero.at(2.0, 0, -2.2); inHero.group.visible = true; inCollector.group.visible = false;
    inHero.set({ mood: 'proud', armL: [50, -60], armR: [60, -70], holdR: PROPS.paper('ART BOND'), blink: blink(t) });
    shoot(IN.scene, inPeople, V3(1.4, 1.95, -0.8), V3(1.65, 1.85, -1.2), V3(2.1, 1.55, -2.2), null, k, LOOKS.vault, 1.5);
    blit();
  } });
  cue(cut(8), 'whoosh');
  cue(Wd('bonds', 8), 'sparkle', { gain: 0.8 });

  // ── S09: "and sold each slab for five thousand dollars." ──
  add({ id: 'S09', at: cut(9), note: 'Wealthy art collector with monocle hands over a big stack of cash', draw(lt, d, t, blit) {
    const k = eo(clamp(lt / d));
    inHero.at(1.5, 0, -2.5); inCollector.at(3.0, 0, -2.5);
    inHero.group.visible = true; inCollector.group.visible = true;
    inCollector.set({ mood: 'proud', armL: [60, -80], holdL: PROPS.stack, blink: blink(t) });
    inHero.set({ mood: 'happy', armR: [50, -50], blink: blink(t, 1) });
    shoot(IN.scene, inPeople, V3(2.2, 1.95, -0.6), V3(2.2, 1.85, -1.1), V3(2.25, 1.5, -2.5), null, k, LOOKS.room);
    blit();
  } });
  cue(cut(9), 'whoosh');
  cue(Wd('five', 9), 'ding', { gain: 0.8 });
  cue(Wd('dollars', 9), 'pop', { gain: 0.6 });

  // ── S10: "He raised millions, restored the bank into a grand arts palace," ──
  add({ id: 'S10', at: cut(10), note: 'Wide celebration outside the restored arts bank, crowd cheering', draw(lt, d, t, blit) {
    const k = eio(clamp(lt / d));
    const bz = BK.z;
    stHero.at(-5.0, 0.18, bz - 1.2);
    stHero.set({ mood: 'happy', armL: [120, 30], armR: [120, 30], blink: blink(t) });
    stCitizen.at(-3.8, 0.18, bz - 1.8);
    stCitizen.set({ mood: 'laugh', armL: [100, 20], armR: [100, 20], blink: blink(t, 1) });
    shoot(ST.scene, streetPeople(), V3(1.0, 5.0, bz - 14), V3(-1.0, 3.2, bz - 8), V3(-3.5, 2.5, bz), V3(-4.5, 1.6, bz - 1.2), k, LOOKS.street);
    blit();
  } });
  cue(cut(10), 'whoosh');
  cue(Wd('millions', 10), 'sparkle', { gain: 0.7 });

  // ── S11: "and never owed Wall Street a single dime." ──
  add({ id: 'S11', at: cut(11), note: 'Theaster winks at camera with smug grin holding his original lucky $1 bill', draw(lt, d, t, blit) {
    const k = eo(clamp(lt / d));
    const bz = BK.z;
    stHero.at(-5.0, 0.18, bz - 1.2);
    stHero.set({ mood: 'smug', armR: [70, -60], holdR: PROPS.bill, blink: blink(t), look: [0.1, 0] });
    shoot(ST.scene, streetPeople(), V3(-3.4, 1.8, bz - 3.2), V3(-3.9, 1.6, bz - 2.4), V3(-5.0, 1.45, bz - 1.2), null, k, LOOKS.street, 1.4);
    blit();
  } });
  cue(cut(11), 'whoosh');
  cue(Wd('dime', 11), 'ding', { gain: 0.9 });

  return { shots: S, cues: CUES };
}
