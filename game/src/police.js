// Police + wanted system for Sunline: City of Tides.
// Wanted 0-5, witnessed crime reports, cruiser pursuit, escape decay.
// Forward = (sin h, 0, -cos h); mesh rotation.y = -heading. No Math.random().
import * as THREE from 'three';

export function createPolice(scene, world, state, vehicleManager) {
  const units = [];
  let elapsed = 0;
  let reportT = -Infinity;
  let escapeT = 0;
  let decayT = 0;

  const safeDt = (dt) => Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.1);

  const playerPosition = () => {
    const pos = state?.currentVehicle?.pos ?? state?.player?.pos;
    return {
      x: Number.isFinite(pos?.x) ? pos.x : 0,
      z: Number.isFinite(pos?.z) ? pos.z : 0,
    };
  };

  const isInsideBuilding = (x, z) => {
    for (const building of world?.buildings ?? []) {
      const hw = (building.w ?? 0) / 2 + 8;
      const hd = (building.d ?? 0) / 2 + 8;
      if (x >= building.x - hw && x <= building.x + hw &&
          z >= building.z - hd && z <= building.z + hd) return true;
    }
    return false;
  };

  const clampPoint = (x, z) => {
    if (typeof world?.clampToCity === 'function') {
      const c = world.clampToCity(x, z);
      if (c && Number.isFinite(c.x) && Number.isFinite(c.z)) return { x: c.x, z: c.z };
    }
    const half = (world?.size ?? 1120) / 2;
    return { x: Math.max(-half, Math.min(half, x)), z: Math.max(-half, Math.min(half, z)) };
  };

  // Nearest road point at least minDistance from the player, deterministic.
  function findRoadSpawn(minDistance = 35) {
    const player = playerPosition();
    const lines = Array.isArray(world?.roadLines) && world.roadLines.length
      ? world.roadLines
      : Array.from({ length: 11 }, (_, i) => -560 + i * 112);
    const candidates = [];
    for (const line of lines) {
      for (let offset = -224; offset <= 224; offset += 28) {
        candidates.push(clampPoint(line, player.z + offset));
        candidates.push(clampPoint(player.x + offset, line));
      }
    }
    candidates.sort((a, b) =>
      Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
    for (const point of candidates) {
      if (Math.hypot(point.x - player.x, point.z - player.z) >= minDistance &&
          !isInsideBuilding(point.x, point.z)) return point;
    }
    return null;
  }

  function removeUnit(unit) {
    if (!unit) return;
    const group = unit.group ?? unit.vehicle?.group;
    if (group && scene?.remove) scene.remove(group);
    const cars = vehicleManager?.cars;
    const vehicle = unit.vehicle;
    if (Array.isArray(cars) && vehicle) {
      const index = cars.indexOf(vehicle);
      if (index !== -1) cars.splice(index, 1);
    }
    const index = units.indexOf(unit);
    if (index !== -1) units.splice(index, 1);
    state.policeUnits = units;
  }

  // Spawn one cruiser immediately (synchronous, so shot staging works
  // without running update()).
  function placeUnit(x, z, heading = 0, index = units.length) {
    if (typeof vehicleManager?.createCar !== 'function') return null;
    const vehicle = vehicleManager.createCar('police', x, z, heading);
    if (!vehicle) return null;
    vehicle.heading = heading;
    vehicle.speed = 0;
    const group = vehicle.group;
    if (group) {
      group.position.x = x;
      group.position.z = z;
      group.rotation.y = -heading;
    }
    const unit = { id: vehicle.id ?? `police-${index}`, vehicle, group, ramT: 0, index };
    units.push(unit);
    state.policeUnits = units;
    return unit;
  }

  function desiredCount() {
    const wanted = Math.max(0, Math.min(5, Math.floor(Number(state?.wanted) || 0)));
    if (wanted === 0) return 0;
    if (wanted <= 2) return 1;
    if (wanted === 3) return 2;
    return 3;
  }

  function removeExcess(count) {
    while (units.length > count) removeUnit(units[units.length - 1]);
  }

  function ensureCount() {
    const count = desiredCount();
    removeExcess(count);
    while (units.length < count) {
      const point = findRoadSpawn(35);
      if (!point) break;
      const player = playerPosition();
      const heading = Math.atan2(player.x - point.x, -(player.z - point.z));
      if (!placeUnit(point.x, point.z, heading, units.length)) break;
    }
    state.policeUnits = units;
  }

  function setWanted(level) {
    const wanted = Math.max(0, Math.min(5, Math.floor(Number(level) || 0)));
    state.wanted = wanted;
    if (wanted === 0) {
      removeExcess(0);
      escapeT = 0;
      decayT = 0;
      state.policeUnits = units;
      return;
    }
    const count = wanted <= 2 ? 1 : wanted === 3 ? 2 : 3;
    removeExcess(count);
    const player = playerPosition();
    const heading = Number.isFinite(state?.player?.heading) ? state.player.heading : 0;
    const forwardX = Math.sin(heading);
    const forwardZ = -Math.cos(heading);
    const rightX = Math.cos(heading);
    const rightZ = Math.sin(heading);
    while (units.length < count) {
      const i = units.length;
      const side = i % 2 ? 5 : -5;
      const distance = 10 + i * 9;
      const x = player.x - forwardX * distance + rightX * side;
      const z = player.z - forwardZ * distance + rightZ * side;
      if (!placeUnit(x, z, heading, i)) break;
    }
    state.policeUnits = units;
  }

  function reportCrime(kind, position, witnessRadius = 40) {
    const validKinds = new Set(['vehicleTheft', 'assault', 'weaponFire', 'attackPolice', 'propertyDamage']);
    if (!validKinds.has(kind) || elapsed - reportT < 3) return false;
    const crimePos = position ?? playerPosition();
    const x = Number.isFinite(crimePos?.x) ? crimePos.x : 0;
    const z = Number.isFinite(crimePos?.z) ? crimePos.z : 0;
    const radius = Number.isFinite(witnessRadius) ? Math.max(0, witnessRadius) : 40;

    const policeWitness = units.some((unit) => {
      const pos = unit.group?.position ?? unit.vehicle?.pos;
      return pos && Math.hypot(pos.x - x, pos.z - z) <= radius;
    });
    let pedestrianWitness = false;
    const pedestrians = globalThis.window?.__game?.traffic?.pedestrians;
    if (Array.isArray(pedestrians)) {
      pedestrianWitness = pedestrians.some((ped) => {
        const pos = ped?.group?.position;
        return pos && Math.hypot(pos.x - x, pos.z - z) <= radius * 0.8;
      });
    }
    const witnessed = policeWitness || pedestrianWitness;
    // A stolen car is reported by its owner even with no witness.
    if (!witnessed && kind !== 'vehicleTheft') return false;

    const current = Math.max(0, Math.min(5, Math.floor(Number(state.wanted) || 0)));
    let next = current;
    if (kind === 'vehicleTheft' || kind === 'assault') next = Math.max(1, current + 1);
    else if (kind === 'weaponFire') next = Math.max(2, current + 1);
    else if (kind === 'attackPolice') next = Math.max(3, current + 2);
    else if (kind === 'propertyDamage') {
      if (current === 0 || !witnessed) return false;
      next = current + 1;
    }
    if (next === current) return false;
    reportT = elapsed;
    escapeT = 0;
    decayT = 0;
    setWanted(next);
    return true;
  }

  function updateLights(unit) {
    const group = unit.group;
    if (!group) return;
    const phase = Math.floor((Number(state?.timeOfDay) || 0) * 3600 + elapsed);
    const redOn = phase % 2 === 0;
    const setLight = (name, on) => {
      const light = group.getObjectByName?.(name);
      if (!light?.material) return;
      const materials = Array.isArray(light.material) ? light.material : [light.material];
      for (const material of materials) {
        if ('emissiveIntensity' in material) material.emissiveIntensity = on ? 3 : 0.15;
      }
    };
    setLight('redLight', redOn);
    setLight('blueLight', !redOn);
  }

  function update(dt) {
    const step = safeDt(dt);
    if (state?.screen !== 'play') return;
    elapsed += step;
    ensureCount();
    const player = playerPosition();
    let nearby = false;

    for (const unit of units) {
      const vehicle = unit.vehicle;
      const group = unit.group ?? vehicle?.group;
      if (!group) continue;
      const x = Number.isFinite(vehicle?.pos?.x) ? vehicle.pos.x : group.position.x;
      const z = Number.isFinite(vehicle?.pos?.z) ? vehicle.pos.z : group.position.z;
      const dx = player.x - x;
      const dz = player.z - z;
      const distance = Math.hypot(dx, dz);
      if (distance < 60) nearby = true;

      const heading = Math.atan2(dx, -dz);
      if (vehicle) vehicle.heading = heading;
      group.rotation.y = -heading;

      let speed = 14;
      let moveDistance = 0;
      if (distance > 6) {
        speed = Math.min(24, 20 + Math.max(0, (state.wanted ?? 1) - 1));
        moveDistance = speed * step;
      } else if (distance >= 3.2) {
        speed = 6;
        moveDistance = Math.min(speed * step, Math.max(0, distance - 4));
      } else {
        speed = 2;
        unit.ramT = Math.max(0, unit.ramT - step);
        if (unit.ramT === 0) {
          const actor = state.currentVehicle?.pos ?? state.player?.pos;
          if (actor) {
            actor.x += Math.sin(heading) * 2.2;
            actor.z -= Math.cos(heading) * 2.2;
          }
          unit.ramT = 1.2;
        }
      }
      const nextX = x + Math.sin(heading) * moveDistance;
      const nextZ = z - Math.cos(heading) * moveDistance;
      if (vehicle?.pos) {
        vehicle.pos.x = nextX;
        vehicle.pos.z = nextZ;
      }
      group.position.x = nextX;
      group.position.z = nextZ;
      if (vehicle) vehicle.speed = speed;
      updateLights(unit);
    }

    if (nearby) {
      escapeT = 0;
      decayT = 0;
    } else if (state.wanted > 0) {
      escapeT += step;
      if (escapeT >= 18) {
        decayT += step;
        if (decayT >= 12) {
          decayT -= 12;
          setWanted(Math.max(0, state.wanted - 1));
        }
      }
    }
    state.wanted = Math.max(0, Math.min(5, Math.floor(Number(state.wanted) || 0)));
    state.policeUnits = units;
  }

  function clear() {
    removeExcess(0);
    state.wanted = 0;
    escapeT = 0;
    decayT = 0;
    reportT = -Infinity;
    state.policeUnits = units;
  }

  const police = { units, update, reportCrime, setWanted, clear, placeUnit };
  state.policeUnits = units;
  state.police = police;
  return police;
}
