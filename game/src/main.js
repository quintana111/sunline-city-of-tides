// main.js — Sunline: City of Tides. Renderer, state, input, loop, wiring.
// Wiring order: world -> buildCity -> player -> vehicles -> traffic ->
// police -> missions -> combat -> hud. B modules load dynamically and are
// tolerated when absent; a built-in fallback HUD + built-in shot staging
// cover their absence. Update order: input -> missions (E-to-start wins
// over E-to-enter) -> player/vehicle -> traffic+peds -> police ->
// combat -> camera+HUD -> render.
//
// Shot mode (?shot=) freezes the sim: animate() skips updates and only
// renders, so staging must sync state directly (see setCarPosition).

import * as THREE from '../vendor/three.min.js';
import { createWorld, buildCity } from './world.js';
import { createPlayer } from './player.js';
import { createVehicleManager } from './vehicles.js';
import { createTraffic } from './traffic.js';

export const DEFAULT_SEED = 24681357;
export const SHOT_SEED = 731942;

// ---------------------------------------------------------------- shot plans
// Pure data: camera + staging per shot name, so tests can check the
// framings without a DOM. Camera formulas from the spec, proven framings.
export function getShotPlan(name, playerX = -40) {
  switch (name) {
    case 'start':
      return {
        screen: 'title', wanted: 0,
        camera: { x: 250, y: 60, z: 850 },
        lookAt: { x: -80, y: 62, z: -100 },
      };
    case 'drive':
      return {
        screen: 'play', wanted: 0, car: 'Kestrel R',
        carPos: { x: -40, z: 4.5, heading: Math.PI / 2 },
        camera: null, lookAt: null, // chase camera follows the car
      };
    case 'chase':
      return {
        screen: 'play', wanted: 3, car: 'Kestrel R',
        carPos: { x: -40, z: 4.5, heading: Math.PI / 2 },
        cruiserPos: { x: -52, z: 4.5, heading: Math.PI / 2 },
        camera: { x: playerX - 14, y: 7.5, z: 16 },
        lookAt: { x: playerX - 2, y: 1.2, z: -1 },
      };
    case 'mission':
      return {
        screen: 'play', wanted: 0,
        missionId: 'first-light',
        playerPos: { x: -8, z: -112 },
        camera: null, lookAt: null,
      };
    case 'street':
      return {
        screen: 'play', wanted: 0,
        playerPos: { x: 0, z: 4.5 },
        camera: null, lookAt: null,
      };
    case 'combat':
      return {
        screen: 'play', wanted: 1,
        playerPos: { x: 0, z: 4.5 },
        camera: null, lookAt: null,
      };
    default:
      return null;
  }
}

export function createState(seed) {
  return {
    player: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, heading: 0, onFoot: true, health: 100, cash: 250 },
    currentVehicle: null,
    wanted: 0,
    mission: { id: null, title: '', objective: '', stage: 0 },
    timeOfDay: 17.25,
    paused: false,
    screen: 'title',
    input: { keys: new Set(), mouseDX: 0, mouseDY: 0, mouseButtons: new Set(), pointerLocked: false },
    seed,
  };
}

// ---------------------------------------------------------------- boot
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const shotName = params.get('shot') || null;
const seed = shotName
  ? SHOT_SEED
  : (params.get('seed') ? parseInt(params.get('seed'), 10) || DEFAULT_SEED : DEFAULT_SEED);

const state = createState(seed);
let world = null;
let player = null;
let vehicles = null;
let traffic = null;
let police = null;
let missions = null;
let combat = null;
let hud = null;
let audio = null;
let shots = null;
let saveApi = null;

let renderer, scene, camera, clock;
let camYaw = Math.PI, camPitch = 0.32, camDist = 8;
let shotReady = false;
let framesRendered = 0;

function el(id) { return document.getElementById(id); }

async function loadOptional(path) {
  try {
    return await import(path);
  } catch (err) {
    console.warn(`optional module ${path} unavailable:`, err.message);
    return null;
  }
}

async function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el('game-canvas').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 4000);
  camera.position.set(0, 40, 120);
  clock = new THREE.Clock();

  world = createWorld(seed);
  world.state = state;
  buildCity(scene, world);

  const sp = world.spawnPoints.player;
  state.player.pos.x = sp.x; state.player.pos.z = sp.z;
  state.player.heading = Math.PI; // face north into the city

  player = createPlayer(scene, world);
  player.camYaw = camYaw; player.camPitch = camPitch;
  vehicles = createVehicleManager(scene, world);
  vehicles.spawnCars(12, 0);
  traffic = createTraffic(scene, world);
  traffic.createPedestrians(60);

  // Builder-B modules, in dependency order. Each is optional: the game
  // stays playable with the built-in fallbacks when one is absent.
  const policeMod = await loadOptional('./police.js');
  if (policeMod && policeMod.createPolice) {
    try { police = policeMod.createPolice(scene, world, state, vehicles); } catch (e) { console.warn('police init failed', e); }
  }
  const missionsMod = await loadOptional('./missions.js');
  if (missionsMod && missionsMod.createMissions) {
    try { missions = missionsMod.createMissions(scene, world, state, vehicles, police); } catch (e) { console.warn('missions init failed', e); }
  }
  const combatMod = await loadOptional('./combat.js');
  if (combatMod && combatMod.createCombat) {
    try { combat = combatMod.createCombat(scene, world, state, police, traffic); } catch (e) { console.warn('combat init failed', e); }
  }
  const hudMod = await loadOptional('./hud.js');
  if (hudMod && hudMod.createHud) {
    try { hud = hudMod.createHud(state, world); } catch (e) { console.warn('hud init failed', e); hud = null; }
  }
  const audioMod = await loadOptional('./audio.js');
  if (audioMod && audioMod.createAudio) {
    try { audio = audioMod.createAudio(); } catch (e) { console.warn('audio init failed', e); }
  }
  const saveMod = await loadOptional('./save.js');
  if (saveMod) saveApi = saveMod;
  const shotsMod = await loadOptional('./shots.js');
  if (shotsMod) shots = shotsMod;

  // Vehicle-theft hook for police: entering a parked car reports it.
  state._onVehicleTheft = (car) => {
    if (police && police.reportCrime) {
      try { police.reportCrime('vehicleTheft', { x: car.x, z: car.z }, 30); } catch (e) { /* police decides */ }
    }
  };

  // Restore a save in free roam (never in shot mode).
  if (!shotName && saveApi && saveApi.loadGame) {
    try {
      const saved = saveApi.loadGame();
      if (saved && saved.player) {
        state.player.pos.x = saved.player.x ?? state.player.pos.x;
        state.player.pos.z = saved.player.z ?? state.player.pos.z;
        state.player.heading = saved.player.heading ?? state.player.heading;
        state.player.health = saved.player.health ?? 100;
        state.player.cash = saved.player.cash ?? 250;
        state.wanted = saved.wanted ?? 0;
        if (typeof saved.timeOfDay === 'number') state.timeOfDay = saved.timeOfDay;
      }
    } catch (e) { console.warn('save load failed', e); }
  }

  bindInput();
  syncScreens();
  if (shotName) {
    await stageShot(shotName);
  } else {
    showScreen('title');
  }
  renderer.setAnimationLoop(animate);
  window.__game = { state, world, player, vehicles, traffic, police, missions, combat, scene, renderer, camera };
}

if (typeof document !== 'undefined') {
  boot().catch((e) => console.error('boot failed', e));
}

// ---------------------------------------------------------------- input
function bindInput() {
  const gameKeys = new Set(['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyR', 'KeyM', 'ShiftLeft', 'ShiftRight', 'Escape']);
  window.addEventListener('keydown', (e) => {
    if (gameKeys.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    state.input.keys.add(e.code);
    if (e.code === 'KeyE') state.input._ePressed = true;
    if (e.code === 'Escape' && state.screen === 'play') pauseGame(true);
    else if (e.code === 'Escape' && state.screen === 'paused') pauseGame(false);
    if (e.code === 'Enter' && state.screen === 'title') startGame();
    if (e.code === 'KeyM') state.input._minimapDetail = !state.input._minimapDetail;
  });
  window.addEventListener('keyup', (e) => { state.input.keys.delete(e.code); });
  window.addEventListener('blur', () => { state.input.keys.clear(); });

  const canvas = renderer.domElement;
  canvas.addEventListener('click', () => {
    if (state.screen === 'play' && !state.input.pointerLocked) {
      try { canvas.requestPointerLock(); } catch (e) { /* optional */ }
    }
  });
  document.addEventListener('pointerlockchange', () => {
    state.input.pointerLocked = document.pointerLockElement === canvas;
  });
  window.addEventListener('mousemove', (e) => {
    if (!state.input.pointerLocked) return;
    state.input.mouseDX += e.movementX || 0;
    state.input.mouseDY += e.movementY || 0;
  });
  window.addEventListener('mousedown', (e) => {
    state.input.mouseButtons.add(e.button);
    if (e.button === 0) state.input._shootPressed = true;
  });
  window.addEventListener('mouseup', (e) => { state.input.mouseButtons.delete(e.button); });
  window.addEventListener('contextmenu', (e) => { if (state.screen === 'play') e.preventDefault(); });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  el('btn-start').addEventListener('click', () => startGame());
  el('btn-resume').addEventListener('click', () => pauseGame(false));
  el('btn-restart').addEventListener('click', () => restartGame());
  el('btn-save').addEventListener('click', () => {
    if (saveApi && saveApi.saveGame) {
      saveApi.saveGame(state);
      el('btn-save').textContent = 'Saved ✓';
      setTimeout(() => { el('btn-save').textContent = 'Save game'; }, 1200);
    }
  });
  el('btn-over-restart').addEventListener('click', () => restartGame());
  // Builder-B's hud.js builds its own screens (title-screen, paused-screen,
  // over-screen, z-index above ours) with its own buttons — wire those too,
  // since they are the visible ones when hud.js is present.
  const wire = (id, fn) => { const n = el(id); if (n) n.addEventListener('click', fn); };
  wire('start-button', () => startGame());
  wire('continue-button', () => startGame());
  wire('resume-button', () => pauseGame(false));
  wire('restart-button', () => restartGame());
  wire('save-button', () => {
    if (saveApi && saveApi.saveGame) {
      saveApi.saveGame(state);
      const b = el('save-button');
      if (b) { const t = b.textContent; b.textContent = 'Saved ✓'; setTimeout(() => { b.textContent = t; }, 1200); }
    }
  });
  wire('over-restart-button', () => restartGame());
}

function startGame() {
  if (audio && audio.play) { try { audio.play('start'); } catch (e) { /* silent */ } }
  state.screen = 'play';
  state.paused = false;
  syncScreens();
}

function pauseGame(on) {
  state.paused = on;
  state.screen = on ? 'paused' : 'play';
  syncScreens();
}

function restartGame() {
  const sp = world.spawnPoints.player;
  state.player.pos.x = sp.x; state.player.pos.y = 0; state.player.pos.z = sp.z;
  state.player.heading = Math.PI;
  state.player.health = 100;
  state.player.onFoot = true;
  if (state.currentVehicle) { try { vehicles.exitVehicle(); } catch (e) { state.currentVehicle = null; } }
  state.wanted = 0;
  state.mission = { id: null, title: '', objective: '', stage: 0 };
  state.screen = 'play';
  state.paused = false;
  if (police && police.clear) { try { police.clear(); } catch (e) { /* ignore */ } }
  if (missions && missions.resetMission) { try { missions.resetMission(); } catch (e) { /* ignore */ } }
  syncScreens();
}

function showScreen(name) {
  state.screen = name;
  syncScreens();
}

function syncScreens() {
  // B's hud owns title-screen / paused-screen / over-screen when present;
  // ours stay hidden then so the two sets never stack.
  const bScreens = !!el('title-screen');
  const set = (id, on) => { const n = el(id); if (n) n.style.display = on ? 'flex' : 'none'; };
  set('screen-title', !bScreens && state.screen === 'title');
  set('screen-paused', !bScreens && state.screen === 'paused');
  set('screen-over', !bScreens && state.screen === 'over');
  if (bScreens) {
    set('title-screen', state.screen === 'title');
    set('paused-screen', state.screen === 'paused');
    set('over-screen', state.screen === 'over');
  }
  const hudEl = el('hud');
  if (hudEl) hudEl.style.display = state.screen === 'play' ? 'block' : 'none';
}

// ---------------------------------------------------------------- shots
// Built-in staging used when shots.js is absent or declines the shot.
// Applies the frozen, deterministic setup for each ?shot= name.
async function stageShot(name) {
  const plan = getShotPlan(name);
  let handled = false;
  if (shots && shots.applyShot) {
    try {
      // Awaited: applyShot may be async; a bare Promise is truthy and
      // would otherwise mark staging done before it runs.
      handled = await shots.applyShot(name, { state, world, player, vehicles, traffic, police, missions, camera });
    } catch (e) { console.warn('applyShot failed, using built-in staging', e); handled = false; }
  }
  if (handled && plan) {
    // Verify + repair: shots.js is mid-edit and may leave gaps (e.g. it
    // sets the chase camera + wanted but never places the player in a
    // car). Repair only what is missing; never override staging that
    // already holds.
    if (name === 'start') {
      camera.position.set(plan.camera.x, plan.camera.y, plan.camera.z);
      camera.lookAt(plan.lookAt.x, plan.lookAt.y, plan.lookAt.z);
    }
    if ((name === 'drive' || name === 'chase') && !state.currentVehicle) {
      const p = plan.carPos;
      vehicles.placePlayerInCar(plan.car, p.x, p.z, p.heading, name === 'drive' ? 14 : 16);
      if (name === 'chase') {
        const c = plan.cruiserPos;
        vehicles.spawnCarAt('sentinel', c.x, c.z, c.heading);
        camera.position.set(plan.camera.x, plan.camera.y, plan.camera.z);
        camera.lookAt(plan.lookAt.x, plan.lookAt.y, plan.lookAt.z);
      }
    }
    if (name === 'chase' && state.wanted !== 3) {
      state.wanted = 3;
      if (police && police.setWanted) { try { police.setWanted(3); } catch (e) { /* ignore */ } }
    }
    if (name === 'mission' && (!state.mission || state.mission.id !== 'first-light')) {
      let started = false;
      if (missions && missions.startMission) {
        try { missions.startMission(plan.missionId); started = true; } catch (e) { started = false; }
      }
      if (!started) {
        state.mission = {
          id: 'first-light', title: 'First Light Run',
          objective: 'Pick up the parcel at Palm Court — 150s', stage: 1,
        };
      }
      state.player.pos.x = plan.playerPos.x;
      state.player.pos.z = plan.playerPos.z;
      state.player.pos.y = 0;
      state.player.heading = Math.PI;
      player.group.position.set(plan.playerPos.x, 0, plan.playerPos.z);
      player.group.rotation.y = -state.player.heading;
      addMissionBeacon(plan.playerPos.x, plan.playerPos.z);
    }
  }
  if (!handled && plan) {
    state.screen = plan.screen;
    state.paused = false;
    state.wanted = plan.wanted || 0;
    if (police && police.setWanted && plan.wanted) {
      try { police.setWanted(plan.wanted); } catch (e) { /* ignore */ }
    }
    if (name === 'start') {
      camera.position.set(plan.camera.x, plan.camera.y, plan.camera.z);
      camera.lookAt(plan.lookAt.x, plan.lookAt.y, plan.lookAt.z);
    } else if (name === 'drive' || name === 'chase') {
      const p = plan.carPos;
      vehicles.placePlayerInCar(plan.car, p.x, p.z, p.heading, name === 'drive' ? 14 : 16);
      if (name === 'chase') {
        // A police cruiser trailing the player, on the same lane.
        const c = plan.cruiserPos;
        vehicles.spawnCarAt('sentinel', c.x, c.z, c.heading);
        // A few traffic cars ahead on the same road for depth.
        vehicles.spawnCarAt('morrow', -8, 4.5, Math.PI / 2);
        vehicles.spawnCarAt('sunbird', 30, -4.5, -Math.PI / 2);
        camera.position.set(plan.camera.x, plan.camera.y, plan.camera.z);
        camera.lookAt(plan.lookAt.x, plan.lookAt.y, plan.lookAt.z);
      }
    } else if (name === 'mission') {
      let started = false;
      if (missions && missions.startMission) {
        try { missions.startMission(plan.missionId); started = true; } catch (e) { started = false; }
      }
      if (!started) {
        state.mission = {
          id: 'first-light', title: 'First Light Run',
          objective: 'Pick up the parcel at Palm Court — 150s', stage: 1,
        };
      }
      state.player.pos.x = plan.playerPos.x;
      state.player.pos.z = plan.playerPos.z;
      state.player.pos.y = 0;
      state.player.heading = Math.PI;
      player.group.position.set(plan.playerPos.x, 0, plan.playerPos.z);
      player.group.rotation.y = -state.player.heading;
      addMissionBeacon(plan.playerPos.x, plan.playerPos.z);
    } else if (name === 'street' || name === 'combat') {
      state.player.pos.x = plan.playerPos.x;
      state.player.pos.z = plan.playerPos.z;
      state.player.pos.y = 0;
      state.player.heading = Math.PI / 2;
      player.group.position.set(plan.playerPos.x, 0, plan.playerPos.z);
      player.group.rotation.y = -state.player.heading;
    }
  } else if (!handled && !plan) {
    // Unknown shot: stay on the title screen.
    state.screen = 'title';
  }
  syncScreens();
  updateHud(0);
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__shotReady = true;
  window.__shotName = name;
}

let beaconMesh = null;
function addMissionBeacon(x, z) {
  if (beaconMesh) scene.remove(beaconMesh);
  beaconMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 14, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
  );
  beaconMesh.position.set(x, 7, z);
  scene.add(beaconMesh);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.4, 3.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.08, z);
  scene.add(ring);
}

// ---------------------------------------------------------------- camera + HUD
function updateCamera(dt) {
  // Mouse orbit feeds the camera yaw/pitch.
  camYaw -= (state.input.mouseDX || 0) * 0.0028;
  camPitch += (state.input.mouseDY || 0) * 0.0022;
  camPitch = Math.max(-0.15, Math.min(1.1, camPitch));
  state.input.mouseDX = 0;
  state.input.mouseDY = 0;
  if (player) { player.camYaw = camYaw; player.camPitch = camPitch; }

  const p = state.player.pos;
  let tx, ty, tz, dist, height;
  if (state.currentVehicle) {
    const car = state.currentVehicle;
    const h = car.heading;
    const bx = Math.sin(h), bz = -Math.cos(h);
    tx = car.x; ty = 1.4; tz = car.z;
    dist = 10.5; height = 4.2;
    camera.position.x += ((car.x - bx * dist) - camera.position.x) * Math.min(1, dt * 5);
    camera.position.y += ((height) - camera.position.y) * Math.min(1, dt * 5);
    camera.position.z += ((car.z - bz * dist) - camera.position.z) * Math.min(1, dt * 5);
    camera.lookAt(tx, ty, tz);
  } else {
    tx = p.x; ty = p.y + 1.6; tz = p.z;
    dist = camDist; height = 2.6 + Math.sin(camPitch) * 4;
    const cx = p.x - Math.sin(camYaw) * dist * Math.cos(camPitch);
    const cz = p.z + Math.cos(camYaw) * dist * Math.cos(camPitch);
    camera.position.x += (cx - camera.position.x) * Math.min(1, dt * 8);
    camera.position.y += (height - camera.position.y) * Math.min(1, dt * 8);
    camera.position.z += (cz - camera.position.z) * Math.min(1, dt * 8);
    camera.lookAt(tx, ty, tz);
  }
}

// Fallback HUD (used when hud.js is absent or fails). Reads state only,
// never mutates gameplay state.
function updateHud(dt) {
  if (hud && hud.update) {
    try { hud.update(dt); return; } catch (e) { console.warn('hud update failed, fallback HUD', e); hud = null; }
  }
  const setText = (id, v) => { const n = el(id); if (n) n.textContent = v; };
  setText('hud-health-num', `${Math.max(0, Math.round(state.player.health))}`);
  const bar = el('hud-health-bar');
  if (bar) bar.style.width = `${Math.max(0, state.player.health)}%`;
  setText('hud-cash', `$${Math.round(state.player.cash)}`);
  setText('hud-stars', '★'.repeat(state.wanted) + '☆'.repeat(5 - state.wanted));
  const hours = Math.floor(state.timeOfDay);
  const mins = Math.floor((state.timeOfDay - hours) * 60);
  setText('hud-clock', `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);
  const speed = state.currentVehicle ? Math.abs(state.currentVehicle.speed || 0) * 3.6 : 0;
  setText('hud-speed', state.currentVehicle ? `${Math.round(speed)} km/h` : 'On foot');
  const banner = el('hud-mission');
  if (banner) {
    if (state.mission && state.mission.id) {
      banner.style.display = 'block';
      setText('hud-mission-title', state.mission.title.toUpperCase());
      setText('hud-mission-objective', state.mission.objective);
    } else {
      banner.style.display = 'none';
    }
  }
  // Contextual prompt.
  let prompt = '';
  if (state.screen === 'play') {
    if (state.player.onFoot) {
      const near = vehicles ? vehicles.getNearbyVehicle() : null;
      if (near) prompt = 'E — enter ' + near.model.name;
      else if (state.mission && state.mission.id) prompt = '';
      else prompt = '';
      // Mission marker prompt wins over vehicle entry (handled in missions).
      if (missions && missions.getPrompt) {
        try { const mp = missions.getPrompt(); if (mp) prompt = mp; } catch (e) { /* ignore */ }
      }
    } else {
      prompt = 'E — exit vehicle';
    }
  }
  setText('hud-prompt', prompt);
  drawMinimap();
}

// Minimap: dark street map, bright thick road cores, bigger police dots.
function drawMinimap() {
  const canvas = el('minimap');
  if (!canvas || !world) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const scale = W / 1400;
  const toX = (x) => W / 2 + x * scale;
  const toY = (z) => H / 2 + z * scale;
  ctx.fillStyle = '#10141c';
  ctx.fillRect(0, 0, W, H);
  // Ocean strip at the bottom (south).
  ctx.fillStyle = '#164e63';
  ctx.fillRect(0, toY(560), W, H - toY(560));
  // Roads: bright thick cores.
  ctx.strokeStyle = '#e8d28a';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (const road of world.roads) {
    ctx.beginPath();
    if (road.axis === 'ns') { ctx.moveTo(toX(road.coord), toY(-616)); ctx.lineTo(toX(road.coord), toY(616)); }
    else { ctx.moveTo(toX(-616), toY(road.coord)); ctx.lineTo(toX(616), toY(road.coord)); }
    ctx.stroke();
  }
  // Mission marker.
  if (state.mission && state.mission.id && world.missionPoints) {
    const dest = state.mission.stage === 1 ? world.missionPoints.parcelPickup : world.missionPoints.beachCafe;
    if (dest) {
      ctx.fillStyle = '#ffd94a';
      ctx.beginPath(); ctx.arc(toX(dest.x), toY(dest.z), 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd94a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(toX(dest.x), toY(dest.z), 11, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // Police dots (bigger than the player arrow's shaft).
  if (police && police.units) {
    ctx.fillStyle = '#5aa2ff';
    for (const u of police.units) {
      ctx.beginPath(); ctx.arc(toX(u.x ?? u.pos?.x ?? 0), toY(u.z ?? u.pos?.z ?? 0), 6, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Player arrow, rotated with heading.
  const px = toX(state.player.pos.x), py = toY(state.player.pos.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(Math.atan2(Math.sin(state.player.heading), -Math.cos(state.player.heading)) + Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(-6, 7); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- loop
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  // Shot mode: frozen sim — render only, no updates.
  if (!shotName && state.screen === 'play' && !state.paused) {
    // E-to-start at a mission marker wins over E-to-enter a vehicle:
    // missions runs first and may consume the keypress.
    let eConsumed = false;
    if (missions && missions.update) {
      try { missions.update(dt, state.input); } catch (e) { console.warn('missions update failed', e); }
      if (state.input._eConsumed) { eConsumed = true; state.input._eConsumed = false; }
    }
    if (eConsumed) state.input._ePressed = false;

    if (player) player.update(dt, state.input, world);
    if (vehicles) vehicles.update(dt, state.input);
    if (traffic) traffic.update(dt);
    if (police && police.update) { try { police.update(dt); } catch (e) { console.warn('police update failed', e); } }
    if (combat && combat.update) { try { combat.update(dt, state.input); } catch (e) { console.warn('combat update failed', e); } }
    if (audio && audio.update) { try { audio.update(dt, state); } catch (e) { /* silent */ } }

    // Game clock: 1 game hour per ~4 real minutes.
    state.timeOfDay = (state.timeOfDay + dt / 240) % 24;

    // Health 0 -> over screen.
    if (state.player.health <= 0 && state.screen === 'play') {
      state.screen = 'over';
      state.player.cash = Math.max(0, state.player.cash - 50);
      syncScreens();
    }
    state.input._ePressed = false;
    state.input._shootPressed = false;
    updateCamera(dt);
    updateHud(dt);
  } else if (!shotName && state.screen === 'title') {
    // Slow title orbit over the city.
    const t = clock.elapsedTime * 0.02;
    camera.position.set(Math.sin(t) * 420, 150, Math.cos(t) * 420 + 200);
    camera.lookAt(0, 40, 0);
    updateHud(dt);
  } else if (!shotName) {
    updateHud(dt);
  }
  renderer.render(scene, camera);
  framesRendered++;
  if (shotName && framesRendered >= 3 && !shotReady) {
    window.__shotReady = true;
    shotReady = true;
  }
}
