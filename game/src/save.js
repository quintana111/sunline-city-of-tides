// save.js — versioned, compact localStorage save for Sunline: City of Tides.
// Fresh implementation from design-r3.md section 9.
// Stores plain numbers/strings only: version, player pos/heading/health/
// cash, wanted, time, mission id+title+objective+stage, world seed.
// NEVER serializes Three.js objects. Validates on load; bad or partial
// saves fall back to defaults field by field.
const SAVE_KEY = 'sunline-city-of-tides-save-v1';
const SAVE_VERSION = 1;

// In-memory fallback when localStorage is unavailable (private mode, Node).
let memorySlot = null;

function storage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch (e) { /* unavailable */ }
  return null;
}

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function saveGame(state) {
  if (!state || !state.player) return false;
  const data = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    player: {
      pos: { x: state.player.pos.x, y: state.player.pos.y || 0, z: state.player.pos.z },
      heading: state.player.heading || 0,
      health: state.player.health,
      cash: state.player.cash,
    },
    wanted: state.wanted || 0,
    timeOfDay: state.timeOfDay,
    mission: state.mission ? {
      id: state.mission.id || null,
      title: state.mission.title || '',
      objective: state.mission.objective || '',
      stage: state.mission.stage || 0,
    } : { id: null, title: '', objective: '', stage: 0 },
    seed: state.seed,
  };
  const raw = JSON.stringify(data);
  const store = storage();
  try {
    if (store) store.setItem(SAVE_KEY, raw);
    else memorySlot = raw;
  } catch (e) {
    memorySlot = raw;
  }
  return true;
}

function parseSave(raw) {
  if (!raw) return null;
  let data;
  try { data = JSON.parse(raw); } catch (e) { return null; }
  if (!data || data.version !== SAVE_VERSION) return null;
  if (!data.player || !data.player.pos) return null;
  const pos = data.player.pos;
  if (!isNum(pos.x) || !isNum(pos.z)) return null;
  // Validate + normalise field by field; anything out of range is clamped
  // or dropped to its default instead of rejecting the whole save.
  const out = {
    version: SAVE_VERSION,
    savedAt: isNum(data.savedAt) ? data.savedAt : 0,
    player: {
      pos: { x: clamp(pos.x, -616, 616), y: isNum(pos.y) ? clamp(pos.y, 0, 50) : 0, z: clamp(pos.z, -616, 616) },
      heading: isNum(data.player.heading) ? data.player.heading : 0,
      health: isNum(data.player.health) ? clamp(data.player.health, 1, 100) : 100,
      cash: isNum(data.player.cash) ? Math.max(0, Math.floor(data.player.cash)) : 250,
    },
    wanted: isNum(data.wanted) ? clamp(Math.round(data.wanted), 0, 5) : 0,
    timeOfDay: isNum(data.timeOfDay) ? clamp(data.timeOfDay, 0, 24) : 17.25,
    mission: { id: null, title: '', objective: '', stage: 0 },
    seed: isNum(data.seed) ? Math.floor(data.seed) : 24681357,
  };
  if (data.mission && typeof data.mission.id === 'string') {
    out.mission = {
      id: data.mission.id,
      title: typeof data.mission.title === 'string' ? data.mission.title : '',
      objective: typeof data.mission.objective === 'string' ? data.mission.objective : '',
      stage: isNum(data.mission.stage) ? clamp(Math.round(data.mission.stage), 0, 3) : 0,
    };
  }
  return out;
}

// loadGame() with no arguments returns the validated save data (or null).
// loadGame(state, world?) applies it in place onto a live state object and
// returns true on success, false when no valid save exists.
export function loadGame(state, world) {
  const store = storage();
  let raw = null;
  try { raw = store ? store.getItem(SAVE_KEY) : memorySlot; } catch (e) { raw = memorySlot; }
  const data = parseSave(raw);
  if (!state) return data;
  if (!data) return false;
  state.player.pos.x = data.player.pos.x;
  state.player.pos.y = data.player.pos.y;
  state.player.pos.z = data.player.pos.z;
  state.player.heading = data.player.heading;
  state.player.health = data.player.health;
  state.player.cash = data.player.cash;
  state.player.onFoot = true;
  state.currentVehicle = null;
  state.wanted = data.wanted;
  state.timeOfDay = data.timeOfDay;
  state.mission = { ...data.mission };
  state.seed = data.seed;
  if (world) world.seed = data.seed;
  return true;
}

export function clearSave() {
  const store = storage();
  try { if (store) store.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  memorySlot = null;
  return true;
}

export function hasSave() {
  const store = storage();
  let raw = null;
  try { raw = store ? store.getItem(SAVE_KEY) : memorySlot; } catch (e) { raw = memorySlot; }
  return parseSave(raw) !== null;
}
