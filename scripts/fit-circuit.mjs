#!/usr/bin/env node
/**
 * Circuit shape fitter (authoring tool).
 *
 * Shrinking a circuit can make two parts of the lap collide, and reasoning
 * about that by eye is slow. This searches the space of corner angles and radii
 * for a layout that (a) closes exactly, (b) never self-intersects, (c) keeps
 * every pair of non-adjacent centre-line points far enough apart to have grass
 * between them, and (d) keeps the corner severity mix the brief asks for.
 *
 * Turn angles are perturbed in compensating pairs so the lap always totals
 * -360 degrees and therefore always closes by heading.
 *
 * Usage: node scripts/fit-circuit.mjs [iterations]
 */

import { buildTrack } from '../src/world/trackData.js';
import { solveClosure } from './closure-solver.mjs';

const ITERATIONS = Number(process.argv[2] ?? 2500);
const MIN_SEPARATION = 27; // track width 13 + a grass strip
const MIN_ARC_GAP = 55;

/** The authored base spec, with the knobs the fitter is allowed to turn. */
function baseSpec() {
  return {
    startHeading: 0,
    origin: [0, 0],
    startFinishS: 96,
    width: 13,
    elements: [
      { kind: 'straight', length: 72, id: 'run_up', adjustable: false, group: 'main_straight' },
      { kind: 'straight', length: 265, id: 'main_straight', min: 265, group: 'main_straight', name: 'Start/Finish Straight' },
      { kind: 'turn', angle: -70, radius: 88, id: 't1', name: 'Turn 1 - Marina Right' },
      { kind: 'straight', length: 34, id: 's_t1_t2', min: 34 },
      { kind: 'turn', angle: -95, radius: 112, id: 't2', name: 'Turn 2 - Dockside Sweep' },
      { kind: 'straight', length: 255, id: 's_t2_t3', min: 255, name: 'East Terrace' },
      { kind: 'turn', angle: 50, radius: 105, id: 't3', name: 'Turn 3 - Salt Flats Left' },
      { kind: 'straight', length: 34, id: 'harbour_straight', min: 34, name: 'Harbour Straight' },
      { kind: 'turn', angle: 172, radius: 30, id: 'uturn', name: 'Turn 4 - The Vettaru U-Turn', callout: 'uturn' },
      { kind: 'straight', length: 60, id: 'uturn_exit', min: 60 },
      { kind: 'turn', angle: -78, radius: 85, id: 't5', name: 'Turn 5 - Ridge Right' },
      { kind: 'straight', length: 78, id: 'northern_straight', min: 78, name: 'Northern Straight' },
      { kind: 'turn', angle: 40, radius: 50, id: 'chic_a1', name: 'The Variante', group: 'chicane_a' },
      { kind: 'straight', length: 34, id: 'chic_a_s1', adjustable: false, group: 'chicane_a' },
      { kind: 'turn', angle: -48, radius: 56, id: 'chic_a2', group: 'chicane_a' },
      { kind: 'straight', length: 34, id: 'chic_a_s2', adjustable: false, group: 'chicane_a' },
      { kind: 'turn', angle: 42, radius: 50, id: 'chic_a3', group: 'chicane_a' },
      { kind: 'straight', length: 36, id: 's_chic_t6', min: 36 },
      { kind: 'turn', angle: -128, radius: 62, id: 't6', name: 'Turn 6 - Quarry Right' },
      { kind: 'straight', length: 32, id: 's_t6_t7', min: 32 },
      { kind: 'turn', angle: -75, radius: 122, id: 't7', name: 'Turn 7 - Lighthouse Sweep' },
      { kind: 'straight', length: 330, id: 's_t7_t8', min: 330, name: 'Quayside Straight' },
      { kind: 'turn', angle: 58, radius: 68, id: 't8', name: 'Turn 8 - Kiln Left' },
      { kind: 'straight', length: 80, id: 's_t8_hp', min: 80 },
      { kind: 'turn', angle: -168, radius: 25, id: 'hairpin', name: 'Turn 9 - Old Harbour Hairpin', callout: 'hairpin' },
      { kind: 'straight', length: 70, id: 's_hp_t10', min: 70 },
      { kind: 'turn', angle: 45, radius: 110, id: 't10', name: 'Turn 10 - Gate Left' },
      { kind: 'straight', length: 270, id: 's_t10_final', min: 270, name: 'Fort Straight' },
      { kind: 'turn', angle: -105, radius: 102, id: 'final', name: 'Turn 11 - Final Right' },
    ],
  };
}

/** Knobs: [id, field, min, max]. Angle knobs are applied in compensating pairs. */
const ANGLE_PAIRS = [
  ['t10', 'final'], // how far west the return leg runs
  ['t8', 't6'], // how the south-west complex folds
  ['t3', 't5'], // where the U-turn sits east/west
  ['t2', 't7'], // overall east-west stretch
  ['t1', 'final'],
];
const RADIUS_KNOBS = [
  ['uturn', 26, 36],
  ['hairpin', 22, 30],
  ['chic_a1', 48, 60],
  ['chic_a2', 50, 62],
  ['chic_a3', 48, 60],
  ['t5', 76, 100],
  ['t6', 58, 84],
  ['t8', 62, 88],
  ['t3', 98, 125],
  ['t10', 104, 135],
  ['final', 96, 128],
  ['t1', 80, 104],
  ['t2', 104, 132],
  ['t7', 114, 150],
];
const LENGTH_MIN_KNOBS = [
  ['harbour_straight', 28, 90],
  ['uturn_exit', 40, 110],
  ['northern_straight', 50, 130],
  ['s_t8_hp', 35, 150],
  ['s_hp_t10', 35, 170],
  ['s_t1_t2', 26, 90],
  ['s_chic_t6', 28, 90],
  ['s_t6_t7', 24, 80],
];

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fast validity check on the built track. Lower is better; 0 means valid. */
function violations(track) {
  const g = track.geometry;
  const pts = g.points;
  const stride = 3;
  const idx = [];
  for (let i = 0; i < pts.length; i += stride) idx.push(i);

  // Spatial hash so the pair scan is near-linear.
  const CELL = 30;
  const buckets = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  for (const i of idx) {
    const cx = Math.floor(pts[i].x / CELL);
    const cz = Math.floor(pts[i].z / CELL);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const k = key(cx + ox, cz + oz);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(i);
      }
    }
  }

  let score = 0;
  const seen = new Set();
  for (const i of idx) {
    const cx = Math.floor(pts[i].x / CELL);
    const cz = Math.floor(pts[i].z / CELL);
    const bucket = buckets.get(key(cx, cz));
    if (!bucket) continue;
    for (const j of bucket) {
      if (j <= i) continue;
      const pairKey = i * 1000003 + j;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      let arc = Math.abs(g.cum[j] - g.cum[i]);
      arc = Math.min(arc, g.length - arc);
      if (arc < MIN_ARC_GAP) continue;
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
      if (d < MIN_SEPARATION) score += 20000 + (MIN_SEPARATION - d) * 2;
    }
  }

  // Crossing penalty.
  const n = idx.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 2; b < n; b++) {
      if (a === 0 && b === n - 1) continue;
      const p1 = pts[idx[a]];
      const p2 = pts[idx[(a + 1) % n]];
      const p3 = pts[idx[b]];
      const p4 = pts[idx[(b + 1) % n]];
      const d = (p2.x - p1.x) * (p4.z - p3.z) - (p2.z - p1.z) * (p4.x - p3.x);
      if (Math.abs(d) < 1e-12) continue;
      const t = ((p3.x - p1.x) * (p4.z - p3.z) - (p3.z - p1.z) * (p4.x - p3.x)) / d;
      const u = ((p3.x - p1.x) * (p2.z - p1.z) - (p3.z - p1.z) * (p2.x - p1.x)) / d;
      if (t > 0.05 && t < 0.95 && u > 0.05 && u < 0.95) score += 40000;
    }
  }

  // Lap length window.
  if (g.length < 3200) score += (3200 - g.length) * 0.9;
  if (g.length > 3700) score += (g.length - 3700) * 0.9;
  // Closure must be exact-ish.
  score += Math.max(0, track.closureError - 0.2) * 3000;

  // Severity mix: need >=1 hairpin, >=1 U-turn callout, both directions, and a
  // spread of medium corners so the track is not all one speed.
  const corners = track.zones.filter((z) => z.kind === 'corner' || z.kind === 'chicane');
  const lefts = corners.filter((z) => z.direction === 'left').length;
  const rights = corners.filter((z) => z.direction === 'right').length;
  const hairpins = corners.filter((z) => z.severity === 'hairpin').length;
  const mediums = corners.filter((z) => z.severity === 'medium').length;
  const sharps = corners.filter((z) => z.severity === 'sharp').length;
  if (lefts < 4) score += (4 - lefts) * 60;
  if (rights < 4) score += (4 - rights) * 60;
  if (hairpins !== 2) score += Math.abs(hairpins - 2) * 90;
  if (mediums < 2) score += (2 - mediums) * 40;
  if (sharps < 2) score += (2 - sharps) * 40;
  const longest = Math.max(...track.zones.filter((z) => z.kind === 'straight').map((z) => z.span));
  // "Long straights" are a required map element: reward a real top-gear run.
  if (longest < 250) score += (250 - longest) * 4;

  return { score, hairpins, lefts, rights, mediums, sharps, longest, length: g.length };
}

function makeCandidate(rng) {
  const spec = baseSpec();
  const byId = new Map(spec.elements.map((e) => [e.id, e]));

  // 1-3 angle pairs, compensating so the total stays -360.
  const pairs = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < pairs; k++) {
    const [a, b] = ANGLE_PAIRS[Math.floor(rng() * ANGLE_PAIRS.length)];
    const delta = Math.round((rng() * 2 - 1) * 26);
    byId.get(a).angle += delta;
    byId.get(b).angle -= delta;
    // Keep reversals reversal-shaped and corners sane.
    if (Math.abs(byId.get(a).angle) < 25) byId.get(a).angle = 25 * Math.sign(byId.get(a).angle || 1);
    if (Math.abs(byId.get(b).angle) < 25) byId.get(b).angle = -25;
  }
  // Named corners must stay corners, not kinks - a 30 degree bend is not
  // something a blind player needs warned about as a corner.
  for (const id of ['t1', 't2', 't3', 't5', 't6', 't7', 't8', 't10', 'final']) {
    const el = byId.get(id);
    if (Math.abs(el.angle) < 40) el.angle = 40 * Math.sign(el.angle);
  }

  // Reversals must stay reversals.
  if (Math.abs(byId.get('uturn').angle) < 160) byId.get('uturn').angle = 160 + rng() * 20;
  if (Math.abs(byId.get('hairpin').angle) < 155) byId.get('hairpin').angle = -(155 + rng() * 20);

  for (const [id, lo, hi] of RADIUS_KNOBS) {
    if (rng() < 0.75) byId.get(id).radius = Math.round((lo + rng() * (hi - lo)) * 2) / 2;
  }
  for (const [id, lo, hi] of LENGTH_MIN_KNOBS) {
    if (rng() < 0.7) {
      const m = Math.round(lo + rng() * (hi - lo));
      byId.get(id).min = m;
      if (byId.get(id).length < m) byId.get(id).length = m;
    }
  }
  // Enforce the total so heading closure holds.
  const sum = spec.elements.filter((e) => e.kind === 'turn').reduce((a, e) => a + e.angle, 0);
  byId.get('final').angle -= sum + 360;
  return spec;
}

let best = null;
const rng = mulberry32(20261013);

for (let i = 0; i < ITERATIONS; i++) {
  let candidate;
  try {
    const spec = makeCandidate(rng);
    const solved = solveClosure(spec, { iterations: 45 });
    candidate = buildTrack(solved.spec);
    candidate._solved = solved.spec;
  } catch {
    continue;
  }
  const v = violations(candidate);
  if (!best || v.score < best.v.score) {
    best = { v, spec: candidate._solved, track: candidate };
    if (v.score === 0) {
      console.log(`Found a clean layout at iteration ${i}`);
      break;
    }
    if (i % 150 === 0) {
      console.log(`  iter ${i}: score ${v.score.toFixed(1)} len ${v.length.toFixed(0)} hairpins ${v.hairpins} L${v.lefts}/R${v.rights} med ${v.mediums} sharp ${v.sharps} longest ${v.longest.toFixed(0)}`);
    }
  }
}

if (!best) {
  console.error('No candidate produced.');
  process.exit(1);
}
const v = best.v;
console.log('\n=== best layout ===');
console.log(`score ${v.score.toFixed(2)} (0 = valid)`);
console.log(`lap ${v.length.toFixed(1)} m  corners L${v.lefts}/R${v.rights}  hairpins ${v.hairpins}  medium ${v.mediums}  sharp ${v.sharps}  longest straight ${v.longest.toFixed(0)} m`);
console.log(`closure ${best.track.closureError.toFixed(3)} m`);
console.log('\n--- paste-ready spec ---');
for (const el of best.spec.elements) {
  const order = ['kind', 'length', 'angle', 'radius', 'id', 'name', 'group', 'callout', 'min', 'max', 'adjustable'];
  const parts = [];
  for (const key of order) {
    if (el[key] === undefined || el[key] === null) continue;
    parts.push(`${key}: ${typeof el[key] === 'string' ? `'${el[key]}'` : JSON.stringify(el[key])}`);
  }
  console.log(`    { ${parts.join(', ')} },`);
}
