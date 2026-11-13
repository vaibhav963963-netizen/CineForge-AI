// Universal High-Fidelity 3D Cartoon Character Engine
// True 3D articulated humanoid character rigs with PBR materials, procedural clothing,
// expressive 3D facial features, multi-archetype hairstyles, accessories, and kinematic animation.

import * as THREE from 'three';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ============================================================================
// CHARACTER PRESETS & ARCHETYPES
// ============================================================================
// Designs live in one folder per character: ./characters/<id>/index.js (registry: ./characters/index.js)
import { DESIGNS } from './characters/index.js';
export const ARCHETYPES = DESIGNS;

export function createCharacter3D(config = {}) {
  const presetKey = config.archetype || 'desi_hero';
  const cfg = { ...(ARCHETYPES[presetKey] || ARCHETYPES.desi_hero), ...config };

  const root = new THREE.Group();
  root.name = 'Character3D_' + (cfg.name || 'Hero');

  // Materials (PBR standard for cinematic cartoon rendering)
  const skinMat = new THREE.MeshStandardMaterial({
    color: cfg.skin,
    roughness: 0.55,
    metalness: 0.04
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: cfg.hairColor,
    roughness: 0.85,
    metalness: 0.05
  });
  const shirtMat = new THREE.MeshStandardMaterial({
    color: cfg.shirt,
    roughness: 0.7,
    metalness: 0.02
  });
  const vestMat = new THREE.MeshStandardMaterial({
    color: cfg.vest || cfg.shirt,
    roughness: 0.65,
    metalness: 0.05
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: cfg.pants,
    roughness: 0.75,
    metalness: 0.02
  });
  const shoeMat = new THREE.MeshStandardMaterial({
    color: cfg.shoes,
    roughness: 0.45,
    metalness: 0.1
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: cfg.trim || '#FFD54F',
    roughness: 0.5,
    metalness: 0.15
  });

  // ---------- SKELETAL HIERARCHY ----------
  // root -> hips -> torso -> neck -> head
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  root.add(hips);

  // Pelvis mesh
  const pelvisGeo = new THREE.CylinderGeometry(0.18, 0.16, 0.22, 16);
  const pelvis = new THREE.Mesh(pelvisGeo, pantsMat);
  pelvis.castShadow = true; pelvis.receiveShadow = true;
  hips.add(pelvis);

  // Torso
  const torso = new THREE.Group();
  torso.position.y = 0.15;
  hips.add(torso);

  // Upper body chest mesh
  const chestGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.44, 16);
  const chest = new THREE.Mesh(chestGeo, shirtMat);
  chest.position.y = 0.22;
  chest.castShadow = true; chest.receiveShadow = true;
  torso.add(chest);

  // Layered Vest / Jacket / Armor
  if (cfg.vest && cfg.vest !== cfg.shirt) {
    const vestGeo = new THREE.CylinderGeometry(0.235, 0.19, 0.42, 16, 1, true, 0.4, Math.PI * 1.6);
    const vestMesh = new THREE.Mesh(vestGeo, vestMat);
    vestMesh.position.y = 0.22;
    vestMesh.rotation.y = Math.PI * 0.2;
    vestMesh.castShadow = true;
    torso.add(vestMesh);
  }

  // Shirt Collar
  const collarGeo = new THREE.TorusGeometry(0.12, 0.025, 8, 16);
  const collar = new THREE.Mesh(collarGeo, trimMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.44;
  torso.add(collar);

  // Neck & Head
  const neck = new THREE.Group();
  neck.position.y = 0.45;
  torso.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.y = 0.22;
  neck.add(headGroup);

  // Stylized 3D Cartoon Head
  const headGeo = new THREE.SphereGeometry(0.175, 24, 24);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.castShadow = true;
  headGroup.add(head);

  // Cheeks / upper jaw: a soft rounded lower face blended into the head (no hard box edges)
  const cheeks = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), skinMat);
  cheeks.scale.set(0.135, 0.085, 0.125);
  cheeks.position.set(0, -0.06, 0.03);
  cheeks.castShadow = true;
  headGroup.add(cheeks);

  // Moving jaw: rounded chin + lower lip drop together when the character speaks
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.045, 0.02);
  headGroup.add(jaw);
  const chin = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), skinMat);
  // kept inside the round head silhouette: at rest the face stays round; it only shows as a soft curve when the jaw drops
  chin.scale.set(0.07, 0.05, 0.07);
  chin.position.set(0, -0.055, 0.04);
  chin.castShadow = true;
  jaw.add(chin);

  // 3D Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.1 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: '#1A1A1A', roughness: 0.1 });
  const eyelidMat = new THREE.MeshStandardMaterial({ color: cfg.skin, roughness: 0.6 });

  const eyes = [];
  const eyelids = [];
  const eyebrows = [];

  for (const side of [-1, 1]) {
    const eyeSocket = new THREE.Group();
    eyeSocket.position.set(side * 0.065, 0.02, 0.145);
    headGroup.add(eyeSocket);

    // Eyeball
    const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), eyeMat);
    eyeSocket.add(eyeball);

    // Iris / Pupil
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 12), pupilMat);
    pupil.position.set(0, 0, 0.028);
    eyeball.add(pupil);
    eyes.push({ socket: eyeSocket, pupil, eyeball });

    // 3D Upper Eyelid for Blinking
    const eyelid = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), eyelidMat);
    eyelid.rotation.x = -Math.PI / 2;
    eyeSocket.add(eyelid);
    eyelids.push(eyelid);

    // 3D Curved Eyebrow
    const browGeo = new THREE.BoxGeometry(0.06, 0.018, 0.02);
    const brow = new THREE.Mesh(browGeo, hairMat);
    brow.position.set(side * 0.065, 0.075, 0.16);
    brow.rotation.z = side * -0.1;
    headGroup.add(brow);
    eyebrows.push(brow);
  }

  // 3D Cartoon Nose
  const noseGeo = new THREE.ConeGeometry(0.025, 0.05, 8);
  const nose = new THREE.Mesh(noseGeo, skinMat);
  nose.position.set(0, -0.015, 0.175);
  nose.rotation.x = 0.3;
  headGroup.add(nose);

  // Mouth: dark interior + upper teeth + upper lip (fixed) and lower lip (on the jaw), lips tinted from the skin
  const lipMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(cfg.skin).lerp(new THREE.Color('#9c3b46'), 0.45), roughness: 0.45 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: '#3a0d14', roughness: 0.8 });
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mouthMat);   // interior; height follows the opening
  mouth.scale.set(0.03, 0.004, 0.012);
  mouth.position.set(0, -0.071, 0.152);
  headGroup.add(mouth);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.009, 0.006), new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.35 }));
  teeth.position.set(0, -0.068, 0.157);
  teeth.visible = false;
  headGroup.add(teeth);
  const lipGeo = new THREE.CapsuleGeometry(0.0065, 0.048, 4, 12);
  const upperLip = new THREE.Mesh(lipGeo, lipMat);
  upperLip.rotation.z = Math.PI / 2;
  upperLip.position.set(0, -0.064, 0.16);
  upperLip.scale.set(0.85, 1, 0.8);
  headGroup.add(upperLip);
  const lowerLip = new THREE.Mesh(lipGeo, lipMat);
  lowerLip.rotation.z = Math.PI / 2;
  lowerLip.position.set(0, -0.032, 0.138);   // relative to the jaw group → face y ≈ -0.077
  lowerLip.scale.set(1, 0.9, 0.85);
  jaw.add(lowerLip);
  let talkCur = 0, exprOpen = 0, talkPhase = 0;
  function shapeMouth(open, wide = 0) {
    const o = clamp(open, 0, 1);
    jaw.position.y = -0.045 - o * 0.016;
    jaw.rotation.x = o * 0.06;
    mouth.scale.set(0.028 * (1 + wide * 0.25 - o * 0.12), 0.004 + o * 0.011, 0.012);
    mouth.position.y = -0.071 - o * 0.007;
    teeth.visible = o > 0.12;
    upperLip.scale.x = 0.85 * (1 + wide * 0.2 - o * 0.1);
    lowerLip.scale.x = 1 + wide * 0.2 - o * 0.12;
  }

  // 3D Ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 12), skinMat);
    ear.scale.set(0.4, 0.9, 0.6);
    ear.position.set(side * 0.175, 0.01, -0.01);
    headGroup.add(ear);
  }

  // ---------- 3D HAIRSTYLES & HEADWEAR ----------
  const hairGroup = new THREE.Group();
  headGroup.add(hairGroup);

  if (cfg.hairStyle === 'turban') {
    // Royal Indian Pagri / Turban
    const turbanMat = new THREE.MeshStandardMaterial({ color: '#E65100', roughness: 0.65 });
    const turbanDome = new THREE.Mesh(new THREE.SphereGeometry(0.20, 16, 16), turbanMat);
    turbanDome.position.set(0, 0.06, -0.01);
    turbanDome.scale.set(1.1, 0.95, 1.15);
    const turbanWrap = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 8, 24), turbanMat);
    turbanWrap.rotation.x = Math.PI / 2.2;
    turbanWrap.position.set(0, 0.03, 0.02);
    // Royal Kalgi Brooch
    const brooch = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), trimMat);
    brooch.position.set(0, 0.15, 0.18);
    hairGroup.add(turbanDome, turbanWrap, brooch);
  } else if (cfg.hairStyle === 'bun') {
    // Traditional Indian Shikha / Top Knot
    const hairBase = new THREE.Mesh(new THREE.SphereGeometry(0.185, 16, 16), hairMat);
    hairBase.position.set(0, 0.03, -0.02);
    hairBase.scale.set(1.02, 0.92, 1.05);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), hairMat);
    bun.position.set(0, 0.20, -0.08);
    hairGroup.add(hairBase, bun);
  } else if (cfg.hairStyle === 'curly') {
    // Volumetric Curly Hair
    for (let c = 0; c < 18; c++) {
      const curl = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), hairMat);
      const theta = (c / 18) * Math.PI * 2;
      curl.position.set(Math.cos(theta) * 0.15, 0.12 + Math.sin(c) * 0.04, Math.sin(theta) * 0.14 - 0.02);
      hairGroup.add(curl);
    }
  } else {
    // Modern Stylized Swept Crop
    const hairBase = new THREE.Mesh(new THREE.SphereGeometry(0.188, 16, 16), hairMat);
    hairBase.position.set(0, 0.04, -0.025);
    hairBase.scale.set(1.02, 0.95, 1.05);
    // Swept Quiff
    const quiff = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.14), hairMat);
    quiff.position.set(0, 0.18, 0.08);
    quiff.rotation.x = 0.25;
    hairGroup.add(hairBase, quiff);
  }

  // ---------- ACCESSORIES ----------
  if (cfg.accessories?.includes('cap')) {
    const capMat = new THREE.MeshStandardMaterial({ color: cfg.trim || '#D32F2F', roughness: 0.6 });
    const capDome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    capDome.position.set(0, 0.06, 0);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.14), capMat);
    visor.position.set(0, 0.06, 0.18);
    visor.rotation.x = 0.12;
    headGroup.add(capDome, visor);
  }

  if (cfg.accessories?.includes('mustache')) {
    const stacheMat = new THREE.MeshStandardMaterial({ color: cfg.hairColor, roughness: 0.9 });
    for (const side of [-1, 1]) {
      const stache = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.01, 0.09, 8), stacheMat);
      stache.rotation.z = side * 1.35;
      stache.position.set(side * 0.045, -0.05, 0.17);
      headGroup.add(stache);
    }
  }

  if (cfg.accessories?.includes('glasses')) {
    const frameMat = new THREE.MeshStandardMaterial({ color: '#212121', roughness: 0.3, metalness: 0.6 });
    for (const side of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 8, 16), frameMat);
      rim.position.set(side * 0.065, 0.02, 0.18);
      headGroup.add(rim);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.008), frameMat);
    bridge.position.set(0, 0.02, 0.18);
    headGroup.add(bridge);
  }

  // ---------- ARTICULATED 3D ARMS ----------
  function createArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.26, 0.40, 0);
    torso.add(shoulder);

    // Shoulder cap / sleeve
    const bicep = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.058, 0.26, 12), shirtMat);
    bicep.position.y = -0.13;
    bicep.castShadow = true;
    shoulder.add(bicep);

    // Elbow joint
    const elbow = new THREE.Group();
    elbow.position.y = -0.26;
    shoulder.add(elbow);

    // Forearm
    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.048, 0.24, 12), skinMat);
    forearm.position.y = -0.12;
    forearm.castShadow = true;
    elbow.add(forearm);

    // 3D Stylized Cartoon Hand
    const handGroup = new THREE.Group();
    handGroup.position.y = -0.25;
    elbow.add(handGroup);

    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.045), skinMat);
    palm.castShadow = true;
    handGroup.add(palm);

    // Thumb
    const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.05, 8), skinMat);
    thumb.position.set(side * -0.04, 0.01, 0.015);
    thumb.rotation.z = side * -0.6;
    handGroup.add(thumb);

    return { shoulder, elbow, hand: handGroup };
  }

  const armL = createArm(-1);
  const armR = createArm(1);

  // ---------- ARTICULATED 3D LEGS ----------
  function createLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, -0.05, 0);
    hips.add(hip);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.068, 0.42, 12), pantsMat);
    thigh.position.y = -0.21;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);

    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.058, 0.40, 12), pantsMat);
    shin.position.y = -0.20;
    shin.castShadow = true;
    knee.add(shin);

    // 3D Stylized Shoe
    const shoeGroup = new THREE.Group();
    shoeGroup.position.set(0, -0.42, 0.04);
    knee.add(shoeGroup);

    const shoeMain = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.23), shoeMat);
    shoeMain.castShadow = true;
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.025, 0.24), trimMat);
    sole.position.y = -0.035;
    shoeGroup.add(shoeMain, sole);

    return { hip, knee, foot: shoeGroup };
  }

  const legL = createLeg(-1);
  const legR = createLeg(1);

  upgradeLook(root, { skinMat, hairMat, clothMats: [shirtMat, vestMat, pantsMat], shoeMat, eyes, irisColor: cfg.irisColor || '#4E342E' });

  // ==========================================================================
  // KINEMATIC ANIMATION & ACTING API
  // ==========================================================================
  const character = {
    root,
    hips,
    torso,
    neck,
    head: headGroup,
    armL,
    armR,
    legL,
    legR,
    eyelids,
    eyebrows,
    mouth,

    // Natural 3D Idle Breathing & Micro-movements
    setIdle(t = 0) {
      const breath = Math.sin(t * 3.2);
      torso.position.y = 0.15 + breath * 0.012;
      torso.rotation.x = breath * 0.02;
      neck.rotation.x = -breath * 0.015;
      neck.rotation.y = Math.sin(t * 1.1) * 0.06;

      // Subtle resting arm sway
      armL.shoulder.rotation.set(0.1 + Math.sin(t * 2.8) * 0.05, 0, -0.15);
      armR.shoulder.rotation.set(0.1 - Math.sin(t * 2.8) * 0.05, 0, 0.15);
      armL.elbow.rotation.set(-0.35, 0, 0);
      armR.elbow.rotation.set(-0.35, 0, 0);

      // Subtle weight shift
      legL.hip.rotation.set(0.04, 0, 0);
      legR.hip.rotation.set(-0.04, 0, 0);

      // Natural blink cycle (every ~3.5 seconds)
      const blinkCycle = (t % 3.6);
      const isBlinking = blinkCycle < 0.14 ? Math.sin((blinkCycle / 0.14) * Math.PI) : 0;
      this.setBlink(isBlinking);
    },

    // Realistic 3D Walk Cycle
    setWalk(t = 0, speed = 6.0) {
      const phase = t * speed;
      const step = Math.sin(phase);
      const bob = Math.abs(Math.sin(phase)) * 0.06;

      hips.position.y = 0.95 + bob;
      torso.rotation.y = -step * 0.15; // Torso counter-twist
      torso.rotation.z = Math.sin(phase) * 0.03;

      // Legs alternating
      legL.hip.rotation.x = step * 0.65;
      legR.hip.rotation.x = -step * 0.65;
      legL.knee.rotation.x = Math.max(0, -step * 0.9);
      legR.knee.rotation.x = Math.max(0, step * 0.9);

      // Arms swing opposite to legs
      armL.shoulder.rotation.x = -step * 0.6;
      armR.shoulder.rotation.x = step * 0.6;
      armL.elbow.rotation.x = -0.4 - Math.max(0, -step * 0.4);
      armR.elbow.rotation.x = -0.4 - Math.max(0, step * 0.4);

      neck.rotation.y = step * 0.05;
      this.setBlink((t % 3.2) < 0.12 ? 1 : 0);
    },

    // Expressive Storytelling Gestures
    setGesture(type = 'explain', t = 0) {
      this.setIdle(t);
      exprOpen = 0;
      const beat = Math.sin(t * 4.5);

      switch (type) {
        case 'explain': // Open hand conversational gestures
          armR.shoulder.rotation.set(-0.6 + beat * 0.12, 0.3, 0.4);
          armR.elbow.rotation.set(-1.1 + beat * 0.15, 0, 0);
          armL.shoulder.rotation.set(-0.4 - beat * 0.08, -0.2, -0.3);
          armL.elbow.rotation.set(-0.8 - beat * 0.1, 0, 0);
          neck.rotation.set(-0.1, Math.sin(t * 2.0) * 0.12, 0);
          break;

        case 'think': // Hand to chin, head tilted up
          armR.shoulder.rotation.set(-1.4, 0.35, 0.6);
          armR.elbow.rotation.set(-2.1, 0, 0);
          armL.shoulder.rotation.set(-0.2, 0, -0.25);
          armL.elbow.rotation.set(-0.5, 0, 0);
          neck.rotation.set(-0.22, 0.25, 0.1);
          eyebrows[0].rotation.z = 0.25; eyebrows[1].rotation.z = -0.1;
          break;

        case 'excited': // Both arms up, celebration jump/bounce
          hips.position.y = 0.95 + Math.abs(Math.sin(t * 8)) * 0.12;
          armR.shoulder.rotation.set(2.4 + beat * 0.2, 0.2, 0.4);
          armL.shoulder.rotation.set(2.4 - beat * 0.2, -0.2, -0.4);
          armR.elbow.rotation.set(0.3, 0, 0);
          armL.elbow.rotation.set(0.3, 0, 0);
          neck.rotation.set(-0.2, 0, 0);
          exprOpen = 0.45;
          break;

        case 'shock': // Lean back, hands raised defensively, eyes wide
          torso.rotation.x = -0.25;
          neck.rotation.x = 0.2;
          armR.shoulder.rotation.set(-1.1, 0.4, 0.7);
          armL.shoulder.rotation.set(-1.1, -0.4, -0.7);
          armR.elbow.rotation.set(-1.4, 0, 0);
          armL.elbow.rotation.set(-1.4, 0, 0);
          this.setBlink(0);
          eyebrows[0].position.y = 0.095; eyebrows[1].position.y = 0.095;
          exprOpen = 0.7;
          break;

        case 'point': // Pointing forward at viewer/target
          armR.shoulder.rotation.set(-1.5, 0.1, 0.2);
          armR.elbow.rotation.set(-0.2, 0, 0);
          armL.shoulder.rotation.set(-0.2, 0, -0.2);
          neck.rotation.set(0, 0.1, 0);
          break;
      }
    },

    // 3D Eyelid Control
    setBlink(amount = 0) {
      const k = clamp(amount, 0, 1);
      eyelids.forEach(el => {
        el.rotation.x = -Math.PI / 2 + k * Math.PI * 0.55;
      });
    },

    // 3D Mouth & Speech Animation
    setTalk(amount = 0) {
      // smoothed (no frame-to-frame snapping), never fully gaping; a slow phase alternates wide (e/i) and round (o/u) shapes
      const target = clamp(amount, 0, 1) * 0.75;
      talkCur += (target - talkCur) * 0.45;
      talkPhase += 0.37;
      const open = Math.max(talkCur, exprOpen);
      shapeMouth(open, talkCur > 0.05 ? Math.sin(talkPhase) * 0.5 : 0);
    },

    // Natural LookAt Camera/Target
    lookAt(targetPos) {
      const localTarget = targetPos.clone();
      neck.lookAt(localTarget);
    }
  };

  return character;
}

// ============================================================================
// QUALITY PASS (applied to every character): smooth geometry, lifelike skin, fabric sheen, living eyes
// ============================================================================
const SMOOTH = { CylinderGeometry: (p) => new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, Math.max(p.radialSegments, 32), Math.max(p.heightSegments, 2), p.openEnded, p.thetaStart, p.thetaLength),
  SphereGeometry: (p) => new THREE.SphereGeometry(p.radius, Math.max(p.widthSegments, 40), Math.max(p.heightSegments, 28), p.phiStart, p.phiLength, p.thetaStart, p.thetaLength),
  TorusGeometry: (p) => new THREE.TorusGeometry(p.radius, p.tube, Math.max(p.radialSegments, 16), Math.max(p.tubularSegments, 40), p.arc),
  ConeGeometry: (p) => new THREE.ConeGeometry(p.radius, p.height, Math.max(p.radialSegments, 24), p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength) };
function physical(m, extra) { const p = new THREE.MeshPhysicalMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness, ...extra }); p.name = m.name; return p; }
function upgradeLook(root, { skinMat, hairMat, clothMats, shoeMat, eyes, irisColor }) {
  // skin: soft sheen like real skin under light; cloth: velvet-like sheen; hair: soft satin; shoes: light gloss
  const skin = physical(skinMat, { roughness: 0.48, sheen: 0.35, sheenRoughness: 0.6, sheenColor: new THREE.Color('#FFD9C2'), clearcoat: 0.08, clearcoatRoughness: 0.6 });
  const hair = physical(hairMat, { roughness: 0.55, sheen: 0.6, sheenRoughness: 0.4, sheenColor: hairMat.color.clone().offsetHSL(0, 0, 0.25) });
  const shoe = physical(shoeMat, { roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.35 });
  const cloth = new Map(clothMats.map((m) => [m, physical(m, { roughness: 0.82, sheen: 0.55, sheenRoughness: 0.75, sheenColor: m.color.clone().offsetHSL(0, -0.1, 0.18) })]));
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, f = SMOOTH[g.type]; if (f && g.parameters) { o.geometry = f(g.parameters); g.dispose(); }
    if (o.material === skinMat) o.material = skin; else if (o.material === hairMat) o.material = hair; else if (o.material === shoeMat) o.material = shoe; else if (cloth.has(o.material)) o.material = cloth.get(o.material);
    o.castShadow = true; o.receiveShadow = true;
  });
  // eyes: coloured iris + dark pupil + catchlight (they read as alive on camera)
  const irisMat = new THREE.MeshPhysicalMaterial({ color: irisColor, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: '#0B0B0B' }), glintMat = new THREE.MeshBasicMaterial({ color: '#FFFFFF' });
  for (const e of eyes || []) {
    e.pupil.material = irisMat; e.pupil.scale.setScalar(1.15);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 20, 14), pupilMat); p.position.set(0, 0, 0.017); e.pupil.add(p);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.005, 12, 8), glintMat); gl.position.set(0.007, 0.008, 0.02); e.pupil.add(gl);
    e.eyeball.material = new THREE.MeshPhysicalMaterial({ color: '#FBFBF8', roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03 });
  }
}

