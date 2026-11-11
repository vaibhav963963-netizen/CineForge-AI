// 3D Gully Cricket Cinematic Shots
// Authentic Hinglish Gully Cricket animation with true 3D articulated characters,
// procedural arena, multi-camera choreography, dynamic impact FX, and cinematic lighting.

import * as THREE from 'three';
import { clamp, lerp, eo, eio, eob } from './core/lib.js';
import { L, Wd } from './core/timing.js';
import { camera, lightRig } from './core/engine.js';
import {
  createGullyArena,
  createPlayer3D,
  createWickets,
  createCricketBall,
  createSparkBurst
} from './core/cricket_arena.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const mixV3 = (a, b, k) => a.clone().lerp(b, k);

export function buildShots(E) {
  const S = [];
  const CUES = [];
  const add = (o) => (S.push(o), o);
  const cue = (t, type, o = {}) => CUES.push({ t: +t.toFixed(3), type, ...o });

  // Timing helper based on line start
  const cut = (i) => (i === 0 ? 0 : L(i) - 0.05);

  // 1. Master 3D Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#90CAF9'); // Vibrant Indian afternoon sky
  scene.fog = new THREE.FogExp2('#C5E1A5', 0.008); // Distant heat haze

  // 2. Add Gully Arena & Lighting
  const arena = createGullyArena();
  scene.add(arena);

  const lights = lightRig(scene, {
    key: '#FFF0D4',
    keyI: 3.6,
    keyPos: [8, 16, 6],
    target: [0, 1.2, 0],
    rimCol: '#90CAF9',
    rimI: 2.2,
    sky: '#E3F2FD',
    ground: '#8D6E63',
    hemiI: 1.1,
    shadowBox: 16
  });

  // 3. Characters & Equipment
  // Striker Batsman "Bunty" (Team Blue)
  const batsman = createPlayer3D({
    role: 'batsman',
    jersey: '#1976D2',
    skin: '#F0B27A',
    trim: '#FFD54F',
    hair: '#1A1A1A'
  });
  batsman.group.position.set(0, 0, 8.5);
  scene.add(batsman.group);

  // Stumps & Bails behind batsman
  const strikerWickets = createWickets();
  strikerWickets.position.set(0, 0, 9.6);
  scene.add(strikerWickets);

  // Non-striker Wickets
  const nonStrikerWickets = createWickets();
  nonStrikerWickets.position.set(0, 0, -9.6);
  nonStrikerWickets.rotation.y = Math.PI;
  scene.add(nonStrikerWickets);

  // Fast Bowler "Gully Dale Steyn" (Team Orange)
  const bowler = createPlayer3D({
    role: 'bowler',
    jersey: '#F4511E',
    skin: '#DE935F',
    trim: '#FFFFFF',
    hair: '#212121'
  });
  bowler.group.position.set(0, 0, -11.0);
  scene.add(bowler.group);

  // Red Leather Cricket Ball
  const ball = createCricketBall();
  ball.position.set(0, 1.2, -9.0);
  scene.add(ball);

  // Spark burst effect at impact
  const sparks = createSparkBurst();
  sparks.visible = false;
  scene.add(sparks);

  // Glass Shatter Shards for Sharma Aunty's Window
  const shardCount = 35;
  const shardGeo = new THREE.BoxGeometry(0.12, 0.12, 0.02);
  const shardMat = new THREE.MeshStandardMaterial({
    color: '#E0F7FA',
    roughness: 0.1,
    metalness: 0.9,
    transparent: true,
    opacity: 0.85
  });
  const shardsGroup = new THREE.Group();
  const shardVels = [];
  for (let i = 0; i < shardCount; i++) {
    const shard = new THREE.Mesh(shardGeo, shardMat);
    shard.position.set(
      (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 1.0,
      (Math.random() - 0.5) * 0.1
    );
    shardsGroup.add(shard);
    shardVels.push(V3((Math.random() - 0.5) * 4.0, (Math.random() - 0.5) * 3.0 + 1.0, Math.random() * 5.0 + 2.0));
  }
  // Sharma Aunty's balcony window position: x=5.8, y=5.6, z=0.0
  shardsGroup.position.set(5.75, 5.6, 0.0);
  shardsGroup.visible = false;
  scene.add(shardsGroup);

  // Camera instance
  const cam = camera(38);

  // Cinematic Looks
  const LOOKS = {
    wide: { bloom: 0.28, aperture: 0.0008, maxblur: 0.006, warm: 0.03, sat: 1.15 },
    dramatic: { bloom: 0.35, aperture: 0.0018, maxblur: 0.008, warm: 0.04, sat: 1.2 },
    action: { bloom: 0.22, aperture: 0.0012, maxblur: 0.007, warm: 0.02, sat: 1.18 },
    slowmo: { bloom: 0.45, aperture: 0.0024, maxblur: 0.010, warm: 0.05, sat: 1.25 }
  };

  // Helper to render camera frame
  const shoot = (from, to, at, at2, k, look, focusDist) => {
    cam.position.copy(mixV3(from, to, k));
    const target = at2 ? mixV3(at, at2, k) : at;
    cam.lookAt(target);
    E.render(scene, cam, {
      ...look,
      focus: focusDist ?? cam.position.distanceTo(target)
    });
  };

  // =========================================================================
  // SHOT 0: Establishing Crane Shot (0.0s -> Line 1 Start)
  // High crane over gully rooftops sweeping down to batsman Bunty tapping bat.
  // =========================================================================
  add({
    id: 'S01_Establishing',
    at: 0.0,
    note: 'Crane sweep over Gully arena to Bunty tapping bat',
    draw(lt, d, t, blit) {
      const k = eio(clamp(lt / d, 0, 1));
      
      // Batsman taps bat on the crease
      batsman.group.position.set(0, 0, 8.5);
      batsman.setStance(t);

      // Bowler waiting at top of mark
      bowler.group.position.set(0, 0, -11.0);
      bowler.setBowlerAction(0);

      // Ball in bowler's hand
      ball.position.set(0.3, 1.2, -11.0);
      ball.visible = true;
      sparks.visible = false;
      shardsGroup.visible = false;

      // Crane camera from high above rooftops down to medium-full shot
      const camFrom = V3(4.8, 8.5, 16.5);
      const camTo = V3(2.2, 2.4, 12.8);
      const lookAtFrom = V3(0, 1.2, 5.0);
      const lookAtTo = V3(0, 1.1, 8.5);

      shoot(camFrom, camTo, lookAtFrom, lookAtTo, k, LOOKS.wide);
      blit();
    }
  });
  cue(0.1, 'whoosh', { gain: 0.6 });
  cue(1.2, 'pop', { gain: 0.5 });
  cue(2.8, 'pop', { gain: 0.5 });

  // =========================================================================
  // SHOT 1: Low-Angle Tension & Tilt-Up to Balcony (Line 1 -> Line 2)
  // "Aur agar ball Sharma aunty ke ghar gayi... toh batsman seedha OUT!"
  // =========================================================================
  add({
    id: 'S02_BalconyTilt',
    at: cut(1),
    note: 'Low angle batsman worry + tilt up to Sharma Aunty balcony',
    draw(lt, d, t, blit) {
      const k = eio(clamp(lt / d, 0, 1));

      // Batsman looks up with anxious expression
      batsman.group.position.set(0, 0, 8.5);
      batsman.setStance(t * 0.4);
      batsman.neck.rotation.set(-0.45 * Math.min(1, lt * 1.5), 0.35, 0);

      ball.visible = false;

      // Dynamic tilt: starts looking at batsman's worried face, tilts up to 2nd-floor balcony
      const camFrom = V3(-1.4, 0.8, 9.8);
      const camTo = V3(0.5, 1.4, 6.5);
      const lookFrom = V3(0, 1.4, 8.5); // Bunty's face
      const lookTo = V3(5.75, 5.6, 0.0); // Sharma Aunty's balcony window

      shoot(camFrom, camTo, lookFrom, lookTo, k, LOOKS.dramatic);
      blit();
    }
  });
  cue(cut(1), 'whoosh', { gain: 0.8 });
  cue(cut(1) + 1.2, 'tock', { gain: 0.7 });

  // =========================================================================
  // SHOT 2: Fast Bowler Charge-In & Delivery (Line 2 -> Line 3)
  // "Mohalle ka fast bowler aaya, aakhon mein aag, aur phenki tez raftaar bouncer!"
  // =========================================================================
  add({
    id: 'S03_BowlerRunUp',
    at: cut(2),
    note: 'Fast tracking shot ahead of bowler sprinting & delivering',
    draw(lt, d, t, blit) {
      const k = clamp(lt / d, 0, 1);
      
      // Bowler sprints from z = -11.0 to z = -7.5 and windmills arm
      const runZ = lerp(-11.0, -7.2, k);
      bowler.group.position.set(0, 0, runZ);
      bowler.setBowlerAction(k);

      // Ball attached to hand during windup, released at k = 0.82
      ball.visible = true;
      if (k < 0.82) {
        ball.position.set(0.3, bowler.hips.position.y + 0.3, runZ + 0.2);
      } else {
        const releaseP = (k - 0.82) / 0.18;
        ball.position.set(0, 1.8 - releaseP * 0.6, lerp(-7.0, -1.0, releaseP));
      }

      // Batsman in background waiting in stance
      batsman.group.position.set(0, 0, 8.5);
      batsman.setStance(t);

      // Dynamic front tracking camera rushing backwards ahead of bowler
      const camFrom = V3(0.4, 1.3, -8.2);
      const camTo = V3(0.1, 1.4, -4.5);
      const lookAt = V3(0, 1.3, runZ);

      // Camera shake during run
      const shake = Math.sin(lt * 28) * 0.03;
      cam.position.y += shake;

      shoot(camFrom, camTo, lookAt, null, k, LOOKS.action);
      blit();
    }
  });
  cue(cut(2), 'whoosh', { gain: 0.9 });
  cue(cut(2) + 0.8, 'whoosh', { gain: 0.6 });
  cue(cut(2) + 2.5, 'whoosh', { gain: 1.0 });

  // =========================================================================
  // SHOT 3: Over-the-Shoulder Batsman & Pitch Bounce (Line 3 -> Line 4)
  // "Batsman ne ball ko dekha, pairo ko jamaya, aur bat ko ghumaya..."
  // =========================================================================
  add({
    id: 'S04_OverTheShoulder',
    at: cut(3),
    note: 'Over the shoulder batsman view, ball hurtling & pitching on crease',
    draw(lt, d, t, blit) {
      const k = clamp(lt / d, 0, 1);

      // Batsman loads backlift
      batsman.group.position.set(0, 0, 8.5);
      batsman.setShot(k * 0.35);

      // Ball hurtling from z = -1.0 to z = 7.8
      ball.visible = true;
      const ballZ = lerp(-1.0, 7.8, k);
      // Realistic parabolic bounce: pitches at z = 3.5, rebounds up
      let ballY = 0.8;
      if (ballZ < 3.5) {
        ballY = lerp(1.5, 0.06, (ballZ + 1.0) / 4.5);
      } else {
        ballY = lerp(0.06, 1.1, (ballZ - 3.5) / 4.3);
      }
      ball.position.set(lerp(0.1, -0.05, k), Math.max(0.06, ballY), ballZ);
      ball.rotation.x += 0.4;

      // Over-the-right-shoulder camera tracking the incoming ball
      const camPos = V3(0.75, 1.7, 9.7);
      const lookTarget = mixV3(ball.position, V3(0, 1.2, 0), 0.3);

      shoot(camPos, camPos, lookTarget, null, 0, LOOKS.action, 3.2);
      blit();
    }
  });
  cue(cut(3), 'whoosh', { gain: 0.7 });
  cue(cut(3) + 1.8, 'pop', { gain: 0.8 }); // Ball pitch thud

  // =========================================================================
  // SHOT 4: Heroic Slow-Mo Helicopter Shot Impact! (Line 4 -> Line 5)
  // "Boom! Aisa helicopter shot mara ki ball seedhi chaand par!"
  // =========================================================================
  add({
    id: 'S05_HelicopterImpact',
    at: cut(4),
    note: 'Cinematic slow-mo 45-degree angle helicopter swing, impact flash & skyrocket',
    draw(lt, d, t, blit) {
      const k = clamp(lt / d, 0, 1);

      batsman.group.position.set(0, 0, 8.5);
      batsman.setShot(k);

      // Impact timing at k = 0.38
      if (k < 0.38) {
        // Ball arriving at bat zone
        ball.visible = true;
        ball.position.set(0.05, 1.0, lerp(7.6, 8.45, k / 0.38));
        sparks.visible = false;
      } else {
        // Boom! Spark burst triggers
        const afterImpact = (k - 0.38) / 0.62;
        sparks.visible = true;
        sparks.position.set(0.12, 1.05, 8.45);
        sparks.material.opacity = Math.max(0, 1.0 - afterImpact * 2.5);

        // Animate spark particles
        const pos = sparks.geometry.attributes.position.array;
        const vel = sparks.userData.vel;
        for (let i = 0; i < vel.length / 3; i++) {
          pos[i * 3] += vel[i * 3] * 0.02;
          pos[i * 3 + 1] += vel[i * 3 + 1] * 0.02;
          pos[i * 3 + 2] += vel[i * 3 + 2] * 0.02;
        }
        sparks.geometry.attributes.position.needsUpdate = true;

        // Ball skyrockets toward stratosphere!
        ball.visible = true;
        ball.position.set(
          lerp(0.12, 4.2, afterImpact),
          lerp(1.05, 14.5, afterImpact * afterImpact),
          lerp(8.45, 0.5, afterImpact)
        );
        ball.rotation.x += 0.8;
      }

      // Heroic low 45-degree angle camera tracking batsman and tilting up with ball
      const camFrom = V3(-2.6, 0.9, 10.6);
      const camTo = V3(-3.2, 1.8, 11.2);
      const lookAtFrom = V3(0, 1.1, 8.5);
      const lookAtTo = k > 0.4 ? ball.position : lookAtFrom;

      shoot(camFrom, camTo, lookAtFrom, lookAtTo, k, LOOKS.slowmo);
      blit();
    }
  });
  cue(cut(4), 'whoosh', { gain: 0.9 });
  cue(cut(4) + 0.45, 'slam', { gain: 1.0 }); // Solid bat-on-ball crack!
  cue(cut(4) + 0.5, 'sparkle', { gain: 0.8 });

  // =========================================================================
  // SHOT 5: Balcony Window Smash! (Line 5 -> Line 6)
  // "Phatak! Sharma aunty ki khidki ka kaanch chaknachoor!"
  // =========================================================================
  add({
    id: 'S06_WindowSmash',
    at: cut(5),
    note: 'Ball smashes into 2nd floor window, glass shards explode',
    draw(lt, d, t, blit) {
      const k = clamp(lt / d, 0, 1);

      // Hit occurs at k = 0.28
      const impactK = 0.28;
      ball.visible = true;

      if (k < impactK) {
        // Ball flying directly toward window (5.75, 5.6, 0.0)
        const p = k / impactK;
        ball.position.set(
          lerp(2.5, 5.75, p),
          lerp(8.0, 5.6, p),
          lerp(4.0, 0.0, p)
        );
        shardsGroup.visible = false;
      } else {
        // Glass shatter explodes outward!
        shardsGroup.visible = true;
        const postP = (k - impactK) / (1 - impactK);
        
        // Ball bounces off inside
        ball.position.set(5.75 + postP * 0.4, 5.6 - postP * 2.0, postP * 0.8);

        // Update glass shards
        for (let i = 0; i < shardsGroup.children.length; i++) {
          const sh = shardsGroup.children[i];
          const v = shardVels[i];
          sh.position.x += v.x * 0.025;
          sh.position.y += (v.y - postP * 3.5) * 0.025;
          sh.position.z += v.z * 0.025;
          sh.rotation.x += 0.2; sh.rotation.y += 0.25;
        }
      }

      // Close-up cinematic angle framed right at Sharma Aunty's balcony window
      const camFrom = V3(3.6, 5.2, 3.4);
      const camTo = V3(4.0, 5.4, 2.2);
      const windowTarget = V3(5.75, 5.6, 0.0);

      // Camera vibration on impact
      if (k >= impactK && k < impactK + 0.3) {
        const shake = (1 - (k - impactK) / 0.3) * 0.08 * Math.sin(lt * 45);
        cam.position.x += shake; cam.position.y += shake;
      }

      shoot(camFrom, camTo, windowTarget, null, k, LOOKS.dramatic);
      blit();
    }
  });
  cue(cut(5), 'whoosh', { gain: 0.8 });
  cue(cut(5) + 0.35, 'slam', { gain: 1.0 }); // Glass shatter sound
  cue(cut(5) + 0.4, 'pop', { gain: 0.6 });

  // =========================================================================
  // SHOT 6: 180-Degree Celebration Orbit (Line 6 -> End)
  // "Sab bhaag gaye, lekin batsman bola: Six toh six hota hai bro!"
  // =========================================================================
  add({
    id: 'S07_HeroCelebration',
    at: cut(6),
    note: '180-degree celebration orbit around Bunty raising his bat high',
    draw(lt, d, t, blit) {
      const k = eio(clamp(lt / d, 0, 1));

      // Bunty proudly raises his bat to the crowd
      batsman.group.position.set(0, 0, 8.5);
      batsman.setCelebration(t);

      // Bowler in distance with hands on head
      bowler.group.position.set(0, 0, -3.0);
      bowler.armL.shoulder.rotation.set(2.4, 0, -0.6);
      bowler.armR.shoulder.rotation.set(2.4, 0, 0.6);

      ball.visible = false;
      sparks.visible = false;
      shardsGroup.visible = false;

      // 180-degree camera orbit around Bunty
      const radius = 2.8;
      const angle = lerp(Math.PI * 0.15, Math.PI * 1.15, k);
      const camX = Math.sin(angle) * radius;
      const camZ = 8.5 + Math.cos(angle) * radius;
      const camY = lerp(1.3, 1.7, Math.sin(k * Math.PI));

      const camPos = V3(camX, camY, camZ);
      const heroHead = V3(0, 1.25, 8.5);

      shoot(camPos, camPos, heroHead, null, 0, LOOKS.wide, radius);
      blit();
    }
  });
  cue(cut(6), 'whoosh', { gain: 0.7 });
  cue(cut(6) + 0.3, 'sparkle', { gain: 0.8 });
  cue(cut(6) + 1.2, 'tock', { gain: 0.7 });

  return { shots: S, cues: CUES };
}
