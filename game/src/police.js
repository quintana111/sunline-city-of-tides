// Deterministic wanted-level and cruiser pursuit system for Sunline: City of Tides.
// Forward = (sin h, 0, -cos h); mesh rotation.y = -heading. Any flashing is
// keyed to state.timeOfDay, never wall-clock time, so staged frames are stable.
import * as THREE from 'three';

export function createPolice(scene, world, state, vehicleManager) {
  const units = [];
  state.policeUnits = units;

  let clock = 0;
  let lastReportT = -Infinity;
  let escapeT = 0;
  let escapeThreshold = 18;

  const crimeHeat = {
    vehicleTheft: 1,
    assault: 1,
    weaponFire: 2,
    attackPolice: 2,
    propertyDamage: 1,
  };

  function playerPosition() {
    const p = state.currentVehicle?.pos || state.player?.pos || { x: 0, z: 0 };
    return { x: Number(p.x) || 0, z: Number(p.z) || 0 };
  }

  function distanceXZ(a, b) {
    return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.z || 0) - (b?.z || 0));
  }

  function pointInsideBuilding(x, z) {
    for (const b of world?.buildings || []) {
      if (Math.abs(x - b.x) <= (b.w || 0) * 0.5 &&
          Math.abs(z - b.z) <= (b.d || 0) * 0.5) return true;
    }
    return false;
  }

  // Pedestrians live on the traffic system, reachable via window.__game.
  function nearbyPedestrians() {
    try {
      if (typeof window !== 'undefined') {
        const peds = window.__game?.traffic?.pedestrians;
        if (Array.isArray(peds)) return peds;
      }
    } catch { /* ignore */ }
    return [];
  }

  function syncUnit(unit) {
    if (!unit?.vehicle) return;
    const v = unit.vehicle;
    unit.pos = v.pos;
    unit.heading = v.heading;
    if (unit.group) {
      unit.group.position.set(v.pos.x, v.pos.y || 0, v.pos.z);
      unit.group.rotation.y = -v.heading;
    }
  }

  function spawnPoint(index) {
    const player = playerPosition();
    const fixed = world?.spawnPoints?.police || [];
    const lines = world?.roadLines || [];
    const candidates = [];

    for (let i = 0; i < fixed.length; i++) {
      const p = fixed[(i + index) % fixed.length];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) candidates.push({ x: p.x, z: p.z });
    }

    // Road-line candidates are deterministic and stay a useful distance from the player.
    for (let r = 0; r < 8; r++) {
      const angle = ((index * 3 + r) % 8) * Math.PI / 4;
      const radius = 40 + ((index * 7 + r * 5) % 31);
      const x = player.x + Math.sin(angle) * radius;
      const z = player.z - Math.cos(angle) * radius;
      if (lines.length) {
        const line = lines[(index * 3 + r) % lines.length];
        if (r % 2 === 0) candidates.push({ x: line, z });
        else candidates.push({ x, z: line });
      }
      candidates.push({ x, z });
    }

    for (const p of candidates) {
      if (distanceXZ(p, player) >= 12 && !pointInsideBuilding(p.x, p.z)) return p;
    }

    // Last-resort deterministic fallback, still kept outside the immediate player radius.
    for (let r = 0; r < 12; r++) {
      const angle = (index + r) * Math.PI / 6;
      const p = { x: player.x + Math.sin(angle) * 24, z: player.z - Math.cos(angle) * 24 };
      if (!pointInsideBuilding(p.x, p.z)) return p;
    }
    return { x: player.x + 24, z: player.z };
  }

  function placeUnit(x, z, heading = 0, index = units.length) {
    let unit = units[index];
    if (!unit) {
      let vehicle = null;
      try {
        vehicle = vehicleManager?.createCar?.('police', x, z, heading) || null;
      } catch (_) {
        vehicle = null;
      }
      if (!vehicle) return null;

      unit = {
        vehicle,
        group: vehicle.group,
        pos: vehicle.pos,
        heading,
        mode: 'chase',
        speed: 0,
        searchT: 0,
        escapeT: 0,
        ramT: 0,
      };
      units[index] = unit;
      if (unit.group && scene && unit.group.parent !== scene) scene.add(unit.group);
    }

    const v = unit.vehicle;
    if (!v.pos) v.pos = { x: 0, y: 0, z: 0 };
    v.pos.x = x;
    v.pos.z = z;
    v.heading = heading;
    v.speed = 0;
    unit.pos = v.pos;
    unit.heading = heading;
    unit.speed = 0;
    unit.ramT = 0;
    syncUnit(unit);
    return unit;
  }

  function removeUnitAt(index) {
    const [unit] = units.splice(index, 1);
    if (!unit) return;
    if (unit.group && scene) scene.remove(unit.group);
    const cars = vehicleManager?.cars;
    if (Array.isArray(cars)) {
      const i = cars.indexOf(unit.vehicle);
      if (i >= 0) cars.splice(i, 1);
    }
  }

  function desiredCount(level) {
    if (level <= 0) return 0;
    if (level <= 2) return 1;
    if (level === 3) return 2;
    return 3;
  }

  function ensureCount() {
    const count = desiredCount(Math.max(0, Math.min(5, Math.floor(state.wanted || 0))));
    while (units.length > count) removeUnitAt(units.length - 1);
    while (units.length < count) {
      const index = units.length;
      const p = spawnPoint(index);
      const target = playerPosition();
      const heading = Math.atan2(target.x - p.x, -(target.z - p.z));
      if (!placeUnit(p.x, p.z, heading, index)) break;
    }
  }

  function setWanted(level) {
    const n = Math.max(0, Math.min(5, Math.floor(Number(level) || 0)));
    state.wanted = n;
    if (n === 0) {
      escapeT = 0;
      escapeThreshold = 18;
    }
    ensureCount();
    return n;
  }

  function reportCrime(kind, position, witnessRadius = 30) {
    const heat = crimeHeat[kind];
    if (!heat) return false;

    const p = position || playerPosition();
    let witnessed = false;
    const radius = Math.max(0, Number(witnessRadius) || 0);

    for (const ped of nearbyPedestrians()) {
      const pp = ped.group?.position;
      if (pp && Math.hypot(pp.x - p.x, pp.z - p.z) <= radius) {
        witnessed = true;
        break;
      }
    }
    if (!witnessed) {
      for (const unit of units) {
        if (distanceXZ(unit.pos, p) <= 60 ||
            ((state.wanted || 0) > 0 && distanceXZ(unit.pos, p) <= 120)) {
          witnessed = true;
          break;
        }
      }
    }
    if (!witnessed || clock - lastReportT < 3) return false;

    lastReportT = clock;
    escapeT = 0;
    escapeThreshold = 18;
    setWanted((state.wanted || 0) + heat);
    return true;
  }

  state._onVehicleTheft = (vehicle) => {
    if (vehicle?.pos) reportCrime('vehicleTheft', vehicle.pos, 30);
  };

  // Light-bar flash keyed to game time (deterministic; frozen in shot mode).
  function flashLights(unit) {
    const phase = Math.floor((Number(state.timeOfDay) || 0) * 86400 * 2) % 2;
    const redOn = phase === 0;
    const red = unit.group?.getObjectByName?.('redLight');
    const blue = unit.group?.getObjectByName?.('blueLight');
    if (red?.material) red.material.emissiveIntensity = redOn ? 1.6 : 0.15;
    if (blue?.material) blue.material.emissiveIntensity = redOn ? 0.15 : 1.6;
  }

  function ramPlayer(unit) {
    const playerVehicle = state.currentVehicle;
    const heading = playerVehicle?.heading ?? state.player?.heading ?? 0;
    const dx = Math.sin(heading) * 1.2;
    const dz = -Math.cos(heading) * 1.2;
    if (playerVehicle?.pos) {
      playerVehicle.speed = (Number(playerVehicle.speed) || 0) * 0.6;
      playerVehicle.pos.x += dx;
      playerVehicle.pos.z += dz;
      if (playerVehicle.group) {
        playerVehicle.group.position.x = playerVehicle.pos.x;
        playerVehicle.group.position.z = playerVehicle.pos.z;
      }
    } else if (state.player?.pos) {
      state.player.pos.x += dx;
      state.player.pos.z += dz;
    }
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1);
    clock += dt;
    ensureCount();

    if ((state.wanted || 0) <= 0) return;

    const target = playerPosition();
    let allFar = units.length > 0;
    for (const unit of units) {
      const pos = unit.pos;
      if (!pos) continue;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= 70) allFar = false;
      unit.ramT = Math.max(0, (unit.ramT || 0) - dt);

      if (dist < 4) {
        unit.mode = 'ram';
        unit.speed = 0;
        // Ram at most once per 1.2 s — ramming every frame would teleport the player.
        if (unit.ramT <= 0) {
          ramPlayer(unit);
          unit.ramT = 1.2;
        }
      } else {
        unit.mode = 'chase';
        const wantedHeading = Math.atan2(dx, -dz);
        let turn = wantedHeading - unit.heading;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        const maxTurn = 2.2 * dt;
        unit.heading += Math.max(-maxTurn, Math.min(maxTurn, turn));

        const targetSpeed = Math.max(6, Math.min(26, dist * 0.5 + 8));
        unit.speed += (targetSpeed - unit.speed) * Math.min(1, dt * 2.5);
        pos.x += Math.sin(unit.heading) * unit.speed * dt;
        pos.z -= Math.cos(unit.heading) * unit.speed * dt;
      }

      unit.vehicle.heading = unit.heading;
      unit.vehicle.speed = unit.speed;
      syncUnit(unit);
      flashLights(unit);
    }

    if (allFar) {
      escapeT += dt;
      for (const unit of units) unit.escapeT = escapeT;
      if (escapeT >= escapeThreshold) {
        setWanted((state.wanted || 0) - 1);
        escapeT = 0;
        escapeThreshold = 12;
        for (const unit of units) unit.escapeT = 0;
      }
    } else {
      escapeT = 0;
      escapeThreshold = 18;
      for (const unit of units) unit.escapeT = 0;
    }
  }

  return {
    update,
    reportCrime,
    setWanted,
    clear() {
      setWanted(0);
    },
    placeUnit,
    units,
    getUnits() {
      return units;
    },
  };
}
