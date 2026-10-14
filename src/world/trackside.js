/**
 * Trackside: pit lane and garages, grandstands and spectators, officials,
 * sponsor boards, distance and braking markers, direction arrows, the start
 * light gantry, and the scenery that gives the circuit a place.
 *
 * All sponsor artwork is original to this game, drawn into canvas textures at
 * runtime from the SPONSORS list. No third-party branding is reproduced.
 *
 * @module world/trackside
 */

import * as THREE from '../../vendor/three/three.module.js';
import { PALETTE, ribbonGeometry, sampleSpan } from './scene3d.js';

// ------------------------------------------------------------------ pit lane

/**
 * Pit lane ribbon, six garages, the pit wall and the paddock service buildings.
 */
export function buildPitLane(track, { shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'pitLane';
  const pit = track.pit;
  const pts = pit.points.map((p) => {
    // pit.points carry {x,z,s,offset}; heading is derived from the next point.
    return p;
  });
  const withHeading = pts.map((p, i) => {
    const n = pts[Math.min(pts.length - 1, i + 1)];
    const prv = pts[Math.max(0, i - 1)];
    const heading = Math.atan2(-(n.z - prv.z), n.x - prv.x);
    return { x: p.x, z: p.z, heading };
  });

  const halfW = pit.width / 2;
  const asphalt = new THREE.Mesh(
    ribbonGeometry(withHeading, { innerOffset: -halfW, outerOffset: halfW, y: 0.03, closed: false }),
    new THREE.MeshStandardMaterial({ color: PALETTE.asphaltDark, roughness: 0.95 })
  );
  asphalt.receiveShadow = shadows;
  asphalt.name = 'pitAsphalt';
  group.add(asphalt);

  // Pit lane speed line and the entry/exit arrows.
  const centreLine = new THREE.Mesh(
    ribbonGeometry(withHeading, { innerOffset: -0.14, outerOffset: 0.14, y: 0.05, closed: false }),
    new THREE.MeshBasicMaterial({ color: PALETTE.line, transparent: true, opacity: 0.7 })
  );
  centreLine.name = 'pitCentreLine';
  group.add(centreLine);

  // --- garages ---
  const garageMat = new THREE.MeshStandardMaterial({ color: 0xdad6cd, roughness: 0.8 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3f5a72, roughness: 0.6, metalness: 0.2 });
  const roofMat = new THREE.MeshStandardMaterial({ color: PALETTE.roofBlue, roughness: 0.7 });
  const garageCount = pit.garages ?? 6;

  for (let i = 0; i < garageCount; i++) {
    const t = 0.16 + (i / Math.max(1, garageCount - 1)) * 0.6;
    const idx = Math.min(withHeading.length - 1, Math.floor(t * withHeading.length));
    const p = withHeading[idx];
    const nx = Math.sin(p.heading);
    const nz = Math.cos(p.heading);
    const back = 17;
    const g1 = new THREE.Group();
    g1.name = `garage.${i + 1}`;

    const box = new THREE.Mesh(new THREE.BoxGeometry(15, 5.4, 11), garageMat);
    box.position.set(0, 2.7, 0);
    box.castShadow = shadows;
    box.receiveShadow = shadows;
    g1.add(box);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(16.2, 0.5, 12.2), roofMat);
    roof.position.set(0, 5.65, 0);
    roof.castShadow = shadows;
    g1.add(roof);

    const door = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 4.1), doorMat);
    door.position.set(0, 2.1, -5.56);
    g1.add(door);

    g1.position.set(p.x + nx * back, 0, p.z + nz * back);
    g1.rotation.y = p.heading;
    group.add(g1);
  }

  // --- pit wall between the lane and the circuit ---
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb9b5ac, roughness: 0.85 });
  const wall = new THREE.Mesh(
    ribbonGeometry(withHeading, { innerOffset: -(halfW + 0.5), outerOffset: -(halfW + 1.1), y: 1.05, closed: false }),
    wallMat
  );
  wall.castShadow = shadows;
  wall.name = 'pitWall';
  group.add(wall);

  // --- timing stand over the pit wall ---
  const stand = new THREE.Mesh(new THREE.BoxGeometry(26, 4.4, 5), new THREE.MeshStandardMaterial({ color: 0x8d8f92, roughness: 0.7 }));
  const midIdx = Math.floor(withHeading.length * 0.5);
  const mid = withHeading[midIdx];
  stand.position.set(mid.x - Math.sin(mid.heading) * (halfW + 4.2), 2.2, mid.z - Math.cos(mid.heading) * (halfW + 4.2));
  stand.rotation.y = mid.heading;
  stand.castShadow = shadows;
  stand.name = 'timingStand';
  group.add(stand);

  // --- service buildings in the paddock ---
  group.add(buildPaddock(track, shadows));

  return group;
}

function buildPaddock(track, shadows) {
  const group = new THREE.Group();
  group.name = 'paddock';
  const pit = track.pit;
  const anchor = pit.points[Math.floor(pit.points.length * 0.45)];
  const colours = [0xc9c4b8, 0xb3b7bb, 0xd3cbb9];

  const specs = [
    { x: 40, z: -34, w: 34, h: 9, d: 20, c: 0, name: 'raceControl' },
    { x: 74, z: -6, w: 26, h: 7, d: 18, c: 1, name: 'medicalCentre' },
    { x: 44, z: 30, w: 30, h: 6.5, d: 16, c: 2, name: 'hospitality' },
    { x: 84, z: 40, w: 22, h: 5.5, d: 14, c: 0, name: 'tyreStore' },
  ];
  for (const s of specs) {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(s.w, s.h, s.d),
      new THREE.MeshStandardMaterial({ color: colours[s.c], roughness: 0.85 })
    );
    b.position.set(anchor.x + s.x, s.h / 2, anchor.z + s.z);
    b.castShadow = shadows;
    b.receiveShadow = shadows;
    b.name = `building.${s.name}`;
    group.add(b);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(s.w + 1.4, 0.6, s.d + 1.4),
      new THREE.MeshStandardMaterial({ color: s.name === 'raceControl' ? PALETTE.roofOrange : 0x6d7278, roughness: 0.8 })
    );
    roof.position.set(anchor.x + s.x, s.h + 0.3, anchor.z + s.z);
    roof.castShadow = shadows;
    roof.name = `roof.${s.name}`;
    group.add(roof);
  }
  return group;
}

// ------------------------------------------------------------- grandstands

/**
 * Grandstands with spectators, plus marshals and officials around the circuit.
 * Spectators are instanced: a few hundred small capsules is far cheaper than
 * individual meshes, which matters on a phone.
 */
export function buildGrandstands(track, { spectators = 400, shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'grandstands';
  const g = track.geometry;

  const stands = [
    { id: 'main', s: track.startFinishS + 30, length: 130, side: -1, tiers: 8, roof: true },
    { id: 'eastTerrace', s: 640, length: 90, side: 1, tiers: 5, roof: true },
    { id: 'quayside', s: 2160, length: 110, side: -1, tiers: 6, roof: false },
    { id: 'hairpinBank', s: 2560, length: 70, side: -1, tiers: 4, roof: false },
  ];

  const seatMat = new THREE.MeshStandardMaterial({ color: 0x8e8b84, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: PALETTE.roofBlue, roughness: 0.6 });

  const crowdPositions = [];
  const officialPositions = [];

  for (const spec of stands) {
    const standGroup = new THREE.Group();
    standGroup.name = `stand.${spec.id}`;
    const sub = sampleSpan(g, spec.s, spec.s + spec.length, 6);
    if (sub.length < 2) continue;
    const baseOffset = spec.side * (g.halfWidth + 26);

    for (let tier = 0; tier < spec.tiers; tier++) {
      const off = baseOffset + spec.side * tier * 2.4;
      const y = 1.2 + tier * 1.35;
      const step = new THREE.Mesh(
        ribbonGeometry(sub, { innerOffset: off, outerOffset: off + spec.side * 2.3, y, closed: false }),
        seatMat
      );
      step.castShadow = shadows;
      step.receiveShadow = shadows;
      step.name = `tier.${spec.id}.${tier}`;
      standGroup.add(step);

      // Collect crowd seats on the upper tiers.
      if (tier >= 1 && spectators > 0) {
        for (let i = 1; i < sub.length; i += 2) {
          const p = sub[i];
          const nx = Math.sin(p.heading);
          const nz = Math.cos(p.heading);
          crowdPositions.push([p.x + nx * (off + spec.side * 1.1), y + 0.55, p.z + nz * (off + spec.side * 1.1)]);
        }
      }
    }

    if (spec.roof) {
      const roofOff = baseOffset + spec.side * (spec.tiers * 2.4 + 1.5);
      const roofMesh = new THREE.Mesh(
        ribbonGeometry(sub, { innerOffset: baseOffset - spec.side * 1.5, outerOffset: roofOff, y: 1.6 + spec.tiers * 1.35 + 3.2, closed: false }),
        roofMat
      );
      roofMesh.castShadow = shadows;
      roofMesh.name = `roof.${spec.id}`;
      standGroup.add(roofMesh);

      // Roof supports.
      const supportGeo = new THREE.CylinderGeometry(0.3, 0.3, spec.tiers * 1.35 + 3.6, 6);
      const supportMat = new THREE.MeshStandardMaterial({ color: 0x71767b, roughness: 0.8 });
      for (let i = 2; i < sub.length; i += Math.max(3, Math.floor(sub.length / 6))) {
        const p = sub[i];
        const nx = Math.sin(p.heading);
        const nz = Math.cos(p.heading);
        const sup = new THREE.Mesh(supportGeo, supportMat);
        sup.position.set(p.x + nx * (roofOff - spec.side * 1), (spec.tiers * 1.35 + 3.6) / 2, p.z + nz * (roofOff - spec.side * 1));
        sup.castShadow = shadows;
        standGroup.add(sup);
      }
    }
    group.add(standGroup);
  }

  // --- marshals and officials around the circuit ---
  for (const zone of track.zones) {
    if (zone.kind !== 'corner' && zone.kind !== 'chicane') continue;
    const p = g.pointAt(g.normaliseS(zone.from + zone.span * 0.5));
    const side = zone.direction === 'right' ? 1 : -1;
    const nx = Math.sin(p.heading);
    const nz = Math.cos(p.heading);
    officialPositions.push([p.x + nx * side * (g.halfWidth + 12), p.z + nz * side * (g.halfWidth + 12)]);
  }
  // Start-line officials.
  const sf = g.pointAt(track.startFinishS);
  officialPositions.push([sf.x + Math.sin(sf.heading) * -(g.halfWidth + 8), sf.z + Math.cos(sf.heading) * -(g.halfWidth + 8)]);
  officialPositions.push([sf.x + Math.sin(sf.heading) * (g.halfWidth + 8), sf.z + Math.cos(sf.heading) * (g.halfWidth + 8)]);

  // --- instanced spectators ---
  const cap = Math.max(0, Math.min(spectators * 3, crowdPositions.length));
  if (cap > 0) {
    const bodyGeo = new THREE.CapsuleGeometry(0.28, 0.62, 3, 6);
    const crowdMats = [0xc0453c, 0x3f6fb0, 0xd9b23c, 0x3f9c5a, 0xe0e0e0, 0x6c4a8f];
    const perMat = Math.ceil(cap / crowdMats.length);
    const m = new THREE.Matrix4();
    crowdMats.forEach((colour, mi) => {
      const slice = crowdPositions.slice(mi * perMat, (mi + 1) * perMat);
      if (!slice.length) return;
      const inst = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95 }), slice.length);
      slice.forEach(([x, y, z], i) => {
        m.makeTranslation(x, y, z);
        inst.setMatrixAt(i, m);
      });
      inst.name = `crowd.${mi}`;
      inst.castShadow = false;
      group.add(inst);
    });
  }

  // --- instanced officials in high-visibility orange ---
  if (officialPositions.length) {
    const geo = new THREE.CapsuleGeometry(0.32, 0.9, 3, 6);
    const inst = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xe8762a, roughness: 0.9 }),
      officialPositions.length
    );
    const m = new THREE.Matrix4();
    officialPositions.forEach(([x, z], i) => {
      m.makeTranslation(x, 0.85, z);
      inst.setMatrixAt(i, m);
    });
    inst.castShadow = shadows;
    inst.name = 'officials';
    group.add(inst);
  }

  return group;
}

// ------------------------------------------------------------------ signage

/**
 * Sponsor boards, distance boards, braking markers and direction arrows painted
 * on the asphalt. All artwork is generated here from the game's own sponsor list.
 */
export function buildSignage(track, { shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'signage';
  const g = track.geometry;
  const halfW = g.halfWidth;

  // --- perimeter sponsor boards ---
  const boardGeo = new THREE.BoxGeometry(12, 2.4, 0.34);
  const placements = [];
  const spacing = 62;
  const count = Math.floor(g.length / spacing);
  for (let i = 0; i < count; i++) {
    const s = (i / count) * g.length;
    const zone = zoneAt(track, s);
    // Keep boards out of the corner run-off where a car might reach them.
    if (zone.kind === 'corner' || zone.kind === 'chicane') continue;
    const side = i % 2 === 0 ? 1 : -1;
    placements.push({ s, side, sponsorIndex: i });
  }
  const sponsorTextures = track.sponsors.map((sp, i) => makeSponsorTexture(sp, i));
  placements.forEach((p, i) => {
    const pt = g.pointAt(g.normaliseS(p.s));
    const nx = Math.sin(pt.heading);
    const nz = Math.cos(pt.heading);
    const sp = track.sponsors[p.sponsorIndex % track.sponsors.length];
    const tex = sponsorTextures[p.sponsorIndex % sponsorTextures.length];
    const faceMat = tex
      ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })
      : new THREE.MeshStandardMaterial({ color: 0x123a63, roughness: 0.7 });
    const board = new THREE.Mesh(
      boardGeo,
      [
        new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.85 }),
        new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.85 }),
        new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.85 }),
        new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.85 }),
        faceMat,
        faceMat,
      ]
    );
    board.position.set(pt.x + nx * p.side * (halfW + 18.5), 1.5, pt.z + nz * p.side * (halfW + 18.5));
    board.rotation.y = pt.heading + (p.side > 0 ? Math.PI : 0);
    board.castShadow = shadows;
    board.name = `adBoard.${i}.${sp.id}`;
    group.add(board);
  });

  // --- braking distance boards: 100, 50 and the turn-in marker ---
  for (const zone of track.zones) {
    if (zone.kind !== 'braking') continue;
    const corner = track.zones.find((z) => z.id === zone.cornerZoneId);
    const marks = [
      { offset: 0, text: '100' },
      { offset: zone.span * 0.5, text: '50' },
      { offset: zone.span - 2, text: corner ? cornerDirectionGlyph(corner) : 'TURN' },
    ];
    marks.forEach((mk, i) => {
      const s = zone.from + mk.offset;
      const p = g.pointAt(g.normaliseS(s));
      const side = corner && corner.direction === 'right' ? -1 : 1;
      const nx = Math.sin(p.heading);
      const nz = Math.cos(p.heading);
      const board = new THREE.Group();
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 2.6, 0.22),
        markerMaterial(makeMarkerTexture(mk.text))
      );
      panel.position.y = 2.3;
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 2.3, 6),
        new THREE.MeshStandardMaterial({ color: 0x70757a, roughness: 0.85 })
      );
      post.position.y = 1.15;
      board.add(panel, post);
      board.position.set(p.x + nx * side * (halfW + 4.6), 0, p.z + nz * side * (halfW + 4.6));
      board.rotation.y = p.heading;
      board.castShadow = shadows;
      board.name = `distanceBoard.${zone.id}.${i}`;
      group.add(board);
    });
  }

  // --- direction arrows painted on the asphalt before each corner ---
  for (const zone of track.zones) {
    if (zone.kind !== 'corner' && zone.kind !== 'chicane') continue;
    const arrowS = zone.from - 26;
    const p = g.pointAt(g.normaliseS(arrowS));
    const arrow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 6.4),
      new THREE.MeshBasicMaterial({ map: makeArrowTexture(zone.direction), transparent: true, opacity: 0.9 })
    );
    arrow.rotation.x = -Math.PI / 2;
    arrow.rotation.z = -p.heading;
    arrow.position.set(p.x, 0.05, p.z);
    arrow.name = `arrow.${zone.id}`;
    group.add(arrow);
  }

  // --- pit lane speed restriction boards ---
  for (const [s, text] of [
    [track.pitEntryS + 12, '60'],
    [track.pitExitS - 20, '60'],
  ]) {
    const p = g.pointAt(g.normaliseS(s));
    const board = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 20),
      new THREE.MeshStandardMaterial({ map: makeMarkerTexture(text, { circle: true }), roughness: 0.7 })
    );
    board.position.set(p.x + Math.sin(p.heading) * (halfW + 5), 2.2, p.z + Math.cos(p.heading) * (halfW + 5));
    board.rotation.y = p.heading;
    board.name = `pitSpeed.${s}`;
    group.add(board);
  }

  return group;
}

function zoneAt(track, s) {
  const ns = track.geometry.normaliseS(s);
  for (const z of track.zones) {
    const from = track.geometry.normaliseS(z.from);
    let to = from + z.span;
    if (to > track.geometry.length) to = track.geometry.length;
    if (ns >= from && ns <= to) return z;
  }
  return track.zones[0];
}

function cornerDirectionGlyph(corner) {
  return corner.direction === 'left' ? '<-' : '->';
}

/**
 * Start-light gantry over the line, the finish banner, and a lap indicator
 * board. The lights are real meshes whose emissive colour the race screen
 * drives during the countdown, so the spoken count and the visual count are the
 * same event.
 */
export function buildStartGantry(track, { shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'startGantry';
  const g = track.geometry;
  const halfW = g.halfWidth;
  const p = g.pointAt(track.startFinishS);
  const nx = Math.sin(p.heading);
  const nz = Math.cos(p.heading);
  const span = halfW + 12;

  const steelMat = new THREE.MeshStandardMaterial({ color: 0x5d6267, roughness: 0.55, metalness: 0.4 });

  const legGeo = new THREE.BoxGeometry(1.5, 11, 1.5);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, steelMat);
    leg.position.set(p.x + nx * side * span, 5.5, p.z + nz * side * span);
    leg.castShadow = shadows;
    leg.name = `gantryLeg.${side > 0 ? 'right' : 'left'}`;
    group.add(leg);
  }

  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 2, 1.1, 1.2), steelMat);
  beam.position.set(p.x, 11.2, p.z);
  beam.rotation.y = p.heading;
  beam.castShadow = shadows;
  beam.name = 'gantryBeam';
  group.add(beam);

  // --- five start lights in two rows, as on a real gantry ---
  const lights = [];
  const housing = new THREE.Mesh(new THREE.BoxGeometry(15, 2.3, 0.9), new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.6 }));
  housing.position.set(p.x, 9.6, p.z);
  housing.rotation.y = p.heading;
  housing.name = 'lightHousing';
  group.add(housing);

  const bulbGeo = new THREE.SphereGeometry(0.55, 14, 10);
  for (let i = 0; i < 5; i++) {
    for (let row = 0; row < 2; row++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x3a1414, emissive: 0x000000, roughness: 0.35 });
      const bulb = new THREE.Mesh(bulbGeo, mat);
      const lateral = -6 + i * 3;
      bulb.position.set(
        p.x + nx * lateral - Math.cos(p.heading) * (row * 0.0 - 0.5),
        9.6 + (row === 0 ? 0.45 : -0.45),
        p.z + nz * lateral + Math.sin(p.heading) * 0.5
      );
      bulb.name = `startLight.${i}.${row}`;
      lights.push({ mesh: bulb, material: mat, index: i });
      group.add(bulb);
    }
  }

  // --- finish banner ---
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 2 - 2, 2.2),
    bannerMaterial(makeBannerTexture('VETTARU INTERNATIONAL CIRCUIT'))
  );
  banner.position.set(p.x, 12.4, p.z);
  banner.rotation.y = p.heading;
  banner.name = 'finishBanner';
  group.add(banner);

  // --- lap indicator board beside the pit wall ---
  const lapBoard = new THREE.Mesh(
    new THREE.BoxGeometry(7, 4, 0.4),
    lapBoardMaterial(makeLapBoardTexture(1, 2))
  );
  const lb = g.pointAt(g.normaliseS(track.startFinishS + 60));
  lapBoard.position.set(lb.x + Math.sin(lb.heading) * -(halfW + 22), 3.4, lb.z + Math.cos(lb.heading) * -(halfW + 22));
  lapBoard.rotation.y = lb.heading;
  lapBoard.castShadow = shadows;
  lapBoard.name = 'lapBoard';
  group.add(lapBoard);

  return { group, lights, lapBoard };
}

/** Repaint the lap board. Called by the race screen when a lap counts. */
export function updateLapBoard(lapBoard, lap, total) {
  if (!lapBoard) return;
  const mat = lapBoard.material;
  if (mat?.map) mat.map.dispose();
  const next = makeLapBoardTexture(lap, total);
  if (next) {
    mat.map = next;
    mat.needsUpdate = true;
  }
}

/** Set the start lights. `lit` is how many are red; 0 with `out=true` = go. */
export function setStartLights(lights, lit, out = false) {
  for (const l of lights ?? []) {
    const on = out ? false : l.index < lit;
    l.material.color.setHex(on ? 0x6a1414 : 0x2a2a2a);
    l.material.emissive.setHex(on ? 0xff2a1e : out && l.index < 5 ? 0x1aff5a : 0x000000);
    l.material.emissiveIntensity = on || out ? 2.1 : 0;
  }
}

// ------------------------------------------------------------------ scenery

/** Trees, distant city skyline and harbour cranes, so the horizon is a place. */
export function buildScenery(track, { trees = 260, shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'scenery';
  const g = track.geometry;
  const b = g.bounds;

  // --- trees outside the barrier line ---
  let seed = 4242;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 3.2, 5);
  const crownGeo = new THREE.ConeGeometry(2.5, 6.2, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4432, roughness: 1 });
  const crownMats = [
    new THREE.MeshStandardMaterial({ color: 0x2f5c2c, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x3d6b32, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x4a7a38, roughness: 1 }),
  ];

  const spots = [];
  let attempts = 0;
  while (spots.length < trees && attempts < trees * 14) {
    attempts++;
    const x = b.minX - 120 + rnd() * (b.maxX - b.minX + 240);
    const z = b.minZ - 120 + rnd() * (b.maxZ - b.minZ + 240);
    const near = g.nearest(x, z);
    // Keep clear of the circuit, the pit lane and the paddock.
    if (Math.abs(near.lateral) < g.halfWidth + 34) continue;
    spots.push([x, z, rnd()]);
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMats[0], spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  spots.forEach(([x, z, r], i) => {
    const s = 0.75 + r * 0.8;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r * 6.28);
    sc.set(s, s, s);
    m.compose(new THREE.Vector3(x, 1.6 * s, z), q, sc);
    trunks.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, (3.2 + 3.1) * s, z), q, sc);
    crowns.setMatrixAt(i, m);
  });
  trunks.castShadow = shadows;
  crowns.castShadow = shadows;
  trunks.name = 'treeTrunks';
  crowns.name = 'treeCrowns';
  group.add(trunks, crowns);

  // --- Anandapur skyline, north-west ---
  const buildingMats = [0x8d9099, 0xa89f92, 0x7e8a94, 0xb9b0a3].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })
  );
  const skyline = new THREE.Group();
  skyline.name = 'skyline';
  for (let i = 0; i < 26; i++) {
    const h = 14 + rnd() * 52;
    const w = 12 + rnd() * 20;
    const d = 12 + rnd() * 20;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), buildingMats[i % buildingMats.length]);
    tower.position.set(b.minX - 260 + rnd() * 420, h / 2, b.minZ - 300 - rnd() * 220);
    tower.castShadow = false;
    skyline.add(tower);
  }
  group.add(skyline);

  // --- harbour cranes, east ---
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xc2622a, roughness: 0.7 });
  const cranes = new THREE.Group();
  cranes.name = 'harbourCranes';
  for (let i = 0; i < 4; i++) {
    const crane = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.BoxGeometry(3, 46, 3), craneMat);
    leg.position.y = 23;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(52, 2.4, 2.4), craneMat);
    arm.position.set(14, 44, 0);
    crane.add(leg, arm);
    crane.position.set(b.maxX + 190 + i * 70, 0, b.minZ + 120 + i * 90);
    crane.rotation.y = rnd() * 3;
    cranes.add(crane);
  }
  group.add(cranes);

  return group;
}

// -------------------------------------------------------------- textures

function markerMaterial(tex) {
  return tex
    ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })
    : new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.7 });
}
function bannerMaterial(tex) {
  return tex
    ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: 0x12233a, roughness: 0.8, side: THREE.DoubleSide });
}
function lapBoardMaterial(tex) {
  return tex
    ? new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.6 })
    : new THREE.MeshStandardMaterial({ color: 0x101317, roughness: 0.6 });
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return { width: w, height: h, getContext: () => null };
}

function canvasTexture(canvas, repeatX = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, 1);
  tex.anisotropy = 2;
  return tex;
}

const SPONSOR_COLORS = [
  ['#123a63', '#f2f5f8', '#e8a33d'],
  ['#7a1f22', '#f7f2ea', '#f0c24a'],
  ['#1d4d3a', '#eef5f0', '#8fd0a8'],
  ['#2b2b33', '#f4f4f6', '#d24a3f'],
  ['#3d2c5e', '#f6f1fa', '#c8a2f0'],
  ['#0f4c5c', '#f0f7f8', '#f4a259'],
];

/** Original sponsor board artwork generated from the game's own sponsor list. */
export function makeSponsorTexture(sponsor, index = 0) {
  const w = 512;
  const h = 128;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const [bg, fg, accent] = SPONSOR_COLORS[index % SPONSOR_COLORS.length];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, h - 14, w, 14);
  ctx.fillRect(0, 0, 10, h);
  // Original abstract mark, not any real company's logo.
  ctx.beginPath();
  ctx.moveTo(34, 30);
  ctx.lineTo(76, 30);
  ctx.lineTo(58, 96);
  ctx.lineTo(34, 96);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = 'bold 46px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(sponsor?.name ?? 'VETTARU').toUpperCase().slice(0, 20), 100, h / 2 - 6);
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText(String(sponsor?.tagline ?? sponsor?.sector ?? '').slice(0, 34), 102, h / 2 + 30);
  return canvasTexture(canvas);
}

export function makeMarkerTexture(text, opts = {}) {
  const size = 256;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (opts.circle) {
    ctx.fillStyle = '#f4f2ec';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c8322b';
    ctx.lineWidth = 22;
    ctx.stroke();
    ctx.fillStyle = '#1c1e21';
  } else {
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(6, 6, size - 12, size - 12);
    ctx.strokeStyle = '#1c1e21';
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, size - 12, size - 12);
    ctx.fillStyle = '#1c1e21';
  }
  ctx.font = `bold ${text.length > 3 ? 76 : 120}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + 6);
  return canvasTexture(canvas);
}

export function makeArrowTexture(direction) {
  const w = 256;
  const h = 384;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#f4f2ea';
  ctx.strokeStyle = '#f4f2ea';
  ctx.lineWidth = 34;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Chevron pointing left or right, drawn in track space (Z is forward).
  const dir = direction === 'left' ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(w / 2 - dir * 10, 30);
  ctx.lineTo(w / 2 + dir * 78, 110);
  ctx.lineTo(w / 2 - dir * 10, 190);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w / 2 - dir * 10, 160);
  ctx.lineTo(w / 2 + dir * 78, 240);
  ctx.lineTo(w / 2 - dir * 10, 320);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w / 2 - dir * 46, 40);
  ctx.lineTo(w / 2 - dir * 46, 340);
  ctx.stroke();
  return canvasTexture(canvas);
}

export function makeBannerTexture(text) {
  const w = 1024;
  const h = 128;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#12233a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e8a33d';
  ctx.fillRect(0, 0, w, 10);
  ctx.fillRect(0, h - 10, w, 10);
  ctx.fillStyle = '#f4f2ec';
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  return canvasTexture(canvas);
}

export function makeLapBoardTexture(lap, total) {
  const size = 256;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#101317';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#e8a33d';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, size - 12, size - 12);
  ctx.fillStyle = '#8fa3b8';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('LAP', size / 2, 62);
  ctx.fillStyle = '#f4f2ec';
  ctx.font = 'bold 92px system-ui, sans-serif';
  ctx.fillText(`${Math.max(1, lap)}/${total}`, size / 2, 158);
  return canvasTexture(canvas);
}
