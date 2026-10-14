#!/usr/bin/env node
/**
 * Renders the ACTUAL playable circuit to an SVG top-down map.
 *
 * This is not concept art: it reads the same centre-line, zone table and pit
 * lane data the game uses at runtime, so the picture always matches the track
 * you drive. Output: docs/circuit-map.svg
 *
 * Usage: node scripts/render-track-map.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTrack } from '../src/world/trackData.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'docs', 'circuit-map.svg');

const track = getTrack();
const g = track.geometry;

const PAD = 120;
const minX = g.bounds.minX - PAD;
const minZ = g.bounds.minZ - PAD;
const W = g.bounds.maxX - g.bounds.minX + PAD * 2;
const H = g.bounds.maxZ - g.bounds.minZ + PAD * 2;
const SCALE = 0.42; // svg units per metre
const sx = (x) => ((x - minX) * SCALE).toFixed(2);
const sy = (z) => ((z - minZ) * SCALE).toFixed(2);

const path = g.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x)},${sy(p.z)}`).join(' ') + ' Z';

const zoneColors = {
  grid: '#ffd166',
  straight: '#7ee787',
  braking: '#ff8f6b',
  corner: '#79c0ff',
  chicane: '#d2a8ff',
  exit: '#a5d6ff',
};

let zoneMarks = '';
for (const z of track.zones) {
  const p = g.pointAt(z.from);
  const q = g.pointAt(z.to);
  const colour = zoneColors[z.kind] ?? '#8b949e';
  zoneMarks += `<line x1="${sx(p.x)}" y1="${sy(p.z)}" x2="${sx(q.x)}" y2="${sy(q.z)}" stroke="${colour}" stroke-width="${(g.width * SCALE).toFixed(2)}" stroke-opacity="0.28" stroke-linecap="butt"/>`;
  const apex = g.pointAt(z.apexS);
  zoneMarks += `<circle cx="${sx(apex.x)}" cy="${sy(apex.z)}" r="3.4" fill="${colour}"/>`;
}

// Direction-of-travel arrows every ~150 m, derived from the real heading.
let arrows = '';
for (let s = 0; s < g.length; s += 150) {
  const p = g.pointAt(s);
  const deg = ((-p.heading * 180) / Math.PI).toFixed(2);
  arrows += `<g transform="translate(${sx(p.x)},${sy(p.z)}) rotate(${deg})"><path d="M-9,-6 L7,0 L-9,6 Z" fill="#e6edf3" fill-opacity="0.75"/></g>`;
}

// Pit lane.
const pitPath = track.pit.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x)},${sy(p.z)}`).join(' ');

// Start/finish line.
const sf = g.pointAt(track.startFinishS);
const sfh = sf.heading;

let legend = '';
let ly = 26;
for (const [kind, colour] of Object.entries(zoneColors)) {
  legend += `<rect x="${W * SCALE - 176}" y="${ly - 11}" width="13" height="13" rx="3" fill="${colour}"/><text x="${W * SCALE - 156}" y="${ly}" font-size="14" fill="#e6edf3" font-family="system-ui,sans-serif">${kind}</text>`;
  ly += 22;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(W * SCALE).toFixed(0)}" height="${(H * SCALE).toFixed(0)}" viewBox="0 0 ${(W * SCALE).toFixed(2)} ${(H * SCALE).toFixed(2)}" role="img" aria-label="Top down map of the Vettaru International Circuit">
<title>Vettaru International Circuit - generated from the live track data</title>
<desc>Lap length ${(g.length / 1000).toFixed(2)} km. Rendered by scripts/render-track-map.mjs from src/world/trackData.js - the same data the game drives on.</desc>
<rect width="100%" height="100%" fill="#0d1117"/>
<g>
  <!-- runoff / grass envelope -->
  <path d="${path}" fill="none" stroke="#1c3a1f" stroke-width="${((g.width + 46) * SCALE).toFixed(2)}" stroke-linejoin="round"/>
  <path d="${path}" fill="none" stroke="#2f4a33" stroke-width="${((g.width + 22) * SCALE).toFixed(2)}" stroke-linejoin="round"/>
  <!-- asphalt -->
  <path d="${path}" fill="none" stroke="#2b2f36" stroke-width="${(g.width * SCALE).toFixed(2)}" stroke-linejoin="round"/>
  <!-- racing-line white edges -->
  <path d="${path}" fill="none" stroke="#e6edf3" stroke-width="${(0.9 * SCALE).toFixed(2)}" stroke-opacity="0.5" stroke-dasharray="${(6 * SCALE).toFixed(1)} ${(6 * SCALE).toFixed(1)}"/>
  ${zoneMarks}
  <!-- pit lane -->
  <path d="${pitPath}" fill="none" stroke="#4d4033" stroke-width="${(track.pit.width * SCALE).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round"/>
  ${arrows}
  <!-- start/finish line -->
  <g transform="translate(${sx(sf.x)},${sy(sf.z)}) rotate(${((-sfh * 180) / Math.PI).toFixed(2)})">
    <rect x="${(-1.2 * SCALE).toFixed(2)}" y="${(-g.halfWidth * SCALE).toFixed(2)}" width="${(2.4 * SCALE).toFixed(2)}" height="${(g.width * SCALE).toFixed(2)}" fill="#f0f6fc"/>
  </g>
  ${legend}
  <text x="18" y="${H * SCALE - 18}" font-size="15" fill="#8b949e" font-family="system-ui,sans-serif">Vettaru International Circuit - ${(g.length / 1000).toFixed(2)} km - generated, not hand drawn</text>
</g>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`Wrote ${OUT} (${(svg.length / 1024).toFixed(1)} KB)`);
console.log(`Lap ${(g.length / 1000).toFixed(3)} km, ${track.zones.length} zones`);
