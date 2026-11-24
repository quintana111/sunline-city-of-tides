// police.js — wanted levels + pursuing cruisers for Sunline: City of Tides.
// Fresh implementation from design-r3.md sections 6 and 11.
// Heading convention (authoritative): forward = (sin h, 0, -cos h);
// mesh rotation.y = -heading. Pursuit always drives FORWARD.
import * as THREE from '../vendor/three.min.js';

const ROAD_LINES = [-560, -448, -336, -224, -112, 0, 112, 224, 336, 448, 560];
const MAX_UNITS = 3;
const CRUISE_TOP = 26;
const RAISES = { vehicleTheft: 1, assault: 1, weaponFire: 2, attackPolice: 2, propertyDamage: 1 };
const ALWAYS_WITNESSED = new Set(['attackPolice', 'weaponFire']);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function nearestLine(v) {
  let best = ROAD_LINES[0];
  for (const line of ROAD_LINES) if (Math.abs(v - line) < Math.abs(v - best)) best = line;
  return best;
}
// Nearest peds, for the witnessed-crime rule. Police owns no traffic
// reference, so it reads the live game object when present (browser) and
// degrades to "no witnesses" anywhere else (Node tests).
function readPeds() {
  try {
    const g = globalThis.__game;
    if (g && g.traffic && Array.isArray(g.traffic.peds)) return g.traffic.peds;
  } catch (e) { /* no live game */ }
  return [];
}

let sharedMats = null;
function cruiserMaterials() {
  if (sharedMats) return sharedMats;
  sharedMats = {
    body: new THREE.MeshStandardMaterial({ color: 0xf2f0e8, roughness: 0.5, metalness: 0.25 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x14263e, roughness: 0.25, metalness: 0.6 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.6, metalness: 0.2 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
    red: new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2020, emissiveIntensity: 1 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x2a6aff, emissive: 0x2040ff, emissiveIntensity: 1 }),
  };
  return sharedMats;
}

function buildCruiser() {
  const m = cruiserMaterials();
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 4.8), m.body);
  body.position.y = 0.55;
  group.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.22, 4.82), m.trim);
  stripe.position.y = 0.5;
  group.add(stripe);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.62, 2.3), m.glass);
  cabin.position.set(0, 1.2, -0.2);
  group.add(cabin);
  const barBase = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.5), m.trim);
  barBase.position.set(0, 1.58, -0.2);
  group.add(barBase);
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.42), m.red);
  red.position.set(-0.42, 1.7, -0.2);
  group.add(red);
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.42), m.blue);
  blue.position.set(0.42, 1.7, -0.2);
  group.add(blue);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
  for (const [wx, wz] of [[-0.95, 1.55], [0.95, 1.55], [-0.95, -1.55], [0.95, -1.55]]) {
    const wheel = new THREE.Mesh(wheelGeo, m.tyre);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.42, wz);
    group.add(wheel);
  }
  return group;
}

export function createPolice(scene, world, state, vehicleManager) {
  const rng = mulberry32((state.seed || 24681357) ^ 0x9e3779b9);
  const units = [];
  const api = {
    units,
    time: 0,
    lastReportT: -99,
    escapeT: 0,
    decayT: 0,
    flashT: 0,
    arrestT: 0,
  };
  state._policeUnits = units;
  // Vehicles report theft through this hook; the witnessed rule applies
  // inside reportCrime, so an unseen car taken at night stays quiet.
  state._onVehicleTheft = () => {
    const p = state.player.pos;
    api.reportCrime('vehicleTheft', { x: p.x, z: p.z }, 30);
  };

  function desiredCount(level) {
    if (level <= 0) return 0;
    if (level <= 2) return 1;
    if (level === 3) return 2;
    return 3;
  }

  // Pick a road point near the player, outside the immediate camera view,
  // never inside a building, never on the beach or ocean edge.
  function spawnPoint() {
    const p = state.player.pos;
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = rng() * Math.PI * 2;
      const d = 55 + rng() * 30;
      let x = p.x + Math.sin(a) * d;
      let z = p.z + Math.cos(a) * d;
      const nx = nearestLine(x);
      const nz = nearestLine(z);
      if (Math.abs(x - nx) <= Math.abs(z - nz)) {
        x = nx + (rng() < 0.5 ? -4.5 : 4.5);
      } else {
        z = nz + (rng() < 0.5 ? -4.5 : 4.5);
      }
      x = clamp(x, -610, 610);
      z = clamp(z, -610, 552);
      const dist = Math.hypot(x - p.x, z - p.z);
      if (dist < 35) continue;
      return { x, z };
    }
    const line = nearestLine(p.x + 70);
    return { x: line + 4.5, z: clamp(p.z, -600, 550) };
  }

  function addUnit(x, z, heading) {
    const group = buildCruiser();
    group.position.set(x, 0, z);
    group.rotation.y = -heading;
    scene.add(group);
    const unit = {
      id: units.length, group, x, z, heading, speed: 0,
      mode: 'chase', stuckT: 0, lastX: x, lastZ: z,
    };
    units.push(unit);
    return unit;
  }

  function removeUnit(unit) {
    scene.remove(unit.group);
    const i = units.indexOf(unit);
    if (i >= 0) units.splice(i, 1);
  }

  function syncUnits() {
    const want = desiredCount(state.wanted);
    while (units.length < want) {
      const s = spawnPoint();
      const heading = Math.atan2(state.player.pos.x - s.x, -(state.player.pos.z - s.z));
      addUnit(s.x, s.z, heading);
    }
    while (units.length > want) removeUnit(units[units.length - 1]);
    for (const u of units) {
      u.group.position.set(u.x, 0, u.z);
      u.group.rotation.y = -u.heading;
    }
  }

  // Spawn (or move) unit `index` at an exact spot. Used by shot staging:
  // setWanted alone creates meshes, but a frozen shot sim never runs
  // update(), so staging places cruisers explicitly.
  function placeUnit(x, z, heading, index) {
    while (units.length <= index) {
      const s = spawnPoint();
      addUnit(s.x, s.z, 0);
    }
    const u = units[index];
    u.x = x; u.z = z; u.heading = heading; u.speed = 0; u.mode = 'chase';
    u.group.position.set(x, 0, z);
    u.group.rotation.y = -heading;
    return u;
  }

  function witnessNear(position, radius) {
    for (const ped of readPeds()) {
      const px = ped.x !== undefined ? ped.x : (ped.mesh ? ped.mesh.position.x : 0);
      const pz = ped.z !== undefined ? ped.z : (ped.mesh ? ped.mesh.position.z : 0);
      if (Math.hypot(px - position.x, pz - position.z) <= radius) return true;
    }
    for (const u of units) {
      if (Math.hypot(u.x - position.x, u.z - position.z) <= 60) return true;
    }
    return false;
  }

  function reportCrime(kind, position, witnessRadius) {
    if (!RAISES[kind]) return false;
    const pos = position || { x: state.player.pos.x, z: state.player.pos.z };
    const radius = witnessRadius === undefined ? 30 : witnessRadius;
    const witnessed = ALWAYS_WITNESSED.has(kind) || witnessNear(pos, radius);
    if (!witnessed) return false;
    if (api.time - api.lastReportT < 2.5) return false;
    api.lastReportT = api.time;
    api.escapeT = 0;
    api.decayT = 0;
    api.setWanted(Math.min(5, state.wanted + RAISES[kind]));
    return true;
  }

  function setWanted(level) {
    state.wanted = clamp(Math.round(level) || 0, 0, 5);
    api.escapeT = 0;
    api.decayT = 0;
    syncUnits();
    return state.wanted;
  }

  function clear() {
    while (units.length > 0) removeUnit(units[units.length - 1]);
    state.wanted = 0;
    api.escapeT = 0;
    api.decayT = 0;
    api.arrestT = 0;
  }

  function update(dt) {
    if (!dt || dt <= 0) dt = 0.016;
    dt = Math.min(dt, 0.05);
    api.time += dt;
    if (state.screen !== 'play') return;
    syncUnits();
    const p = state.player.pos;
    // Light-bar flash, alternating red / blue.
    api.flashT += dt;
    const phase = Math.floor(api.flashT / 0.25) % 2 === 0;
    const mats = cruiserMaterials();
    mats.red.emissiveIntensity = phase ? 1.6 : 0.25;
    mats.blue.emissiveIntensity = phase ? 0.25 : 1.6;
    if (state.wanted <= 0 || units.length === 0) return;
    let minDist = Infinity;
    for (const u of units) {
      const dx = p.x - u.x;
      const dz = p.z - u.z;
      const dist = Math.hypot(dx, dz);
      if (dist < minDist) minDist = dist;
      // Road-following pursuit: on a single-axis road, travel along it
      // toward the player's coordinate on that axis; at intersections or
      // off-road, steer directly at the player.
      const onNS = Math.abs(u.x - nearestLine(u.x)) < 7;
      const onEW = Math.abs(u.z - nearestLine(u.z)) < 7;
      let desired;
      if (onNS && !onEW) desired = dz < 0 ? 0 : Math.PI;
      else if (onEW && !onNS) desired = dx < 0 ? -Math.PI / 2 : Math.PI / 2;
      else desired = Math.atan2(dx, -dz);
      const turn = clamp(angleDiff(desired, u.heading), -2.4 * dt, 2.4 * dt);
      u.heading += turn;
      // Chase speed: full tilt from afar, ease off to a low-speed ram
      // range up close; never reverse.
      let target = 26;
      if (dist < 8) target = 8;
      else if (dist < 25) target = 18;
      if (state.currentVehicle) target = Math.min(target, CRUISE_TOP);
      u.speed += clamp(target - u.speed, -14 * dt, 10 * dt);
      u.speed = clamp(u.speed, 0, CRUISE_TOP);
      // Drive FORWARD: velocity (sin h, -cos h). Never backwards.
      u.x += Math.sin(u.heading) * u.speed * dt;
      u.z += -Math.cos(u.heading) * u.speed * dt;
      u.x = clamp(u.x, -612, 612);
      u.z = clamp(u.z, -612, 556);
      u.group.position.set(u.x, 0, u.z);
      u.group.rotation.y = -u.heading;
      // Stuck detection: barely moved while at speed -> nudge heading.
      const moved = Math.hypot(u.x - u.lastX, u.z - u.lastZ);
      if (u.speed > 5 && moved < 0.05) u.stuckT += dt; else u.stuckT = 0;
      if (u.stuckT > 1.2) {
        u.heading += Math.PI / 2;
        u.stuckT = 0;
      }
      u.lastX = u.x; u.lastZ = u.z;
      // Arrest: on-foot player held close by a cruiser.
      if (state.player.onFoot && dist < 3) {
        api.arrestT += dt;
        if (api.arrestT > 2.0) {
          const fine = Math.min(100, state.player.cash);
          state.player.cash -= fine;
          state.player.health = Math.max(25, state.player.health - 10);
          state._dialogue = { text: `Busted — $${fine} bail paid. Lay low, Nia.`, until: Date.now() + 5000 };
          api.arrestT = 0;
          api.clear();
        }
      }
    }
    if (state.player.onFoot) {
      let near = false;
      for (const u of units) if (Math.hypot(u.x - p.x, u.z - p.z) < 3) near = true;
      if (!near) api.arrestT = 0;
    } else {
      api.arrestT = 0;
    }
    // Escape: out of search radius for 18 s -> lose one star per 12 s.
    if (minDist > 90) {
      api.escapeT += dt;
      if (api.escapeT > 18) {
        api.decayT += dt;
        while (api.decayT >= 12 && state.wanted > 0) {
          api.decayT -= 12;
          api.setWanted(state.wanted - 1);
        }
      }
    } else {
      api.escapeT = 0;
      api.decayT = 0;
    }
  }

  api.update = update;
  api.reportCrime = reportCrime;
  api.setWanted = setWanted;
  api.clear = clear;
  api.placeUnit = placeUnit;
  api.getWanted = () => state.wanted;
  api.witnessNear = witnessNear;
  return api;
}
