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

import { createDrivingInput, DRIVING_ZONE, REVERSE_MAX_DX, isDownLeftSwipe } from '../src/input/drivingInput.js';
import { createAnnouncementDirector, navigationFacts } from '../src/race/navigation.js';
import { createGestureRecognizer, GESTURE_DEFAULTS } from '../src/input/gestures.js';
import { createZoneMap } from '../src/ui/screens.js';
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
  // The menu gesture is any clear diagonal into the down-left quadrant - the
  // old 60 px-on-one-axis rule missed real fingers and the menu "didn't work".
  assert.ok(isDownLeftSwipe({ dx: -40, dy: 120 }), 'a mostly-down swipe leaning left opens the menu');
  assert.ok(isDownLeftSwipe({ dx: -120, dy: 40 }), 'a mostly-left swipe dipping down opens the menu');
  assert.ok(!isDownLeftSwipe({ dx: -10, dy: 200 }), 'a straight-down swipe is reverse, not the menu');
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

// -------------------------------------------- taps that wobble must still brake

test('a tap that wobbles less than a swipe still resolves as a tap', () => {
  // The play-test root cause: a real thumb drifts, and past tapMaxDistPx the
  // contact was classified as a drag, which DROPPED the tap - so the brake
  // never fired and only "Accelerating" was ever heard.
  const events = [];
  let t = 0;
  const r = createGestureRecognizer({ now: () => t, emit: (e) => events.push(e) });
  // ~29 px of drift: more than tapMaxDistPx (a drag started), but below
  // swipeMinPx, so it is a tap with a wobble - and the dragEnd that re-centres
  // the steering still fires.
  r.pointerDown(1, 100, 100, { id: 'drivingSurface', role: 'driving', hold: true, immediateTap: true });
  t += 40;
  r.pointerMove(1, 128, 106);
  t += 40;
  r.pointerUp(1, 128, 106);
  assert.ok(events.includes('tap'), 'the wobbled tap must still resolve as a tap');
  assert.ok(events.includes('dragEnd'), 'steering must still re-centre');
  assert.ok(!events.includes('swipe'), 'and it must not become a swipe');
  assert.ok(GESTURE_DEFAULTS.tapMaxDistPx < GESTURE_DEFAULTS.swipeMinPx, 'a tap window must fit inside the swipe threshold');
});

test('the brake tap fires the moment the finger lifts, not after a window', () => {
  const events = [];
  let t = 0;
  const r = createGestureRecognizer({ now: () => t, emit: (e) => events.push(e) });
  r.pointerDown(1, 100, 100, { id: 'drivingSurface', role: 'driving', hold: true, immediateTap: true });
  t += 60;
  r.pointerUp(1, 100, 100);
  // No advance(): the tap must already be out. A delayed brake is a dead brake.
  assert.ok(events.includes('tap'), 'tap must fire on release with no timer wait');
});

// ------------------------------------------------- the quick menu is global

test('the quick menu opens from anywhere and carries the common items', () => {
  assert.ok(mainSrc.includes('openQuickMenu'), 'there must be a quick menu');
  assert.ok(mainSrc.includes('isDownLeftSwipe(d)'), 'the down-and-left swipe must open it');
  for (const label of [
    'Go back and close this menu',
    'Where am I',
    'Coins',
    'Experience level',
    'Game TalkBack settings',
    'How to play',
    'Cars garage',
    'Main menu',
    'Exit game',
  ]) {
    assert.ok(mainSrc.includes(label), `the quick menu must offer "${label}"`);
  }
});

test('menu panels are hit-tested and never eat the swipes', () => {
  // The panel must sit under the gesture layer (pointer-events: none) and be
  // operated through the zone map - the old design pressed whatever button
  // happened to be focused instead of the one under the finger.
  const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
  assert.ok(/\.race-overlay \.pause-panel[\s\S]*?pointer-events:\s*none/.test(css), 'the panel must not take pointer events');
  assert.ok(mainSrc.includes('panelZoneMap = createZoneMap(panel'), 'the panel buttons must be hit-tested');
});

test('zone hit-testing re-measures after a scroll', () => {
  // Stale rectangles after scrolling a menu made taps land where a button used
  // to be: "back button repair button single typing not working".
  let buttonRect = { left: 10, top: 10, right: 110, bottom: 50 };
  const button = {
    getBoundingClientRect: () => buttonRect,
    dataset: { zone: 'btn-test', zoneRole: 'menu' },
  };
  const origin = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const container = {
    querySelectorAll: () => [button],
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const map = createZoneMap(container, null, origin);
  map.rebuild();
  assert.equal(map.zoneAt(60, 30)?.element, button, 'the button is hittable at its first position');
  // The menu scrolls: the button moves up 200 px.
  buttonRect = { left: 10, top: -190, right: 110, bottom: -150 };
  map.markDirty();
  assert.equal(map.zoneAt(60, -170)?.element, button, 'after a scroll the tap lands on the button again');
  assert.equal(map.zoneAt(60, 30), null, 'and the old position is no longer hittable');
});

// --------------------------------------- feedback must not lie about state

test('a brake tap is never told it is accelerating', () => {
  // Every touch fires pressStart; the throttle line must wait for a sustained
  // hold, or taps hear "Accelerating" and nothing else.
  assert.ok(raceScreenSrc.includes('TALK_HOLD_SECONDS'), 'the throttle line must wait for a sustained hold');
  assert.ok(raceScreenSrc.includes("'Brake.'"), 'the brake edge is still talked back');
});
