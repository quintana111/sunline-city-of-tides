import * as THREE from 'three';

const MODEL_KEYS = new Set(['sedan', 'taxi', 'sports', 'truck', 'police']);
const DISPLAY_NAME_TO_KEY = new Map([
  ['morrow compact', 'sedan'],
  ['sunbird cab', 'taxi'],
  ['kestrel r', 'sports'],
  ['docksider', 'truck'],
  ['civic sentinel', 'police']
]);

const MODEL_INFO = {
  sedan: {
    name: 'Morrow Compact',
    body: 0x536a70,
    cabin: 0x9aaeb0,
    length: 4.4,
    width: 1.82,
    height: 1.12,
    topSpeed: 24
  },
  taxi: {
    name: 'Sunbird Cab',
    body: 0xe8b62f,
    cabin: 0xf4d66f,
    length: 4.4,
    width: 1.84,
    height: 1.16,
    topSpeed: 22
  },
  sports: {
    name: 'Kestrel R',
    body: 0xc9403d,
    cabin: 0xe47768,
    length: 4.35,
    width: 1.9,
    height: 0.88,
    topSpeed: 34
  },
  truck: {
    name: 'Docksider',
    body: 0xd8d0b7,
    cabin: 0xede5d0,
    length: 5.8,
    width: 2.05,
    height: 1.42,
    topSpeed: 19
  },
  police: {
    name: 'Civic Sentinel',
    body: 0x192c49,
    cabin: 0xe7e8df,
    length: 4.6,
    width: 1.9,
    height: 1.18,
    topSpeed: 26
  }
};

let vehicleScene = null;

function resolveModelKey(type) {
  if (MODEL_KEYS.has(type)) return type;
  if (typeof type === 'string') {
    const normalized = type.trim().toLowerCase();
    if (MODEL_KEYS.has(normalized)) return normalized;
    return DISPLAY_NAME_TO_KEY.get(normalized) ?? 'sedan';
  }
  return 'sedan';
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function addBox(parent, material, x, y, z, width, height, depth) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    material
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.75,
    metalness: options.metalness ?? 0.08,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0
  });
}

function createVehicleVisual(vehicle, scene) {
  const key = resolveModelKey(vehicle.type);
  const info = MODEL_INFO[key];
  const group = new THREE.Group();
  group.name = info.name;

  const bodyMaterial = makeMaterial(info.body, { roughness: 0.7 });
  const cabinMaterial = makeMaterial(info.cabin, { roughness: 0.56 });
  const glassMaterial = makeMaterial(0x38515c, {
    roughness: 0.3,
    metalness: 0.15
  });
  const darkMaterial = makeMaterial(0x20252a, { roughness: 0.88 });
  const wheelMaterial = makeMaterial(0x17191c, { roughness: 0.96 });
  const trimMaterial = makeMaterial(0xb9c2c0, { metalness: 0.45 });
  const headlightMaterial = makeMaterial(0xfff1c4, {
    emissive: 0xffdf86,
    emissiveIntensity: 0.7
  });
  const tailMaterial = makeMaterial(0xa51e20, {
    emissive: 0xff1717,
    emissiveIntensity: 0.45
  });

  const length = info.length;
  const width = info.width;
  const baseHeight = info.height;
  const wheelRadius = key === 'truck' ? 0.39 : 0.34;
  const bodyY = baseHeight * 0.48;
  const bodyDepth = key === 'truck' ? length * 0.52 : length * 0.76;

  addBox(
    group,
    bodyMaterial,
    0,
    bodyY,
    key === 'truck' ? length * 0.08 : 0,
    width,
    baseHeight * 0.48,
    bodyDepth
  );

  if (key === 'truck') {
    const cabLength = length * 0.38;
    addBox(
      group,
      cabinMaterial,
      0,
      baseHeight * 0.91,
      -length * 0.32,
      width * 0.91,
      baseHeight * 0.76,
      cabLength
    );
    addBox(
      group,
      glassMaterial,
      0,
      baseHeight * 1.05,
      -length * 0.32 - cabLength * 0.51,
      width * 0.72,
      baseHeight * 0.34,
      0.035
    );
    addBox(
      group,
      bodyMaterial,
      0,
      baseHeight * 0.77,
      length * 0.29,
      width * 0.9,
      0.08,
      length * 0.42
    );
    addBox(
      group,
      darkMaterial,
      0,
      baseHeight * 1.18,
      length * 0.29,
      width * 0.92,
      0.055,
      length * 0.4
    );
  } else {
    const cabinLength = key === 'sports' ? length * 0.44 : length * 0.5;
    const cabinHeight = key === 'sports' ? 0.46 : baseHeight * 0.58;
    const cabinY = bodyY + baseHeight * 0.39;
    addBox(
      group,
      cabinMaterial,
      0,
      cabinY,
      -length * 0.045,
      width * (key === 'sports' ? 0.76 : 0.82),
      cabinHeight,
      cabinLength
    );

    const glassHeight = cabinHeight * 0.53;
    const glassZFront = -length * 0.045 - cabinLength * 0.51;
    const glassZRear = -length * 0.045 + cabinLength * 0.51;
    addBox(
      group,
      glassMaterial,
      0,
      cabinY + cabinHeight * 0.08,
      glassZFront,
      width * 0.62,
      glassHeight,
      0.035
    );
    addBox(
      group,
      glassMaterial,
      0,
      cabinY + cabinHeight * 0.08,
      glassZRear,
      width * 0.62,
      glassHeight,
      0.035
    );
    addBox(
      group,
      darkMaterial,
      0,
      cabinY + cabinHeight * 0.51,
      -length * 0.045,
      width * 0.71,
      0.035,
      cabinLength * 0.72
    );
  }

  if (key === 'taxi') {
    addBox(
      group,
      makeMaterial(0xf5e9c3, { roughness: 0.8 }),
      0,
      baseHeight * 1.27,
      -0.12,
      0.48,
      0.16,
      0.3
    );
    addBox(
      group,
      makeMaterial(0x242b2b, { roughness: 0.8 }),
      0,
      baseHeight * 1.37,
      -0.12,
      0.35,
      0.035,
      0.2
    );
  }

  if (key === 'sports') {
    addBox(
      group,
      bodyMaterial,
      0,
      baseHeight * 0.9,
      length * 0.39,
      width * 0.92,
      0.075,
      0.15
    );
    addBox(
      group,
      darkMaterial,
      0,
      baseHeight * 1.17,
      length * 0.39,
      width * 0.78,
      0.07,
      0.06
    );
  }

  if (key === 'police') {
    addBox(
      group,
      makeMaterial(0xf1f0e6, { roughness: 0.75 }),
      0,
      bodyY + baseHeight * 0.27,
      0,
      width * 1.01,
      baseHeight * 0.22,
      length * 0.53
    );
    const redLight = makeMaterial(0xff2635, {
      emissive: 0xff0011,
      emissiveIntensity: 1.5
    });
    const blueLight = makeMaterial(0x247dff, {
      emissive: 0x002eff,
      emissiveIntensity: 1.5
    });
    addBox(group, redLight, -0.22, baseHeight * 1.32, -0.06, 0.24, 0.13, 0.22);
    addBox(group, blueLight, 0.22, baseHeight * 1.32, -0.06, 0.24, 0.13, 0.22);
  }

  for (const side of [-1, 1]) {
    addBox(
      group,
      headlightMaterial,
      side * width * 0.34,
      bodyY + 0.01,
      -length * 0.5 - 0.015,
      0.22,
      0.14,
      0.045
    );
    addBox(
      group,
      tailMaterial,
      side * width * 0.34,
      bodyY + 0.015,
      length * 0.5 + 0.015,
      0.22,
      0.15,
      0.045
    );
    addBox(
      group,
      trimMaterial,
      side * width * 0.505,
      bodyY - 0.08,
      0,
      0.025,
      0.08,
      length * 0.58
    );
  }

  const allWheels = [];
  const frontWheels = [];
  const axleZ = key === 'truck' ? length * 0.34 : length * 0.32;
  for (const side of [-1, 1]) {
    for (const axle of [-1, 1]) {
      const steeringPivot = new THREE.Group();
      steeringPivot.position.set(
        side * (width * 0.5 - 0.04),
        wheelRadius,
        axle * axleZ
      );
      group.add(steeringPivot);

      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.22, 10),
        wheelMaterial
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      wheel.receiveShadow = true;
      steeringPivot.add(wheel);

      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(wheelRadius * 0.38, wheelRadius * 0.38, 0.23, 8),
        trimMaterial
      );
      hub.rotation.z = Math.PI / 2;
      steeringPivot.add(hub);

      const wheelData = { pivot: steeringPivot, mesh: wheel, hub, front: axle < 0 };
      allWheels.push(wheelData);
      if (axle < 0) frontWheels.push(wheelData);
    }
  }

  group.position.set(vehicle.pos.x, vehicle.pos.y ?? 0, vehicle.pos.z);
  group.rotation.y = -vehicle.heading;
  scene.add(group);

  vehicle.type = key;
  vehicle.group = group;
  vehicle.wheels = { front: frontWheels, all: allWheels };
  vehicle._modelInfo = info;
  vehicle.color = info.body;
  vehicle.topSpeed = vehicle.topSpeed ?? info.topSpeed;
  vehicle.speed = vehicle.speed ?? 0;
  vehicle.steer = vehicle.steer ?? 0;
  vehicle.pos.y = vehicle.pos.y ?? 0;
  return vehicle;
}

export function materializeVehicle(vehicle, scene = vehicleScene) {
  if (!vehicle || vehicle.group) return vehicle;
  const targetScene = scene ?? vehicleScene;
  if (!targetScene) return vehicle;

  vehicle.pos ??= { x: 0, y: 0, z: 0 };
  vehicle.heading ??= 0;
  vehicle.speed ??= 0;
  return createVehicleVisual(vehicle, targetScene);
}

function clampPointToCity(world, x, z) {
  let result = null;
  if (typeof world.clampToCity === 'function') {
    result = world.clampToCity(x, z);
  }
  if (Array.isArray(result)) {
    x = Number.isFinite(result[0]) ? result[0] : x;
    z = Number.isFinite(result[1]) ? result[1] : z;
  } else if (result && typeof result === 'object') {
    x = Number.isFinite(result.x) ? result.x : x;
    z = Number.isFinite(result.z) ? result.z : z;
  }
  return { x, z: Math.min(z, 680) };
}

function collidesWithBuilding(world, x, z, radius) {
  for (const building of world.buildings ?? []) {
    if (
      x > building.x - building.w / 2 - radius &&
      x < building.x + building.w / 2 + radius &&
      z > building.z - building.d / 2 - radius &&
      z < building.z + building.d / 2 + radius
    ) {
      return true;
    }
  }
  return false;
}

function pushOutOfBuildings(world, x, z, radius) {
  for (const building of world.buildings ?? []) {
    const minX = building.x - building.w / 2 - radius;
    const maxX = building.x + building.w / 2 + radius;
    const minZ = building.z - building.d / 2 - radius;
    const maxZ = building.z + building.d / 2 + radius;

    if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) continue;

    const distances = [
      [x - minX, minX, z, 'x'],
      [maxX - x, maxX, z, 'x'],
      [z - minZ, x, minZ, 'z'],
      [maxZ - z, x, maxZ, 'z']
    ].sort((a, b) => a[0] - b[0]);

    const nearest = distances[0];
    if (nearest[3] === 'x') x = nearest[1];
    else z = nearest[2];
  }
  return { x, z };
}

function spawnPointPosition(point) {
  if (Array.isArray(point)) {
    return {
      x: Number.isFinite(point[0]) ? point[0] : 0,
      z: Number.isFinite(point[2]) ? point[2] : Number.isFinite(point[1]) ? point[1] : 0
    };
  }
  return {
    x: Number.isFinite(point?.x) ? point.x : 0,
    z: Number.isFinite(point?.z) ? point.z : 0
  };
}

function buildCurbCandidates(world, random) {
  const pitch = Number.isFinite(world.pitch) ? world.pitch : 112;
  const buildings = world.buildings ?? [];
  let extent = pitch * 4;

  for (const building of buildings) {
    extent = Math.max(
      extent,
      Math.abs(building.x) + building.w / 2 + pitch,
      Math.abs(building.z) + building.d / 2 + pitch
    );
  }

  const limit = Math.min(14, Math.ceil(extent / pitch));
  const candidates = [];

  for (let roadIndex = -limit; roadIndex <= limit; roadIndex++) {
    const roadX = roadIndex * pitch;
    const roadZ = roadIndex * pitch;

    for (let segment = -limit; segment <= limit; segment++) {
      const along = segment * pitch + pitch * 0.5;
      for (const side of [-1, 1]) {
        candidates.push({
          x: roadX + side * 7.5,
          z: along,
          heading: side < 0 ? 0 : Math.PI
        });
        candidates.push({
          x: along,
          z: roadZ + side * 7.5,
          heading: side < 0 ? Math.PI / 2 : -Math.PI / 2
        });
      }
    }
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates;
}

export function createVehicleManager(scene, world, camera) {
  vehicleScene = scene;
  const state = world.state;
  state.currentVehicle ??= null;
  state.player ??= {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    heading: 0,
    onFoot: true,
    health: 100,
    cash: 250
  };
  state.player.pos ??= { x: 0, y: 0, z: 0 };
  state.player.vel ??= { x: 0, y: 0, z: 0 };
  state.player.onFoot ??= true;

  const cars = [];
  let nextId = 1;
  let previousE = false;
  let cameraYaw = 0;
  let cameraYawOffset = 0;
  let cameraInitialized = false;

  function createCar(type, x, z, heading = 0, owned = true) {
    const key = resolveModelKey(type);
    const vehicle = {
      id: `vehicle-${nextId++}`,
      type: key,
      pos: { x, y: 0, z },
      heading,
      speed: 0,
      topSpeed: MODEL_INFO[key].topSpeed,
      color: MODEL_INFO[key].body,
      owned: Boolean(owned),
      steer: 0
    };
    materializeVehicle(vehicle, scene);
    cars.push(vehicle);
    return vehicle;
  }

  function spawnCars(count = 10, seedOffset = 0) {
    const total = Math.max(0, Math.floor(count));
    if (total === 0) return [];

    const seed = (
      (Number.isFinite(seedOffset) ? seedOffset : 0) +
      (Number.isFinite(world.seed) ? world.seed : 0) +
      0x51f15e
    ) >>> 0;
    const random = mulberry32(seed);
    const spawned = [];
    const types = ['sedan', 'taxi', 'sports', 'truck', 'police'];
    const points = world.spawnPoints?.cars;
    const parkedPoints = Array.isArray(points) ? points : [];

    // Use authored parked-car locations before generating curbside locations.
    for (const point of parkedPoints) {
      if (spawned.length >= total) break;
      const position = spawnPointPosition(point);
      const heading = Number.isFinite(point?.heading) ? point.heading : 0;
      const type = MODEL_KEYS.has(point?.type) ? point.type : types[Math.floor(random() * types.length)];
      const car = createCar(type, position.x, position.z, heading, false);
      spawned.push(car);
    }

    if (spawned.length < total) {
      const candidates = buildCurbCandidates(world, random);
      for (const candidate of candidates) {
        if (spawned.length >= total) break;

        const clamped = clampPointToCity(world, candidate.x, candidate.z);
        if (
          Math.abs(clamped.x - candidate.x) > 0.01 ||
          Math.abs(clamped.z - candidate.z) > 0.01 ||
          collidesWithBuilding(world, candidate.x, candidate.z, 1.3)
        ) {
          continue;
        }

        let occupied = false;
        for (const car of cars) {
          if (Math.hypot(car.pos.x - candidate.x, car.pos.z - candidate.z) < 6.8) {
            occupied = true;
            break;
          }
        }
        if (occupied) continue;

        const type = types[Math.floor(random() * types.length)];
        const car = createCar(type, candidate.x, candidate.z, candidate.heading, false);
        spawned.push(car);
      }
    }

    return spawned;
  }

  function enterVehicle(vehicle) {
    if (!vehicle || !state.player.onFoot || state.currentVehicle !== null) return false;
    if (!cars.includes(vehicle)) return false;

    materializeVehicle(vehicle, scene);
    state.currentVehicle = vehicle;
    state.player.onFoot = false;
    // The player is in the car now: keep the shared position on the
    // vehicle (vehicles.update() re-syncs this every frame while driving,
    // but entry itself must not leave a stale on-foot position behind).
    state.player.pos.x = vehicle.pos.x;
    state.player.pos.y = vehicle.pos.y ?? 0;
    state.player.pos.z = vehicle.pos.z;
    state.player.heading = vehicle.heading;
    state.player.vel.x = 0;
    state.player.vel.y = 0;
    state.player.vel.z = 0;
    vehicle._playerHidden = true;

    if (vehicle.owned === false) {
      world.state._onVehicleTheft?.(vehicle);
    }

    cameraYawOffset = normalizeAngle(cameraYaw - vehicle.heading);
    return true;
  }

  function exitVehicle() {
    const vehicle = state.currentVehicle;
    if (!vehicle) return false;

    const rightX = Math.cos(vehicle.heading);
    const rightZ = Math.sin(vehicle.heading);
    const exitX = vehicle.pos.x + rightX * 2.2;
    const exitZ = vehicle.pos.z + rightZ * 2.2;
    const point = clampPointToCity(world, exitX, exitZ);
    const resolved = pushOutOfBuildings(world, point.x, point.z, 0.6);

    state.player.pos.x = resolved.x;
    state.player.pos.y = 0;
    state.player.pos.z = resolved.z;
    state.player.heading = vehicle.heading;
    state.player.vel.x = 0;
    state.player.vel.y = 0;
    state.player.vel.z = 0;
    state.player.onFoot = true;
    state.currentVehicle = null;
    vehicle.speed = 0;
    vehicle._playerHidden = false;
    return true;
  }

  function getNearbyVehicle(maxDist = 3.5) {
    if (!state.player.onFoot) return null;

    let nearest = null;
    let nearestDistance = maxDist;
    for (const vehicle of cars) {
      const distance = Math.hypot(
        vehicle.pos.x - state.player.pos.x,
        vehicle.pos.z - state.player.pos.z
      );
      if (distance <= nearestDistance) {
        nearest = vehicle;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  function syncVehicle(vehicle, dt) {
    const group = vehicle.group;
    if (!group) return;

    group.position.set(vehicle.pos.x, vehicle.pos.y ?? 0, vehicle.pos.z);
    group.rotation.y = -vehicle.heading;

    const spin = vehicle.speed * dt / 0.34;
    for (const wheel of vehicle.wheels?.all ?? []) {
      wheel.mesh.rotation.x += spin;
      wheel.hub.rotation.x += spin;
    }
    const steeringAngle = -(vehicle.steer ?? 0) * 0.48;
    for (const wheel of vehicle.wheels?.front ?? []) {
      wheel.pivot.rotation.y = steeringAngle;
    }
  }

  function updateCamera(vehicle, dt, input) {
    if (!camera || !vehicle) return;

    const mouseDX = Number.isFinite(state.input?.mouseDX)
      ? state.input.mouseDX
      : Number.isFinite(input.mouseDX)
        ? input.mouseDX
        : 0;
    cameraYawOffset = normalizeAngle(cameraYawOffset + mouseDX * 0.0028);
    cameraYawOffset = THREE.MathUtils.damp(cameraYawOffset, 0, 1.1, Math.max(0, dt));

    const viewYaw = vehicle.heading + cameraYawOffset;
    const forwardX = Math.sin(viewYaw);
    const forwardZ = -Math.cos(viewYaw);
    const desired = new THREE.Vector3(
      vehicle.pos.x - forwardX * 10,
      (vehicle.pos.y ?? 0) + 3.5,
      vehicle.pos.z - forwardZ * 10
    );
    const lookAt = new THREE.Vector3(
      vehicle.pos.x + Math.sin(vehicle.heading) * 6,
      (vehicle.pos.y ?? 0) + 1.2,
      vehicle.pos.z - Math.cos(vehicle.heading) * 6
    );

    if (!cameraInitialized) {
      camera.position.copy(desired);
      cameraInitialized = true;
    } else {
      camera.position.lerp(desired, 1 - Math.exp(-6 * Math.max(0, dt)));
    }
    camera.lookAt(lookAt);
  }

  function update(dt, input = {}) {
    const keys = input.keys ?? state.input?.keys ?? new Set();
    const isEPressed = keys.has('KeyE');
    const eJustPressed = isEPressed && !previousE;
    previousE = isEPressed;

    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    const vehicle = state.currentVehicle;

    if (!vehicle) {
      cameraInitialized = false;
      return;
    }

    materializeVehicle(vehicle, scene);
    if (eJustPressed) {
      exitVehicle();
      return;
    }

    const active = state.screen === 'play' && !state.paused;
    if (active) {
      const modelKey = resolveModelKey(vehicle.type);
      const accelerationRate = modelKey === 'truck' ? 8 : 12;
      const brakingRate = 18;
      const reverseRate = 6;
      const throttle = keys.has('KeyW');
      const braking = keys.has('KeyS');
      const handbrake = keys.has('Space');

      if (throttle) {
        vehicle.speed += accelerationRate * safeDt;
      } else if (braking) {
        if (vehicle.speed > 0.25) {
          vehicle.speed = Math.max(0, vehicle.speed - brakingRate * safeDt);
        } else {
          vehicle.speed = Math.max(-6, vehicle.speed - reverseRate * safeDt);
        }
      } else {
        const drag = handbrake ? 26 : 2.2;
        vehicle.speed = THREE.MathUtils.damp(vehicle.speed, 0, drag, safeDt);
      }

      const topSpeed = vehicle.topSpeed ?? MODEL_INFO[modelKey].topSpeed;
      vehicle.speed = THREE.MathUtils.clamp(vehicle.speed, -6, topSpeed);

      const steerInput =
        (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const steerRate = 1 - Math.exp(-(handbrake ? 12 : 8) * safeDt);
      vehicle.steer = THREE.MathUtils.lerp(vehicle.steer ?? 0, steerInput, steerRate);

      const speedRatio = Math.min(Math.abs(vehicle.speed) / 8, 1);
      const highSpeedReduction = 1 / (1 + Math.max(0, Math.abs(vehicle.speed) - 20) * 0.035);
      const handbrakeBoost = handbrake ? 1.25 : 1;
      const turnRate = 1.6 * speedRatio * highSpeedReduction * handbrakeBoost;
      const reverseSign = vehicle.speed < -0.1 ? -1 : 1;
      vehicle.heading += vehicle.steer * turnRate * reverseSign * safeDt;

      const forwardX = Math.sin(vehicle.heading);
      const forwardZ = -Math.cos(vehicle.heading);
      const oldX = vehicle.pos.x;
      const oldZ = vehicle.pos.z;
      let nextX = oldX + forwardX * vehicle.speed * safeDt;
      let nextZ = oldZ + forwardZ * vehicle.speed * safeDt;

      const clamped = clampPointToCity(world, nextX, nextZ);
      nextX = clamped.x;
      nextZ = clamped.z;

      const radius = 1.3;
      if (collidesWithBuilding(world, nextX, nextZ, radius)) {
        const xOnly = clampPointToCity(world, nextX, oldZ);
        const zOnly = clampPointToCity(world, oldX, nextZ);
        const canMoveX =
          !collidesWithBuilding(world, xOnly.x, xOnly.z, radius);
        const canMoveZ =
          !collidesWithBuilding(world, zOnly.x, zOnly.z, radius);

        if (canMoveX) {
          nextX = xOnly.x;
          nextZ = xOnly.z;
        } else if (canMoveZ) {
          nextX = zOnly.x;
          nextZ = zOnly.z;
        } else {
          nextX = oldX;
          nextZ = oldZ;
        }
        vehicle.speed *= 0.4;
      }

      vehicle.pos.x = nextX;
      vehicle.pos.y = 0;
      vehicle.pos.z = nextZ;
    }

    state.player.pos.x = vehicle.pos.x;
    state.player.pos.y = vehicle.pos.y ?? 0;
    state.player.pos.z = vehicle.pos.z;
    state.player.heading = vehicle.heading;
    vehicle.speed = Number.isFinite(vehicle.speed) ? vehicle.speed : 0;

    syncVehicle(vehicle, safeDt);
    updateCamera(vehicle, safeDt, input);
  }

  return {
    cars,
    spawnCars,
    createCar(type, x, z, heading = 0) {
      return createCar(type, x, z, heading, true);
    },
    enterVehicle,
    exitVehicle,
    getNearbyVehicle,
    update,
    setCameraYaw(yaw) {
      if (Number.isFinite(yaw)) cameraYaw = yaw;
    }
  };
}
