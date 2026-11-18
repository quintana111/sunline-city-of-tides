// Simple on-foot combat for Sunline: City of Tides. Punch (F) and hitscan
// shooting (left mouse). Pedestrians flee or are knocked down; public violence
// is reported to the police. Effect timers use accumulated dt, never wall clock.
import * as THREE from 'three';

export function createCombat(scene, world, state, police, traffic) {
  const pedHealth = new WeakMap();
  const pedDownTime = new WeakMap();

  let punchCooldown = 0;
  let shootCooldown = 0;
  let swingT = 0;
  let tracerT = 0;
  let wasFPressed = false;
  let wasMousePressed = false;

  const swing = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.035, 0.42),
    new THREE.MeshBasicMaterial({
      color: 0xffe3a1,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  );
  swing.visible = false;
  if (scene) scene.add(swing);

  const tracerGeometry = new THREE.BufferGeometry();
  tracerGeometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const tracer = new THREE.Line(
    tracerGeometry,
    new THREE.LineBasicMaterial({ color: 0xffdf65, transparent: true, opacity: 0.78 }),
  );
  tracer.visible = false;
  if (scene) scene.add(tracer);

  const muzzleFlash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.12),
    new THREE.MeshBasicMaterial({
      color: 0xffe56b,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  muzzleFlash.visible = false;
  if (scene) scene.add(muzzleFlash);

  function playerPosition() {
    return state.player?.pos ?? { x: 0, y: 0, z: 0 };
  }

  function playerForward() {
    const h = state.player?.heading ?? 0;
    return { x: Math.sin(h), y: 0, z: -Math.cos(h) };
  }

  function pedPosition(ped) {
    const p = ped?.group?.position;
    if (p) return p;
    return ped?.pos ?? { x: 0, y: 0, z: 0 };
  }

  function reportCrime(kind, radius) {
    const p = playerPosition();
    police?.reportCrime?.(kind, { x: p.x, y: p.y ?? 0, z: p.z }, radius);
  }

  function setPedFlee(ped) {
    const p = pedPosition(ped);
    const player = playerPosition();
    let dx = p.x - player.x;
    let dz = p.z - player.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    ped.fleeTimer = 4;
    ped.fleeX = dx;
    ped.fleeZ = dz;
  }

  function hurtPed(ped, amount) {
    if (!ped || pedDownTime.has(ped)) return;
    const hp = (pedHealth.get(ped) ?? 100) - amount;
    pedHealth.set(ped, hp);
    setPedFlee(ped);
    if (hp <= 0) {
      pedDownTime.set(ped, 5);
      if (ped.group) ped.group.rotation.x = -Math.PI / 2;
    }
  }

  function updatePedRecovery(dt) {
    for (const ped of traffic?.pedestrians ?? []) {
      if (!ped || !pedDownTime.has(ped)) continue;
      const remaining = pedDownTime.get(ped) - dt;
      if (remaining <= 0) {
        pedDownTime.delete(ped);
        pedHealth.set(ped, 100);
        if (ped.group) ped.group.rotation.x = 0;
      } else {
        pedDownTime.set(ped, remaining);
      }
    }
  }

  function punch() {
    const player = playerPosition();
    const forward = playerForward();
    let nearest = null;
    let nearestDistance = Infinity;
    let nearestType = '';

    for (const ped of traffic?.pedestrians ?? []) {
      if (!ped || pedDownTime.has(ped)) continue;
      const p = pedPosition(ped);
      const dx = p.x - player.x;
      const dz = p.z - player.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 2.2 || distance === 0) continue;
      if ((forward.x * dx + forward.z * dz) / distance <= 0.5) continue;
      if (distance < nearestDistance) {
        nearest = ped;
        nearestDistance = distance;
        nearestType = 'ped';
      }
    }

    for (const car of traffic?.cars ?? []) {
      const p = car?.group?.position;
      if (!p) continue;
      const dx = p.x - player.x;
      const dz = p.z - player.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 2.2 || distance === 0) continue;
      if ((forward.x * dx + forward.z * dz) / distance <= 0.5) continue;
      if (distance < nearestDistance) {
        nearest = car;
        nearestDistance = distance;
        nearestType = 'car';
      }
    }

    swingT = 0.12;
    if (nearestType === 'ped') {
      hurtPed(nearest, 34);
      reportCrime('assault', 25);
    } else if (nearestType === 'car') {
      nearest.group.position.x += forward.x * 0.4;
      nearest.group.position.z += forward.z * 0.4;
      nearest.speed = 0;
      reportCrime('propertyDamage', 20);
    }
  }

  function shoot() {
    const player = playerPosition();
    const heading = state.player?.heading ?? 0;
    const origin = new THREE.Vector3(player.x, (player.y ?? 0) + 1.4, player.z);
    const direction = new THREE.Vector3(Math.sin(heading), -0.055, -Math.cos(heading)).normalize();
    let nearestPed = null;
    let nearestT = Infinity;

    for (const ped of traffic?.pedestrians ?? []) {
      if (!ped || pedDownTime.has(ped)) continue;
      const p = pedPosition(ped);
      const target = new THREE.Vector3(p.x, (p.y ?? 0) + 0.8, p.z);
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const dz = target.z - origin.z;
      const horizontalForward = Math.sin(heading) * dx - Math.cos(heading) * dz;
      if (horizontalForward <= 0) continue;
      const t = dx * direction.x + dy * direction.y + dz * direction.z;
      if (t <= 0 || t > 30) continue;
      const perpendicular = Math.hypot(
        dx - direction.x * t,
        dy - direction.y * t,
        dz - direction.z * t,
      );
      if (perpendicular < 1.2 && t < nearestT) {
        nearestPed = ped;
        nearestT = t;
      }
    }

    const end = origin.clone().addScaledVector(direction, nearestPed ? nearestT : 30);
    if (nearestPed) {
      hurtPed(nearestPed, 50);
    }
    reportCrime('weaponFire', 40);

    tracer.geometry.dispose();
    tracer.geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    tracerT = 0.12;
    tracer.visible = true;

    muzzleFlash.position.copy(origin).addScaledVector(direction, 0.22);
    muzzleFlash.rotation.set(0, -heading, 0);
    muzzleFlash.visible = true;
  }

  function updateEffects(dt) {
    swingT = Math.max(0, swingT - dt);
    if (swingT > 0) {
      const p = playerPosition();
      const f = playerForward();
      swing.position.set(p.x + f.x * 0.9, (p.y ?? 0) + 0.95, p.z + f.z * 0.9);
      swing.rotation.y = -(state.player?.heading ?? 0);
      swing.visible = true;
    } else {
      swing.visible = false;
    }

    tracerT = Math.max(0, tracerT - dt);
    if (tracerT <= 0) {
      tracer.visible = false;
      muzzleFlash.visible = false;
    }
  }

  function damagePlayer(amount, source) {
    const player = state.player;
    if (!player) return 0;
    player.health = THREE.MathUtils.clamp((player.health ?? 100) - amount, 0, 100);
    if (player.health <= 0) state.screen = 'over';
    return player.health;
  }

  function update(dt, input) {
    dt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    punchCooldown = Math.max(0, punchCooldown - dt);
    shootCooldown = Math.max(0, shootCooldown - dt);
    updatePedRecovery(dt);
    updateEffects(dt);

    const keys = state.input?.keys ?? input?.keys;
    const mouseButtons = state.input?.mouseButtons ?? input?.mouseButtons;
    const fPressed = !!keys?.has?.('KeyF');
    const mousePressed = !!mouseButtons?.has?.(0);
    const onFoot = !!state.player?.onFoot && !state.currentVehicle;

    if (onFoot && fPressed && !wasFPressed && punchCooldown <= 0) {
      punch();
      punchCooldown = 0.6;
    }
    if (onFoot && mousePressed && !wasMousePressed && shootCooldown <= 0) {
      shoot();
      shootCooldown = 0.35;
    }

    wasFPressed = fPressed;
    wasMousePressed = mousePressed;
  }

  return {
    update,
    damagePlayer,
    getWeaponState() {
      return {
        weapon: 'fists',
        punchCooldown,
        shootCooldown,
        canShoot: shootCooldown <= 0,
      };
    },
  };
}
