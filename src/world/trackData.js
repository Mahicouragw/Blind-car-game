/**
 * Vettaru International Circuit - original track definition.
 *
 * A fictional harbour-side circuit outside the fictional city of Anandapur.
 * The layout, corner names, sponsor liveries and every piece of signage copy
 * in this game are original inventions. Nothing here is derived from a real
 * circuit's surveyed geometry or from any commercial game's map.
 *
 * The circuit is authored as an ordered list of straights and constant-radius
 * turns (see world/layout.js). Corner direction, corner radius, corner
 * severity and therefore every spoken navigation instruction are MEASURED from
 * this data at runtime - nothing is hard-coded per corner.
 *
 * Adding a new circuit later means adding a new spec object; the renderer,
 * minimap, AI and voice system all follow automatically.
 *
 * @module world/trackData
 */

import { buildLayout, severityFromRadius, shapeFromAngle } from './layout.js';
import { buildTrackGeometry } from './trackGeometry.js';

/**
 * Lap runs clockwise (north up), so the turn angles total -360 degrees.
 * Straight lengths marked `adjustable` were solved by scripts/solve-closure.mjs
 * so the lap closes on itself exactly.
 */
export const CIRCUIT_SPEC = {
  id: 'vettaru-international',
  name: 'Vettaru International Circuit',
  shortName: 'Vettaru Ring',
  city: 'Anandapur',
  country: 'Vettaru Coast',
  description:
    'A harbour-side circuit with a long start and finish straight, a fast eastern descent, the tight one hundred and eighty degree Vettaru U-turn, a quick chicane, and the slow Old Harbour hairpin.',
  startHeading: 0,
  origin: [0, 0],
  /** Arc length of the start/finish line. The grid sits behind it. */
  startFinishS: 130,
  width: 13,
  elements: [
    { kind: 'straight', length: 72, id: 'run_up', group: 'main_straight', adjustable: false },
    { kind: 'straight', length: 265, id: 'main_straight', name: 'Start/Finish Straight', group: 'main_straight', min: 265 },
    { kind: 'turn', angle: -78, radius: 88, id: 't1', name: 'Turn 1 - Marina Right' },
    { kind: 'straight', length: 34, id: 's_t1_t2', min: 34 },
    { kind: 'turn', angle: -95, radius: 128.5, id: 't2', name: 'Turn 2 - Dockside Sweep' },
    { kind: 'straight', length: 282.5, id: 's_t2_t3', name: 'East Terrace', min: 255 },
    { kind: 'turn', angle: 46, radius: 100, id: 't3', name: 'Turn 3 - Salt Flats Left' },
    { kind: 'straight', length: 32, id: 'harbour_straight', name: 'Harbour Straight', min: 32 },
    { kind: 'turn', angle: 172, radius: 30, id: 'uturn', name: 'Turn 4 - The Vettaru U-Turn', callout: 'uturn' },
    { kind: 'straight', length: 63, id: 'uturn_exit', min: 60 },
    { kind: 'turn', angle: -74, radius: 85, id: 't5', name: 'Turn 5 - Ridge Right' },
    { kind: 'straight', length: 81, id: 'northern_straight', name: 'Northern Straight', min: 81 },
    { kind: 'turn', angle: 40, radius: 50, id: 'chic_a1', name: 'The Variante', group: 'chicane_a' },
    { kind: 'straight', length: 34, id: 'chic_a_s1', group: 'chicane_a', adjustable: false },
    { kind: 'turn', angle: -48, radius: 56, id: 'chic_a2', group: 'chicane_a' },
    { kind: 'straight', length: 34, id: 'chic_a_s2', group: 'chicane_a', adjustable: false },
    { kind: 'turn', angle: 42, radius: 50, id: 'chic_a3', group: 'chicane_a' },
    { kind: 'straight', length: 67, id: 's_chic_t6', min: 67 },
    { kind: 'turn', angle: -128, radius: 78.5, id: 't6', name: 'Turn 6 - Quarry Right' },
    { kind: 'straight', length: 59, id: 's_t6_t7', min: 59 },
    { kind: 'turn', angle: -75, radius: 125.5, id: 't7', name: 'Turn 7 - Lighthouse Sweep' },
    { kind: 'straight', length: 372, id: 's_t7_t8', name: 'Quayside Straight', min: 330 },
    { kind: 'turn', angle: 58, radius: 68, id: 't8', name: 'Turn 8 - Kiln Left' },
    { kind: 'straight', length: 81, id: 's_t8_hp', min: 72 },
    { kind: 'turn', angle: -168, radius: 23, id: 'hairpin', name: 'Turn 9 - Old Harbour Hairpin', callout: 'hairpin' },
    { kind: 'straight', length: 79, id: 's_hp_t10', min: 53 },
    { kind: 'turn', angle: 40, radius: 116, id: 't10', name: 'Turn 10 - Gate Left' },
    { kind: 'straight', length: 308, id: 's_t10_final', name: 'Fort Straight', min: 270 },
    { kind: 'turn', angle: -92, radius: 100, id: 'final', name: 'Turn 11 - Final Right' },
  ],
};

/** Grid slots: metres behind the line (ds, negative = behind) and lateral offset. */
export const GRID_SLOTS = [
  { position: 1, ds: -16, lateral: -3.2 },
  { position: 2, ds: -16, lateral: 3.2 },
  { position: 3, ds: -31, lateral: -3.2 },
  { position: 4, ds: -31, lateral: 3.2 },
  { position: 5, ds: -46, lateral: -3.2 },
  { position: 6, ds: -46, lateral: 3.2 },
];

/** Ordered checkpoints used to validate a lap so shortcuts cannot count. */
export const CHECKPOINT_COUNT = 10;

/** Original, invented trackside sponsors. No real brands are referenced. */
export const SPONSORS = [
  'NEXORA FUEL',
  'BRIGHTLINE TYRES',
  'KALPESH MOTORS',
  'SUNRIDGE BANK',
  'VOLT & VINE',
  'MERAKI COFFEE',
  'AEROGRIP',
  'TRIDENT LOGISTICS',
  'VETTARU MARINE',
  'ANANDAPUR PORT',
];

/** Braking-zone length by corner severity, in metres before the turn. */
const BRAKE_LENGTH = { hairpin: 130, sharp: 100, medium: 75, gentle: 45, straight: 0 };

function cornerSeverity(angle, radius) {
  const shape = shapeFromAngle(angle);
  if (shape === 'reversal') return 'hairpin';
  return severityFromRadius(radius);
}

/**
 * Build the resolved track object used by every other subsystem.
 * @param {object} [spec] defaults to CIRCUIT_SPEC
 */
export function buildTrack(spec = CIRCUIT_SPEC) {
  const layout = buildLayout(spec);
  const width = spec.width ?? 13;

  // The layout polyline is already smooth (exact arcs), so the geometry layer
  // consumes it directly with one sample per control point.
  const controlPoints = layout.points.map((p) => [p.x, p.z]);
  const geometry = buildTrackGeometry(controlPoints, {
    width,
    samplesPerSegment: 1,
  });

  const length = geometry.length;
  const startFinishS = geometry.normaliseS(spec.startFinishS ?? 160);

  // ------------------------------------------------------------- zone groups
  /** Merge elements that share a `group` (e.g. a chicane) into one zone. */
  const groups = [];
  for (const el of layout.elements) {
    const key = el.group ?? el.id;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.elements.push(el);
      last.sEnd = el.sEnd;
    } else {
      groups.push({ key, elements: [el], sStart: el.sStart, sEnd: el.sEnd });
    }
  }

  // Which groups are "corners" (worth a braking zone and a spoken warning)?
  const cornerGroups = groups
    .filter((grp) => grp.elements.some((e) => e.kind === 'turn'))
    .map((grp) => {
      const turns = grp.elements.filter((e) => e.kind === 'turn');
      const totalAngle = turns.reduce((a, t) => a + t.angle, 0);
      const minRadius = Math.min(...turns.map((t) => t.radius));
      const isChicane = turns.length >= 2;
      // Direction: for a chicane use the FIRST turn (that is what you steer for).
      const direction = isChicane
        ? turns[0].angle > 0
          ? 'left'
          : 'right'
        : totalAngle > 0
          ? 'left'
          : 'right';
      const severity = isChicane ? severityFromRadius(minRadius) : cornerSeverity(totalAngle, minRadius);
      const name = turns[0].name ?? grp.key;
      // 'uturn' / 'hairpin' are authored so that two near-identical 180 degree
      // corners still get distinct spoken callouts.
      const callout =
        turns.find((t) => t.callout)?.callout ??
        (isChicane ? 'chicane' : shapeFromAngle(totalAngle) === 'reversal' ? 'hairpin' : null);
      return {
        ...grp,
        kind: isChicane ? 'chicane' : 'corner',
        direction,
        severity,
        minRadius,
        totalAngle,
        name,
        callout,
        label: name.replace(/\s*-\s*/, ', '),
      };
    });

  // ------------------------------------------------------------- build zones
  const zones = [];
  const cornerByStart = new Map(cornerGroups.map((c) => [c.sStart, c]));

  for (const grp of groups) {
    const corner = cornerByStart.get(grp.sStart);
    if (corner) {
      // Braking zone occupies the tail of the preceding straight.
      const brakeLen = Math.min(BRAKE_LENGTH[corner.severity] ?? 0, 140);
      if (brakeLen > 20) {
        zones.push({
          id: `zone.brake.${corner.key}`,
          kind: 'braking',
          name: `${corner.name} braking zone`,
          label: `${corner.label} braking zone`,
          from: geometry.normaliseS(corner.sStart - brakeLen),
          to: geometry.normaliseS(corner.sStart),
          span: brakeLen,
          forCorner: corner.key,
          direction: corner.direction,
          severity: corner.severity,
          radius: corner.minRadius,
        });
      }
      zones.push({
        id: `zone.corner.${corner.key}`,
        kind: corner.kind,
        name: corner.name,
        label: corner.label,
        from: geometry.normaliseS(corner.sStart),
        to: geometry.normaliseS(corner.sEnd),
        span: corner.sEnd - corner.sStart,
        direction: corner.direction,
        severity: corner.severity,
        radius: corner.minRadius,
        totalAngle: corner.totalAngle,
        callout: corner.callout,
        apexS: geometry.normaliseS((corner.sStart + corner.sEnd) / 2),
      });
    } else {
      // Plain straight. Trim its tail if a braking zone eats into it.
      const next = cornerGroups.find((c) => Math.abs(c.sStart - grp.sEnd) < 0.5);
      const brakeLen = next ? Math.min(BRAKE_LENGTH[next.severity] ?? 0, 140) : 0;
      const to = geometry.normaliseS(grp.sEnd - (brakeLen > 20 ? brakeLen : 0));
      const span = brakeLen > 20 ? grp.sEnd - brakeLen - grp.sStart : grp.sEnd - grp.sStart;
      // A straight shorter than this is really the exit of the previous corner;
      // skipping it stops the voice system chattering between two announcements.
      if (span < 22) continue;
      zones.push({
        id: `zone.straight.${grp.key}`,
        kind: 'straight',
        name: grp.elements[0].name ?? `${grp.key} straight`,
        label: grp.elements[0].name ?? 'Straight',
        from: geometry.normaliseS(grp.sStart),
        to,
        span,
        direction: 'straight',
        severity: 'straight',
        radius: Infinity,
        apexS: geometry.normaliseS(grp.sStart + span / 2),
      });
    }
  }

  // The grid is its own zone carved out of the run-up/main straight.
  const gridFrom = geometry.normaliseS(startFinishS - 62);
  const gridTo = geometry.normaliseS(startFinishS + 4);
  zones.push({
    id: 'zone.grid',
    kind: 'grid',
    name: 'Starting grid',
    label: 'Starting grid',
    from: gridFrom,
    to: gridTo,
    span: 66,
    direction: 'straight',
    severity: 'straight',
    radius: Infinity,
    apexS: startFinishS,
    enterLine: 'Starting grid. Your car is facing the start and finish straight.',
  });

  zones.sort((a, b) => {
    // Sort by unwrapped position relative to the start/finish line.
    const ua = (a.from - startFinishS + length) % length;
    const ub = (b.from - startFinishS + length) % length;
    return ua - ub;
  });

  // ---------------------------------------------------------------- pit lane
  // Derived from the centre-line, offset to the inside of the final corner and
  // the main straight, with tapered ends so it merges cleanly.
  const pitEntryS = geometry.normaliseS(layout.elements.find((e) => e.id === 'final').sStart - 40);
  const pitExitS = geometry.normaliseS(startFinishS + 100);
  const pitOffset = 24;
  const taper = 70;
  const pitPoints = [];
  let pitLen = 0;
  {
    let forward = (pitExitS - pitEntryS + length) % length;
    const step = 6;
    let prev = null;
    for (let d = 0; d <= forward; d += step) {
      const s = geometry.normaliseS(pitEntryS + d);
      const p = geometry.pointAt(s);
      const hx = Math.cos(p.heading);
      const hz = -Math.sin(p.heading);
      const rx = -hz;
      const rz = hx;
      const t = Math.min(1, d / taper, (forward - d) / taper);
      const off = pitOffset * Math.max(0, t);
      const px = p.x + rx * off;
      const pz = p.z + rz * off;
      if (prev) pitLen += Math.hypot(px - prev.x, pz - prev.z);
      prev = { x: px, z: pz };
      pitPoints.push({ x: px, z: pz, s, offset: off });
    }
  }

  // ------------------------------------------------------------------- grid
  const grid = GRID_SLOTS.map((slot) => {
    const s = geometry.normaliseS(startFinishS + slot.ds);
    const p = geometry.pointAt(s);
    const hx = Math.cos(p.heading);
    const hz = -Math.sin(p.heading);
    return {
      position: slot.position,
      s,
      x: p.x + -hz * slot.lateral,
      z: p.z + hx * slot.lateral,
      heading: p.heading,
      lateral: slot.lateral,
    };
  });

  // ------------------------------------------------------------ checkpoints
  const checkpoints = [];
  for (let i = 0; i < CHECKPOINT_COUNT; i++) {
    checkpoints.push(geometry.normaliseS((length * i) / CHECKPOINT_COUNT));
  }

  // ------------------------------------------------- signage (distance boards)
  const signage = [];
  for (const corner of cornerGroups) {
    const sev = corner.severity;
    const boards = sev === 'hairpin' ? [150, 100, 50] : sev === 'sharp' ? [100, 50] : [50];
    for (const metres of boards) {
      const s = geometry.normaliseS(corner.sStart - metres);
      const p = geometry.pointAt(s);
      signage.push({
        kind: 'distance',
        s,
        x: p.x,
        z: p.z,
        heading: p.heading,
        text: `${metres}`,
        side: 'left',
        corner: corner.key,
      });
    }
  }

  return {
    id: spec.id,
    name: spec.name,
    shortName: spec.shortName,
    city: spec.city,
    country: spec.country,
    description: spec.description,
    spec,
    layout,
    geometry,
    zones,
    cornerGroups,
    grid,
    checkpoints,
    startFinishS,
    pitEntryS,
    pitExitS,
    pit: {
      entryS: pitEntryS,
      exitS: pitExitS,
      points: pitPoints,
      width: 9,
      length: pitLen,
      speedLimitKph: 60,
      garages: 6,
      offset: pitOffset,
    },
    signage,
    sponsors: SPONSORS,
    lengthM: length,
    width,
    closureError: layout.closureError,
    totalTurnDeg: layout.totalTurnDeg,
  };
}

/**
 * Zone containing an arc length.
 * The grid zone is checked first because it overlaps a straight.
 */
export function zoneAtS(track, s) {
  const g = track.geometry;
  const ns = g.normaliseS(s);
  const contains = (zone) => {
    const a = zone.from;
    const b = zone.to;
    return a <= b ? ns >= a && ns < b : ns >= a || ns < b;
  };
  const grid = track.zones.find((z) => z.id === 'zone.grid');
  if (grid && contains(grid)) return grid;
  // Braking zones are laid out before the corner they serve, and a long braking
  // zone can start before the previous corner has finished. When they overlap,
  // the corner you are physically in wins, then the braking zone, then a
  // straight. Otherwise the voice would stop naming the corner you are driving.
  const PRIORITY = { corner: 0, chicane: 0, braking: 1, straight: 2 };
  let bestZone = null;
  let bestRank = Infinity;
  for (const zone of track.zones) {
    if (zone.id === 'zone.grid') continue;
    if (!contains(zone)) continue;
    const rank = PRIORITY[zone.kind] ?? 3;
    if (rank < bestRank) {
      bestRank = rank;
      bestZone = zone;
    }
  }
  if (bestZone) return bestZone;
  // Gap (short stretches trimmed away): return the nearest zone ahead.
  let best = null;
  let bestGap = Infinity;
  for (const zone of track.zones) {
    const gap = (zone.from - ns + g.length) % g.length;
    if (gap < bestGap) {
      bestGap = gap;
      best = zone;
    }
  }
  return best ?? track.zones[0];
}

/** Corner/chicane zones in lap order. */
export function cornerZones(track) {
  return track.zones.filter((z) => z.kind === 'corner' || z.kind === 'chicane');
}

let cached = null;
export function getTrack() {
  if (!cached) cached = buildTrack();
  return cached;
}
export function resetTrackCache() {
  cached = null;
}
