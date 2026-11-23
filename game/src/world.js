import * as THREE from 'three';

const ROAD_LINES = [-560, -448, -336, -224, -112, 0, 112, 224, 336, 448, 560];
const DISTRICTS = {
  GLASSLINE: 'Glassline',
  SUNWASH: 'Sunwash Beach',
  MARINA: 'Pelican Marina',
  FOUNDRY: 'Foundry Quay',
  PALM: 'Palm Court',
  CIVIC: 'Civic Crescent',
};

export function createRng(seed = 1) {
  let state;
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    state = seed >>> 0;
  } else {
    const text = String(seed);
    state = 2166136261;
    for (let i = 0; i < text.length; i++) {
      state ^= text.charCodeAt(i);
      state = Math.imul(state, 16777619);
    }
    state >>>= 0;
  }

  return {
    next() {
      state = (state + 0x6D2B79F5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min, max) {
      return min + (max - min) * this.next();
    },
    pick(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    },
    int(min, max) {
      return Math.floor(this.range(min, max + 1));
    },
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function districtForBlock(i, j) {
  if (i >= 3 && i <= 6 && j >= 3 && j <= 6) return DISTRICTS.GLASSLINE;
  if (j >= 8 && i <= 5) return DISTRICTS.SUNWASH;
  if (j >= 8 && i >= 6) return DISTRICTS.MARINA;
  if (i <= 2 && j <= 4) return DISTRICTS.FOUNDRY;
  if (i <= 1 || i >= 8 || j <= 1 || j >= 8) return DISTRICTS.PALM;
  return DISTRICTS.CIVIC;
}

function districtHeights(district, rng) {
  switch (district) {
    case DISTRICTS.GLASSLINE: return rng.range(55, 115);
    case DISTRICTS.SUNWASH: return rng.range(12, 32);
    case DISTRICTS.MARINA: return rng.range(9, 24);
    case DISTRICTS.FOUNDRY: return rng.range(12, 28);
    case DISTRICTS.PALM: return rng.range(8, 14);
    default: return rng.range(18, 45);
  }
}

function buildingColor(district, rng) {
  const palettes = {
    [DISTRICTS.GLASSLINE]: [0x7596a4, 0x8aa5ad, 0x668998, 0x9cb2b5],
    [DISTRICTS.SUNWASH]: [0xd6ad7f, 0xe2c59b, 0xc99470, 0xead7b3],
    [DISTRICTS.MARINA]: [0xa27d5d, 0xb39470, 0x8d715a, 0xc0a17d],
    [DISTRICTS.FOUNDRY]: [0x8b8172, 0x9b8d79, 0x77786f, 0xa28d76],
    [DISTRICTS.PALM]: [0xd9c49e, 0xc9b58e, 0xe1d0ad, 0xbda986],
    [DISTRICTS.CIVIC]: [0xb7a88f, 0xc4b7a1, 0xaaa08f, 0xd0c1a5],
  };
  return rng.pick(palettes[district]);
}

export function createWorld(seed = 1) {
  const rng = createRng(seed);
  const blocks = [];
  const buildings = [];
  const roads = [];

  for (let i = 0; i < ROAD_LINES.length; i++) {
    roads.push({
      name: ['Beacon Avenue', 'Citrine Street', 'Palmway', 'Harbour Road', 'Meridian Avenue'][i % 5],
      axis: 'x',
      line: ROAD_LINES[i],
      length: 1120,
    });
    roads.push({
      name: ['Seaglass Boulevard', 'Orchid Street', 'Lantern Avenue', 'Pier Road', 'Solway Drive'][i % 5],
      axis: 'z',
      line: ROAD_LINES[i],
      length: 1120,
    });
  }

  for (let j = 0; j < 10; j++) {
    for (let i = 0; i < 10; i++) {
      const cx = -504 + i * 112;
      const cz = -504 + j * 112;
      const district = districtForBlock(i, j);
      const block = {
        i, j, district, cx, cz,
        minX: cx - 46, maxX: cx + 46,
        minZ: cz - 46, maxZ: cz + 46,
      };
      blocks.push(block);

      const roll = rng.next();
      const count = roll < 0.15 ? 1 : roll < 0.6 ? 2 : 3;
      const h = districtHeights(district, rng);
      const layout = count === 3
        ? [
            { x: cx - 30, z: cz, w: rng.range(24, 30), d: rng.range(56, 68) },
            { x: cx, z: cz, w: rng.range(24, 30), d: rng.range(56, 68) },
            { x: cx + 30, z: cz, w: rng.range(24, 30), d: rng.range(56, 68) },
          ]
        : count === 2
          ? [
              { x: cx - 21, z: cz, w: rng.range(31, 39), d: rng.range(56, 68) },
              { x: cx + 21, z: cz, w: rng.range(31, 39), d: rng.range(56, 68) },
            ]
          : [{
              x: cx + rng.range(-4, 4),
              z: cz + rng.range(-4, 4),
              w: rng.range(58, 76),
              d: rng.range(58, 76),
            }];

      for (const part of layout) {
        const height = count === 1 ? h : h * rng.range(0.72, 1.08);
        const shopEligible = height < 34 &&
          [DISTRICTS.SUNWASH, DISTRICTS.MARINA, DISTRICTS.PALM, DISTRICTS.FOUNDRY].includes(district);
        const sign = shopEligible && rng.next() < 0.26;
        const signNames = ['CAFÉ LUMEN', 'HOTEL MARAVELA', 'TIDE & TACKLE', 'PALM COURT MARKET'];
        const roof = rng.next() < 0.34 ? 'equipment' : (rng.next() < 0.42 ? 'parapet' : 'flat');
        buildings.push({
          x: part.x,
          z: part.z,
          w: Math.min(part.w, 80),
          d: Math.min(part.d, 80),
          h: height,
          district,
          roof,
          color: buildingColor(district, rng),
          windows: rng.range(0.12, 0.42),
          sign,
          signText: sign ? rng.pick(signNames) : '',
        });
      }
    }
  }

  function districtAt(x, z) {
    if (z > 560) return 'Ocean';
    const i = clamp(Math.floor((x + 560) / 112), 0, 9);
    const j = clamp(Math.floor((z + 560) / 112), 0, 9);
    return districtForBlock(i, j);
  }

  function isBuildingAt(x, z, pad = 0) {
    return buildings.some((b) =>
      Math.abs(x - b.x) <= b.w / 2 + pad &&
      Math.abs(z - b.z) <= b.d / 2 + pad
    );
  }

  const pedestrianPaths = [];
  for (const block of blocks) {
    const x0 = block.cx - 44.5;
    const x1 = block.cx + 44.5;
    const z0 = block.cz - 44.5;
    const z1 = block.cz + 44.5;
    pedestrianPaths.push([
      { x: x0, z: z0 }, { x: x1, z: z0 },
      { x: x1, z: z1 }, { x: x0, z: z1 },
    ]);
  }

  const trafficRoutes = [];
  for (let n = 0; n < 12; n++) {
    const leftIndex = rng.int(1, 6);
    const topIndex = rng.int(1, 6);
    const rightIndex = Math.min(10, leftIndex + rng.int(2, 4));
    const bottomIndex = Math.min(10, topIndex + rng.int(2, 4));
    const left = ROAD_LINES[leftIndex] - 4.5;
    const right = ROAD_LINES[rightIndex] + 4.5;
    const top = ROAD_LINES[topIndex] - 4.5;
    const bottom = ROAD_LINES[bottomIndex] + 4.5;
    trafficRoutes.push([
      { x: left, z: top },
      { x: right, z: top },
      { x: right, z: bottom },
      { x: left, z: bottom },
    ]);
  }

  const missionPoints = {
    parcelPickup: { x: -4.5, z: -112, label: 'Parcel pickup' },
    cafeDropoff: { x: 112, z: 4.5, label: 'Café drop-off' },
    marinaCrate: { x: 448, z: 4.5, label: 'Marina crate' },
    workshopDropoff: { x: -448, z: -4.5, label: 'Workshop drop-off' },
    mechanicPickup: { x: 4.5, z: 224, label: 'Mechanic pickup' },
    safehouse: { x: -224, z: 4.5, label: 'Safehouse' },
    ferryDock: { x: -112, z: 580, label: 'Ferry dock' },
  };

  return {
    seed,
    rng,
    roads,
    blocks,
    buildings,
    spawnPoints: {
      player: { x: 0, z: 24 },
      cars: [
        { x: 4.5, z: -24, heading: Math.PI, type: 'sedan' },
        { x: -4.5, z: 88, heading: 0, type: 'sedan' },
        { x: 112, z: 4.5, heading: Math.PI / 2, type: 'truck' },
      ],
      police: [
        { x: 112, z: 4.5 },
        { x: -112, z: -4.5 },
      ],
    },
    missionPoints,
    pedestrianPaths,
    trafficRoutes,
    districtAt,
    isBuildingAt,
    clampToCity,
    blockSize: 92,
    pitch: 112,
    roadWidth: 20,
    roadLines: ROAD_LINES.slice(),
    size: 1120,
  };
}

function makeCanvasTexture(canvas, repeat = null) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat.x, repeat.y);
  }
  return texture;
}

function createRoadTexture(axis) {
  const alongX = axis === 'x';
  const canvas = document.createElement('canvas');
  canvas.width = alongX ? 1024 : 128;
  canvas.height = alongX ? 128 : 1024;
  const ctx = canvas.getContext('2d');
  // Lighter asphalt so the road reads against pale sidewalks, not a black void.
  ctx.fillStyle = '#54574f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(228,205,148,0.58)';
  ctx.lineWidth = 3;
  ctx.setLineDash([28, 20]);
  if (alongX) {
    [35, 93].forEach((y) => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(225,211,168,0.42)';
    ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(canvas.width, 64); ctx.stroke();
    for (let x = 0; x < canvas.width; x += 102) {
      ctx.fillStyle = 'rgba(168,166,150,0.26)';
      for (let y = 8; y < 120; y += 13) ctx.fillRect(x, y, 6, 8);
    }
  } else {
    [35, 93].forEach((x) => { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); });
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(225,211,168,0.42)';
    ctx.beginPath(); ctx.moveTo(64, 0); ctx.lineTo(64, canvas.height); ctx.stroke();
    for (let y = 0; y < canvas.height; y += 102) {
      ctx.fillStyle = 'rgba(168,166,150,0.26)';
      for (let x = 8; x < 120; x += 13) ctx.fillRect(x, y, 8, 6);
    }
  }
  return makeCanvasTexture(canvas);
}

function createWindowTexture(rng, tint, litRatio) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, 256, 256);

  const cols = 8;
  const rows = 10;
  const marginX = 14;
  const marginY = 12;
  const gapX = 7;
  const gapY = 7;
  const ww = (256 - marginX * 2 - gapX * (cols - 1)) / cols;
  const wh = (256 - marginY * 2 - gapY * (rows - 1)) / rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = marginX + col * (ww + gapX);
      const y = marginY + row * (wh + gapY);
      if (rng.next() < litRatio) {
        ctx.fillStyle = rng.next() < 0.5 ? '#f4d9a0' : '#ffe8b9';
      } else {
        ctx.fillStyle = '#42535a';
      }
      ctx.fillRect(x, y, ww, wh);
      ctx.strokeStyle = 'rgba(20,29,32,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, ww, wh);
    }
  }
  return makeCanvasTexture(canvas);
}

function createSignTexture(text, background) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,232,190,0.75)';
  ctx.lineWidth = 5;
  ctx.strokeRect(5, 5, 502, 118);
  ctx.fillStyle = '#fff0c9';
  ctx.font = 'bold 38px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 65, 470);
  return makeCanvasTexture(canvas);
}

function addBox(parent, geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeSkyDome() {
  const geometry = new THREE.SphereGeometry(1150, 48, 32);
  const positions = geometry.attributes.position;
  const colors = [];
  const horizon = new THREE.Color(0xeab180);
  const zenith = new THREE.Color(0x8585b8);
  const lower = new THREE.Color(0xb97f6e);

  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i) / 1150;
    const color = y >= 0
      ? horizon.clone().lerp(zenith, THREE.MathUtils.smoothstep(y, 0, 1))
      : lower.clone().lerp(horizon, THREE.MathUtils.smoothstep(y, -0.35, 0));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(geometry, material);
  dome.name = 'warm sunset sky dome';
  return dome;
}

function buildPalmInstances(parent, palmPoints) {
  const trunkGeometry = new THREE.CylinderGeometry(0.34, 0.55, 8, 6);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x73553b, roughness: 0.95 });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, palmPoints.length);
  trunks.castShadow = true;

  const leafPositions = [
    [0, 0, 0], [0.55, 0.22, 0], [1.35, 0.13, 0],
    [2.15, -0.42, 0], [1.25, -0.12, 0], [0.45, -0.28, 0],
  ];
  const leafGeometry = new THREE.BufferGeometry();
  const vertices = new Float32Array(leafPositions.flat());
  leafGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  leafGeometry.setIndex([0, 1, 5, 1, 2, 4, 2, 3, 4]);
  leafGeometry.computeVertexNormals();
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x52764b,
    side: THREE.DoubleSide,
    roughness: 0.92,
  });
  const leaves = new THREE.InstancedMesh(leafGeometry, leafMaterial, palmPoints.length * 6);
  leaves.castShadow = true;

  const dummy = new THREE.Object3D();
  let leafIndex = 0;
  for (let i = 0; i < palmPoints.length; i++) {
    const point = palmPoints[i];
    dummy.position.set(point.x, 4, point.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, point.height / 8, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    for (let k = 0; k < 6; k++) {
      dummy.position.set(point.x, point.height, point.z);
      dummy.rotation.set(0, (Math.PI * 2 * k) / 6 + point.turn, 0);
      dummy.scale.set(point.leafScale, point.leafScale, point.leafScale);
      dummy.updateMatrix();
      leaves.setMatrixAt(leafIndex++, dummy.matrix);
    }
  }
  parent.add(trunks, leaves);
}

export function buildCity(scene, world) {
  const group = new THREE.Group();
  group.name = 'Maravela city';
  world.cityGroup = group;
  scene.add(group);

  scene.background = new THREE.Color(0xeab180);
  scene.fog = new THREE.Fog(0xecc79b, 400, 1400);
  group.add(makeSkyDome());

  scene.add(new THREE.HemisphereLight(0xf3d9ae, 0x8a6a4f, 1.25));
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.2);
  sun.position.set(-300, 400, 300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -700;
  sun.shadow.camera.right = 700;
  sun.shadow.camera.top = 700;
  sun.shadow.camera.bottom = -700;
  scene.add(sun);

  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x4d524b, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.18, 0);
  ground.receiveShadow = true;
  group.add(ground);

  // One texture per orientation: dashes must run ALONG each road, so the
  // E-W and N-S strips get their own canvas and geometry (no rotation.y).
  const roadMatX = new THREE.MeshStandardMaterial({ map: createRoadTexture('x'), roughness: 0.9 });
  const roadMatZ = new THREE.MeshStandardMaterial({ map: createRoadTexture('z'), roughness: 0.9 });
  const roadGeoX = new THREE.PlaneGeometry(1120, 20);
  const roadGeoZ = new THREE.PlaneGeometry(20, 1120);
  const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0xaaa99e, roughness: 1 });
  const sidewalkGeoX = new THREE.PlaneGeometry(1120, 3);
  const sidewalkGeoZ = new THREE.PlaneGeometry(3, 1120);

  for (const line of ROAD_LINES) {
    const stripX = new THREE.Mesh(roadGeoX, roadMatX);
    stripX.rotation.x = -Math.PI / 2;
    stripX.position.set(0, 0.015, line);
    stripX.receiveShadow = true;
    group.add(stripX);

    const stripZ = new THREE.Mesh(roadGeoZ, roadMatZ);
    stripZ.rotation.x = -Math.PI / 2;
    stripZ.position.set(line, 0.016, 0);
    stripZ.receiveShadow = true;
    group.add(stripZ);

    for (const side of [-1, 1]) {
      const walkX = new THREE.Mesh(sidewalkGeoX, sidewalkMaterial);
      walkX.rotation.x = -Math.PI / 2;
      walkX.position.set(0, 0.025, line + side * 11.5);
      walkX.receiveShadow = true;
      group.add(walkX);

      const walkZ = new THREE.Mesh(sidewalkGeoZ, sidewalkMaterial);
      walkZ.rotation.x = -Math.PI / 2;
      walkZ.position.set(line + side * 11.5, 0.026, 0);
      walkZ.receiveShadow = true;
      group.add(walkZ);
    }
  }

  const windowRng = world.rng;
  const windowTextures = [
    createWindowTexture(windowRng, '#66818c', 0.24),
    createWindowTexture(windowRng, '#9a795d', 0.18),
    createWindowTexture(windowRng, '#8a8879', 0.16),
    createWindowTexture(windowRng, '#627b78', 0.2),
  ];
  const windowMaterials = windowTextures.map((map) => new THREE.MeshStandardMaterial({
    map,
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.08,
  }));
  const districtMaterialIndex = {
    [DISTRICTS.GLASSLINE]: 0,
    [DISTRICTS.SUNWASH]: 1,
    [DISTRICTS.MARINA]: 1,
    [DISTRICTS.FOUNDRY]: 2,
    [DISTRICTS.PALM]: 1,
    [DISTRICTS.CIVIC]: 3,
  };

  const signEntries = [
    ['CAFÉ LUMEN', '#8c4938'],
    ['HOTEL MARAVELA', '#3e665d'],
    ['TIDE & TACKLE', '#385e72'],
    ['PALM COURT MARKET', '#78603b'],
  ];
  const signTextures = signEntries.map(([text, color]) => createSignTexture(text, color));
  const signMaterials = signTextures.map((map) => new THREE.MeshStandardMaterial({
    map,
    emissive: 0x9a582b,
    emissiveIntensity: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.55,
  }));
  const signGeometry = new THREE.PlaneGeometry(1, 0.28);
  const equipmentMaterial = new THREE.MeshStandardMaterial({ color: 0x746e62, roughness: 0.9 });
  const parapetMaterial = new THREE.MeshStandardMaterial({ color: 0xc4b59d, roughness: 0.9 });

  for (const building of world.buildings) {
    const material = windowMaterials[districtMaterialIndex[building.district]];
    const geometry = new THREE.BoxGeometry(building.w, building.h, building.d);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(building.x, building.h / 2, building.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.building = building;
    group.add(mesh);

    // Rooftop equipment and parapets are independent branches by design.
    if (building.roof === 'equipment') {
      const width = Math.max(3, building.w * 0.16);
      const depth = Math.max(3, building.d * 0.14);
      addBox(
        group,
        new THREE.BoxGeometry(width, 1.8, depth),
        equipmentMaterial,
        building.x + building.w * 0.18,
        building.h + 0.9,
        building.z - building.d * 0.12
      );
    }
    if (building.roof === 'parapet') {
      const parapetHeight = 1.1;
      const parapet = new THREE.Mesh(
        new THREE.BoxGeometry(building.w + 0.4, parapetHeight, building.d + 0.4),
        parapetMaterial
      );
      parapet.position.set(building.x, building.h + parapetHeight / 2, building.z);
      parapet.castShadow = true;
      group.add(parapet);
    }

    if (building.sign) {
      const signIndex = Math.max(0, signEntries.findIndex(([text]) => text === building.signText));
      const sign = new THREE.Mesh(signGeometry, signMaterials[signIndex]);
      sign.scale.set(Math.min(13, building.w * 0.55), Math.min(3.4, building.h * 0.22), 1);
      sign.position.set(building.x, Math.min(building.h - 1, 4.2), building.z - building.d / 2 - 0.08);
      // The sign is mounted on the north wall and faces outward.
      sign.rotation.y = Math.PI;
      group.add(sign);
    }
  }

  const beachMaterial = new THREE.MeshStandardMaterial({ color: 0xd8be91, roughness: 1 });
  const beach = new THREE.Mesh(new THREE.PlaneGeometry(1400, 100), beachMaterial);
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(0, -0.08, 630);
  beach.receiveShadow = true;
  group.add(beach);

  const oceanMaterial = new THREE.MeshStandardMaterial({
    color: 0x397e9a,
    emissive: 0x0c3444,
    emissiveIntensity: 0.18,
    roughness: 0.42,
    metalness: 0.08,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1400, 440), oceanMaterial);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.5, 900);
  group.add(ocean);

  const promenadeMaterial = new THREE.MeshStandardMaterial({ color: 0xb9aa8e, roughness: 0.94 });
  const promenade = new THREE.Mesh(new THREE.PlaneGeometry(1400, 12), promenadeMaterial);
  promenade.rotation.x = -Math.PI / 2;
  promenade.position.set(0, 0.03, 580);
  group.add(promenade);

  const palmPoints = [];
  for (let i = 0; i < 78; i++) {
    const x = -680 + i * 17.4;
    palmPoints.push({
      x,
      z: world.rng.range(598, 663),
      height: world.rng.range(7.5, 10.5),
      leafScale: world.rng.range(0.78, 1.05),
      turn: world.rng.range(0, Math.PI * 2),
    });
  }
  for (let i = 0; i < 24; i++) {
    palmPoints.push({
      x: world.rng.range(190, 545),
      z: world.rng.range(574, 640),
      height: world.rng.range(7.5, 10),
      leafScale: world.rng.range(0.78, 1.02),
      turn: world.rng.range(0, Math.PI * 2),
    });
  }
  buildPalmInstances(group, palmPoints);

  const dockMaterial = new THREE.MeshStandardMaterial({ color: 0x76543a, roughness: 0.95 });
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x594432, roughness: 1 });
  const boatMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xe8e1d2, roughness: 0.75 }),
    new THREE.MeshStandardMaterial({ color: 0x355e70, roughness: 0.75 }),
    new THREE.MeshStandardMaterial({ color: 0xc97f54, roughness: 0.75 }),
  ];
  for (let d = 0; d < 3; d++) {
    const z = 590 + d * 22;
    addBox(group, new THREE.BoxGeometry(210, 0.7, 5), dockMaterial, 390, 0.35, z);
    for (let p = 0; p < 8; p++) {
      const x = 286 + p * 30;
      addBox(group, new THREE.BoxGeometry(0.65, 2.2, 0.65), postMaterial, x, 0.85, z);
    }
  }
  for (let i = 0; i < 8; i++) {
    const x = 282 + (i % 4) * 58;
    const z = 604 + Math.floor(i / 4) * 39;
    const boat = new THREE.Mesh(new THREE.BoxGeometry(12, 1.2, 3.8), boatMaterials[i % boatMaterials.length]);
    boat.position.set(x, 0.2, z);
    boat.rotation.y = (i % 2) * 0.08;
    boat.castShadow = true;
    group.add(boat);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 1.6, 2.8),
      new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.8 })
    );
    cabin.position.set(x, 1.3, z);
    group.add(cabin);
  }

  const lampPoleGeometry = new THREE.CylinderGeometry(0.12, 0.2, 7, 7);
  const lampPoleMaterial = new THREE.MeshStandardMaterial({ color: 0x514d43, roughness: 0.82 });
  const lampHeadGeometry = new THREE.BoxGeometry(0.85, 0.35, 0.55);
  const lampHeadMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe6ac,
    emissive: 0xffca70,
    emissiveIntensity: 1.15,
  });
  const lampPoints = [];
  for (const line of [-448, -224, 0, 224, 448]) {
    for (const offset of [-14, 14]) {
      for (let along = -448; along <= 448; along += 112) {
        lampPoints.push({
          x: line + offset,
          z: along,
          axis: 'z',
        });
        lampPoints.push({
          x: along,
          z: line + offset,
          axis: 'x',
        });
      }
    }
  }
  const lampPoles = new THREE.InstancedMesh(lampPoleGeometry, lampPoleMaterial, lampPoints.length);
  const lampHeads = new THREE.InstancedMesh(lampHeadGeometry, lampHeadMaterial, lampPoints.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < lampPoints.length; i++) {
    const p = lampPoints[i];
    dummy.position.set(p.x, 3.5, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    lampPoles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x + (p.axis === 'x' ? 0.75 : 0), 7, p.z + (p.axis === 'z' ? 0.75 : 0));
    dummy.updateMatrix();
    lampHeads.setMatrixAt(i, dummy.matrix);
  }
  group.add(lampPoles, lampHeads);

  const signalPoleMaterial = new THREE.MeshStandardMaterial({ color: 0x41433f, roughness: 0.8 });
  const signalHousingMaterial = new THREE.MeshStandardMaterial({ color: 0x262b29, roughness: 0.7 });
  const signalLightMaterial = new THREE.MeshStandardMaterial({
    color: 0xe56b4c,
    emissive: 0xe34d31,
    emissiveIntensity: 0.8,
  });
  for (const [x, z] of [[0, 0], [112, 0], [0, 112], [-112, 0], [0, -112], [224, 224]]) {
    for (const side of [-1, 1]) {
      addBox(group, new THREE.BoxGeometry(0.18, 4.4, 0.18), signalPoleMaterial, x + side * 10, 2.2, z + 10);
      addBox(group, new THREE.BoxGeometry(0.5, 1.4, 0.48), signalHousingMaterial, x + side * 10, 4.7, z + 10);
      addBox(group, new THREE.BoxGeometry(0.24, 0.24, 0.08), signalLightMaterial, x + side * 10, 5, z + 9.73);
    }
  }

  return group;
}

export function pointOnRoad(world, x, z) {
  let nearest = null;
  for (const road of world.roads) {
    const dist = road.axis === 'x' ? Math.abs(x - road.line) : Math.abs(z - road.line);
    if (!nearest || dist < nearest.dist) {
      nearest = { axis: road.axis, line: road.line, dist, name: road.name };
    }
  }
  return nearest;
}

export function clampToCity(x, z) {
  return {
    x: clamp(x, -560, 560),
    z: clamp(z, -560, 560),
  };
}
