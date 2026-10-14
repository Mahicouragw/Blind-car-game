/**
 * Race logic: lap counting with checkpoint validation, race completion and
 * finishing order, live positions, the navigation announcements, the opponent
 * AI, and the vehicle physics guarantees the brief asks for.
 *
 * Every test drives REAL geometry: a lap is only counted if the car actually
 * swept every checkpoint sector in order.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getTrack, resetTrackCache } from '../src/world/trackData.js';
import {
  buildResults,
  createRace,
  formatRaceTime,
  opponentsNearPlayer,
  RACE_PHASE,
  recomputePositions,
  updateRacer,
} from '../src/race/raceState.js';
import { createAiDriver, separateRacers, updateAiDriver } from '../src/vehicles/ai.js';
import {
  applyCollision,
  createVehicleState,
  fromKph,
  respawnOnTrack,
  resolveSurface,
  stepVehicle,
  toKph,
} from '../src/vehicles/physics.js';
import { getCar } from '../src/vehicles/carCatalog.js';
import { getLevel, PRACTICE_LEVEL } from '../src/race/levels.js';
import { createAnnouncementDirector, cornerWarningText, navigationFacts, relativeBearing } from '../src/race/navigation.js';

const track = getTrack();
const g = track.geometry;

/** Drive a racer along the centre-line at a fixed step, one frame at a time. */
/**
 * Drive a racer along the centre-line. With direction -1 the car is genuinely
 * reversing, so it faces the opposite way to the track - which is what lets the
 * lap logic tell a backwards crossing from a forwards one.
 */
function driveLap(race, id, { laps = 1, step = 6, direction = 1 } = {}) {
  const events = [];
  const total = g.length * laps * direction;
  let travelled = 0;
  let s = race.racers.find((r) => r.id === id).s;
  while (Math.abs(travelled) < Math.abs(total)) {
    s = g.normaliseS(s + step * direction);
    travelled += step * direction;
    const p = g.pointAt(s);
    const heading = direction > 0 ? p.heading : p.heading + Math.PI;
    race.elapsed += step / 40;
    events.push(...updateRacer(race, id, { x: p.x, z: p.z, s, heading, speed: 40 * direction }));
  }
  return events;
}

function makeRace(opts = {}) {
  resetTrackCache();
  return createRace({
    track,
    totalLaps: opts.totalLaps ?? 2,
    entrants: opts.entrants ?? [
      { id: 'player', name: 'Aarav', isPlayer: true, gridPosition: 3, carId: 'kestrel' },
      { id: 'ai0', name: 'Joseph', gridPosition: 1, carId: 'kestrel' },
      { id: 'ai1', name: 'Mithin', gridPosition: 2, carId: 'metro-gt' },
    ],
  });
}

// ------------------------------------------------------------- lap counting

test('the grid places every entrant inside the grid zone, staggered', () => {
  const race = makeRace();
  const gridZone = track.zones.find((z) => z.kind === 'grid');
  for (const r of race.racers) {
    const s = g.normaliseS(r.s);
    assert.ok(s >= gridZone.from && s <= gridZone.from + gridZone.span, `${r.name} is on the grid (s=${s.toFixed(0)})`);
  }
  const p1 = race.racers.find((r) => r.gridPosition === 1);
  const p3 = race.racers.find((r) => r.gridPosition === 3);
  assert.ok(p1.s > p3.s, 'pole position is closest to the line');
  assert.notEqual(p1.x, p3.x, 'grid slots are staggered left and right, not in a line');
});

test('a full lap around the real centre-line counts exactly one lap', () => {
  const race = makeRace({ totalLaps: 3 });
  race.phase = RACE_PHASE.RACING;
  const events = driveLap(race, 'player', { laps: 1 });
  const laps = events.filter((e) => e.type === 'lap');
  assert.equal(laps.length, 1, `exactly one lap counted, got ${laps.length}`);
  assert.equal(race.player.lapsCompleted, 1);
  assert.equal(race.player.lap, 2, 'the display lap advances');
  assert.deepEqual(events.filter((e) => e.type === 'lapRejected'), [], 'no rejection on a clean lap');
  const checkpoints = events.filter((e) => e.type === 'checkpoint');
  assert.equal(checkpoints.length, track.checkpoints.length, 'every checkpoint sector was proved');
});

test('multiple laps accumulate and finish at the right time', () => {
  const race = makeRace({ totalLaps: 2 });
  race.phase = RACE_PHASE.RACING;
  const events = driveLap(race, 'player', { laps: 2 });
  assert.equal(events.filter((e) => e.type === 'lap').length, 2);
  const finish = events.find((e) => e.type === 'finish');
  assert.ok(finish, 'a finish event was produced');
  assert.equal(finish.position, 1);
  assert.equal(race.player.finished, true);
  assert.deepEqual(race.finishOrder, ['player']);
});

test('driving backwards over the line does not count a lap', () => {
  const race = makeRace({ totalLaps: 2 });
  race.phase = RACE_PHASE.RACING;
  const events = driveLap(race, 'player', { laps: 1, step: -6, direction: -1 });
  assert.equal(events.filter((e) => e.type === 'lap').length, 0, 'no lap from reversing');
  assert.equal(race.player.lapsCompleted, 0);
});

test('cutting across the infield is rejected for missing checkpoints', () => {
  const race = makeRace({ totalLaps: 2 });
  race.phase = RACE_PHASE.RACING;
  const player = race.player;
  // Drive a little, then jump straight back over the line without visiting the
  // rest of the circuit.
  driveLap(race, 'player', { laps: 0.02 });
  player.checkpoints.clear();
  player.nextCheckpoint = 1;
  const before = player.lapsCompleted;
  const atLine = g.pointAt(g.normaliseS(g.length - 4));
  const events = updateRacer(race, 'player', { x: atLine.x, z: atLine.z, s: g.length - 4, heading: atLine.heading, speed: 30 });
  const pastLine = g.pointAt(4);
  events.push(...updateRacer(race, 'player', { x: pastLine.x, z: pastLine.z, s: 4, heading: pastLine.heading, speed: 30 }));
  assert.equal(player.lapsCompleted, before, 'the shortcut did not complete a lap');
  assert.ok(events.some((e) => e.type === 'lapRejected'), 'the shortcut was reported as rejected');
});

test('laps are not counted before the race starts', () => {
  const race = makeRace({ totalLaps: 2 });
  assert.equal(race.phase, RACE_PHASE.GRID);
  const events = driveLap(race, 'player', { laps: 1 });
  assert.equal(events.filter((e) => e.type === 'lap').length, 0);
  assert.equal(race.player.lapsCompleted, 0);
});

// -------------------------------------------------------- positions & finish

test('positions follow real distance covered, not the starting grid', () => {
  const race = makeRace({ totalLaps: 2 });
  race.phase = RACE_PHASE.RACING;
  driveLap(race, 'ai0', { laps: 0.6 });
  driveLap(race, 'ai1', { laps: 0.3 });
  driveLap(race, 'player', { laps: 0.1 });
  recomputePositions(race);
  const order = [...race.racers].sort((a, b) => a.position - b.position).map((r) => r.name);
  assert.deepEqual(order, ['Joseph', 'Mithin', 'Aarav']);
  assert.equal(race.player.position, 3);
});

test('a finished car always outranks one still running', () => {
  const race = makeRace({ totalLaps: 1 });
  race.phase = RACE_PHASE.RACING;
  driveLap(race, 'ai0', { laps: 1 });
  driveLap(race, 'player', { laps: 0.9 });
  recomputePositions(race);
  assert.equal(race.racers.find((r) => r.id === 'ai0').position, 1);
  assert.equal(race.player.position, 2);
});

test('finish order is the order cars actually crossed the line', () => {
  const race = makeRace({ totalLaps: 1 });
  race.phase = RACE_PHASE.RACING;
  driveLap(race, 'ai1', { laps: 1 });
  driveLap(race, 'player', { laps: 1 });
  driveLap(race, 'ai0', { laps: 1 });
  assert.deepEqual(race.finishOrder, ['ai1', 'player', 'ai0']);
  const results = buildResults(race);
  assert.equal(results[0].name, 'Mithin');
  assert.equal(results[1].name, 'Aarav');
  assert.equal(results[2].name, 'Joseph');
  assert.ok(results.every((r) => r.finished));
});

test('race times are formatted and spoken differently', () => {
  assert.equal(formatRaceTime(72.346), '1:12.35');
  assert.equal(formatRaceTime(65), '1:05.00');
  assert.equal(formatRaceTime(0), '0:00.00');
  assert.equal(formatRaceTime(null), '--:--');
});

// ---------------------------------------------------------------- navigation

test('navigation facts come from real geometry, not chance', () => {
  for (const zone of track.zones.filter((z) => z.kind === 'corner')) {
    const s = g.normaliseS(zone.from + zone.span * 0.5);
    const p = g.pointAt(s);
    const facts = navigationFacts(track, { x: p.x, z: p.z, heading: p.heading, speed: 20 }, {});
    assert.equal(facts.onTrack, true, `on track inside ${zone.id}`);
    assert.ok(Math.abs(facts.lateral) < 0.5, 'the centre-line reports no lateral offset');
    assert.equal(facts.zoneId, zone.id, `the zone at ${zone.id} is identified`);
    assert.ok(facts.nextCorner, 'a next corner is always known');
  }
});

test('the next corner reports the true direction, severity and distance', () => {
  const hairpin = track.zones.find((z) => z.id === 'zone.corner.hairpin');
  // Sampled close enough that no other corner sits between here and the hairpin.
  const p = g.pointAt(g.normaliseS(hairpin.from - 55));
  const facts = navigationFacts(track, { x: p.x, z: p.z, heading: p.heading, speed: 40 }, {});
  assert.equal(facts.nextCorner.id, 'zone.corner.hairpin');
  assert.equal(facts.nextCorner.direction, 'right');
  assert.equal(facts.nextCorner.severity, 'hairpin');
  assert.ok(Math.abs(facts.nextCorner.distanceM - 55) < 12, `distance ${facts.nextCorner.distanceM.toFixed(0)} is about 55m`);
});

test('the U-turn and the hairpin get distinct spoken callouts', () => {
  const uturn = track.zones.find((z) => z.id === 'zone.corner.uturn');
  const hairpin = track.zones.find((z) => z.id === 'zone.corner.hairpin');
  assert.match(cornerWarningText(uturn), /U-turn/);
  assert.match(cornerWarningText(hairpin), /Hairpin approaching/);
  assert.doesNotMatch(cornerWarningText(hairpin), /U-turn/);
});

test('every corner warning states the real direction', () => {
  for (const zone of track.zones.filter((z) => z.kind === 'corner' || z.kind === 'chicane')) {
    const text = cornerWarningText(zone);
    if (zone.kind === 'chicane') {
      assert.match(text, /Chicane/);
      continue;
    }
    const expected = zone.direction === 'left' ? /left/i : /right/i;
    assert.match(text, expected, `${zone.id} should say ${zone.direction}`);
    const wrong = zone.direction === 'left' ? /right-hand|turn right/ : /left-hand|turn left/;
    assert.doesNotMatch(text, wrong, `${zone.id} must not mention the opposite direction`);
  }
});

test('going off track produces a recovery direction, and it is correct', () => {
  const p = g.pointAt(600);
  const nx = Math.sin(p.heading);
  const nz = Math.cos(p.heading);
  // Stand 20 m to the RIGHT of the centre-line, facing along the track.
  const facts = navigationFacts(track, { x: p.x + nx * 20, z: p.z + nz * 20, heading: p.heading, speed: 10 }, {});
  assert.equal(facts.offTrack, true);
  assert.equal(facts.lateral > 0, true, 'positive lateral means right of the centre-line');
  assert.equal(facts.recovery.steer, 'left', 'the way back is to the left');
  assert.equal(facts.recovery.facingTrackWay, true);
});

test('too fast is only reported when the car really cannot make the corner', () => {
  const hairpin = track.zones.find((z) => z.id === 'zone.corner.hairpin');
  const car = getCar('kestrel').physics;
  const near = g.pointAt(g.normaliseS(hairpin.from - 60));
  const tooFast = navigationFacts(track, { x: near.x, z: near.z, heading: near.heading, speed: fromKph(160) }, { car });
  assert.equal(tooFast.tooFast, true, '160 km/h into a hairpin 60 m away is too fast');
  assert.ok(tooFast.suggestedSpeedKph < 80, `it suggests ${Math.round(tooFast.suggestedSpeedKph)} km/h`);

  const slow = navigationFacts(track, { x: near.x, z: near.z, heading: near.heading, speed: fromKph(45) }, { car });
  assert.equal(slow.tooFast, false, '45 km/h is fine');
});

test('relative bearings are computed in the player frame', () => {
  // Facing east (heading 0); another car due south (+Z) is on the RIGHT.
  assert.equal(relativeBearing(0, 0, 0, 0, 10).side, 'right');
  assert.equal(relativeBearing(0, 0, 0, 0, -10).side, 'left');
  assert.equal(relativeBearing(0, 0, 0, 10, 0).side, 'ahead');
  assert.equal(relativeBearing(0, 0, 0, -10, 0).side, 'behind');
});

// ------------------------------------------------------- announcement rules

function director(settings = {}) {
  let t = 0;
  const d = createAnnouncementDirector({
    now: () => t,
    getSettings: () => ({
      warningDistance: 'normal',
      navFrequency: 'balanced',
      conciseSpeech: false,
      speakSpeedLaps: true,
      speakPosition: true,
      speakOpponents: true,
      ...settings,
    }),
  });
  return { d, tick: (ms) => (t += ms) };
}

test('a corner is warned once, at the configured distance, and not repeated', () => {
  const { d } = director();
  const hairpin = track.zones.find((z) => z.id === 'zone.corner.hairpin');
  const far = g.pointAt(g.normaliseS(hairpin.from - 400));
  let items = d.update(navigationFacts(track, { x: far.x, z: far.z, heading: far.heading, speed: 30 }, {}), { lap: 1, totalLaps: 2, phase: 'racing' });
  assert.equal(items.filter((i) => i.tag === 'corner').length, 0, 'nothing at 400 m');

  const near = g.pointAt(g.normaliseS(hairpin.from - 90));
  items = d.update(navigationFacts(track, { x: near.x, z: near.z, heading: near.heading, speed: 30 }, {}), { lap: 1, totalLaps: 2, phase: 'racing' });
  const warnings = items.filter((i) => i.tag === 'corner');
  assert.equal(warnings.length, 1, 'one warning inside the warning distance');
  assert.match(warnings[0].text, /Hairpin/);

  items = d.update(navigationFacts(track, { x: near.x, z: near.z, heading: near.heading, speed: 30 }, {}), { lap: 1, totalLaps: 2, phase: 'racing' });
  assert.equal(items.filter((i) => i.tag === 'corner').length, 0, 'the same corner is not warned twice');
});

test('the warning distance setting moves the announcement', () => {
  // Find a corner with a clear approach, then a distance at which that corner is
  // genuinely the next one. Sampling blindly can land on a different corner and
  // would then prove nothing about the setting.
  const corner = track.zones.find((z) => z.id === 'zone.corner.t7');
  let clearDistance = 0;
  for (let d = 10; d <= 260; d += 5) {
    const p = g.pointAt(g.normaliseS(corner.from - d));
    const f = navigationFacts(track, { x: p.x, z: p.z, heading: p.heading, speed: 30 }, {});
    if (f.nextCorner?.id !== corner.id) break;
    clearDistance = d;
  }
  assert.ok(clearDistance >= 130, `the approach to ${corner.name} is clear for ${clearDistance} m`);
  const sample = 120; // between the short (70 m) and long (190 m) settings
  assert.ok(sample < clearDistance, 'the sample point is inside the clear approach');

  const p = g.pointAt(g.normaliseS(corner.from - sample));
  const facts = navigationFacts(track, { x: p.x, z: p.z, heading: p.heading, speed: 30 }, {});
  const early = director({ warningDistance: 'long' });
  const late = director({ warningDistance: 'short' });
  assert.equal(early.d.warningMetres(), 190);
  assert.equal(late.d.warningMetres(), 70);

  const about = (items) => items.filter((i) => i.tag === 'corner' && i.text.includes('Lighthouse'));
  assert.equal(about(early.d.update(facts, { lap: 1, totalLaps: 2, phase: 'racing' })).length, 1, 'the long setting warns at 120 m');
  assert.equal(about(late.d.update(facts, { lap: 1, totalLaps: 2, phase: 'racing' })).length, 0, 'the short setting does not warn yet at 120 m');
});

test('an overtake is only announced when the position really changed', () => {
  const { d } = director();
  const p = g.pointAt(200);
  const facts = navigationFacts(track, { x: p.x, z: p.z, heading: p.heading, speed: 30 }, {});
  let items = d.update(facts, { lap: 1, totalLaps: 2, position: 3, fieldSize: 3, phase: 'racing' });
  assert.equal(items.filter((i) => /overtook/i.test(i.text)).length, 0, 'no overtake claim on the first report');

  items = d.update(facts, { lap: 1, totalLaps: 2, position: 3, previousPosition: 3, fieldSize: 3, phase: 'racing' });
  assert.equal(items.filter((i) => /overtook/i.test(i.text)).length, 0, 'no change, no claim');

  items = d.update(facts, { lap: 1, totalLaps: 2, position: 2, previousPosition: 3, fieldSize: 3, phase: 'racing' });
  const claim = items.filter((i) => /overtook/i.test(i.text));
  assert.equal(claim.length, 1, 'a real gain of position is announced');
  assert.match(claim[0].text, /second place/);
});

test('a lap is only announced when the lap count really increases', () => {
  const { d } = director();
  const p = g.pointAt(200);
  const facts = navigationFacts(track, { x: p.x, z: p.z, heading: p.heading, speed: 30 }, {});
  d.update(facts, { lap: 1, totalLaps: 2, position: 1, phase: 'racing' });
  let items = d.update(facts, { lap: 1, totalLaps: 2, position: 1, phase: 'racing' });
  assert.equal(items.filter((i) => /Lap \d+ of/.test(i.text)).length, 0, 'no lap claim while the lap is unchanged');
  items = d.update(facts, { lap: 2, totalLaps: 2, position: 1, phase: 'racing' });
  assert.equal(items.filter((i) => /Lap 2 of 2/.test(i.text)).length, 1);
});

test('off-track guidance is essential and repeats only after a pause', () => {
  const { d, tick } = director();
  const p = g.pointAt(600);
  const off = { x: p.x + Math.sin(p.heading) * 20, z: p.z + Math.cos(p.heading) * 20, heading: p.heading, speed: 8 };
  let items = d.update(navigationFacts(track, off, {}), { lap: 1, totalLaps: 2, phase: 'racing' });
  const first = items.filter((i) => i.key === 'offTrack');
  assert.equal(first.length, 1);
  assert.equal(first[0].essential, true, 'recovery guidance survives the master switch');
  assert.match(first[0].text, /left the track/);

  items = d.update(navigationFacts(track, off, {}), { lap: 1, totalLaps: 2, phase: 'racing' });
  assert.equal(items.filter((i) => i.key === 'offTrack').length, 0, 'it does not repeat immediately');
  tick(7000);
  items = d.update(navigationFacts(track, off, {}), { lap: 1, totalLaps: 2, phase: 'racing' });
  assert.equal(items.filter((i) => i.key === 'offTrack').length, 1, 'it repeats if you are still stuck');
});

test('opponents are announced with their real name, side and closing speed', () => {
  const { d, tick } = director();
  const p = g.pointAt(600);
  const facts = navigationFacts(track, { x: p.x, z: p.z, heading: p.heading, speed: 30 }, {});
  const opp = [{ id: 'ai0', name: 'Joseph', side: 'left', distanceM: 12, closingSpeedKph: 20 }];
  const items = d.update(facts, { lap: 1, totalLaps: 2, phase: 'racing' }, opp);
  const mention = items.filter((i) => /Joseph/.test(i.text));
  assert.equal(mention.length, 1);
  assert.match(mention[0].text, /Joseph approaching fast on your left/);
  tick(100);
  const again = d.update(facts, { lap: 1, totalLaps: 2, phase: 'racing' }, opp);
  assert.equal(again.filter((i) => /Joseph/.test(i.text)).length, 0, 'the same opponent does not nag');
});

test('concise speech shortens the wording', () => {
  const { d } = director({ conciseSpeech: true });
  const hairpin = track.zones.find((z) => z.id === 'zone.corner.hairpin');
  const p = g.pointAt(g.normaliseS(hairpin.from - 80));
  const items = d.update(navigationFacts(track, { x: p.x, z: p.z, heading: p.heading, speed: 25 }, {}), { lap: 1, totalLaps: 2, phase: 'racing' });
  const warn = items.find((i) => i.tag === 'corner');
  assert.ok(warn.concise.length < warn.text.length, `concise "${warn.concise}" is shorter than "${warn.text}"`);
});

test('the countdown lines are three, two, one and go', () => {
  const { d } = director();
  assert.equal(d.countdown(3).text, 'Three');
  assert.equal(d.countdown(2).text, 'Two');
  assert.equal(d.countdown(1).text, 'One');
  assert.equal(d.countdown(0).text, 'Go');
  assert.equal(d.countdown(0).essential, true);
});

// ------------------------------------------------------------------- physics

test('steering never moves the car sideways instantly', () => {
  const car = getCar('kestrel');
  const v = createVehicleState({ x: 0, z: 0, heading: 0, speed: fromKph(100) });
  const startZ = v.z;
  stepVehicle(v, { throttle: 1, brake: 0, steer: 1 }, car, 1 / 60, {});
  const firstFrameLateral = Math.abs(v.z - startZ);
  assert.ok(firstFrameLateral < 0.35, `one frame of full lock moves the car ${firstFrameLateral.toFixed(3)} m sideways, not metres`);

  // Over a second the car turns properly, and the front wheels ramp rather than snap.
  let maxSteerDelta = 0;
  let prev = 0;
  for (let i = 0; i < 60; i++) {
    stepVehicle(v, { throttle: 1, brake: 0, steer: 1 }, car, 1 / 60, {});
    maxSteerDelta = Math.max(maxSteerDelta, Math.abs(v.steer - prev));
    prev = v.steer;
  }
  assert.ok(maxSteerDelta < car.physics.maxSteerAngle, 'the wheel angle is rate limited');
  // At 100 km/h the achievable yaw rate is limited by tyre grip, not by the
  // steering rack, so a second of full lock turns the car by a few tenths of a
  // radian. That is the physically correct answer, not a sluggish one.
  assert.ok(v.heading > 0.15, `after a second of full lock the car has really turned (${v.heading.toFixed(2)} rad)`);
  const latG = Math.abs(v.yawRate * v.speed) / 9.81;
  assert.ok(latG <= car.physics.gripMu + 0.15, `lateral load ${latG.toFixed(2)} g stays inside the tyre limit`);
});

test('a car accelerates, reaches a top speed and stops within a sane distance', () => {
  const car = getCar('kestrel');
  const v = createVehicleState({ x: 0, z: 0, heading: 0 });
  let t = 0;
  let hundred = null;
  while (t < 40) {
    stepVehicle(v, { throttle: 1, brake: 0, steer: 0 }, car, 1 / 60, {});
    t += 1 / 60;
    if (hundred === null && toKph(v.speed) >= 100) hundred = t;
  }
  assert.ok(hundred > 5 && hundred < 16, `0-100 km/h in ${hundred.toFixed(1)} s`);
  const top = toKph(v.speed);
  assert.ok(top > 150 && top < car.physics.topSpeedKph + 8, `top speed ${top.toFixed(0)} km/h`);

  // Braking distance is measured from a controlled 100 km/h, not from top speed.
  const brake = createVehicleState({ x: 0, z: 0, heading: 0, speed: fromKph(100) });
  const brakeFrom = brake.distanceTravelled;
  let bt = 0;
  while (Math.abs(brake.speed) > 0.5 && bt < 20) {
    stepVehicle(brake, { throttle: 0, brake: 1, steer: 0 }, car, 1 / 60, {});
    bt += 1 / 60;
  }
  const stopping = brake.distanceTravelled - brakeFrom;
  assert.ok(stopping > 25 && stopping < 60, `100 km/h to a stop in ${stopping.toFixed(1)} m`);
});

test('grip is finite: the car cannot corner beyond its tyres', () => {
  const car = getCar('kestrel');
  const v = createVehicleState({ x: 0, z: 0, heading: 0, speed: fromKph(150) });
  for (let i = 0; i < 120; i++) stepVehicle(v, { throttle: 0.4, brake: 0, steer: 1 }, car, 1 / 60, {});
  const lateralG = Math.abs(v.lateralSlip);
  assert.ok(Number.isFinite(lateralG), 'slip stays finite');
  assert.ok(toKph(v.speed) < 155, 'the car scrubbed speed rather than holding an impossible line');
});

test('a barrier collision kills most of the speed and pushes the car away', () => {
  const v = createVehicleState({ x: 0, z: 0, heading: 0, speed: fromKph(120) });
  const before = v.speed;
  const res = applyCollision(v, { x: -1, z: 0 }, { now: 1 });
  assert.equal(res.impacted, true);
  assert.ok(res.impactSpeed > 20, 'the impact speed is reported');
  assert.ok(v.speed < before * 0.5, 'most of the speed is absorbed');
  assert.equal(v.collisionCount, 1);
  assert.ok(v.x < 0, 'the car was pushed off the barrier, not into it');
});

test('a collision from behind the normal does not fire', () => {
  const v = createVehicleState({ x: 0, z: 0, heading: 0, speed: fromKph(60) });
  const res = applyCollision(v, { x: 1, z: 0 }, {});
  assert.equal(res.impacted, false, 'driving away from a wall is not a collision');
});

test('respawn puts the car back on the track facing the right way', () => {
  const car = getCar('kestrel');
  const p = g.pointAt(1200);
  const v = createVehicleState({ x: p.x + 40, z: p.z - 25, heading: p.heading + 2.4, speed: 0 });
  const surfBefore = resolveSurface(track, v.x, v.z);
  assert.equal(surfBefore.offTrack, true);
  respawnOnTrack(v, track, 1200, {});
  const surfAfter = resolveSurface(track, v.x, v.z);
  assert.equal(surfAfter.offTrack, false, 'back on the track');
  assert.ok(Math.abs(surfAfter.lateral) < g.halfWidth, 'on the racing surface');
  const headingError = Math.abs(v.heading - g.pointAt(1200).heading);
  assert.ok(headingError < 0.01, 'facing the right way');
  assert.ok(v.speed > 0, 'released at a gentle speed rather than from a standstill');
  void car;
});

test('surfaces are distinguished: track, kerb, grass, gravel and pit lane', () => {
  const p = g.pointAt(300);
  const nx = Math.sin(p.heading);
  const nz = Math.cos(p.heading);
  const at = (lateral) => resolveSurface(track, p.x + nx * lateral, p.z + nz * lateral);
  assert.equal(at(0).surface, 'track');
  assert.equal(at(g.halfWidth - 0.2).surface, 'kerb');
  assert.equal(at(g.halfWidth + 3).surface, 'grass');
  assert.equal(at(g.halfWidth + 12).surface, 'gravel');
  const pitMid = track.pit.points[Math.floor(track.pit.points.length / 2)];
  assert.equal(resolveSurface(track, pitMid.x, pitMid.z).pitLane, true, 'the pit lane is recognised');
});

// ----------------------------------------------------------------------- AI

test('opponents stay on the circuit for a whole lap', () => {
  const level = getLevel(1);
  const slot = track.grid.find((s) => s.position === 1);
  const ai = createAiDriver({ track, car: getCar('kestrel'), start: slot, skill: 0.8, aggression: 0.4, id: 'ai0', name: 'Joseph' });
  let maxLateral = 0;
  let offTrackFrames = 0;
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 260; i++) {
    updateAiDriver(ai, dt, {
      track,
      speedScale: level.aiSpeedScale,
      rubberBand: 0,
      gripMultiplier: level.gripMultiplier,
      racers: [{ id: 'ai0', x: ai.x, z: ai.z }],
      player: null,
    });
    const near = g.nearest(ai.x, ai.z);
    maxLateral = Math.max(maxLateral, Math.abs(near.lateral));
    if (Math.abs(near.lateral) > g.halfWidth) offTrackFrames++;
    if (near.s < 40 && i > 60 * 60) break;
  }
  assert.ok(maxLateral < g.halfWidth + 2.5, `the AI stayed within ${maxLateral.toFixed(1)} m of the centre-line (half width ${g.halfWidth})`);
  // Brief kerb-riding is normal racing; what matters is that it recovers and
  // never reaches the barrier or stays off for long.
  assert.ok(offTrackFrames < 150, `only ${offTrackFrames} frames off track`);
  assert.ok(maxLateral < g.halfWidth + 9.5, 'and it never reached the barrier line');
});

test('an opponent completes a validated lap in the race state', () => {
  const level = getLevel(1);
  const race = makeRace({ totalLaps: 1 });
  race.phase = RACE_PHASE.RACING;
  const ai = createAiDriver({
    track,
    car: getCar('metro-gt'),
    start: race.racers.find((r) => r.id === 'ai1'),
    skill: 0.85,
    aggression: 0.4,
    id: 'ai1',
    name: 'Mithin',
  });
  const dt = 1 / 60;
  let finished = null;
  for (let i = 0; i < 60 * 400; i++) {
    race.elapsed += dt;
    updateAiDriver(ai, dt, {
      track,
      speedScale: level.aiSpeedScale,
      rubberBand: level.rubberBand,
      gripMultiplier: level.gripMultiplier,
      racers: race.racers.map((r) => ({ id: r.id, x: r.x, z: r.z })),
      player: race.player,
    });
    const surf = resolveSurface(track, ai.x, ai.z);
    const events = updateRacer(race, 'ai1', { x: ai.x, z: ai.z, s: surf.near.s, speed: ai.speed, heading: ai.heading });
    ai.lapsCompleted = race.racers.find((r) => r.id === 'ai1').lapsCompleted;
    const f = events.find((e) => e.type === 'finish');
    if (f) {
      finished = f;
      break;
    }
  }
  assert.ok(finished, 'the opponent finished the lap under checkpoint validation');
  assert.equal(finished.position, 1);
  assert.ok(race.elapsed < 300, `it took ${race.elapsed.toFixed(0)} s, which is a plausible lap`);
  assert.ok(race.elapsed > 60, 'and it was not impossibly fast');
});

test('opponents do not occupy the same space as each other', () => {
  const racers = [
    { id: 'a', x: 0, z: 0, speed: 20, state: { speed: 20 } },
    { id: 'b', x: 1.2, z: 0, speed: 20, state: { speed: 20 } },
  ];
  separateRacers(racers, 3.4);
  const d = Math.hypot(racers[1].x - racers[0].x, racers[1].z - racers[0].z);
  assert.ok(d >= 3.39, `separated to ${d.toFixed(2)} m`);
  assert.ok(racers[0].state.speed < 20, 'contact cost both cars a little speed');
});

test('rubber banding keeps a beginner race close without making the AI cheat', () => {
  const level = getLevel(1);
  assert.ok(level.rubberBand > 0.4, 'level one rubber-bands strongly so it is winnable');
  assert.ok(level.gripMultiplier > 1, 'level one gives the player extra grip');
  assert.ok(level.steeringAssist > 0, 'level one assists steering');
  const harder = getLevel(4);
  assert.ok(harder.rubberBand < level.rubberBand, 'later levels assist less');
  assert.equal(harder.steeringAssist, 0, 'the top level has no steering assist');
  assert.ok(harder.opponents.length > level.opponents.length, 'later levels have more opponents');
  assert.ok(harder.laps > level.laps, 'later levels are longer');
  assert.equal(PRACTICE_LEVEL.opponents.length, 0, 'practice is empty');
});

test('opponent proximity is measured, not invented', () => {
  const race = makeRace({ totalLaps: 1 });
  race.phase = RACE_PHASE.RACING;
  // Put an opponent 9 m behind the player and another 400 m away.
  const p = race.player;
  const near = race.racers.find((r) => r.id === 'ai0');
  const far = race.racers.find((r) => r.id === 'ai1');
  near.x = p.x - Math.cos(p.heading) * 9;
  near.z = p.z + Math.sin(p.heading) * 9;
  far.x = p.x + 400;
  far.z = p.z + 400;
  const close = opponentsNearPlayer(race, relativeBearing, 40);
  assert.equal(close.length, 1, 'only the nearby opponent is reported');
  assert.equal(close[0].name, 'Joseph');
  assert.ok(close[0].distanceM < 12);
  assert.equal(close[0].side, 'behind');
});

// ------------------------------------------------------------------ car pace

test('withPace scales speed and acceleration but leaves handling alone', async () => {
  const { withPace } = await import('../src/vehicles/physics.js');
  const { availableCars } = await import('../src/vehicles/carCatalog.js');
  const car = availableCars()[0];
  const slow = withPace(car, 0.8);
  const fast = withPace(car, 1.18);

  assert.ok(Math.abs(slow.physics.topSpeedKph - car.physics.topSpeedKph * 0.8) < 1e-9);
  assert.ok(Math.abs(fast.physics.topSpeedKph - car.physics.topSpeedKph * 1.18) < 1e-9);
  assert.ok(Math.abs(slow.physics.peakTorqueNm - car.physics.peakTorqueNm * 0.8) < 1e-9, 'acceleration must scale too, or "slower" only means a lower top speed');
  assert.ok(Math.abs(slow.physics.peakPowerKw - car.physics.peakPowerKw * 0.8) < 1e-9);

  // Handling is what makes one car different from another, so the pace setting
  // must not touch it.
  for (const field of ['gripMu', 'mass', 'wheelbase', 'maxSteerAngle', 'steerRate']) {
    assert.equal(slow.physics[field], car.physics[field], `${field} should not change with pace`);
  }
  assert.deepEqual(slow.physics.gearRatios, car.physics.gearRatios, 'gearing should not change');
  assert.equal(slow.id, car.id, 'the catalogue identity must survive, so the chosen car is still the raced car');
});

test('withPace does not mutate its input, and is a no-op at scale 1', async () => {
  const { withPace } = await import('../src/vehicles/physics.js');
  const { availableCars } = await import('../src/vehicles/carCatalog.js');
  const car = availableCars()[0];
  const before = car.physics.topSpeedKph;

  assert.equal(withPace(car, 1), car, 'scale 1 should return the same object, not a copy');
  withPace(car, 0.8);
  assert.equal(car.physics.topSpeedKph, before, 'the catalogue car must be untouched');

  // A nonsense scale must not produce a car that cannot move.
  for (const bad of [0, -1, NaN, Infinity, undefined]) {
    assert.equal(withPace(car, bad), car, `scale ${String(bad)} should be ignored`);
  }
});

test('a slower pace genuinely produces a slower car over a run', async () => {
  const { createVehicleState, stepVehicle, withPace, toKph } = await import('../src/vehicles/physics.js');
  const { availableCars } = await import('../src/vehicles/carCatalog.js');
  const car = availableCars()[0];

  const run = (scale) => {
    const paced = withPace(car, scale);
    const v = createVehicleState({ x: 0, z: 0, heading: 0 });
    for (let i = 0; i < 60 * 12; i += 1) {
      stepVehicle(v, { throttle: 1, brake: 0, steer: 0 }, paced, 1 / 60, {});
    }
    return toKph(v.speed);
  };

  const slow = run(0.8);
  const normal = run(1);
  const fast = run(1.18);
  assert.ok(slow < normal, `slower pace should reach a lower speed: ${slow.toFixed(1)} vs ${normal.toFixed(1)} kph`);
  assert.ok(normal < fast, `faster pace should reach a higher speed: ${normal.toFixed(1)} vs ${fast.toFixed(1)} kph`);
  assert.ok(slow > 10, 'a slower pace must still be a moving car, not a crawl');
});

test('the race start announcement is derived from the real lap count', async () => {
  // This line used to read "Race started. Two laps to go." on every race,
  // including the three and four lap ones. A player who cannot see the lap board
  // would plan the whole race around a number that was wrong, so the guard is on
  // the source: the announcement has to come from race.totalLaps.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/race/raceScreen.js', import.meta.url), 'utf8');
  assert.ok(!/Two laps to go/.test(src), 'no hardcoded lap count in the start announcement');
  assert.match(src, /intToWords\(laps\)/, 'the lap count should be spoken as words');
  assert.match(src, /race\.totalLaps/, 'and taken from the race state');
  assert.match(src, /raceLapsFor\(level/, 'the lap count should honour the Race length setting');
});

test('the lap count reaches the race, the lap board and the finish line together', async () => {
  const { createRace } = await import('../src/race/raceState.js');
  const { raceLapsFor } = await import('../src/a11y/settings.js');
  const { getTrack } = await import('../src/world/trackData.js');
  const track = getTrack();
  const entrants = [{ id: 'player', car: { physics: { topSpeedKph: 180 } }, gridPosition: 1 }];

  for (const id of ['default', 'one', 'five']) {
    const laps = raceLapsFor({ laps: 3 }, id);
    const race = createRace({ track, totalLaps: laps, entrants });
    assert.equal(race.totalLaps, laps, `race length "${id}" should reach the race state`);
    assert.ok(race.totalLaps >= 1);
  }
});

test('the grid briefing states the real lap count and every control', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/race/raceScreen.js', import.meta.url), 'utf8');

  // It said "Three laps" on every race, which the Race length setting makes
  // plainly wrong, and it omitted reverse and how to leave a race.
  assert.match(src, /function controlBriefing/, 'the controls should be written down in one place');
  assert.match(src, /race\.totalLaps/, 'the briefing must state the real distance');

  const briefing = src.slice(src.indexOf('function controlBriefing'), src.indexOf('function startCountdown'));
  // Scoped to the briefing body, so the comment above it explaining this history
  // cannot satisfy or trip the check.
  assert.ok(!/Three laps/.test(briefing), 'no hardcoded lap count in the briefing itself');
  assert.match(briefing, /intToWords\(laps\)/, 'the lap count should be spoken as words');
  for (const [what, re] of [
    ['how to accelerate', /Hold your finger/],
    ['how to coast', /[Rr]elease to coast/],
    ['how to brake', /Tap twice/],
    ['how to steer', /Drag left or right/],
    ['how to turn around', /circle/i],
    ['how to reverse', /Swipe down to reverse/],
    ['how to leave the race', /leave the race/],
  ]) {
    assert.match(briefing, re, `the briefing must tell the player ${what}`);
  }
});

test('the countdown waits for the briefing instead of cutting it off', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/race/raceScreen.js', import.meta.url), 'utf8');
  // The briefing used to be spoken from inside startCountdown, so "Three"
  // interrupted it about a second in and the player never heard the controls.
  const countdown = src.slice(src.indexOf('function startCountdown'), src.indexOf('function tickCountdown'));
  assert.ok(!/Hold your finger/.test(countdown), 'the briefing must not be spoken from inside the countdown');
  assert.match(src, /awaitingBriefing/, 'the countdown should wait for the briefing to finish');
  assert.match(src, /GRID_MAX_WAIT/, 'and be bounded so a stuck speech engine cannot hang the start');
  assert.match(src, /speech\?\.queue\?\.isSpeaking/, 'the wait should be driven by the real speech queue');
});
