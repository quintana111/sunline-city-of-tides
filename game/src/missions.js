// Deterministic mission flow and staged objective beacons for Sunline: City of Tides.
import * as THREE from 'three';

export function createMissions(scene, world, state, vehicleManager, police) {
  let beacon = null;
  let missionClearT = 0;
  let bobClock = 0;
  let previousE = false;
  let activeDefinition = null;

  const definitions = {
    'first-light': {
      title: 'First Light Run',
      pickup: 'parcelPickup',
      dropoff: 'cafeDropoff',
      time: 150,
      reward: 350,
      startText: 'A sealed parcel needs a quick ride. Café Lumen is waiting.',
      pickupText: 'Good. Take it to Café Lumen, and keep it safe.',
      completeText: 'Delivered. You made that look easy.',
    },
    'harbour-receipt': {
      title: 'Harbour Receipt',
      pickup: 'marinaCrate',
      dropoff: 'workshopDropoff',
      time: 240,
      reward: 500,
      startText: 'There is a crate by the marina. Bring it to the workshop.',
      pickupText: 'Crate secured. The workshop is ready for you.',
      completeText: 'Delivered. That is one less thing to worry about.',
    },
    'wrong-turn': {
      title: 'Wrong Turn, Right Friend',
      pickup: 'mechanicPickup',
      dropoff: 'safehouse',
      time: 240,
      reward: 600,
      wantedOnStart: true,
      startText: 'A mechanic is stranded. I will keep an eye out for you.',
      pickupText: 'They are aboard. Head for the safehouse.',
      completeText: 'You got them home. Thank you for looking out.',
    },
    'last-ferry': {
      title: 'Last Ferry Window',
      pickup: null,
      dropoff: 'ferryDock',
      time: 200,
      reward: 800,
      startText: 'Our contact is with you now. Get to the ferry before it leaves.',
      pickupText: 'The contact is ready. Make for the ferry dock.',
      completeText: 'You made the crossing. We owe you one.',
    },
  };

  function pointInsideBuilding(x, z) {
    for (const b of world?.buildings || []) {
      if (Math.abs(x - b.x) <= (b.w || 0) * 0.5 &&
          Math.abs(z - b.z) <= (b.d || 0) * 0.5) return true;
    }
    return false;
  }

  function pointLabel(key) {
    return world?.missionPoints?.[key]?.label || key || '';
  }

  function resolvePoint(key, fallbackIndex = 0) {
    const source = key ? world?.missionPoints?.[key] : null;
    let p = source && Number.isFinite(source.x) && Number.isFinite(source.z)
      ? { x: source.x, z: source.z }
      : { x: fallbackIndex * 18, z: 0 };

    if (!pointInsideBuilding(p.x, p.z)) return p;
    for (let i = 1; i <= 16; i++) {
      const angle = (fallbackIndex + i) * Math.PI / 8;
      const candidate = {
        x: p.x + Math.sin(angle) * (12 + (i % 4) * 3),
        z: p.z - Math.cos(angle) * (12 + (i % 4) * 3),
      };
      if (!pointInsideBuilding(candidate.x, candidate.z)) return candidate;
    }
    return { x: fallbackIndex * 24, z: 24 };
  }

  function playerPosition() {
    const p = state.currentVehicle?.pos || state.player?.pos || { x: 0, z: 0 };
    return { x: Number(p.x) || 0, z: Number(p.z) || 0 };
  }

  function removeBeacon() {
    if (beacon && scene) scene.remove(beacon);
    beacon = null;
  }

  function moveBeacon(target) {
    if (!target || !scene) return;
    if (!beacon) {
      beacon = new THREE.Group();
      beacon.name = 'missionBeacon';

      const gold = new THREE.MeshStandardMaterial({
        color: 0xffc341,
        emissive: 0xffa21a,
        emissiveIntensity: 1.1,
        roughness: 0.38,
      });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 2.4, 12), gold);
      shaft.position.y = 1.2;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.15, 4), gold);
      tip.position.y = 2.95;
      beacon.add(shaft, tip);
      scene.add(beacon);
    }
    beacon.position.set(target.x, 0, target.z);
  }

  function markerFor(mission) {
    return mission.target ? { x: mission.target.x, z: mission.target.z } : null;
  }

  function setTarget(mission, point) {
    mission.target = { x: point.x, z: point.z };
    mission.marker = markerFor(mission);
    moveBeacon(mission.target);
  }

  function resetMission() {
    removeBeacon();
    missionClearT = 0;
    activeDefinition = null;
    state.mission = { id: null, title: '', objective: '', stage: 0 };
  }

  function startMission(id) {
    const def = definitions[id];
    if (!def) return false;
    if (state.mission?.stage > 0 && state.mission?.stage < 3) resetMission();
    else removeBeacon();

    activeDefinition = def;
    missionClearT = 0;
    bobClock = 0;

    const pickup = id === 'last-ferry'
      ? (() => {
          const p = playerPosition();
          const h = state.currentVehicle?.heading ?? state.player?.heading ?? 0;
          return { x: p.x + Math.sin(h) * 3, z: p.z - Math.cos(h) * 3 };
        })()
      : resolvePoint(def.pickup, Object.keys(definitions).indexOf(id) + 1);
    const dropoff = resolvePoint(def.dropoff, Object.keys(definitions).indexOf(id) + 5);

    const mission = {
      id,
      title: def.title,
      objective: id === 'last-ferry'
        ? `Reach ${pointLabel(def.dropoff)} before the ferry leaves`
        : `Pick up the parcel — ${pointLabel(def.pickup)}`,
      stage: 1,
      timeLeft: def.time,
      message: { speaker: 'Mara', text: def.startText },
      marker: null,
      toast: null,
      reward: def.reward,
      target: null,
      pickup,
      dropoff,
      failed: false,
    };
    state.mission = mission;
    setTarget(mission, pickup);
    if (def.wantedOnStart) police?.setWanted?.(1);
    return true;
  }

  function failMission(mission) {
    mission.failed = true;
    mission.objective = 'Failed — press E at the marker to retry';
    mission.message = {
      speaker: 'Mara',
      text: 'Too slow — the window closed. Come back when you are ready.',
    };
    mission.toast = null;
  }

  function completeMission(mission) {
    const def = activeDefinition;
    state.player.cash = (Number(state.player.cash) || 0) + (def?.reward || 0);
    mission.objective = 'Complete!';
    mission.stage = 3;
    mission.timeLeft = 0;
    mission.failed = false;
    mission.message = {
      speaker: 'Mara',
      text: def?.completeText || 'Delivered. You did good.',
    };
    mission.marker = null;
    mission.target = null;
    removeBeacon();
    missionClearT = 4;
  }

  function update(dt, input) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1);
    bobClock += dt;

    const keys = input?.keys || state.input?.keys;
    const eDown = !!keys?.has?.('KeyE');
    const ePressed = eDown && !previousE;
    previousE = eDown;

    const mission = state.mission;
    if (!mission || !mission.stage) return;

    if (mission.stage === 3) {
      missionClearT -= dt;
      if (missionClearT <= 0) resetMission();
      return;
    }

    if (mission.failed) {
      if (ePressed && mission.target &&
          Math.hypot(playerPosition().x - mission.target.x, playerPosition().z - mission.target.z) <= 8) {
        startMission(mission.id);
      }
      return;
    }

    mission.timeLeft = Math.max(0, mission.timeLeft - dt);
    if (mission.timeLeft <= 0) {
      failMission(mission);
      return;
    }

    if (mission.target && beacon) {
      beacon.position.y = 0.3 + 0.35 * Math.sin(bobClock * 2);
    }

    const p = playerPosition();
    if (!mission.target || Math.hypot(p.x - mission.target.x, p.z - mission.target.z) > 6) return;

    if (mission.stage === 1) {
      mission.stage = 2;
      const def = activeDefinition;
      mission.objective = `Deliver to ${pointLabel(def?.dropoff)}`;
      mission.message = { speaker: 'Mara', text: def?.pickupText || 'Good. Take it to the destination.' };
      setTarget(mission, mission.dropoff);
    } else {
      completeMission(mission);
    }
  }

  function getMissionState() {
    const m = state.mission;
    if (!m) return { id: null, title: '', objective: '', stage: 0, timeLeft: 0, target: null, reward: 0 };
    return {
      id: m.id || null,
      title: m.title || '',
      objective: m.objective || '',
      stage: m.stage || 0,
      timeLeft: m.timeLeft || 0,
      target: m.target ? { x: m.target.x, z: m.target.z } : null,
      reward: m.reward || 0,
    };
  }

  return { update, startMission, resetMission, getMissionState };
}
