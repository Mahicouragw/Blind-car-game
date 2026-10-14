/**
 * The 3D world: renderer, sky, lighting, terrain, road surface and barriers.
 *
 * Everything is procedural Three.js geometry built from the SAME validated
 * centre-line the physics and the voice guidance use, so what you see is exactly
 * what the car drives on and exactly what the announcements describe. No
 * third-party models are required; the CC0 Kenney GLBs remain a documented
 * fallback.
 *
 * Coordinate mapping: track space is X east / Z south, Three.js is Y up, so a
 * track point (x, z) maps directly to Vector3(x, y, z). North is -Z in both.
 *
 * @module world/scene3d
 */

import * as THREE from '../../vendor/three/three.module.js';

export const QUALITY = {
  low: { shadowMapSize: 1024, shadows: false, pixelRatio: 1, spectators: 0, trees: 120, antialias: false },
  medium: { shadowMapSize: 1024, shadows: true, pixelRatio: 1.25, spectators: 400, trees: 260, antialias: false },
  high: { shadowMapSize: 2048, shadows: true, pixelRatio: 2, spectators: 900, trees: 520, antialias: true },
};

export const PALETTE = {
  asphalt: 0x2c2f33,
  asphaltDark: 0x232629,
  kerbRed: 0xc8322b,
  kerbWhite: 0xe8e6e0,
  line: 0xf2f0ea,
  grass: 0x4c7a3a,
  grassDry: 0x6d7f3c,
  gravel: 0xa89274,
  barrier: 0xd9d6cf,
  barrierRed: 0xb4342c,
  tyre: 0x1b1b1d,
  concrete: 0x9a968d,
  roofBlue: 0x2f5f8f,
  roofOrange: 0xc2622a,
  sand: 0xcbb894,
  water: 0x3d6f86,
};

/**
 * @param {object} config
 * @param {HTMLElement} config.canvas
 * @param {'low'|'medium'|'high'} [config.quality]
 */
/** Can this browser give us a WebGL context at all? */
export function webglAvailable() {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

export function createRenderer(config) {
  const quality = QUALITY[config.quality ?? 'medium'] ?? QUALITY.medium;
  const renderer = new THREE.WebGLRenderer({
    canvas: config.canvas,
    antialias: quality.antialias,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

/** Sky dome, sun, ambient and a shadow-casting directional light. */
export function buildSkyAndLighting(scene, opts = {}) {
  const group = new THREE.Group();
  group.name = 'sky';

  // Gradient sky dome, inside-facing.
  const skyGeo = new THREE.SphereGeometry(2600, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3f7fc4) },
      midColor: { value: new THREE.Color(0x9dc6e8) },
      bottomColor: { value: new THREE.Color(0xe4dcc9) },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 midColor; uniform vec3 bottomColor;
      varying vec3 vWorld;
      void main() {
        float h = normalize(vWorld).y;
        vec3 col = h > 0.0 ? mix(midColor, topColor, pow(h, 0.55)) : mix(midColor, bottomColor, pow(-h, 0.4));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'skyDome';
  group.add(sky);

  const hemi = new THREE.HemisphereLight(0xbcd8f0, 0x4a5137, 0.85);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dc, 1.5);
  sun.position.set(240, 330, 160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(opts.shadowMapSize ?? 1024, opts.shadowMapSize ?? 1024);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 1100;
  sun.shadow.camera.left = -180;
  sun.shadow.camera.right = 180;
  sun.shadow.camera.top = 180;
  sun.shadow.camera.bottom = -180;
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.35;
  sun.name = 'sun';
  group.add(sun);
  group.add(sun.target);

  const fill = new THREE.DirectionalLight(0xa8c8e8, 0.35);
  fill.position.set(-200, 140, -180);
  group.add(fill);

  scene.add(group);
  scene.fog = new THREE.Fog(0xc3d8e8, 700, 2300);
  return { group, sun, hemi, sky };
}

/**
 * Build a flat ribbon mesh along the centre-line, offset sideways and lifted in
 * Y. This one helper produces the road, the gravel, the kerbs, the barriers and
 * the pit lane, so they all share exactly the same geometry source.
 *
 * @param {Array<{x:number,z:number,heading:number}>} points
 */
export function ribbonGeometry(points, { innerOffset, outerOffset, y = 0, closed = true }) {
  const n = points.length;
  const count = closed ? n : n - 1;
  const positions = new Float32Array(count * 6 * 3);
  const uvs = new Float32Array(count * 6 * 2);
  let p = 0;
  let u = 0;
  let cumulative = 0;

  const normalAt = (i) => {
    const pt = points[i];
    // Right-hand normal is (sin h, cos h).
    return { x: Math.sin(pt.heading), z: Math.cos(pt.heading) };
  };

  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const na = normalAt(i);
    const nb = normalAt((i + 1) % n);

    const a0 = { x: a.x + na.x * innerOffset, z: a.z + na.z * innerOffset };
    const a1 = { x: a.x + na.x * outerOffset, z: a.z + na.z * outerOffset };
    const b0 = { x: b.x + nb.x * innerOffset, z: b.z + nb.z * innerOffset };
    const b1 = { x: b.x + nb.x * outerOffset, z: b.z + nb.z * outerOffset };

    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    const v0 = cumulative;
    const v1 = cumulative + segLen;
    cumulative = v1;

    // Two triangles: a0,a1,b1 and a0,b1,b0
    const verts = [a0, a1, b1, a0, b1, b0];
    const uv = [
      [v0, 0], [v0, 1], [v1, 1],
      [v0, 0], [v1, 1], [v1, 0],
    ];
    for (let k = 0; k < 6; k++) {
      positions[p++] = verts[k].x;
      positions[p++] = y;
      positions[p++] = verts[k].z;
      uvs[u++] = uv[k][0];
      uvs[u++] = uv[k][1];
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

/** Asphalt, painted lines, kerbs and the start/finish line. */
export function buildRoad(track, { shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'road';
  const g = track.geometry;
  const pts = g.points;
  const halfW = g.halfWidth;

  // --- asphalt ---
  const roadTex = makeAsphaltTexture();
  const road = new THREE.Mesh(
    ribbonGeometry(pts, { innerOffset: -halfW, outerOffset: halfW, y: 0.02 }),
    roadTex
      ? new THREE.MeshStandardMaterial({ map: roadTex, color: 0xffffff, roughness: 0.94, metalness: 0.02 })
      : new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.94, metalness: 0.02 })
  );
  road.receiveShadow = shadows;
  road.name = 'asphalt';
  group.add(road);

  // --- white edge lines ---
  for (const side of [-1, 1]) {
    const line = new THREE.Mesh(
      ribbonGeometry(pts, { innerOffset: side * (halfW - 0.55), outerOffset: side * (halfW - 0.1), y: 0.035 }),
      new THREE.MeshBasicMaterial({ color: PALETTE.line, transparent: true, opacity: 0.82 })
    );
    line.name = `edgeLine${side > 0 ? 'Right' : 'Left'}`;
    group.add(line);
  }

  // --- start / finish line: chequered band across the track ---
  group.add(buildFinishLine(track));

  // --- kerbs on the inside of every corner ---
  group.add(buildKerbs(track));

  // --- gravel runoff outside the corners ---
  group.add(buildRunoff(track));

  return group;
}

function buildFinishLine(track) {
  const g = track.geometry;
  const halfW = g.halfWidth;
  const s = track.startFinishS;
  const group = new THREE.Group();
  group.name = 'finishLine';

  const rows = 4;
  const cols = 12;
  const bandLength = 3.2;
  const cellW = (halfW * 2) / cols;
  const cellL = bandLength / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2 !== 0) continue;
      const ds = -bandLength / 2 + r * cellL;
      const p = g.pointAt(g.normaliseS(s + ds + cellL / 2));
      const nx = Math.sin(p.heading);
      const nz = Math.cos(p.heading);
      const lateral = -halfW + c * cellW + cellW / 2;
      const geo = new THREE.PlaneGeometry(cellW * 0.94, cellL * 0.94);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf4f2ec }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = -p.heading;
      mesh.position.set(p.x + nx * lateral, 0.045, p.z + nz * lateral);
      group.add(mesh);
    }
  }
  return group;
}

/**
 * Red-and-white kerbs on the inside apex of each corner.
 *
 * One merged mesh per corner with per-vertex colours: 12 draw calls instead of
 * roughly 250, which is the difference between a phone holding 60fps and
 * holding 20.
 */
function buildKerbs(track) {
  const group = new THREE.Group();
  group.name = 'kerbs';
  const g = track.geometry;
  const red = new THREE.Color(PALETTE.kerbRed);
  const white = new THREE.Color(PALETTE.kerbWhite);

  for (const zone of track.zones) {
    if (zone.kind !== 'corner' && zone.kind !== 'chicane') continue;
    // Inside of the corner is the side the car turns toward: a right-hand
    // corner has its inside to the RIGHT, i.e. positive lateral.
    const insideSign = zone.direction === 'right' ? 1 : -1;
    const steps = Math.max(6, Math.round(zone.span / 3.2));
    const geos = [];
    for (let i = 0; i < steps; i++) {
      const s0 = zone.from + (zone.span * i) / steps;
      const s1 = zone.from + (zone.span * (i + 1)) / steps;
      const sub = sampleSpan(g, s0, s1, 3);
      if (sub.length < 2) continue;
      const geo = ribbonGeometry(sub, {
        innerOffset: insideSign * (g.halfWidth - 1.5),
        outerOffset: insideSign * (g.halfWidth + 0.7),
        y: 0.05,
        closed: false,
      });
      const colour = i % 2 === 0 ? red : white;
      const count = geo.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let k = 0; k < count; k++) {
        colors[k * 3] = colour.r;
        colors[k * 3 + 1] = colour.g;
        colors[k * 3 + 2] = colour.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geos.push(geo);
    }
    if (!geos.length) continue;
    const merged = mergeBufferGeometries(geos);
    for (const geo of geos) geo.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    mesh.name = `kerb.${zone.id}`;
    group.add(mesh);
  }
  return group;
}

/**
 * Minimal geometry merge for non-indexed geometries that share the same
 * attribute set (position, uv, color). three.js does not ship a merge helper in
 * the core build, and pulling in an addon would mean vendoring another file.
 */
export function mergeBufferGeometries(geometries) {
  const list = geometries.filter(Boolean);
  if (!list.length) return null;
  const names = Object.keys(list[0].attributes);
  const totals = {};
  for (const name of names) totals[name] = 0;
  for (const geo of list) {
    for (const name of names) {
      const attr = geo.getAttribute(name);
      if (!attr) return null;
      totals[name] += attr.count;
    }
  }
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const itemSize = list[0].getAttribute(name).itemSize;
    const array = new Float32Array(totals[name] * itemSize);
    let offset = 0;
    for (const geo of list) {
      const attr = geo.getAttribute(name);
      array.set(attr.array, offset);
      offset += attr.array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  return out;
}

/** Gravel traps outside corners, wider for faster corners. */
function buildRunoff(track) {
  const group = new THREE.Group();
  group.name = 'runoff';
  const g = track.geometry;
  const gravelMat = new THREE.MeshStandardMaterial({ color: PALETTE.gravel, roughness: 1 });

  for (const zone of track.zones) {
    if (zone.kind !== 'corner' && zone.kind !== 'chicane') continue;
    const outsideSign = zone.direction === 'right' ? -1 : 1;
    const depth = zone.severity === 'hairpin' ? 9 : zone.severity === 'sharp' ? 12 : 8;
    const pad = zone.severity === 'hairpin' ? 30 : 22;
    const s0 = zone.from - pad;
    const s1 = zone.from + zone.span + pad;
    const sub = sampleSpan(g, s0, s1);
    if (sub.length < 2) continue;
    const mesh = new THREE.Mesh(
      ribbonGeometry(sub, {
        innerOffset: outsideSign * (g.halfWidth + 0.6),
        outerOffset: outsideSign * (g.halfWidth + depth),
        y: 0.0,
        closed: false,
      }),
      gravelMat
    );
    mesh.receiveShadow = true;
    mesh.name = `runoff.${zone.id}`;
    group.add(mesh);
  }
  return group;
}

/** Resample the centre-line over an arc-length span (handles wrapping). */
export function sampleSpan(g, s0, s1, step = 4) {
  const out = [];
  let s = s0;
  const end = s1;
  while (s <= end + 1e-6) {
    const p = g.pointAt(g.normaliseS(s));
    out.push({ x: p.x, z: p.z, heading: p.heading });
    s += step;
  }
  const last = g.pointAt(g.normaliseS(end));
  out.push({ x: last.x, z: last.z, heading: last.heading });
  return out;
}

/** Ground: grass everywhere, plus a harbour and the salt flats for orientation. */
export function buildGround(track) {
  const group = new THREE.Group();
  group.name = 'ground';
  const b = track.geometry.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);

  const grassTex = makeGrassTexture();
  if (grassTex) {
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(span / 45, span / 45);
  }

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 5, span * 5, 1, 1),
    grassTex
      ? new THREE.MeshStandardMaterial({ map: grassTex, color: 0xffffff, roughness: 1 })
      : new THREE.MeshStandardMaterial({ color: PALETTE.grass, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.06, cz);
  ground.receiveShadow = true;
  ground.name = 'grass';
  group.add(ground);

  // The harbour, south-east of the circuit: a recognisable landmark a blind
  // player can also hear described, and a sighted player can see.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 1.1, span * 0.5, 1, 1),
    new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.25, metalness: 0.35 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(b.maxX + span * 0.35, -0.2, b.maxZ + span * 0.1);
  water.name = 'harbour';
  group.add(water);

  // Concrete apron around the pit building so the paddock reads as a place.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(230, 150, 1, 1),
    new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.95 })
  );
  apron.rotation.x = -Math.PI / 2;
  const pitMid = track.pit.points[Math.floor(track.pit.points.length * 0.45)];
  apron.position.set(pitMid.x + 34, 0.005, pitMid.z);
  apron.receiveShadow = true;
  apron.name = 'paddockApron';
  group.add(apron);

  return group;
}

/**
 * Safety furniture: Armco barriers along the whole lap, tyre walls stacked at
 * the corners that need them, and catch fencing behind the gravel.
 */
export function buildBarriers(track, { shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'barriers';
  const g = track.geometry;
  const halfW = g.halfWidth;

  const barrierMat = new THREE.MeshStandardMaterial({ color: PALETTE.barrier, roughness: 0.6, metalness: 0.25 });
  const redMat = new THREE.MeshStandardMaterial({ color: PALETTE.barrierRed, roughness: 0.6 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: PALETTE.tyre, roughness: 0.95 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6b6f74, roughness: 0.8 });

  // --- continuous barrier on both sides ---
  for (const side of [-1, 1]) {
    const offset = halfW + 15;
    const geo = ribbonGeometry(g.points, {
      innerOffset: side * offset,
      outerOffset: side * (offset + 0.7),
      y: 0.85,
      closed: true,
    });
    const mesh = new THREE.Mesh(geo, side > 0 ? barrierMat : barrierMat);
    mesh.castShadow = shadows;
    mesh.name = `barrier.${side > 0 ? 'right' : 'left'}`;
    // Ribbon geometry is flat; give it height by adding a second course below.
    group.add(mesh);
    const lower = new THREE.Mesh(
      ribbonGeometry(g.points, { innerOffset: side * offset, outerOffset: side * (offset + 0.7), y: 0.45, closed: true }),
      redMat
    );
    lower.name = `barrierLower.${side > 0 ? 'right' : 'left'}`;
    group.add(lower);
  }

  // --- posts ---
  const postGeo = new THREE.CylinderGeometry(0.14, 0.14, 1.1, 6);
  const postCount = Math.min(360, Math.floor(g.length / 18)) * 2;
  const posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
  const m = new THREE.Matrix4();
  let pi = 0;
  for (let i = 0; i < postCount / 2 && pi < postCount; i++) {
    const s = (i / (postCount / 2)) * g.length;
    const p = g.pointAt(s);
    for (const side of [-1, 1]) {
      if (pi >= postCount) break;
      const nx = Math.sin(p.heading);
      const nz = Math.cos(p.heading);
      m.makeTranslation(p.x + nx * side * (halfW + 15.3), 0.55, p.z + nz * side * (halfW + 15.3));
      posts.setMatrixAt(pi++, m);
    }
  }
  posts.count = pi;
  posts.name = 'barrierPosts';
  group.add(posts);

  // --- tyre walls at the corners that need them ---
  const tyreGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.42, 10);
  const tyreSpots = [];
  for (const zone of track.zones) {
    if (zone.kind !== 'corner' && zone.kind !== 'chicane') continue;
    if (zone.severity !== 'hairpin' && zone.severity !== 'sharp') continue;
    const outsideSign = zone.direction === 'right' ? -1 : 1;
    const rows = zone.severity === 'hairpin' ? 3 : 2;
    const along = Math.max(4, Math.round(zone.span / 2.4));
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i <= along; i++) {
        const s = zone.from - 8 + ((zone.span + 16) * i) / along;
        const p = g.pointAt(g.normaliseS(s));
        const nx = Math.sin(p.heading);
        const nz = Math.cos(p.heading);
        const off = outsideSign * (halfW + 9.6 + r * 1.05);
        tyreSpots.push([p.x + nx * off, 0.22 + r * 0.44, p.z + nz * off]);
      }
    }
  }
  const tyres = new THREE.InstancedMesh(tyreGeo, tyreMat, Math.max(1, tyreSpots.length));
  tyreSpots.forEach(([x, y, z], i) => {
    m.makeTranslation(x, y, z);
    tyres.setMatrixAt(i, m);
  });
  tyres.castShadow = shadows;
  tyres.receiveShadow = shadows;
  tyres.name = 'tyreWalls';
  group.add(tyres);

  // --- catch fencing behind the gravel at fast corners ---
  const fenceMat = new THREE.MeshStandardMaterial({
    color: 0x8f9498,
    roughness: 0.9,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
  });
  for (const zone of track.zones) {
    if (zone.kind !== 'corner' && zone.kind !== 'chicane') continue;
    if (zone.severity === 'gentle') continue;
    const outsideSign = zone.direction === 'right' ? -1 : 1;
    const sub = sampleSpan(g, zone.from - 26, zone.from + zone.span + 26, 5);
    const fence = new THREE.Mesh(
      ribbonGeometry(sub, {
        innerOffset: outsideSign * (halfW + 13.2),
        outerOffset: outsideSign * (halfW + 13.6),
        y: 2.1,
        closed: false,
      }),
      fenceMat
    );
    fence.name = `fence.${zone.id}`;
    group.add(fence);
  }

  return group;
}

// ------------------------------------------------------------- textures

/** Asphalt: subtle mottling drawn once into a canvas texture. */
function makeAsphaltTexture() {
  const size = 256;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null; // headless: geometry still builds, textures are skipped
  ctx.fillStyle = '#2c2f33';
  ctx.fillRect(0, 0, size, size);
  // Deterministic speckle so the texture is identical every load.
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 5200; i++) {
    const v = 24 + Math.floor(rnd() * 34);
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 4})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1.6, 1.6);
  }
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `rgba(18,19,21,${0.12 + rnd() * 0.14})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(rnd() * size, rnd() * size);
    ctx.lineTo(rnd() * size, rnd() * size);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.09, 0.09);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGrassTexture() {
  const size = 128;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#4c7a3a';
  ctx.fillRect(0, 0, size, size);
  let seed = 777;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 2600; i++) {
    const g = 92 + Math.floor(rnd() * 46);
    ctx.fillStyle = `rgb(${Math.floor(g * 0.62)},${g},${Math.floor(g * 0.42)})`;
    ctx.fillRect(rnd() * size, rnd() * size, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  // Node fallback so importing this module headless does not throw.
  return { width: w, height: h, getContext: () => null };
}

export { THREE };
