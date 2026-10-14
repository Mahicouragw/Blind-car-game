/**
 * Analytic circuit layout builder.
 *
 * A track is authored as an ordered list of elements - straights and constant
 * radius turns with an explicit angle - rather than as free-floating spline
 * points. Walking that list produces an exact centre-line, and (importantly)
 * the sum of the turn angles tells you immediately whether the lap closes:
 * a clockwise circuit must total -360 degrees.
 *
 * This is the single source of truth for corner direction, corner radius and
 * therefore for what Game TalkBack says. Nothing downstream hard-codes "turn
 * three is a right hander"; it is measured from the element.
 *
 * @module world/layout
 */

/**
 * @typedef {{kind:'straight', length:number, id?:string, name?:string}} StraightEl
 * @typedef {{kind:'turn', angle:number, radius:number, id?:string, name?:string}} TurnEl
 * @typedef {StraightEl|TurnEl} LayoutElement
 */

const DEFAULT_ARC_STEP = 4; // metres along an arc between samples
const DEFAULT_LINE_STEP = 8; // metres along a straight between samples

/**
 * @param {number} deg
 * @returns {'straight'|'gentle'|'medium'|'sharp'|'hairpin'} severity from radius
 */
export function severityFromRadius(radius) {
  if (!Number.isFinite(radius) || radius > 320) return 'straight';
  if (radius > 170) return 'gentle';
  if (radius > 95) return 'medium';
  if (radius > 48) return 'sharp';
  return 'hairpin';
}

/**
 * Turn-angle based shape label. A corner that reverses direction by ~180
 * degrees is announced as a U-turn / hairpin even if its radius is generous.
 * @param {number} angleDeg signed degrees, + = left
 */
export function shapeFromAngle(angleDeg) {
  const a = Math.abs(angleDeg);
  if (a >= 160) return 'reversal'; // U-turn-like / hairpin
  if (a >= 80) return 'corner';
  if (a >= 30) return 'kink';
  return 'straight';
}

/**
 * Build the centre-line polyline plus per-element metadata.
 *
 * @param {object} spec
 * @param {Array<LayoutElement>} spec.elements
 * @param {number} [spec.startHeading=0] radians, 0 = east
 * @param {{x:number,z:number}|[number,number]} [spec.origin]
 * @param {number} [spec.arcStep]
 * @param {number} [spec.lineStep]
 */
export function buildLayout(spec) {
  const {
    elements,
    startHeading = 0,
    origin = { x: 0, z: 0 },
    arcStep = DEFAULT_ARC_STEP,
    lineStep = DEFAULT_LINE_STEP,
  } = spec;

  const o = Array.isArray(origin) ? { x: origin[0], z: origin[1] } : origin;
  let x = o.x;
  let z = o.z;
  let theta = startHeading;
  let s = 0;

  /** @type {Array<{x:number,z:number,heading:number,s:number}>} */
  const points = [];
  /** @type {Array<object>} */
  const layoutElements = [];

  const push = (px, pz, ptheta, ps) => points.push({ x: px, z: pz, heading: ptheta, s: ps });

  push(x, z, theta, 0);

  for (let ei = 0; ei < elements.length; ei++) {
    const el = elements[ei];
    const sStart = s;

    if (el.kind === 'straight') {
      const len = el.length;
      const steps = Math.max(1, Math.round(len / lineStep));
      const dx = (Math.cos(theta) * len) / steps;
      const dz = (-Math.sin(theta) * len) / steps;
      for (let i = 0; i < steps; i++) {
        x += dx;
        z += dz;
        s += len / steps;
        push(x, z, theta, s);
      }
      layoutElements.push({
        index: ei,
        id: el.id ?? `el.${ei}`,
        name: el.name ?? null,
        group: el.group ?? null,
        kind: 'straight',
        sStart,
        sEnd: s,
        length: s - sStart,
        angle: 0,
        radius: Infinity,
        direction: 'straight',
        severity: 'straight',
        shape: 'straight',
      });
      continue;
    }

    if (el.kind !== 'turn') throw new TypeError(`Unknown layout element kind: ${el.kind}`);

    const angleDeg = el.angle;
    const angle = (angleDeg * Math.PI) / 180;
    const radius = el.radius;
    if (!(radius > 0)) throw new RangeError('turn radius must be > 0');
    const arcLen = Math.abs(angle) * radius;
    const steps = Math.max(2, Math.round(arcLen / arcStep));
    const dTheta = angle / steps;
    const dS = arcLen / steps;
    // Right-hand normal of direction (cos t, -sin t) is (sin t, cos t).
    // A LEFT turn (angle > 0) puts the centre of curvature on the LEFT, i.e.
    // at p - rightNormal * radius. A right turn puts it at p + rightNormal * r.
    const sign = angle > 0 ? 1 : -1;
    for (let i = 0; i < steps; i++) {
      const rightX = Math.sin(theta);
      const rightZ = Math.cos(theta);
      const cx = x - sign * rightX * radius;
      const cz = z - sign * rightZ * radius;
      const rx = x - cx;
      const rz = z - cz;
      const cosA = Math.cos(dTheta);
      const sinA = Math.sin(dTheta);
      // In this frame (Z south) increasing theta is the rotation
      // (a,b) -> (a cos + b sin, b cos - a sin). Verified in tests.
      x = cx + rx * cosA + rz * sinA;
      z = cz - rx * sinA + rz * cosA;
      theta += dTheta;
      s += dS;
      push(x, z, theta, s);
    }

    layoutElements.push({
      index: ei,
      id: el.id ?? `el.${ei}`,
      name: el.name ?? null,
      group: el.group ?? null,
      callout: el.callout ?? null,
      kind: 'turn',
      sStart,
      sEnd: s,
      length: s - sStart,
      angle: angleDeg,
      radius,
      direction: angleDeg > 0 ? 'left' : 'right',
      severity: severityFromRadius(radius),
      shape: shapeFromAngle(angleDeg),
    });
  }

  return {
    points,
    elements: layoutElements,
    length: s,
    end: { x, z, heading: theta },
    start: { x: o.x, z: o.z, heading: startHeading },
    /** Signed degrees of total turning; must be +-360 for a closed lap. */
    totalTurnDeg: layoutElements.reduce((acc, e) => acc + (e.angle || 0), 0),
    /** Positional closure error in metres. */
    closureError: Math.hypot(x - o.x, z - o.z),
    /** Heading closure error in degrees. */
    headingErrorDeg: (((theta - startHeading) * 180) / Math.PI) % 360,
  };
}

/** Convenience report used by the validator and by docs generation. */
export function layoutReport(layout) {
  return {
    length: layout.length,
    totalTurnDeg: layout.totalTurnDeg,
    closureError: layout.closureError,
    headingErrorDeg: layout.headingErrorDeg,
    turns: layout.elements.filter((e) => e.kind === 'turn').length,
    straights: layout.elements.filter((e) => e.kind === 'straight').length,
  };
}
