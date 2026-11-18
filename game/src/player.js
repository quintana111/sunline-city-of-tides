// Nia Solis — on-foot character, movement, jump, third-person orbit camera.
// Forward = (sin h, 0, -cos h); character mesh uses rotation.y = -heading.
import * as THREE from 'three';

const WALK_SPEED = 4.2;
const RUN_SPEED = 7.2;
const PLAYER_RADIUS = 0.6;
const GRAVITY = 20;
const JUMP_VELOCITY = 7.0;

function forwardForHeading(heading) {
  return new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
}

function clampPlayerToWorld(world, x, z) {
  let clamped = { x, z };
  if (world && typeof world.clampToCity === 'function') {
    const r = world.clampToCity(x, z);
    if (r && typeof r === 'object') clamped = { x: r.x, z: r.z };
  }
  // Beach stays walkable south of the city grid, up to the water.
  const safeZ = z > 580 ? Math.min(680, z) : clamped.z;
  return { x: clamped.x, z: safeZ };
}

function pointInsideBuilding(building, x, z, radius) {
  const halfW = (Number(building.w) || 0) * 0.5 + radius;
  const halfD = (Number(building.d) || 0) * 0.5 + radius;
  return Math.abs(x - building.x) < halfW && Math.abs(z - building.z) < halfD;
}

// Push a circle out of every building footprint it overlaps (a few passes).
function resolveBuildingCollision(world, x, z, radius) {
  if (!world || !Array.isArray(world.buildings)) return { x, z };
  let px = x;
  let pz = z;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const building of world.buildings) {
      if (!building || !pointInsideBuilding(building, px, pz, radius)) continue;
      const halfW = (Number(building.w) || 0) * 0.5 + radius;
      const halfD = (Number(building.d) || 0) * 0.5 + radius;
      const dx = px - building.x;
      const dz = pz - building.z;
      const pushX = halfW - Math.abs(dx);
      const pushZ = halfD - Math.abs(dz);
      if (pushX < pushZ) px = building.x + (dx < 0 ? -halfW : halfW);
      else pz = building.z + (dz < 0 ? -halfD : halfD);
      changed = true;
    }
    if (!changed) break;
  }
  return { x: px, z: pz };
}

function makeBox(width, height, depth, color) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, roughness: 0.82 }),
  );
}

export function createPlayer(scene, world, camera) {
  const group = new THREE.Group();
  group.name = 'Nia Solis';

  const jacket = makeBox(0.58, 0.72, 0.34, 0x247f83); // teal jacket
  jacket.position.set(0, 1.14, 0);
  group.add(jacket);
  const shirtFront = makeBox(0.22, 0.46, 0.025, 0xe8dfc8); // cream shirt
  shirtFront.position.set(0, 1.15, -0.181);
  group.add(shirtFront);
  const head = makeBox(0.3, 0.34, 0.29, 0xb98162);
  head.position.set(0, 1.68, 0);
  group.add(head);
  const face = makeBox(0.22, 0.16, 0.018, 0x302c31);
  face.position.set(0, 1.66, -0.155);
  group.add(face);
  const hair = makeBox(0.34, 0.2, 0.33, 0xd66658); // coral hair
  hair.position.set(0, 1.86, 0.015);
  group.add(hair);
  const hairFringe = makeBox(0.31, 0.09, 0.09, 0xd66658);
  hairFringe.position.set(0, 1.76, -0.16);
  group.add(hairFringe);

  const legs = [];
  const arms = [];
  for (const side of [-1, 1]) {
    const legPivot = new THREE.Group();
    legPivot.position.set(side * 0.17, 0.82, 0);
    group.add(legPivot);
    const leg = makeBox(0.23, 0.75, 0.27, 0x303744); // dark trousers
    leg.position.y = -0.32;
    legPivot.add(leg);
    const shoe = makeBox(0.24, 0.13, 0.37, 0xd66658);
    shoe.position.set(0, -0.68, -0.045);
    legPivot.add(shoe);
    legs.push(legPivot);

    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.38, 1.39, 0);
    group.add(armPivot);
    const sleeve = makeBox(0.19, 0.55, 0.23, 0x247f83);
    sleeve.position.y = -0.25;
    armPivot.add(sleeve);
    const hand = makeBox(0.16, 0.14, 0.18, 0xb98162);
    hand.position.y = -0.56;
    armPivot.add(hand);
    arms.push(armPivot);
  }
  scene.add(group);

  const state = world.state;
  state.player = state.player || {
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    heading: 0, onFoot: true, health: 100, cash: 250,
  };
  const player = state.player;
  player.pos = player.pos || { x: 0, y: 0, z: 0 };
  player.vel = player.vel || { x: 0, y: 0, z: 0 };
  if (!Number.isFinite(player.pos.x)) player.pos.x = 0;
  if (!Number.isFinite(player.pos.y)) player.pos.y = 0;
  if (!Number.isFinite(player.pos.z)) player.pos.z = 0;
  if (!Number.isFinite(player.heading)) player.heading = 0;

  let camYaw = player.heading;
  let camPitch = 0.32;
  let cameraInitialized = false;
  let walkPhase = 0;
  let jumpHeld = false;

  const target = new THREE.Vector3();
  const desiredCameraPosition = new THREE.Vector3();

  function syncGroup() {
    group.position.set(player.pos.x, player.pos.y, player.pos.z);
    group.rotation.y = -player.heading;
    group.visible = player.onFoot !== false;
  }

  function setPosition(x, z) {
    const clamped = clampPlayerToWorld(world, x, z);
    const resolved = resolveBuildingCollision(world, clamped.x, clamped.z, PLAYER_RADIUS);
    player.pos.x = resolved.x;
    player.pos.z = resolved.z;
    player.pos.y = 0;
    player.vel.x = 0;
    player.vel.y = 0;
    player.vel.z = 0;
    syncGroup();
  }

  function respawn() {
    const spawn = world.spawnPoints?.player || { x: 0, z: 24 };
    setPosition(spawn.x, spawn.z);
    player.heading = 0;
    player.health = 100;
    player.onFoot = true;
    syncGroup();
  }

  function updateCamera(input, dt) {
    if (!camera) return;
    const sensitivity = 0.0028;
    camYaw += (Number(input?.mouseDX) || 0) * sensitivity;
    camPitch = THREE.MathUtils.clamp(camPitch + (Number(input?.mouseDY) || 0) * sensitivity, -0.1, 1.1);
    target.set(player.pos.x, player.pos.y + 1.6, player.pos.z);
    const horizontalDistance = 8 * Math.cos(camPitch);
    const fwd = forwardForHeading(camYaw);
    desiredCameraPosition.set(
      target.x - fwd.x * horizontalDistance,
      target.y + 8 * Math.sin(camPitch),
      target.z - fwd.z * horizontalDistance,
    );
    if (!cameraInitialized) {
      camera.position.copy(desiredCameraPosition);
      cameraInitialized = true;
    } else {
      camera.position.lerp(desiredCameraPosition, 1 - Math.exp(-8 * Math.max(0, dt)));
    }
    camera.lookAt(target);
  }

  function update(dt, input, updateWorld = world) {
    const activeWorld = updateWorld || world;
    const activeState = activeWorld.state || state;
    const keys = input?.keys ?? new Set();
    syncGroup();
    if (activeState.screen !== 'play' || activeState.paused ||
        activeState.currentVehicle || player.onFoot === false) {
      updateCamera(input, dt);
      return;
    }
    const safeDt = Math.min(Math.max(0, Number(dt) || 0), 0.05);

    let moveX = 0;
    let moveZ = 0;
    const forward = forwardForHeading(camYaw);
    const right = new THREE.Vector3(Math.cos(camYaw), 0, Math.sin(camYaw));
    if (keys.has('KeyW')) { moveX += forward.x; moveZ += forward.z; }
    if (keys.has('KeyS')) { moveX -= forward.x; moveZ -= forward.z; }
    if (keys.has('KeyD')) { moveX += right.x; moveZ += right.z; }
    if (keys.has('KeyA')) { moveX -= right.x; moveZ -= right.z; }

    const moving = Math.hypot(moveX, moveZ) > 0.001;
    if (moving) {
      const length = Math.hypot(moveX, moveZ);
      moveX /= length;
      moveZ /= length;
      player.heading = Math.atan2(moveX, -moveZ);
    }
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = running ? RUN_SPEED : WALK_SPEED;
    const blend = 1 - Math.exp(-12 * safeDt);
    player.vel.x = THREE.MathUtils.lerp(player.vel.x || 0, moving ? moveX * speed : 0, blend);
    player.vel.z = THREE.MathUtils.lerp(player.vel.z || 0, moving ? moveZ * speed : 0, blend);

    if (keys.has('Space') && player.pos.y <= 0.001 && !jumpHeld) {
      player.vel.y = JUMP_VELOCITY;
      jumpHeld = true;
    }
    if (!keys.has('Space')) jumpHeld = false;
    player.vel.y = (player.vel.y || 0) - GRAVITY * safeDt;

    let nextX = player.pos.x + player.vel.x * safeDt;
    let nextZ = player.pos.z + player.vel.z * safeDt;
    const clamped = clampPlayerToWorld(activeWorld, nextX, nextZ);
    nextX = clamped.x;
    nextZ = clamped.z;
    const resolved = resolveBuildingCollision(activeWorld, nextX, nextZ, PLAYER_RADIUS);
    if (resolved.x !== nextX) player.vel.x = 0;
    if (resolved.z !== nextZ) player.vel.z = 0;
    player.pos.x = resolved.x;
    player.pos.z = resolved.z;
    player.pos.y += player.vel.y * safeDt;
    if (player.pos.y <= 0) {
      player.pos.y = 0;
      player.vel.y = 0;
    }

    if (moving && Math.hypot(player.vel.x, player.vel.z) > 0.15) {
      walkPhase += safeDt * (running ? 12 : 8);
      const swing = Math.sin(walkPhase) * 0.48;
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
      arms[0].rotation.x = -swing * 0.6;
      arms[1].rotation.x = swing * 0.6;
    } else {
      const breathing = Math.sin(performance.now() * 0.0018) * 0.025;
      legs[0].rotation.x = THREE.MathUtils.lerp(legs[0].rotation.x, 0, 0.2);
      legs[1].rotation.x = THREE.MathUtils.lerp(legs[1].rotation.x, 0, 0.2);
      arms[0].rotation.x = THREE.MathUtils.lerp(arms[0].rotation.x, breathing, 0.15);
      arms[1].rotation.x = THREE.MathUtils.lerp(arms[1].rotation.x, breathing, 0.15);
    }

    syncGroup();
    updateCamera(input, safeDt);
  }

  syncGroup();
  return {
    group,
    update,
    setPosition,
    respawn,
    getCameraYaw() { return camYaw; },
    setCameraYaw(yaw) { if (Number.isFinite(yaw)) camYaw = yaw; },
  };
}
