// Sunline: City of Tides — boot, input, game loop, screens, fallback HUD,
// ?shot= staging hook. Builder B modules (police/missions/combat/hud/audio/
// save/shots) are loaded by dynamic import and tolerated when absent:
// main.js works fully without them and defers to them when present.
import * as THREE from 'three';
import { createWorld, buildCity } from './world.js';
import { createPlayer } from './player.js';
import { createVehicleManager } from './vehicles.js';
import { createTraffic } from './traffic.js';

async function tryImport(path) {
  try {
    return await import(path);
  } catch {
    return null;
  }
}

// A Builder B factory that throws must not kill the boot: log and continue.
function safeCreate(label, fn) {
  try {
    return fn() ?? null;
  } catch (err) {
    console.warn(`[sunline] ${label} failed to start:`, err?.message ?? err);
    return null;
  }
}

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const parsedSeed = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isFinite(parsedSeed) ? parsedSeed >>> 0 : (shotName ? 731942 : 24681357);

const state = {
  player: {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    heading: 0,
    onFoot: true,
    health: 100,
    cash: 250,
  },
  currentVehicle: null,
  wanted: 0,
  mission: { id: null, title: '', objective: '', stage: 0 },
  timeOfDay: 17.25,
  paused: false,
  screen: 'title',
  input: {
    keys: new Set(),
    mouseDX: 0,
    mouseDY: 0,
    mouseButtons: new Set(),
    pointerLocked: false,
  },
  seed,
};

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
const world = createWorld(seed);
world.state = state;
buildCity(scene, world);

const player = createPlayer(scene, world, camera);
const vehicles = createVehicleManager(scene, world, camera);
const traffic = createTraffic(scene, world);
traffic.createPedestrians(64);
vehicles.spawnCars(10);
player.setPosition(world.spawnPoints.player.x, world.spawnPoints.player.z);

// Builder B modules (dynamic: tolerated when absent).
const policeModule = await tryImport('./police.js');
const missionsModule = await tryImport('./missions.js');
const combatModule = await tryImport('./combat.js');
const hudModule = await tryImport('./hud.js');
const audioModule = await tryImport('./audio.js');
const saveModule = await tryImport('./save.js');

const police = safeCreate('police', () => policeModule?.createPolice?.(scene, world, state, vehicles));
const missions = safeCreate('missions', () => missionsModule?.createMissions?.(scene, world, state, vehicles, police));
const combat = safeCreate('combat', () => combatModule?.createCombat?.(scene, world, state, police, traffic));
const hud = safeCreate('hud', () => hudModule?.createHud?.(state, world));
const audio = safeCreate('audio', () => audioModule?.createAudio?.());
state.police = police;

const status = document.getElementById('status');
const titleScreen = document.getElementById('title-screen');
const pauseScreen = document.getElementById('pause-screen');
const overScreen = document.getElementById('over-screen');
const hudRoot = document.getElementById('hud');
const fallbackHud = !hud;
if (hudRoot) hudRoot.hidden = false;

let shotFixedCamera = false;
let shotMode = Boolean(shotName);
let shotReady = false;
let renderCount = 0;
let lastMinimapFrame = -3;
let fallbackStars = [];

function announce(message) {
  if (status) status.textContent = message;
}

function syncOverlays() {
  if (titleScreen) titleScreen.hidden = state.screen !== 'title';
  if (pauseScreen) pauseScreen.hidden = state.screen !== 'paused';
  if (overScreen) overScreen.hidden = state.screen !== 'over';
  if (fallbackHud && hudRoot) hudRoot.hidden = state.screen === 'title' || state.screen === 'over';
  announce(state.screen === 'title' ? 'Title screen'
    : state.screen === 'paused' ? 'Game paused'
    : state.screen === 'over' ? 'Game over' : 'Maravela is ready');
}

function setScreen(screen) {
  state.screen = screen;
  state.paused = screen === 'paused';
  syncOverlays();
}

function requestLock() {
  if (shotMode || !canvas.requestPointerLock) return;
  try {
    const request = canvas.requestPointerLock();
    request?.catch?.(() => {});
  } catch { /* pointer lock is optional */ }
}

function startGame() {
  if (state.screen === 'over') { restartGame(); return; }
  setScreen('play');
  shotFixedCamera = false;
  requestLock();
}

function pauseGame() {
  if (state.screen === 'play') {
    setScreen('paused');
    if (document.pointerLockElement) document.exitPointerLock?.();
  } else if (state.screen === 'paused') {
    setScreen('play');
    requestLock();
  }
}

function restartGame() {
  vehicles.exitVehicle?.();
  state.player.health = 100;
  state.player.cash = 250;
  state.player.vel.x = state.player.vel.y = state.player.vel.z = 0;
  state.player.onFoot = true;
  state.currentVehicle = null;
  state.wanted = 0;
  state.mission = { id: null, title: '', objective: '', stage: 0 };
  state.timeOfDay = 17.25;
  player.respawn?.();
  setScreen('play');
  shotFixedCamera = false;
}

function saveInline() {
  try {
    localStorage.setItem('sunline-save-v1', JSON.stringify({
      player: state.player,
      wanted: state.wanted,
      mission: state.mission,
      timeOfDay: state.timeOfDay,
      seed,
    }));
    announce('Game saved');
  } catch {
    announce('Could not save game');
  }
}

function loadInline() {
  try {
    const saved = JSON.parse(localStorage.getItem('sunline-save-v1') ?? 'null');
    if (!saved) { announce('No save yet'); return; }
    if (saved.player) Object.assign(state.player, saved.player);
    state.wanted = saved.wanted ?? 0;
    state.mission = saved.mission ?? { id: null, title: '', objective: '', stage: 0 };
    state.timeOfDay = saved.timeOfDay ?? 17.25;
    if (state.player.pos) player.setPosition?.(state.player.pos.x, state.player.pos.z);
    setScreen('play');
  } catch {
    announce('No save yet');
  }
}

const saveFn = saveModule?.saveGame ?? saveModule?.save;
const loadFn = saveModule?.loadGame ?? saveModule?.load;

document.getElementById('start-button')?.addEventListener('click', startGame);
document.getElementById('resume-button')?.addEventListener('click', pauseGame);
document.getElementById('restart-button')?.addEventListener('click', restartGame);
document.getElementById('over-restart-button')?.addEventListener('click', restartGame);
document.getElementById('save-button')?.addEventListener('click', () => {
  if (typeof saveFn === 'function') {
    try { saveFn(state, world); announce('Game saved'); } catch { saveInline(); }
  } else saveInline();
});
document.getElementById('load-button')?.addEventListener('click', () => {
  if (typeof loadFn === 'function') {
    try { loadFn(state, world); setScreen('play'); } catch { loadInline(); }
  } else loadInline();
});

window.addEventListener('keydown', (event) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code) &&
      (state.screen === 'play' || state.screen === 'paused')) {
    event.preventDefault();
  }
  if (event.code === 'Escape') {
    if (state.screen === 'play' || state.screen === 'paused') {
      event.preventDefault();
      pauseGame();
    }
    return;
  }
  if (event.code === 'KeyP' && !event.repeat) {
    if (state.screen === 'play' || state.screen === 'paused') pauseGame();
    return;
  }
  if ((event.code === 'Enter' || event.code === 'Space') &&
      (state.screen === 'title' || state.screen === 'over')) {
    event.preventDefault();
    startGame();
    return;
  }
  state.input.keys.add(event.code);
});
window.addEventListener('keyup', (event) => state.input.keys.delete(event.code));
document.addEventListener('pointerlockchange', () => {
  state.input.pointerLocked = document.pointerLockElement === canvas;
});
canvas.addEventListener('mousedown', (event) => {
  state.input.mouseButtons.add(event.button);
  if (state.screen === 'title') startGame();
  else if (state.screen === 'play' && !state.input.pointerLocked) requestLock();
});
window.addEventListener('mouseup', (event) => state.input.mouseButtons.delete(event.button));
window.addEventListener('mousemove', (event) => {
  if (state.input.pointerLocked || state.input.mouseButtons.size > 0) {
    state.input.mouseDX += event.movementX || 0;
    state.input.mouseDY += event.movementY || 0;
  }
});
titleScreen?.addEventListener('click', (event) => {
  if (event.target.closest('button')) return;
  startGame();
});

function setCameraLook(position, target) {
  camera.position.set(position.x, position.y, position.z);
  camera.lookAt(target.x, target.y, target.z);
}

let shotBeacon = null;
function addMissionBeacon(point) {
  if (shotBeacon) scene.remove(shotBeacon);
  const group = new THREE.Group();
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.7, 3.6, 12),
    new THREE.MeshStandardMaterial({ color: 0xffc341, emissive: 0xffa21a, emissiveIntensity: 1.1, roughness: 0.38 }),
  );
  beacon.position.y = 1.8;
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 1.7, 4),
    new THREE.MeshStandardMaterial({ color: 0xffd15a, emissive: 0x9f5e0c, emissiveIntensity: 0.8 }),
  );
  marker.position.y = 4.3;
  group.add(beacon, marker);
  group.position.set(point.x, 0, point.z);
  scene.add(group);
  shotBeacon = group;
}

// Built-in ?shot= staging. Used only when shots.js is absent or declines.
// Heading +PI/2 faces east (+X) along Seaglass Boulevard (z = 0 road).
function stageBuiltInShot(name) {
  shotFixedCamera = true;
  state.paused = false;
  state.input.keys.clear();
  if (name === 'start') {
    setScreen('title');
    setCameraLook({ x: 120, y: 55, z: 260 }, { x: 0, y: 40, z: -40 });
    return true;
  }

  if (name === 'drive' || name === 'chase') {
    setScreen('play');
    const isChase = name === 'chase';
    const x = isChase ? -40 : -80;
    const z = 4.5; // eastbound right-hand lane of Seaglass Boulevard
    const heading = Math.PI / 2; // east
    const car = vehicles.createCar(isChase ? 'sedan' : 'sports', x, z, heading);
    vehicles.enterVehicle(car);
    car.speed = isChase ? 16 : 14;
    state.input.keys.add('KeyW');
    for (let i = 0; i < 120; i++) {
      vehicles.update(1 / 60, state.input);
      traffic.update(1 / 60);
    }
    state.input.keys.delete('KeyW');
    state.input.mouseDX = state.input.mouseDY = 0;
    const current = state.currentVehicle;
    // Traffic ahead on the same road so the shot reads as a drive, not an empty street.
    // (Shot mode freezes updates afterwards, so these placements persist.)
    const ahead = [28, 52, 78];
    for (let i = 0; i < Math.min(ahead.length, traffic.cars.length); i++) {
      const t = traffic.cars[i];
      t.group.position.set(current.pos.x + ahead[i], 0, i % 2 === 0 ? 4.5 : -4.5);
      t.group.rotation.y = -heading;
    }
    if (isChase) {
      state.wanted = 3;
      const cruiser1 = vehicles.createCar('police', current.pos.x - 8, -4.5, heading);
      cruiser1.speed = 16;
      const cruiser2 = vehicles.createCar('police', current.pos.x + 26, -4.5, heading);
      cruiser2.speed = 16;
    }
    const focus = current.pos;
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    setCameraLook(
      { x: focus.x - fx * 13, y: 7.5, z: focus.z - fz * 13 },
      { x: focus.x + fx * 8, y: 2.2, z: focus.z + fz * 8 },
    );
    return true;
  }

  if (name === 'mission') {
    setScreen('play');
    state.mission = {
      id: 'first-light',
      title: 'First Light Run',
      objective: 'Deliver the parcel to Café Lumen on Sunwash Beach',
      stage: 1,
    };
    const pickup = world.missionPoints?.parcelPickup ?? { x: -112, z: -124 };
    player.setPosition?.(pickup.x, pickup.z);
    state.player.pos.x = pickup.x;
    state.player.pos.z = pickup.z;
    state.player.onFoot = true;
    const dropoff = world.missionPoints?.cafeDropoff ?? { x: 116, z: -4.5 };
    addMissionBeacon(dropoff);
    setCameraLook(
      { x: pickup.x - 28, y: 22, z: pickup.z + 38 },
      { x: pickup.x + 8, y: 5, z: pickup.z - 6 },
    );
    return true;
  }
  return false;
}

// After any successful staging: make sure the staged player car has a mesh
// and no traffic car is sitting on the lens (it would read as a glitch blob).
function finalizeShot() {
  if (state.currentVehicle && !state.currentVehicle.group) {
    vehicles.materializeVehicle?.(state.currentVehicle);
  }
  for (const car of traffic.cars) {
    const p = car.group.position;
    if (Math.hypot(p.x - camera.position.x, p.z - camera.position.z) < 10) {
      car.group.visible = false;
    }
  }
  player.group.visible = state.player.onFoot;
}

// Clean applyShot hook for the systems builder: shots.js owns shot modes when
// it accepts one; otherwise the built-in staging above applies.
async function applyShot(name) {
  shotMode = true;
  shotReady = false;
  const shotsModule = await tryImport('./shots.js');
  if (typeof shotsModule?.applyShot === 'function') {
    try {
      const used = await shotsModule.applyShot(name, {
        state, world, player, vehicles, traffic, police, missions, camera, scene, renderer,
      });
      if (used === true) {
        shotFixedCamera = true;
        syncOverlays();
        finalizeShot();
        return true;
      }
    } catch (err) {
      console.warn('[sunline] shots.js applyShot failed:', err?.message ?? err);
    }
  }
  const staged = stageBuiltInShot(name);
  if (staged) finalizeShot();
  return staged;
}

window.__game = {
  state, world, player, vehicles, traffic, scene, renderer, camera,
  ...(police ? { police } : {}),
  ...(missions ? { missions } : {}),
  ...(combat ? { combat } : {}),
  ...(hud ? { hud } : {}),
  ...(audio ? { audio } : {}),
  applyShot,
  get shotReady() { return shotReady; },
};

function updateFallbackHud() {
  const health = document.getElementById('health-fill');
  const cash = document.getElementById('cash');
  const stars = document.getElementById('stars');
  const speed = document.getElementById('speed');
  const clockEl = document.getElementById('clock');
  const missionBanner = document.getElementById('mission-banner');
  const missionTitle = document.getElementById('mission-title');
  const missionObjective = document.getElementById('mission-objective');
  const prompt = document.getElementById('prompt');

  if (health) health.style.width = `${THREE.MathUtils.clamp(state.player.health, 0, 100)}%`;
  if (cash) cash.textContent = `$${Math.max(0, Math.floor(state.player.cash))}`;
  if (stars) {
    if (!fallbackStars.length) {
      stars.replaceChildren();
      for (let i = 0; i < 5; i++) {
        const star = document.createElement('span');
        star.textContent = '★';
        stars.appendChild(star);
        fallbackStars.push(star);
      }
    }
    fallbackStars.forEach((star, index) => star.classList.toggle('filled', index < state.wanted));
  }
  const velocity = state.currentVehicle?.speed ?? Math.hypot(state.player.vel.x, state.player.vel.z);
  if (speed) speed.textContent = `${Math.round(Math.abs(velocity) * 3.6)} km/h`;
  if (clockEl) {
    const totalMinutes = Math.floor((((state.timeOfDay % 24) + 24) % 24) * 60);
    clockEl.textContent = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
  }
  const mission = state.mission;
  const hasMission = Boolean(mission?.id || mission?.title);
  if (missionBanner) missionBanner.hidden = !hasMission;
  if (missionTitle) missionTitle.textContent = mission?.title ?? '';
  if (missionObjective) missionObjective.textContent = mission?.objective ?? '';
  if (prompt) {
    let text = '';
    if (state.player.onFoot && vehicles.getNearbyVehicle?.(4)) text = 'E — Enter vehicle';
    else if (!state.player.onFoot) text = 'E — Exit vehicle';
    prompt.textContent = text;
    prompt.hidden = !text;
  }
  drawMinimap();
}

function drawMinimap() {
  const canvasMap = document.getElementById('minimap');
  if (!canvasMap || renderCount - lastMinimapFrame < 3) return;
  lastMinimapFrame = renderCount;
  const ctx = canvasMap.getContext('2d');
  if (!ctx) return;
  const width = canvasMap.width;
  const height = canvasMap.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#142329';
  ctx.fillRect(0, 0, width, height);

  const size = world.size || 1120;
  const mapX = (x) => ((x + size / 2) / size) * width;
  const mapY = (z) => ((z + size / 2) / size) * height;

  ctx.fillStyle = 'rgba(205,178,133,.13)';
  for (const block of world.blocks ?? []) {
    ctx.fillRect(mapX(block.minX), mapY(block.minZ), ((block.maxX - block.minX) / size) * width, ((block.maxZ - block.minZ) / size) * height);
  }
  // Roads: world.roadLines is an array of centre-line numbers, one per axis.
  ctx.strokeStyle = 'rgba(220,207,177,.9)';
  ctx.lineWidth = 3;
  for (const line of world.roadLines ?? []) {
    ctx.beginPath();
    ctx.moveTo(mapX(line), mapY(-size / 2));
    ctx.lineTo(mapX(line), mapY(size / 2));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mapX(-size / 2), mapY(line));
    ctx.lineTo(mapX(size / 2), mapY(line));
    ctx.stroke();
  }

  for (const car of traffic.cars) {
    const p = car.group.position;
    ctx.fillStyle = '#e8795b';
    ctx.fillRect(mapX(p.x) - 1.5, mapY(p.z) - 1.5, 3, 3);
  }
  if (state.mission?.id) {
    const point = world.missionPoints?.cafeDropoff ?? world.missionPoints?.parcelPickup;
    if (point) {
      const x = mapX(point.x);
      const y = mapY(point.z);
      ctx.fillStyle = '#ffd15a';
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fill();
    }
  }
  const pos = state.currentVehicle?.pos ?? state.player.pos;
  const heading = state.currentVehicle?.heading ?? state.player.heading;
  ctx.save();
  ctx.translate(mapX(pos.x), mapY(pos.z));
  ctx.rotate(-heading);
  ctx.fillStyle = '#fff2ce';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 5);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function updateTitleCamera() {
  if (shotFixedCamera) return;
  const elapsed = performance.now() * 0.00008;
  camera.position.set(Math.cos(elapsed) * 260, 90, Math.sin(elapsed) * 260);
  camera.lookAt(0, 30, 0);
}

function updateGame(dt) {
  // Shot mode freezes the simulation: staging is deterministic and the frame
  // the screenshot tool captures is exactly the staged one. HUD still syncs.
  if (shotMode) {
    if (fallbackHud) updateFallbackHud();
    else hud?.update?.();
    state.input.mouseDX = 0;
    state.input.mouseDY = 0;
    return;
  }
  const input = state.input;
  if (state.screen === 'play' && !state.paused) {
    if (state.player.onFoot && !state.currentVehicle) player.update(dt, input, world);
    vehicles.update(dt, input);
    player.group.visible = state.player.onFoot;
    traffic.update(dt);
    police?.update?.(dt);
    missions?.update?.(dt, input);
    combat?.update?.(dt, input);
    audio?.update?.(dt, state);
    state.timeOfDay = (state.timeOfDay + (dt * 0.25) / 60) % 24;
    if (state.player.health <= 0 && state.screen === 'play') setScreen('over');
  } else if (state.screen === 'title') {
    traffic.update(dt);
    updateTitleCamera();
  } else if (state.screen === 'paused') {
    player.group.visible = state.player.onFoot;
  }
  input.mouseDX = 0;
  input.mouseDY = 0;
  if (fallbackHud) updateFallbackHud();
  else hud?.update?.();
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
let shotPendingRenders = false;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  updateGame(dt);
  renderer.render(scene, camera);
  renderCount++;
  if (shotPendingRenders && renderCount >= 2) {
    shotPendingRenders = false;
    shotReady = true;
    window.__shotReady = true;
  }
}

syncOverlays();
if (shotName) {
  const applied = await applyShot(shotName);
  if (!applied) {
    shotMode = false;
    setScreen('title');
  } else {
    // Shot mode freezes updates; finalizeShot already synced visibility.
    shotPendingRenders = true;
  }
}
animate();
