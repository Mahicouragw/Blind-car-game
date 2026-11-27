/**
 * Easy Race: the car drives itself while the player only steers with one finger.
 *
 * A blind player asked for this directly: holding the screen to accelerate
 * while also steering by drag, braking for corners heard seconds earlier, and
 * being stopped by every light barrier touch made circuit races - level 3's
 * Dockside Challenge onwards - too hard to win. Easy Race is now the default
 * driving style: the car accelerates on its own, slows itself for corners,
 * follows the racing line with a strong steering assist, warns about corners
 * earlier, and forgives light contact. Classic keeps the original controls.
 *
 * Every test here drives REAL geometry and the REAL input pipeline: the
 * self-drive lap test below puts zero finger on the controls and proves the
 * car still completes a validated lap.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/bus.js';
import { getTrack } from '../src/world/trackData.js';
import { getCar } from '../src/vehicles/carCatalog.js';
import { getLevel } from '../src/race/levels.js';
import { createRace, RACE_PHASE, updateRacer } from '../src/race/raceState.js';
import { createVehicleState, fromKph, resolveSurface, stepVehicle, toKph } from '../src/vehicles/physics.js';
import { createDrivingInput } from '../src/input/drivingInput.js';
import {
  assistPedals,
  assistSteer,
  createAnnouncementDirector,
  EASY_SKILL,
  easySkillFor,
  easySteeringAssist,
  navigationFacts,
} from '../src/race/navigation.js';
import { coerceSettings, defaultSettings, DRIVE_MODE, isEasyDrive } from '../src/a11y/settings.js';

const track = getTrack();
const g = track.geometry;
const ZONE = { role: 'driving' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ settings

test('Easy Race is the default driving style, and Classic is kept', () => {
  assert.equal(defaultSettings().driveMode, 'easy');
  assert.deepEqual(
    DRIVE_MODE.map((d) => d.id),
    ['easy', 'classic']
  );
  assert.equal(isEasyDrive('easy'), true);
  assert.equal(isEasyDrive('classic'), false);
  assert.equal(isEasyDrive(undefined), true, 'old saves without the setting get Easy, not an error');
  assert.equal(isEasyDrive('nonsense'), true, 'unknown values fail open to Easy');
});

test('the driving style survives a save round-trip and rejects tampering', () => {
  const classic = coerceSettings({ driveMode: 'classic' });
  assert.equal(classic.settings.driveMode, 'classic');
  assert.deepEqual(classic.rejected, []);
  const bogus = coerceSettings({ driveMode: 'ludicrous' });
  assert.equal(bogus.settings.driveMode, 'easy');
  assert.deepEqual(bogus.rejected, ['driveMode']);
});

// ------------------------------------------------------------- auto-throttle

test('Easy Race accelerates with no finger on the screen', () => {
  const input = createDrivingInput({ autoThrottle: true });
  try {
    const out = input.update(1 / 60);
    assert.equal(out.throttle, 1, 'full throttle without any press');
    assert.equal(out.brake, 0);
  } finally {
    input.detach();
  }
});

test('Classic still needs a held finger to move', () => {
  const input = createDrivingInput();
  try {
    assert.equal(input.update(1 / 60).throttle, 0, 'no press, no throttle');
    bus.emit('gesture:pressStart', { zone: ZONE, tapCount: 1 });
    assert.equal(input.update(1 / 60).throttle, 1, 'holding accelerates');
    bus.emit('gesture:pressEnd', { zone: ZONE });
    assert.equal(input.update(1 / 60).throttle, 0, 'releasing coasts');
  } finally {
    input.detach();
  }
});

test('a brake tap still slows an Easy Race car, then it sets off again alone', async () => {
  const input = createDrivingInput({ autoThrottle: true });
  try {
    bus.emit('gesture:tap', { zone: ZONE });
    const braking = input.update(1 / 60);
    assert.equal(braking.brake, 1, 'the tap brakes');
    assert.equal(braking.throttle, 0, 'the automatic throttle yields to the brake');
    await sleep(700); // BRAKE_TAP_MS is 620
    const resumed = input.update(1 / 60);
    assert.equal(resumed.brake, 0, 'the tap releases itself');
    assert.equal(resumed.throttle, 1, 'and the car sets off again with no new press');
  } finally {
    input.detach();
  }
});

test('the horn and the handbrake both override the automatic throttle', () => {
  const input = createDrivingInput({ autoThrottle: true });
  try {
    bus.emit('gesture:doubleTapHold', { zone: ZONE });
    assert.equal(input.update(1 / 60).throttle, 0, 'no accelerating while the horn sounds');
    bus.emit('gesture:pressEnd', { zone: ZONE });
    bus.emit('key:down', { action: 'handbrake' });
    assert.equal(input.update(1 / 60).throttle, 0, 'no accelerating into a handbrake pull');
    bus.emit('key:up', { action: 'handbrake' });
    assert.equal(input.update(1 / 60).throttle, 1, 'the throttle returns afterwards');
  } finally {
    input.detach();
  }
});

test('the race screen can switch self-acceleration off when the race ends', () => {
  const input = createDrivingInput({ autoThrottle: true });
  try {
    assert.equal(input.update(1 / 60).throttle, 1);
    input.setAutoThrottle(false);
    assert.equal(input.update(1 / 60).throttle, 0, 'nothing outside a race may move a car');
    input.setAutoThrottle(true);
    assert.equal(input.update(1 / 60).throttle, 1);
  } finally {
    input.detach();
  }
});

// ---------------------------------------------------------- steering assist

test('the assist holds the centre-line with no steering input', () => {
  // The longest straight, sampled mid-span so the look-ahead sees only road.
  const straight = track.zones.filter((z) => z.kind === 'straight').sort((a, b) => b.span - a.span)[0];
  const p = g.pointAt(g.normaliseS(straight.from + straight.span / 2));
  const steer = assistSteer(track, { x: p.x, z: p.z, heading: p.heading, speed: 30 });
  assert.ok(Math.abs(steer) < 0.2, `nearly straight on the line, got ${steer.toFixed(2)}`);
});

test('the assist steers back toward the centre-line from either side', () => {
  const p = g.pointAt(600);
  const nx = Math.sin(p.heading);
  const nz = Math.cos(p.heading);
  // Positive steer is LEFT; positive lateral is RIGHT. Right of the line the
  // way home is left, and vice versa.
  const right = assistSteer(track, { x: p.x + nx * 4, z: p.z + nz * 4, heading: p.heading, speed: 30 });
  assert.ok(right > 0.15, `right of the line it steers left, got ${right.toFixed(2)}`);
  const left = assistSteer(track, { x: p.x - nx * 4, z: p.z - nz * 4, heading: p.heading, speed: 30 });
  assert.ok(left < -0.15, `left of the line it steers right, got ${left.toFixed(2)}`);
});

test('the assist turns into a real corner on its own', () => {
  const hairpin = track.zones.find((z) => z.id === 'zone.corner.hairpin');
  const p = g.pointAt(g.normaliseS(hairpin.from - 25));
  const steer = assistSteer(track, { x: p.x, z: p.z, heading: p.heading, speed: 25 });
  // The hairpin is a right hander: the assist must already be turning right.
  assert.ok(steer < -0.1, `turning right for the hairpin, got ${steer.toFixed(2)}`);
});

test('off the track the assist steers back instead of following an apex', () => {
  const p = g.pointAt(600);
  const nx = Math.sin(p.heading);
  const nz = Math.cos(p.heading);
  const off = g.halfWidth + 3;
  const steer = assistSteer(track, { x: p.x + nx * off, z: p.z + nz * off, heading: p.heading, speed: 20 });
  assert.ok(steer > 0.5, `hard left back to the strip, got ${steer.toFixed(2)}`);
});

// ------------------------------------------------------------------- pedals

test('the Easy pace matches the best opponent on the grid', () => {
  assert.equal(EASY_SKILL, 0.85);
  assert.equal(easySkillFor(getLevel(3)), 0.86, 'level 3: matches Kabir, the fastest opponent');
  assert.equal(easySkillFor(getLevel(4)), 0.9, 'level 4: matches the 0.9 field');
  assert.equal(easySkillFor(getLevel(1)), 0.85, 'level 1: never slower than the floor');
  assert.equal(easySkillFor(null), 0.85, 'no level, no fear');
});

test('the automatic pedals brake for corners and floor it on straights', () => {
  const car = getCar('kestrel');
  const hairpin = track.zones.find((z) => z.id === 'zone.corner.hairpin');
  const approach = g.pointAt(g.normaliseS(hairpin.from - 40));
  const rushing = assistPedals(
    track,
    { x: approach.x, z: approach.z, heading: approach.heading, speed: fromKph(160) },
    car,
    { skill: 0.86, speedScale: 1, gripMultiplier: 1 }
  );
  assert.equal(rushing.throttle, 0, 'too fast for the hairpin: off the throttle');
  assert.ok(rushing.brake > 0.3, `and on the brake (${rushing.brake.toFixed(2)})`);

  const straight = track.zones.filter((z) => z.kind === 'straight').sort((a, b) => b.span - a.span)[0];
  const open = g.pointAt(g.normaliseS(straight.from + straight.span / 2));
  const cruising = assistPedals(
    track,
    { x: open.x, z: open.z, heading: open.heading, speed: fromKph(60) },
    car,
    { skill: 0.86, speedScale: 1, gripMultiplier: 1 }
  );
  assert.ok(cruising.throttle > 0.9, `open road: full throttle (${cruising.throttle.toFixed(2)})`);
  assert.equal(cruising.brake, 0);
});

test('off the track the automatic driver lifts instead of digging in', () => {
  const car = getCar('kestrel');
  const p = g.pointAt(600);
  const nx = Math.sin(p.heading);
  const nz = Math.cos(p.heading);
  const off = g.halfWidth + 3;
  const pedals = assistPedals(
    track,
    { x: p.x + nx * off, z: p.z + nz * off, heading: p.heading, speed: fromKph(120) },
    car,
    { skill: 0.86, speedScale: 1, gripMultiplier: 1 }
  );
  assert.ok(pedals.throttle < 0.6, `lifts off track (${pedals.throttle.toFixed(2)})`);
  assert.ok(pedals.brake > 0, 'and brakes from speed');
});

test('yaw damping is strong at speed and fades for slow hairpins', () => {
  assert.equal(easySteeringAssist(40), 0.3, 'hairpin speed: the car must be able to rotate');
  assert.equal(easySteeringAssist(150), 0.9, 'straight speed: rock steady');
  const mid = easySteeringAssist(90);
  assert.ok(mid > 0.3 && mid < 0.9, `blends between (${mid.toFixed(2)})`);
  assert.equal(easySteeringAssist(NaN), 0.9, 'unknown speed fails safe to steady');
});

// ----------------------------------------------------------- earlier warnings

function directorWith(settings) {
  return createAnnouncementDirector({
    settings: {
      warningDistance: 'normal',
      navFrequency: 'balanced',
      conciseSpeech: false,
      speakSpeedLaps: true,
      speakPosition: true,
      speakOpponents: true,
      ...settings,
    },
    now: () => 0,
  });
}

function cornerFacts(distanceM) {
  return {
    zoneId: 'zone.straight.test',
    zone: { id: 'zone.straight.test', kind: 'straight' },
    speed: 30,
    speedKph: 108,
    tooFast: false,
    suggestedSpeedKph: null,
    look: null,
    nextCorner: {
      id: 'zone.corner.hairpin',
      label: 'the Hairpin',
      kind: 'corner',
      direction: 'right',
      severity: 'hairpin',
      radius: 30,
      distanceM,
    },
  };
}

test('Easy Race teaches the contract up front, then adds a midpoint call', () => {
  const d = directorWith({ driveMode: 'easy' });
  const race = { lap: 1, totalLaps: 2, phase: 'racing' };
  const early = d.update(cornerFacts(500), race, [], null);
  assert.equal(early.length, 1);
  assert.match(early[0].text, /in 500 metres/, 'the first call still states the distance');
  assert.match(early[0].text, /slows itself/, 'and says the car is handling the speed');
  assert.match(early[0].text, /steer right/, 'and what the player should do');
  assert.deepEqual(d.update(cornerFacts(400), race, [], null), [], 'no chatter on the way in');
  const mid = d.update(cornerFacts(240), race, [], null);
  assert.equal(mid.length, 1);
  assert.match(mid[0].text, /in 250 metres/, 'a midpoint distance update at 250 m');
  assert.deepEqual(d.update(cornerFacts(100), race, [], null), [], 'then silence again');
  const now = d.update(cornerFacts(50), race, [], null);
  assert.equal(now.length, 1);
  assert.match(now[0].text, /Turn right now/, 'the final call is unchanged');
});

test('on a short leg Easy Race states the real distance once, never twice', () => {
  const d = directorWith({ driveMode: 'easy' });
  const race = { lap: 1, totalLaps: 2, phase: 'racing' };
  const early = d.update(cornerFacts(200), race, [], null);
  assert.equal(early.length, 1);
  assert.match(early[0].text, /in 200 metres/);
  assert.deepEqual(d.update(cornerFacts(180), race, [], null), [], 'no midpoint echo of the same distance');
});

test('Classic keeps exactly two calls with the original wording', () => {
  const d = directorWith({ driveMode: 'classic' });
  const race = { lap: 1, totalLaps: 2, phase: 'racing' };
  const early = d.update(cornerFacts(500), race, [], null);
  assert.equal(early.length, 1);
  assert.equal(early[0].text, 'Turn right in 500 metres.');
  assert.deepEqual(d.update(cornerFacts(240), race, [], null), [], 'no midpoint call in Classic');
});

// ------------------------------------------------------- the self-drive lap

test('with no finger on the controls, the car completes a validated level 3 lap', () => {
  // Level 3, the Dockside Challenge, is where the player asked for help: four
  // opponents up to skill 0.86, no extra grip, minimal steering assist. This
  // is exactly what the race screen does in Easy Race with zero player input:
  // the target-speed pedals at the level's Easy pace, the steering assist at
  // full authority, strong yaw damping.
  const level = getLevel(3);
  const car = getCar('kestrel');
  const skill = easySkillFor(level);
  const race = createRace({
    track,
    totalLaps: 1,
    entrants: [{ id: 'player', name: 'Aarav', isPlayer: true, gridPosition: 3, carId: 'kestrel' }],
  });
  race.phase = RACE_PHASE.RACING;
  const start = race.racers.find((r) => r.id === 'player');
  const vehicle = createVehicleState({ x: start.x, z: start.z, heading: start.heading });
  const dt = 1 / 60;
  let maxLateral = 0;
  let finished = null;
  for (let i = 0; i < 60 * 400; i++) {
    race.elapsed += dt;
    const surf = resolveSurface(track, vehicle.x, vehicle.z);
    const pedals = assistPedals(track, vehicle, car, {
      skill,
      speedScale: 1,
      gripMultiplier: level.gripMultiplier ?? 1,
    });
    const steer = assistSteer(track, vehicle);
    stepVehicle(vehicle, { throttle: pedals.throttle, brake: pedals.brake, steer }, car, dt, {
      surface: surf.surface,
      gripMultiplier: level.gripMultiplier ?? 1,
      steeringAssist: Math.max(level.steeringAssist ?? 0, easySteeringAssist(Math.abs(toKph(vehicle.speed)))),
    });
    maxLateral = Math.max(maxLateral, Math.abs(surf.near.lateral));
    const events = updateRacer(race, 'player', {
      x: vehicle.x,
      z: vehicle.z,
      s: surf.near.s,
      speed: vehicle.speed,
      heading: vehicle.heading,
      offTrack: surf.offTrack,
    });
    const f = events.find((e) => e.type === 'finish');
    if (f) {
      finished = f;
      break;
    }
  }
  assert.ok(maxLateral < g.halfWidth + 9.5, `it never reached the barrier (max ${maxLateral.toFixed(1)} m)`);
  assert.ok(finished, 'the un-driven car finished a checkpoint-validated lap');
  assert.ok(race.elapsed < 300, `it took ${race.elapsed.toFixed(0)} s, a plausible lap`);
});
