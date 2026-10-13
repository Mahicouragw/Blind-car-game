#!/usr/bin/env node
/**
 * Circuit closure solver (authoring tool, not shipped to the browser).
 *
 * With every turn angle and radius fixed, the lap's end position is a LINEAR
 * function of the straight lengths: each straight contributes
 * length * direction(theta) and theta depends only on the turn angles.
 * So "make the lap close" is a small linear least-squares problem, and we can
 * solve it exactly instead of nudging control points by eye.
 *
 * Run: node scripts/solve-closure.mjs
 * It prints straight lengths that close the lap; paste them into trackData.js.
 */

import { buildLayout } from '../src/world/layout.js';
import { CIRCUIT_SPEC } from '../src/world/trackData.js';

function solve(spec, iterations = 12) {
  const work = structuredClone(spec);
  const adjustable = work.elements
    .map((el, i) => ({ el, i }))
    .filter(({ el }) => el.kind === 'straight' && el.adjustable !== false)
    .map(({ i }) => i);

  for (let iter = 0; iter < iterations; iter++) {
    const layout = buildLayout(work);
    const residual = [layout.start.x - layout.end.x, layout.start.z - layout.end.z];
    const err = Math.hypot(residual[0], residual[1]);
    if (err < 0.01) break;

    // Unit direction of each adjustable straight, taken from a real build.
    const units = [];
    for (const idx of adjustable) {
      const el = layout.elements[idx];
      // Sample the heading at the middle of this straight.
      const midS = (el.sStart + el.sEnd) / 2;
      let best = layout.points[0];
      let bd = Infinity;
      for (const p of layout.points) {
        const d = Math.abs(p.s - midS);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      units.push([Math.cos(best.heading), -Math.sin(best.heading)]);
    }

    // Minimum-norm solution of U * dL = residual, U is 2 x k.
    // dL = U^T (U U^T)^-1 residual
    const a = units.reduce((acc, u) => acc + u[0] * u[0], 0);
    const b = units.reduce((acc, u) => acc + u[0] * u[1], 0);
    const c = units.reduce((acc, u) => acc + u[1] * u[1], 0);
    const det = a * c - b * b;
    if (Math.abs(det) < 1e-9) {
      console.error('Adjustable straights are all parallel; mark different ones adjustable.');
      process.exit(1);
    }
    const inv = [
      [c / det, -b / det],
      [-b / det, a / det],
    ];
    const w = [
      inv[0][0] * residual[0] + inv[0][1] * residual[1],
      inv[1][0] * residual[0] + inv[1][1] * residual[1],
    ];
    for (let k = 0; k < adjustable.length; k++) {
      const dL = units[k][0] * w[0] + units[k][1] * w[1];
      const idx = adjustable[k];
      const min = work.elements[idx].min ?? 45;
      work.elements[idx].length = Math.max(min, work.elements[idx].length + dL);
    }
  }

  // Round to 0.5 m and re-solve once so the shipped numbers are tidy.
  for (const idx of adjustable) {
    work.elements[idx].length = Math.round(work.elements[idx].length * 2) / 2;
  }
  return work;
}

const solved = solve(CIRCUIT_SPEC);
const layout = buildLayout(solved);
console.log('closure error :', layout.closureError.toFixed(4), 'm');
console.log('heading error :', layout.headingErrorDeg.toFixed(4), 'deg');
console.log('lap length    :', layout.length.toFixed(1), 'm');
console.log('total turn    :', layout.totalTurnDeg.toFixed(2), 'deg');
console.log('\nAdjusted straight lengths:');
for (const el of solved.elements) {
  if (el.kind === 'straight') console.log(`  ${el.id.padEnd(24)} ${el.length.toFixed(1)}`);
}
console.log('\n--- paste-ready spec (lossless: every authored field is preserved) ---');
console.log(
  solved.elements
    .map((el) => {
      const order = ['kind', 'length', 'angle', 'radius', 'id', 'name', 'group', 'callout', 'min', 'max', 'adjustable'];
      const parts = [];
      for (const key of order) {
        if (el[key] === undefined || el[key] === null) continue;
        parts.push(`${key}: ${typeof el[key] === 'string' ? `'${el[key]}'` : JSON.stringify(el[key])}`);
      }
      // Anything not in the known order list still has to survive the paste.
      for (const key of Object.keys(el)) {
        if (order.includes(key) || el[key] === undefined || el[key] === null) continue;
        parts.push(`${key}: ${typeof el[key] === 'string' ? `'${el[key]}'` : JSON.stringify(el[key])}`);
      }
      return `    { ${parts.join(', ')} },`;
    })
    .join('\n')
);
