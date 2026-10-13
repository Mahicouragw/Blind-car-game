/**
 * Opponent AI.
 *
 * Opponents drive the SAME physics model as the player - they are not on
 * rails. Each one pursues a racing line derived from the real centre-line and
 * curvature, brakes for corners using the same v = sqrt(mu*g*r) the voice
 * system quotes, and reacts to traffic. Difficulty comes from `skill`
 * (fraction of the achievable corner speed they dare to carry) and
 * `aggression` (how closely they race you), which is exactly the tuning surface
 * the level table needs.
 *
 * @module vehicles/ai
 */

import { cornerSpeed, fromKph, stepVehicle, clamp01, wrapPi } from './physics.js';

/**
 * @param {object} config
 * @param {object} config.track
 * @param {object} config.car      catalogue car
 * @param {{x:number,z:number,heading:number}} config.start
 * @param {number} config.skill    0..1
 * @param {number} config.aggression 0..1
 * @param {string} config.id
 * @param {string} config.name
 */
export function createAiDriver(config) {
  const { track, car, start, skill = 0.75, aggression = 0.4, id, name } = config;
  const near = track.geometry.nearest(start.x, start.z);
  return {
    id,
    name,
    car,
    skill: clamp01(skill),
    aggression: clamp01(aggression),
    x: start.x,
    z: start.z,
    heading: start.heading,
    speed: 0,
    s: near.s,
    lateral: near.lateral,
    targetLateral: 0,
    throttle: 0,
    brake: 0,
    steer: 0,
    // Per-driver consistency so opponents are recognisable lap to lap.
    seed: hashSeed(id ?? name ?? 'ai'),
    liftForTraffic: 0,
    lastTargetSpeed: 0,
    stuckTimer: 0,
    state: {
      x: start.x,
      z: start.z,
      heading: start.heading,
      speed: 0,
      steer: 0,
      yawRate: 0,
      lateralSlip: 0,
      longitudinalSlip: 0,
      rpm: car?.physics?.idleRpm ?? 900,
      gear: 1,
      skidLevel: 0,
      distanceTravelled: 0,
      surface: 'track',
      offTrack: false,
      collisionCount: 0,
      lastCollisionAt: -Infinity,
    },
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Corner-safe target speed by scanning ahead. Looking at a single point would
 * let an AI arrive at a hairpin still on full throttle.
 */
export const AI_BRAKE_PLANNING_DECEL = 8.2; // m/s^2, slightly inside the car's real capability

export function aiTargetSpeed(track, car, s, speed, skill, speedScale, opts = {}) {
  const g = track.geometry;
  const gm = opts.gripMultiplier ?? 1;
  const mu = (car?.physics?.gripMu ?? 1) * gm;
  const lookahead = Math.max(18, Math.min(230, 14 + speed * 2.6));
  let limit = fromKph(car?.physics?.topSpeedKph ?? 200) * speedScale;
  const step = 5;
  for (let d = 0; d <= lookahead; d += step) {
    const ahead = g.normaliseS(s + d);
    const radius = g.radiusAt(ahead);
    // Skill is applied ONCE, here. speedScale is the level's global dial, used
    // only on the straight-line ceiling above; multiplying both would make
    // beginners twice as slow as intended. gripMultiplier is folded into mu, so
    // cornerSpeed is called with 1 to avoid applying it a second time.
    const vmax = cornerSpeed({ gripMu: mu }, radius, 1) * skill;
    // The fastest speed we can be carrying HERE and still brake down to vmax by
    // the time we reach that point: v = sqrt(vmax^2 + 2*a*d). Taking the
    // minimum over the whole window gives a proper late-braking profile instead
    // of slowing to the tightest corner speed the moment it comes into view.
    const allowed = Math.sqrt(vmax * vmax + 2 * AI_BRAKE_PLANNING_DECEL * d);
    if (allowed < limit) limit = allowed;
  }
  return limit;
}

/**
 * Advance one opponent.
 *
 * @param {object} ai
 * @param {number} dt
 * @param {object} ctx {track, speedScale, rubberBand, gripMultiplier, racers, player, phase}
 */
export function updateAiDriver(ai, dt, ctx) {
  const { track, racers = [], player = null } = ctx;
  const g = track.geometry;
  const speedScale = ctx.speedScale ?? 1;
  const rubberBand = ctx.rubberBand ?? 0;
  const state = ai.state;

  const near = g.nearest(state.x, state.z);
  ai.s = g.normaliseS(near.s);
  ai.lateral = near.lateral;

  const speed = state.speed;

  // ------------------------------------------------------------ racing line
  // Apex the inside of the next corner, straighten up on exits.
  const lateralNow = Math.abs(near.lateral);
  const lookahead = Math.max(12, Math.min(70, 10 + speed * 1.15 + lateralNow * 0.35));
  const aheadS = g.normaliseS(ai.s + lookahead);
  const ahead = g.pointAt(aheadS);
  const curvature = ahead.curvature;
  const halfW = g.halfWidth;
  const apexAmount = Number.isFinite(g.radiusAt(aheadS))
    ? Math.min(halfW * 0.34, 1.1 + (1 / Math.max(20, g.radiusAt(aheadS))) * 150)
    : halfW * 0.14;
  const side = curvature > 0.0006 ? -1 : curvature < -0.0006 ? 1 : 0;
  const wobble = (ai.seed - 0.5) * halfW * 0.22; // each driver holds a slightly different line
  ai.targetLateral = side * apexAmount + wobble;

  // ------------------------------------------------------------ traffic
  ai.liftForTraffic = Math.max(0, ai.liftForTraffic - dt * 1.6);
  let blocked = false;
  for (const other of racers) {
    if (other.id === ai.id) continue;
    const dx = other.x - state.x;
    const dz = other.z - state.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 22 || dist < 0.01) continue;
    const fx = Math.cos(state.heading);
    const fz = -Math.sin(state.heading);
    const forward = dx * fx + dz * fz;
    const right = dx * -fz + dz * fx;
    if (forward > 2 && Math.abs(right) < 4.5) {
      blocked = true;
      // Try to pass on the side with more room.
      ai.targetLateral = right > 0 ? -halfW * 0.55 : halfW * 0.55;
      ai.liftForTraffic = Math.max(ai.liftForTraffic, 0.35 + ai.aggression * 0.3);
    }
  }

  // ------------------------------------------------------- rubber banding
  let scale = speedScale;
  if (rubberBand > 0 && player) {
    const playerProgress = (player.lapsCompleted ?? 0) * g.length + (player.s ?? 0);
    const aiProgress = (ai.lapsCompleted ?? 0) * g.length + ai.s;
    const gap = playerProgress - aiProgress; // +ve = AI is behind
    const norm = Math.max(-1, Math.min(1, gap / 260));
    scale *= 1 + rubberBand * 0.14 * norm;
    scale = Math.max(0.55, Math.min(1.12, scale));
  }

  const target = aiTargetSpeed(track, ai.car, ai.s, speed, ai.skill, scale * (1 - ai.liftForTraffic * 0.55), {
    gripMultiplier: ctx.gripMultiplier ?? 1,
  });
  ai.lastTargetSpeed = target;

  // ------------------------------------------------------------- controls
  // Positive steer is LEFT in this physics model (yaw rate = v/L * tan(delta),
  // and positive d(theta)/ds is a left turn), and positive `lateral` is RIGHT
  // of the centre-line. Getting either sign wrong makes opponents run
  // permanently wide, so both are asserted here rather than assumed.
  const offTrack = Math.abs(ai.lateral) > g.halfWidth + 0.4;
  // When off the racing strip, aim back at the track instead of at an apex we
  // can no longer reach.
  const desiredLateral = offTrack ? Math.sign(ai.lateral || 1) * g.halfWidth * 0.35 : ai.targetLateral;
  const lateralErr = ai.lateral - desiredLateral; // +ve = we are too far RIGHT

  // Right-hand normal of the look-ahead point is (sin h, cos h).
  const rx = Math.sin(ahead.heading);
  const rz = Math.cos(ahead.heading);
  const tx = ahead.x + rx * desiredLateral;
  const tz = ahead.z + rz * desiredLateral;
  const desired = Math.atan2(-(tz - state.z), tx - state.x);
  const err = wrapPi(desired - state.heading);
  const gain = 2.4 - ai.skill * 0.7; // better drivers need less correction

  // Pure pursuit alone converges too slowly to hold a line through a corner:
  // the aim point curves away at the same rate the car drifts. An explicit
  // lateral-error term closes that gap.
  const kLat = offTrack ? 0.24 : 0.13;
  let steer = Math.max(-1, Math.min(1, err * gain + lateralErr * kLat));

  if (offTrack) {
    // Recovery: point at a spot back on the track and steer hard toward it.
    const recover = g.pointAt(g.normaliseS(ai.s + 16));
    const errBack = wrapPi(Math.atan2(-(recover.z - state.z), recover.x - state.x) - state.heading);
    steer = Math.max(-1, Math.min(1, errBack * 2.8 + (ai.lateral > 0 ? 0.85 : -0.85)));
    ai.stuckTimer += dt;
  } else {
    ai.stuckTimer = Math.max(0, ai.stuckTimer - dt * 2);
  }

  const tooFast = speed > target + 1.2;
  // Ease off while off track: grass and gravel have far less grip, and full
  // throttle there just digs the car in further.
  const offTrackLift = offTrack ? 0.55 : 0;
  const brake = tooFast ? clamp01((speed - target) / 14) : offTrack && speed > 22 ? 0.25 : 0;
  const throttle = tooFast || blocked ? 0 : clamp01((target - speed) / 6 + 0.25 - offTrackLift);

  ai.throttle = throttle;
  ai.brake = brake;
  ai.steer = steer;

  stepVehicle(
    state,
    { throttle, brake, steer },
    ai.car,
    dt,
    {
      surface: Math.abs(near.lateral) > g.halfWidth ? 'grass' : 'track',
      gripMultiplier: ctx.gripMultiplier ?? 1,
      steeringAssist: 0,
    }
  );

  ai.x = state.x;
  ai.z = state.z;
  ai.heading = state.heading;
  ai.speed = state.speed;
  return ai;
}

/**
 * Simple separation so two opponents never occupy the same space. Called after
 * all AI updates with the full racer list.
 */
export function separateRacers(racers, minDistance = 3.4) {
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i];
      const b = racers[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.001 || d >= minDistance) continue;
      const push = (minDistance - d) / 2;
      const nx = dx / d;
      const nz = dz / d;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      // Contact slows both cars a little - a real bump, not a teleport.
      const loss = 0.06;
      if (a.state) a.state.speed *= 1 - loss;
      else a.speed *= 1 - loss;
      if (b.state) b.state.speed *= 1 - loss;
      else b.speed *= 1 - loss;
    }
  }
}
