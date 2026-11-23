// Police + wanted system (design §8). Written fresh 2026-11-24 (Builder B).
// Heading convention (authoritative): forward = (sin h, 0, -cos h);
// every car mesh uses rotation.y = -heading, so pursuit drives FORWARD.
import * as THREE from 'three';

const ESCAPE_HIDDEN_SECONDS = 18;
const DECAY_SECONDS = 12;
const SEARCH_RADIUS = 60;
const MAX_UNITS = 3;

const ESCALATION = {
  vehicleTheft: 1,
  assault: 1,
  propertyDamage: 1,
  weaponFire: 2,
  attackPolice: 2,
};
const MIN_LEVEL = {
  vehicleTheft: 1,
  assault: 1,
  propertyDamage: 1,
  weaponFire: 3,
  attackPolice: 3,
};

function forwardForHeading(heading) {
  return { x: Math.sin(heading), z: -Math.cos(heading) };
}

// Shortest signed turn from `from` to `to` (radians, wrapped to [-PI, PI]).
function turnDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clampLevel(level) {
  return Math.max(0, Math.min(5, Math.floor(Number(level) || 0)));
}

function unitsForLevel(level) {
  if (level <= 0) return 0;
  if (level <= 2) return 1;
  if (level === 3) return 2;
  return 3;
}

export function createPolice(scene, world, state, vehicleManager) {
  const units = [];
  let lastReportAt = -10;
  let outOfSightTimer = 0;
  let decayTimer = 0;
  let spawnCounter = 0;
  let elapsed = 0;

  function playerPos() {
    return state.currentVehicle?.pos ?? state.player.pos;
  }

  function nearestUnitDistance() {
    const p = playerPos();
    let best = Infinity;
    for (const u of units) {
      const d = Math.hypot(u.pos.x - p.x, u.pos.z - p.z);
      if (d < best) best = d;
    }
    return best;
  }

  // Deterministic road spawn near the player: pick a road line by counter,
  // offset along it, never inside a building, never within 25u of the player.
  function spawnPointNearPlayer() {
    const p = playerPos();
    const lines = Array.isArray(world.roadLines) && world.roadLines.length
      ? world.roadLines : [-560, -448, -336, -224, -112, 0, 112, 224, 336, 448, 560];
    const offsets = [72, -84, 96, -64, 110, -96];
    for (let attempt = 0; attempt < lines.length; attempt++) {
      const line = lines[(spawnCounter + attempt) % lines.length];
      const along = offsets[(spawnCounter + attempt) % offsets.length];
      const axisX = ((spawnCounter + attempt) % 2) === 0;
      const x = axisX ? p.x + along : line + 4.5;
      const z = axisX ? line + 4.5 : p.z + along;
      const cx = THREE.MathUtils.clamp(x, -548, 548);
      const cz = THREE.MathUtils.clamp(z, -548, 560);
      const blocked = (world.buildings || []).some((b) =>
        Math.abs(cx - b.x) < b.w / 2 + 2 && Math.abs(cz - b.z) < b.d / 2 + 2);
      if (blocked) continue;
      if (Math.hypot(cx - p.x, cz - p.z) < 25) continue;
      spawnCounter += 1;
      return { x: cx, z: cz };
    }
    spawnCounter += 1;
    return { x: THREE.MathUtils.clamp(p.x + 80, -548, 548), z: THREE.MathUtils.clamp(p.z, -548, 560) };
  }

  function spawnUnit() {
    const point = spawnPointNearPlayer();
    const p = playerPos();
    const heading = Math.atan2(p.x - point.x, -(p.z - point.z));
    const car = vehicleManager.createCar('police', point.x, point.z, heading);
    car.speed = 0;
    const unit = { car, group: car.group, pos: car.pos, heading: car.heading, speed: 0, sirenPhase: 0 };
    units.push(unit);
    return unit;
  }

  function removeUnit(unit) {
    const i = units.indexOf(unit);
    if (i >= 0) units.splice(i, 1);
    if (unit.group && unit.group.parent) unit.group.parent.remove(unit.group);
    if (vehicleManager?.cars) {
      const j = vehicleManager.cars.indexOf(unit.car);
      if (j >= 0) vehicleManager.cars.splice(j, 1);
    }
  }

  function syncUnitCount() {
    const want = unitsForLevel(state.wanted);
    while (units.length < want && units.length < MAX_UNITS) spawnUnit();
    while (units.length > want) removeUnit(units[units.length - 1]);
  }

  function setWanted(level) {
    state.wanted = clampLevel(level);
    outOfSightTimer = 0;
    decayTimer = 0;
    // Spawn visible meshes even in ?shot= staging mode: createCar adds the
    // mesh to the scene immediately, no simulation tick required.
    syncUnitCount();
    return state.wanted;
  }

  function witnessesNear(pos, radius) {
    let count = 0;
    const traffic = world.state?.__trafficRef;
    void traffic;
    // Pedestrians are the witnesses: traffic module exposes them via
    // window.__game.traffic when running; fall back to police proximity.
    const g = typeof window !== 'undefined' ? window.__game : null;
    const peds = g?.traffic?.pedestrians ?? [];
    for (const ped of peds) {
      const pp = ped.group?.position;
      if (pp && Math.hypot(pp.x - pos.x, pp.z - pos.z) <= radius) count += 1;
    }
    for (const u of units) {
      if (Math.hypot(u.pos.x - pos.x, u.pos.z - pos.z) <= radius) count += 1;
    }
    return count;
  }

  function reportCrime(kind, position, witnessRadius = 30) {
    if (!ESCALATION[kind]) return state.wanted;
    const pos = position ?? playerPos();
    const now = elapsed;
    const target = Math.max(state.wanted + ESCALATION[kind], MIN_LEVEL[kind]);
    // Brief anti-spam delay — but a report that would raise the level
    // further always gets through (e.g. theft, then attacking police).
    if (target <= state.wanted && now - lastReportAt < 2) return state.wanted;
    const witnesses = witnessesNear(pos, witnessRadius);
    // Vehicle theft on a public street is always seen (breaking into a car
    // is loud and visible); other crimes need a witness nearby. Attacking
    // police is always seen.
    if (kind !== 'attackPolice' && kind !== 'vehicleTheft' && witnesses === 0 && state.wanted === 0) return state.wanted;
    lastReportAt = now;
    outOfSightTimer = 0;
    decayTimer = 0;
    setWanted(target);
    return state.wanted;
  }

  function clear() {
    while (units.length) removeUnit(units[units.length - 1]);
    state.wanted = 0;
    outOfSightTimer = 0;
    decayTimer = 0;
  }

  // Place a unit at a fixed offset relative to the player (deterministic
  // staging for ?shot=chase). `behind`/`left` are in player-local units.
  function placeUnit(index, behind, left) {
    syncUnitCount();
    const unit = units[index];
    if (!unit) return null;
    const p = playerPos();
    const heading = state.currentVehicle?.heading ?? state.player.heading;
    const fwd = forwardForHeading(heading);
    const right = { x: Math.cos(heading), z: Math.sin(heading) };
    unit.pos.x = p.x - fwd.x * behind - right.x * left;
    unit.pos.z = p.z - fwd.z * behind - right.z * left;
    unit.heading = heading;
    unit.speed = 16;
    unit.car.speed = 16;
    unit.car.heading = heading;
    if (unit.group) {
      unit.group.position.set(unit.pos.x, 0, unit.pos.z);
      unit.group.rotation.y = -heading;
    }
    return unit;
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    elapsed += dt;
    if (state.paused || state.screen === 'paused' || state.screen === 'over') return;
    if (state.wanted <= 0) {
      if (units.length) clear();
      return;
    }
    syncUnitCount();
    const p = playerPos();
    const playerSpeed = Math.abs(state.currentVehicle?.speed ?? 0) +
      Math.hypot(state.player.vel.x || 0, state.player.vel.z || 0);
    const nearest = nearestUnitDistance();

    // Escape: out of the search radius for 18s, then -1 star per 12s.
    if (nearest > SEARCH_RADIUS) {
      outOfSightTimer += dt;
      if (outOfSightTimer >= ESCAPE_HIDDEN_SECONDS) {
        decayTimer += dt;
        if (decayTimer >= DECAY_SECONDS) {
          decayTimer = 0;
          setWanted(state.wanted - 1);
          if (state.wanted <= 0) return;
        }
      }
    } else {
      outOfSightTimer = 0;
      decayTimer = 0;
    }

    for (const unit of units) {
      unit.sirenPhase += dt * 6;
      const dx = p.x - unit.pos.x;
      const dz = p.z - unit.pos.z;
      const dist = Math.hypot(dx, dz) || 0.001;
      const desired = Math.atan2(dx, -dz);
      // Steer toward the player, forward only: heading turns toward the
      // target, then the car advances along (sin h, 0, -cos h).
      unit.heading += THREE.MathUtils.clamp(
        turnDelta(unit.heading, desired), -1.9 * dt, 1.9 * dt);
      const targetSpeed = dist < 6 ? 4 : Math.min(26, 14 + playerSpeed * 0.55);
      unit.speed = THREE.MathUtils.lerp(unit.speed, targetSpeed, 1 - Math.exp(-2.5 * dt));
      const fwd = forwardForHeading(unit.heading);
      let nx = unit.pos.x + fwd.x * unit.speed * dt;
      let nz = unit.pos.z + fwd.z * unit.speed * dt;
      const blocked = (world.buildings || []).some((b) =>
        Math.abs(nx - b.x) < b.w / 2 + 1.4 && Math.abs(nz - b.z) < b.d / 2 + 1.4);
      if (blocked) {
        // Slide along the obstacle instead of driving through it.
        const tx = unit.pos.x + fwd.x * unit.speed * dt;
        const tz = unit.pos.z + fwd.z * unit.speed * dt;
        const xOk = !(world.buildings || []).some((b) =>
          Math.abs(tx - b.x) < b.w / 2 + 1.4 && Math.abs(unit.pos.z - b.z) < b.d / 2 + 1.4);
        const zOk = !(world.buildings || []).some((b) =>
          Math.abs(unit.pos.x - b.x) < b.w / 2 + 1.4 && Math.abs(tz - b.z) < b.d / 2 + 1.4);
        nx = xOk ? tx : unit.pos.x;
        nz = zOk ? tz : unit.pos.z;
        unit.speed *= 0.6;
      }
      unit.pos.x = THREE.MathUtils.clamp(nx, -560, 560);
      unit.pos.z = THREE.MathUtils.clamp(nz, -560, 680);
      unit.car.heading = unit.heading;
      unit.car.speed = unit.speed;
      if (unit.group) {
        unit.group.position.set(unit.pos.x, 0, unit.pos.z);
        unit.group.rotation.y = -unit.heading;
        // Flash the light bar red/blue.
        const red = unit.group.getObjectByName('redLight');
        const blue = unit.group.getObjectByName('blueLight');
        const on = Math.sin(unit.sirenPhase) > 0;
        if (red?.material) red.material.emissiveIntensity = on ? 2.2 : 0.25;
        if (blue?.material) blue.material.emissiveIntensity = on ? 0.25 : 2.2;
      }
      // Busted: a cruiser sits on the player while on foot and slow.
      if (dist < 3.2 && !state.currentVehicle && playerSpeed < 1.5) {
        state.player.health = Math.max(0, state.player.health - 12 * dt);
      }
    }
  }

  // Stealing a parked car is a crime (hook wired by vehicles.js).
  state._onVehicleTheft = (vehicle) => {
    reportCrime('vehicleTheft', vehicle?.pos, 40);
  };

  return {
    units,
    cars: units,
    update,
    reportCrime,
    setWanted,
    clear,
    placeUnit,
    getWanted() { return state.wanted; },
    getUnits() { return units; },
  };
}
