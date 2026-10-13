#!/usr/bin/env node
/**
 * Track geometry validator.
 *
 * Fails the build if the circuit self-intersects or if two parts of the track
 * that are far apart along the lap end up physically too close (which is what
 * would make a U-turn or hairpin undrivable). Also prints a measured table of
 * every navigation zone so the spoken guidance can be checked against the real
 * geometry rather than against what the author intended.
 *
 * Usage: node scripts/validate-track.mjs
 */

import { getTrack } from '../src/world/trackData.js';

const track = getTrack();
const g = track.geometry;
const pts = g.points;
const N = pts.length;
const WIDTH = g.width;
const MIN_SEPARATION = WIDTH + 13; // 26 m: two roads need a grass strip between them
const MIN_ARC_GAP = 70; // ignore neighbours closer than this along the lap

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error('FAIL: ' + msg);
};

// ---------------------------------------------------------------- separations
let worst = { d: Infinity };
for (let i = 0; i < N; i++) {
  for (let j = i + 1; j < N; j++) {
    let arc = Math.abs(g.cum[j] - g.cum[i]);
    arc = Math.min(arc, g.length - arc); // loop-aware distance along the lap
    if (arc < MIN_ARC_GAP) continue;
    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
    if (d < worst.d) worst = { d, i, j, arc };
    if (d < MIN_SEPARATION) {
      fail(
        `centre-line points ${i} (s=${g.cum[i].toFixed(0)}m) and ${j} (s=${g.cum[j].toFixed(0)}m) are ` +
          `${d.toFixed(1)}m apart (need >= ${MIN_SEPARATION}m)`
      );
      if (failures > 12) {
        console.error('... too many failures, stopping separation scan');
        i = N;
        break;
      }
    }
  }
}

// ------------------------------------------------------- pit lane clearance
// The pit lane is intentionally parallel to the main straight, but outside its
// merge tapers it must not overlap the racing surface.
let pitFails = 0;
const TAPER = 70; // metres of merge taper at each end of the pit lane
let acc = 0;
let prevPit = null;
const pitTotal = track.pit.length;
for (const p of track.pit.points) {
  if (prevPit) acc += Math.hypot(p.x - prevPit.x, p.z - prevPit.z);
  prevPit = p;
  // Inside a merge taper the pit lane is supposed to run into the racing line.
  if (acc < TAPER || acc > pitTotal - TAPER) continue;
  const near = g.nearest(p.x, p.z);
  if (near.distance < 14) {
    pitFails++;
    if (pitFails < 4) fail(`pit lane at s=${p.s.toFixed(0)}m is ${near.distance.toFixed(1)}m from the racing line`);
  }
}
if (pitFails >= 4) console.error(`FAIL: ... ${pitFails} pit lane clearance problems total`);

// ------------------------------------------------------------ self-intersect
function segInt(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.z - p3.z) - (p2.z - p1.z) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((p3.x - p1.x) * (p4.z - p3.z) - (p3.z - p1.z) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.z - p1.z) - (p3.z - p1.z) * (p2.x - p1.x)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}
const step = Math.max(1, Math.floor(N / 900));
const idxs = [];
for (let i = 0; i < N; i += step) idxs.push(i);
for (let a = 0; a < idxs.length; a++) {
  for (let b = a + 1; b < idxs.length; b++) {
    const i1 = idxs[a];
    const i2 = idxs[(a + 1) % idxs.length];
    const j1 = idxs[b];
    const j2 = idxs[(b + 1) % idxs.length];
    if (Math.abs(i1 - j1) < step * 2) continue;
    if (segInt(pts[i1], pts[i2], pts[j1], pts[j2])) {
      fail(`centre-line self-intersection near s=${g.cum[i1].toFixed(0)}m and s=${g.cum[j1].toFixed(0)}m`);
    }
  }
}

// ------------------------------------------------------------------- reporting
console.log(`\nVettaru International Circuit`);
console.log(`  lap length      : ${g.length.toFixed(1)} m  (${(g.length / 1000).toFixed(3)} km)`);
console.log(`  centre samples  : ${N}`);
console.log(`  track width     : ${WIDTH} m`);
console.log(`  bounds          : x [${g.bounds.minX.toFixed(0)}, ${g.bounds.maxX.toFixed(0)}]  z [${g.bounds.minZ.toFixed(0)}, ${g.bounds.maxZ.toFixed(0)}]`);
console.log(
  `  closest non-adjacent pair: ${worst.d.toFixed(1)} m (s=${g.cum[worst.i].toFixed(0)}m vs s=${g.cum[worst.j].toFixed(0)}m, lap gap ${worst.arc.toFixed(0)} m)\n`
);

console.log('Navigation zones (measured from real geometry):');
console.log(
  ['id', 'kind', 'dir', 'sev', 'radius m', 'span m', 'from m'].map((h, k) => h.padEnd([28, 9, 6, 9, 9, 8, 8][k])).join('')
);
for (const z of track.zones) {
  console.log(
    [
      z.id,
      z.kind,
      z.direction,
      z.severity,
      Number.isFinite(z.radius) ? z.radius.toFixed(0) : 'inf',
      z.span.toFixed(0),
      z.from.toFixed(0),
    ]
      .map((v, k) => String(v).padEnd([28, 9, 6, 9, 9, 8, 8][k]))
      .join('')
  );
}

// Direction balance check: the brief asks for multiple left AND right corners.
const corners = track.zones.filter((z) => z.kind === 'corner' || z.kind === 'chicane');
const lefts = corners.filter((z) => z.direction === 'left').length;
const rights = corners.filter((z) => z.direction === 'right').length;
const hairpins = corners.filter((z) => z.severity === 'hairpin').length;
console.log(`\nCorner turns: ${corners.length}  (left ${lefts} / right ${rights})   hairpins: ${hairpins}`);
if (lefts < 2 || rights < 2) fail('need multiple left-hand AND right-hand corners');
if (hairpins < 1) fail('need at least one hairpin-severity corner');

const straights = track.zones.filter((z) => z.kind === 'straight');
const longest = Math.max(...straights.map((z) => z.span));
console.log(`Longest straight: ${longest.toFixed(0)} m`);
if (longest < 150) fail('need at least one long acceleration straight (>=150 m)');

console.log(`\nGrid slots: ${track.grid.map((s) => `P${s.position}@s=${s.s.toFixed(0)}`).join(' ')}`);
console.log(`Checkpoints: ${track.checkpoints.map((c) => c.toFixed(0)).join(', ')}`);
console.log(`Pit lane: entry s=${track.pitEntryS.toFixed(0)}m, exit s=${track.pitExitS.toFixed(0)}m, length ${track.pit.length?.toFixed?.(0) ?? track.pit.length}m`);
console.log(`Closure error: ${track.closureError.toFixed(3)} m, total turn ${track.totalTurnDeg.toFixed(1)} deg`);
if (track.closureError > 2) fail('lap does not close on itself');
if (Math.abs(Math.abs(track.totalTurnDeg) - 360) > 0.5) fail('turn angles do not total 360 degrees');

if (failures) {
  console.error(`\n${failures} geometry problem(s) found.`);
  process.exit(1);
}
console.log('\nTrack geometry OK.');
