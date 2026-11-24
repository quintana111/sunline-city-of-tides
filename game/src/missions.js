// missions.js — the four courier jobs of Sunline: City of Tides.
// Fresh implementation from design-r3.md section 7.
// E-to-start MUST WIN over E-to-enter a nearby vehicle: when update()
// consumes E to start a mission it sets state.input._eConsumed = true,
// which main.js honours before the vehicle layer runs.
import * as THREE from '../vendor/three.min.js';

const MARKER_RADIUS = 7;
const ARRIVE_RADIUS = 6;

export const MISSION_DEFS = {
  'first-light': {
    id: 'first-light', title: 'First Light Run', reward: 400, timeLimit: 150,
    pickupKey: 'parcelPickup', dropKey: 'beachCafe',
    pickupLabel: 'Palm Court', dropLabel: 'beachfront cafe',
    stage1: 'Pick up the sealed parcel in Palm Court',
    stage2: 'Deliver the parcel to the beachfront cafe',
    intro: 'First Light Run: a sealed parcel, Palm Court to the beachfront cafe. 150 seconds. Go.',
    pickupMsg: 'Parcel secured — get it to the beachfront cafe.',
  },
  'harbour-receipt': {
    id: 'harbour-receipt', title: 'Harbour Receipt', reward: 550, timeLimit: 180,
    pickupKey: 'marinaCrate', dropKey: 'foundryWorkshop',
    pickupLabel: 'Pelican Marina', dropLabel: 'Foundry Quay workshop',
    stage1: 'Collect the crate at Pelican Marina',
    stage2: 'Deliver the crate to the Foundry Quay workshop',
    intro: 'Harbour Receipt: a crate at the marina goes to a Foundry Quay workshop. Mind the witnesses.',
    pickupMsg: 'Crate loaded — Foundry Quay, quick and quiet.',
  },
  'wrong-turn': {
    id: 'wrong-turn', title: 'Wrong Turn, Right Friend', reward: 500, timeLimit: 240,
    pickupKey: 'mechanic', dropKey: 'safehouse',
    pickupLabel: 'Civic Crescent', dropLabel: 'Palm Court safehouse',
    stage1: 'Pick up the stranded mechanic near Civic Crescent',
    stage2: 'Deliver your friend to the Palm Court safehouse',
    intro: 'Wrong Turn, Right Friend: a mechanic is stranded near Civic Crescent — and the law is already looking.',
    pickupMsg: 'Mechanic aboard — lose the search, reach the safehouse.',
  },
  'last-ferry': {
    id: 'last-ferry', title: 'Last Ferry Window', reward: 650, timeLimit: 210,
    pickupKey: 'ferryContact', dropKey: 'marinaGate',
    pickupLabel: 'marina road', dropLabel: 'marina gate',
    stage1: 'Pick up your contact near the marina road',
    stage2: 'Bring your contact to the marina gate before the last ferry',
    intro: 'Last Ferry Window: get a contact to the marina gate before final boarding. No trouble, no heat.',
    pickupMsg: 'Contact aboard — the last ferry will not wait.',
  },
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function pointInsideBuilding(world, x, z, margin) {
  const list = world.colliders || [];
  for (const c of list) {
    const hw = (c.hw !== undefined ? c.hw : (c.w || 0) / 2) + margin;
    const hd = (c.hd !== undefined ? c.hd : (c.d || 0) / 2) + margin;
    if (Math.abs(x - c.x) < hw && Math.abs(z - c.z) < hd) return true;
  }
  return false;
}

// Nudge a point that fell inside a building (or off the map / onto the
// beach edge) to the nearest clear ground, scanning outward in rings.
export function resolvePoint(world, x, z) {
  const clear = (px, pz) => {
    if (px < -610 || px > 610 || pz < -610 || pz > 556) return false;
    return !pointInsideBuilding(world, px, pz, 2);
  };
  if (clear(x, z)) return { x, z };
  for (let r = 4; r <= 56; r += 4) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (clear(px, pz)) return { x: Math.round(px * 10) / 10, z: Math.round(pz * 10) / 10 };
    }
  }
  return { x, z };
}

function readPoint(world, key) {
  const mp = world.missionPoints || {};
  const p = mp[key];
  if (!p) return null;
  const x = p.x !== undefined ? p.x : 0;
  const z = p.z !== undefined ? p.z : (p.y !== undefined ? p.y : 0);
  return { x, z };
}

function beaconMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, fog: false });
}

export function createMissions(scene, world, state, vehicleManager, police) {
  const defs = MISSION_DEFS;
  const active = { id: null, def: null, stage: 0, timeLeft: 0, target: null, pickup: null, drop: null };
  const completed = [];
  let lastE = false;
  let lastEPressed = false;
  let lastVehicle = null;
  let dialogueT = 0;

  // --- marker meshes -------------------------------------------------
  const beacon = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 9, 12, 1, true),
    beaconMaterial(0xffc93c, 0.45),
  );
  beam.position.y = 4.5;
  beacon.add(beam);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3.5, 32),
    beaconMaterial(0xffc93c, 0.85),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  beacon.add(ring);
  beacon.visible = false;
  scene.add(beacon);

  // Dim ground rings at every job start while free-roaming, so the player
  // can find work without opening anything.
  const idleMarkers = [];
  for (const id of Object.keys(defs)) {
    const raw = readPoint(world, defs[id].pickupKey);
    if (!raw) continue;
    const at = resolvePoint(world, raw.x, raw.z);
    const g = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 2.6, 8),
      beaconMaterial(0x7fd4c1, 0.7),
    );
    post.position.y = 1.3;
    g.add(post);
    const base = new THREE.Mesh(
      new THREE.RingGeometry(2.2, 3.0, 24),
      beaconMaterial(0x7fd4c1, 0.6),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.1;
    g.add(base);
    g.position.set(at.x, 0, at.z);
    g.userData.missionId = id;
    g.userData.point = at;
    scene.add(g);
    idleMarkers.push(g);
  }

  function say(text, ms) {
    state._dialogue = { text, until: Date.now() + (ms || 4500) };
  }

  function writeMission() {
    if (!active.def) {
      state.mission = { id: null, title: '', objective: '', stage: 0 };
      state._missionTimeLeft = 0;
      state._missionTarget = null;
    } else {
      state.mission = {
        id: active.def.id,
        title: active.def.title,
        objective: active.stage === 1 ? active.def.stage1 : active.def.stage2,
        stage: active.stage,
      };
      state._missionTimeLeft = Math.max(0, Math.ceil(active.timeLeft));
      state._missionTarget = active.target ? { x: active.target.x, z: active.target.z } : null;
    }
  }

  function refreshMarkers() {
    beacon.visible = !!active.def;
    if (active.def && active.target) {
      beacon.position.set(active.target.x, 0, active.target.z);
    }
    for (const g of idleMarkers) g.visible = !active.def;
  }

  function startMission(id) {
    const def = defs[id];
    if (!def || active.def) return false;
    const rawPickup = readPoint(world, def.pickupKey);
    const rawDrop = readPoint(world, def.dropKey);
    if (!rawPickup || !rawDrop) return false;
    active.def = def;
    active.id = id;
    active.stage = 1;
    active.timeLeft = def.timeLimit;
    active.pickup = resolvePoint(world, rawPickup.x, rawPickup.z);
    active.drop = resolvePoint(world, rawDrop.x, rawDrop.z);
    active.target = active.pickup;
    // Wrong Turn starts with a low-level search already in progress.
    if (id === 'wrong-turn' && police && police.setWanted) police.setWanted(1);
    writeMission();
    refreshMarkers();
    say(def.intro, 5000);
    return true;
  }

  function resetMission() {
    active.def = null;
    active.id = null;
    active.stage = 0;
    active.timeLeft = 0;
    active.target = null;
    active.pickup = null;
    active.drop = null;
    writeMission();
    refreshMarkers();
    state._missionPrompt = '';
    return true;
  }

  function completeMission() {
    const def = active.def;
    state.player.cash += def.reward;
    completed.push(def.id);
    say(`Job done — ${def.title} paid $${def.reward}.`, 5000);
    resetMission();
  }

  function failMission(reason) {
    say(reason || 'Job failed — the window closed. Free roam continues.', 5000);
    resetMission();
  }

  function nearestPickup() {
    const p = state.player.pos;
    let best = null;
    let bestD = Infinity;
    for (const g of idleMarkers) {
      const d = Math.hypot(p.x - g.userData.point.x, p.z - g.userData.point.z);
      if (d < bestD) { bestD = d; best = g; }
    }
    return bestD <= MARKER_RADIUS ? { marker: best, dist: bestD } : null;
  }

  function edgePressed(input) {
    if (!input) return false;
    const keys = input.keys;
    const held = keys && typeof keys.has === 'function' ? keys.has('KeyE') : false;
    const flag = input._ePressed === true && !lastEPressed;
    lastEPressed = input._ePressed === true;
    const edge = held && !lastE;
    lastE = held;
    return flag || edge;
  }

  function update(dt, input) {
    if (!dt || dt <= 0) dt = 0.016;
    dt = Math.min(dt, 0.05);
    const inp = input || state.input || {};
    if (state.screen !== 'play') { lastE = !!(inp.keys && inp.keys.has && inp.keys.has('KeyE')); return; }
    const pressed = edgePressed(inp);

    // Witnessed theft: taking a car in view of a pedestrian is a crime.
    // (The police hook covers the same event; this path only fires when a
    // mission is running and the theft happens right in front of someone.)
    const cur = state.currentVehicle || null;
    if (cur && cur !== lastVehicle && police && police.reportCrime) {
      let witness = false;
      try {
        const g = globalThis.__game;
        const peds = g && g.traffic ? g.traffic.peds : [];
        for (const ped of peds || []) {
          const px = ped.x !== undefined ? ped.x : (ped.mesh ? ped.mesh.position.x : 0);
          const pz = ped.z !== undefined ? ped.z : (ped.mesh ? ped.mesh.position.z : 0);
          if (Math.hypot(px - state.player.pos.x, pz - state.player.pos.z) <= 25) { witness = true; break; }
        }
      } catch (e) { /* no live game */ }
      if (witness) police.reportCrime('vehicleTheft', { x: state.player.pos.x, z: state.player.pos.z }, 25);
    }
    lastVehicle = cur;

    if (!active.def) {
      const near = nearestPickup();
      if (near) {
        const def = defs[near.marker.userData.missionId];
        state._missionPrompt = `E — start job: ${def.title}`;
        if (pressed) {
          if (startMission(def.id)) {
            // E-to-start WINS over E-to-enter: tell the vehicle layer
            // this keypress is already spent.
            inp._eConsumed = true;
            if (state.input) state.input._eConsumed = true;
            state._missionPrompt = '';
          }
        }
      } else {
        state._missionPrompt = '';
      }
      return;
    }

    // Active mission: countdown, then arrival checks.
    active.timeLeft -= dt;
    state._missionTimeLeft = Math.max(0, Math.ceil(active.timeLeft));
    if (active.timeLeft <= 0) {
      failMission('Time up — the job fell through. The client moved on.');
      return;
    }
    const p = state.player.pos;
    const t = active.target;
    if (t && Math.hypot(p.x - t.x, p.z - t.z) <= ARRIVE_RADIUS) {
      if (active.stage === 1) {
        active.stage = 2;
        active.target = active.drop;
        writeMission();
        refreshMarkers();
        say(active.def.pickupMsg, 4500);
      } else if (active.stage === 2) {
        completeMission();
        return;
      }
    }
    // Keep the beacon gently visible from afar.
    if (beacon.visible) {
      dialogueT += dt;
      const s = 1 + Math.sin(dialogueT * 2.4) * 0.08;
      beacon.scale.set(s, 1, s);
    }
  }

  function getMissionState() {
    return {
      active: !!active.def,
      id: active.def ? active.def.id : null,
      title: active.def ? active.def.title : '',
      stage: active.stage,
      timeLeft: active.def ? Math.max(0, Math.ceil(active.timeLeft)) : 0,
      target: active.target ? { x: active.target.x, z: active.target.z } : null,
      pickup: active.pickup ? { x: active.pickup.x, z: active.pickup.z } : null,
      drop: active.drop ? { x: active.drop.x, z: active.drop.z } : null,
      completed: completed.slice(),
    };
  }

  writeMission();
  refreshMarkers();
  return {
    update, startMission, resetMission, getMissionState,
    defs, resolvePoint: (x, z) => resolvePoint(world, x, z),
    beacon, idleMarkers,
  };
}
