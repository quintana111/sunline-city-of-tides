// combat.js — punch, hitscan shots, player health for Sunline: City of Tides.
// Fresh implementation from design-r3.md section 8.
// F = punch (~2 units in front). Left mouse = hitscan shot with a short
// muzzle flash. Crime goes through police.reportCrime only.
import * as THREE from '../vendor/three.min.js';

const PUNCH_RANGE = 2.4;
const PUNCH_ARC = 0.55; // cosine of the half-angle in front of the player
const SHOT_RANGE = 42;
const SHOT_LANE = 3.0; // how close to the shot line a ped must be to count
const MELEE_COOLDOWN = 0.55;
const SHOOT_COOLDOWN = 0.45;
const GRACE_AFTER_HIT = 0.5;
const DOWN_TIME = 2.5;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function pointInsideBuilding(world, x, z, margin) {
  const list = world.colliders || [];
  for (const c of list) {
    const hw = (c.hw !== undefined ? c.hw : (c.w || 0) / 2) + margin;
    const hd = (c.hd !== undefined ? c.hd : (c.d || 0) / 2) + margin;
    if (Math.abs(x - c.x) < hw && Math.abs(z - c.z) < hd) return true;
  }
  return false;
}

function resolvePoint(world, x, z) {
  const clear = (px, pz) => px >= -610 && px <= 610 && pz >= -610 && pz <= 556 && !pointInsideBuilding(world, px, pz, 2);
  if (clear(x, z)) return { x, z };
  for (let r = 4; r <= 48; r += 4) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      if (clear(x + Math.cos(a) * r, z + Math.sin(a) * r)) {
        return { x: Math.round((x + Math.cos(a) * r) * 10) / 10, z: Math.round((z + Math.sin(a) * r) * 10) / 10 };
      }
    }
  }
  return { x, z };
}

function pedPos(ped) {
  if (ped.x !== undefined && ped.z !== undefined) return { x: ped.x, z: ped.z };
  if (ped.mesh) return { x: ped.mesh.position.x, z: ped.mesh.position.z };
  if (ped.group) return { x: ped.group.position.x, z: ped.group.position.z };
  return { x: 0, z: 0 };
}

export function createCombat(scene, world, state, police, traffic) {
  let meleeT = 0;
  let shootT = 0;
  let graceT = 0;
  let flashT = 0;
  let lastF = false;
  let lastMouse = false;
  let weapon = 'pistol';

  function readPeds() {
    if (traffic && Array.isArray(traffic.peds)) return traffic.peds;
    try {
      const g = globalThis.__game;
      if (g && g.traffic && Array.isArray(g.traffic.peds)) return g.traffic.peds;
    } catch (e) { /* no live game */ }
    return [];
  }

  // Muzzle flash: a short-lived bright line from the player's hands.
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const flash = new THREE.Line(
    flashGeo,
    new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95 }),
  );
  flash.visible = false;
  flash.frustumCulled = false;
  scene.add(flash);

  // Health pickups: green crosses at clear spots, +25 health each.
  const pickups = [];
  const pickupSpots = [[-320, 150], [-100, 520], [430, 520]];
  for (const [sx, sz] of pickupSpots) {
    const at = resolvePoint(world, sx, sz);
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x1d8a4c, emissiveIntensity: 0.7, roughness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdddddd, emissiveIntensity: 0.4 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.25), mat);
    g.add(box);
    const barH = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.3), white);
    g.add(barH);
    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.3), white);
    g.add(barV);
    g.position.set(at.x, 1.2, at.z);
    scene.add(g);
    pickups.push({ group: g, x: at.x, z: at.z, taken: false, respawnT: 0, spin: 0 });
  }

  function witnessNear(position, radius) {
    for (const ped of readPeds()) {
      const pp = pedPos(ped);
      if (Math.hypot(pp.x - position.x, pp.z - position.z) <= radius) return true;
    }
    try {
      const units = state._policeUnits || [];
      for (const u of units) if (Math.hypot(u.x - position.x, u.z - position.z) <= 60) return true;
    } catch (e) { /* no units */ }
    return false;
  }

  function knockDown(ped) {
    ped.down = true;
    ped.downT = DOWN_TIME;
    const mesh = ped.mesh || ped.group;
    if (mesh) mesh.rotation.x = -Math.PI / 2;
  }

  function scareNearby(position, radius) {
    for (const ped of readPeds()) {
      if (ped.down) continue;
      const pp = pedPos(ped);
      const d = Math.hypot(pp.x - position.x, pp.z - position.z);
      if (d <= radius && d > 0.01) {
        ped.flee = true;
        ped.fleeT = 4;
        ped.fx = pp.x + ((pp.x - position.x) / d) * 22;
        ped.fz = pp.z + ((pp.z - position.z) / d) * 22;
      }
    }
  }

  function punch() {
    if (meleeT > 0) return false;
    meleeT = MELEE_COOLDOWN;
    weapon = 'fists';
    const p = state.player.pos;
    const fx = Math.sin(state.player.heading);
    const fz = -Math.cos(state.player.heading);
    let hit = null;
    let bestD = Infinity;
    for (const ped of readPeds()) {
      if (ped.down) continue;
      const pp = pedPos(ped);
      const dx = pp.x - p.x;
      const dz = pp.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > PUNCH_RANGE || d < 0.01) continue;
      if ((dx * fx + dz * fz) / d < PUNCH_ARC) continue;
      if (d < bestD) { bestD = d; hit = ped; }
    }
    if (hit) {
      knockDown(hit);
      scareNearby(p, 10);
      if (police && police.reportCrime) police.reportCrime('assault', { x: p.x, z: p.z }, 25);
    }
    return !!hit;
  }

  function shoot() {
    if (shootT > 0) return false;
    shootT = SHOOT_COOLDOWN;
    weapon = 'pistol';
    const p = state.player.pos;
    const fx = Math.sin(state.player.heading);
    const fz = -Math.cos(state.player.heading);
    // Muzzle flash line, 1.2 -> 3.2 units ahead, gone in ~60 ms.
    const pos = flashGeo.attributes.position.array;
    pos[0] = p.x + fx * 1.2; pos[1] = 1.35; pos[2] = p.z + fz * 1.2;
    pos[3] = p.x + fx * 3.2; pos[4] = 1.35; pos[5] = p.z + fz * 3.2;
    flashGeo.attributes.position.needsUpdate = true;
    flash.visible = true;
    flashT = 0.06;
    let hit = null;
    let bestD = Infinity;
    for (const ped of readPeds()) {
      if (ped.down) continue;
      const pp = pedPos(ped);
      const dx = pp.x - p.x;
      const dz = pp.z - p.z;
      const along = dx * fx + dz * fz;
      if (along < 0 || along > SHOT_RANGE) continue;
      const side = Math.abs(dx * fz - dz * fx);
      if (side > SHOT_LANE) continue;
      if (along < bestD) { bestD = along; hit = ped; }
    }
    if (hit) {
      knockDown(hit);
      scareNearby(p, 14);
    } else {
      scareNearby(p, 8);
    }
    if (police && police.reportCrime) police.reportCrime('weaponFire', { x: p.x, z: p.z }, 40);
    return !!hit;
  }

  function damagePlayer(amount, source) {
    if (graceT > 0) return state.player.health;
    if (state.player.health <= 0) return 0;
    graceT = GRACE_AFTER_HIT;
    state.player.health = clamp(state.player.health - amount, 0, 100);
    if (state.player.health <= 0) {
      state.screen = 'over';
      state._dialogue = { text: 'Nia is down. A cut of the cash is gone — recover and go again.', until: Date.now() + 6000 };
    }
    return state.player.health;
  }

  function getWeaponState() {
    return { weapon, ammo: Infinity, shootCooldown: Math.max(0, shootT), meleeCooldown: Math.max(0, meleeT) };
  }

  function update(dt, input) {
    if (!dt || dt <= 0) dt = 0.016;
    dt = Math.min(dt, 0.05);
    meleeT = Math.max(0, meleeT - dt);
    shootT = Math.max(0, shootT - dt);
    graceT = Math.max(0, graceT - dt);
    if (flashT > 0) {
      flashT -= dt;
      if (flashT <= 0) flash.visible = false;
    }
    // Knocked-down peds get back up.
    for (const ped of readPeds()) {
      if (ped.down && ped.downT !== undefined) {
        ped.downT -= dt;
        if (ped.downT <= 0) {
          ped.down = false;
          const mesh = ped.mesh || ped.group;
          if (mesh) mesh.rotation.x = 0;
        }
      }
    }
    // Pickups: slow spin + bob, collect on approach, respawn after 90 s.
    for (const pk of pickups) {
      pk.spin += dt;
      if (pk.taken) {
        pk.respawnT -= dt;
        if (pk.respawnT <= 0) {
          pk.taken = false;
          pk.group.visible = true;
        }
        continue;
      }
      pk.group.rotation.y = pk.spin;
      pk.group.position.y = 1.2 + Math.sin(pk.spin * 2) * 0.15;
      const d = Math.hypot(state.player.pos.x - pk.x, state.player.pos.z - pk.z);
      if (d < 2.2 && state.player.health < 100) {
        state.player.health = clamp(state.player.health + 25, 0, 100);
        pk.taken = true;
        pk.respawnT = 90;
        pk.group.visible = false;
        state._dialogue = { text: '+25 health. Patch up and keep moving.', until: Date.now() + 3000 };
      }
    }
    if (state.screen !== 'play') return;
    if (state.player.onFoot === false) return; // no shooting while driving
    const inp = input || state.input || {};
    const keys = inp.keys;
    const fHeld = keys && typeof keys.has === 'function' ? keys.has('KeyF') : false;
    if (fHeld && !lastF) punch();
    lastF = fHeld;
    const mouse = inp.mouseButtons;
    const mHeld = mouse && typeof mouse.has === 'function' ? mouse.has(0) : false;
    if (mHeld && !lastMouse) shoot();
    lastMouse = mHeld;
  }

  return { update, damagePlayer, getWeaponState, punch, shoot, pickups };
}
