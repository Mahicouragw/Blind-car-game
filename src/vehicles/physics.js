/**
 * Vehicle physics - a pure single-track ("bicycle") model.
 *
 * No DOM, no three.js, no globals: the same function drives the browser and
 * the test suite. It models the things the brief asks for explicitly:
 * acceleration, engine braking, aerodynamic drag, rolling resistance, braking
 * force, speed-sensitive steering, a real turning radius, longitudinal
 * momentum, lateral grip saturation (understeer + speed scrub), surface grip,
 * collisions and off-track recovery.
 *
 * Units are SI throughout: metres, seconds, kilograms, newtons, m/s.
 * Speed is exposed in km/h only at the display boundary.
 *
 * @module vehicles/physics
 */

export const G = 9.81;
export const AIR_DENSITY = 1.2;

/** Surface types the car can be on. `grip` multiplies tyre mu, `drag` adds resistance. */
export const SURFACE = {
  track: { id: 'track', grip: 1.0, drag: 1.0, label: 'racing surface' },
  kerb: { id: 'kerb', grip: 0.88, drag: 1.15, label: 'kerb' },
  grass: { id: 'grass', grip: 0.55, drag: 2.9, label: 'grass' },
  gravel: { id: 'gravel', grip: 0.46, drag: 3.8, label: 'gravel trap' },
  pit: { id: 'pit', grip: 0.95, drag: 1.05, label: 'pit lane' },
};

export function surfaceById(id) {
  return SURFACE[id] ?? SURFACE.track;
}

/** Convert m/s to km/h. */
export const toKph = (mps) => mps * 3.6;
/** Convert km/h to m/s. */
export const fromKph = (kph) => kph / 3.6;

/**
 * Create a fresh vehicle state.
 * @param {{x:number, z:number, heading:number, speed?:number}} init
 */
export function createVehicleState(init) {
  return {
    x: init.x,
    z: init.z,
    heading: init.heading,
    speed: init.speed ?? 0, // m/s, signed (+ forward, - reverse)
    steer: 0, // current front-wheel angle, radians
    yawRate: 0, // rad/s
    lateralSlip: 0, // 0..1, how saturated the tyres are
    longitudinalSlip: 0, // 0..1, wheelspin / lockup
    rpm: 900,
    gear: 1,
    throttle: 0,
    brake: 0,
    handbrake: false,
    surface: 'track',
    offTrack: false,
    distanceTravelled: 0,
    lastCollisionAt: -Infinity,
    collisionCount: 0,
    stalled: false,
    /** Rolling average of |lateral acceleration|, used for tyre audio. */
    skidLevel: 0,
  };
}

/**
 * Automatic gearbox: picks a ratio from speed so the engine stays in its band.
 * @param {object} car
 * @param {number} speed m/s (signed)
 * @param {number} throttle 0..1
 */
export function selectGear(carIn, speed, throttle) {
  const car = physicsOf(carIn);
  const absSpeed = Math.abs(speed);
  const ratios = car.gearRatios;
  const topKph = car.topSpeedKph;
  let gear = 1;
  for (let i = 0; i < ratios.length; i++) {
    // Speed at which this gear reaches redline.
    const redlineSpeed = fromKph((topKph * (i + 1)) / ratios.length) * 1.06;
    if (absSpeed >= redlineSpeed * 0.9) gear = i + 1;
  }
  if (speed < -0.4 && throttle > 0.05) gear = -1; // reversing
  return gear;
}

/** Engine rpm from speed and gear, clamped into [idle, redline]. */
export function rpmFromSpeed(carIn, speed, gear) {
  const car = physicsOf(carIn);
  const g = Math.abs(gear) || 1;
  const perGearTop = fromKph(car.topSpeedKph) / car.gearRatios.length;
  const frac = Math.min(1.35, Math.abs(speed) / (perGearTop * g * 1.06));
  const rpm = car.idleRpm + frac * (car.redlineRpm - car.idleRpm);
  return Math.max(car.idleRpm, Math.min(car.redlineRpm * 1.02, rpm));
}

/**
 * Normalised engine torque 0..1 across the rev range: a bell centred on
 * `torquePeakFraction`. Width and depth of the fall-off are per-car so an
 * electric motor (flat from zero rpm) and a peaky race engine behave
 * differently with the same code path.
 */
export function torqueCurve(carIn, rpm) {
  const car = physicsOf(carIn);
  const span = Math.max(1, car.redlineRpm - car.idleRpm);
  const x = Math.min(1.35, Math.max(0, (rpm - car.idleRpm) / span));
  const peak = car.torquePeakFraction ?? 0.65;
  const width = car.torqueCurveWidth ?? 0.55;
  const falloff = car.torqueCurveFalloff ?? 0.3;
  const d = (x - peak) / width;
  return Math.max(0.18, Math.min(1, 1 - falloff * d * d));
}

/**
 * Advance the simulation.
 *
 * @param {object} state  mutated in place and returned
 * @param {{throttle?:number, brake?:number, steer?:number, handbrake?:boolean}} input
 * @param {object} car    a car from vehicles/carCatalog.js
 * @param {number} dt     seconds (clamped internally)
 * @param {object} [opts]
 * @param {string} [opts.surface='track']
 * @param {number} [opts.gripMultiplier=1] extra grip scaling (difficulty / recovery)
 * @param {number} [opts.steeringAssist=0] 0..1, damps yaw for beginner levels
 */
export function stepVehicle(state, input, car, dt, opts = {}) {
  // Sub-step so a hitchy frame cannot explode the integration.
  const total = Math.min(0.05, Math.max(0.0005, dt));
  const steps = total > 0.02 ? 2 : 1;
  const h = total / steps;
  for (let i = 0; i < steps; i++) substep(state, input, car, h, opts);
  return state;
}

/**
 * Accept either a catalogue car ({physics: {...}}) or a bare physics object.
 * Keeps call sites simple and makes the module usable from tests directly.
 */
export function physicsOf(car) {
  return car && car.physics ? car.physics : car;
}

/**
 * A copy of a car spec with its pace scaled, for the Car pace setting.
 *
 * Top speed, peak torque and peak power are scaled together so the car is slower
 * to accelerate as well as slower at the top - "slower" has to mean both, or it
 * does not buy the player any time. Grip, steering, mass, gearing and the torque
 * curve shape are left alone, so the car still handles like the car that was
 * chosen in the garage, and the choice of car still matters.
 *
 * Returns the original object unchanged at a scale of 1, so the common case does
 * not allocate a new spec every race.
 *
 * @param {object} carIn a catalogue car ({physics:{...}}) or a bare physics object
 * @param {number} scale
 */
export function withPace(carIn, scale = 1) {
  const car = physicsOf(carIn);
  if (!car) return carIn;
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (s === 1) return carIn;
  const physics = {
    ...car,
    topSpeedKph: car.topSpeedKph * s,
    peakTorqueNm: car.peakTorqueNm * s,
    peakPowerKw: car.peakPowerKw * s,
  };
  return carIn && carIn.physics ? { ...carIn, physics } : physics;
}

function substep(state, input, carIn, dt, opts) {
  const car = physicsOf(carIn);
  const throttle = clamp01(input.throttle ?? 0);
  const brakeInput = clamp01(input.brake ?? 0);
  const steerTarget = Math.max(-1, Math.min(1, input.steer ?? 0));
  // The handbrake is a real input now (it was documented and ignored before):
  // it locks the rears, kills rear grip and makes the car slide. The double tap
  // pulls it; see input/drivingInput.js.
  const handbrake = !!input.handbrake;
  const surface = surfaceById(opts.surface ?? state.surface ?? 'track');
  const gripMul = (opts.gripMultiplier ?? 1) * surface.grip;
  state.surface = surface.id;
  state.throttle = throttle;
  state.brake = brakeInput;
  state.handbrake = handbrake;

  const speed = state.speed;
  const absSpeed = Math.abs(speed);

  // ------------------------------------------------------------ 1. steering
  // Steering is rate limited AND speed sensitive, so the car can never snap
  // sideways. Max road-wheel angle falls off as speed rises.
  const speedFactor = Math.min(1, absSpeed / fromKph(car.topSpeedKph));
  const maxAngle = car.maxSteerAngle * (1 - car.steerSpeedFalloff * speedFactor);
  const desired = steerTarget * maxAngle;
  const steerRate = car.steerRate * (1 - 0.35 * speedFactor); // rad/s
  const delta = desired - state.steer;
  const maxDelta = steerRate * dt;
  state.steer += Math.max(-maxDelta, Math.min(maxDelta, delta));

  // ------------------------------------------------------------ 2. traction
  const mu = car.gripMu * gripMul;
  const normalLoad = car.mass * G;
  // Downforce grows with speed and buys extra grip.
  const downforce = car.downforceCoeff * speed * speed;
  // A pulled handbrake takes grip away from the rear: the same steering input
  // saturates the tyres sooner, the car rotates more than the line asks for,
  // and that difference IS the drift. Bounded so it is a slide, not ice.
  const latGripFactor = handbrake ? 0.58 : 1;
  const maxLatAccel = ((mu * (normalLoad + downforce)) / car.mass) * latGripFactor;

  // --------------------------------------------- 3. longitudinal forces
  const gear = selectGear(car, speed, throttle);
  state.gear = gear;
  state.rpm = rpmFromSpeed(car, speed, gear);

  let driveForce = 0;
  if (throttle > 0.001) {
    const ratio = gear < 0 ? car.reverseRatio : car.gearRatios[Math.abs(gear) - 1] ?? 1;
    // Constant-torque branch: what the wheels can do in the lower gears.
    const torqueForce =
      (car.peakTorqueNm * torqueCurve(car, state.rpm) * ratio * car.finalDrive * throttle) / car.wheelRadius;
    // Constant-power branch: what actually sets the top speed. Taking the
    // minimum of the two gives the classic traction curve without special
    // casing gear changes.
    const powerForce =
      ((car.peakPowerKw ?? 100) * 1000 * (car.drivetrainEfficiency ?? 0.9) * throttle) / Math.max(1, absSpeed);
    driveForce = Math.min(torqueForce, powerForce);
  }
  // Traction limit: a driven wheel can only push so hard before it spins.
  const tractionLimit = mu * normalLoad * car.drivenAxleFraction;
  const wheelspin = driveForce > tractionLimit ? driveForce / Math.max(1, tractionLimit) - 1 : 0;
  driveForce = Math.min(driveForce, tractionLimit);
  state.longitudinalSlip = Math.min(1, wheelspin);

  const dragForce = 0.5 * AIR_DENSITY * car.dragCoeff * speed * Math.abs(speed);
  const rollingForce = car.rollingResistance * car.mass * G * surface.drag * Math.sign(speed);
  const engineBrake =
    speed > 0.5 && throttle < 0.02 ? car.engineBrakeTorque * (state.rpm / car.redlineRpm) * 12 : 0;

  let brakeForce = 0;
  if (brakeInput > 0.001) {
    brakeForce = car.brakeForce * brakeInput;
    // Braking is also traction limited; exceed it and the wheels lock.
    const brakeLimit = mu * normalLoad * 0.98;
    if (brakeForce > brakeLimit) {
      state.longitudinalSlip = Math.max(state.longitudinalSlip, Math.min(1, brakeForce / brakeLimit - 1));
      brakeForce = brakeLimit;
    }
    brakeForce *= Math.sign(speed) || 1;
  }
  // The handbrake locks the rears on top of any pedal braking: strong retard,
  // and a locked axle is a sliding axle.
  if (handbrake) {
    const ebrakeLimit = mu * normalLoad * 0.6;
    brakeForce += ebrakeLimit * Math.sign(speed) || 0;
    state.longitudinalSlip = Math.max(state.longitudinalSlip, Math.min(1, 0.5 + 0.4 * Math.min(1, absSpeed / 12)));
  }

  const netForce = driveForce - dragForce - rollingForce - engineBrake - brakeForce;
  let accel = netForce / car.mass;

  // Reverse: at a standstill, throttle with the brake held becomes reverse.
  if (absSpeed < 0.6 && brakeInput > 0.5 && throttle > 0.2) {
    accel = -car.reverseAccel;
  }

  state.speed += accel * dt;

  // Top speed is an emergent consequence of drag vs power, but we clamp it so
  // no car can exceed its published figure through a numerical artefact.
  const topSpeed = fromKph(car.topSpeedKph);
  if (state.speed > topSpeed) state.speed = topSpeed;
  if (state.speed < -fromKph(car.reverseSpeedKph)) state.speed = -fromKph(car.reverseSpeedKph);
  // Rolling to a stop: kill creep so the car does not jitter forever.
  if (Math.abs(state.speed) < 0.06 && throttle < 0.01 && brakeInput < 0.01) state.speed = 0;
  if (brakeInput > 0.05 && Math.abs(state.speed) < 0.25 && throttle < 0.05) state.speed = 0;

  // ------------------------------------------------------------- 4. yaw
  // Ideal single-track yaw rate, then limited by what the tyres can actually
  // deliver. The difference is understeer, and it scrubs off speed.
  const wheelbase = car.wheelbase;
  const idealYaw = absSpeed > 0.35 ? (state.speed / wheelbase) * Math.tan(state.steer) : 0;
  const achievableYaw = absSpeed > 0.35 ? maxLatAccel / Math.abs(state.speed) : Math.abs(idealYaw);
  const saturated = Math.abs(idealYaw) > achievableYaw;
  const targetYaw = saturated ? Math.sign(idealYaw) * achievableYaw : idealYaw;

  // Yaw inertia: the car rotates towards the target rather than instantly.
  // A sliding car with the handbrake on rotates a little more freely than the
  // grip model alone says - the tail is already loose, so let it come round.
  const yawResponse = 1 - Math.exp(-dt / (car.yawTimeConstant * (handbrake ? 0.8 : 1)));
  state.yawRate += (targetYaw * (handbrake ? 1.12 : 1) - state.yawRate) * yawResponse;

  const assist = clamp01(opts.steeringAssist ?? 0);
  if (assist > 0) state.yawRate *= 1 - assist * 0.25;

  state.lateralSlip = saturated
    ? Math.min(1, (Math.abs(idealYaw) - achievableYaw) / Math.max(0.05, achievableYaw))
    : Math.max(0, state.lateralSlip - dt * 2.5);
  // Sliding on the handbrake is audible and visible even before the tyres are
  // fully saturated: hold a floor of slip so the skid loop tells the player the
  // car is sideways.
  if (handbrake && absSpeed > 1.5) {
    state.lateralSlip = Math.max(state.lateralSlip, Math.min(1, 0.3 + Math.min(0.5, absSpeed * 0.04)));
  }

  // Grip saturation scrubs speed - this is what makes cornering fast
  // require slowing down, rather than being free.
  if (saturated) {
    const scrub = state.lateralSlip * car.scrubFactor * dt * Math.abs(state.speed);
    state.speed -= Math.sign(state.speed) * Math.min(Math.abs(state.speed) * 0.5, scrub);
  }

  state.heading += state.yawRate * dt;
  state.heading = wrapPi(state.heading);

  // --------------------------------------------------------- 5. integrate
  const dx = Math.cos(state.heading) * state.speed * dt;
  const dz = -Math.sin(state.heading) * state.speed * dt;
  state.x += dx;
  state.z += dz;
  state.distanceTravelled += Math.hypot(dx, dz);

  // ------------------------------------------------------- 6. tyre audio
  const slipEnergy = Math.max(state.lateralSlip, state.longitudinalSlip);
  const speedWeight = Math.min(1, absSpeed / fromKph(35));
  const target = slipEnergy * speedWeight;
  state.skidLevel += (target - state.skidLevel) * Math.min(1, dt * 6);
  if (state.skidLevel < 0.02) state.skidLevel = 0;

  return state;
}

/**
 * Resolve a collision against a surface with a normal.
 * Reflects the velocity, kills most of it, and pushes the car off the barrier.
 * @returns {{impactSpeed:number, impacted:boolean}}
 */
export function applyCollision(state, normal, opts = {}) {
  const restitution = opts.restitution ?? 0.18;
  const nx = normal.x;
  const nz = normal.z;
  const vx = Math.cos(state.heading) * state.speed;
  const vz = -Math.sin(state.heading) * state.speed;
  const intoSurface = vx * nx + vz * nz; // negative means moving into the wall
  const impactSpeed = Math.abs(intoSurface);
  if (intoSurface >= 0) return { impactSpeed: 0, impacted: false };

  // Remove the into-surface component and bounce a little.
  const jx = vx - nx * intoSurface * (1 + restitution);
  const jz = vz - nz * intoSurface * (1 + restitution);
  const newSpeed = Math.hypot(jx, jz) * (intoSurface < -2 ? 0.72 : 0.9);
  if (newSpeed > 0.4) {
    state.heading = Math.atan2(-jz, jx);
    state.speed = newSpeed * Math.sign(1);
  } else {
    state.speed = 0;
  }
  state.yawRate *= 0.35;
  state.lateralSlip = 1;
  state.collisionCount += 1;
  state.lastCollisionAt = opts.now ?? 0;
  // Nudge away from the surface so we do not immediately re-collide.
  const push = opts.pushOut ?? 0.35;
  state.x += nx * push;
  state.z += nz * push;
  return { impactSpeed, impacted: true };
}

/**
 * Safe recovery: put the car back on the racing line, pointing the right way,
 * at a gentle speed. Used when the player leaves the track and cannot get back.
 */
export function respawnOnTrack(state, track, s, opts = {}) {
  const target = track.geometry.pointAt(track.geometry.normaliseS(s));
  state.x = target.x;
  state.z = target.z;
  state.heading = target.heading;
  state.speed = opts.speed ?? fromKph(28);
  state.yawRate = 0;
  state.steer = 0;
  state.lateralSlip = 0;
  state.longitudinalSlip = 0;
  state.skidLevel = 0;
  state.offTrack = false;
  return state;
}

/**
 * Which surface is the car on, and how far off the racing line?
 * Pure: uses only the track geometry and the car position.
 */
export function resolveSurface(track, x, z) {
  const g = track.geometry;
  const near = g.nearest(x, z);
  const lateral = Math.abs(near.lateral);
  const half = g.halfWidth;

  // Distance from the pit lane centre-line.
  let pitDistance = Infinity;
  for (const p of track.pit.points) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < pitDistance) pitDistance = d;
  }
  const inPit = pitDistance < track.pit.width / 2 + 1.5;

  if (inPit) return { surface: 'pit', lateral, onTrack: true, offTrack: false, pitLane: true, near };
  if (lateral <= half - 0.9) return { surface: 'track', lateral, onTrack: true, offTrack: false, pitLane: false, near };
  if (lateral <= half + 0.8) return { surface: 'kerb', lateral, onTrack: true, offTrack: false, pitLane: false, near };
  if (lateral <= half + 7) return { surface: 'grass', lateral, onTrack: true, offTrack: true, pitLane: false, near };
  return { surface: 'gravel', lateral, onTrack: false, offTrack: true, pitLane: false, near };
}

/** Barrier contact: is the car beyond the outer safety barrier line? */
export function barrierDistance(track, x, z) {
  const g = track.geometry;
  const near = g.nearest(x, z);
  const limit = g.halfWidth + 9.5; // grass strip then Armco / tyre wall
  return { distance: limit - Math.abs(near.lateral), lateral: near.lateral, limit, near };
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Corner target speed from radius - v = sqrt(mu * g * r).
 * Used by the AI and by the voice system ("too fast for this corner").
 */
export function cornerSpeed(carIn, radius, gripMultiplier = 1) {
  const car = physicsOf(carIn);
  if (!Number.isFinite(radius)) return fromKph(car.topSpeedKph);
  const mu = car.gripMu * gripMultiplier;
  return Math.sqrt(Math.max(1, mu * G * radius));
}
