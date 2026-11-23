// Deterministic screenshot staging (design §14). Written fresh 2026-11-24
// (Builder B). Fixed seed 731942, fixed time, NO Math.random() in shot setup.
// main.js defers to applyShot first; its built-in staging is the fallback.
// Forward = (sin h, 0, -cos h); camera behind the car = focus - fwd * d.
import * as THREE from 'three';

const SHOT_SEED = 731942;

function forwardForHeading(heading) {
  return { x: Math.sin(heading), z: -Math.cos(heading) };
}

function chaseCamera(camera, focus, heading, dist = 12, height = 7) {
  const fwd = forwardForHeading(heading);
  camera.position.set(focus.x - fwd.x * dist, height, focus.z - fwd.z * dist);
  camera.lookAt(focus.x + fwd.x * 8, 2.2, focus.z + fwd.z * 8);
}

function placePlayerCar(ctx, type, x, z, heading) {
  const { state, vehicles } = ctx;
  if (state.currentVehicle) vehicles.exitVehicle?.();
  const car = vehicles.createCar(type, x, z, heading);
  vehicles.enterVehicle(car);
  return car;
}

function stageTrafficAhead(ctx, car, heading) {
  // Deterministic traffic ahead on the same road, alternating lanes.
  const ahead = [28, 52, 78];
  const cars = ctx.traffic?.cars ?? [];
  for (let i = 0; i < Math.min(ahead.length, cars.length); i++) {
    const t = cars[i];
    t.group.position.set(car.pos.x + ahead[i], 0, i % 2 === 0 ? 4.5 : -4.5);
    t.group.rotation.y = -heading;
    t.dist = 0; // frozen in shot mode; position is what the frame shows
  }
}

export function applyShot(name, ctx) {
  const { state, world, player, vehicles, traffic, police, missions, camera } = ctx;
  if (!state || !world || !camera || !vehicles) return false;
  state.timeOfDay = 17.25;
  state.paused = false;
  state.input?.keys?.clear?.();
  state.seed = SHOT_SEED;

  if (name === 'start') {
    state.screen = 'title';
    state.wanted = 0;
    police?.clear?.();
    // Low camera inside the southern city looking north: Glassline
    // towers flank the title card and fill the frame (the ocean-angle
    // shots left the top half as flat sky).
    camera.position.set(110, 50, 300);
    camera.lookAt(0, 42, -60);
    return true;
  }

  if (name === 'drive') {
    state.screen = 'play';
    state.wanted = 0;
    police?.clear?.();
    // Kestrel R, Seaglass Boulevard eastbound RIGHT lane (z = +4.5).
    const heading = Math.PI / 2;
    const car = placePlayerCar(ctx, 'sports', -80, 4.5, heading);
    // Staged speed cap: the old staging loop ran the car to top speed.
    // A calm 8 u/s (~29 km/h) keeps the frame readable.
    car.speed = 8;
    stageTrafficAhead(ctx, car, heading);
    chaseCamera(camera, car.pos, heading);
    return true;
  }

  if (name === 'chase') {
    state.screen = 'play';
    const heading = Math.PI / 2;
    const car = placePlayerCar(ctx, 'sports', -40, 4.5, heading);
    car.speed = 14;
    // Wanted 3 via the real police API: spawns two visible cruisers even
    // in ?shot= staging mode (setWanted meshes are added immediately).
    police?.setWanted?.(3);
    // Deterministic framing: cruiser 1 fixed offset close behind (4
    // behind, 2.5 left — fully in frame between camera and player);
    // cruiser 2 far ahead in the far lane, so only one unit reads as
    // the pursuer.
    police?.placeUnit?.(0, 4, 2.5);
    police?.placeUnit?.(1, -26, 6);
    stageTrafficAhead(ctx, car, heading);
    // Polish: slightly lower + closer than the B framing (12 / 7) so the
    // red player car reads bigger and the shot is less top-down.
    chaseCamera(camera, car.pos, heading, 11, 6);
    return true;
  }

  if (name === 'mission') {
    state.screen = 'play';
    state.wanted = 0;
    police?.clear?.();
    if (state.currentVehicle) vehicles.exitVehicle?.();
    missions?.startMission?.('first-light');
    // Player on foot beside the parcel pickup marker, city behind.
    // Camera close and low so Nia and the gold beacon read large.
    const pickup = world.missionPoints?.parcelPickup ?? { x: -112, z: -124 };
    player.setPosition?.(pickup.x + 4, pickup.z + 3);
    state.player.pos.x = pickup.x + 4;
    state.player.pos.z = pickup.z + 3;
    state.player.heading = Math.PI / 2;
    if (player.group) player.group.rotation.y = -state.player.heading;
    camera.position.set(pickup.x - 7, 5.5, pickup.z + 10);
    camera.lookAt(pickup.x + 3, 2, pickup.z - 1);
    return true;
  }

  if (name === 'street') {
    state.screen = 'play';
    state.wanted = 0;
    police?.clear?.();
    if (state.currentVehicle) vehicles.exitVehicle?.();
    // On foot on the Beacon Avenue sidewalk, traffic + pedestrians in frame.
    player.setPosition?.(11.5, 24);
    state.player.pos.x = 11.5;
    state.player.pos.z = 24;
    state.player.heading = 0;
    if (player.group) player.group.rotation.y = 0;
    // Stage traffic on Beacon Ave ahead (north) and peds on both sidewalks
    // near Nia — the ambient spread is too sparse to read in a still.
    const cars = traffic?.cars ?? [];
    const carSpots = [
      { x: -4.5, z: -18 }, { x: 4.5, z: -30 }, { x: -4.5, z: -52 }, { x: 40, z: 4.5 },
    ];
    for (let i = 0; i < Math.min(carSpots.length, cars.length); i++) {
      const t = cars[i];
      t.group.position.set(carSpots[i].x, 0, carSpots[i].z);
      // Beacon Ave (x = ±4.5): +4.5 northbound (heading 0), -4.5
      // southbound (heading PI); Seaglass car at (40, 4.5) eastbound.
      t.group.rotation.y = carSpots[i].x === 40 ? -Math.PI / 2
        : carSpots[i].x > 0 ? 0 : -Math.PI;
    }
    const peds = traffic?.pedestrians ?? [];
    const pedSpots = [
      { x: 11.5, z: 8 }, { x: 11.5, z: 16 }, { x: -11.5, z: 12 },
      { x: -11.5, z: 20 }, { x: -11.5, z: -6 }, { x: 11.5, z: -14 },
    ];
    for (let i = 0; i < Math.min(pedSpots.length, peds.length); i++) {
      const p = peds[i];
      p.group.position.set(pedSpots[i].x, 0, pedSpots[i].z);
      p.group.rotation.y = (i % 2 === 0) ? 0 : Math.PI;
    }
    // A parked car right beside Nia: the HUD "E — Enter vehicle" prompt
    // gives the shot an interaction target, not just walking.
    const parked = vehicles.cars.find((c) => c && c !== state.currentVehicle);
    if (parked) {
      parked.pos.x = 8.5;
      parked.pos.z = 22;
      parked.heading = 0;
      if (parked.group) {
        parked.group.position.set(8.5, 0, 22);
        parked.group.rotation.y = 0;
      }
    }
    // Low third-person camera close behind Nia, looking north up the avenue.
    // (Polish pull-back to (12, 3.1, 32) reverted: Luna A/B said it made
    // Nia and the car read smaller; B's framing stands.)
    camera.position.set(11.5, 2.6, 30);
    camera.lookAt(6, 1.4, 0);
    return true;
  }

  return false;
}
