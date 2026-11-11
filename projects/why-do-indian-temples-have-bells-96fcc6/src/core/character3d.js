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
export const ARCHETYPES = {
  desi_hero: {
    name: 'Desi Hero (Bunty)',
    skin: '#F2B98E',
    hairColor: '#1E1E1E',
    hairStyle: 'modern',
    shirt: '#1E88E5',
    vest: '#0D47A1',
    pants: '#263238',
    shoes: '#FFFFFF',
    trim: '#FFD54F',
    accessories: ['cap']
  },
  desi_uncle: {
    name: 'Desi Uncle (Sharma Ji)',
    skin: '#DE9B72',
    hairColor: '#424242',
    hairStyle: 'side_part',
    shirt: '#FFF8E1',
    vest: '#C62828', // Nehru jacket
    pants: '#F5F5F5', // Dhoti/pajama
    shoes: '#5D4037', // Leather jutti
    trim: '#FFB300',
    accessories: ['mustache', 'glasses']
  },
  curious_student: {
    name: 'Curious Student (Aarav)',
    skin: '#F7C59F',
    hairColor: '#2B2B2B',
    hairStyle: 'curly',
    shirt: '#FB8C00',
    pants: '#37474F',
    shoes: '#E0E0E0',
    trim: '#00ACC1',
    accessories: ['backpack']
  },
  indian_techie: {
    name: 'Indian Techie (Rohan)',
    skin: '#E8A87C',
    hairColor: '#1A1A1A',
    hairStyle: 'modern',
    shirt: '#00897B',
    pants: '#212121',
    shoes: '#424242',
    trim: '#80CBC4',
    accessories: ['glasses', 'headphones']
  },
  chanakya_scholar: {
    name: 'Ancient Scholar (Chanakya)',
    skin: '#EAA97B',
    hairColor: '#212121',
    hairStyle: 'bun',
    shirt: '#FFF3E0', // Angavastram
    vest: '#E65100',  // Saffron sash
    pants: '#FFE0B2',
    shoes: '#8D6E63',
    trim: '#FFB74D',
    accessories: ['scarf']
  },
  warrior_king: {
    name: 'Warrior King (Shivaji)',
    skin: '#E59B6E',
    hairColor: '#1B1B1B',
    hairStyle: 'turban',
    shirt: '#C2185B',
    vest: '#37474F', // Armor breastplate
    pants: '#ECEFF1',
    shoes: '#3E2723',
    trim: '#FFD700',
    accessories: ['turban', 'mustache', 'sash']
  },
  authority_suit: {
    name: 'Authority Figure (Leader)',
    skin: '#F0BA95',
    hairColor: '#37474F',
    hairStyle: 'side_part',
    shirt: '#ECEFF1',
    vest: '#263238', // Suit jacket
    pants: '#263238',
    shoes: '#111111',
    trim: '#D32F2F', // Red tie
    accessories: ['tie']
  }
};

// ============================================================================
// 3D PROCEDURAL CHARACTER RIG GENERATOR
// ============================================================================
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

  // Chin / Jawline definition
  const jawGeo = new THREE.BoxGeometry(0.14, 0.10, 0.12);
  const jaw = new THREE.Mesh(jawGeo, skinMat);
  jaw.position.set(0, -0.09, 0.05);
  jaw.castShadow = true;
  headGroup.add(jaw);

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

  // 3D Cartoon Mouth
  const mouthMat = new THREE.MeshStandardMaterial({ color: '#880E4F', roughness: 0.4 });
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.02), mouthMat);
  mouth.position.set(0, -0.07, 0.165);
  headGroup.add(mouth);

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
          mouth.scale.set(1.4, 2.0, 1.0);
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
          mouth.scale.set(1.2, 2.5, 1.0);
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
      const k = clamp(amount, 0, 1);
      mouth.scale.y = 1.0 + k * 2.2;
      mouth.scale.x = 1.0 + k * 0.4;
    },

    // Natural LookAt Camera/Target
    lookAt(targetPos) {
      const localTarget = targetPos.clone();
      neck.lookAt(localTarget);
    }
  };

  return character;
}
