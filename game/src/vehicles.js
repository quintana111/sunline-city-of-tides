// Vehicle models + arcade driving. Five original models, box-built.
// Written fresh 2026-11-24 (Builder A re-author).
// Forward = (sin h, 0, -cos h); every car mesh uses rotation.y = -heading,
// so the car's local -Z (headlights) always points along travel direction.
import * as THREE from 'three';

const VEHICLE_TYPES = {
  sedan: { name: 'Morrow Compact', length: 4.4, width: 1.82, topSpeed: 24, accel: 12, color: 0x687f7d, cabin: 0xb7c8c1, style: 'sedan' },
  taxi: { name: 'Sunbird Cab', length: 4.5, width: 1.86, topSpeed: 22, accel: 12, color: 0xe8bc36, cabin: 0x344249, style: 'taxi' },
  sports: { name: 'Kestrel R', length: 4.5, width: 1.94, topSpeed: 34, accel: 12, color: 0xd9544e, cabin: 0x382f37, style: 'sports' },
  truck: { name: 'Docksider', length: 5.8, width: 2.08, topSpeed: 19, accel: 8, color: 0xe4ddc9, cabin: 0x9eaca6, style: 'truck' },
  police: { name: 'Civic Sentinel', length: 4.8, width: 1.9, topSpeed: 26, accel: 12, color: 0x172b47, cabin: 0xe8e8e1, style: 'police' },
};
const CAR_RADIUS = 1.3;

const DISPLAY_NAMES = {
  'Morrow Compact': 'sedan',
  'Sunbird Cab': 'taxi',
  'Kestrel R': 'sports',
  'Docksider': 'truck',
  'Civic Sentinel': 'police',
};
export function resolveType(type) {
  if (type in VEHICLE_TYPES) return type;
  if (type in DISPLAY_NAMES) return DISPLAY_NAMES[type];
  return 'sedan';
}

// Seeded RNG (mulberry32) — deterministic parked-car placement, no Math.random.
function mulberry32(seed) {
  let v = seed >>> 0;
  return function random() {
    v += 0x6d2b79f5;
    let t = v;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function forwardForHeading(heading) {
  return new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
}

// Lane heading: axis 'x' = road runs east-west, lane +4.5 is eastbound.
function headingForLane(axis, lane) {
  if (axis === 'x') return lane > 0 ? Math.PI / 2 : -Math.PI / 2;
  return lane > 0 ? 0 : Math.PI;
}

function mat(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.05, ...options });
}

function addBox(parent, size, color, pos, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat(color, options));
  mesh.position.set(pos[0], pos[1], pos[2]);
  parent.add(mesh);
  return mesh;
}

function insideBuilding(b, x, z, r) {
  const hw = (Number(b.w) || 0) * 0.5 + r;
  const hd = (Number(b.d) || 0) * 0.5 + r;
  return Math.abs(x - b.x) < hw && Math.abs(z - b.z) < hd;
}

function hitsBuilding(world, x, z, radius = CAR_RADIUS) {
  if (!world || !Array.isArray(world.buildings)) return false;
  return world.buildings.some((b) => b && insideBuilding(b, x, z, radius));
}

function clampWorld(world, x, z) {
  let out = { x, z };
  if (world && typeof world.clampToCity === 'function') {
    const c = world.clampToCity(x, z);
    if (c && typeof c === 'object') out = { x: c.x, z: c.z };
  }
  if (z > 580) out.z = Math.min(680, z);
  return out;
}

function makeWheel(holder, radius, width) {
  const roll = new THREE.Group();
  holder.add(roll);
  const tire = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 10, 1),
    mat(0x25282b, { roughness: 0.95 }),
  );
  tire.rotation.z = Math.PI / 2;
  roll.add(tire);
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.48, radius * 0.48, width + 0.015, 8, 1),
    mat(0x9da4a2, { metalness: 0.48, roughness: 0.44 }),
  );
  hub.rotation.z = Math.PI / 2;
  roll.add(hub);
  return { wheelGroup: holder, rollGroup: roll };
}

function buildCarModel(type, config) {
  const group = new THREE.Group();
  group.name = config.name;
  const { length, width } = config;
  const isTruck = config.style === 'truck';
  const bodyH = isTruck ? 0.62 : config.style === 'sports' ? 0.43 : 0.52;
  const bodyY = isTruck ? 0.66 : 0.62;

  addBox(group, [width, bodyH, length], config.color, [0, bodyY, 0]);
  if (isTruck) {
    addBox(group, [width * 0.88, 0.9, 2.15], config.cabin, [0, 1.38, -1.17]); // cab, front
    addBox(group, [width * 0.96, 0.66, 2.48], 0xb7b09e, [0, 0.99, 1.52]); // cargo bed
    addBox(group, [0.12, 0.7, 2.42], 0xc9c2af, [-width * 0.45, 1.02, 1.52]);
    addBox(group, [0.12, 0.7, 2.42], 0xc9c2af, [width * 0.45, 1.02, 1.52]);
  } else {
    const cabinLen = config.style === 'sports' ? 2.05 : 2.38;
    const cabinY = config.style === 'sports' ? 1.0 : 1.12;
    addBox(group, [width * 0.78, config.style === 'sports' ? 0.54 : 0.66, cabinLen], config.cabin, [0, cabinY, -0.05]);
    addBox(group, [width * 0.7, 0.35, 0.035], 0x8ba5a5, [0, cabinY + 0.02, -cabinLen * 0.5 - 0.02]);
    addBox(group, [width * 0.7, 0.34, 0.035], 0x819b9d, [0, cabinY + 0.02, cabinLen * 0.5 + 0.02]);
    addBox(group, [0.035, 0.32, cabinLen * 0.7], 0x829c9e, [-width * 0.4, cabinY + 0.02, -0.02]);
    addBox(group, [0.035, 0.32, cabinLen * 0.7], 0x829c9e, [width * 0.4, cabinY + 0.02, -0.02]);
  }
  if (type === 'taxi') {
    addBox(group, [0.54, 0.14, 0.34], 0xf6e9b4, [0, 1.61, -0.04]); // roof sign
    addBox(group, [0.32, 0.1, 0.025], 0x262e30, [0, 1.62, -0.22]);
  }
  if (type === 'sports') {
    addBox(group, [width * 0.9, 0.1, 0.16], 0x242a2f, [0, 0.99, 1.93]); // spoiler, rear
    addBox(group, [0.1, 0.3, 0.12], 0x242a2f, [-width * 0.36, 0.84, 1.91]);
    addBox(group, [0.1, 0.3, 0.12], 0x242a2f, [width * 0.36, 0.84, 1.91]);
  }
  if (type === 'police') {
    addBox(group, [width * 0.96, 0.22, 2.05], 0xe9e9e2, [0, 0.87, 0.12]);
    const red = addBox(group, [0.28, 0.16, 0.22], 0xff2525, [-0.2, 1.55, 0], { emissive: 0x9b0808, emissiveIntensity: 1.3 });
    const blue = addBox(group, [0.28, 0.16, 0.22], 0x2c64ff, [0.2, 1.55, 0], { emissive: 0x102cbb, emissiveIntensity: 1.3 });
    red.name = 'redLight';
    blue.name = 'blueLight';
  }

  // Headlights front (-Z local), taillights rear (+Z local).
  const headMat = mat(0xfff4cf, { emissive: 0xc9a853, emissiveIntensity: 0.45 });
  const tailMat = mat(0xe34a40, { emissive: 0x8e100d, emissiveIntensity: 0.65 });
  const headGeo = new THREE.BoxGeometry(0.34, 0.16, 0.08);
  const tailGeo = new THREE.BoxGeometry(0.28, 0.16, 0.08);
  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(side * (width * 0.35), bodyY + 0.02, -length * 0.5 - 0.035);
    group.add(head);
    const tail = new THREE.Mesh(tailGeo, tailMat);
    tail.position.set(side * (width * 0.35), bodyY + 0.03, length * 0.5 + 0.035);
    group.add(tail);
  }

  const wheels = { front: [], all: [] };
  const wheelR = isTruck ? 0.43 : 0.36;
  const wheelW = isTruck ? 0.28 : 0.22;
  const frontZ = -length * 0.31;
  const rearZ = length * 0.32;
  for (const side of [-1, 1]) {
    for (const z of [frontZ, rearZ]) {
      const holder = new THREE.Group();
      holder.position.set(side * (width * 0.5 + 0.015), wheelR, z);
      group.add(holder);
      const wheel = makeWheel(holder, wheelR, wheelW);
      const rec = { ...wheel, front: z === frontZ };
      wheels.all.push(rec);
      if (rec.front) wheels.front.push(rec);
    }
  }
  return { group, wheels };
}

export function createVehicleManager(scene, world, camera) {
  const state = world.state;
  state.player = state.player || {
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    heading: 0, onFoot: true, health: 100, cash: 250,
  };
  state.player.pos = state.player.pos || { x: 0, y: 0, z: 0 };
  state.player.vel = state.player.vel || { x: 0, y: 0, z: 0 };
  if (!('currentVehicle' in state)) state.currentVehicle = null;

  const cars = [];
  let nextId = 1;
  let wasEPressed = false;
  let camInit = false;
  let cameraYaw = Number(state.player.heading) || 0;
  let cameraYawOffset = 0;
  const desiredCam = new THREE.Vector3();
  const camTarget = new THREE.Vector3();

  function createCar(type, x, z, heading = 0) {
    const safeType = type in VEHICLE_TYPES ? type : 'sedan';
    const config = VEHICLE_TYPES[safeType];
    const model = buildCarModel(safeType, config);
    const vehicle = {
      id: `vehicle-${nextId++}`,
      type: safeType,
      group: model.group,
      pos: { x: Number(x) || 0, y: 0, z: Number(z) || 0 },
      heading: Number(heading) || 0,
      speed: 0,
      topSpeed: config.topSpeed,
      color: config.color,
      wheels: model.wheels,
      steer: 0,
      owned: true, // createCar vehicles are staged/owned; parked spawns set owned=false
      _config: config,
    };
    model.group.position.set(vehicle.pos.x, 0, vehicle.pos.z);
    model.group.rotation.y = -vehicle.heading;
    scene.add(model.group);
    cars.push(vehicle);
    return vehicle;
  }

  // Deterministic parked cars: world.spawnPoints.cars first, then lane spots.
  function spawnCars(count = 10, seedOffset = 0) {
    const placed = [];
    const types = ['sedan', 'taxi', 'sports', 'truck'];
    const seedBase = Number.isFinite(world.seed) ? world.seed : 0x51a7;
    const rng = mulberry32((seedBase ^ Math.imul((Number(seedOffset) || 0) + 1, 0x9e3779b1)) >>> 0);
    const spots = [...(world.spawnPoints?.cars ?? [])];
    const lines = Array.isArray(world.roadLines) ? world.roadLines : [];
    let guard = 0;
    while (placed.length < count && guard++ < 200) {
      let spot;
      if (spots.length) {
        spot = spots.shift();
      } else if (lines.length) {
        const line = lines[Math.floor(rng() * lines.length)];
        const axis = rng() < 0.5 ? 'x' : 'z';
        const lane = rng() < 0.5 ? -7.5 : 7.5; // near the curb
        const along = rng() * 1000 - 500;
        spot = {
          x: axis === 'x' ? along : line + lane,
          z: axis === 'x' ? line + lane : along,
          heading: headingForLane(axis, lane > 0 ? 4.5 : -4.5),
          type: types[Math.floor(rng() * types.length)],
        };
      } else break;
      if (hitsBuilding(world, spot.x, spot.z, CAR_RADIUS)) continue;
      if (placed.some((p) => Math.hypot(p.x - spot.x, p.z - spot.z) < 7)) continue;
      const vehicle = createCar(spot.type || types[Math.floor(rng() * types.length)], spot.x, spot.z, spot.heading);
      vehicle.owned = false; // parked cars are stealable
      placed.push(vehicle);
    }
    return placed;
  }

  function setCameraYaw(yaw) {
    if (Number.isFinite(yaw)) cameraYaw = yaw;
  }

  // Attach a visual mesh to a vehicle object that has none (e.g. a plain
  // staging stub { id, type, pos, heading, speed } from shots.js).
  function materializeVehicle(vehicle) {
    if (!vehicle || vehicle.group) return vehicle;
    const safeType = resolveType(vehicle.type);
    const config = VEHICLE_TYPES[safeType];
    const model = buildCarModel(safeType, config);
    if (!vehicle.pos) vehicle.pos = { x: 0, y: 0, z: 0 };
    if (!Number.isFinite(vehicle.heading)) vehicle.heading = 0;
    if (!Number.isFinite(vehicle.speed)) vehicle.speed = 0;
    vehicle.modelType = safeType;
    vehicle.group = model.group;
    vehicle.wheels = model.wheels;
    vehicle.topSpeed = config.topSpeed;
    vehicle.color = config.color;
    vehicle.steer = 0;
    vehicle._config = config;
    model.group.position.set(vehicle.pos.x, 0, vehicle.pos.z);
    model.group.rotation.y = -vehicle.heading;
    scene.add(model.group);
    if (!cars.includes(vehicle)) cars.push(vehicle);
    return vehicle;
  }

  function enterVehicle(vehicle) {
    if (!vehicle || state.player.onFoot === false || state.currentVehicle) return false;
    materializeVehicle(vehicle);
    state.currentVehicle = vehicle;
    state.player.onFoot = false;
    state.player.vel.x = 0;
    state.player.vel.y = 0;
    state.player.vel.z = 0;
    vehicle.speed = 0;
    cameraYawOffset = cameraYaw - vehicle.heading;
    // Stealing a parked (non-owned) car is a crime; police.js sets this hook.
    if (vehicle.owned === false && typeof state._onVehicleTheft === 'function') {
      state._onVehicleTheft(vehicle);
    }
    return true;
  }

  function exitVehicle() {
    const vehicle = state.currentVehicle;
    if (!vehicle) return false;
    const rightX = Math.cos(vehicle.heading);
    const rightZ = Math.sin(vehicle.heading);
    let exit = clampWorld(world, vehicle.pos.x + rightX * 2.2, vehicle.pos.z + rightZ * 2.2);
    if (hitsBuilding(world, exit.x, exit.z, 0.6)) {
      exit = clampWorld(world, vehicle.pos.x - rightX * 2.2, vehicle.pos.z - rightZ * 2.2);
    }
    state.player.pos.x = exit.x;
    state.player.pos.y = 0;
    state.player.pos.z = exit.z;
    state.player.heading = vehicle.heading;
    state.player.vel.x = 0;
    state.player.vel.y = 0;
    state.player.vel.z = 0;
    state.player.onFoot = true;
    state.currentVehicle = null;
    vehicle.speed = 0;
    cameraYaw = vehicle.heading + cameraYawOffset;
    camInit = false;
    return true;
  }

  function getNearbyVehicle(maxDist = 3.5) {
    if (state.player.onFoot === false || state.currentVehicle) return null;
    let nearest = null;
    let nearestDistance = Number.isFinite(maxDist) ? maxDist : 3.5;
    for (const vehicle of cars) {
      const d = Math.hypot(vehicle.pos.x - state.player.pos.x, vehicle.pos.z - state.player.pos.z);
      if (d <= nearestDistance) {
        nearestDistance = d;
        nearest = vehicle;
      }
    }
    return nearest;
  }

  function moveCar(vehicle, oldX, oldZ, newX, newZ) {
    const c = clampWorld(world, newX, newZ);
    newX = c.x;
    newZ = c.z;
    if (!hitsBuilding(world, newX, newZ, CAR_RADIUS)) {
      vehicle.pos.x = newX;
      vehicle.pos.z = newZ;
      return;
    }
    // Slide: try x-only, then z-only, else stop.
    if (!hitsBuilding(world, newX, oldZ, CAR_RADIUS)) {
      vehicle.pos.x = newX;
      vehicle.pos.z = oldZ;
    } else if (!hitsBuilding(world, oldX, newZ, CAR_RADIUS)) {
      vehicle.pos.x = oldX;
      vehicle.pos.z = newZ;
    } else {
      vehicle.pos.x = oldX;
      vehicle.pos.z = oldZ;
    }
    vehicle.speed *= 0.4;
  }

  function syncCar(vehicle, dt) {
    vehicle.group.position.set(vehicle.pos.x, 0, vehicle.pos.z);
    vehicle.group.rotation.y = -vehicle.heading;
    const spin = (vehicle.speed * Math.max(0, dt)) / 0.36;
    for (const wheel of vehicle.wheels.all) wheel.rollGroup.rotation.x += spin;
    for (const wheel of vehicle.wheels.front) wheel.wheelGroup.rotation.y = -vehicle.steer;
  }

  function updateDriving(dt, input) {
    const vehicle = state.currentVehicle;
    if (!vehicle) return;
    const config = vehicle._config || VEHICLE_TYPES[vehicle.type] || VEHICLE_TYPES.sedan;
    const keys = input?.keys ?? new Set();
    const safeDt = Math.min(Math.max(0, Number(dt) || 0), 0.05);
    const accel = keys.has('KeyW');
    const reverse = keys.has('KeyS');
    const handbrake = keys.has('Space');
    const steerInput = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);

    if (accel) {
      vehicle.speed += config.accel * safeDt;
    } else if (reverse) {
      if (vehicle.speed > 0.4) vehicle.speed = Math.max(0, vehicle.speed - 18 * safeDt);
      else vehicle.speed = Math.max(-6, vehicle.speed - 6 * safeDt);
    } else {
      const friction = handbrake ? 38 : 5.5;
      const dec = friction * safeDt;
      if (Math.abs(vehicle.speed) <= dec) vehicle.speed = 0;
      else vehicle.speed -= Math.sign(vehicle.speed) * dec;
    }
    vehicle.speed = THREE.MathUtils.clamp(vehicle.speed, -6, config.topSpeed);

    const steerBlend = 1 - Math.exp(-10 * safeDt);
    vehicle.steer = THREE.MathUtils.lerp(vehicle.steer, steerInput * (handbrake ? 0.72 : 0.5), steerBlend);
    const speedFactor = THREE.MathUtils.clamp(Math.abs(vehicle.speed) / 8, 0, 1);
    const highSpeedCut = THREE.MathUtils.clamp(1 - Math.max(0, Math.abs(vehicle.speed) - 22) / 40, 0.45, 1);
    const dir = vehicle.speed < -0.1 ? -1 : 1;
    vehicle.heading += steerInput * (handbrake ? 1.9 : 1.6) * (handbrake ? 1.35 : 1) *
      speedFactor * highSpeedCut * dir * safeDt;

    const fwd = forwardForHeading(vehicle.heading);
    const oldX = vehicle.pos.x;
    const oldZ = vehicle.pos.z;
    moveCar(vehicle, oldX, oldZ, oldX + fwd.x * vehicle.speed * safeDt, oldZ + fwd.z * vehicle.speed * safeDt);
    vehicle.pos.y = 0;
    syncCar(vehicle, safeDt);

    // Chase camera: behind the car, mouse orbit decays back to straight behind.
    cameraYawOffset += (Number(input?.mouseDX) || 0) * 0.0028;
    cameraYawOffset = THREE.MathUtils.lerp(cameraYawOffset, 0, 1 - Math.exp(-0.8 * safeDt));
    const viewYaw = vehicle.heading + cameraYawOffset;
    const camFwd = forwardForHeading(viewYaw);
    camTarget.set(vehicle.pos.x + fwd.x * 6, 1.2, vehicle.pos.z + fwd.z * 6);
    desiredCam.set(vehicle.pos.x - camFwd.x * 10, 3.5, vehicle.pos.z - camFwd.z * 10);
    if (camera) {
      if (!camInit) {
        camera.position.copy(desiredCam);
        camInit = true;
      } else {
        camera.position.lerp(desiredCam, 1 - Math.exp(-6 * safeDt));
      }
      camera.lookAt(camTarget);
    }
    state.currentVehicle.speed = vehicle.speed;
  }

  function update(dt, input) {
    const keys = input?.keys ?? new Set();
    const ePressed = keys.has('KeyE');
    const eJust = ePressed && !wasEPressed;
    wasEPressed = ePressed;
    if (state.screen !== 'play' || state.paused) return;
    if (eJust) {
      if (state.currentVehicle) exitVehicle();
      else {
        const nearby = getNearbyVehicle();
        if (nearby) enterVehicle(nearby);
      }
    }
    if (state.currentVehicle) updateDriving(dt, input);
  }

  return {
    cars,
    spawnCars,
    createCar,
    materializeVehicle,
    enterVehicle,
    exitVehicle,
    getNearbyVehicle,
    update,
    setCameraYaw,
  };
}
