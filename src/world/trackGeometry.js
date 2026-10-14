/**
 * Pure track geometry.
 *
 * The circuit centre-line is a closed Catmull-Rom spline through authored
 * control points. Everything the game needs to know about "where on the track
 * am I" is derived from this module, and none of it touches the DOM or
 * three.js, so it runs identically in the browser and in the Node test suite.
 *
 * Coordinate convention (used everywhere in this project):
 *   - X points EAST, Z points SOUTH (so NORTH is -Z).
 *   - A heading of 0 rad points EAST.
 *   - direction(theta) = (cos(theta), -sin(theta))
 *   - INCREASING theta is a LEFT turn, decreasing theta is a RIGHT turn.
 *   - curvature k = dtheta/ds, so k > 0 means "left", k < 0 means "right".
 *   - lateral offset is positive on the RIGHT of the direction of travel.
 *
 * @module world/trackGeometry
 */

/** Catmull-Rom interpolation for one axis. */
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Sample a closed Catmull-Rom spline.
 * @param {Array<[number, number]>|Array<{x:number,z:number}>} controlPoints
 * @param {number} samplesPerSegment
 * @returns {Array<{x:number, z:number}>}
 */
export function sampleClosedSpline(controlPoints, samplesPerSegment = 26) {
  const pts = controlPoints.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x, z: p.z }));
  const n = pts.length;
  if (n < 4) throw new RangeError('A closed spline needs at least 4 control points');
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let j = 0; j < samplesPerSegment; j++) {
      const t = j / samplesPerSegment;
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x, t), z: cr(p0.z, p1.z, p2.z, p3.z, t) });
    }
  }
  return out;
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Build a fully derived track geometry object from control points.
 *
 * @param {Array<[number, number]>} controlPoints
 * @param {object} [options]
 * @param {number} [options.samplesPerSegment=26]
 * @param {number} [options.width=13] track width in metres
 * @returns {TrackGeometry}
 */
export function buildTrackGeometry(controlPoints, options = {}) {
  const { samplesPerSegment = 26, width = 13 } = options;

  const points = sampleClosedSpline(controlPoints, samplesPerSegment);
  const count = points.length;

  // --- arc length ---
  const cum = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % count];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.z - a.z);
  }
  const length = cum[count];

  // --- heading at every sample ---
  const heading = new Float64Array(count);
  const dir = new Array(count);
  for (let i = 0; i < count; i++) {
    const prev = points[(i - 1 + count) % count];
    const next = points[(i + 1) % count];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dir[i] = { x: dx / len, z: dz / len };
    heading[i] = Math.atan2(-dz, dx);
  }

  // --- curvature (dtheta/ds), smoothed ---
  const rawCurvature = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const ds = cum[i + 1] - cum[i] || 1e-6;
    rawCurvature[i] = wrapAngle(heading[j] - heading[i]) / ds;
  }
  const curvature = new Float64Array(count);
  const WINDOW = 3;
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let k = -WINDOW; k <= WINDOW; k++) sum += rawCurvature[(i + k + count) % count];
    curvature[i] = sum / (WINDOW * 2 + 1);
  }

  // --- uniform spatial hash so nearest() stays O(1) on a phone ---
  const CELL = Math.max(width * 2.5, 24);
  const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const p of points) {
    if (p.x < bounds.minX) bounds.minX = p.x;
    if (p.z < bounds.minZ) bounds.minZ = p.z;
    if (p.x > bounds.maxX) bounds.maxX = p.x;
    if (p.z > bounds.maxZ) bounds.maxZ = p.z;
  }
  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / CELL) + 1);
  const rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / CELL) + 1);
  const grid = new Map();
  const cellKey = (cx, cz) => cx + cz * cols;
  for (let i = 0; i < count; i++) {
    const cx = Math.floor((points[i].x - bounds.minX) / CELL);
    const cz = Math.floor((points[i].z - bounds.minZ) / CELL);
    const key = cellKey(cx, cz);
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(i);
  }

  /** @param {number} s arc length, may be negative or > length (it wraps) */
  function normaliseS(s) {
    if (!Number.isFinite(s)) return 0;
    let v = s % length;
    if (v < 0) v += length;
    return v;
  }

  /** Binary search the cumulative arc-length table. */
  function indexAtS(s) {
    const target = normaliseS(s);
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, Math.min(count - 1, lo - 1));
  }

  function sampleLerp(i, frac, field) {
    const a = field[i];
    const b = field[(i + 1) % count];
    return a + (b - a) * frac;
  }

  const geometry = {
    controlPoints,
    points,
    dir,
    heading,
    curvature,
    cum,
    length,
    width,
    halfWidth: width / 2,
    bounds,
    CELL,

    normaliseS,
    indexAtS,

    /**
     * Interpolated point + heading + curvature at arc length s.
     * @param {number} s
     */
    pointAt(s) {
      const i = indexAtS(s);
      const segLen = cum[i + 1] - cum[i] || 1e-6;
      const frac = Math.min(1, Math.max(0, (normaliseS(s) - cum[i]) / segLen));
      const a = points[i];
      const b = points[(i + 1) % count];
      const dh = wrapAngle(heading[(i + 1) % count] - heading[i]);
      return {
        x: a.x + (b.x - a.x) * frac,
        z: a.z + (b.z - a.z) * frac,
        heading: heading[i] + dh * frac,
        curvature: sampleLerp(i, frac, curvature),
        index: i,
        s: normaliseS(s),
      };
    },

    /** Absolute world position of the centre-line at s. */
    positionAt(s) {
      const p = geometry.pointAt(s);
      return { x: p.x, z: p.z };
    },

    /** Signed lateral offset of a world position at arc length s. +ve = right. */
    lateralAt(s, x, z) {
      const p = geometry.pointAt(s);
      const dx = x - p.x;
      const dz = z - p.z;
      const hx = Math.cos(p.heading);
      const hz = -Math.sin(p.heading);
      // right-hand normal of (hx, hz) is (-hz, hx)
      return dx * -hz + dz * hx;
    },

    /**
     * Nearest centre-line sample to a world position.
     * @returns {{s:number, index:number, lateral:number, distance:number, point:{x:number,z:number}, heading:number, curvature:number}}
     */
    nearest(x, z) {
      const cx = Math.floor((x - bounds.minX) / CELL);
      const cz = Math.floor((z - bounds.minZ) / CELL);
      let best = null;
      for (let ring = 0; ring <= 4; ring++) {
        for (let ox = -ring; ox <= ring; ox++) {
          for (let oz = -ring; oz <= ring; oz++) {
            if (ring > 0 && Math.abs(ox) !== ring && Math.abs(oz) !== ring) continue;
            const bucket = grid.get(cellKey(cx + ox, cz + oz));
            if (!bucket) continue;
            for (const i of bucket) {
              const p = points[i];
              const d = (p.x - x) ** 2 + (p.z - z) ** 2;
              if (!best || d < best.d) best = { d, i };
            }
          }
        }
        // Only expand rings while nothing was found.
        if (best) break;
      }
      if (!best) {
        // Fall back to a full scan (should never happen with a sane grid).
        for (let i = 0; i < count; i++) {
          const p = points[i];
          const d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (!best || d < best.d) best = { d, i };
        }
      }
      const i = best.i;
      const p = points[i];
      const hx = dir[i].x;
      const hz = dir[i].z;
      const dx = x - p.x;
      const dz = z - p.z;
      return {
        index: i,
        s: cum[i],
        point: { x: p.x, z: p.z },
        heading: heading[i],
        curvature: curvature[i],
        lateral: dx * -hz + dz * hx,
        distance: Math.sqrt(best.d),
      };
    },

    /**
     * Peak |curvature| inside an arc-length window, plus where it occurs.
     * Used to derive corner severity and the AI's target speed.
     */
    peakCurvature(sStart, span, step = 2) {
      let peak = 0;
      let peakS = normaliseS(sStart);
      for (let d = 0; d <= span; d += step) {
        const s = normaliseS(sStart + d);
        const i = indexAtS(s);
        const k = Math.abs(curvature[i]);
        if (k > peak) {
          peak = k;
          peakS = s;
        }
      }
      return { peak, s: peakS, radius: peak > 1e-6 ? 1 / peak : Infinity };
    },

    /** Corner radius in metres at s (Infinity when straight). */
    radiusAt(s) {
      const k = Math.abs(curvature[indexAtS(s)]);
      return k > 1e-6 ? 1 / k : Infinity;
    },
  };

  return geometry;
}

/**
 * Classify a corner from its radius. These labels are what the voice system
 * speaks, so they are deliberately coarse and unambiguous.
 * @param {number} radius metres
 * @returns {'straight'|'gentle'|'medium'|'sharp'|'hairpin'}
 */
export function classifyCorner(radius) {
  if (!Number.isFinite(radius) || radius > 320) return 'straight';
  if (radius > 170) return 'gentle';
  if (radius > 95) return 'medium';
  if (radius > 48) return 'sharp';
  return 'hairpin';
}

/** Human-readable severity phrase used by Game TalkBack. */
export function severityPhrase(severity) {
  switch (severity) {
    case 'hairpin':
      return 'Hairpin';
    case 'sharp':
      return 'Sharp';
    case 'medium':
      return 'Medium';
    case 'gentle':
      return 'Gentle';
    default:
      return '';
  }
}

export const _internals = { wrapAngle, cr };
