// shots.js — deterministic ?shot= staging for Sunline: City of Tides.
// Fresh implementation from design-r3.md sections 12 and 14.
// applyShot(name, context) -> true when the name is recognised, else false.
// The shot-mode sim is FROZEN: update() never runs, so every staged value
// (car, player pos/heading, wanted, mission, camera) is set synchronously
// here. Cars are placed with placePlayerInCar / setCarPosition, which sync
// state.player.pos/heading to the car — that is what keeps the minimap
// arrow honest in a frozen frame.
const EAST = Math.PI / 2;

function setCam(camera, x, y, z, lx, ly, lz) {
  if (!camera) return;
  if (camera.position && camera.position.set) camera.position.set(x, y, z);
  if (camera.lookAt) camera.lookAt(lx, ly, lz);
}

function exitIfDriving(state, vehicles) {
  try {
    if (state.currentVehicle && vehicles && typeof vehicles.exitVehicle === 'function') {
      vehicles.exitVehicle();
    }
  } catch (e) { /* already on foot */ }
}

function placeCarInShot(state, vehicles, model, x, z, heading) {
  exitIfDriving(state, vehicles);
  let car = null;
  if (vehicles && typeof vehicles.placePlayerInCar === 'function') {
    car = vehicles.placePlayerInCar(model, x, z, heading, 0);
  }
  if (!car && vehicles && typeof vehicles.spawnCarAt === 'function') {
    car = vehicles.spawnCarAt(model, x, z, heading);
    if (car && vehicles.setCarPosition) vehicles.setCarPosition(car, x, z, heading, state);
    if (car && vehicles.enterVehicle) vehicles.enterVehicle(car.id);
  }
  return car;
}

function placePlayerOnFoot(state, player, x, z, heading) {
  exitIfDriving(state, { exitVehicle: () => {} });
  state.player.pos.x = x;
  state.player.pos.y = 0;
  state.player.pos.z = z;
  state.player.heading = heading;
  state.player.onFoot = true;
  state.currentVehicle = null;
  if (player && player.group) {
    player.group.position.set(x, 0, z);
    player.group.rotation.y = -heading;
  }
}

function moveTrafficCar(traffic, i, x, z, heading) {
  const car = traffic && traffic.cars ? traffic.cars[i] : null;
  if (!car) return;
  car.x = x;
  car.z = z;
  car.heading = heading;
  car.speed = 0;
  if (car.mesh) {
    car.mesh.position.set(x, 0, z);
    car.mesh.rotation.y = -heading;
  }
}

function movePed(traffic, i, x, z, heading) {
  const ped = traffic && traffic.peds ? traffic.peds[i] : null;
  if (!ped) return null;
  ped.x = x;
  ped.z = z;
  if (heading !== undefined) ped.heading = heading;
  if (ped.mesh) {
    ped.mesh.position.set(x, 0, z);
    if (heading !== undefined) ped.mesh.rotation.y = -heading;
  }
  return ped;
}

function playScreen(state) {
  state.screen = 'play';
  state.paused = false;
  state.timeOfDay = 17.25;
}

export function applyShot(name, context) {
  const { state, world, player, vehicles, traffic, police, missions, camera } = context || {};
  if (!state || !name) return false;
  state._dialogue = null;

  if (name === 'start') {
    state.screen = 'title';
    state.paused = false;
    state.timeOfDay = 17.25;
    state.wanted = 0;
    state.mission = { id: null, title: '', objective: '', stage: 0 };
    // Proven framing: from over the ocean looking NW — teal ocean in the
    // foreground, beach + palms + docks at the sides, city band mid-frame.
    setCam(camera, 250, 60, 850, -80, 62, -100);
    return true;
  }

  if (name === 'drive') {
    playScreen(state);
    state.wanted = 0;
    if (police && police.clear) police.clear();
    if (missions && missions.resetMission) missions.resetMission();
    // Kestrel R on Seaglass Boulevard in Glassline, eastbound lane.
    const car = placeCarInShot(state, vehicles, 'Kestrel R', -40, 4.5, EAST);
    if (!car) return false;
    // Traffic ahead and nearby so the street reads as alive.
    moveTrafficCar(traffic, 0, -15, 4.5, EAST);
    moveTrafficCar(traffic, 1, 5, 4.5, EAST);
    moveTrafficCar(traffic, 2, 28, 4.5, EAST);
    moveTrafficCar(traffic, 3, 20, -4.5, -EAST);
    // Chase view from behind the car.
    setCam(camera, -52, 5, 8, -32, 1.5, 4.5);
    return true;
  }

  if (name === 'chase') {
    playScreen(state);
    if (missions && missions.resetMission) missions.resetMission();
    // Kestrel R on the broad central road, eastbound; wanted 3.
    const car = placeCarInShot(state, vehicles, 'Kestrel R', -40, 4.5, EAST);
    if (!car) return false;
    if (police && police.setWanted) police.setWanted(3);
    else state.wanted = 3;
    // Cruisers BEHIND the player on valid road lanes, outside collision
    // range, both heading east in pursuit.
    if (police && police.placeUnit) {
      police.placeUnit(-56, 4.5, EAST, 0);
      police.placeUnit(-70, -4.5, EAST, 1);
    }
    state.wanted = 3;
    // Proven cover framing: closer / lower, trailing cruiser mid-left.
    const px = state.player.pos.x;
    setCam(camera, px - 44, 14, -14, px + 6, 1.2, 2);
  if (state.currentVehicle) state.currentVehicle.speed = 16; // staged chase speed (58 km/h)
    return true;
  }

  if (name === 'mission') {
    playScreen(state);
    state.wanted = 0;
    if (police && police.clear) police.clear();
    // Spec position: [-8, -112], on foot at a central intersection.
    placePlayerOnFoot(state, player, -8, -112, -0.5);
    if (missions && missions.startMission) missions.startMission('first-light');
    state._dialogue = { text: 'First Light Run: a sealed parcel, Palm Court to the beachfront cafe. 150 seconds. Go.', until: Date.now() + 9000 };
    // Three-quarter view: player centred, Glassline rising behind.
    setCam(camera, -2, 6, -96, -8, 1.5, -112);
    return true;
  }

  if (name === 'street') {
    playScreen(state);
    state.wanted = 0;
    if (police && police.clear) police.clear();
    if (missions && missions.resetMission) missions.resetMission();
    // On foot on the north sidewalk of the -112 road, peds + traffic near.
    placePlayerOnFoot(state, player, 14, -100, Math.PI * 0.9);
    movePed(traffic, 0, 6, -100.5, 0);
    movePed(traffic, 1, 20, -100.5, Math.PI);
    movePed(traffic, 2, -6, -100.5, 0);
    moveTrafficCar(traffic, 0, -30, -107.5, EAST);
    moveTrafficCar(traffic, 1, 12, -116.5, -EAST);
    setCam(camera, 20, 3, -92, 8, 1.5, -104);
    return true;
  }

  if (name === 'combat') {
    playScreen(state);
    state.wanted = 0;
    if (police && police.clear) police.clear();
    if (missions && missions.resetMission) missions.resetMission();
    // Face-off on foot: the nearest ped knocked flat beside Nia.
    placePlayerOnFoot(state, player, 14, -100, Math.PI / 2);
    const ped = movePed(traffic, 0, 17, -98, 0);
    if (ped && ped.mesh) {
      ped.mesh.rotation.x = -Math.PI / 2;
      ped.down = true;
      ped.downT = 999;
    }
    movePed(traffic, 1, 6, -100.5, 0);
    moveTrafficCar(traffic, 0, -30, -107.5, EAST);
    setCam(camera, 21, 4.5, -90, 13, 1.2, -100);
    return true;
  }

  return false;
}
