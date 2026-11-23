import * as THREE from 'three';
import { createWorld, buildCity } from './world.js';
import { createPlayer } from './player.js';
import { createVehicleManager, materializeVehicle } from './vehicles.js';
import { createTraffic } from './traffic.js';

async function tryImport(path) {
  try {
    return await import(path);
  } catch (error) {
    console.warn(`Optional game module unavailable (${path}):`, error);
    return null;
  }
}

// A throwing optional (Builder B) module must never kill boot.
function safeCreate(label, fn) {
  try {
    return fn();
  } catch (error) {
    console.warn(`Optional game module failed (${label}):`, error);
    return null;
  }
}

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seed = shotName ? 731942 : (Number(params.get('seed')) || 24681357);
const state = {
  player: {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    heading: 0,
    onFoot: true,
    health: 100,
    cash: 250
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
    pointerLocked: false
  },
  seed
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffd9b0);
scene.fog = new THREE.Fog(0xffd9b0, 400, 1400);

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
camera.position.set(120, 55, 260);
camera.lookAt(0, 40, -40);

const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('game'),
  antialias: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const world = createWorld(seed);
world.state = state;
buildCity(scene, world);

const player = createPlayer(scene, world, camera);
const vehicles = createVehicleManager(scene, world, camera);
const traffic = createTraffic(scene, world);
vehicles.spawnCars(10);

const policeModule = await tryImport('./police.js');
const missionsModule = await tryImport('./missions.js');
const combatModule = await tryImport('./combat.js');
const hudModule = await tryImport('./hud.js');
const audioModule = await tryImport('./audio.js');
const saveModule = await tryImport('./save.js');
const shotsModule = await tryImport('./shots.js');

const police = policeModule?.createPolice
  ? safeCreate('police', () => policeModule.createPolice(scene, world, state, vehicles))
  : null;
const missions = missionsModule?.createMissions
  ? safeCreate('missions', () => missionsModule.createMissions(scene, world, state, vehicles, police))
  : null;
const combat = combatModule?.createCombat
  ? safeCreate('combat', () => combatModule.createCombat(scene, world, state, police, traffic))
  : null;
const hud = hudModule?.createHud
  ? safeCreate('hud', () => hudModule.createHud(state, world))
  : null;
const audio = audioModule?.createAudio
  ? safeCreate('audio', () => audioModule.createAudio())
  : null;

let fallbackHudFrame = 0;
const hudRoot = document.getElementById('hud');
const healthFill = document.getElementById('health-fill');
const cashNode = document.getElementById('cash');
const starsNode = document.getElementById('stars');
const speedNode = document.getElementById('speed');
const clockNode = document.getElementById('clock');
const missionBanner = document.getElementById('mission-banner');
const missionTitle = document.getElementById('mission-title');
const missionObjective = document.getElementById('mission-objective');
const promptNode = document.getElementById('prompt');
const minimap = document.getElementById('minimap');
const minimapCtx = minimap?.getContext('2d');

if (!hud) {
  if (starsNode) {
    starsNode.replaceChildren();
    for (let i = 0; i < 5; i++) {
      const star = document.createElement('span');
      star.className = 'wanted-star';
      star.textContent = '★';
      starsNode.appendChild(star);
    }
  }
  if (hudRoot) hudRoot.hidden = false;
}

function updateFallbackHud() {
  if (hud) return;
  if (healthFill) healthFill.style.width = `${THREE.MathUtils.clamp(state.player.health, 0, 100)}%`;
  if (cashNode) cashNode.textContent = `$${Math.max(0, Math.floor(state.player.cash))}`;
  if (starsNode) {
    [...starsNode.children].forEach((star, index) => {
      star.classList.toggle('active', index < state.wanted);
    });
  }
  const speed = Math.abs(state.currentVehicle?.speed || 0);
  if (speedNode) speedNode.textContent = `${Math.round(speed * 3.6)} km/h`;
  const totalMinutes = Math.floor((((state.timeOfDay % 24) + 24) % 24) * 60);
  if (clockNode) {
    clockNode.textContent = `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
  }
  const mission = state.mission;
  if (missionBanner) {
    const active = Boolean(mission?.id);
    missionBanner.hidden = !active;
    if (active) {
      if (missionTitle) missionTitle.textContent = mission.title || '';
      if (missionObjective) missionObjective.textContent = mission.objective || '';
    }
  }
  const nearby = state.player.onFoot ? vehicles.getNearbyVehicle?.(4.5) : null;
  if (promptNode) {
    promptNode.textContent = state.currentVehicle
      ? 'E — Exit vehicle'
      : nearby ? 'E — Enter vehicle' : '';
    promptNode.hidden = !promptNode.textContent;
  }

  fallbackHudFrame++;
  if (!minimapCtx || fallbackHudFrame % 3 !== 0) return;
  const size = minimap.width;
  const scale = size / 1120;
  const mapX = x => (x + 560) / 1120 * size;
  const mapZ = z => (z + 560) / 1120 * size;
  minimapCtx.clearRect(0, 0, size, size);
  minimapCtx.fillStyle = '#17201e';
  minimapCtx.fillRect(0, 0, size, size);

  minimapCtx.fillStyle = 'rgba(204, 171, 122, .13)';
  for (const block of world.blocks || []) {
    const minX = block.minX;
    const maxX = block.maxX;
    const minZ = block.minZ;
    const maxZ = block.maxZ;
    if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) continue;
    minimapCtx.fillRect(mapX(minX), mapZ(minZ), (maxX - minX) * scale, (maxZ - minZ) * scale);
  }
  minimapCtx.strokeStyle = 'rgba(230, 217, 191, .42)';
  minimapCtx.lineWidth = 1;
  for (const road of world.roadLines || []) {
    if (typeof road !== 'number') continue;
    minimapCtx.beginPath();
    minimapCtx.moveTo(mapX(road), 0);
    minimapCtx.lineTo(mapX(road), size);
    minimapCtx.stroke();
    minimapCtx.beginPath();
    minimapCtx.moveTo(0, mapZ(road));
    minimapCtx.lineTo(size, mapZ(road));
    minimapCtx.stroke();
  }

  const missionPoint = world.missionPoints?.cafeDropoff;
  if (state.mission?.id && missionPoint) {
    const x = mapX(missionPoint.x);
    const y = mapZ(missionPoint.z);
    minimapCtx.save();
    minimapCtx.translate(x, y);
    minimapCtx.rotate(Math.PI / 4);
    minimapCtx.fillStyle = '#f2c96b';
    minimapCtx.fillRect(-3, -3, 6, 6);
    minimapCtx.restore();
  }

  minimapCtx.fillStyle = 'rgba(231, 117, 83, .85)';
  for (const car of traffic.cars) {
    minimapCtx.beginPath();
    minimapCtx.arc(mapX(car.group.position.x), mapZ(car.group.position.z), 1.5, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  const position = state.currentVehicle?.pos || state.player.pos;
  const px = mapX(position.x);
  const py = mapZ(position.z);
  const heading = state.currentVehicle?.heading ?? state.player.heading;
  minimapCtx.save();
  minimapCtx.translate(px, py);
  minimapCtx.rotate(heading);
  minimapCtx.fillStyle = '#fff0ca';
  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -7);
  minimapCtx.lineTo(4.5, 5);
  minimapCtx.lineTo(0, 3);
  minimapCtx.lineTo(-4.5, 5);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.restore();
}

function syncHud() {
  if (hud?.update) {
    try {
      hud.update();
    } catch (error) {
      console.warn('HUD update failed:', error);
    }
  } else {
    updateFallbackHud();
  }
}

const titleScreen = document.getElementById('title-screen');
const pauseScreen = document.getElementById('pause-screen');
const overScreen = document.getElementById('over-screen');
const statusNode = document.getElementById('status');

function syncScreens() {
  if (titleScreen) titleScreen.hidden = state.screen !== 'title';
  if (pauseScreen) pauseScreen.hidden = state.screen !== 'paused';
  if (overScreen) overScreen.hidden = state.screen !== 'over';
  if (hudRoot) hudRoot.hidden = state.screen === 'title';
  if (statusNode) {
    statusNode.textContent = state.screen === 'play'
      ? 'Game started'
      : state.screen === 'paused'
        ? 'Game paused'
        : state.screen === 'over'
          ? 'Game over'
          : 'Title screen';
  }
}

function setScreen(screen) {
  state.screen = screen;
  state.paused = screen === 'paused';
  syncScreens();
}

function startGame() {
  if (state.screen === 'over') {
    state.player.health = 100;
    state.player.cash = 250;
    state.player.onFoot = true;
    state.currentVehicle = null;
    player.respawn?.();
  }
  setScreen('play');
  audio?.start?.();
}

function togglePause() {
  if (state.screen === 'play') {
    setScreen('paused');
    document.exitPointerLock?.();
  } else if (state.screen === 'paused') {
    setScreen('play');
  }
}

function saveGame() {
  if (saveModule?.saveGame) return saveModule.saveGame(state, world);
  if (saveModule?.save) return saveModule.save(state, world);
  // Inline fallback persistence for installations without the optional save module.
  localStorage.setItem('sunline-save-v1', JSON.stringify({
    player: state.player,
    currentVehicle: state.currentVehicle,
    wanted: state.wanted,
    mission: state.mission,
    timeOfDay: state.timeOfDay,
    seed: state.seed
  }));
  return true;
}

function loadGame() {
  if (saveModule?.loadGame) return saveModule.loadGame(state, world);
  if (saveModule?.load) return saveModule.load(state, world);
  // Inline fallback persistence for installations without the optional save module.
  const data = localStorage.getItem('sunline-save-v1');
  if (!data) return false;
  try {
    const saved = JSON.parse(data);
    if (saved.player) Object.assign(state.player, saved.player);
    state.currentVehicle = saved.currentVehicle || null;
    state.wanted = saved.wanted || 0;
    state.mission = saved.mission || { id: null, title: '', objective: '', stage: 0 };
    state.timeOfDay = saved.timeOfDay || 17.25;
    if (state.currentVehicle) materializeVehicle(state.currentVehicle);
    return true;
  } catch (error) {
    console.warn('Could not load save:', error);
    return false;
  }
}

document.getElementById('title-start')?.addEventListener('click', startGame);
document.getElementById('resume-button')?.addEventListener('click', togglePause);
document.getElementById('restart-button')?.addEventListener('click', () => {
  state.currentVehicle = null;
  state.player.onFoot = true;
  player.respawn?.();
  state.mission = { id: null, title: '', objective: '', stage: 0 };
  state.wanted = 0;
  startGame();
});
document.getElementById('save-button')?.addEventListener('click', () => {
  const result = saveGame();
  const label = document.getElementById('save-status');
  if (label) label.textContent = result === false ? 'No save available yet.' : 'Game saved.';
});
document.getElementById('load-button')?.addEventListener('click', () => {
  const result = loadGame();
  const label = document.getElementById('save-status');
  if (label) label.textContent = result ? 'Save loaded.' : 'No save available yet.';
});
document.getElementById('over-restart')?.addEventListener('click', () => {
  state.currentVehicle = null;
  state.player.onFoot = true;
  player.respawn?.();
  state.mission = { id: null, title: '', objective: '', stage: 0 };
  state.wanted = 0;
  startGame();
});

function onKeyDown(event) {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.code) &&
      (state.screen === 'play' || state.screen === 'paused')) {
    event.preventDefault();
  }
  state.input.keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'Escape') {
    if (state.screen === 'play' || state.screen === 'paused') togglePause();
    return;
  }
  if (event.code === 'KeyP' && (state.screen === 'play' || state.screen === 'paused')) {
    togglePause();
    return;
  }
  if ((event.code === 'Enter' || event.code === 'Space') &&
      (state.screen === 'title' || state.screen === 'over')) {
    startGame();
  }
}

function onKeyUp(event) {
  state.input.keys.delete(event.code);
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

renderer.domElement.addEventListener('click', () => {
  if (state.screen === 'play' && !state.input.pointerLocked) {
    try {
      const result = renderer.domElement.requestPointerLock?.();
      result?.catch?.(() => {});
    } catch {
      // Pointer lock is optional; mouse drag remains available.
    }
  }
});
document.addEventListener('pointerlockchange', () => {
  state.input.pointerLocked = document.pointerLockElement === renderer.domElement;
});
renderer.domElement.addEventListener('mousedown', event => {
  state.input.mouseButtons.add(event.button);
});
window.addEventListener('mouseup', event => {
  state.input.mouseButtons.delete(event.button);
});
window.addEventListener('mousemove', event => {
  if (state.input.pointerLocked || state.input.mouseButtons.size > 0) {
    state.input.mouseDX += event.movementX || 0;
    state.input.mouseDY += event.movementY || 0;
  }
});

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
}
window.addEventListener('resize', resize);

const shotBeaconMeshes = [];

function createBeacon(point) {
  if (!point) return;
  const group = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 1.15, 3.8, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xf4c96b,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  glow.position.y = 1.9;
  group.add(glow);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.35, 0.12, 8, 24),
    new THREE.MeshStandardMaterial({
      color: 0xffd374,
      emissive: 0xa87519,
      emissiveIntensity: 0.8,
      roughness: 0.35
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.2;
  group.add(ring);
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 0.85, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffdf88,
      emissive: 0x8e6015,
      emissiveIntensity: 0.65
    })
  );
  marker.position.y = 4.15;
  group.add(marker);
  group.position.set(point.x, 0, point.z);
  scene.add(group);
  shotBeaconMeshes.push(group);
}

function stageBuiltinShot(name) {
  if (name === 'start') {
    setScreen('title');
    camera.position.set(120, 55, 260);
    camera.lookAt(0, 40, -40);
    return true;
  }

  if (name === 'drive') {
    setScreen('play');
    const car = vehicles.createCar('sports', -80, 4.5, Math.PI / 2);
    vehicles.enterVehicle(car);
    state.input.keys.add('KeyW');
    for (let i = 0; i < 120; i++) {
      vehicles.update(1 / 60, state.input);
      traffic.update(1 / 60);
    }
    state.input.keys.delete('KeyW');
    state.currentVehicle.speed = Math.max(14, state.currentVehicle.speed || 0);
    return true;
  }

  if (name === 'chase') {
    setScreen('play');
    state.wanted = 3;
    const sedan = vehicles.createCar('sedan', -40, 4.5, Math.PI / 2);
    vehicles.enterVehicle(sedan);
    const patrol = vehicles.createCar('police', -70, -4.5, Math.PI / 2);
    patrol.speed = 16;
    state.input.keys.add('KeyW');
    for (let i = 0; i < 120; i++) {
      vehicles.update(1 / 60, state.input);
      traffic.update(1 / 60);
      patrol.pos.x += 16 / 60;
      patrol.group?.position.set(patrol.pos.x, 0, patrol.pos.z);
    }
    state.input.keys.delete('KeyW');
    if (state.currentVehicle) state.currentVehicle.speed = Math.max(16, state.currentVehicle.speed || 0);
    return true;
  }

  if (name === 'mission') {
    setScreen('play');
    state.mission = {
      id: 'first-light',
      title: 'First Light Run',
      objective: 'Deliver the parcel to Café Lumen on Sunwash Beach',
      stage: 1
    };
    const pickup = world.missionPoints?.parcelPickup;
    const dropoff = world.missionPoints?.cafeDropoff;
    if (pickup) {
      player.setPosition(pickup.x, pickup.z);
      state.player.onFoot = true;
      state.currentVehicle = null;
    }
    createBeacon(dropoff);
    const target = pickup || { x: 0, z: 0 };
    camera.position.set(target.x + 28, 17, target.z + 34);
    camera.lookAt(target.x, 4, target.z - 10);
    return true;
  }

  return false;
}

function finalizeShot() {
  if (state.currentVehicle && !state.currentVehicle.group) {
    materializeVehicle(state.currentVehicle);
  }
  const cameraPosition = camera.position;
  for (const car of traffic.cars) {
    if (car.group.position.distanceTo(cameraPosition) < 10) car.group.visible = false;
  }
  player.group.visible = state.player.onFoot;
  syncScreens();
}

let shotReady = false;
async function applyShot(name) {
  if (!name) return false;
  let staged = false;
  if (shotsModule?.applyShot) {
    try {
      staged = Boolean(await shotsModule.applyShot(name, {
        state, world, player, vehicles, traffic, police, missions, combat, hud, camera
      }));
    } catch (error) {
      console.warn('Optional shot staging failed; using built-in staging:', error);
    }
  }
  if (!staged) staged = stageBuiltinShot(name);
  if (staged) finalizeShot();
  return staged;
}

window.__game = {
  state, world, player, vehicles, traffic, scene, renderer, camera,
  police, missions, combat, hud, audio, applyShot,
  get shotReady() { return shotReady; }
};

const clock = new THREE.Clock();
let titleOrbit = 0;
let prevE = false;

async function prepareShot() {
  const staged = await applyShot(shotName);
  if (!staged) return;
  player.group.visible = state.player.onFoot;
  syncHud();
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  shotReady = true;
  window.__shotReady = true;
}

if (shotName) {
  await prepareShot();
} else {
  syncScreens();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (!shotName) {
    if (state.screen === 'play' && !state.paused) {
      state.timeOfDay = (state.timeOfDay + dt * (0.25 / 60)) % 24;
      if (state.player.onFoot) player.update(dt, state.input, world);
      const hadVehicle = state.currentVehicle;
      vehicles.update(dt, state.input);
      // E-to-enter runs AFTER vehicles.update: vehicles.update consumed the
      // E edge for exit while driving, so entering here cannot instantly
      // re-trigger an exit on the same frame. Conversely, if this frame's
      // update just exited a vehicle (hadVehicle set, now null), the same
      // E press must not instantly re-enter it.
      const ePressed = state.input.keys.has('KeyE');
      if (ePressed && !prevE && !hadVehicle && state.player.onFoot && !state.currentVehicle) {
        const nearby = vehicles.getNearbyVehicle?.(4.5);
        if (nearby) {
          vehicles.setCameraYaw?.(player.getCameraYaw?.() ?? 0);
          vehicles.enterVehicle(nearby);
        }
      }
      prevE = ePressed;
      traffic.update(dt);
      police?.update?.(dt);
      missions?.update?.(dt, state.input);
      combat?.update?.(dt, state.input);
      audio?.update?.(dt, state);
      player.group.visible = state.player.onFoot;

      if (state.player.health <= 0 && state.screen === 'play') {
        setScreen('over');
      }
    } else if (state.screen === 'title') {
      traffic.update(dt);
      titleOrbit += dt * 0.055;
      camera.position.set(Math.sin(titleOrbit) * 260, 90, Math.cos(titleOrbit) * 260);
      camera.lookAt(0, 30, 0);
    }

    state.input.mouseDX = 0;
    state.input.mouseDY = 0;
  }

  syncHud();
  renderer.render(scene, camera);
}

animate();
