// Universal Procedural 3D Environments Engine
// Provides high-fidelity 3D environments with PBR materials, shadows, and props.

import * as THREE from 'three';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ============================================================================
// 1. INDIAN GULLY & STREET ARENA
// ============================================================================
export function createStreetArena() {
  const g = new THREE.Group();
  g.name = 'Environment_Street';

  // Ground Pavement
  const groundGeo = new THREE.PlaneGeometry(28, 48);
  const groundMat = new THREE.MeshStandardMaterial({ color: '#8D7B68', roughness: 0.9, metalness: 0.05 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  g.add(ground);

  // Center Road / Path
  const roadGeo = new THREE.PlaneGeometry(4.5, 48);
  const roadMat = new THREE.MeshStandardMaterial({ color: '#5D4037', roughness: 0.85 });
  const road = new THREE.Mesh(roadGeo, roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.01;
  road.receiveShadow = true;
  g.add(road);

  // Buildings Flanking Left & Right
  const wallColors = ['#E07A5F', '#3D5A80', '#F4A261', '#2A9D8F', '#D4A373', '#6D597A'];
  function makeBuilding(x, z, w, d, h, col) {
    const b = new THREE.Group();
    b.position.set(x, 0, z);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 }));
    wall.position.y = h / 2;
    wall.castShadow = true; wall.receiveShadow = true;
    b.add(wall);

    // Windows & Balconies
    const winMat = new THREE.MeshStandardMaterial({ color: '#1A1C29', roughness: 0.2 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.5 });
    for (let f = 1; f <= 3; f++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.1), winMat);
      win.position.set(0, f * 2.8, (x > 0 ? -d / 2 : d / 2));
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.35, 0.12), frameMat);
      frame.position.copy(win.position);
      b.add(frame, win);

      if (f === 2) {
        const balcFloor = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.15, 0.8), frameMat);
        balcFloor.position.set(0, f * 2.8 - 0.65, (x > 0 ? -d / 2 - 0.4 : d / 2 + 0.4));
        const rail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 0.05), new THREE.MeshStandardMaterial({ color: '#111111', metalness: 0.7, roughness: 0.3 }));
        rail.position.set(0, f * 2.8 - 0.25, (x > 0 ? -d / 2 - 0.8 : d / 2 + 0.8));
        b.add(balcFloor, rail);
      }
    }
    return b;
  }

  for (let i = -2; i <= 2; i++) {
    g.add(makeBuilding(-6.0, i * 8.0, 4.8, 7.2, 12 + Math.abs(i) * 2, wallColors[(i + 4) % wallColors.length]));
    g.add(makeBuilding(6.0, i * 8.0, 4.8, 7.2, 11 + (i % 2) * 3, wallColors[(i + 7) % wallColors.length]));
  }

  // Bunting Flags overhead
  const flagColors = ['#E63946', '#F1FAEE', '#A8DADC', '#FFB703', '#FB8500'];
  for (let z = -12; z <= 12; z += 6) {
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 12, 8), new THREE.MeshBasicMaterial({ color: '#333333' }));
    wire.rotation.z = Math.PI / 2;
    wire.position.set(0, 6.2 + Math.sin(z) * 0.4, z);
    g.add(wire);
    for (let fx = -4.5; fx <= 4.5; fx += 0.9) {
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.35, 3), new THREE.MeshStandardMaterial({ color: flagColors[Math.floor(Math.random() * flagColors.length)], roughness: 0.7 }));
      flag.rotation.x = Math.PI;
      flag.position.set(fx, 6.0, z);
      g.add(flag);
    }
  }

  return g;
}

// ============================================================================
// 2. ROYAL PALACE & ANCIENT INDIAN COURT
// ============================================================================
export function createPalaceArena() {
  const g = new THREE.Group();
  g.name = 'Environment_Palace';

  // Marble Court Floor
  const floorMat = new THREE.MeshStandardMaterial({ color: '#FFF8E7', roughness: 0.25, metalness: 0.1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 40), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  // Royal Velvet Carpet runner down the middle
  const carpetMat = new THREE.MeshStandardMaterial({ color: '#900C3F', roughness: 0.8 });
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 38), carpetMat);
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = 0.012;
  carpet.receiveShadow = true;
  g.add(carpet);

  // Ornate Carved Stone Pillars
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#E8D5B5', roughness: 0.65 });
  const goldMat = new THREE.MeshStandardMaterial({ color: '#D4AF37', roughness: 0.3, metalness: 0.7 });

  for (let z = -15; z <= 15; z += 5) {
    for (const x of [-4.2, 4.2]) {
      const p = new THREE.Group();
      p.position.set(x, 0, z);

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.40, 8.0, 16), pillarMat);
      shaft.position.y = 4.0;
      shaft.castShadow = true; shaft.receiveShadow = true;

      const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 1.1), goldMat);
      base.position.y = 0.25;

      const capital = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1.2), goldMat);
      capital.position.y = 7.7;

      p.add(shaft, base, capital);
      g.add(p);
    }
  }

  // Royal Throne Pedestal at far end (z = -16)
  const throneGroup = new THREE.Group();
  throneGroup.position.set(0, 0, -16);
  for (let s = 0; s < 3; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(6.0 - s * 1.2, 0.25, 4.0 - s * 0.8), goldMat);
    step.position.y = s * 0.25 + 0.125;
    step.receiveShadow = true;
    throneGroup.add(step);
  }
  g.add(throneGroup);

  return g;
}

// ============================================================================
// 3. MODERN CREATOR STUDIO & TECH ROOM
// ============================================================================
export function createStudioArena() {
  const g = new THREE.Group();
  g.name = 'Environment_Studio';

  // Rich Wood Flooring
  const floorMat = new THREE.MeshStandardMaterial({ color: '#3E2723', roughness: 0.4, metalness: 0.05 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  // Modern Accent Back Wall (Dark Slate with Neon Slits)
  const wallMat = new THREE.MeshStandardMaterial({ color: '#1E242B', roughness: 0.75 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(24, 10, 0.5), wallMat);
  backWall.position.set(0, 5, -8);
  backWall.receiveShadow = true;
  g.add(backWall);

  // Vertical Neon LED Strip Lights
  const neonMat = new THREE.MeshStandardMaterial({ color: '#00E5FF', emissive: '#00B0FF', emissiveIntensity: 2.5, roughness: 0.1 });
  for (let x = -7; x <= 7; x += 3.5) {
    const neon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 7.5, 0.05), neonMat);
    neon.position.set(x, 4.5, -7.7);
    g.add(neon);
  }

  // Floating Bookshelf / Display Podiums
  const shelfMat = new THREE.MeshStandardMaterial({ color: '#263238', roughness: 0.5 });
  for (let s = -4; s <= 4; s += 8) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.5, 5.0, 0.8), shelfMat);
    shelf.position.set(s, 2.5, -7.2);
    shelf.castShadow = true; shelf.receiveShadow = true;
    g.add(shelf);
  }

  // Minimalist Creator Desk
  const desk = new THREE.Group();
  desk.position.set(0, 0, -2.5);
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 1.4), new THREE.MeshStandardMaterial({ color: '#FAFAFA', roughness: 0.2 }));
  top.position.y = 1.0;
  top.castShadow = true;
  const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 16), new THREE.MeshStandardMaterial({ color: '#111111', metalness: 0.8 }));
  leg1.position.set(-1.6, 0.5, 0.5);
  const leg2 = leg1.clone(); leg2.position.set(1.6, 0.5, 0.5);
  const leg3 = leg1.clone(); leg3.position.set(-1.6, 0.5, -0.5);
  const leg4 = leg1.clone(); leg4.position.set(1.6, 0.5, -0.5);
  desk.add(top, leg1, leg2, leg3, leg4);
  g.add(desk);

  return g;
}

// ============================================================================
// 4. ENVIRONMENT RESOLVER
// ============================================================================
export function createEnvironment3D(type = 'street') {
  if (type === 'palace' || type === 'history' || type === 'mythology') {
    return createPalaceArena();
  } else if (type === 'studio' || type === 'tech' || type === 'science') {
    return createStudioArena();
  }
  return createStreetArena();
}
