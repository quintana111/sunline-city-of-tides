// Save / load for Sunline: City of Tides — versioned localStorage save,
// plain data only (never Three.js objects). loadGame(state, world) applies
// onto the passed state when one is given.
export const SAVE_KEY = 'sunline-save-v1';

const MISSION_INFO = {
  'first-light': { title: 'First Light Run', objective: 'Pick up the parcel — Parcel Pickup' },
  'harbour-receipt': { title: 'Harbour Receipt', objective: 'Collect the crate — Marina Crate' },
  'wrong-turn': { title: 'Wrong Turn, Right Friend', objective: 'Pick up the stranded mechanic — Civic Crescent' },
  'last-ferry': { title: 'Last Ferry Window', objective: 'Bring the contact to the Ferry Dock before the last boarding' },
};

function storage() {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function applyData(target, data) {
  if (!target || typeof target !== 'object') return;
  target.seed = data.seed;
  target.timeOfDay = data.timeOfDay;
  target.wanted = data.wanted;
  target.player = target.player && typeof target.player === 'object' ? target.player : {};
  target.player.pos = { ...data.player.pos };
  target.player.heading = data.player.heading;
  target.player.onFoot = data.player.onFoot;
  target.player.health = data.health;
  target.player.cash = data.cash;
  const info = data.mission.id ? MISSION_INFO[data.mission.id] : null;
  target.mission = {
    id: data.mission.id,
    stage: data.mission.stage,
    title: info ? info.title : '',
    objective: info ? info.objective : '',
  };
}

export function saveGame(state, world) {
  if (!state || typeof state !== 'object') return false;
  try {
    const store = storage();
    if (!store) return false;
    const player = state.player || {};
    const pos = player.pos || {};
    const mission = state.mission || {};
    const data = {
      version: 1,
      savedAt: Date.now() / 1000,
      seed: finiteOr(state.seed, 0),
      timeOfDay: finiteOr(state.timeOfDay, 17.25),
      wanted: finiteOr(state.wanted, 0),
      cash: finiteOr(player.cash, 250),
      health: finiteOr(player.health, 100),
      player: {
        pos: { x: finiteOr(pos.x, 0), y: finiteOr(pos.y, 0), z: finiteOr(pos.z, 0) },
        heading: finiteOr(player.heading, 0),
        onFoot: typeof player.onFoot === 'boolean' ? player.onFoot : true,
      },
      mission: { id: mission.id ?? null, stage: finiteOr(mission.stage, 0) },
    };
    store.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(state, world) {
  try {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return null;

    const savedPlayer = parsed.player && typeof parsed.player === 'object' ? parsed.player : {};
    const savedPos = savedPlayer.pos && typeof savedPlayer.pos === 'object' ? savedPlayer.pos : {};
    const savedMission = parsed.mission && typeof parsed.mission === 'object' ? parsed.mission : {};
    const missionId = savedMission.id === undefined ? null : savedMission.id;
    if (missionId !== null && (typeof missionId !== 'string' || !Object.hasOwn(MISSION_INFO, missionId))) {
      return null;
    }

    const health = finiteOr(parsed.health, 100);
    const cash = finiteOr(parsed.cash, 250);
    const wanted = finiteOr(parsed.wanted, 0);
    const timeOfDay = finiteOr(parsed.timeOfDay, 17.25);
    const x = finiteOr(savedPos.x, 0);
    const y = finiteOr(savedPos.y, 0);
    const z = finiteOr(savedPos.z, 0);
    const heading = finiteOr(savedPlayer.heading, 0);
    const stage = finiteOr(savedMission.stage, 0);
    if (health < 0 || health > 100 || cash < 0 || wanted < 0 || wanted > 5 ||
        timeOfDay < 0 || timeOfDay > 24) return null;

    const data = {
      version: 1,
      savedAt: finiteOr(parsed.savedAt, 0),
      seed: finiteOr(parsed.seed, 0),
      timeOfDay,
      wanted,
      cash,
      health,
      player: {
        pos: { x, y, z },
        heading,
        onFoot: typeof savedPlayer.onFoot === 'boolean' ? savedPlayer.onFoot : true,
      },
      mission: { id: missionId, stage },
    };

    if (state && typeof state === 'object') applyData(state, data);
    try {
      if (world && world.state && world.state !== state) applyData(world.state, data);
    } catch {
      // The optional world state may be read-only.
    }
    try {
      const gamePlayer = typeof window !== 'undefined' ? window.__game?.player : null;
      gamePlayer?.setPosition?.(x, z);
    } catch {
      // The global game instance is optional.
    }
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    const store = storage();
    if (!store) return false;
    store.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
