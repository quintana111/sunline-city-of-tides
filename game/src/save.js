// Versioned localStorage save/load for Sunline: City of Tides.
// Serializes plain data only — never Three.js objects, vehicles, or functions.
export const SAVE_KEY = 'sunline-save-v1';

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function stringValue(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

export function saveGame(state, world) {
  try {
    if (!state || !state.player) return false;

    const player = state.player;
    const pos = player.pos || {};
    const mission = state.mission || {};

    const data = {
      version: 1,
      seed: finite(state.seed, finite(world?.seed, 0)),
      timeOfDay: finite(state.timeOfDay, 17.25),
      wanted: finite(state.wanted, 0),
      cash: finite(player.cash, 0),
      health: finite(player.health, 100),
      player: {
        pos: {
          x: finite(pos.x, 0),
          y: finite(pos.y, 0),
          z: finite(pos.z, 0),
        },
        heading: finite(player.heading, 0),
        onFoot: typeof player.onFoot === 'boolean' ? player.onFoot : true,
      },
      mission: {
        id: stringValue(mission.id),
        title: stringValue(mission.title),
        objective: stringValue(mission.objective),
        stage: finite(mission.stage, 0),
      },
      savedAt: new Date().toISOString(),
    };

    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(state, world) {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return null;

    const savedPlayer = parsed.player;
    const savedPos = savedPlayer?.pos;
    if (
      !savedPlayer ||
      !savedPos ||
      !Number.isFinite(savedPos.x) ||
      !Number.isFinite(savedPos.z)
    ) {
      return null;
    }

    const currentPlayer = state?.player || {};
    const currentPos = currentPlayer.pos || {};
    const currentMission = state?.mission || {};

    const normalized = {
      version: 1,
      seed: finite(parsed.seed, finite(world?.seed, finite(state?.seed, 0))),
      timeOfDay: finite(parsed.timeOfDay, finite(state?.timeOfDay, 17.25)),
      wanted: Math.max(0, Math.min(5, finite(parsed.wanted, 0))),
      cash: finite(parsed.cash, finite(currentPlayer.cash, 0)),
      health: finite(parsed.health, finite(currentPlayer.health, 100)),
      player: {
        pos: {
          x: savedPos.x,
          y: finite(savedPos.y, finite(currentPos.y, 0)),
          z: savedPos.z,
        },
        heading: finite(savedPlayer.heading, finite(currentPlayer.heading, 0)),
        onFoot: typeof savedPlayer.onFoot === 'boolean'
          ? savedPlayer.onFoot
          : (typeof currentPlayer.onFoot === 'boolean' ? currentPlayer.onFoot : true),
      },
      mission: {
        id: stringValue(parsed.mission?.id, stringValue(currentMission.id)),
        title: stringValue(parsed.mission?.title, stringValue(currentMission.title)),
        objective: stringValue(parsed.mission?.objective, stringValue(currentMission.objective)),
        stage: finite(parsed.mission?.stage, finite(currentMission.stage, 0)),
      },
    };

    if (typeof parsed.savedAt === 'string') normalized.savedAt = parsed.savedAt;

    if (state && typeof state === 'object') {
      if (!state.player || typeof state.player !== 'object') state.player = {};
      Object.assign(state.player, {
        pos: { ...normalized.player.pos },
        heading: normalized.player.heading,
        health: normalized.health,
        cash: normalized.cash,
        onFoot: normalized.player.onFoot,
      });

      state.wanted = normalized.wanted;
      state.timeOfDay = normalized.timeOfDay;
      if (Number.isFinite(parsed.seed)) state.seed = parsed.seed;

      const defaults = state.mission && typeof state.mission === 'object'
        ? state.mission
        : {};
      state.mission = {
        ...defaults,
        ...normalized.mission,
      };

      if (normalized.player.onFoot) {
        try {
          if (typeof window !== 'undefined') {
            window.__game?.player?.setPosition?.(
              normalized.player.pos.x,
              normalized.player.pos.z,
            );
          }
        } catch {
          // Applying a save should remain safe even if the game instance is absent.
        }
      }
    }

    return normalized;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
