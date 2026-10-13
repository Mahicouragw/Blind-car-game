/**
 * Circuit closure solver (authoring tool).
 *
 * With every turn angle and radius fixed, the lap's end position is a LINEAR
 * function of the straight lengths, so closing the lap is a least-squares
 * problem we can solve exactly instead of nudging points by eye.
 *
 * @module scripts/closure-solver
 */

import { buildLayout } from '../src/world/layout.js';

/**
 * @param {object} spec a CIRCUIT_SPEC-shaped object
 * @param {object} [opts]
 * @param {number} [opts.iterations=40]
 * @param {number} [opts.roundTo=0.5]
 * @returns {{spec: object, layout: object}} solved spec + resulting layout
 */
export function solveClosure(spec, opts = {}) {
  const { iterations = 40, roundTo = 0.5 } = opts;
  const work = structuredClone(spec);
  const adjustable = work.elements
    .map((el, i) => ({ el, i }))
    .filter(({ el }) => el.kind === 'straight' && el.adjustable !== false)
    .map(({ i }) => i);

  if (adjustable.length < 2) throw new Error('need at least two adjustable straights');

  let layout = buildLayout(work);
  for (let iter = 0; iter < iterations; iter++) {
    layout = buildLayout(work);
    const residual = [layout.start.x - layout.end.x, layout.start.z - layout.end.z];
    if (Math.hypot(residual[0], residual[1]) < 0.005) break;

    // Unit heading of each adjustable straight from the real build.
    const units = adjustable.map((idx) => {
      const el = layout.elements[idx];
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
      return [Math.cos(best.heading), -Math.sin(best.heading)];
    });

    // Minimum-norm dL solving U dL = residual.
    const a = units.reduce((acc, u) => acc + u[0] * u[0], 0);
    const b = units.reduce((acc, u) => acc + u[0] * u[1], 0);
    const c = units.reduce((acc, u) => acc + u[1] * u[1], 0);
    const det = a * c - b * b;
    if (Math.abs(det) < 1e-9) throw new Error('adjustable straights are all parallel');
    const w = [
      (c * residual[0] - b * residual[1]) / det,
      (-b * residual[0] + a * residual[1]) / det,
    ];

    let clamped = false;
    for (let k = 0; k < adjustable.length; k++) {
      const dL = units[k][0] * w[0] + units[k][1] * w[1];
      const idx = adjustable[k];
      const min = work.elements[idx].min ?? 40;
      const max = work.elements[idx].max ?? 900;
      const next = work.elements[idx].length + dL;
      const bounded = Math.min(max, Math.max(min, next));
      if (bounded !== next) clamped = true;
      work.elements[idx].length = bounded;
    }
    if (!clamped && iter > 2) break;
  }

  if (roundTo) {
    for (const idx of adjustable) {
      work.elements[idx].length = Math.round(work.elements[idx].length / roundTo) * roundTo;
    }
  }
  layout = buildLayout(work);
  return { spec: work, layout };
}

/** Human-readable summary of a solved layout. */
export function describeLayout(layout) {
  const bounds = layout.points.reduce(
    (acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      maxX: Math.max(acc.maxX, p.x),
      minZ: Math.min(acc.minZ, p.z),
      maxZ: Math.max(acc.maxZ, p.z),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  );
  return {
    lengthM: layout.length,
    closureErrorM: layout.closureError,
    headingErrorDeg: layout.headingErrorDeg,
    totalTurnDeg: layout.totalTurnDeg,
    bounds,
    footprint: [bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ],
  };
}
