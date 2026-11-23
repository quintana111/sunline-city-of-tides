// Missions for Sunline: City of Tides — 4 jobs from Mara the dispatcher.
// Forward = (sin h, 0, -cos h). No Math.random(). E-to-start wins over
// vehicle E-to-enter: the actor position is the driven car when driving.
import * as THREE from 'three';

export function createMissions(scene, world, state, vehicleManager, police) {
  const missionDefs = {
    'first-light': {
      id: 'first-light', title: 'First Light Run', reward: 350, timeLimit: 150,
      briefing: 'A parcel needs a quick ride to Café Lumen. Keep it smooth, Nia.',
      stages: [
        { point: 'parcelPickup', objective: 'Pick up the parcel — Parcel Pickup', label: 'Parcel Pickup' },
        { point: 'cafeDropoff', objective: 'Deliver the parcel to Café Lumen', label: 'Café Lumen' },
      ],
    },
    'harbour-receipt': {
      id: 'harbour-receipt', title: 'Harbour Receipt', reward: 500, timeLimit: 240,
      briefing: 'A crate is waiting at the marina. Take it to the Foundry Workshop.',
      stages: [
        { point: 'marinaCrate', objective: 'Collect the crate — Marina Crate', label: 'Marina Crate' },
        { point: 'workshopDropoff', objective: 'Deliver the crate to the Foundry Workshop', label: 'Foundry Workshop' },
      ],
    },
    'wrong-turn': {
      id: 'wrong-turn', title: 'Wrong Turn, Right Friend', reward: 600, timeLimit: 240,
      briefing: 'A stranded mechanic needs a lift. The search is already underway.',
      stages: [
        { point: 'mechanicPickup', objective: 'Pick up the stranded mechanic — Civic Crescent', label: 'Civic Crescent' },
        { point: 'safehouse', objective: 'Drive the mechanic to the Safehouse', label: 'Safehouse' },
      ],
    },
    'last-ferry': {
      id: 'last-ferry', title: 'Last Ferry Window', reward: 800, timeLimit: 200,
      briefing: 'Bring the contact to the Ferry Dock before the last boarding.',
      stages: [
        { point: 'ferryDock', objective: 'Bring the contact to the Ferry Dock before the last boarding', label: 'Ferry Dock' },
      ],
    },
  };

  const emptyMission = () => ({ id: null, title: '', objective: '', stage: 0 });
  if (!state.mission) state.mission = emptyMission();

  const gold = new THREE.MeshStandardMaterial({
    color: 0xd49a21, emissive: 0xffb51b, emissiveIntensity: 1.25, metalness: 0.2, roughness: 0.38,
  });
  const goldDim = new THREE.MeshStandardMaterial({
    color: 0x9c701a, emissive: 0xffa800, emissiveIntensity: 0.65, metalness: 0.15, roughness: 0.45,
  });

  // Target beacon: kept compact (top ~3.5) so it never dominates the frame.
  const markerGroup = new THREE.Group();
  markerGroup.visible = false;
  markerGroup.name = 'mission-target-marker';
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 2.4, 16), gold);
  shaft.position.y = 1.2;
  markerGroup.add(shaft);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.15, 16), gold);
  cone.position.y = 2.95;
  markerGroup.add(cone);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.12, 8, 32), goldDim);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  markerGroup.add(ring);
  scene?.add?.(markerGroup);

  const startMarkers = [];
  for (const definition of Object.values(missionDefs)) {
    const point = world?.missionPoints?.[definition.stages[0].point];
    if (!point) continue;
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), goldDim);
    diamond.name = `mission-start-${definition.id}`;
    diamond.position.set(point.x, 1.35, point.z);
    diamond.rotation.y = Math.PI / 4;
    scene?.add?.(diamond);
    startMarkers.push(diamond);
  }

  let prevE = false;
  const safeDt = (dt) => Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.1);

  const targetFor = (definition, stage) => {
    const stageInfo = definition?.stages?.[stage];
    const point = stageInfo && world?.missionPoints?.[stageInfo.point];
    if (!stageInfo || !point) return null;
    return { x: point.x, z: point.z, label: point.label ?? stageInfo.label };
  };

  const syncMarkers = () => {
    const active = Boolean(state.mission?.id);
    markerGroup.visible = active && Boolean(state.mission?.target);
    if (markerGroup.visible) {
      markerGroup.position.set(state.mission.target.x, 0, state.mission.target.z);
    }
    for (const marker of startMarkers) marker.visible = !active;
  };

  const actorPosition = () => {
    const pos = state.currentVehicle?.pos ?? state.player?.pos;
    return {
      x: Number.isFinite(pos?.x) ? pos.x : 0,
      z: Number.isFinite(pos?.z) ? pos.z : 0,
    };
  };

  const setStage = (mission, stage, message) => {
    const definition = missionDefs[mission.id];
    const info = definition?.stages?.[stage];
    const target = targetFor(definition, stage);
    if (!info || !target) return false;
    mission.stage = stage;
    mission.objective = info.objective;
    mission.target = target;
    mission.marker = { x: target.x, z: target.z, label: target.label };
    mission.message = { speaker: 'Mara', text: message };
    mission.failed = false;
    syncMarkers();
    return true;
  };

  function startMission(id) {
    const definition = missionDefs[id];
    if (!definition) return false;
    const target = targetFor(definition, 0);
    if (!target) return false;
    state.mission = {
      id: definition.id,
      title: definition.title,
      objective: definition.stages[0].objective,
      stage: 0,
      timeLeft: definition.timeLimit,
      target,
      marker: { x: target.x, z: target.z, label: target.label },
      reward: definition.reward,
      message: { speaker: 'Mara', text: definition.briefing },
      failed: false,
    };
    syncMarkers();
    if (id === 'wrong-turn') police?.setWanted?.(1);
    return true;
  }

  function resetMission() {
    state.mission = emptyMission();
    syncMarkers();
  }

  function getMissionState() {
    const mission = state.mission ?? emptyMission();
    return {
      id: mission.id ?? null,
      title: mission.title ?? '',
      objective: mission.objective ?? '',
      stage: Number.isFinite(mission.stage) ? mission.stage : 0,
      timeLeft: Number.isFinite(mission.timeLeft) ? mission.timeLeft : null,
      target: mission.target
        ? { x: mission.target.x, z: mission.target.z, label: mission.target.label }
        : null,
      failed: Boolean(mission.failed),
    };
  }

  function update(dt, input) {
    const step = safeDt(dt);
    const keys = input?.keys ?? state?.input?.keys;
    const eDown = keys instanceof Set ? keys.has('KeyE') : Boolean(keys?.KeyE);
    const ePressed = eDown && !prevE;
    prevE = eDown;

    syncMarkers();
    if (state?.screen !== 'play') return;

    const mission = state.mission;
    const active = Boolean(mission?.id);
    const actor = actorPosition();

    if (!active) {
      if (ePressed) {
        for (const definition of Object.values(missionDefs)) {
          const target = targetFor(definition, 0);
          if (target && Math.hypot(actor.x - target.x, actor.z - target.z) <= 7 &&
              startMission(definition.id)) return;
        }
      }
      return;
    }

    if (mission.failed) {
      if (ePressed) startMission(mission.id);
      return;
    }

    mission.timeLeft = Math.max(0, (Number(mission.timeLeft) || 0) - step);
    if (mission.timeLeft <= 0) {
      mission.failed = true;
      mission.stage = -1;
      mission.message = { speaker: 'Mara', text: 'Out of time — press E to try again.' };
      syncMarkers();
      return;
    }

    const target = mission.target;
    if (!target || Math.hypot(actor.x - target.x, actor.z - target.z) > 6) return;

    const definition = missionDefs[mission.id];
    const nextStage = mission.stage + 1;
    if (definition && nextStage < definition.stages.length) {
      const next = definition.stages[nextStage];
      setStage(mission, nextStage, `Got it — now ${next.objective}.`);
      return;
    }

    const reward = Number(mission.reward) || 0;
    const title = mission.title;
    state.player.cash = (Number(state.player.cash) || 0) + reward;
    state.mission = emptyMission();
    state.mission.toast = `${title} complete — +$${reward}`;
    state.mission.message = { speaker: 'Mara', text: 'Clean run. The money is yours.' };
    syncMarkers();
  }

  syncMarkers();
  return { update, startMission, resetMission, getMissionState };
}
