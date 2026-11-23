import * as THREE from 'three';

export function createTraffic(scene, world) {
  const cars = [];
  const pedestrians = [];
  const materials = {
    body: [
      0xc4543e, 0x3f7480, 0xd0a34c, 0x596b4b, 0xddd0b2,
      0x343f50, 0x8b5970, 0x738c91, 0x24292c
    ].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0.08 })),
    cabin: new THREE.MeshStandardMaterial({ color: 0x28333a, roughness: 0.38, metalness: 0.12 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x91adb0, roughness: 0.25, metalness: 0.08 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x202122, roughness: 0.95 }),
    hub: new THREE.MeshStandardMaterial({ color: 0x9b9a8c, roughness: 0.5, metalness: 0.35 }),
    taxi: new THREE.MeshStandardMaterial({ color: 0xf2ca45, roughness: 0.62 }),
    sign: new THREE.MeshStandardMaterial({ color: 0xffe78a, emissive: 0x473510, roughness: 0.55 }),
    shirts: [
      0xc65d47, 0x668079, 0xd3a44b, 0x6d718c, 0x789451,
      0x975d78, 0xb4c0b9, 0x516d91, 0xe0c5a1
    ].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.82 })),
    skin: new THREE.MeshStandardMaterial({ color: 0xb87e5e, roughness: 0.9 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x343944, roughness: 0.9 })
  };

  // Cars are built with their length along local -Z (forward), so
  // rotation.y = -heading keeps them facing their travel direction.
  const carBodyGeo = new THREE.BoxGeometry(1.9, 1.15, 4.2);
  const carCabinGeo = new THREE.BoxGeometry(1.62, 0.92, 2.25);
  const wheelGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.28, 10);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.29, 8);
  const taxiSignGeo = new THREE.BoxGeometry(0.34, 0.2, 0.62);
  const pedTorsoGeo = new THREE.BoxGeometry(0.42, 0.68, 0.27);
  const pedHeadGeo = new THREE.SphereGeometry(0.17, 8, 6);
  const pedLegGeo = new THREE.BoxGeometry(0.15, 0.53, 0.17);

  let rngState = (Number(world.seed) || 24681357) >>> 0;
  const random = () => {
    if (typeof world.rng === 'function') {
      const value = world.rng();
      if (Number.isFinite(value)) return value;
    }
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 4294967296;
  };

  function makeCar(type = 'sedan') {
    const group = new THREE.Group();
    const paint = type === 'taxi'
      ? materials.taxi
      : materials.body[Math.floor(random() * materials.body.length)];
    const body = new THREE.Mesh(carBodyGeo, paint);
    body.position.y = 0.82;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const cabin = new THREE.Mesh(carCabinGeo, materials.cabin);
    cabin.position.set(0, 1.78, 0.15);
    cabin.castShadow = true;
    group.add(cabin);

    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(1.46, 0.67, 0.08),
      materials.glass
    );
    windshield.position.set(0, 1.79, -0.99);
    windshield.rotation.x = 0.2;
    group.add(windshield);

    for (const x of [-0.98, 0.98]) {
      for (const z of [-1.35, 1.35]) {
        const wheel = new THREE.Mesh(wheelGeo, materials.tire);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.48, z);
        wheel.castShadow = true;
        group.add(wheel);

        const hub = new THREE.Mesh(hubGeo, materials.hub);
        hub.rotation.z = Math.PI / 2;
        hub.position.set(x + (x > 0 ? 0.01 : -0.01), 0.48, z);
        group.add(hub);
      }
    }

    if (type === 'taxi') {
      const sign = new THREE.Mesh(taxiSignGeo, materials.sign);
      sign.position.set(0, 2.29, 0.12);
      group.add(sign);
    }

    group.userData.type = type;
    scene.add(group);
    return group;
  }

  function routeInfo(route) {
    if (!route || route.length < 2) return null;
    const points = route.map(p => ({ x: p.x, z: p.z }));
    const lengths = [];
    let total = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      lengths.push(len);
      total += len;
    }
    return { points, lengths, total };
  }

  function pointAt(info, distance) {
    const d = ((distance % info.total) + info.total) % info.total;
    let walked = 0;
    for (let i = 0; i < info.lengths.length; i++) {
      const len = info.lengths[i];
      if (d <= walked + len || i === info.lengths.length - 1) {
        const a = info.points[i];
        const b = info.points[(i + 1) % info.points.length];
        const t = len > 0 ? THREE.MathUtils.clamp((d - walked) / len, 0, 1) : 0;
        return {
          x: THREE.MathUtils.lerp(a.x, b.x, t),
          z: THREE.MathUtils.lerp(a.z, b.z, t),
          heading: Math.atan2(b.x - a.x, -(b.z - a.z)),
          segment: i
        };
      }
      walked += len;
    }
    return { x: info.points[0].x, z: info.points[0].z, heading: 0, segment: 0 };
  }

  const routes = (world.trafficRoutes || [])
    .map(routeInfo)
    .filter(Boolean);

  function addTrafficCar(index) {
    if (routes.length === 0) return;
    const route = routes[index % routes.length];
    const type = index % 9 === 0 ? 'taxi' : 'sedan';
    const group = makeCar(type);
    const dist = random() * route.total;
    const p = pointAt(route, dist);
    group.position.set(p.x, 0, p.z);
    group.rotation.y = -p.heading;
    cars.push({
      group,
      route,
      dist,
      speed: 8 + random() * 5,
      targetSpeed: 8 + random() * 5,
      type,
      segment: p.segment
    });
  }

  for (let i = 0; i < 26; i++) addTrafficCar(i);

  function createPedestrians(count) {
    const paths = world.pedestrianPaths || [];
    if (!paths.length) return pedestrians;
    for (let i = 0; i < count; i++) {
      const path = paths[i % paths.length];
      if (!path || path.length < 2) continue;
      const group = new THREE.Group();
      const shirt = materials.shirts[Math.floor(random() * materials.shirts.length)];
      const torso = new THREE.Mesh(pedTorsoGeo, shirt);
      torso.position.y = 1.12;
      torso.castShadow = true;
      group.add(torso);

      const head = new THREE.Mesh(pedHeadGeo, materials.skin);
      head.position.y = 1.64;
      head.castShadow = true;
      group.add(head);

      const leftLeg = new THREE.Mesh(pedLegGeo, materials.pants);
      const rightLeg = new THREE.Mesh(pedLegGeo, materials.pants);
      leftLeg.position.set(-0.12, 0.48, 0);
      rightLeg.position.set(0.12, 0.48, 0);
      group.add(leftLeg, rightLeg);
      group.userData.legs = [leftLeg, rightLeg];

      const start = Math.floor(random() * path.length);
      group.position.set(path[start].x, 0, path[start].z);
      scene.add(group);
      pedestrians.push({
        group,
        path,
        seg: start,
        t: random(),
        speed: 1 + random() * 0.6,
        color: shirt.color,
        fleeTimer: 0,
        fleeX: 0,
        fleeZ: 0,
        walkPhase: random() * Math.PI * 2
      });
    }
    return pedestrians;
  }

  createPedestrians(55);

  function playerPosition() {
    const state = world.state;
    if (!state) return { x: 0, z: 0 };
    const p = state.currentVehicle?.pos || state.player?.pos;
    return p || { x: 0, z: 0 };
  }

  function trafficCarPosition(car) {
    return car.group.position;
  }

  function updateCars(dt) {
    for (const car of cars) {
      car.targetSpeed = 8 + (car.speed > 0 ? 0.4 : 0) + random() * 0.001;
      let nearestAhead = Infinity;

      for (const other of cars) {
        if (other === car || other.route !== car.route) continue;
        let gap = other.dist - car.dist;
        if (gap < 0) gap += car.route.total;
        if (gap > 0.1 && gap < nearestAhead) nearestAhead = gap;
      }

      if (nearestAhead < 12) {
        car.targetSpeed = Math.min(car.targetSpeed, nearestAhead < 4 ? 0 : car.speed * 0.45);
      }

      const p = trafficCarPosition(car);
      for (const other of cars) {
        if (other === car) continue;
        const q = trafficCarPosition(other);
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 0.1 && distance < 9) {
          const forward = new THREE.Vector2(-Math.sin(car.group.rotation.y), -Math.cos(car.group.rotation.y));
          const toward = new THREE.Vector2(dx / distance, dz / distance);
          if (forward.dot(toward) > 0.45 && other.route !== car.route) {
            car.targetSpeed = Math.min(car.targetSpeed, car.speed * 0.4);
          }
        }
      }

      car.speed = THREE.MathUtils.damp(car.speed, car.targetSpeed, 1.8, dt);
      car.dist = (car.dist + car.speed * dt) % car.route.total;
      const point = pointAt(car.route, car.dist);
      car.group.position.set(point.x, 0, point.z);
      car.group.rotation.y = -point.heading;
      car.segment = point.segment;
    }
  }

  function updatePedestrians(dt) {
    const state = world.state;
    const player = playerPosition();
    const vehicleSpeed = Math.abs(state?.currentVehicle?.speed || 0);
    const wanted = (state?.wanted || 0) > 0;
    const policePosition = state?.policePosition;

    for (const ped of pedestrians) {
      const pos = ped.group.position;
      const dx = pos.x - player.x;
      const dz = pos.z - player.z;
      const distance = Math.hypot(dx, dz);
      const policeNearby = wanted && policePosition &&
        Math.hypot(pos.x - policePosition.x, pos.z - policePosition.z) < 14;

      if ((vehicleSpeed > 5 && distance < 8) || policeNearby) {
        ped.fleeTimer = Math.max(ped.fleeTimer, 3);
        const length = Math.max(distance, 0.001);
        ped.fleeX = dx / length;
        ped.fleeZ = dz / length;
      }

      if (ped.fleeTimer > 0) {
        ped.fleeTimer = Math.max(0, ped.fleeTimer - dt);
        pos.x += ped.fleeX * 3.5 * dt;
        pos.z += ped.fleeZ * 3.5 * dt;
        ped.group.rotation.y = Math.atan2(ped.fleeX, -ped.fleeZ);
      } else {
        const a = ped.path[ped.seg];
        const nextSeg = (ped.seg + 1) % ped.path.length;
        const b = ped.path[nextSeg];
        const length = Math.max(Math.hypot(b.x - a.x, b.z - a.z), 0.001);
        ped.t += (ped.speed * dt) / length;
        while (ped.t >= 1) {
          ped.t -= 1;
          ped.seg = nextSeg;
          const next = (ped.seg + 1) % ped.path.length;
          if (next === 0 && random() < 0.25) ped.speed = 1 + random() * 0.6;
        }
        const start = ped.path[ped.seg];
        const end = ped.path[(ped.seg + 1) % ped.path.length];
        pos.x = THREE.MathUtils.lerp(start.x, end.x, ped.t);
        pos.z = THREE.MathUtils.lerp(start.z, end.z, ped.t);
        ped.group.rotation.y = Math.atan2(end.x - start.x, -(end.z - start.z));
      }

      ped.walkPhase += dt * (ped.fleeTimer > 0 ? 12 : 7);
      const legs = ped.group.userData.legs;
      if (legs) {
        legs[0].rotation.x = Math.sin(ped.walkPhase) * 0.42;
        legs[1].rotation.x = -Math.sin(ped.walkPhase) * 0.42;
      }
    }
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const state = world.state;
    if (state?.paused || state?.screen === 'paused') return;
    const factor = state?.screen === 'title' ? 0.5 : 1;
    const step = Math.min(dt, 0.1) * factor;
    updateCars(step);
    updatePedestrians(step);
  }

  return { cars, pedestrians, createPedestrians, update };
}
