// Deterministic screenshot staging for Sunline: City of Tides (?shot=).
// All staging is synchronous — main.js freezes the sim in shot mode, so the
// frame captured is exactly the staged one. Seed 731942, no Math.random().
// Forward = (sin h, 0, -cos h); mesh rotation.y = -heading.
import * as THREE from 'three';

function placeCameraBehind(camera, targetPos, heading, dist, height, lookAhead) {
  const forwardX = Math.sin(heading);
  const forwardZ = -Math.cos(heading);
  camera.position.set(
    targetPos.x - forwardX * dist,
    targetPos.y + height,
    targetPos.z - forwardZ * dist,
  );
  camera.lookAt(
    targetPos.x + forwardX * lookAhead,
    targetPos.y + 1.5,
    targetPos.z + forwardZ * lookAhead,
  );
}

function setGroupPosition(group, x, y, z) {
  if (group?.position?.set) group.position.set(x, y, z);
}

function setCarPosition(car, x, z, heading, state) {
  if (!car) return;
  if (car.pos && typeof car.pos === 'object') {
    car.pos.x = x;
    car.pos.y = Number.isFinite(car.pos.y) ? car.pos.y : 0;
    car.pos.z = z;
  } else {
    car.pos = { x, y: 0, z };
  }
  car.heading = heading;
  setGroupPosition(car.group, x, 0, z);
  if (car.group?.rotation) car.group.rotation.y = -heading;
  // Keep the shared player position on the car: in shot mode the sim is
  // frozen, so vehicles.update() never runs its per-frame sync and
  // state.player.pos would stay stale at (0,0) — the minimap arrow and
  // anything reading the player position would point at the city centre.
  if (state?.player?.pos) {
    state.player.pos.x = x;
    state.player.pos.y = 0;
    state.player.pos.z = z;
    state.player.heading = heading;
  }
}

function setTrafficCar(entry, x, z, heading) {
  if (!entry) return;
  setGroupPosition(entry.group, x, 0, z);
  if (entry.group?.rotation) entry.group.rotation.y = -heading;
  entry.heading = heading;
}

function setPedestrian(entry, x, z) {
  if (!entry) return;
  setGroupPosition(entry.group, x, 0, z);
}

// Sync a police unit's mesh AND its vehicle record (police.update reads
// vehicle.pos; the mesh position is what the camera sees).
function positionPoliceUnit(unit, x, z, heading) {
  if (!unit) return;
  const group = unit.group ?? unit.vehicle?.group;
  const vehicle = unit.vehicle;
  if (vehicle?.pos && typeof vehicle.pos === 'object') {
    vehicle.pos.x = x;
    vehicle.pos.z = z;
  }
  if (unit.pos && typeof unit.pos === 'object') {
    unit.pos.x = x;
    unit.pos.z = z;
  } else {
    unit.pos = { x, y: 0, z };
  }
  if (vehicle) vehicle.heading = heading;
  unit.heading = heading;
  setGroupPosition(group, x, 0, z);
  if (group?.rotation) group.rotation.y = -heading;
}

function setPlayerOnFoot(state, player, vehicles, x, z, heading) {
  try {
    if (state.currentVehicle) vehicles?.exitVehicle?.();
  } catch {
    // State is still staged below.
  }
  try {
    if (player?.setPosition) player.setPosition(x, z);
  } catch {
    // State is still staged below.
  }
  state.currentVehicle = null;
  state.player.onFoot = true;
  state.player.pos = state.player.pos || { x: 0, y: 0, z: 0 };
  state.player.pos.x = x;
  state.player.pos.z = z;
  state.player.heading = heading;
}

function preparePlay(state) {
  state.screen = 'play';
  state.paused = false;
  state.input = state.input || {};
  state.input.keys = state.input.keys instanceof Set ? state.input.keys : new Set();
  state.input.keys.clear();
  state.input.mouseDX = 0;
  state.input.mouseDY = 0;
}

function finishPlayShot(state) {
  state.timeOfDay = 17.25;
  try {
    if (typeof window !== 'undefined') window.__shotReady = false;
  } catch {
    // The shot-ready flag is browser-only.
  }
}

function addFallbackBeacon(scene, x, z) {
  if (!scene) return;
  const beacon = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xf2c94c, emissive: 0x79520d, emissiveIntensity: 0.35,
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.45, 10), material);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.85, 10), material);
  base.position.y = 0.28;
  tip.position.y = 0.9;
  beacon.add(base, tip);
  beacon.position.set(x, 0, z);
  scene.add(beacon);
}

export function applyShot(name, context) {
  try {
    const { state, world, player, vehicles, traffic, police, missions, camera, scene } =
      context || {};
    if (!state || !camera) return false;

    if (name === 'start') {
      state.screen = 'title';
      state.paused = false;
      state.wanted = 0;
      // From over the ocean looking north-west: teal water in the
      // foreground, beach + palms + marina mid-frame, Glassline towers
      // rising beyond — the coastal-city postcard. Tower tops clear the
      // title card into the top strip; the coast reads at the frame edges
      // and below the card.
      camera.position.set(250, 60, 850);
      camera.lookAt(-80, 62, -100);
      return true;
    }

    if (name === 'drive') {
      preparePlay(state);
      state.wanted = 0;
      const car = vehicles.createCar('sports', -80, 4.5, Math.PI / 2);
      vehicles.enterVehicle(car);
      car.speed = 14;
      setCarPosition(car, -80, 4.5, Math.PI / 2, state);
      const trafficCars = traffic?.cars || [];
      const spots = [
        [car.pos.x + 28, 4.5],
        [car.pos.x + 52, -4.5],
        [car.pos.x + 78, 4.5],
      ];
      for (let i = 0; i < Math.min(3, trafficCars.length); i++) {
        setTrafficCar(trafficCars[i], spots[i][0], spots[i][1], Math.PI / 2);
      }
      placeCameraBehind(camera, car.pos, Math.PI / 2, 11, 3.2, 8);
      finishPlayShot(state);
      return true;
    }

    if (name === 'chase') {
      preparePlay(state);
      // Player car first, so setWanted's spawn offsets are relative to it.
      const playerX = -40;
      const car = vehicles.createCar('sports', playerX, 4.5, Math.PI / 2);
      vehicles.enterVehicle(car);
      car.speed = 16;
      setCarPosition(car, playerX, 4.5, Math.PI / 2, state);
      police?.setWanted?.(3);
      state.wanted = 3;

      // Deterministic cruiser placement: trailing 6 behind / 5 left (north
      // lane) so the pursuit reads unmistakably, second 26 ahead. Never
      // reassign police.units (state.policeUnits holds the same array).
      const positions = [
        [playerX - 6, -4.5],
        [playerX + 14, -4.5],
      ];
      for (let i = 0; i < 2; i++) {
        if (police && Array.isArray(police.units)) {
          if (!police.units[i]) {
            const cruiser = vehicles.createCar('police', positions[i][0], positions[i][1], Math.PI / 2);
            police.units.push({ vehicle: cruiser, group: cruiser.group, ramT: 0, index: i });
          }
          positionPoliceUnit(police.units[i], positions[i][0], positions[i][1], Math.PI / 2);
        } else {
          const cruiser = vehicles.createCar('police', positions[i][0], positions[i][1], Math.PI / 2);
          setCarPosition(cruiser, positions[i][0], positions[i][1], Math.PI / 2);
        }
      }

      // Chase view from behind, pulled back and offset to the south side so
      // the trailing north-lane cruiser stays well inside the frame; the
      // lookAt sits west of the player car so the car lands right-of-centre,
      // clear of the centred "E — Exit vehicle" prompt. Closer and lower
      // than the first pass so both cruisers and the player car read bigger
      // and less foreground road sits empty.
      camera.position.set(playerX - 14, 7.5, 16);
      camera.lookAt(playerX - 2, 1.2, -1);
      finishPlayShot(state);
      return true;
    }

    if (name === 'mission') {
      preparePlay(state);
      state.wanted = 0;
      if (missions?.startMission) {
        missions.startMission('first-light');
      } else {
        state.mission = {
          id: 'first-light',
          title: 'First Light Run',
          objective: 'Pick up the parcel — Parcel Pickup',
          stage: 0,
          timeLeft: 150,
        };
        const pickup = world?.missionPoints?.parcelPickup || { x: -4.5, z: -112 };
        addFallbackBeacon(scene, pickup.x, pickup.z);
      }
      const pickup = world?.missionPoints?.parcelPickup || { x: -112, z: -124 };
      // Nia stands 4 units west of the pickup so she is visible NEXT TO the
      // beacon instead of hidden inside it (the beacon is at her exact
      // target point and taller than she is).
      setPlayerOnFoot(state, player, vehicles, pickup.x - 4, pickup.z, Math.PI / 2);
      // Parked car 12 units EAST of the pickup on the same road so the
      // beacon never sits inside the car — and so the low mission camera
      // does not crop it into a giant corner blob (it did at +12 south).
      vehicles.createCar('sports', pickup.x + 12, pickup.z, Math.PI / 2);
      // Two traffic cars on the pickup's own north-south road (x = -112),
      // heading north, so they are actually in frame.
      const trafficCars = traffic?.cars || [];
      if (trafficCars[0]) setTrafficCar(trafficCars[0], -116.5, pickup.z + 28, 0);
      if (trafficCars[1]) setTrafficCar(trafficCars[1], -107.5, pickup.z + 52, 0);
      // Lower and closer than the first pass (~18 units) so the player +
      // beacon pair is legible at a glance, still in the upper half of the
      // frame, clear of the centred prompt and dialogue.
      camera.position.set(pickup.x - 11, 8.5, pickup.z + 14);
      camera.lookAt(pickup.x - 2, 1.8, pickup.z - 2);
      finishPlayShot(state);
      return true;
    }

    if (name === 'street') {
      preparePlay(state);
      state.wanted = 0;
      setPlayerOnFoot(state, player, vehicles, 0, 24, Math.PI / 2);
      const pedestrians = traffic?.pedestrians || [];
      const pedSpots = [[-8, 16], [-4, 20], [0, 17], [4, 20], [8, 16]];
      for (let i = 0; i < Math.min(5, pedestrians.length); i++) {
        setPedestrian(pedestrians[i], pedSpots[i][0], pedSpots[i][1]);
      }
      vehicles.createCar('taxi', 14, 4.5, Math.PI / 2);
      const trafficCars = traffic?.cars || [];
      if (trafficCars[0]) setTrafficCar(trafficCars[0], 30, 4.5, Math.PI / 2);
      if (trafficCars[1]) setTrafficCar(trafficCars[1], 44, -4.5, Math.PI / 2);
      if (trafficCars[2]) setTrafficCar(trafficCars[2], 58, 4.5, Math.PI / 2);
      // Close on Nia: she is ~4.5 units from the lens, peds 6 ahead of her,
      // so the on-foot action (not empty pavement) is the focus.
      camera.position.set(3, 3, 28.5);
      camera.lookAt(0, 1.2, 10);
      finishPlayShot(state);
      return true;
    }

    if (name === 'combat') {
      preparePlay(state);
      state.wanted = 0;
      setPlayerOnFoot(state, player, vehicles, 0, 24, Math.PI / 2);
      const pedestrian = traffic?.pedestrians?.[0];
      if (pedestrian) {
        setPedestrian(pedestrian, 1.8, 24);
        if (pedestrian.group?.rotation) pedestrian.group.rotation.x = -Math.PI / 2;
      }
      camera.position.set(5, 4, 32);
      camera.lookAt(0, 1.2, 22);
      finishPlayShot(state);
      return true;
    }

    return false;
  } catch (error) {
    try {
      console.warn('Unable to stage screenshot shot:', name, error);
    } catch {
      // Ignore logging failures.
    }
    return false;
  }
}
