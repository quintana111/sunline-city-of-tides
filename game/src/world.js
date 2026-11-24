// world.js — Maravela: seeded city data + procedural build.
// Sunline: City of Tides (make.fun gta6-01). All generation from a seeded
// RNG; no Math.random() anywhere in game/src/.

import * as THREE from '../vendor/three.min.js';

// ---------------------------------------------------------------- seeded RNG
// mulberry32: small, fast, deterministic across engines.
export function createRng(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) { return min + this.next() * (max - min); },
    int(min, max) { return Math.floor(this.range(min, max + 1)); },
    pick(list) { return list[Math.floor(this.next() * list.length)]; },
    chance(p) { return this.next() < p; },
  };
}

// ---------------------------------------------------------------- layout
export const ROAD_LINES = [-560, -448, -336, -224, -112, 0, 112, 224, 336, 448, 560];
export const PITCH = 112;
export const PARCEL = 92;
export const ROAD_WIDTH = 20;
export const LANE = 4.5;
export const CITY_EDGE = 616; // half-extent of buildable city (560 + 56)
export const OCEAN_START = 560; // south of this the sea begins

const NS_NAMES = ['Beacon Avenue', 'Citrine Street', 'Palmway', 'Harbour Road', 'Meridian Avenue'];
const EW_NAMES = ['Seaglass Boulevard', 'Orchid Street', 'Lantern Avenue', 'Pier Road', 'Solway Drive'];

export function blockIndex(v) {
  const i = Math.floor((v + 560) / PITCH);
  return Math.max(0, Math.min(9, i));
}

// District of a ground point. Deterministic per block.
export function districtAt(x, z) {
  const i = blockIndex(x);
  const j = blockIndex(z);
  if (i >= 3 && i <= 6 && j >= 3 && j <= 6) return 'Glassline';
  if (j >= 8 && i <= 5) return 'Sunwash Beach';
  if (j >= 8 && i >= 6) return 'Pelican Marina';
  if (i <= 2 && j <= 4) return 'Foundry Quay';
  if ((i <= 2 && j >= 5) || (i >= 7 && j <= 4)) return 'Palm Court';
  return 'Civic Crescent';
}

const INVENTED_SIGNS = ['SOLSTICE', 'MARAVELA', 'TIDE & TONIC', 'PALM COURT', 'SUNLINE', 'CORAL INN', 'PIER 9', 'LANTERN', 'SEAGLASS', 'MERIDIAN'];

// ---------------------------------------------------------------- world data
export function createWorld(seed) {
  const rng = createRng(seed);
  const world = {
    seed,
    rng,
    roads: [],
    blocks: [],
    buildings: [],
    palms: [],
    waterfront: [],
    lamps: [],
    signs: [],
    colliders: [], // {x, z, hw, hd} axis-aligned boxes; parked cars add theirs at runtime
    spawnPoints: {},
    missionPoints: {},
    pedestrianPaths: [],
    trafficRoutes: [],
    districtAt,
    state: null, // set by main.js to the shared state object
  };

  // Roads: 11 north-south (constant x) + 11 east-west (constant z).
  for (let k = 0; k < ROAD_LINES.length; k++) {
    const c = ROAD_LINES[k];
    world.roads.push({
      axis: 'ns', coord: c, name: NS_NAMES[k % NS_NAMES.length],
      lanes: [c - LANE, c + LANE],
    });
    world.roads.push({
      axis: 'ew', coord: c, name: EW_NAMES[k % EW_NAMES.length],
      lanes: [c - LANE, c + LANE],
    });
  }

  // Blocks: 10x10, centre between neighbouring road lines.
  for (let j = 0; j < 10; j++) {
    for (let i = 0; i < 10; i++) {
      const cx = -560 + 56 + PITCH * i;
      const cz = -560 + 56 + PITCH * j;
      const district = districtAt(cx, cz);
      const block = { i, j, cx, cz, district };
      world.blocks.push(block);

      // Buildings per block, by district.
      let count = 2;
      if (district === 'Glassline') count = 2; // tower + podium
      else if (district === 'Foundry Quay') count = rng.int(2, 3);
      else if (district === 'Sunwash Beach') count = 2;
      else if (district === 'Pelican Marina') count = 2;
      else count = rng.int(2, 3);
      for (let b = 0; b < count; b++) {
        const bx = cx + rng.range(-26, 26);
        const bz = cz + rng.range(-26, 26);
        let w, d, h;
        if (district === 'Glassline') { w = rng.range(22, 34); d = rng.range(22, 34); h = rng.range(55, 115); }
        else if (district === 'Foundry Quay') { w = rng.range(26, 44); d = rng.range(18, 30); h = rng.range(12, 28); }
        else if (district === 'Sunwash Beach') { w = rng.range(18, 30); d = rng.range(16, 26); h = rng.range(16, 42); }
        else if (district === 'Civic Crescent') { w = rng.range(16, 30); d = rng.range(16, 28); h = rng.range(18, 45); }
        else { w = rng.range(10, 18); d = rng.range(10, 18); h = rng.range(8, 14); }
        const building = {
          x: bx, z: bz, w, d, h, district,
          rot: rng.chance(0.5) ? 0 : Math.PI / 2,
          hue: rng.next(),
          sign: district === 'Glassline' && rng.chance(0.55) ? rng.pick(INVENTED_SIGNS) : null,
        };
        world.buildings.push(building);
        world.colliders.push({ x: bx, z: bz, hw: w / 2 + 0.5, hd: d / 2 + 0.5 });
      }
    }
  }

  // Palms: beach + promenade + medians, ~100.
  for (let n = 0; n < 100; n++) {
    let x, z;
    const roll = rng.next();
    if (roll < 0.45) { // beach strip, south edge
      x = rng.range(-540, 540); z = rng.range(566, 600);
    } else if (roll < 0.75) { // promenade just north of the beach
      x = rng.range(-540, 540); z = rng.range(520, 552);
    } else { // medians along a few roads
      const road = rng.pick(ROAD_LINES);
      if (rng.chance(0.5)) { x = road; z = rng.range(-500, 500); }
      else { x = rng.range(-500, 500); z = road; }
    }
    world.palms.push({ x, z, h: rng.range(6, 9), lean: rng.range(-0.12, 0.12) });
  }

  // Waterfront objects: docks, posts, boxy boats along the marina/beach.
  for (let n = 0; n < 20; n++) {
    const kind = n < 8 ? 'dock' : n < 14 ? 'boat' : 'post';
    world.waterfront.push({
      kind,
      x: rng.range(-520, 520),
      z: kind === 'boat' ? rng.range(600, 700) : rng.range(566, 596),
      rot: rng.range(0, Math.PI * 2),
      s: rng.range(0.8, 1.4),
    });
  }

  // Street lamps along roads, every other intersection-ish spacing.
  for (const line of ROAD_LINES) {
    for (let t = -504; t <= 504; t += 224) {
      world.lamps.push({ x: line + 11, z: t });
      world.lamps.push({ x: t, z: line + 11 });
    }
  }

  // Key points.
  world.spawnPoints.player = { x: -336, y: 0, z: 168 }; // Palm Court, south-west homes
  world.spawnPoints.beach = { x: -112, y: 0, z: 560 };
  world.missionPoints = {
    parcelPickup: { x: -392, z: 224 },      // Palm Court
    beachCafe: { x: -56, z: 532 },          // beachfront cafe
    marinaCrate: { x: 392, z: 504 },        // Pelican Marina
    foundryWorkshop: { x: -448, z: -336 }, // Foundry Quay
    mechanic: { x: 56, z: -56 },           // Civic Crescent
    safehouse: { x: -280, z: 280 },        // Palm Court safehouse
    ferryContact: { x: 224, z: 112 },      // central pickup
    marinaGate: { x: 448, z: 532 },        // last ferry boarding
  };

  // Pedestrian paths: sidewalk rectangles around a spread of blocks.
  for (let n = 0; n < 24; n++) {
    const block = world.blocks[Math.floor(rng.next() * world.blocks.length)];
    const m = 52; // sidewalk ring half-size around the block centre
    world.pedestrianPaths.push([
      { x: block.cx - m, z: block.cz - m }, { x: block.cx + m, z: block.cz - m },
      { x: block.cx + m, z: block.cz + m }, { x: block.cx - m, z: block.cz + m },
    ]);
  }

  // Traffic routes: rectangular loops around blocks, on road lanes.
  for (let n = 0; n < 12; n++) {
    const block = world.blocks[Math.floor(rng.next() * world.blocks.length)];
    const a = ROAD_LINES[Math.max(0, block.i)];
    const b = ROAD_LINES[Math.min(10, block.i + 1)];
    const c = ROAD_LINES[Math.max(0, block.j)];
    const d = ROAD_LINES[Math.min(10, block.j + 1)];
    world.trafficRoutes.push([
      { x: a + LANE, z: c + LANE }, { x: b - LANE, z: c + LANE },
      { x: b - LANE, z: d - LANE }, { x: a + LANE, z: d - LANE },
    ]);
  }
  return world;
}

// Point on a road lane, for spawns. axis 'ns' drives along z at x=coord+lane.
export function pointOnRoad(world, axis, coord, along, laneSign = 1) {
  if (axis === 'ns') return { x: coord + laneSign * LANE, z: along };
  return { x: along, z: coord + laneSign * LANE };
}

export function clampToCity(v, margin = 0) {
  return Math.max(-CITY_EDGE - margin, Math.min(CITY_EDGE + margin, v));
}

// ---------------------------------------------------------------- canvas textures
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Window grid: deterministic lit subset from the world rng seed value.
function windowTexture(base, litRatio, rng) {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const cols = 6, rows = 14;
    const cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = rng.next() < litRatio;
        g.fillStyle = lit ? '#ffd98a' : '#2c3e55';
        g.fillRect(c * cw + 2, r * ch + 3, cw - 4, ch - 6);
      }
    }
  });
}

function signTexture(text, fg) {
  return canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#20242e'; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = 'bold 34px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 1);
  });
}

// ---------------------------------------------------------------- build
export function buildCity(scene, world) {
  const rng = world.rng;

  // Sky: warm late-afternoon gradient dome. fog:false is essential — the
  // dome sits at ~1150 units and fog would wash it to flat brown-grey.
  scene.background = new THREE.Color(0xf2a96b);
  scene.fog = new THREE.Fog(0xf0c184, 520, 1700);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    uniforms: {
      horizon: { value: new THREE.Color(0xf2a96b) },
      zenith: { value: new THREE.Color(0x6f87c0) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec3 vP; uniform vec3 horizon; uniform vec3 zenith;',
      'void main(){',
      '  float y = normalize(vP).y;',
      '  float band = smoothstep(0.12, 1.0, y);',
      '  vec3 col = mix(horizon, zenith, clamp(band, 0.0, 1.0));',
      '  col = mix(col, horizon, smoothstep(0.12, 0.0, y) * 0.4);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1150, 24, 16), skyMat);
  sky.name = 'sky';
  scene.add(sky);

  // Sun from the south-west, warm; plus soft sky fill.
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.4);
  sun.position.set(-420, 320, 520);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9db8d6, 0xe8c9a0, 1.1));
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  const group = new THREE.Group();
  group.name = 'city';
  scene.add(group);

  // Ground: city slab + sand strip + ocean plane to the south.
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xb9ac93 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, -60);
  group.add(ground);

  const sandMat = new THREE.MeshLambertMaterial({ color: 0xe8d3a2 });
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(1400, 90), sandMat);
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0, 605);
  group.add(sand);

  const oceanMat = new THREE.MeshLambertMaterial({ color: 0x2e8fa8 });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2400, 900), oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.4, 1100);
  group.add(ocean);

  // Roads: dark asphalt strips, full grid, plus centre dashes and
  // crosswalks (subtle: alpha 0.13, small 5x6 / 6x5 dashes).
  const asphalt = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.55 });
  const crossMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.13 });
  const roadGeoNS = new THREE.PlaneGeometry(ROAD_WIDTH, 1240);
  const roadGeoEW = new THREE.PlaneGeometry(1240, ROAD_WIDTH);
  for (const line of ROAD_LINES) {
    const ns = new THREE.Mesh(roadGeoNS, asphalt);
    ns.rotation.x = -Math.PI / 2; ns.position.set(line, 0.02, 0);
    group.add(ns);
    const ew = new THREE.Mesh(roadGeoEW, asphalt);
    ew.rotation.x = -Math.PI / 2; ew.position.set(0, 0.02, line);
    group.add(ew);
  }

  // Centre dashes + crosswalk stripes + lamps are InstancedMesh: ~2,300
  // individual meshes would cost a draw call each; instancing costs one
  // call per set. Geometries are pre-rotated flat (length along Z); each
  // instance only needs a Y rotation.
  const dummy = new THREE.Object3D();
  const flatDash = new THREE.PlaneGeometry(0.6, 5);
  flatDash.rotateX(-Math.PI / 2);
  const dashCount = ROAD_LINES.length * 41 * 2;
  const dashes = new THREE.InstancedMesh(flatDash, dashMat, dashCount);
  let di = 0;
  for (const line of ROAD_LINES) {
    for (let t = -560; t <= 560; t += 28) {
      dummy.position.set(line, 0.05, t);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      dashes.setMatrixAt(di++, dummy.matrix);
      dummy.position.set(t, 0.05, line);
      dummy.rotation.set(0, Math.PI / 2, 0);
      dummy.updateMatrix();
      dashes.setMatrixAt(di++, dummy.matrix);
    }
  }
  dashes.instanceMatrix.needsUpdate = true;
  group.add(dashes);

  const flatCross = new THREE.PlaneGeometry(5, 6);
  flatCross.rotateX(-Math.PI / 2);
  const crossCount = ROAD_LINES.length * ROAD_LINES.length * 10;
  const crosses = new THREE.InstancedMesh(flatCross, crossMat, crossCount);
  let ci = 0;
  for (const x of ROAD_LINES) {
    for (const z of ROAD_LINES) {
      for (let k = -2; k <= 2; k++) {
        dummy.position.set(x + k * 3.4, 0.06, z + 13);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        crosses.setMatrixAt(ci++, dummy.matrix);
        dummy.position.set(x + 13, 0.06, z + k * 3.4);
        dummy.rotation.set(0, Math.PI / 2, 0);
        dummy.updateMatrix();
        crosses.setMatrixAt(ci++, dummy.matrix);
      }
    }
  }
  crosses.instanceMatrix.needsUpdate = true;
  group.add(crosses);

  // Sidewalk slabs: one light slab per block, slightly larger than the parcel.
  const walkMat = new THREE.MeshLambertMaterial({ color: 0xcfc4a8 });
  const walkGeo = new THREE.PlaneGeometry(PARCEL + 6, PARCEL + 6);
  for (const block of world.blocks) {
    const slab = new THREE.Mesh(walkGeo, walkMat);
    slab.rotation.x = -Math.PI / 2;
    slab.position.set(block.cx, 0.01, block.cz);
    group.add(slab);
  }

  // Buildings: shared box geometry, a small set of canvas window
  // textures per height class; rooftop signs on Glassline towers.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const facadeCols = ['#e8dcc8', '#d9c9b4', '#c8d4dc', '#e6b8a0', '#b8c8d8', '#d8d2c2'];
  const facadeMats = facadeCols.map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const winTexLow = windowTexture('#ddd3bd', 0.25, createRng(world.seed + 11));
  const winTexMid = windowTexture('#cdd6de', 0.35, createRng(world.seed + 22));
  const winTexHigh = windowTexture('#b9c4d4', 0.45, createRng(world.seed + 33));
  const winMatLow = new THREE.MeshLambertMaterial({ map: winTexLow });
  const winMatMid = new THREE.MeshLambertMaterial({ map: winTexMid });
  const winMatHigh = new THREE.MeshLambertMaterial({ map: winTexHigh });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x5a5f66 });
  for (const b of world.buildings) {
    const winMat = b.h < 16 ? winMatLow : b.h < 50 ? winMatMid : winMatHigh;
    const bodyMat = facadeMats[Math.floor(b.hue * facadeMats.length) % facadeMats.length];
    const mats = [winMat, winMat, roofMat, roofMat, bodyMat, bodyMat];
    const mesh = new THREE.Mesh(boxGeo, mats);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.position.set(b.x, b.h / 2, b.z);
    mesh.rotation.y = b.rot;
    group.add(mesh);
    if (b.sign) {
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(30, b.w * 0.9), 7),
        new THREE.MeshBasicMaterial({ map: signTexture(b.sign, '#ffd98a') }),
      );
      sign.position.set(b.x, b.h + 4, b.z - b.d / 2 - 0.3);
      sign.rotation.y = Math.PI;
      group.add(sign);
      world.signs.push(sign);
    }
  }

  // Palms: leaning trunk + green crown blobs.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a48 });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x3f8f5f });
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 1, 5);
  const crownGeo = new THREE.IcosahedronGeometry(2.2, 0);
  for (const p of world.palms) {
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.scale.y = p.h;
    trunk.position.set(p.x, p.h / 2, p.z);
    trunk.rotation.z = p.lean;
    group.add(trunk);
    const crown = new THREE.Mesh(crownGeo, crownMat);
    crown.scale.set(1.4, 0.7, 1.4);
    crown.position.set(p.x + p.lean * p.h, p.h + 1.2, p.z);
    group.add(crown);
  }

  // Waterfront: wooden docks, boxy boats, mooring posts.
  const dockMat = new THREE.MeshLambertMaterial({ color: 0x9a7d55 });
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xf2f0e8 });
  const hullMat2 = new THREE.MeshLambertMaterial({ color: 0x2e6f8f });
  const postMat = new THREE.MeshLambertMaterial({ color: 0x6a5138 });
  for (const o of world.waterfront) {
    if (o.kind === 'dock') {
      const dock = new THREE.Mesh(new THREE.BoxGeometry(26 * o.s, 0.8, 5), dockMat);
      dock.position.set(o.x, 0.4, o.z);
      group.add(dock);
    } else if (o.kind === 'boat') {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(9 * o.s, 2.2, 3.4), o.s > 1.1 ? hullMat : hullMat2);
      hull.position.set(o.x, 0.7, o.z);
      hull.rotation.y = o.rot;
      group.add(hull);
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.8, 2.4), hullMat);
      cabin.position.set(o.x, 2.4, o.z);
      cabin.rotation.y = o.rot;
      group.add(cabin);
    } else {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3.2, 6), postMat);
      post.position.set(o.x, 1.6, o.z);
      group.add(post);
    }
  }

  // Street lamps: thin pole + warm glowing head, instanced.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3c4148 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0 });
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 6, 5);
  const headGeo = new THREE.SphereGeometry(0.55, 8, 6);
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, world.lamps.length);
  const heads = new THREE.InstancedMesh(headGeo, lampMat, world.lamps.length);
  world.lamps.forEach((l, i) => {
    dummy.position.set(l.x, 3, l.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(l.x, 6.2, l.z);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  group.add(poles);
  group.add(heads);

  world.cityGroup = group;
  return world;
}

// Circle (x,z,r) vs axis-aligned building colliders: true when blocked.
export function hitsCollider(world, x, z, r) {
  for (const c of world.colliders) {
    const dx = Math.max(Math.abs(x - c.x) - c.hw, 0);
    const dz = Math.max(Math.abs(z - c.z) - c.hd, 0);
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}
