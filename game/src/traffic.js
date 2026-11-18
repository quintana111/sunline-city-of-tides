// Ambient traffic + pedestrians. Cars follow seeded lane loops; peds walk
// sidewalk loops and flee from fast nearby vehicles. No Math.random() here:
// placement uses world.rng, updates are deterministic.
import * as THREE from 'three';

export function createTraffic(scene, world) {
  const rng = world.rng;
  const random = () => {
    if (rng && typeof rng.next === 'function') return rng.next();
    return 0.5;
  };
  const choose = (values) => values[Math.floor(random() * values.length)];
  const cars = [];
  const pedestrians = [];

  const paintColors = [0x36a4a3, 0xd95645, 0xe4b93e, 0x4779b5, 0xe7e0cb];
  const shirtColors = [0xe16e52, 0x42a39c, 0xe2b544, 0x567cb4, 0xb86da2, 0xe4e0d0];
  const carBodyGeometry = new THREE.BoxGeometry(2.2, 0.82, 4.25);
  const carCabinGeometry = new THREE.BoxGeometry(1.72, 0.78, 2.05);
  const wheelGeometry = new THREE.CylinderGeometry(0.39, 0.39, 0.25, 10);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x202126, roughness: 0.95 });
  const taxiSignGeometry = new THREE.BoxGeometry(0.75, 0.22, 0.38);
  const torsoGeometry = new THREE.BoxGeometry(0.43, 0.68, 0.27);
  const headGeometry = new THREE.SphereGeometry(0.17, 9, 7);
  const legGeometry = new THREE.BoxGeometry(0.17, 0.58, 0.2);
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xc88f6e, roughness: 0.9 });
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x353741, roughness: 0.92 });
  const materials = new Map();

  function materialFor(color, options = {}) {
    const key = `${color}:${options.roughness ?? 0.7}:${options.metalness ?? 0}`;
    if (!materials.has(key)) {
      materials.set(key, new THREE.MeshStandardMaterial({
        color, roughness: options.roughness ?? 0.7, metalness: options.metalness ?? 0,
      }));
    }
    return materials.get(key);
  }

  // Local -Z is the front, matching rotation.y = -heading.
  function makeCar(color, taxi = false) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(carBodyGeometry, materialFor(color, { roughness: 0.58, metalness: 0.12 }));
    body.position.y = 0.72;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const cabin = new THREE.Mesh(carCabinGeometry, materialFor(taxi ? 0xe9e0c6 : color, { roughness: 0.5, metalness: 0.08 }));
    cabin.position.set(0, 1.39, -0.12);
    cabin.castShadow = true;
    group.add(cabin);
    for (const x of [-1.07, 1.07]) {
      for (const z of [-1.38, 1.38]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.4, z);
        wheel.castShadow = true;
        group.add(wheel);
      }
    }
    if (taxi) {
      const sign = new THREE.Mesh(taxiSignGeometry, materialFor(0xf4c63e, { roughness: 0.6 }));
      sign.position.set(0, 1.9, -0.08);
      sign.castShadow = true;
      group.add(sign);
    }
    scene.add(group);
    return group;
  }

  function makePedestrian(color) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeometry, materialFor(color, { roughness: 0.9 }));
    torso.position.y = 1.05;
    torso.castShadow = true;
    group.add(torso);
    const head = new THREE.Mesh(headGeometry, skinMaterial);
    head.position.y = 1.52;
    head.castShadow = true;
    group.add(head);
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.12, 0.43, 0);
    rightLeg.position.set(0.12, 0.43, 0);
    leftLeg.castShadow = rightLeg.castShadow = true;
    group.add(leftLeg, rightLeg);
    scene.add(group);
    return { group, leftLeg, rightLeg };
  }

  function prepareRoute(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const route = points.map((p) => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 }));
    let length = 0;
    const cumulative = [0];
    for (let i = 0; i < route.length; i++) {
      const a = route[i];
      const b = route[(i + 1) % route.length];
      length += Math.hypot(b.x - a.x, b.z - a.z);
      cumulative.push(length);
    }
    if (length < 1) return null;
    return { points: route, cumulative, length };
  }

  const routes = (world.trafficRoutes ?? []).map(prepareRoute).filter(Boolean);
  const pedestrianRoutes = (world.pedestrianPaths ?? [])
    .map((path) => path.map((p) => ({ x: Number(p.x) || 0, z: Number(p.z) || 0 })))
    .filter((path) => path.length > 1);

  function pointAt(route, distance) {
    const d = ((distance % route.length) + route.length) % route.length;
    let lo = 0;
    let hi = route.points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (route.cumulative[mid + 1] <= d) lo = mid + 1;
      else hi = mid;
    }
    const index = Math.min(lo, route.points.length - 1);
    const a = route.points[index];
    const b = route.points[(index + 1) % route.points.length];
    const segmentLength = route.cumulative[index + 1] - route.cumulative[index];
    const t = segmentLength > 0 ? (d - route.cumulative[index]) / segmentLength : 0;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      heading: Math.atan2(b.x - a.x, -(b.z - a.z)),
      index,
    };
  }

  function createCars(count = 26) {
    if (!routes.length) return;
    for (let i = 0; i < count; i++) {
      const route = routes[i % routes.length];
      const distance = random() * route.length;
      const taxi = i === 7;
      const group = makeCar(choose(paintColors), taxi);
      const car = {
        group, route,
        routeIndex: i % routes.length,
        dist: distance,
        speed: 0,
        targetSpeed: 8 + random() * 5,
        type: taxi ? 'taxi' : 'traffic',
        length: 4.25,
      };
      const point = pointAt(route, distance);
      group.position.set(point.x, 0, point.z);
      group.rotation.y = -point.heading;
      cars.push(car);
    }
  }

  function createPedestrians(count = 64) {
    if (!pedestrianRoutes.length) return;
    for (let i = 0; i < count; i++) {
      const path = pedestrianRoutes[i % pedestrianRoutes.length];
      const ped = makePedestrian(choose(shirtColors));
      const start = Math.floor(random() * path.length);
      const next = path[(start + 1) % path.length];
      const current = path[start];
      const heading = Math.atan2(next.x - current.x, -(next.z - current.z));
      ped.group.position.set(current.x, 0, current.z);
      ped.group.rotation.y = -heading;
      pedestrians.push({
        ...ped,
        path,
        seg: start,
        t: random(),
        speed: 1 + random() * 0.6,
        fleeTimer: 0,
        fleeX: 0,
        fleeZ: 0,
        phase: random() * Math.PI * 2,
      });
    }
  }

  function updateCars(dt) {
    for (const car of cars) {
      let target = car.targetSpeed;
      let nearestAhead = Infinity;
      for (const other of cars) {
        if (other === car || other.routeIndex !== car.routeIndex) continue;
        let gap = other.dist - car.dist;
        if (gap < 0) gap += car.route.length;
        if (gap > 0.1 && gap < nearestAhead) nearestAhead = gap;
      }
      if (nearestAhead < 4.5) target = 0;
      else if (nearestAhead < 12) target *= Math.max(0.22, (nearestAhead - 3.5) / 9);

      // Slow at intersections when crossing traffic is close ahead.
      const here = pointAt(car.route, car.dist);
      const fx = Math.sin(here.heading);
      const fz = -Math.cos(here.heading);
      for (const other of cars) {
        if (other === car || other.routeIndex === car.routeIndex) continue;
        const dx = other.group.position.x - car.group.position.x;
        const dz = other.group.position.z - car.group.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 9 && distance > 0.1 && dx * fx + dz * fz > 0.5) {
          target = Math.min(target, car.targetSpeed * 0.4);
        }
      }

      const acceleration = target < car.speed ? 7 : 2.4;
      car.speed += Math.sign(target - car.speed) * Math.min(Math.abs(target - car.speed), acceleration * dt);
      car.dist = (car.dist + car.speed * dt) % car.route.length;
      const point = pointAt(car.route, car.dist);
      car.group.position.set(point.x, 0, point.z);
      car.group.rotation.y = -point.heading;
    }
  }

  function policePositions() {
    const state = world.state ?? {};
    const source = state.police?.units ?? state.police?.cars ?? state.policeUnits ?? [];
    if (Array.isArray(source)) {
      return source.map((u) => u?.group?.position ?? u?.pos ?? u?.position).filter(Boolean);
    }
    return [];
  }

  function updatePedestrians(dt) {
    const state = world.state ?? {};
    const playerPos = state.currentVehicle?.pos ?? state.player?.pos;
    const vehicleSpeed = Math.abs(Number(state.currentVehicle?.speed) || 0);
    const police = state.wanted > 0 ? policePositions() : [];

    for (const ped of pedestrians) {
      let fleeing = ped.fleeTimer > 0;
      if (!fleeing && playerPos) {
        const dx = ped.group.position.x - playerPos.x;
        const dz = ped.group.position.z - playerPos.z;
        if (Math.hypot(dx, dz) < 8 && state.currentVehicle && vehicleSpeed > 5) {
          const length = Math.hypot(dx, dz) || 1;
          ped.fleeX = dx / length;
          ped.fleeZ = dz / length;
          ped.fleeTimer = 3;
          fleeing = true;
        } else if (police.length) {
          let nearest = null;
          let nearestDist = Infinity;
          for (const unit of police) {
            const ux = unit.x ?? 0;
            const uz = unit.z ?? 0;
            const d = (ped.group.position.x - ux) ** 2 + (ped.group.position.z - uz) ** 2;
            if (d < nearestDist) { nearestDist = d; nearest = unit; }
          }
          if (nearest && nearestDist < 49) {
            const dx = ped.group.position.x - (nearest.x ?? 0);
            const dz = ped.group.position.z - (nearest.z ?? 0);
            const length = Math.hypot(dx, dz) || 1;
            ped.fleeX = dx / length;
            ped.fleeZ = dz / length;
            ped.fleeTimer = 3;
            fleeing = true;
          }
        }
      }

      if (fleeing) {
        ped.fleeTimer = Math.max(0, ped.fleeTimer - dt);
        ped.group.position.x += ped.fleeX * 3.5 * dt;
        ped.group.position.z += ped.fleeZ * 3.5 * dt;
        ped.group.rotation.y = -Math.atan2(ped.fleeX, -ped.fleeZ);
        ped.phase += dt * 13;
      } else {
        const a = ped.path[ped.seg];
        const b = ped.path[(ped.seg + 1) % ped.path.length];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz) || 1;
        ped.t += (ped.speed * dt) / length;
        while (ped.t >= 1) {
          ped.t -= 1;
          ped.seg = (ped.seg + 1) % ped.path.length;
        }
        const from = ped.path[ped.seg];
        const to = ped.path[(ped.seg + 1) % ped.path.length];
        ped.group.position.set(from.x + (to.x - from.x) * ped.t, 0, from.z + (to.z - from.z) * ped.t);
        ped.group.rotation.y = -Math.atan2(to.x - from.x, -(to.z - from.z));
        ped.phase += dt * 7;
      }
      const swing = Math.sin(ped.phase) * (fleeing ? 0.68 : 0.38);
      ped.leftLeg.rotation.x = swing;
      ped.rightLeg.rotation.x = -swing;
    }
  }

  createCars(26);

  return {
    cars,
    pedestrians,
    createPedestrians,
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      const state = world.state ?? {};
      if (state.paused || state.screen === 'paused' || state.screen === 'over') return;
      const factor = state.screen === 'title' ? 0.5 : 1;
      const step = Math.min(dt, 0.1) * factor;
      updateCars(step);
      updatePedestrians(step);
    },
  };
}
