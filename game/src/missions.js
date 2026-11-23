// Missions (design §9). Written fresh 2026-11-24 (Builder B).
// One active mission at a time; E to start at a marker, timers, cash
// rewards, retry/abandon on failure. Markers use world.missionPoints.
import * as THREE from 'three';

const MISSIONS = [
  {
    id: 'first-light',
    title: 'First Light Run',
    startKey: 'parcelPickup',
    destKey: 'cafeDropoff',
    time: 240,
    reward: 300,
    pickupLabel: 'Pick up the sealed parcel',
    deliverLabel: 'Deliver the parcel to Café Lumen on Sunwash Beach',
  },
  {
    id: 'harbour-receipt',
    title: 'Harbour Receipt',
    startKey: 'marinaCrate',
    destKey: 'workshopDropoff',
    time: 300,
    reward: 400,
    pickupLabel: 'Collect the numbered crate at Pelican Marina',
    deliverLabel: 'Drop the crate at the Foundry Quay workshop',
  },
  {
    id: 'wrong-turn',
    title: 'Wrong Turn, Right Friend',
    startKey: 'mechanicPickup',
    destKey: 'safehouse',
    time: 300,
    reward: 450,
    pickupLabel: 'Pick up the stranded mechanic near Civic Crescent',
    deliverLabel: 'Get the mechanic to the Palm Court safehouse',
    onStart: (police) => police?.setWanted?.(1),
  },
  {
    id: 'last-ferry',
    title: 'Last Ferry Window',
    startKey: 'cafeDropoff',
    destKey: 'ferryDock',
    time: 240,
    reward: 500,
    pickupLabel: 'Meet the contact at Café Lumen',
    deliverLabel: 'Bring the contact to the marina before the last ferry',
  },
];

function beaconMaterial(color, emissive) {
  return new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 1.1, roughness: 0.38 });
}

export function createMissions(scene, world, state, vehicleManager, police) {
  const points = world.missionPoints ?? {};
  let active = null; // { def, stage, timeLeft, target }
  let wasEPressed = false;
  let message = '';
  let messageTimer = 0;

  // Tall gold beacon at the current objective; small markers at starts.
  const beacon = new THREE.Group();
  const beaconPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.35, 2.6, 12),
    beaconMaterial(0xffc341, 0xffa21a),
  );
  beaconPole.position.set(0.9, 1.3, -0.9);
  const beaconCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 1.1, 4),
    new THREE.MeshStandardMaterial({ color: 0xffd15a, emissive: 0x9f5e0c, emissiveIntensity: 0.8 }),
  );
  beaconCone.position.set(0.9, 3.2, -0.9);
  beacon.add(beaconPole, beaconCone);
  // A sealed parcel / crate at the marker base, front and centre, so the
  // objective reads as a pickup — sized to the character (waist-high),
  // with the thin pole offset behind it.
  const parcel = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 1.2, 1.3),
    new THREE.MeshStandardMaterial({ color: 0xc98f3d, roughness: 0.8 }),
  );
  parcel.position.y = 0.6;
  const parcelTape = new THREE.Mesh(
    new THREE.BoxGeometry(1.64, 1.22, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x8a5a1a, roughness: 0.8 }),
  );
  parcelTape.position.y = 0.6;
  const parcelTape2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 1.22, 1.34),
    new THREE.MeshStandardMaterial({ color: 0x8a5a1a, roughness: 0.8 }),
  );
  parcelTape2.position.y = 0.6;
  beacon.add(parcel, parcelTape, parcelTape2);
  beacon.visible = false;
  scene.add(beacon);

  const startMarkers = [];
  for (const def of MISSIONS) {
    const p = points[def.startKey];
    if (!p) continue;
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 1.6, 4),
      new THREE.MeshStandardMaterial({ color: 0xffd15a, emissive: 0x8a5a00, emissiveIntensity: 0.7 }),
    );
    marker.position.set(p.x, 3.4, p.z);
    marker.rotation.x = Math.PI;
    scene.add(marker);
    startMarkers.push(marker);
  }

  function playerPos() {
    return state.currentVehicle?.pos ?? state.player.pos;
  }

  function setMissionState(id, title, objective, stage) {
    state.mission = { id, title, objective, stage };
  }

  function moveBeaconTo(point) {
    if (!point) { beacon.visible = false; return; }
    beacon.position.set(point.x, 0, point.z);
    beacon.visible = true;
  }

  function startMission(id) {
    const def = MISSIONS.find((m) => m.id === id);
    if (!def) return false;
    const start = points[def.startKey];
    const dest = points[def.destKey];
    if (!start || !dest) return false;
    active = { def, stage: 0, timeLeft: def.time, target: start };
    setMissionState(def.id, def.title, def.pickupLabel, 0);
    moveBeaconTo(start);
    message = `${def.title} started — ${def.pickupLabel}`;
    messageTimer = 4;
    try { def.onStart?.(police); } catch { /* mission flavour only */ }
    return true;
  }

  function completeMission() {
    if (!active) return;
    state.player.cash = Math.max(0, (state.player.cash || 0) + active.def.reward);
    message = `${active.def.title} complete — +$${active.def.reward}`;
    messageTimer = 5;
    // Clear the mission id so a new job can start; keep the Done banner.
    setMissionState(null, active.def.title, `Done — +$${active.def.reward}`, 2);
    active = null;
    moveBeaconTo(null);
  }

  function failMission(reason) {
    if (!active) return;
    const def = active.def;
    message = `${def.title} failed — ${reason}. Return to the marker to retry.`;
    messageTimer = 6;
    setMissionState(def.id, def.title, 'Failed — press E at the marker to retry', -1);
    active = null;
    moveBeaconTo(null);
  }

  function resetMission() {
    active = null;
    message = '';
    messageTimer = 0;
    setMissionState(null, '', '', 0);
    moveBeaconTo(null);
  }

  function abandonMission() {
    if (!active && state.mission?.stage !== -1) return false;
    resetMission();
    message = 'Mission abandoned.';
    messageTimer = 3;
    return true;
  }

  function getMissionState() {
    return {
      id: state.mission?.id ?? null,
      title: state.mission?.title ?? '',
      objective: state.mission?.objective ?? '',
      stage: state.mission?.stage ?? 0,
      timeLeft: active ? Math.max(0, Math.ceil(active.timeLeft)) : null,
      reward: active?.def.reward ?? null,
      message,
      active: Boolean(active),
    };
  }

  function update(dt, input) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (messageTimer > 0) messageTimer = Math.max(0, messageTimer - dt);
    if (state.paused || state.screen !== 'play') return;
    const keys = input?.keys ?? new Set();
    const ePressed = keys.has('KeyE');
    const eJust = ePressed && !wasEPressed;
    wasEPressed = ePressed;

    // Animate the beacon cone (bob + slow spin) while visible.
    if (beacon.visible) {
      beaconCone.position.y = 3.2 + Math.sin(performance.now() * 0.002) * 0.25;
      beacon.rotation.y += dt * 0.8;
    }

    const pos = playerPos();

    if (active) {
      active.timeLeft -= dt;
      const target = active.target;
      const dist = Math.hypot(pos.x - target.x, pos.z - target.z);
      if (active.timeLeft <= 0) {
        failMission('time ran out');
        return;
      }
      if (dist < 7) {
        if (active.stage === 0) {
          active.stage = 1;
          active.target = points[active.def.destKey];
          setMissionState(active.def.id, active.def.title, active.def.deliverLabel, 1);
          moveBeaconTo(active.target);
          message = active.def.deliverLabel;
          messageTimer = 4;
        } else {
          completeMission();
        }
      }
      return;
    }

    // No active mission: E near a start marker starts it; E on a failed
    // mission retries it. Q abandons a failed mission entry.
    if (state.mission?.stage === -1 && keys.has('KeyQ')) {
      abandonMission();
      return;
    }
    if (!eJust || !state.player.onFoot) return;
    for (const def of MISSIONS) {
      const start = points[def.startKey];
      if (!start) continue;
      const failedHere = state.mission?.stage === -1 && state.mission?.id === def.id;
      const freeHere = !state.mission?.id;
      if (!failedHere && !freeHere) continue;
      if (Math.hypot(pos.x - start.x, pos.z - start.z) < 8) {
        startMission(def.id);
        return;
      }
    }
  }

  return {
    update,
    startMission,
    resetMission,
    abandonMission,
    getMissionState,
    get active() { return active; },
    get message() { return message; },
    missions: MISSIONS.map((m) => ({ id: m.id, title: m.title, reward: m.reward, time: m.time })),
  };
}
