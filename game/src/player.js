// player.js — Nia Solis, on-foot movement + third-person camera.
// Heading convention (authoritative): forward = (sin h, 0, -cos h);
// mesh rotation.y = -heading. The figure's front is local -Z.

import * as THREE from '../vendor/three.min.js';
import { hitsCollider, clampToCity } from './world.js';

export const WALK_SPEED = 4.2;
export const RUN_SPEED = 7.2;
export const JUMP_IMPULSE = 7.0;
export const GRAVITY = 20;

function part(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.position.set(x, y, z);
  return mesh;
}

// Build the low-poly figure: teal jacket, cream shirt, dark trousers,
// coral accent, small hair block. No detailed face.
export function createPlayer(scene, world) {
  const group = new THREE.Group();
  group.name = 'player';

  const legs = part(0.34, 0.72, 0.34, 0x2c3242, -0.14, 0.36, 0);
  const legs2 = part(0.34, 0.72, 0.34, 0x2c3242, 0.14, 0.36, 0);
  const torso = part(0.62, 0.72, 0.36, 0x1f8a8a, 0, 1.08, 0); // teal jacket
  const shirt = part(0.4, 0.5, 0.38, 0xf2ead8, 0, 1.06, 0); // cream shirt front
  const armL = part(0.2, 0.62, 0.2, 0x1f8a8a, -0.42, 1.08, 0);
  const armR = part(0.2, 0.62, 0.2, 0x1f8a8a, 0.42, 1.08, 0);
  const head = part(0.42, 0.42, 0.4, 0xd9a986, 0, 1.68, 0);
  const hair = part(0.46, 0.2, 0.44, 0x2e2118, 0, 1.92, 0.02);
  const cap = part(0.48, 0.1, 0.46, 0xff6f61, 0, 1.99, 0); // coral accent
  group.add(legs, legs2, torso, shirt, armL, armR, head, hair, cap);
  group.traverse((m) => { if (m.isMesh) m.castShadow = false; });

  scene.add(group);

  const player = {
    group,
    legs, legs2, armL, armR,
    camYaw: Math.PI, // camera looks north (-Z) at start; yaw = heading of view
    camPitch: 0.32,
    vy: 0,
    grounded: true,
    walkPhase: 0,
    update(dt, input, w) { updatePlayer(player, dt, input, w); },
  };
  return player;
}

function updatePlayer(player, dt, input, world) {
  const state = world.state;
  if (!state) return;
  const p = state.player;
  if (!p.onFoot) return; // driving: vehicles.js owns the position

  const keys = input.keys;
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = run ? RUN_SPEED : WALK_SPEED;

  // Movement is camera-relative: W walks away from the camera.
  const yaw = player.camYaw;
  const fwdX = Math.sin(yaw), fwdZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw), rightZ = Math.sin(yaw);
  let mx = 0, mz = 0;
  if (keys.has('KeyW')) { mx += fwdX; mz += fwdZ; }
  if (keys.has('KeyS')) { mx -= fwdX; mz -= fwdZ; }
  if (keys.has('KeyD')) { mx += rightX; mz += rightZ; }
  if (keys.has('KeyA')) { mx -= rightX; mz -= rightZ; }
  const len = Math.hypot(mx, mz);
  let moving = false;
  if (len > 0.001) {
    mx /= len; mz /= len;
    moving = true;
    // Face the movement direction: forward = (sin h, 0, -cos h).
    p.heading = Math.atan2(mx, -mz);
    const nx = p.pos.x + mx * speed * dt;
    const nz = p.pos.z + mz * speed * dt;
    if (!hitsCollider(world, nx, p.pos.z, 0.55)) p.pos.x = clampToCity(nx, 40);
    if (!hitsCollider(world, p.pos.x, nz, 0.55)) p.pos.z = clampToCity(nz, 40);
    player.walkPhase += dt * speed * 1.6;
  }

  // Jump + gravity, ground clamp at y=0.
  if (keys.has('Space') && player.grounded) {
    player.vy = JUMP_IMPULSE;
    player.grounded = false;
  }
  if (!player.grounded) {
    player.vy -= GRAVITY * dt;
    p.pos.y += player.vy * dt;
    if (p.pos.y <= 0) { p.pos.y = 0; player.vy = 0; player.grounded = true; }
  }

  // Swing limbs while walking; idle sway otherwise.
  const swing = moving ? Math.sin(player.walkPhase) * 0.55 : 0;
  player.legs.rotation.x = swing;
  player.legs2.rotation.x = -swing;
  player.armL.rotation.x = -swing * 0.8;
  player.armR.rotation.x = swing * 0.8;

  player.group.position.set(p.pos.x, p.pos.y, p.pos.z);
  player.group.rotation.y = -p.heading;
  player.group.visible = true;
}
