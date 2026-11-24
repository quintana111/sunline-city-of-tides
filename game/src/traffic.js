// traffic.js — ambient traffic cars + pedestrians.
// Never controls the player vehicle. Heading convention: forward =
// (sin h, 0, -cos h); mesh rotation.y = -heading.

import * as THREE from '../vendor/three.min.js';
import { createRng } from './world.js';

const CAR_COLORS = [0xcfd6dd, 0x8a97a5, 0xc96a5a, 0x5a7f6a, 0xd9b36a, 0x6a5a8a, 0x3f6f8f, 0xe8e2d2];

function trafficCarMesh(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x24344a });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4.3), bodyMat);
  body.position.y = 0.6;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.55, 2.1), glassMat);
  cabin.position.set(0, 1.2, 0.15);
  g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 8);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  for (const [sx, sz] of [[-0.85, -1.4], [0.85, -1.4], [-0.85, 1.4], [0.85, 1.4]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx, 0.34, sz);
    g.add(w);
  }
  return g;
}

function pedMesh(color, shirt) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xd9a986 });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.y = 1.62;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), shirtMat);
  torso.position.y = 1.1;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), pantsMat);
  legL.position.set(-0.13, 0.35, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  g.add(head, torso, legL, legR);
  g.userData.legs = [legL, legR];
  return g;
}

export function createTraffic(scene, world) {
  const rng = createRng((world.seed >>> 0) + 555);
  const traffic = { cars: [], peds: [], scene, world };

  // ~30 ambient cars on the seeded rectangular road loops.
  const routes = world.trafficRoutes;
  for (let n = 0; n < 30; n++) {
    const route = routes[n % routes.length];
    const seg = Math.floor(rng.next() * route.length);
    const from = route[seg];
    const to = route[(seg + 1) % route.length];
    const t = rng.next();
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const heading = Math.atan2(to.x - from.x, -(to.z - from.z));
    const mesh = trafficCarMesh(rng.pick(CAR_COLORS));
    mesh.position.set(x, 0, z);
    mesh.rotation.y = -heading;
    scene.add(mesh);
    traffic.cars.push({
      mesh, route, seg,
      x, z, heading,
      speed: 0,
      cruise: rng.range(8, 13),
      wait: 0,
      color: mesh.children[0].material.color.getHex(),
    });
  }

  traffic.createPedestrians = (count) => {
    const paths = world.pedestrianPaths;
    const shirts = [0xe86a6a, 0x6a9ae8, 0x7ac06a, 0xe8c86a, 0xb06ae8, 0x6ad9c9, 0xf2f0e8];
    const pants = [0x2c3242, 0x4a3a2c, 0x3a4a5a, 0x5a5a5a];
    for (let n = 0; n < count; n++) {
      const path = paths[n % paths.length];
      const seg = Math.floor(rng.next() * path.length);
      const from = path[seg];
      const to = path[(seg + 1) % path.length];
      const t = rng.next();
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const heading = Math.atan2(to.x - from.x, -(to.z - from.z));
      const mesh = pedMesh(rng.pick(pants), rng.pick(shirts));
      mesh.position.set(x, 0, z);
      mesh.rotation.y = -heading;
      scene.add(mesh);
      traffic.peds.push({
        mesh, path, seg,
        x, z, heading,
        speed: rng.range(1.0, 1.6),
        phase: rng.range(0, Math.PI * 2),
        flee: 0,
        fx: 0, fz: 0,
      });
    }
    return traffic.peds;
  };

  traffic.update = (dt) => updateTraffic(traffic, dt);
  return traffic;
}

function updateTraffic(traffic, dt) {
  const { world } = traffic;
  const state = world.state;

  for (const car of traffic.cars) {
    // Target: next waypoint of the loop.
    const to = car.route[(car.seg + 1) % car.route.length];
    const dx = to.x - car.x, dz = to.z - car.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 3) {
      car.seg = (car.seg + 1) % car.route.length;
      continue;
    }
    const wantHeading = Math.atan2(dx, -dz);
    // Steer toward the waypoint heading, limited turn rate.
    let dh = wantHeading - car.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    car.heading += Math.max(-1.4 * dt, Math.min(1.4 * dt, dh));

    // Car-following: slow within 12 units of the car ahead, stop within 4.
    let target = car.cruise;
    for (const other of traffic.cars) {
      if (other === car) continue;
      const ox = other.x - car.x, oz = other.z - car.z;
      const od = Math.hypot(ox, oz);
      if (od > 14) continue;
      const ahead = ox * Math.sin(car.heading) + oz * (-Math.cos(car.heading));
      if (ahead > 0 && Math.abs(ox * Math.cos(car.heading) - oz * Math.sin(car.heading)) < 3) {
        if (od < 4.5) target = 0;
        else if (od < 12) target = Math.min(target, car.cruise * 0.45);
      }
    }
    // Brief stop at intersections when crossing traffic is close.
    if (target > 0) {
      const nearCorner = Math.abs(((car.x + 560) % 112) - 0) < 8 || Math.abs(((car.z + 560) % 112) - 0) < 8;
      if (nearCorner) {
        for (const other of traffic.cars) {
          if (other === car) continue;
          const od = Math.hypot(other.x - car.x, other.z - car.z);
          if (od < 9 && Math.abs(other.heading - car.heading) > 0.6) { target = 0; break; }
        }
      }
    }
    // The player's own driven car blocks the lane too.
    if (state && state.currentVehicle) {
      const pv = state.currentVehicle;
      const od = Math.hypot(pv.x - car.x, pv.z - car.z);
      if (od < 5) target = 0;
      else if (od < 12) target = Math.min(target, car.cruise * 0.5);
    }

    if (target === 0) {
      car.wait += dt;
      car.speed = Math.max(0, car.speed - 10 * dt);
    } else {
      car.wait = 0;
      car.speed += Math.sign(target - car.speed) * Math.min(Math.abs(target - car.speed), 4 * dt);
    }
    car.x += Math.sin(car.heading) * car.speed * dt;
    car.z += -Math.cos(car.heading) * car.speed * dt;
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = -car.heading;
  }
  updatePeds(traffic, dt);
}

function updatePeds(traffic, dt) {
  const { world } = traffic;
  const state = world.state;
  // Player vehicle position + speed, for the flee check.
  let threatX = 0, threatZ = 0, threatSpeed = 0, hasThreat = false;
  if (state && state.currentVehicle) {
    const v = state.currentVehicle;
    threatX = v.x; threatZ = v.z; threatSpeed = Math.abs(v.speed || 0);
    hasThreat = threatSpeed > 4;
  }

  for (const ped of traffic.peds) {
    // Flee: a fast vehicle within 8 units sends the ped running toward
    // the nearest sidewalk point for a few seconds.
    if (hasThreat) {
      const d = Math.hypot(threatX - ped.x, threatZ - ped.z);
      if (d < 8 && ped.flee <= 0) {
        ped.flee = 3;
        // Run away from the vehicle, biased toward the path (sidewalk).
        const ax = ped.x - threatX, az = ped.z - threatZ;
        const al = Math.hypot(ax, az) || 1;
        ped.fx = ax / al; ped.fz = az / al;
      }
    }
    if (ped.flee > 0) {
      ped.flee -= dt;
      ped.x += ped.fx * 3.4 * dt;
      ped.z += ped.fz * 3.4 * dt;
      ped.heading = Math.atan2(ped.fx, -ped.fz);
      ped.phase += dt * 11;
    } else {
      const to = ped.path[(ped.seg + 1) % ped.path.length];
      const dx = to.x - ped.x, dz = to.z - ped.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.5) {
        ped.seg = (ped.seg + 1) % ped.path.length;
        continue;
      }
      const wantHeading = Math.atan2(dx, -dz);
      let dh = wantHeading - ped.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      ped.heading += Math.max(-2.4 * dt, Math.min(2.4 * dt, dh));
      ped.x += Math.sin(ped.heading) * ped.speed * dt;
      ped.z += -Math.cos(ped.heading) * ped.speed * dt;
      ped.phase += dt * ped.speed * 5;
    }
    ped.mesh.position.set(ped.x, 0, ped.z);
    ped.mesh.rotation.y = -ped.heading;
    const swing = Math.sin(ped.phase) * 0.45;
    const legs = ped.mesh.userData.legs;
    if (legs) { legs[0].rotation.x = swing; legs[1].rotation.x = -swing; }
  }
}
