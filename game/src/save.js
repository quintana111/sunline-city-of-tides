// Save / load (design §11). Written fresh 2026-11-24 (Builder B).
// Versioned, plain data only — never serializes Three.js objects.
// Key matches main.js's inline fallback ('sunline-save-v1') so the
// pause-screen Save/Load buttons keep working either way.
const SAVE_KEY = 'sunline-save-v1';
const SAVE_VERSION = 1;

function plainState(state) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    player: {
      pos: {
        x: Number(state.player?.pos?.x) || 0,
        y: Number(state.player?.pos?.y) || 0,
        z: Number(state.player?.pos?.z) || 0,
      },
      vel: {
        x: Number(state.player?.vel?.x) || 0,
        y: Number(state.player?.vel?.y) || 0,
        z: Number(state.player?.vel?.z) || 0,
      },
      heading: Number(state.player?.heading) || 0,
      onFoot: state.player?.onFoot !== false,
      health: Math.max(0, Math.min(100, Number(state.player?.health) || 100)),
      cash: Math.max(0, Number(state.player?.cash) || 0),
    },
    wanted: Math.max(0, Math.min(5, Math.floor(Number(state.wanted) || 0))),
    mission: {
      id: state.mission?.id ?? null,
      title: state.mission?.title ?? '',
      objective: state.mission?.objective ?? '',
      stage: Number(state.mission?.stage) || 0,
    },
    timeOfDay: Number(state.timeOfDay) || 17.25,
    seed: Number(state.seed) || 24681357,
  };
}

function validate(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.version !== SAVE_VERSION) return null;
  if (!data.player || typeof data.player !== 'object') return null;
  const pos = data.player.pos;
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return null;
  if (Math.abs(pos.x) > 2000 || Math.abs(pos.z) > 2000) return null;
  if (!Number.isFinite(data.player.health) || data.player.health < 0 || data.player.health > 100) return null;
  if (!Number.isFinite(data.player.cash) || data.player.cash < 0) return null;
  if (!Number.isFinite(data.wanted) || data.wanted < 0 || data.wanted > 5) return null;
  if (!Number.isFinite(data.timeOfDay) || data.timeOfDay < 0 || data.timeOfDay >= 24) return null;
  return data;
}

export function saveGame(state) {
  if (!state) return false;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(plainState(state)));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(state, world) {
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const data = validate(parsed);
  if (!data) return null;
  // When main.js passes the live state, apply the save into it.
  if (state && typeof state === 'object') {
    Object.assign(state.player, data.player);
    state.player.pos = { ...data.player.pos };
    state.player.vel = { ...data.player.vel };
    state.wanted = data.wanted;
    state.mission = { ...data.mission };
    state.timeOfDay = data.timeOfDay;
    if (world?.state) {
      // Keep the world's state reference in sync (same object in practice).
      void world;
    }
  }
  return data;
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

export { SAVE_KEY, SAVE_VERSION };
