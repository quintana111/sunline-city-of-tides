// Combat (design §10). Written fresh 2026-11-24 (Builder B).
// F punch (~2u, cooldown), left-mouse hitscan, crime reports for public
// violence, damagePlayer(), getWeaponState(). No gore: targets flee.
import * as THREE from 'three';

const PUNCH_RANGE = 2.2;
const PUNCH_COOLDOWN = 0.55;
const SHOT_RANGE = 32;
const SHOT_COOLDOWN = 0.4;

export function createCombat(scene, world, state, police, traffic) {
  let punchCooldown = 0;
  let shotCooldown = 0;
  let wasFPressed = false;
  let wasMouseDown = false;
  let flashTimer = 0;

  // Short-lived tracer line for the hitscan shot.
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const flash = new THREE.Line(flashGeo, new THREE.LineBasicMaterial({
    color: 0xffe9a3, transparent: true, opacity: 0,
  }));
  flash.visible = false;
  flash.frustumCulled = false;
  scene.add(flash);

  function forward() {
    const h = state.currentVehicle?.heading ?? state.player.heading;
    return { x: Math.sin(h), z: -Math.cos(h) };
  }

  function playerPos() {
    return state.currentVehicle?.pos ?? state.player.pos;
  }

  function nearestPedestrian(maxDist, maxAngleCos = 0.35) {
    const peds = traffic?.pedestrians ?? [];
    const pos = playerPos();
    const fwd = forward();
    let best = null;
    let bestDist = maxDist;
    for (const ped of peds) {
      const pp = ped.group?.position;
      if (!pp) continue;
      const dx = pp.x - pos.x;
      const dz = pp.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bestDist || d < 0.05) continue;
      const dot = (dx * fwd.x + dz * fwd.z) / d;
      if (dot < maxAngleCos) continue;
      bestDist = d;
      best = ped;
    }
    return best;
  }

  function fleePed(ped) {
    if (!ped) return;
    const pos = playerPos();
    const pp = ped.group.position;
    const dx = pp.x - pos.x;
    const dz = pp.z - pos.z;
    const len = Math.hypot(dx, dz) || 1;
    ped.fleeX = dx / len;
    ped.fleeZ = dz / len;
    ped.fleeTimer = 4;
  }

  function punch() {
    if (punchCooldown > 0 || !state.player.onFoot) return false;
    punchCooldown = PUNCH_COOLDOWN;
    const target = nearestPedestrian(PUNCH_RANGE);
    if (target) {
      fleePed(target);
      police?.reportCrime?.('assault', playerPos(), 30);
    }
    return Boolean(target);
  }

  function shoot() {
    if (shotCooldown > 0 || !state.player.onFoot) return false;
    shotCooldown = SHOT_COOLDOWN;
    const pos = playerPos();
    const fwd = forward();
    const from = new THREE.Vector3(pos.x, 1.4, pos.z);
    const to = new THREE.Vector3(pos.x + fwd.x * SHOT_RANGE, 1.4, pos.z + fwd.z * SHOT_RANGE);
    const positions = flash.geometry.getAttribute('position');
    positions.setXYZ(0, from.x, from.y, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
    flash.material.opacity = 0.9;
    flash.visible = true;
    flashTimer = 0.09;
    const target = nearestPedestrian(SHOT_RANGE, 0.92);
    if (target) fleePed(target);
    police?.reportCrime?.('weaponFire', pos, 45);
    return true;
  }

  function damagePlayer(amount, source) {
    const dmg = Math.max(0, Number(amount) || 0);
    state.player.health = THREE.MathUtils.clamp(state.player.health - dmg, 0, 100);
    if (state.player.health <= 0 && state.screen === 'play') {
      state.screen = 'over';
    }
    return state.player.health;
  }

  function getWeaponState() {
    return {
      weapon: 'fists',
      punchCooldown: Math.max(0, punchCooldown),
      shotCooldown: Math.max(0, shotCooldown),
      canPunch: punchCooldown <= 0 && state.player.onFoot,
      canShoot: shotCooldown <= 0 && state.player.onFoot,
    };
  }

  function update(dt, input) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    punchCooldown = Math.max(0, punchCooldown - dt);
    shotCooldown = Math.max(0, shotCooldown - dt);
    if (flashTimer > 0) {
      flashTimer -= dt;
      if (flashTimer <= 0) {
        flash.visible = false;
        flash.material.opacity = 0;
      }
    }
    if (state.paused || state.screen !== 'play') return;
    const keys = input?.keys ?? new Set();
    const fPressed = keys.has('KeyF');
    if (fPressed && !wasFPressed) punch();
    wasFPressed = fPressed;
    const mouseDown = (input?.mouseButtons ?? new Set()).has(0);
    if (mouseDown && !wasMouseDown) shoot();
    wasMouseDown = mouseDown;
  }

  return {
    update,
    punch,
    shoot,
    damagePlayer,
    getWeaponState,
  };
}
