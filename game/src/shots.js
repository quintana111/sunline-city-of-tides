// Deterministic ?shot= staging for Sunline: City of Tides.
// Shot mode freezes the simulation, so every setup PLACES objects synchronously
// (meshes, positions, camera, HUD state) and never simulates after staging.
// No Math.random(); no wall-clock time. East = +PI/2, north = 0;
// forward = (sin h, 0, -cos h); mesh rotation.y = -heading.
function forwardFor(heading) {
  return {
    x: Math.sin(heading),
    z: -Math.cos(heading),
  };
}

function placeCameraBehind(camera, carPos, heading, dist, height, lookAhead) {
  if (!camera || !carPos) return;
  const forward = forwardFor(heading);
  const x = Number.isFinite(carPos.x) ? carPos.x : 0;
  const y = Number.isFinite(carPos.y) ? carPos.y : 0;
  const z = Number.isFinite(carPos.z) ? carPos.z : 0;
  camera.position.set(
    x - forward.x * dist,
    y + height,
    z - forward.z * dist,
  );
  camera.lookAt(
    x + forward.x * lookAhead,
    y + 1.5,
    z + forward.z * lookAhead,
  );
}

function setScreenPlay(state) {
  state.screen = 'play';
}

function setPlayerPosition(state, player, x, z, heading, onFoot) {
  if (state.player) {
    state.player.pos = { x, y: 0, z };
    state.player.heading = heading;
    state.player.onFoot = onFoot;
  }

  try {
    player?.setPosition?.(x, z);
  } catch {
    // Keep staging independent of optional player helpers.
  }

  if (player?.group) {
    player.group.position.set(x, 0, z);
    player.group.rotation.y = -heading;
  }
}

function setCarPosition(car, x, z, heading) {
  if (!car) return;
  if (car.pos && typeof car.pos === 'object') {
    car.pos.x = x;
    car.pos.z = z;
  }
  if (car.group) {
    car.group.position.set(x, car.group.position.y || 0, z);
    car.group.rotation.y = -heading;
  }
  car.heading = heading;
}

function getCarPosition(car) {
  const groupPos = car?.group?.position;
  const pos = car?.pos || {};
  return {
    x: Number.isFinite(groupPos?.x) ? groupPos.x : (Number.isFinite(pos.x) ? pos.x : 0),
    y: Number.isFinite(groupPos?.y) ? groupPos.y : (Number.isFinite(pos.y) ? pos.y : 0),
    z: Number.isFinite(groupPos?.z) ? groupPos.z : (Number.isFinite(pos.z) ? pos.z : 0),
  };
}

function putPedestrian(pedestrian, x, z, heading) {
  if (!pedestrian?.group) return;
  pedestrian.group.position.set(x, 0, z);
  pedestrian.group.rotation.y = -heading;
}

export function applyShot(name, context = {}) {
  const recognised = new Set(['start', 'drive', 'chase', 'mission', 'street', 'combat']);
  if (!recognised.has(name)) return false;

  try {
    const {
      state,
      world,
      player,
      vehicles,
      traffic,
      police,
      missions,
      camera,
    } = context;

    if (!state) return true;

    state.paused = false;
    if (state.input) {
      try {
        state.input.keys?.clear?.();
        state.input.mouseDX = 0;
        state.input.mouseDY = 0;
      } catch {
        // Input may be absent or supplied by a minimal test context.
      }
    }
    state.timeOfDay = 17.25;

    if (name === 'start') {
      state.screen = 'title';
      if (camera) {
        // Lower and closer than the first pass: less empty sky, the
        // Glassline skyline fills the frame behind the title card.
        camera.position.set(100, 48, 230);
        camera.lookAt(0, 32, -50);
      }
      return true;
    }

    setScreenPlay(state);

    if (name === 'drive' || name === 'chase') {
      state.wanted = 0;
      let car = null;

      if (vehicles?.createCar) {
        try {
          car = vehicles.createCar('sports', -80, 4.5, Math.PI / 2);
        } catch {
          car = null;
        }
      }

      if (car) {
        try {
          if (vehicles.enterVehicle) vehicles.enterVehicle(car);
          else {
            state.currentVehicle = car;
            if (state.player) state.player.onFoot = false;
          }
        } catch {
          state.currentVehicle = car;
          if (state.player) state.player.onFoot = false;
        }
        if (state.player) {
          state.player.pos = { x: -80, y: 0, z: 4.5 };
          state.player.heading = Math.PI / 2;
          state.player.onFoot = false;
        }
        car.speed = 0;

        const keys = state.input?.keys;
        try {
          keys?.add?.('KeyW');
          for (let i = 0; i < 120; i++) {
            vehicles.update?.(1 / 60, state.input);
            traffic?.update?.(1 / 60);
          }
        } catch {
          // The car remains staged if a simulation subsystem is unavailable.
        } finally {
          try {
            keys?.delete?.('KeyW');
          } catch {
            // No-op.
          }
        }

        const playerPos = getCarPosition(car);
        if (state.player) {
          state.player.pos = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
          state.player.heading = Math.PI / 2;
          state.player.onFoot = false;
        }

        if (name === 'drive' && vehicles.createCar) {
          // Traffic ahead on the same road so the shot reads as a drive.
          const trafficCars = [
            { x: playerPos.x + 22, z: 4.5 },
            { x: playerPos.x + 46, z: -4.5 },
            { x: playerPos.x + 70, z: 4.5 },
          ];
          for (const point of trafficCars) {
            try {
              const staged = vehicles.createCar('sedan', point.x, point.z, Math.PI / 2);
              if (staged) {
                setCarPosition(staged, point.x, point.z, Math.PI / 2);
                staged.speed = 0;
              }
            } catch {
              // Continue staging the remaining cars.
            }
          }
        }

        if (name === 'chase') {
          try {
            police?.setWanted?.(3);
          } catch {
            // Place any available units below even if wanted-level setup fails.
          }

          // Trailing cruiser close behind-left (large in frame, light bar
          // visible), second cruiser ahead in the player's own lane.
          // Player ends mid-block (~x -52, between intersections at -112
          // and 0), never on a crosswalk.
          const chasePositions = [
            { x: playerPos.x - 8, z: -4.5 },
            { x: playerPos.x + 26, z: 4.5 },
          ];
          for (let i = 0; i < chasePositions.length; i++) {
            const point = chasePositions[i];
            try {
              police?.placeUnit?.(point.x, point.z, Math.PI / 2, i);
            } catch {
              // The existing unit meshes are positioned directly below if possible.
            }
          }

          state.wanted = 3;
          const units = police?.units || [];
          for (let i = 0; i < Math.min(2, units.length); i++) {
            const unit = units[i];
            const point = chasePositions[i];
            if (!unit) continue;
            setCarPosition(unit.vehicle, point.x, point.z, Math.PI / 2);
            if (unit.group) {
              unit.group.position.set(point.x, unit.group.position.y || 0, point.z);
              unit.group.rotation.y = -Math.PI / 2;
            }
            if (unit.pos && typeof unit.pos === 'object') {
              unit.pos.x = point.x;
              unit.pos.z = point.z;
            }
            unit.heading = Math.PI / 2;
            if (unit.vehicle) unit.vehicle.speed = 16;
          }
        }

        // Chase camera, offset to the north side so the trailing cruiser in
        // the westbound lane sits large in the left foreground with the red
        // car centre-right and the second cruiser ahead. A straight
        // behind-the-car camera puts the left-lane cruiser out of frame;
        // aiming at the player car alone pushes the cruiser to the bottom
        // edge, so the look target sits between cruiser and player. Kept
        // tight (probe C8): cruiser ~245 px wide, player ~110 px.
        if (camera) {
          camera.position.set(playerPos.x - 17, 6, -1.5);
          camera.lookAt(playerPos.x + 3, 1.5, 2.5);
        }
      }
      return true;
    }

    if (name === 'mission') {
      state.wanted = 0;
      try {
        missions?.startMission?.('first-light');
      } catch {
        // The shot can still be staged without mission systems.
      }

      if (!state.mission) state.mission = {};
      state.mission.timeLeft = 150;
      state.mission.message = {
        speaker: 'Mara',
        text: 'Parcel is at the north corner. Café Lumen is waiting — 150 seconds, Nia. Do not dawdle.',
      };
      state.mission.stage = 1;

      // Player car 12 units south of the pickup on the same road (x=-112),
      // heading north toward the gold beacon — the beacon must not sit
      // inside the car. Speed 8 reads as driving to the pickup.
      let car = null;
      try {
        car = vehicles?.createCar?.('sports', -112, -136, 0) || null;
      } catch {
        car = null;
      }
      if (car) {
        try {
          if (vehicles?.enterVehicle) vehicles.enterVehicle(car);
          else state.currentVehicle = car;
        } catch {
          state.currentVehicle = car;
        }
        car.speed = 8;
        if (state.player) {
          state.player.pos = { x: -112, y: 0, z: -136 };
          state.player.heading = 0;
          state.player.onFoot = false;
        }
      }

      if (camera) {
        // Centred, slightly high view down the road (probe M7): the car sits
        // centre-frame above the "E — Exit vehicle" prompt, the shrunk gold
        // beacon marks the pickup ahead-right, and the route reads clearly.
        // A centred camera with the tall beacon put the car under the prompt.
        camera.position.set(-136, 5, -124);
        camera.lookAt(-112, 0, -138);
      }
      return true;
    }

    if (name === 'street') {
      state.wanted = 0;
      setPlayerPosition(state, player, 0, 24, Math.PI, true);

      const pedestrians = traffic?.pedestrians || [];
      const pedPositions = [
        { x: 5, z: 18, heading: 0.4 },
        { x: -4, z: 17, heading: -0.35 },
        { x: 10, z: 19, heading: 0.9 },
      ];
      for (let i = 0; i < Math.min(3, pedestrians.length); i++) {
        putPedestrian(
          pedestrians[i],
          pedPositions[i].x,
          pedPositions[i].z,
          pedPositions[i].heading,
        );
      }

      const trafficCars = traffic?.cars || [];
      const stagedTraffic = [
        { x: 10, z: 4.5 },
        { x: 26, z: -4.5 },
      ];
      for (let i = 0; i < Math.min(2, trafficCars.length); i++) {
        const item = trafficCars[i];
        const group = item?.group;
        if (group) {
          group.visible = true;
          group.position.set(stagedTraffic[i].x, group.position.y || 0, stagedTraffic[i].z);
          group.rotation.y = -Math.PI / 2;
        }
        item.heading = Math.PI / 2;
      }

      const taxi = trafficCars.find((item) => item?.type === 'taxi');
      if (taxi?.group) {
        taxi.group.visible = true;
        taxi.group.position.set(4, taxi.group.position.y || 0, 4.5);
        taxi.group.rotation.y = -Math.PI / 2;
        taxi.heading = Math.PI / 2;
      } else if (trafficCars[1]?.group) {
        trafficCars[1].group.visible = true;
        trafficCars[1].group.position.set(4, trafficCars[1].group.position.y || 0, 4.5);
        trafficCars[1].group.rotation.y = -Math.PI / 2;
        trafficCars[1].heading = Math.PI / 2;
      }

      if (camera) {
        // Closer and lower than the first pass: Nia reads large, the empty
        // foreground asphalt shrinks, and the taxi + peds stay in frame.
        camera.position.set(6, 3.2, 34);
        camera.lookAt(0, 1.2, 22);
      }
      return true;
    }

    if (name === 'combat') {
      state.wanted = 0;
      setPlayerPosition(state, player, 0, 24, Math.PI, true);

      const pedestrian = traffic?.pedestrians?.[0];
      if (pedestrian?.group) {
        pedestrian.group.position.set(2.2, 0, 22.5);
        pedestrian.group.rotation.x = -Math.PI / 2;
      }

      if (camera) {
        camera.position.set(6, 3.5, 32);
        camera.lookAt(0, 1.2, 23);
      }
      return true;
    }

    return true;
  } catch {
    // A recognized shot is considered handled even when an optional subsystem
    // is missing or fails; this prevents the caller from discarding staged work.
    return true;
  }
}

export { forwardFor, placeCameraBehind, setScreenPlay };
