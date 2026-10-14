/**
 * Playability fixes from the play-test: the things that made the game
 * unplayable in real hands. Each test here locks one of them down.
 *
 * 1. Direction talk must be COMMANDS ("Steer right to get back on the line"),
 *    never bare observations ("You are going right") - players were steering
 *    into the barriers because the observation sounded like an instruction.
 * 2. Turning must be coached: "steer X now" at the corner and, afterwards,
 *    "let go of the steering, it straightens itself, accelerate".
 * 3. Braking must announce ("Brake") for the tap AND the double tap.
 * 4. The race menu must exist with the items the player asked for, reachable
 *    by the down-and-left swipe.
 * 5. A down-and-left swipe must NOT reverse the car.
 * 6. Rain must come with working wipers and the spoken line.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createDrivingInput, DRIVING_ZONE, REVERSE_MAX_DX } from '../src/input/drivingInput.js';
import { createAnnouncementDirector, navigationFacts } from '../src/race/navigation.js';
import { getTrack } from '../src/world/trackData.js';

const raceScreenSrc = readFileSync(new URL('../src/race/raceScreen.js', import.meta.url), 'utf8');
const navigationSrc = readFileSync(new URL('../src/race/navigation.js', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

// ------------------------------------------------------- direction wording

test('direction announcements are corrective commands, not observations', () => {
  // The crash-loop root cause: "You are going right" is heard as "steer right".
  // The SPOKEN literals must be gone (comments may still explain the geometry).
  assert.ok(!raceScreenSrc.includes("'You are going left.'"), 'the ambiguous observation form must be gone');
  assert.ok(!raceScreenSrc.includes("'You are going right.'"), 'the ambiguous observation form must be gone');
  assert.ok(raceScreenSrc.includes('Steer right to get back on the line.'), 'left of the line must be corrected with steer right');
  assert.ok(raceScreenSrc.includes('Steer left to get back on the line.'), 'right of the line must be corrected with steer left');
  assert.ok(raceScreenSrc.includes('Turn the car around.'), 'reversing must be met with a command');
});

test('braking is announced on every press', () => {
  // "the brake should announce" - the press feedback line must say Brake.
  assert.ok(raceScreenSrc.includes("'Brake.'"), 'the brake press must be talked back');
  assert.ok(raceScreenSrc.includes("'Handbrake.'"), 'the handbrake press must be talked back too');
});

// ------------------------------------------------------ turning is coached

test('the director coaches turn-in and the straighten-up afterwards', () => {
  const track = getTrack();
  const g = track.geometry;
  const director = createAnnouncementDirector({ getSettings: () => ({ talkback: true }), now: () => t });
  let t = 0;

  const corner = track.zones.find((z) => z.id === 'zone.corner.t1');
  assert.ok(corner, 'the first corner should exist');

  // Approach from the preceding braking zone: one frame there, one inside the
  // corner. The corner frame must say when to steer and which way.
  const brakeSpot = g.pointAt(g.normaliseS(corner.from - 60));
  director.update(navigationFacts(track, { x: brakeSpot.x, z: brakeSpot.z, heading: brakeSpot.heading, speed: 30 }, {}), { lap: 1, totalLaps: 2, phase: 'racing' });

  const inside = g.pointAt(g.normaliseS(corner.from + 12));
  t += 100;
  const items = director.update(navigationFacts(track, { x: inside.x, z: inside.z, heading: inside.heading, speed: 30 }, {}), { lap: 1, totalLaps: 2, phase: 'racing' });
  const turnIn = items.find((i) => String(i.key ?? '').startsWith('turnin.'));
  assert.ok(turnIn, 'entering a corner must produce a turn-in call');
  assert.match(turnIn.text, /Steer (left|right) now/);

  // Leaving the corner for the next straight must produce the after-turn
  // coaching the player asked for: let go, the wheel centres, accelerate.
  const straightSpot = g.pointAt(g.normaliseS(corner.to + 25));
  t += 100;
  const exitItems = director.update(navigationFacts(track, { x: straightSpot.x, z: straightSpot.z, heading: straightSpot.heading, speed: 30 }, {}), { lap: 1, totalLaps: 2, phase: 'racing' });
  const exit = exitItems.find((i) => String(i.key ?? '').startsWith('exit.'));
  assert.ok(exit, 'leaving a corner must produce the straighten-up call');
  assert.match(exit.text, /Let go of the steering/);
  assert.match(exit.text, /accelerate/i);
});

test('brake-now tells the driver what comes after braking', () => {
  assert.ok(navigationSrc.includes('Then steer'), 'the brake call must say what to do next');
});

// ------------------------------------------------------------ the race menu

test('the race menu carries the items the player asked for', () => {
  for (const label of [
    'Where am I on the track',
    'Coins',
    'Experience level',
    'Repair',
    'Go for a wash',
    'Petrol',
    'Game TalkBack settings',
    'Cars garage',
    'How to play',
    'Go back and resume the race',
    'Main menu',
    'Exit game',
  ]) {
    assert.ok(mainSrc.includes(label), `the race menu must offer "${label}"`);
  }
  // The menu is reachable by the down-and-left swipe and the race pauses behind it.
  assert.ok(mainSrc.includes("pauseRace('race-menu')"), 'the swipe must open the race menu');
});

test('the controls summaries teach the play-tested mapping', () => {
  for (const src of [raceScreenSrc, mainSrc]) {
    assert.ok(/Tap once/.test(src) && /brake/i.test(src), 'tap = brake');
    assert.ok(/Double tap and hold/i.test(src), 'double-tap-and-hold = handbrake');
    assert.ok(/let go of the steering/i.test(src), 'after-turn coaching');
    assert.ok(/down and left/i.test(src), 'the menu swipe');
  }
});

// ------------------------------------------------- reverse vs the menu swipe

// drivingInput subscribes to the singleton bus, so both behaviour tests share
// ONE instance and drive it with real bus events.
const bus = (await import('../src/core/bus.js')).bus;
const di = createDrivingInput({});

test('a down-and-left swipe does not reverse, a straight-down swipe does', () => {
  // Down and left: the menu gesture. dx is well past the reverse guard.
  assert.ok(REVERSE_MAX_DX < 100, 'the guard must reject strongly-leftward swipes');
  bus.emit('gesture:swipe', { zone: DRIVING_ZONE, direction: 'down', dx: -140, dy: 220 });
  assert.ok(!di.state.reversing, 'the menu swipe must not throw the car into reverse');

  // Straight down: reverse.
  bus.emit('gesture:swipe', { zone: DRIVING_ZONE, direction: 'down', dx: -10, dy: 220 });
  assert.ok(di.state.reversing > 0, 'a straight-down swipe reverses');
  di.state.reversing = 0;
});

test('double tap brakes and double-tap-and-hold drifts, through the bus', () => {
  bus.emit('gesture:doubleTap', { zone: DRIVING_ZONE });
  assert.equal(di.state.brake, 1, 'a quick double tap brakes');
  assert.equal(di.state.handbrake, false, 'a quick double tap is not the handbrake');
  di.state.brake = 0;
  di.state.braking = false;

  bus.emit('gesture:doubleTapHold', { zone: DRIVING_ZONE });
  assert.equal(di.state.handbrake, true, 'the hold pulls the handbrake');
});

// --------------------------------------------------------------- rain/wipers

test('rain comes with working wipers and is spoken', () => {
  assert.ok(raceScreenSrc.includes("S.weather = 'rain'"), 'rain must be real game state');
  assert.ok(/audio\?\.loop\('rain'/.test(raceScreenSrc) && /audio\?\.loop\('wiper'/.test(raceScreenSrc), 'rain and wipers must actually play');
  assert.ok(raceScreenSrc.includes('Light rain. The wipers are on.'), 'the weather must be announced');
  assert.ok(raceScreenSrc.includes('forceRain'), 'tests must be able to force the weather');
});
