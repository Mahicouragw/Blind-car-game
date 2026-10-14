/**
 * Car catalogue - five original vehicles with genuinely different physics.
 *
 * Every car here is an invented make and model belonging to this game's world.
 * The numbers are not decorative: `physics` is fed straight into
 * vehicles/physics.js, so the car you pick really does drive differently.
 * `handling` is the 1-5 summary spoken and shown on the selection screen.
 *
 * @module vehicles/carCatalog
 */

/**
 * @typedef {object} Car
 * @property {string} id
 * @property {string} name
 * @property {string} tagline
 * @property {string} description  spoken + shown on the car selection screen
 * @property {string} handlingNote spoken summary of how it drives
 * @property {{acceleration:number,braking:number,handling:number,topSpeed:number,difficulty:number}} handling 1-5
 * @property {string} bodyStyle     key used by the 3D car mesh builder
 * @property {string} engineSound   asset id from the audio manifest
 * @property {boolean} starter
 * @property {object} physics
 */

/** @type {Car[]} */
export const CARS = [
  {
    id: 'kestrel',
    name: 'Vettaru Kestrel 1600',
    tagline: 'The forgiving first car',
    description:
      'A light front wheel drive hatchback from the Vettaru plant. Soft suspension, predictable grip, and it tells you what it is going to do before it does it.',
    handlingNote:
      'Beginner friendly. Gentle steering, easy to catch when it slides, forgiving on grass. Slower in a straight line than the others.',
    handling: { acceleration: 2, braking: 3, handling: 4, topSpeed: 2, difficulty: 1 },
    bodyStyle: 'hatchback',
    engineSound: 'engine-loop',
    accent: '#2f6f4e',
    starter: true,
    unlock: null,
    physics: {
      mass: 1140,
      peakPowerKw: 78,
      drivetrainEfficiency: 0.9,
      torqueCurveWidth: 0.55,
      torqueCurveFalloff: 0.3,
      peakTorqueNm: 142,
      torquePeakFraction: 0.62,
      gearRatios: [3.2, 2.15, 1.55, 1.16, 0.94, 0.78],
      reverseRatio: 3.0,
      finalDrive: 3.4,
      wheelRadius: 0.3,
      wheelbase: 2.55,
      maxSteerAngle: 0.52,
      steerRate: 2.5,
      steerSpeedFalloff: 0.5,
      gripMu: 0.98,
      brakeForce: 10400,
      dragCoeff: 0.62,
      rollingResistance: 0.016,
      engineBrakeTorque: 26,
      downforceCoeff: 0.05,
      topSpeedKph: 182,
      reverseSpeedKph: 34,
      idleRpm: 850,
      redlineRpm: 6400,
      scrubFactor: 0.42,
      yawTimeConstant: 0.16,
      drivenAxleFraction: 0.52,
      reverseAccel: 1.5,
    },
  },
  {
    id: 'metro-gt',
    name: 'Anandapur Metro GT',
    tagline: 'Balanced all-rounder',
    description:
      'The city built this one for the coast road. Even weight distribution, strong brakes, and enough power to keep up on the Quayside Straight without punishing a mistake.',
    handlingNote:
      'Balanced. Good acceleration, good braking, neutral handling. The safest choice once you know the circuit.',
    handling: { acceleration: 3, braking: 4, handling: 3, topSpeed: 3, difficulty: 2 },
    bodyStyle: 'coupe',
    engineSound: 'engine-loop',
    accent: '#26557a',
    starter: true,
    unlock: null,
    physics: {
      mass: 1330,
      peakPowerKw: 132,
      drivetrainEfficiency: 0.9,
      torqueCurveWidth: 0.55,
      torqueCurveFalloff: 0.3,
      peakTorqueNm: 215,
      torquePeakFraction: 0.68,
      gearRatios: [3.35, 2.25, 1.62, 1.22, 0.99, 0.82],
      reverseRatio: 3.1,
      finalDrive: 3.55,
      wheelRadius: 0.32,
      wheelbase: 2.68,
      maxSteerAngle: 0.48,
      steerRate: 2.7,
      steerSpeedFalloff: 0.52,
      gripMu: 1.02,
      brakeForce: 12800,
      dragCoeff: 0.62,
      rollingResistance: 0.015,
      engineBrakeTorque: 32,
      downforceCoeff: 0.09,
      topSpeedKph: 218,
      reverseSpeedKph: 32,
      idleRpm: 800,
      redlineRpm: 7000,
      scrubFactor: 0.5,
      yawTimeConstant: 0.13,
      drivenAxleFraction: 0.5,
      reverseAccel: 1.6,
    },
  },
  {
    id: 'vantage-rs',
    name: 'Kalpesh Vantage RS',
    tagline: 'Fast, nervous, rewarding',
    description:
      'A rear wheel drive homologation special with far more power than its chassis expects. It launches hard and it will step out on you at the Kiln Left if you are greedy with the throttle.',
    handlingNote:
      'Very high acceleration but difficult handling. Rear wheel drive, snappy steering, low grip margin. Punishes early throttle and late braking.',
    handling: { acceleration: 5, braking: 4, handling: 2, topSpeed: 4, difficulty: 4 },
    bodyStyle: 'sport',
    engineSound: 'engine-loop',
    accent: '#8c2f2f',
    starter: false,
    unlock: { level: 3, reason: 'Reach driver level three' },
    physics: {
      mass: 1255,
      peakPowerKw: 262,
      drivetrainEfficiency: 0.9,
      torqueCurveWidth: 0.6,
      torqueCurveFalloff: 0.28,
      peakTorqueNm: 330,
      torquePeakFraction: 0.74,
      gearRatios: [3.5, 2.4, 1.75, 1.32, 1.06, 0.87],
      reverseRatio: 3.2,
      finalDrive: 3.7,
      wheelRadius: 0.33,
      wheelbase: 2.5,
      maxSteerAngle: 0.46,
      steerRate: 3.3,
      steerSpeedFalloff: 0.42,
      gripMu: 0.94,
      brakeForce: 13200,
      dragCoeff: 0.58,
      rollingResistance: 0.014,
      engineBrakeTorque: 40,
      downforceCoeff: 0.16,
      topSpeedKph: 252,
      reverseSpeedKph: 30,
      idleRpm: 900,
      redlineRpm: 7800,
      scrubFactor: 0.68,
      yawTimeConstant: 0.09,
      drivenAxleFraction: 0.48,
      reverseAccel: 1.7,
    },
  },
  {
    id: 'haulmaster',
    name: 'Trident Haulmaster 9T',
    tagline: 'Heavy, momentum-driven',
    description:
      'A port logistics truck that the paddock adopted as a challenge car. Enormous mass, tall gearing and brakes that need planning three corners ahead. It will not turn quickly, and it will not stop quickly.',
    handlingNote:
      'Heavy. Slow steering, very wide turning radius, huge momentum. You must brake much earlier and carry less speed into corners. Strong in a straight once rolling.',
    handling: { acceleration: 1, braking: 1, handling: 1, topSpeed: 3, difficulty: 5 },
    bodyStyle: 'truck',
    engineSound: 'engine-loop-alt',
    accent: '#7a6a24',
    starter: false,
    unlock: { level: 4, reason: 'Reach driver level four' },
    physics: {
      mass: 4200,
      peakPowerKw: 150,
      drivetrainEfficiency: 0.85,
      torqueCurveWidth: 0.7,
      torqueCurveFalloff: 0.22,
      peakTorqueNm: 620,
      torquePeakFraction: 0.5,
      gearRatios: [4.1, 2.9, 2.1, 1.55, 1.2, 0.98],
      reverseRatio: 4.0,
      finalDrive: 4.1,
      wheelRadius: 0.45,
      wheelbase: 3.6,
      maxSteerAngle: 0.4,
      steerRate: 1.5,
      steerSpeedFalloff: 0.3,
      gripMu: 0.62,
      brakeForce: 26000,
      dragCoeff: 1.55,
      rollingResistance: 0.013,
      engineBrakeTorque: 70,
      downforceCoeff: 0.0,
      topSpeedKph: 148,
      reverseSpeedKph: 22,
      idleRpm: 700,
      redlineRpm: 4200,
      scrubFactor: 0.3,
      yawTimeConstant: 0.32,
      drivenAxleFraction: 0.5,
      reverseAccel: 0.9,
    },
  },
  {
    id: 'volt-e',
    name: 'Nexora Volt-E',
    tagline: 'Instant torque, silent, precise',
    description:
      'An electric prototype from the Nexora fuel sponsor. No gears to hunt, all the torque from zero revolutions, and very quiet - which changes what you hear through Game TalkBack. Grip is excellent, but the battery mass makes it less nimble than it feels.',
    handlingNote:
      'Instant acceleration and very precise steering, but heavy for its size so direction changes lag slightly. Quiet engine sound, so spoken guidance and tyre noise carry more.',
    handling: { acceleration: 5, braking: 5, handling: 4, topSpeed: 3, difficulty: 3 },
    bodyStyle: 'proto',
    engineSound: 'engine-loop-alt',
    accent: '#3a6b8c',
    starter: false,
    unlock: { level: 2, reason: 'Reach driver level two' },
    physics: {
      mass: 1620,
      peakPowerKw: 152,
      drivetrainEfficiency: 0.95,
      torqueCurveWidth: 0.95,
      torqueCurveFalloff: 0.22,
      peakTorqueNm: 300,
      torquePeakFraction: 0.0,
      gearRatios: [2.6, 1.9, 1.45, 1.15, 0.98, 0.88],
      reverseRatio: 2.6,
      finalDrive: 3.2,
      wheelRadius: 0.34,
      wheelbase: 2.75,
      maxSteerAngle: 0.5,
      steerRate: 2.9,
      steerSpeedFalloff: 0.48,
      gripMu: 1.06,
      brakeForce: 15400,
      dragCoeff: 0.54,
      rollingResistance: 0.012,
      engineBrakeTorque: 46,
      downforceCoeff: 0.14,
      topSpeedKph: 228,
      reverseSpeedKph: 28,
      idleRpm: 0,
      redlineRpm: 5200,
      scrubFactor: 0.46,
      yawTimeConstant: 0.19,
      drivenAxleFraction: 0.5,
      reverseAccel: 1.8,
    },
  },
];

/** Stable id list, used for validating saved selections. */
export const CAR_IDS = CARS.map((c) => c.id);

export function getCar(id) {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}

/**
 * Driver level required for a car, or 1 for the starter cars.
 * Single source of truth: save validation and unlock checks both use this.
 */
export function carUnlockLevel(carOrId) {
  const car = typeof carOrId === 'string' ? getCar(carOrId) : carOrId;
  return car?.unlock?.level ?? 1;
}

/** Cars available at a given driver level. */
export function availableCars(level) {
  return CARS.map((car) => ({
    ...car,
    locked: !!(car.unlock && car.unlock.level > level),
    lockReason: car.unlock && car.unlock.level > level ? car.unlock.reason : null,
  }));
}

/**
 * The sentence Game TalkBack speaks when a car receives focus.
 * Kept here so the wording is consistent everywhere and is testable.
 */
export function carAnnouncement(car, index, total, locked = false) {
  const h = car.handling;
  const parts = [
    `Car ${index + 1} of ${total}. ${car.name}. ${car.tagline}.`,
    locked
      ? `Locked. ${car.unlock?.reason ?? 'Not available yet.'}`
      : `${car.description} Handling: acceleration ${h.acceleration} of 5, braking ${h.braking} of 5, grip and handling ${h.handling} of 5, top speed ${h.topSpeed} of 5, difficulty ${h.difficulty} of 5. ${car.handlingNote}`,
  ];
  return parts.join(' ');
}
