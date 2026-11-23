// Combat for Sunline: City of Tides — punch (F) + hitscan shoot (LMB).
// Forward = (sin h, 0, -cos h). No Math.random(). Effects are disposed.
import * as THREE from 'three';

export function createCombat(scene, world, state, police, traffic) {
  const pedestrianHp = new Map();
  const downTimers = new Map();
  const effects = [];

  let punchCooldown = 0;
  let shootCooldown = 0;
  let previousPunch = false;
  let previousShoot = false;

  const safeDt = (dt) => Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.1);

  function pedestrians() {
    if (traffic && Array.isArray(traffic.pedestrians)) return traffic.pedestrians;
    if (typeof window !== 'undefined') {
      const fallback = window.__game?.traffic?.pedestrians;
      if (Array.isArray(fallback)) return fallback;
    }
    return [];
  }

  function playerPosition() {
    const pos = state?.player?.pos ?? {};
    return new THREE.Vector3(
      Number.isFinite(pos.x) ? pos.x : 0,
      Number.isFinite(pos.y) ? pos.y : 0,
      Number.isFinite(pos.z) ? pos.z : 0,
    );
  }

  function playerHeading() {
    return Number.isFinite(state?.player?.heading) ? state.player.heading : 0;
  }

  function forwardVector() {
    const heading = playerHeading();
    return new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
  }

  function addEffect(object, life) {
    if (!scene?.add || !object) return;
    scene.add(object);
    effects.push({ object, life });
  }

  function removeEffect(effect) {
    scene?.remove?.(effect.object);
    effect.object.geometry?.dispose?.();
    const material = effect.object.material;
    if (Array.isArray(material)) {
      for (const item of material) item?.dispose?.();
    } else {
      material?.dispose?.();
    }
  }

  function tickEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      effects[i].life -= dt;
      if (effects[i].life <= 0) {
        removeEffect(effects[i]);
        effects.splice(i, 1);
      }
    }
  }

  function tickDowned(dt) {
    for (const [ped, timer] of downTimers) {
      const next = timer - dt;
      if (next <= 0) {
        downTimers.delete(ped);
        pedestrianHp.set(ped, 100);
        if (ped?.group) ped.group.rotation.x = 0;
        if (ped && Number.isFinite(ped.fleeTimer)) ped.fleeTimer = Math.max(ped.fleeTimer, 4);
      } else {
        downTimers.set(ped, next);
      }
    }
  }

  function makePunchEffect() {
    const position = playerPosition();
    const forward = forwardVector();
    const heading = playerHeading();
    const geometry = new THREE.BoxGeometry(0.9, 0.035, 0.32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffe7a3, transparent: true, opacity: 0.58, depthWrite: false,
    });
    const arc = new THREE.Mesh(geometry, material);
    arc.position.set(position.x + forward.x * 1.35, position.y + 1.05, position.z + forward.z * 1.35);
    arc.rotation.y = -heading;
    addEffect(arc, 0.15);
  }

  function getPedestrians() {
    return pedestrians().filter((ped) => ped?.group?.position);
  }

  function isDown(ped) {
    return downTimers.has(ped);
  }

  function damagePedestrian(ped, amount) {
    if (!ped || isDown(ped)) return;
    const hp = pedestrianHp.has(ped) ? pedestrianHp.get(ped) : 100;
    const nextHp = hp - amount;
    pedestrianHp.set(ped, nextHp);
    const forward = forwardVector();
    // Small shove: a full 1.5-unit knockback pushes the ped out of the
    // 2.2-unit punch range, so repeated punches could never knock one down.
    ped.group.position.x += forward.x * 0.3;
    ped.group.position.z += forward.z * 0.3;
    if (nextHp <= 0) {
      downTimers.set(ped, 4);
      ped.group.rotation.x = -Math.PI / 2;
      ped.fleeTimer = 4;
    }
  }

  function findPunchTarget(position, forward) {
    let nearest = null;
    let nearestDistance = Infinity;
    const minDot = Math.cos((100 * Math.PI) / 360);
    for (const ped of getPedestrians()) {
      if (isDown(ped)) continue;
      const pedPosition = ped.group.position;
      const dx = pedPosition.x - position.x;
      const dz = pedPosition.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 2.2 || distance <= 0) continue;
      const dot = (dx * forward.x + dz * forward.z) / distance;
      if (dot < minDot || distance >= nearestDistance) continue;
      nearest = ped;
      nearestDistance = distance;
    }
    return nearest;
  }

  function shoot() {
    const position = playerPosition();
    const forward = forwardVector();
    const muzzle = new THREE.Vector3(
      position.x + forward.x * 0.35,
      position.y + 1.4,
      position.z + forward.z * 0.35,
    );
    const maxRange = 40;
    let hitPed = null;
    let hitDistance = maxRange;

    for (const ped of getPedestrians()) {
      if (isDown(ped)) continue;
      const p = ped.group.position;
      const target = new THREE.Vector3(p.x, p.y + 1, p.z);
      const offset = target.sub(muzzle);
      const along = offset.dot(forward);
      if (along < 0 || along > maxRange) continue;
      const closest = muzzle.clone().addScaledVector(forward, along);
      const perpendicular = closest.distanceTo(target);
      if (perpendicular <= 1.2 && along < hitDistance) {
        hitDistance = along;
        hitPed = ped;
      }
    }

    const end = muzzle.clone().addScaledVector(forward, hitDistance);
    if (hitPed) damagePedestrian(hitPed, 50);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([muzzle, end]);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffe4a3, transparent: true, opacity: 0.9 });
    addEffect(new THREE.Line(lineGeometry, lineMaterial), 0.06);

    const flashGeometry = new THREE.SphereGeometry(0.075, 8, 6);
    const flashMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd36a, emissive: 0xff8a1c, emissiveIntensity: 2, transparent: true, opacity: 0.95,
    });
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.copy(muzzle);
    addEffect(flash, 0.06);

    police?.reportCrime?.('weaponFire', position, 60);
  }

  function update(dt, input) {
    const step = safeDt(dt);
    const keys = input?.keys instanceof Set ? input.keys : state?.input?.keys;
    const buttons = input?.mouseButtons instanceof Set ? input.mouseButtons : state?.input?.mouseButtons;
    const punchHeld = keys instanceof Set && keys.has('KeyF');
    const shootHeld = buttons instanceof Set && buttons.has(0);
    const punchPressed = punchHeld && !previousPunch;
    previousPunch = punchHeld;
    previousShoot = shootHeld;

    if (state?.screen !== 'play' || state?.paused) return;

    punchCooldown = Math.max(0, punchCooldown - step);
    shootCooldown = Math.max(0, shootCooldown - step);
    tickEffects(step);
    tickDowned(step);

    if (state?.currentVehicle || state?.player?.onFoot === false) return;

    if (punchPressed && punchCooldown <= 0) {
      punchCooldown = 0.6;
      makePunchEffect();
      const position = playerPosition();
      const target = findPunchTarget(position, forwardVector());
      if (target) {
        damagePedestrian(target, 34);
        police?.reportCrime?.('assault', position, 40);
      }
    }

    if (shootHeld && shootCooldown <= 0) {
      shootCooldown = 0.35;
      shoot();
    }
  }

  function damagePlayer(amount, source) {
    if (state?.screen !== 'play') return state?.player?.health ?? 0;
    const current = Number.isFinite(state?.player?.health) ? state.player.health : 100;
    const damage = Number.isFinite(amount) ? amount : 0;
    const health = Math.min(100, Math.max(0, current - damage));
    state.player.health = health;
    if (health <= 0) state.screen = 'over';
    return health;
  }

  function getWeaponState() {
    const driving = !!state?.currentVehicle || state?.player?.onFoot === false;
    return {
      weapon: 'fists',
      punchCooldown,
      shootCooldown,
      canPunch: !driving && state?.screen === 'play' && !state?.paused && punchCooldown <= 0,
      canShoot: !driving && state?.screen === 'play' && !state?.paused && shootCooldown <= 0,
    };
  }

  return { update, damagePlayer, getWeaponState };
}
