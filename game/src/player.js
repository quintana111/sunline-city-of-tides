import * as THREE from 'three';

const PLAYER_RADIUS = 0.6;
const WALK_SPEED = 4.2;
const RUN_SPEED = 7.2;
const CAMERA_SENSITIVITY = 0.0028;

function getOrCreatePlayerState(world) {
  const state = world.state;
  if (!state.player) {
    state.player = {
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      heading: 0,
      onFoot: true,
      health: 100,
      cash: 250
    };
  }
  const player = state.player;
  player.pos ??= { x: 0, y: 0, z: 0 };
  player.vel ??= { x: 0, y: 0, z: 0 };
  player.heading ??= 0;
  player.onFoot ??= true;
  return player;
}

function makeBox(parent, material, x, y, z, width, height, depth) {
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

  // The coast is walkable sand; only the ocean beyond it is out of bounds.
  z = Math.min(z, 680);
  return { x, z };
}

function pushOutOfBuildings(world, x, z, radius) {
  for (const building of world.buildings ?? []) {
    const minX = building.x - building.w / 2 - radius;
    const maxX = building.x + building.w / 2 + radius;
    const minZ = building.z - building.d / 2 - radius;
    const maxZ = building.z + building.d / 2 + radius;

    if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) continue;

    const left = x - minX;
    const right = maxX - x;
    const near = z - minZ;
    const far = maxZ - z;
    const smallest = Math.min(left, right, near, far);

    if (smallest === left) x = minX;
    else if (smallest === right) x = maxX;
    else if (smallest === near) z = minZ;
    else z = maxZ;
  }
  return { x, z };
}

export function createPlayer(scene, world, camera) {
  const player = getOrCreatePlayerState(world);
  const group = new THREE.Group();
  group.name = 'Nia Solis';

  const teal = new THREE.MeshStandardMaterial({
    color: 0x167f82,
    roughness: 0.88
  });
  const cream = new THREE.MeshStandardMaterial({
    color: 0xf1e5c9,
    roughness: 0.9
  });
  const trousers = new THREE.MeshStandardMaterial({
    color: 0x27313d,
    roughness: 0.95
  });
  const coral = new THREE.MeshStandardMaterial({
    color: 0xe77768,
    roughness: 0.85
  });
  const skin = new THREE.MeshStandardMaterial({
    color: 0xc88f70,
    roughness: 0.9
  });
  const face = new THREE.MeshStandardMaterial({
    color: 0x28262b,
    roughness: 1
  });

  makeBox(group, teal, 0, 1.15, 0, 0.62, 0.62, 0.32);
  makeBox(group, cream, 0, 1.18, -0.171, 0.22, 0.46, 0.025);

  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.17, 0.69, 0);
  group.add(leftLeg);
  makeBox(leftLeg, trousers, 0, -0.02, 0, 0.22, 0.66, 0.25);
  makeBox(leftLeg, coral, 0, -0.37, -0.035, 0.23, 0.13, 0.36);

  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.17, 0.69, 0);
  group.add(rightLeg);
  makeBox(rightLeg, trousers, 0, -0.02, 0, 0.22, 0.66, 0.25);
  makeBox(rightLeg, coral, 0, -0.37, -0.035, 0.23, 0.13, 0.36);

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.39, 1.35, 0);
  group.add(leftArm);
  makeBox(leftArm, teal, 0, -0.24, 0, 0.18, 0.5, 0.22);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.39, 1.35, 0);
  group.add(rightArm);
  makeBox(rightArm, teal, 0, -0.24, 0, 0.18, 0.5, 0.22);

  makeBox(group, skin, 0, 1.65, 0, 0.34, 0.38, 0.32);
  makeBox(group, coral, 0, 1.84, 0.015, 0.36, 0.12, 0.35);
  makeBox(group, coral, 0, 1.73, 0.145, 0.36, 0.14, 0.08);
  makeBox(group, face, 0, 1.65, -0.166, 0.2, 0.12, 0.018);

  group.position.set(player.pos.x, player.pos.y ?? 0, player.pos.z);
  group.rotation.y = -player.heading;
  scene.add(group);

  let camYaw = 0;
  let camPitch = 0.38;
  let cameraInitialized = false;
  let verticalVelocity = player.vel.y ?? 0;
  let walkPhase = 0;

  function setPosition(x, z) {
    const clamped = clampPointToCity(world, x, z);
    const resolved = pushOutOfBuildings(
      world,
      clamped.x,
      clamped.z,
      PLAYER_RADIUS
    );
    player.pos.x = resolved.x;
    player.pos.y = 0;
    player.pos.z = resolved.z;
    player.vel.x = 0;
    player.vel.z = 0;
    group.position.set(resolved.x, 0, resolved.z);
  }

  function respawn() {
    const spawn = world.spawnPoints?.player;
    const x = Number.isFinite(spawn?.x) ? spawn.x : 0;
    const z = Number.isFinite(spawn?.z) ? spawn.z : 0;

    if (world.state.currentVehicle) {
      world.state.currentVehicle = null;
    }
    player.onFoot = true;
    player.heading = Number.isFinite(spawn?.heading) ? spawn.heading : 0;
    verticalVelocity = 0;
    player.vel.y = 0;
    group.visible = true;
    setPosition(x, z);
    group.rotation.y = -player.heading;
    cameraInitialized = false;
  }

  function updateCamera(dt) {
    if (!camera) return;

    const target = new THREE.Vector3(player.pos.x, 1.6, player.pos.z);
    const horizontal = 8 * Math.cos(camPitch);
    const desired = new THREE.Vector3(
      player.pos.x - Math.sin(camYaw) * horizontal,
      player.pos.y + 1.6 + 8 * Math.sin(camPitch),
      player.pos.z + Math.cos(camYaw) * horizontal
    );

    if (!cameraInitialized) {
      camera.position.copy(desired);
      cameraInitialized = true;
    } else {
      camera.position.lerp(desired, 1 - Math.exp(-8 * Math.max(0, dt)));
    }
    camera.lookAt(target);
  }

  function update(dt, input = {}, updateWorld = world) {
    const state = updateWorld?.state ?? world.state;
    const keys = input.keys ?? state.input?.keys ?? new Set();
    const mouseDX = Number.isFinite(state.input?.mouseDX)
      ? state.input.mouseDX
      : Number.isFinite(input.mouseDX)
        ? input.mouseDX
        : 0;
    const mouseDY = Number.isFinite(state.input?.mouseDY)
      ? state.input.mouseDY
      : Number.isFinite(input.mouseDY)
        ? input.mouseDY
        : 0;

    if (!cameraInitialized && camera) {
      camYaw = Math.atan2(
        player.pos.x - camera.position.x,
        camera.position.z - player.pos.z
      );
      cameraInitialized = true;
    }

    if (state.screen === 'play' && !state.paused && player.onFoot) {
      camYaw += mouseDX * CAMERA_SENSITIVITY;
      camPitch = THREE.MathUtils.clamp(
        camPitch - mouseDY * CAMERA_SENSITIVITY,
        -0.1,
        1.1
      );
    }

    if (!player.onFoot || state.currentVehicle !== null) {
      group.visible = false;
      updateCamera(dt);
      return;
    }
    group.visible = true;

    const active = state.screen === 'play' && !state.paused;
    const safeDt = Math.min(Math.max(dt, 0), 0.05);

    if (active) {
      const forwardInput =
        (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const sideInput =
        (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const inputLength = Math.hypot(forwardInput, sideInput);
      const normalize = inputLength > 1 ? 1 / inputLength : 1;
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight')
        ? RUN_SPEED
        : WALK_SPEED;

      const sin = Math.sin(camYaw);
      const cos = Math.cos(camYaw);
      const targetX =
        (sideInput * cos + forwardInput * sin) * normalize * speed;
      const targetZ =
        (sideInput * sin - forwardInput * cos) * normalize * speed;
      const acceleration = 1 - Math.exp(-12 * safeDt);

      player.vel.x = THREE.MathUtils.lerp(player.vel.x, targetX, acceleration);
      player.vel.z = THREE.MathUtils.lerp(player.vel.z, targetZ, acceleration);

      if (
        keys.has('Space') &&
        Math.abs(verticalVelocity) < 0.001 &&
        player.pos.y <= 0.001
      ) {
        verticalVelocity = 7;
      }

      verticalVelocity -= 20 * safeDt;
      player.pos.y = Math.max(0, (player.pos.y ?? 0) + verticalVelocity * safeDt);
      if (player.pos.y === 0 && verticalVelocity < 0) verticalVelocity = 0;

      let nextX = player.pos.x + player.vel.x * safeDt;
      let nextZ = player.pos.z + player.vel.z * safeDt;
      const cityPoint = clampPointToCity(updateWorld, nextX, nextZ);
      nextX = cityPoint.x;
      nextZ = cityPoint.z;

      const resolved = pushOutOfBuildings(
        updateWorld,
        nextX,
        nextZ,
        PLAYER_RADIUS
      );
      if (resolved.x !== nextX) player.vel.x = 0;
      if (resolved.z !== nextZ) player.vel.z = 0;
      player.pos.x = resolved.x;
      player.pos.z = resolved.z;

      const moving = Math.hypot(player.vel.x, player.vel.z) > 0.15;
      if (moving) {
        player.heading = Math.atan2(player.vel.x, -player.vel.z);
        walkPhase += safeDt * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 12 : 8);
      } else {
        walkPhase += safeDt * 1.5;
      }

      const swing = moving ? Math.sin(walkPhase) * 0.55 : Math.sin(walkPhase) * 0.025;
      leftLeg.rotation.x = swing;
      rightLeg.rotation.x = -swing;
      leftArm.rotation.x = -swing * 0.75;
      rightArm.rotation.x = swing * 0.75;
      group.position.set(player.pos.x, player.pos.y, player.pos.z);
      group.rotation.y = -player.heading;
    }

    player.vel.y = verticalVelocity;
    updateCamera(dt);
  }

  return {
    group,
    update,
    setPosition,
    respawn,
    getCameraYaw() {
      return camYaw;
    }
  };
}
