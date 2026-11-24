// vehicles.js — 5 drivable models, arcade driving, enter/exit.
// Heading convention (authoritative): forward = (sin h, 0, -cos h);
// mesh rotation.y = -heading. The model front is local -Z.
//
// DRIVING-BUG FIX (bake in): spawnCar adds a parked collider for the car.
// enterVehicle MUST remove the car's own collider on entry and re-add it
// on exit — otherwise the car collides with itself every frame. Entry
// MUST also sync state.player.pos/heading to the vehicle.

import * as THREE from '../vendor/three.min.js';
import { createRng, hitsCollider, clampToCity, ROAD_LINES, LANE } from './world.js';

export const MODELS = {
  morrow: { key: 'morrow', name: 'Morrow Compact', len: 4.4, wid: 1.8, top: 24, accel: 12, color: 0x4a7fb5, cabin: 0x2c3e55 },
  sunbird: { key: 'sunbird', name: 'Sunbird Cab', len: 4.6, wid: 1.9, top: 22, accel: 12, color: 0xf2b705, cabin: 0x2c3e55 },
  kestrel: { key: 'kestrel', name: 'Kestrel R', len: 4.5, wid: 1.9, top: 34, accel: 14, color: 0xd93a2b, cabin: 0x1c1c22 },
  docksider: { key: 'docksider', name: 'Docksider', len: 5.8, wid: 2.2, top: 19, accel: 8, color: 0x7a7f85, cabin: 0x3a3f46 },
  sentinel: { key: 'sentinel', name: 'Civic Sentinel', len: 4.8, wid: 2.0, top: 26, accel: 13, color: 0xf2f2f2, cabin: 0x1c2c44 },
};

// Resolve a display name or key to a model key.
export function modelKeyOf(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().replace(/[^a-z]/g, '');
  for (const m of Object.values(MODELS)) {
    if (m.key === n) return m.key;
    if (m.name.toLowerCase().replace(/[^a-z]/g, '') === n) return m.key;
  }
  return null;
}

function box(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.position.set(x, y, z);
  return mesh;
}

// Build one car mesh. Front is local -Z (nose at -Z).
function buildCarMesh(model) {
  const g = new THREE.Group();
  const { len, wid } = model;
  const bodyH = model.key === 'docksider' ? 1.5 : 0.75;
  const bodyY = model.key === 'docksider' ? 1.15 : 0.62;
  g.add(box(wid, bodyH, len, model.color, 0, bodyY, 0));
  if (model.key === 'docksider') {
    // Cargo box behind the cab.
    g.add(box(wid - 0.1, 1.7, len * 0.55, 0x9aa0a6, 0, 1.9, len * 0.18));
    g.add(box(wid - 0.3, 0.9, len * 0.3, model.cabin, 0, 1.5, -len * 0.32));
  } else {
    const cabinLen = len * 0.45;
    const cabinZ = model.key === 'kestrel' ? 0.25 : 0.1;
    g.add(box(wid - 0.25, 0.62, cabinLen, model.cabin, 0, bodyY + bodyH / 2 + 0.28, cabinZ));
    if (model.key === 'kestrel') {
      // Low spoiler at the rear (+Z).
      g.add(box(wid - 0.2, 0.1, 0.35, 0x1c1c22, 0, bodyY + bodyH / 2 + 0.05, len / 2 - 0.15));
    }
  }
  if (model.key === 'sunbird') {
    // Taxi roof sign.
    g.add(box(0.9, 0.22, 0.4, 0x111111, 0, bodyY + bodyH / 2 + 0.95, 0.1));
    g.add(box(0.94, 0.1, 0.44, 0xffd94a, 0, bodyY + bodyH / 2 + 1.08, 0.1));
  }
  if (model.key === 'sentinel') {
    // Police light bar + dark doors band.
    g.add(box(wid - 0.3, 0.18, 0.5, 0xd21f2b, -0.35, bodyY + bodyH / 2 + 0.92, 0.1));
    g.add(box(wid - 0.3, 0.18, 0.5, 0x2b6fd9, 0.35, bodyY + bodyH / 2 + 0.92, 0.1));
    g.add(box(wid + 0.02, 0.34, len * 0.5, 0x1c2c44, 0, bodyY, 0.1));
  }
  // Wheels: cylinders rotated so their axis is across the car (X).
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const wy = 0.36;
  const wz = len / 2 - 0.85;
  const wx = wid / 2 - 0.05;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx * wx, wy, sz * wz);
    g.add(wheel);
  }
  // Headlights at the nose (-Z).
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  g.add(box(0.4, 0.16, 0.08, 0xfff2b0, -wid / 2 + 0.45, bodyY, -len / 2 - 0.02));
  g.add(box(0.4, 0.16, 0.08, 0xfff2b0, wid / 2 - 0.45, bodyY, -len / 2 - 0.02));
  void lightMat;
  return g;
}

export function createVehicleManager(scene, world) {
  const mgr = {
    cars: [],
    nextId: 1,
    scene,
    world,
  };

  function addParkedCollider(car) {
    const c = { x: car.x, z: car.z, hw: car.model.wid / 2 + 0.4, hd: car.model.len / 2 + 0.4, carId: car.id };
    car.collider = c;
    world.colliders.push(c);
  }

  function removeParkedCollider(car) {
    if (!car.collider) return;
    const idx = world.colliders.indexOf(car.collider);
    if (idx >= 0) world.colliders.splice(idx, 1);
    car.collider = null;
  }

  function makeCar(modelKey, x, z, heading) {
    const model = MODELS[modelKey] || MODELS.morrow;
    const group = buildCarMesh(model);
    group.position.set(x, 0, z);
    group.rotation.y = -heading;
    scene.add(group);
    const car = {
      id: `car-${mgr.nextId++}`,
      modelKey: model.key,
      model,
      group,
      x, z, heading,
      speed: 0,
      parked: true,
      collider: null,
    };
    mgr.cars.push(car);
    addParkedCollider(car);
    return car;
  }

  mgr.spawnCarAt = (modelKey, x, z, heading) => makeCar(modelKey, x, z, heading);

  // Parked cars along road lanes, seeded so the same seed lays them out
  // the same way every run.
  mgr.spawnCars = (count, seedOffset = 0) => {
    const rng = createRng((world.seed >>> 0) + 1000 + seedOffset);
    const keys = Object.keys(MODELS).filter((k) => k !== 'sentinel');
    const made = [];
    let guard = 0;
    while (made.length < count && guard++ < count * 40) {
      const axis = rng.chance(0.5) ? 'ns' : 'ew';
      const line = rng.pick(ROAD_LINES);
      const along = rng.range(-540, 540);
      const lane = rng.chance(0.5) ? -LANE : LANE;
      const x = axis === 'ns' ? line + lane : along;
      const z = axis === 'ns' ? along : line + lane;
      // Keep clear of the player spawn and of other parked cars.
      const sp = world.spawnPoints.player;
      if (Math.hypot(x - sp.x, z - sp.z) < 12) continue;
      if (mgr.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 9)) continue;
      if (hitsCollider(world, x, z, 3)) continue;
      const heading = axis === 'ns' ? (lane > 0 ? 0 : Math.PI) : (lane > 0 ? Math.PI / 2 : -Math.PI / 2);
      made.push(makeCar(rng.pick(keys), x, z, heading));
    }
    return made;
  };

  mgr.getCar = (idOrCar) => {
    if (!idOrCar) return null;
    if (typeof idOrCar === 'object') return idOrCar;
    return mgr.cars.find((c) => c.id === idOrCar) || null;
  };

  mgr.getNearbyVehicle = () => {
    const state = world.state;
    if (!state) return null;
    const p = state.player.pos;
    let best = null, bestD = 3.5;
    for (const car of mgr.cars) {
      const d = Math.hypot(car.x - p.x, car.z - p.z);
      if (d < bestD) { best = car; bestD = d; }
    }
    return best;
  };
  return wireVehicleApi(mgr, world);
}

// ---------------------------------------------------------------- enter / exit
// Enter: remove the car's own parked collider (else the car collides with
// itself every frame and speed *= 0.25), hide the on-foot figure, and sync
// state.player.pos/heading to the vehicle immediately.
function enterVehicle(mgr, world, idOrCar) {
  const state = world.state;
  const car = mgr.getCar(idOrCar);
  if (!car || !state || state.currentVehicle) return null;
  // Remove this car's parked collider.
  if (car.collider) {
    const idx = world.colliders.indexOf(car.collider);
    if (idx >= 0) world.colliders.splice(idx, 1);
    car.collider = null;
  }
  car.parked = false;
  car.speed = 0;
  state.currentVehicle = car;
  state.player.onFoot = false;
  state.player.pos.x = car.x;
  state.player.pos.y = 0;
  state.player.pos.z = car.z;
  state.player.heading = car.heading;
  if (state._onVehicleTheft && car.modelKey !== 'sentinel') state._onVehicleTheft(car);
  return car;
}

function exitVehicle(mgr, world) {
  const state = world.state;
  const car = state && state.currentVehicle;
  if (!car) return null;
  // Step out beside the driver side (left of the car's forward).
  const rx = Math.cos(car.heading), rz = Math.sin(car.heading);
  const px = clampToCity(car.x - rx * 2.0, 40);
  const pz = clampToCity(car.z - rz * 2.0, 40);
  state.player.pos.x = px;
  state.player.pos.y = 0;
  state.player.pos.z = pz;
  state.player.heading = car.heading;
  state.player.onFoot = true;
  state.currentVehicle = null;
  car.speed = 0;
  car.parked = true;
  // Re-add the parked collider now that the car is parked again.
  const c = { x: car.x, z: car.z, hw: car.model.wid / 2 + 0.4, hd: car.model.len / 2 + 0.4, carId: car.id };
  car.collider = c;
  world.colliders.push(c);
  return car;
}

// Shot-mode helper: place a car exactly and sync the player state to it.
// The shot sim is frozen, so per-frame update() never runs — without this
// sync the minimap arrow would point at (0,0). Also exported standalone:
// shots.js imports it by name from this module.
export function setCarPosition(car, x, z, heading, state) {
  if (!car) return null;
  car.x = x; car.z = z; car.heading = heading;
  car.group.position.set(x, 0, z);
  car.group.rotation.y = -heading;
  if (state) {
    state.player.pos.x = x;
    state.player.pos.y = 0;
    state.player.pos.z = z;
    state.player.heading = heading;
  }
  return car;
}

function setCarPositionBound(mgr, world, car, x, z, heading, state) {
  return setCarPosition(car, x, z, heading, state || world.state);
}

// Preferred shot API: put the player in a car of this model at a spot.
function placePlayerInCar(mgr, world, typeName, x, z, heading, speed = 0) {
  const key = modelKeyOf(typeName) || 'morrow';
  let car = mgr.cars.find((c) => c.modelKey === key && c.parked);
  if (!car) car = mgr.spawnCarAt(key, x, z, heading);
  setCarPosition(car, x, z, heading, world.state);
  if (world.state && world.state.currentVehicle && world.state.currentVehicle !== car) {
    exitVehicle(mgr, world);
  }
  const entered = enterVehicle(mgr, world, car);
  if (entered) entered.speed = speed;
  return entered || car;
}

function updateVehicles(mgr, world, dt, input) {
  const state = world.state;
  if (!state) return;
  const keys = input.keys;

  // On foot: E enters a nearby vehicle.
  if (state.player.onFoot) {
    if (input._ePressed) {
      const near = mgr.getNearbyVehicle();
      if (near) enterVehicle(mgr, world, near);
    }
    return;
  }

  const car = state.currentVehicle;
  if (!car) return;

  // E exits.
  if (input._ePressed) { exitVehicle(mgr, world); return; }

  const model = car.model;
  const handbrake = keys.has('Space');
  let accel = 0;
  if (keys.has('KeyW')) accel += model.accel;
  if (keys.has('KeyS')) accel -= 6;
  if (handbrake) {
    car.speed *= Math.max(0, 1 - 3.2 * dt);
    if (Math.abs(car.speed) < 0.4) car.speed = 0;
  } else if (accel !== 0) {
    car.speed += accel * dt;
  } else {
    // Rolling drag.
    car.speed *= Math.max(0, 1 - 0.6 * dt);
    if (Math.abs(car.speed) < 0.15) car.speed = 0;
  }
  // Brake key (S while moving forward) brakes hard.
  if (keys.has('KeyS') && car.speed > 0.5) car.speed = Math.max(0, car.speed - 18 * dt);
  car.speed = Math.max(-6, Math.min(model.top, car.speed));

  // Steering peaks ~1.6 rad/s at medium speed, fades at very low/high speed.
  let steer = 0;
  if (keys.has('KeyA')) steer += 1;
  if (keys.has('KeyD')) steer -= 1;
  if (steer !== 0 && Math.abs(car.speed) > 0.2) {
    const speedFactor = Math.min(1, Math.abs(car.speed) / 8) * (1 - Math.min(0.45, Math.abs(car.speed) / (model.top * 2.4)));
    car.heading += steer * 1.6 * speedFactor * dt * Math.sign(car.speed);
  }

  // Move; stop/slide on collision with buildings or parked cars.
  const fx = Math.sin(car.heading), fz = -Math.cos(car.heading);
  const nx = car.x + fx * car.speed * dt;
  const nz = car.z + fz * car.speed * dt;
  const r = Math.max(car.model.wid, car.model.len) / 2;
  if (!hitsCollider(world, nx, car.z, r * 0.8)) car.x = clampToCity(nx, 30);
  else car.speed *= 0.25;
  if (!hitsCollider(world, car.x, nz, r * 0.8)) car.z = clampToCity(nz, 30);
  else car.speed *= 0.25;

  // Parked-collider stays removed while driving; keep the live position
  // synced every frame (driving also re-syncs the player state).
  car.group.position.set(car.x, 0, car.z);
  car.group.rotation.y = -car.heading;
  state.player.pos.x = car.x;
  state.player.pos.y = 0;
  state.player.pos.z = car.z;
  state.player.heading = car.heading;
}

// Attach the entry/exit/update API to the manager object.
export function wireVehicleApi(mgr, world) {
  mgr.enterVehicle = (idOrCar) => enterVehicle(mgr, world, idOrCar);
  mgr.exitVehicle = () => exitVehicle(mgr, world);
  mgr.setCarPosition = (car, x, z, heading, state) => setCarPositionBound(mgr, world, car, x, z, heading, state);
  mgr.placePlayerInCar = (typeName, x, z, heading, speed) => placePlayerInCar(mgr, world, typeName, x, z, heading, speed);
  mgr.update = (dt, input) => updateVehicles(mgr, world, dt, input);
  return mgr;
}

// createVehicleManager returns the wired manager (defined in chunk 1).
// Re-export a wrapper so main.js can call one function.
export function createWiredManager(scene, world) {
  const mgr = createVehicleManager(scene, world);
  return wireVehicleApi(mgr, world);
}
