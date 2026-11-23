// Sunline: City of Tides — Maravela city data + scene builder.
// Written fresh 2026-11-24 (Builder A re-author). Deterministic: every
// world-generation choice comes from the seeded RNG. No Math.random()
// anywhere in this file.
import * as THREE from 'three';

export const ROAD_LINES = [-560, -448, -336, -224, -112, 0, 112, 224, 336, 448, 560];
export const BLOCK_SIZE = 92;
export const PITCH = 112;
export const ROAD_WIDTH = 20;
export const CITY_SIZE = 1120;

const DISTRICT = {
  GLASS: 'Glassline',
  BEACH: 'Sunwash Beach',
  MARINA: 'Pelican Marina',
  FOUNDRY: 'Foundry Quay',
  PALM: 'Palm Court',
  CIVIC: 'Civic Crescent',
};

// Authoritative heading convention: forward = (sin h, 0, -cos h).
// Heading 0 faces north (-Z); +PI/2 faces east (+X); PI faces south.
// Right-hand traffic: eastbound lane is z = line + 4.5, northbound x = line + 4.5.
export function headingForLane(axis, lane) {
  if (axis === 'x') return lane > 0 ? Math.PI / 2 : -Math.PI / 2;
  return lane > 0 ? 0 : Math.PI;
}

export function createRng(seed = 1) {
  let s = (Number(seed) || 0) >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) { return min + (max - min) * this.next(); },
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
    int(min, max) { return Math.floor(this.range(min, max + 1)); },
  };
}

function districtForBlock(i, j) {
  if (i >= 3 && i <= 6 && j >= 3 && j <= 6) return DISTRICT.GLASS;
  if (j >= 8 && i <= 5) return DISTRICT.BEACH;
  if (j >= 8 && i >= 6) return DISTRICT.MARINA;
  if (i <= 2 && j <= 4) return DISTRICT.FOUNDRY;
  if (i === 0 || i === 9 || j === 0 || j === 9) return DISTRICT.PALM;
  return DISTRICT.CIVIC;
}

function districtAtCoords(x, z) {
  const i = Math.floor((x + 560) / PITCH);
  const j = Math.floor((z + 560) / PITCH);
  if (i >= 0 && i < 10 && j >= 0 && j < 10) return districtForBlock(i, j);
  if (z > 560) return 'Ocean';
  return DISTRICT.CIVIC;
}

const PALETTES = {
  [DISTRICT.GLASS]: ['#9dbbc0', '#9cb6c4', '#b4c6c4', '#8daab5'],
  [DISTRICT.BEACH]: ['#dcc49f', '#e8d5b3', '#c9b38f', '#e0cda9'],
  [DISTRICT.MARINA]: ['#b6aa91', '#c2b59b', '#a99b82', '#c6bca8'],
  [DISTRICT.FOUNDRY]: ['#9c9280', '#aaa18f', '#898779', '#b0a38f'],
  [DISTRICT.PALM]: ['#e1cba9', '#d7bf9b', '#e5d4b6', '#cdb995'],
  [DISTRICT.CIVIC]: ['#c4b9a5', '#cfc3ad', '#b9b7a8', '#d6c9b2'],
};
const SIGN_NAMES = ['CAFÉ LUMEN', 'HOTEL MARAVELA', 'TIDE & TACKLE', 'PALM COURT MARKET'];

let latestWorld = null;

export function createWorld(seed = 24681357) {
  const rng = createRng(seed);
  const roads = [];
  const nsNames = ['Citrine Street', 'Palmway', 'Harbour Road', 'Meridian Avenue', 'Beacon Avenue'];
  const ewNames = ['Orchid Street', 'Lantern Avenue', 'Pier Road', 'Solway Drive', 'Seaglass Boulevard'];
  ROAD_LINES.forEach((line, index) => {
    roads.push({ name: line === 0 ? 'Beacon Avenue' : nsNames[index % nsNames.length], axis: 'z', line, length: CITY_SIZE });
    roads.push({ name: line === 0 ? 'Seaglass Boulevard' : ewNames[index % ewNames.length], axis: 'x', line, length: CITY_SIZE });
  });

  const blocks = [];
  for (let j = 0; j < 10; j++) {
    for (let i = 0; i < 10; i++) {
      const minX = -560 + i * PITCH + 10;
      const minZ = -560 + j * PITCH + 10;
      blocks.push({
        i, j, district: districtForBlock(i, j),
        cx: minX + BLOCK_SIZE / 2, cz: minZ + BLOCK_SIZE / 2,
        minX, maxX: minX + BLOCK_SIZE, minZ, maxZ: minZ + BLOCK_SIZE,
      });
    }
  }

  const world = {
    seed, rng, roads, blocks, buildings: [],
    spawnPoints: { player: { x: 0, z: 24 }, cars: [], police: [] },
    // Mission points sit on roads / promenade, never inside a building.
    missionPoints: {
      parcelPickup: { x: -112, z: -124, label: 'Parcel Pickup' },
      cafeDropoff: { x: 116, z: -4.5, label: 'Café Lumen' },
      marinaCrate: { x: 448, z: 504, label: 'Marina Crate' },
      workshopDropoff: { x: -448, z: -168, label: 'Foundry Workshop' },
      mechanicPickup: { x: 224, z: 224, label: 'Mechanic Pickup' },
      safehouse: { x: -448, z: 336, label: 'Safehouse' },
      ferryDock: { x: 336, z: 600, label: 'Ferry Dock' },
    },
    pedestrianPaths: [],
    trafficRoutes: [],
    blockSize: BLOCK_SIZE, pitch: PITCH, roadWidth: ROAD_WIDTH,
    roadLines: [...ROAD_LINES], size: CITY_SIZE,
    districtAt(x, z) { return districtAtCoords(x, z); },
  };

  for (const block of blocks) {
    const rngB = rng;
    const district = block.district;
    let count = rngB.int(2, 4);
    if (district === DISTRICT.GLASS) count = rngB.int(1, 2);
    if (district === DISTRICT.FOUNDRY || district === DISTRICT.MARINA) count = rngB.int(1, 3);
    for (let k = 0; k < count; k++) {
      const margin = 5;
      const usable = BLOCK_SIZE - margin * 2;
      const w = Math.min(rngB.range(18, district === DISTRICT.GLASS ? 39 : 34), usable);
      const d = Math.min(rngB.range(18, district === DISTRICT.GLASS ? 39 : 34), usable);
      const x = rngB.range(block.minX + margin + w / 2, block.maxX - margin - w / 2);
      const z = rngB.range(block.minZ + margin + d / 2, block.maxZ - margin - d / 2);
      let h;
      if (district === DISTRICT.GLASS) h = rngB.range(55, 115);
      else if (district === DISTRICT.FOUNDRY) h = rngB.range(12, 28);
      else if (district === DISTRICT.BEACH) h = rngB.range(9, 26);
      else if (district === DISTRICT.MARINA) h = rngB.range(10, 25);
      else if (district === DISTRICT.PALM) h = rngB.range(8, 14);
      else h = rngB.range(18, 45);
      const sign = h < 30 && rngB.next() < 0.28;
      world.buildings.push({
        x, z, w, d, h, district,
        roof: rngB.pick(['flat', 'parapet', 'equipment']),
        color: rngB.pick(PALETTES[district]),
        windows: rngB.range(0.12, 0.48),
        sign, signText: sign ? rngB.pick(SIGN_NAMES) : '',
      });
    }
  }

  // Traffic loops: rectangles around block groups, on lane centres.
  for (let n = 0; n < 12; n++) {
    const i = rng.int(0, 7);
    const j = rng.int(0, 7);
    const x1 = ROAD_LINES[i];
    const x2 = ROAD_LINES[i + 2];
    const z1 = ROAD_LINES[j];
    const z2 = ROAD_LINES[j + 2];
    const o = 4.5;
    world.trafficRoutes.push([
      { x: x1 + o, z: z1 + o }, { x: x2 - o, z: z1 + o },
      { x: x2 - o, z: z2 - o }, { x: x1 + o, z: z2 - o },
      { x: x1 + o, z: z1 + o },
    ]);
  }

  // Pedestrian loops: sidewalk rectangles around blocks.
  for (let n = 0; n < 24; n++) {
    const block = blocks[rng.int(0, blocks.length - 1)];
    const pad = 1.5;
    world.pedestrianPaths.push([
      { x: block.minX + pad, z: block.minZ + pad },
      { x: block.maxX - pad, z: block.minZ + pad },
      { x: block.maxX - pad, z: block.maxZ - pad },
      { x: block.minX + pad, z: block.maxZ - pad },
      { x: block.minX + pad, z: block.minZ + pad },
    ]);
  }

  // Parked-car spawns on road lanes near the centre.
  const carTypes = ['sedan', 'taxi', 'sports', 'truck'];
  for (let n = 0; n < 8; n++) {
    const line = rng.pick(ROAD_LINES.slice(2, 9));
    const along = rng.range(-100, 100);
    const axis = rng.next() < 0.5 ? 'x' : 'z';
    const lane = rng.next() < 0.5 ? -4.5 : 4.5;
    world.spawnPoints.cars.push({
      x: axis === 'x' ? along : line + lane,
      z: axis === 'x' ? line + lane : along,
      heading: headingForLane(axis, lane),
      type: rng.pick(carTypes),
    });
  }
  for (let n = 0; n < 4; n++) {
    const line = rng.pick(ROAD_LINES);
    const axis = rng.next() < 0.5 ? 'x' : 'z';
    const along = rng.next() < 0.5 ? -110 : 110;
    world.spawnPoints.police.push({
      x: axis === 'x' ? along : line + 4.5,
      z: axis === 'x' ? line + 4.5 : along,
    });
  }

  latestWorld = world;
  return world;
}

export function pointOnRoad(x, z) {
  let best = { axis: 'x', line: 0, dist: Infinity };
  for (const line of ROAD_LINES) {
    const dx = Math.abs(x - line);
    const dz = Math.abs(z - line);
    if (dx < best.dist) best = { axis: 'z', line, dist: dx };
    if (dz < best.dist) best = { axis: 'x', line, dist: dz };
  }
  return best;
}

export function clampToCity(x, z) {
  return {
    x: THREE.MathUtils.clamp(x, -560, 560),
    z: THREE.MathUtils.clamp(z, -560, 680),
  };
}

export function randomRoadPoint(rng = createRng(1)) {
  const line = rng.pick(ROAD_LINES);
  const axis = rng.next() < 0.5 ? 'x' : 'z';
  const lane = rng.next() < 0.5 ? -4.5 : 4.5;
  const along = rng.range(-548, 548);
  return axis === 'x'
    ? { x: along, z: line + lane, heading: headingForLane('x', lane) }
    : { x: line + lane, z: along, heading: headingForLane('z', lane) };
}

export function randomSidewalkPoint(rng = createRng(1)) {
  const blocks = latestWorld?.blocks ?? [];
  if (!blocks.length) {
    const line = rng.pick(ROAD_LINES);
    return { x: rng.range(-548, 548), z: line + 11.5 };
  }
  const block = rng.pick(blocks);
  const side = rng.int(0, 3);
  const along = rng.range(block.minX + 3, block.maxX - 3);
  const alongZ = rng.range(block.minZ + 3, block.maxZ - 3);
  if (side === 0) return { x: along, z: block.minZ - 1.5 };
  if (side === 1) return { x: along, z: block.maxZ + 1.5 };
  if (side === 2) return { x: block.minX - 1.5, z: alongZ };
  return { x: block.maxX + 1.5, z: alongZ };
}

// Circle (x,z,r) vs axis-aligned building footprints. r<=0 tests the point.
export function collidesBuilding(x, z, r = 0, world = latestWorld) {
  if (!world) return false;
  for (const b of world.buildings) {
    if (x >= b.x - b.w / 2 - r && x <= b.x + b.w / 2 + r &&
        z >= b.z - b.d / 2 - r && z <= b.z + b.d / 2 + r) return true;
  }
  return false;
}

function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function windowTexture(rng, tint, litRatio) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 9; y < 256; y += 23) {
    for (let x = 8; x < 256; x += 25) {
      ctx.fillStyle = rng.next() < litRatio ? '#f3d89c' : '#344650';
      ctx.fillRect(x, y, 14, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(x, y, 2, 12);
    }
  }
  ctx.strokeStyle = 'rgba(41,49,48,0.5)';
  ctx.lineWidth = 2;
  for (let y = 3; y < 256; y += 23) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke();
  }
  return canvasTexture(c);
}

function roadTexture(axis) {
  const alongX = axis === 'x';
  const c = document.createElement('canvas');
  c.width = alongX ? 1024 : 128;
  c.height = alongX ? 128 : 1024;
  const ctx = c.getContext('2d');
  // Lighter asphalt (was #343a38, near-black in frame) so the road no
  // longer reads as a black void against pale sidewalks / crosswalks.
  ctx.fillStyle = '#54574f';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = 'rgba(228,205,148,0.58)';
  ctx.lineWidth = 3;
  ctx.setLineDash([28, 20]);
  if (alongX) {
    [35, 93].forEach((y) => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(225,211,168,0.42)';
    ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(c.width, 64); ctx.stroke();
    for (let x = 0; x < c.width; x += 102) {
      // Edge dashes toned down (was 0.40 alpha, near-white) so they stop
      // dominating the foreground of low chase/street cameras.
      ctx.fillStyle = 'rgba(168,166,150,0.26)';
      for (let y = 8; y < 120; y += 13) ctx.fillRect(x, y, 6, 8);
    }
  } else {
    [35, 93].forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(225,211,168,0.42)';
    ctx.beginPath(); ctx.moveTo(64, 0); ctx.lineTo(64, c.height); ctx.stroke();
    for (let y = 0; y < c.height; y += 102) {
      ctx.fillStyle = 'rgba(168,166,150,0.26)';
      for (let x = 8; x < 120; x += 13) ctx.fillRect(x, y, 8, 6);
    }
  }
  return canvasTexture(c);
}

// Warm late-afternoon sky: vertical gradient, deep blue at the zenith
// fading through gold to a pale-orange horizon. Painted on a large
// back-face dome so it reads in every camera angle (a flat
// scene.background colour was the "flat beige sky" in the screenshots).
function skyGradientTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  // NOTE: on the dome the canvas midpoint (y=256) is the HORIZON
  // (sphere equator), so the warm band must already dominate by y≈45% —
  // the first version put the warm colours below the horizon, where the
  // ground hides them, leaving only a grey-blue upper sky visible.
  // The blue still spans the top half of the canvas so a real
  // blue → gold → pale-orange gradient reads in the high start camera.
  g.addColorStop(0.0, '#5e9ed2');
  g.addColorStop(0.40, '#7ea9d4');
  g.addColorStop(0.55, '#c9b088');
  g.addColorStop(0.70, '#f2b878');
  g.addColorStop(0.85, '#f9c98d');
  g.addColorStop(1.0, '#fbd9a4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  return canvasTexture(c);
}

function signTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#183c3a';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#f0c879';
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, 502, 118);
  ctx.fillStyle = '#ffe1a3';
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 66, 470);
  return canvasTexture(c);
}

function addBox(group, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function buildPalms(group, world, shared) {
  const positions = [];
  const rng = world.rng;
  for (let i = 0; i < 30; i++) positions.push({ x: rng.range(-510, 510), z: 574 + (i % 2) * 9 });
  for (let i = 0; i < 38; i++) positions.push({ x: rng.range(-490, 490), z: rng.range(592, 655) });
  for (let i = 0; i < 32; i++) {
    const block = world.blocks[rng.int(0, world.blocks.length - 1)];
    const side = rng.int(0, 3);
    const t = rng.range(0.15, 0.85);
    positions.push({
      x: side < 2 ? block.minX + t * BLOCK_SIZE : (side === 2 ? block.minX - 1 : block.maxX + 1),
      z: side < 2 ? (side === 0 ? block.minZ - 1 : block.maxZ + 1) : block.minZ + t * BLOCK_SIZE,
    });
  }
  const trunk = new THREE.InstancedMesh(shared.palmTrunkGeometry, shared.palmTrunkMaterial, positions.length);
  const leaves = new THREE.InstancedMesh(shared.palmLeafGeometry, shared.palmLeafMaterial, positions.length * 5);
  trunk.castShadow = true;
  leaves.castShadow = true;
  const dummy = new THREE.Object3D();
  let leafIndex = 0;
  positions.forEach((p, i) => {
    const height = 5.5 + rng.range(0, 1.7);
    dummy.position.set(p.x, height / 2, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, height / 6.5, 1);
    dummy.updateMatrix();
    trunk.setMatrixAt(i, dummy.matrix);
    for (let k = 0; k < 5; k++) {
      const a = (Math.PI * 2 * k) / 5 + rng.range(-0.12, 0.12);
      const dir = new THREE.Vector3(Math.cos(a), -0.55, Math.sin(a)).normalize();
      dummy.position.set(p.x + Math.cos(a) * 0.35, height + 0.1, p.z + Math.sin(a) * 0.35);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      dummy.scale.set(0.72, 1, 0.72);
      dummy.updateMatrix();
      leaves.setMatrixAt(leafIndex++, dummy.matrix);
    }
  });
  trunk.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  group.add(trunk, leaves);
}

function buildLamps(group, shared) {
  const positions = [];
  for (const line of ROAD_LINES) {
    for (let along = -504; along <= 504; along += 168) {
      if (line % 224 === 0) continue;
      positions.push({ x: along, z: line + 12.2 });
      positions.push({ x: line + 12.2, z: along });
    }
  }
  const poles = new THREE.InstancedMesh(shared.lampPoleGeometry, shared.lampPoleMaterial, positions.length);
  const heads = new THREE.InstancedMesh(shared.lampHeadGeometry, shared.lampHeadMaterial, positions.length);
  const dummy = new THREE.Object3D();
  positions.forEach((p, i) => {
    dummy.position.set(p.x, 3.6, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 7.1, p.z);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  group.add(poles, heads);
}

function buildMarina(group, shared) {
  for (let i = 0; i < 5; i++) {
    const x = 190 + i * 92;
    addBox(group, shared.dockGeometry, shared.dockMaterial, x, 0.18, 623, 7, 0.35, 86);
    for (let z = 584; z <= 664; z += 20) {
      addBox(group, shared.dockPostGeometry, shared.dockPostMaterial, x - 2.7, -0.2, z);
      addBox(group, shared.dockPostGeometry, shared.dockPostMaterial, x + 2.7, -0.2, z);
    }
  }
  const boatColors = [0xd9d0bb, 0x789596, 0xb15f42, 0xe2c37a];
  for (let i = 0; i < 8; i++) {
    const x = 205 + i * 62;
    const z = i % 2 === 0 ? 650 : 675;
    addBox(group, shared.boatGeometry, new THREE.MeshStandardMaterial({ color: boatColors[i % boatColors.length], roughness: 0.62 }), x, 0.72, z, 1.1, 0.75, 2.9);
    addBox(group, shared.boatCabinGeometry, shared.boatCabinMaterial, x, 1.35, z - 3, 0.7, 0.75, 1);
  }
}

function buildTrafficLights(group, shared) {
  const locations = [[0, 0], [-224, 0], [224, 0], [0, -224], [0, 224], [336, 336]];
  for (const [x, z] of locations) {
    addBox(group, shared.signalPostGeometry, shared.signalPostMaterial, x + 10.8, 2.4, z + 10.8);
    addBox(group, shared.signalBoxGeometry, shared.signalBoxMaterial, x + 10.8, 4.1, z + 10.8);
    addBox(group, shared.signalPostGeometry, shared.signalPostMaterial, x - 10.8, 2.4, z - 10.8);
    addBox(group, shared.signalBoxGeometry, shared.signalBoxMaterial, x - 10.8, 4.1, z - 10.8);
  }
}

export function buildCity(scene, world) {
  const group = new THREE.Group();
  group.name = 'MaravelaCity';
  world.cityGroup = group;

  // Warm late-afternoon sky: gradient dome + fog matched to the horizon
  // colour (was a flat 0xecc79b background/fog — the "flat beige sky").
  scene.background = new THREE.Color(0xf7c489);
  scene.fog = new THREE.Fog(0xf2bf83, 900, 2200);
  // Upper hemisphere ONLY: a full sphere's lower half curves up past the
  // ground plane's edge (1500x1500) and reads as a big orange hill on the
  // high start-screen camera. Below the horizon the scene.background
  // horizon colour shows instead.
  // Radius 1150 (was 1900): the camera far plane is 2000, and the camera
  // sits ~320 from the origin, so a 1900 dome's far side (~2220 away) was
  // CLIPPED — it rendered as a big background-coloured "orange mound"
  // hole in the middle of the start shot. 1150 keeps the far side within
  // the far plane from any camera in the city (worst case ~1150+792).
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(1150, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: skyGradientTexture(), side: THREE.BackSide, fog: false }),
  );
  skyDome.name = 'SkyDome';
  scene.add(skyDome);
  scene.add(new THREE.HemisphereLight(0xffd9a8, 0x6b5a48, 1.3));
  const sun = new THREE.DirectionalLight(0xffc27a, 2.4);
  sun.position.set(-300, 400, 300); // southwest
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -700;
  sun.shadow.camera.right = 700;
  sun.shadow.camera.top = 700;
  sun.shadow.camera.bottom = -700;
  scene.add(sun);
  scene.add(group);

  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x4d524b, roughness: 0.95 });
  const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0xb3ad9d, roughness: 0.92 });
  const sandMaterial = new THREE.MeshStandardMaterial({ color: 0xd9bd8e, roughness: 0.95 });
  const oceanMaterial = new THREE.MeshStandardMaterial({
    color: 0x347b88, emissive: 0x123c49, emissiveIntensity: 0.35, roughness: 0.48, metalness: 0.06,
  });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.18;
  ground.receiveShadow = true;
  group.add(ground);

  const roadTexX = roadTexture('x');
  const roadTexZ = roadTexture('z');
  const roadMatX = new THREE.MeshStandardMaterial({ map: roadTexX, roughness: 0.9 });
  const roadMatZ = new THREE.MeshStandardMaterial({ map: roadTexZ, roughness: 0.9 });
  for (const line of ROAD_LINES) {
    const stripX = new THREE.Mesh(new THREE.PlaneGeometry(CITY_SIZE, ROAD_WIDTH), roadMatX);
    stripX.rotation.x = -Math.PI / 2;
    stripX.position.set(0, 0.015, line);
    stripX.receiveShadow = true;
    group.add(stripX);
    const stripZ = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, CITY_SIZE), roadMatZ);
    stripZ.rotation.x = -Math.PI / 2;
    stripZ.position.set(line, 0.016, 0);
    stripZ.receiveShadow = true;
    group.add(stripZ);
    for (const side of [-1, 1]) {
      const swX = new THREE.Mesh(new THREE.PlaneGeometry(CITY_SIZE, 3), sidewalkMaterial);
      swX.rotation.x = -Math.PI / 2;
      swX.position.set(0, 0.025, line + side * 11.5);
      swX.receiveShadow = true;
      group.add(swX);
      const swZ = new THREE.Mesh(new THREE.PlaneGeometry(3, CITY_SIZE), sidewalkMaterial);
      swZ.rotation.x = -Math.PI / 2;
      swZ.position.set(line + side * 11.5, 0.026, 0);
      swZ.receiveShadow = true;
      group.add(swZ);
    }
  }

  const sand = new THREE.Mesh(new THREE.PlaneGeometry(1400, 100), sandMaterial);
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, -0.08, 630);
  sand.receiveShadow = true;
  group.add(sand);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1400, 440), oceanMaterial);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.5, 900);
  group.add(ocean);
  const walkway = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 8),
    new THREE.MeshStandardMaterial({ color: 0xb8aa8c, roughness: 0.85 }),
  );
  walkway.rotation.x = -Math.PI / 2;
  walkway.position.set(0, 0.035, 580);
  group.add(walkway);

  const rng = world.rng;
  const districtTexture = {
    [DISTRICT.GLASS]: windowTexture(rng, '#a8b9b8', 0.34),
    [DISTRICT.BEACH]: windowTexture(rng, '#dbc9aa', 0.21),
    [DISTRICT.MARINA]: windowTexture(rng, '#b2aa97', 0.18),
    [DISTRICT.FOUNDRY]: windowTexture(rng, '#9f998c', 0.16),
    [DISTRICT.PALM]: windowTexture(rng, '#ddc9a8', 0.25),
    [DISTRICT.CIVIC]: windowTexture(rng, '#c5baaa', 0.27),
  };
  const buildingMaterials = {};
  for (const d of Object.keys(districtTexture)) {
    buildingMaterials[d] = new THREE.MeshStandardMaterial({ map: districtTexture[d], roughness: 0.68, metalness: 0.08 });
  }

  const shared = {
    buildingGeometry: new THREE.BoxGeometry(1, 1, 1),
    roofMaterial: new THREE.MeshStandardMaterial({ color: 0x716f66, roughness: 0.88 }),
    palmTrunkGeometry: new THREE.CylinderGeometry(0.24, 0.42, 6.5, 6),
    palmTrunkMaterial: new THREE.MeshStandardMaterial({ color: 0x806346, roughness: 1 }),
    palmLeafGeometry: new THREE.ConeGeometry(0.85, 4.4, 5),
    palmLeafMaterial: new THREE.MeshStandardMaterial({ color: 0x42684b, roughness: 0.9, side: THREE.DoubleSide }),
    lampPoleGeometry: new THREE.CylinderGeometry(0.11, 0.16, 7.2, 6),
    lampPoleMaterial: new THREE.MeshStandardMaterial({ color: 0x454943, metalness: 0.5, roughness: 0.6 }),
    lampHeadGeometry: new THREE.BoxGeometry(0.8, 0.35, 0.65),
    lampHeadMaterial: new THREE.MeshStandardMaterial({ color: 0xffdfa0, emissive: 0xffc66b, emissiveIntensity: 1.25 }),
    dockGeometry: new THREE.BoxGeometry(1, 1, 1),
    dockMaterial: new THREE.MeshStandardMaterial({ color: 0x765a3d, roughness: 0.9 }),
    dockPostGeometry: new THREE.BoxGeometry(0.3, 1.1, 0.3),
    dockPostMaterial: new THREE.MeshStandardMaterial({ color: 0x554532, roughness: 0.95 }),
    boatGeometry: new THREE.BoxGeometry(1, 0.6, 1),
    boatCabinGeometry: new THREE.BoxGeometry(1, 1, 1),
    boatCabinMaterial: new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.72 }),
    signalPostGeometry: new THREE.BoxGeometry(0.18, 4.8, 0.18),
    signalPostMaterial: new THREE.MeshStandardMaterial({ color: 0x464943, metalness: 0.4 }),
    signalBoxGeometry: new THREE.BoxGeometry(0.65, 0.9, 0.5),
    signalBoxMaterial: new THREE.MeshStandardMaterial({ color: 0x333b38, emissive: 0x541f12, emissiveIntensity: 0.35 }),
  };

  const roofTop = new THREE.BoxGeometry(1, 0.7, 1);
  const parapetGeometry = new THREE.BoxGeometry(1, 0.8, 1);
  for (const b of world.buildings) {
    const material = buildingMaterials[b.district] || buildingMaterials[DISTRICT.CIVIC];
    addBox(group, shared.buildingGeometry, material, b.x, b.h / 2, b.z, b.w, b.h, b.d);
    if (b.roof === 'equipment') {
      addBox(group, roofTop, shared.roofMaterial, b.x, b.h + 1.5, b.z, b.w * 0.25, 2.3, b.d * 0.25);
    } else if (b.roof === 'parapet') {
      const rim = 0.65;
      addBox(group, parapetGeometry, shared.roofMaterial, b.x, b.h + 0.35, b.z - b.d / 2 + rim / 2, b.w, 0.7, rim);
      addBox(group, parapetGeometry, shared.roofMaterial, b.x, b.h + 0.35, b.z + b.d / 2 - rim / 2, b.w, 0.7, rim);
      addBox(group, parapetGeometry, shared.roofMaterial, b.x - b.w / 2 + rim / 2, b.h + 0.35, b.z, rim, 0.7, b.d);
      addBox(group, parapetGeometry, shared.roofMaterial, b.x + b.w / 2 - rim / 2, b.h + 0.35, b.z, rim, 0.7, b.d);
    }
    if (b.sign) {
      const texture = signTexture(b.signText);
      const signMaterial = new THREE.MeshStandardMaterial({
        map: texture, emissive: 0xffb74f, emissiveMap: texture, emissiveIntensity: 0.55,
        side: THREE.DoubleSide, roughness: 0.5,
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(b.w * 0.7, 13), 2.2), signMaterial);
      sign.position.set(b.x, Math.min(b.h - 1, 4.2), b.z - b.d / 2 - 0.08);
      sign.rotation.y = Math.PI;
      group.add(sign);
    }
  }

  buildPalms(group, world, shared);
  buildLamps(group, shared);
  buildMarina(group, shared);
  buildTrafficLights(group, shared);
  return group;
}
