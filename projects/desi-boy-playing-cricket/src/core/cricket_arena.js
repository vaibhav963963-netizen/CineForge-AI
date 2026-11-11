// 3D Gully Cricket Arena & High-Fidelity Character Rig
// High-quality PBR materials, true 3D articulated player meshes, dynamic pitch, props, and environment.
import * as THREE from 'three';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- PROCEDURAL TEXTURE GENERATORS ----------
function createPitchTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 2048;
  const ctx = canvas.getContext('2d');
  
  // Dry dusty clay base
  ctx.fillStyle = '#C29B68';
  ctx.fillRect(0, 0, 1024, 2048);

  // Surface grit and grain
  for (let i = 0; i < 40000; i++) {
    const x = Math.random() * 1024, y = Math.random() * 2048;
    const s = Math.random() * 3 + 1;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(95, 70, 40, 0.12)' : 'rgba(230, 205, 160, 0.15)';
    ctx.fillRect(x, y, s, s);
  }

  // Turf cracks and rolling ruts
  ctx.strokeStyle = 'rgba(75, 50, 25, 0.18)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 18; i++) {
    ctx.beginPath();
    let x = Math.random() * 800 + 100, y = Math.random() * 1800 + 100;
    ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Crease markings (chalk white)
  ctx.fillStyle = '#FFFFFF';
  // Popping crease (striker end)
  ctx.fillRect(200, 1750, 624, 16);
  // Bowling crease
  ctx.fillRect(300, 1820, 424, 12);
  // Return creases
  ctx.fillRect(200, 1750, 12, 120);
  ctx.fillRect(812, 1750, 12, 120);

  // Non-striker popping crease
  ctx.fillRect(200, 300, 624, 16);
  ctx.fillRect(300, 230, 424, 12);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createBatTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  
  // English willow wood grain
  ctx.fillStyle = '#E3C293';
  ctx.fillRect(0, 0, 256, 512);

  ctx.strokeStyle = 'rgba(160, 120, 75, 0.25)';
  ctx.lineWidth = 1.5;
  for (let x = 10; x < 250; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x + (Math.random() - 0.5) * 4, 0);
    ctx.bezierCurveTo(x + 10, 180, x - 10, 340, x + (Math.random() - 0.5) * 6, 512);
    ctx.stroke();
  }

  // Red & Black brand sticker
  ctx.fillStyle = '#D32F2F';
  ctx.fillRect(40, 140, 176, 120);
  ctx.fillStyle = '#111111';
  ctx.fillRect(50, 150, 156, 100);
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('GULLY 100', 128, 210);

  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

// ---------- 3D CRICKET PROPS ----------
export function createCricketBat() {
  const g = new THREE.Group();

  // Bat Blade
  const bladeGeo = new THREE.BoxGeometry(0.18, 0.72, 0.05);
  const batMat = new THREE.MeshStandardMaterial({
    map: createBatTexture(),
    roughness: 0.45,
    metalness: 0.05
  });
  const blade = new THREE.Mesh(bladeGeo, batMat);
  blade.position.y = 0.36;
  blade.castShadow = true; blade.receiveShadow = true;
  g.add(blade);

  // Bat Spine (back curve)
  const spineGeo = new THREE.CylinderGeometry(0.02, 0.04, 0.68, 6);
  const spine = new THREE.Mesh(spineGeo, batMat);
  spine.position.set(0, 0.36, -0.025);
  g.add(spine);

  // Rubber Handle
  const handleGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.36, 16);
  const handleMat = new THREE.MeshStandardMaterial({
    color: '#E53935',
    roughness: 0.8,
    bumpScale: 0.05
  });
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.position.y = 0.72 + 0.18;
  handle.castShadow = true;
  g.add(handle);

  // Grip wrapping rings
  const ringMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.9 });
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.003, 8, 16), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.75 + i * 0.06;
    g.add(ring);
  }

  g.scale.set(1.1, 1.1, 1.1);
  return g;
}

export function createWickets() {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: '#D4A359', roughness: 0.4, metalness: 0.05 });

  // 3 Stumps
  const stumpGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.76, 16);
  for (let i = -1; i <= 1; i++) {
    const s = new THREE.Mesh(stumpGeo, woodMat);
    s.position.set(i * 0.12, 0.38, 0);
    s.castShadow = true; s.receiveShadow = true;
    g.add(s);
  }

  // 2 Bails
  const bailGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.13, 8);
  const b1 = new THREE.Mesh(bailGeo, woodMat);
  b1.rotation.z = Math.PI / 2; b1.position.set(-0.06, 0.77, 0);
  const b2 = new THREE.Mesh(bailGeo, woodMat);
  b2.rotation.z = Math.PI / 2; b2.position.set(0.06, 0.77, 0);
  g.add(b1, b2);
  g.userData = { bails: [b1, b2] };

  return g;
}

export function createCricketBall() {
  const g = new THREE.Group();
  const ballMat = new THREE.MeshStandardMaterial({
    color: '#B71C1C',
    roughness: 0.25,
    metalness: 0.15
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.05, 32, 32), ballMat);
  sphere.castShadow = true;
  g.add(sphere);

  // White Seam ring
  const seamMat = new THREE.MeshStandardMaterial({ color: '#FAFAFA', roughness: 0.6 });
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.0505, 0.004, 8, 32), seamMat);
  g.add(seam);

  return g;
}

// ---------- 3D ARTICULATED PLAYER RIG ----------
export function createPlayer3D(opts = {}) {
  const isBowler = opts.role === 'bowler';
  const root = new THREE.Group();

  // Palette
  const skinCol = opts.skin || '#F2B98E';
  const jerseyCol = opts.jersey || (isBowler ? '#E65100' : '#1565C0');
  const trimCol = opts.trim || '#FFD600';
  const pantsCol = '#F5F5F7';
  const hairCol = opts.hair || '#212121';

  const skinMat = new THREE.MeshStandardMaterial({ color: skinCol, roughness: 0.55 });
  const jerseyMat = new THREE.MeshStandardMaterial({ color: jerseyCol, roughness: 0.7 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trimCol, roughness: 0.6 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pantsCol, roughness: 0.75 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairCol, roughness: 0.85 });
  const padMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.45, bumpScale: 0.05 });

  // Hierarchy: root -> hips -> torso -> neck -> head
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  root.add(hips);

  // Pelvis / Shorts top
  const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.2, 16), pantsMat);
  pelvis.castShadow = true;
  hips.add(pelvis);

  // Torso
  const torso = new THREE.Group();
  torso.position.y = 0.15;
  hips.add(torso);

  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.44, 16), jerseyMat);
  chest.position.y = 0.22;
  chest.castShadow = true;
  torso.add(chest);

  // Jersey collar
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 8, 16), trimMat);
  collar.rotation.x = Math.PI / 2; collar.position.y = 0.44;
  torso.add(collar);

  // Head & Neck
  const neck = new THREE.Group();
  neck.position.y = 0.45;
  torso.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 24), skinMat);
  head.position.y = 0.2;
  head.castShadow = true;
  neck.add(head);

  // Stylized Hair
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), hairMat);
  hair.position.set(0, 0.24, -0.02);
  hair.scale.set(1.02, 0.9, 1.05);
  neck.add(hair);

  // Cricket Cap / Helmet
  const cap = new THREE.Group();
  const capDome = new THREE.Mesh(new THREE.SphereGeometry(0.175, 16, 16), jerseyMat);
  capDome.position.set(0, 0.23, 0);
  cap.add(capDome);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.12), trimMat);
  visor.position.set(0, 0.24, 0.16);
  visor.rotation.x = 0.15;
  cap.add(visor);
  neck.add(cap);

  // Eyes (Expressive)
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.1 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: '#1A1A1A', roughness: 0.1 });
  for (const sx of [-0.06, 0.06]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), eyeMat);
    eye.position.set(sx, 0.2, 0.13);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), pupilMat);
    pupil.position.set(0, 0, 0.025);
    eye.add(pupil);
    neck.add(eye);
  }

  // Arms
  function createArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.26, 0.40, 0);
    torso.add(shoulder);

    const bicep = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.26, 12), jerseyMat);
    bicep.position.y = -0.13;
    bicep.castShadow = true;
    shoulder.add(bicep);

    const elbow = new THREE.Group();
    elbow.position.y = -0.26;
    shoulder.add(elbow);

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.048, 0.24, 12), skinMat);
    forearm.position.y = -0.12;
    forearm.castShadow = true;
    elbow.add(forearm);

    // Hand / Glove
    const handGeo = isBowler ? new THREE.SphereGeometry(0.05, 12, 12) : new THREE.BoxGeometry(0.09, 0.12, 0.08);
    const handMat = isBowler ? skinMat : new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.4 });
    const hand = new THREE.Mesh(handGeo, handMat);
    hand.position.y = -0.26;
    hand.castShadow = true;
    elbow.add(hand);

    return { shoulder, elbow, hand };
  }

  const armL = createArm(-1);
  const armR = createArm(1);

  // Legs
  function createLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, -0.05, 0);
    hips.add(hip);

    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.065, 0.42, 12), pantsMat);
    thigh.position.y = -0.21;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);

    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.40, 12), pantsMat);
    shin.position.y = -0.20;
    shin.castShadow = true;
    knee.add(shin);

    // Batting Pad on shin (for batsman)
    if (!isBowler) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.48, 0.10), padMat);
      pad.position.set(0, -0.16, 0.05);
      pad.castShadow = true;
      knee.add(pad);
    }

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.22), new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.3 }));
    shoe.position.set(0, -0.42, 0.04);
    shoe.castShadow = true;
    knee.add(shoe);

    return { hip, knee, shoe };
  }

  const legL = createLeg(-1);
  const legR = createLeg(1);

  // Attach Cricket Bat to Batsman hands
  let bat = null;
  if (!isBowler) {
    bat = createCricketBat();
    armR.hand.add(bat);
    bat.position.set(0, -0.1, 0.08);
    bat.rotation.x = Math.PI / 2;
  }

  // Posing API
  const player = {
    group: root,
    hips, torso, neck, head,
    armL, armR, legL, legR,
    bat,

    // Stance Pose (Batsman waiting)
    setStance(t = 0) {
      const tap = Math.abs(Math.sin(t * 5.5));
      torso.rotation.set(0, -0.55, 0);
      neck.rotation.set(0, 0.55, 0);
      armR.shoulder.rotation.set(-0.6, 0.2, 0.4);
      armR.elbow.rotation.set(-0.8 + tap * 0.25, 0, 0);
      armL.shoulder.rotation.set(-0.4, -0.3, -0.3);
      armL.elbow.rotation.set(-1.0 + tap * 0.2, 0, 0);
      legL.hip.rotation.set(0.15, 0.1, -0.05);
      legR.hip.rotation.set(-0.15, -0.2, 0.1);
      legL.knee.rotation.set(0.3, 0, 0);
      legR.knee.rotation.set(0.25, 0, 0);
    },

    // Power Shot (Helicopter Stroke)
    setShot(k = 0) {
      // k from 0 (backlift) -> 0.4 (downswing/contact) -> 1.0 (flourish helicopter follow-through)
      if (k < 0.35) {
        // Backlift loading
        const p = k / 0.35;
        torso.rotation.set(0, -0.8 + p * 0.2, 0);
        armR.shoulder.rotation.set(-1.4 * p, 0.4, 0.8);
        armR.elbow.rotation.set(-1.2 * p, 0, 0);
        armL.shoulder.rotation.set(-1.1 * p, -0.3, -0.4);
        legR.hip.rotation.set(-0.35, 0, 0);
      } else if (k < 0.55) {
        // Impact snap
        const p = (k - 0.35) / 0.20;
        torso.rotation.set(0, -0.6 + p * 1.4, 0.1);
        armR.shoulder.rotation.set(-1.4 + p * 2.8, -0.2, p * 1.2);
        armL.shoulder.rotation.set(-1.1 + p * 2.4, 0.2, -p * 0.8);
        legL.knee.rotation.set(0.4 - p * 0.2, 0, 0);
      } else {
        // Helicopter flourish follow-through
        const p = (k - 0.55) / 0.45;
        torso.rotation.set(0.1, 0.8 + p * 0.4, -0.15);
        neck.rotation.set(-0.4 * p, -0.3, 0); // Watching ball soar
        armR.shoulder.rotation.set(1.4 + p * 0.8, -0.4, 1.2 + p * 0.6);
        armR.elbow.rotation.set(-1.8, 0, 0);
        armL.shoulder.rotation.set(1.3 + p * 0.6, 0.3, -0.6);
        bat.rotation.z = p * Math.PI * 0.8; // Helicopter bat twirl!
      }
    },

    // Bowler Run & Windmill Delivery
    setBowlerAction(k = 0) {
      if (k < 0.7) {
        // Running stride
        const phase = k * 18;
        const swing = Math.sin(phase);
        legL.hip.rotation.x = swing * 0.8;
        legR.hip.rotation.x = -swing * 0.8;
        legL.knee.rotation.x = Math.max(0, -swing * 1.2);
        legR.knee.rotation.x = Math.max(0, swing * 1.2);
        armL.shoulder.rotation.x = -swing * 0.9;
        armR.shoulder.rotation.x = swing * 0.9;
        hips.position.y = 0.95 + Math.abs(Math.sin(phase * 2)) * 0.1;
      } else {
        // High arm overhead delivery
        const p = (k - 0.7) / 0.3;
        legL.hip.rotation.set(0.6, 0, 0);
        legR.hip.rotation.set(-0.8, 0, 0);
        torso.rotation.set(0.4 * p, -0.3 * p, 0);
        armR.shoulder.rotation.set(-Math.PI * 2 * p, 0, 0.2); // 360 bowling arm windmill
        armL.shoulder.rotation.set(0.8 - p * 1.2, 0, -0.4);
      }
    },

    // Heroic Bat-Raise Celebration
    setCelebration(t = 0) {
      const bob = Math.sin(t * 6) * 0.08;
      hips.position.y = 0.95 + bob;
      torso.rotation.set(-0.1, 0, 0);
      neck.rotation.set(-0.25, Math.sin(t * 2) * 0.2, 0); // Looking proudly at crowd
      armR.shoulder.rotation.set(2.4, 0.2, 0.3); // Bat raised high into sky
      armR.elbow.rotation.set(0.2, 0, 0);
      armL.shoulder.rotation.set(2.1, -0.3, -0.4); // Fist pumped
      legL.hip.rotation.set(0.1, 0.1, 0);
      legR.hip.rotation.set(-0.1, -0.1, 0);
    }
  };

  return player;
}

// ---------- GULLY ENVIRONMENT BUILDER ----------
export function createGullyArena() {
  const g = new THREE.Group();

  // 1. Street Pavement Ground
  const groundGeo = new THREE.PlaneGeometry(28, 48);
  const groundMat = new THREE.MeshStandardMaterial({
    color: '#8D7B68',
    roughness: 0.9,
    metalness: 0.05
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);

  // 2. Cricket Pitch Center Strip
  const pitchGeo = new THREE.PlaneGeometry(3.2, 22);
  const pitchMat = new THREE.MeshStandardMaterial({
    map: createPitchTexture(),
    roughness: 0.85,
    metalness: 0.05
  });
  const pitch = new THREE.Mesh(pitchGeo, pitchMat);
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, 0.015, 0);
  pitch.receiveShadow = true;
  g.add(pitch);

  // 3. Indian Gully Buildings (Left & Right Flanks)
  const wallColors = ['#E07A5F', '#3D5A80', '#F4A261', '#2A9D8F', '#E76F51', '#D4A373'];

  function createBuilding(x, z, w, d, h, col, hasBalcony = true) {
    const b = new THREE.Group();
    b.position.set(x, 0, z);

    const bMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bMat);
    wall.position.y = h / 2;
    wall.castShadow = true; wall.receiveShadow = true;
    b.add(wall);

    // Windows & Shutters
    const winMat = new THREE.MeshStandardMaterial({ color: '#2B2D42', roughness: 0.2 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.5 });
    for (let f = 1; f <= 3; f++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.1), winMat);
      win.position.set(0, f * 2.8, (x > 0 ? -d/2 : d/2));
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.35, 0.12), frameMat);
      frame.position.copy(win.position);
      b.add(frame, win);

      // Balcony with decorative wrought iron railing
      if (hasBalcony && f === 2) {
        const balcFloor = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.15, 0.8), frameMat);
        balcFloor.position.set(0, f * 2.8 - 0.65, (x > 0 ? -d/2 - 0.4 : d/2 + 0.4));
        const rail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.05), new THREE.MeshStandardMaterial({ color: '#111111', metalness: 0.7, roughness: 0.3 }));
        rail.position.set(0, f * 2.8 - 0.25, (x > 0 ? -d/2 - 0.8 : d/2 + 0.8));
        b.add(balcFloor, rail);
      }
    }
    return b;
  }

  // Left buildings
  for (let i = -2; i <= 2; i++) {
    const col = wallColors[(i + 4) % wallColors.length];
    const b = createBuilding(-5.8, i * 7.5, 4.5, 6.8, 12 + Math.abs(i) * 2, col, true);
    g.add(b);
  }

  // Right buildings
  for (let i = -2; i <= 2; i++) {
    const col = wallColors[(i + 7) % wallColors.length];
    const b = createBuilding(5.8, i * 7.5, 4.5, 6.8, 11 + (i % 2) * 3, col, true);
    g.add(b);
  }

  // 4. Colorful Overhead Bunting Flags (Festival Toran)
  const flagColors = ['#E63946', '#F1FAEE', '#A8DADC', '#457B9D', '#FFB703', '#FB8500'];
  for (let z = -12; z <= 12; z += 6) {
    const stringGeo = new THREE.CylinderGeometry(0.008, 0.008, 11, 8);
    const stringMat = new THREE.MeshBasicMaterial({ color: '#333333' });
    const wire = new THREE.Mesh(stringGeo, stringMat);
    wire.rotation.z = Math.PI / 2;
    wire.position.set(0, 6.2 + (Math.sin(z) * 0.4), z);
    g.add(wire);

    // Triangle Flags
    for (let fx = -4.5; fx <= 4.5; fx += 0.8) {
      const fGeo = new THREE.ConeGeometry(0.18, 0.35, 3);
      const fMat = new THREE.MeshStandardMaterial({ color: flagColors[Math.floor(Math.random() * flagColors.length)], roughness: 0.7 });
      const flag = new THREE.Mesh(fGeo, fMat);
      flag.rotation.x = Math.PI;
      flag.position.set(fx, 6.0, z);
      g.add(flag);
    }
  }

  // 5. Gully Props (Vintage Scooter & Crates)
  const scooter = new THREE.Group();
  scooter.position.set(-3.2, 0, 7.5);
  scooter.rotation.y = 0.6;
  const bodyScooter = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 1.4), new THREE.MeshStandardMaterial({ color: '#E9C46A', roughness: 0.3, metalness: 0.2 }));
  bodyScooter.position.y = 0.45;
  const wheelGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.08, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ color: '#1B1B1B', roughness: 0.8 });
  const w1 = new THREE.Mesh(wheelGeo, wheelMat); w1.rotation.z = Math.PI / 2; w1.position.set(0, 0.18, 0.5);
  const w2 = new THREE.Mesh(wheelGeo, wheelMat); w2.rotation.z = Math.PI / 2; w2.position.set(0, 0.18, -0.5);
  scooter.add(bodyScooter, w1, w2);
  g.add(scooter);

  // Stacked Wooden Crates
  const crateGeo = new THREE.BoxGeometry(0.7, 0.5, 0.6);
  const crateMat = new THREE.MeshStandardMaterial({ color: '#9C6644', roughness: 0.9 });
  for (let c = 0; c < 3; c++) {
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.set(3.4, 0.25 + c * 0.48, -4.5 + c * 0.1);
    crate.castShadow = true; crate.receiveShadow = true;
    g.add(crate);
  }

  return g;
}

// ---------- IMPACT PARTICLES & SHATTER EFFECTS ----------
export function createSparkBurst() {
  const pCount = 60;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(pCount * 3);
  const vel = new Float32Array(pCount * 3);

  for (let i = 0; i < pCount; i++) {
    pos[i * 3] = 0; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0;
    const theta = Math.random() * Math.PI * 2;
    const speed = Math.random() * 4.5 + 2.0;
    vel[i * 3] = Math.cos(theta) * speed;
    vel[i * 3 + 1] = Math.sin(theta) * speed + 1.5;
    vel[i * 3 + 2] = (Math.random() - 0.5) * speed * 1.5;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: '#FFD700',
    size: 0.08,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending
  });

  const p = new THREE.Points(geo, mat);
  p.userData = { vel, pos, age: 0 };
  return p;
}
