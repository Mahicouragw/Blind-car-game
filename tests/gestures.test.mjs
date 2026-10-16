/**
 * Gesture recogniser tests.
 *
 * Every conflict-resolution rule documented at the top of src/input/gestures.js
 * is asserted here, because these rules are the difference between an
 * accessible game and an unusable one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestureRecognizer, GESTURE_DEFAULTS } from '../src/input/gestures.js';

/** Virtual-clock harness: no real timers, fully deterministic. */
function harness(opts = {}) {
  let t = 0;
  const events = [];
  const g = createGestureRecognizer({
    now: () => t,
    emit: (event, payload) => events.push({ event, ...payload }),
    ...opts,
  });
  const api = {
    g,
    events,
    names: () => events.map((e) => e.event),
    last: (n = 1) => events.slice(-n),
    count: (name) => events.filter((e) => e.event === name).length,
    find: (name) => events.find((e) => e.event === name),
    advance(ms) {
      t += ms;
      g.tick();
    },
    down(x, y, zone, dt = 0) {
      t += dt;
      g.pointerDown(1, x, y, zone);
      g.tick();
    },
    move(x, y, dt = 0) {
      t += dt;
      g.pointerMove(1, x, y);
      g.tick();
    },
    up(x, y, dt = 0) {
      t += dt;
      g.pointerUp(1, x, y);
      g.tick();
    },
    tapAt(x, y, zone, holdMs = 40) {
      api.down(x, y, zone);
      api.up(x, y, holdMs);
    },
  };
  return api;
}

const DRIVE = { id: 'drivingSurface', role: 'drive' };
const MENU = { id: 'menu', role: 'menu', immediateTap: true };
const ACCEL = { id: 'accelerate', role: 'accelerate', hold: true };
const SETTINGS = { id: 'settingsHotspot', role: 'settings', doubleTapHoldTarget: true };
const STEER = { id: 'steerPad', role: 'steer' };

// --------------------------------------------------------------------- R2/R3

test('single tap activates immediately on an immediateTap zone (menus)', () => {
  const h = harness();
  h.down(100, 100, MENU);
  h.up(100, 100, 40);
  assert.deepEqual(h.names(), ['tap']);
  // `zone` is the zone OBJECT and `zoneId` the string. Every consumer reads
  // d.zone.role, so emitting the id here is what broke the driving gestures.
  const tap = h.find('tap');
  assert.equal(tap.zoneId, 'menu');
  assert.equal(tap.zone.id, 'menu');
  assert.equal(tap.zone.role, 'menu');
});

test('single tap waits out the double-tap window on the driving surface', () => {
  const h = harness();
  h.down(100, 100, DRIVE);
  h.up(100, 100, 40);
  assert.equal(h.count('tap'), 0, 'must not fire before the window closes');
  h.advance(GESTURE_DEFAULTS.doubleTapWindowMs + 10);
  assert.equal(h.count('tap'), 1);
});

test('double tap on the driving surface brakes once, and never emits a tap', () => {
  const h = harness();
  h.tapAt(100, 100, DRIVE, 40);
  h.down(102, 101, DRIVE, 90);
  h.up(102, 101, 40);
  h.advance(GESTURE_DEFAULTS.doubleTapWindowMs + 50);
  assert.equal(h.count('doubleTap'), 1, 'exactly one brake');
  assert.equal(h.count('tap'), 0, 'the first tap must be swallowed');
});

test('a third tap in the window becomes tripleTap, not a second brake (R6)', () => {
  const h = harness();
  h.tapAt(100, 100, DRIVE, 40);
  h.tapAt(101, 100, DRIVE, 90);
  h.tapAt(100, 101, DRIVE, 90);
  h.advance(GESTURE_DEFAULTS.doubleTapWindowMs + 50);
  assert.equal(h.count('tripleTap'), 1);
  assert.equal(h.count('doubleTap'), 1, 'the brake from taps 1-2 still happened');
  assert.equal(h.count('tap'), 0);
});

// The Start Race control is deliberately NOT an immediateTap zone, so its tap
// only resolves after the double-tap window. That is what makes requirement 12
// ("three repeated taps must not accidentally start a race") structurally true.
const GUARDED = { id: 'startRaceControl', role: 'activate', immediateTap: false };

test('three rapid taps on a guarded control never activate it (R6)', () => {
  const h = harness();
  for (let i = 0; i < 3; i++) h.tapAt(200 + i, 200, GUARDED, 30);
  h.advance(GESTURE_DEFAULTS.doubleTapWindowMs * 2);
  assert.equal(h.count('tripleTap'), 1);
  assert.equal(h.count('tap'), 0, 'no activation leaked through three rapid taps');
});

test('three rapid taps on an immediate menu report tapSuperseded so the UI can undo', () => {
  const h = harness();
  for (let i = 0; i < 3; i++) h.tapAt(200 + i, 200, MENU, 30);
  h.advance(500);
  assert.equal(h.count('tap'), 1, 'the first tap fires immediately for responsiveness');
  assert.equal(h.count('tapSuperseded'), 1, '...and is then explicitly retracted');
  assert.equal(h.count('tripleTap'), 1);
});

// --------------------------------------------------------------- R4 (settings)

test('double-tap-and-hold on the settings hotspot opens settings and suppresses brake', () => {
  const h = harness();
  h.tapAt(60, 60, SETTINGS, 40);
  h.down(61, 60, SETTINGS, 90);
  h.advance(GESTURE_DEFAULTS.doubleTapHoldMs + 20);
  assert.equal(h.count('doubleTapHold'), 1);
  assert.equal(h.count('doubleTap'), 0, 'brake must NOT fire with settings');
  assert.equal(h.g.isBrakeSuppressed, true);
  h.up(61, 60, 10);
  h.advance(600);
  assert.equal(h.count('doubleTap'), 0, 'still no brake after release');
});

test('a quick double tap on the settings hotspot is still a brake, not settings', () => {
  const h = harness();
  h.tapAt(60, 60, SETTINGS, 40);
  h.down(61, 60, SETTINGS, 90);
  h.up(61, 60, 60); // released well before doubleTapHoldMs
  h.advance(GESTURE_DEFAULTS.doubleTapWindowMs + 50);
  assert.equal(h.count('doubleTapHold'), 0);
  assert.equal(h.count('doubleTap'), 1);
});

test('a hold that starts after a completed double tap is a long press, not settings (R5)', () => {
  const h = harness();
  h.tapAt(60, 60, SETTINGS, 40);
  h.down(61, 60, SETTINGS, 60);
  h.up(61, 60, 40); // double tap completes here
  h.advance(GESTURE_DEFAULTS.doubleTapWindowMs + 100);
  assert.equal(h.count('doubleTap'), 1);
  // Now a fresh, separate long hold.
  h.down(60, 60, SETTINGS);
  h.advance(GESTURE_DEFAULTS.longPressMs + 20);
  assert.equal(h.count('longPressStart'), 1);
  assert.equal(h.count('doubleTapHold'), 0, 'settings must not re-open');
  h.up(60, 60, 10);
});

// ------------------------------------------------------------- R4/R5 (hold)

test('press and hold on the accelerate pad starts on contact and ends on release', () => {
  const h = harness();
  h.down(300, 400, ACCEL);
  assert.equal(h.count('pressStart'), 1, 'no threshold delay for throttle');
  h.advance(1200);
  assert.equal(h.count('pressEnd'), 0);
  h.up(300, 400, 10);
  assert.equal(h.count('pressEnd'), 1);
  assert.ok(h.find('pressEnd').durationMs >= 1200);
});

test('releasing the accelerate pad after a very short touch still reports pressEnd', () => {
  const h = harness();
  h.down(300, 400, ACCEL);
  h.up(300, 400, 30);
  assert.deepEqual(h.names().filter((n) => n.startsWith('press')), ['pressStart', 'pressEnd']);
});

test('long press fires once after the threshold and ends on release', () => {
  const h = harness();
  h.down(150, 150, MENU);
  h.advance(GESTURE_DEFAULTS.longPressMs - 20);
  assert.equal(h.count('longPressStart'), 0);
  h.advance(40);
  assert.equal(h.count('longPressStart'), 1);
  h.up(150, 150, 10);
  assert.equal(h.count('longPressEnd'), 1);
  assert.equal(h.count('tap'), 0, 'a long press is not a tap');
});

// ---------------------------------------------------------------------- swipes

test('swipe right and left are reported with direction and distance', () => {
  const h = harness();
  h.down(100, 300, MENU);
  h.move(220, 305, 90);
  h.up(220, 305, 10);
  const s = h.find('swipe');
  assert.equal(s.direction, 'right');
  assert.ok(s.dist > GESTURE_DEFAULTS.swipeMinPx);

  const h2 = harness();
  h2.down(300, 300, MENU);
  h2.move(180, 296, 90);
  h2.up(180, 296, 10);
  assert.equal(h2.find('swipe').direction, 'left');
});

test('swipe up and down navigate menus', () => {
  const up = harness();
  up.down(200, 400, MENU);
  up.move(198, 260, 90);
  up.up(198, 260, 10);
  assert.equal(up.find('swipe').direction, 'up');

  const down = harness();
  down.down(200, 200, MENU);
  down.move(203, 350, 90);
  down.up(203, 350, 10);
  assert.equal(down.find('swipe').direction, 'down');
});

test('a drag beyond the tap threshold never produces a tap (R1 steering safety)', () => {
  const h = harness();
  h.down(150, 300, STEER);
  h.move(190, 302, 40);
  h.move(230, 305, 40);
  h.up(230, 305, 20);
  assert.equal(h.count('tap'), 0);
  assert.equal(h.count('doubleTap'), 0);
  assert.ok(h.names().includes('dragStart'));
  assert.ok(h.names().includes('drag'));
  assert.ok(h.names().includes('swipe'));
});

test('drag deltas are reported continuously for gradual steering', () => {
  const h = harness();
  h.down(100, 300, STEER);
  for (let i = 1; i <= 6; i++) h.move(100 + i * 14, 300, 16);
  const drags = h.events.filter((e) => e.event === 'drag');
  // The first move (14 px) is inside tapMaxDistPx so it is still a candidate
  // tap; dragging starts on the second move, which also reports its own delta.
  assert.equal(drags.length, 5);
  assert.equal(drags[0].dx, 28);
  assert.equal(drags[drags.length - 1].dx, 84);
  assert.ok(drags.every((d) => d.dx > 0), 'steering direction is monotonic here');
});

test('a small finger wobble still counts as a tap, not a drag', () => {
  const h = harness();
  h.down(100, 100, MENU);
  h.move(108, 104, 30); // inside tapMaxDistPx = 16
  h.up(108, 104, 30);
  assert.equal(h.count('tap'), 1);
  assert.equal(h.count('dragStart'), 0);
});

test('a drag in a menu is a SWIPE - it must never tap the item the drag started on', () => {
  // The play-test: "when I move the cursor to chapter two it still reads
  // chapter one... I try to drag right and it always hits something else."
  // A 24-34 px drag used to be rescued into a tap on the button under the
  // finger - the item the player was LEAVING.
  const h = harness();
  h.down(100, 100, MENU);
  h.move(130, 106, 40); // ~31 px: past tapMaxDistPx, under swipeMinPx
  h.up(130, 106, 40);
  assert.equal(h.count('tap'), 0, 'a drag must never resolve as a tap in a menu');
  assert.equal(h.count('swipe'), 1, 'it is the swipe the player meant');
  assert.equal(h.find('swipe').direction, 'right');
});

test('a slow deliberate drag still swipes in a menu', () => {
  // Menu items are dragged at the player's own pace, not flicked. Only the
  // driving surface keeps the 900 ms flick rule (steering, reverse).
  const h = harness();
  h.down(100, 100, MENU);
  h.move(100, 160, 2500); // 60 px down, over two and a half seconds
  h.up(100, 160, 2500);
  assert.equal(h.count('swipe'), 1, 'a slow drag is still a swipe');
  assert.equal(h.find('swipe').direction, 'down');
  assert.equal(h.count('tap'), 0);
});

// ---------------------------------------------------------------------- circle

function traceCircle(h, cx, cy, r, zone, steps = 40, stepMs = 12) {
  h.down(cx + r, cy, zone);
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    h.move(cx + r * Math.cos(a), cy + r * Math.sin(a), stepMs);
  }
  h.up(cx + r, cy, stepMs);
}

test('a circular swipe is recognised with its direction (R7)', () => {
  const h = harness();
  traceCircle(h, 200, 300, 70, STEER);
  const c = h.find('circle');
  assert.ok(c, 'circle gesture should be recognised');
  assert.equal(c.direction, 'clockwise');
  assert.ok(Math.abs(c.turnDeg) >= GESTURE_DEFAULTS.circleMinTurnDeg);
});

test('an anticlockwise circle is reported as anticlockwise', () => {
  const h = harness();
  h.down(270, 300, STEER);
  for (let i = 1; i <= 40; i++) {
    const a = -(i / 40) * Math.PI * 2;
    h.move(200 + 70 * Math.cos(a), 300 + 70 * Math.sin(a), 12);
  }
  h.up(270, 300, 12);
  assert.equal(h.find('circle').direction, 'anticlockwise');
});

test('a recognised circle consumes the gesture so no swipe also fires (R7)', () => {
  const h = harness();
  traceCircle(h, 200, 300, 70, STEER);
  assert.equal(h.count('circle'), 1);
  assert.equal(h.count('swipe'), 0);
});

test('a straight line is never mistaken for a circle', () => {
  const h = harness();
  h.down(100, 300, STEER);
  for (let i = 1; i <= 30; i++) h.move(100 + i * 8, 300, 12);
  h.up(340, 300, 12);
  assert.equal(h.count('circle'), 0);
  assert.equal(h.count('swipe'), 1);
});

// --------------------------------------------------------------------- R8 misc

test('a second finger is ignored while the first is down (R8)', () => {
  const h = harness();
  h.down(100, 100, MENU);
  assert.equal(h.g.pointerDown(2, 400, 400, MENU), false, 'second contact rejected');
  h.up(100, 100, 40);
  assert.equal(h.count('tap'), 1);
});

test('pointerCancel releases a held accelerate pad so the car cannot stick on throttle', () => {
  const h = harness();
  h.down(300, 400, ACCEL);
  h.advance(300);
  h.g.pointerCancel(1);
  h.g.tick();
  assert.equal(h.count('pressEnd'), 1);
  assert.equal(h.find('pressEnd').cancelled, true);
  assert.equal(h.g.isTouching, false);
});

test('a tap chain across two different zones does not merge into a double tap', () => {
  const h = harness();
  h.tapAt(100, 100, MENU, 40);
  h.down(102, 101, DRIVE, 60);
  h.up(102, 101, 40);
  h.advance(GESTURE_DEFAULTS.doubleTapWindowMs + 60);
  assert.equal(h.count('tap'), 2, 'one tap per zone');
  assert.equal(h.count('doubleTap'), 0, 'different zones never merge into a double tap');
});

test('reset() clears in-flight state so a screen change cannot leak a gesture', () => {
  const h = harness();
  h.down(100, 100, ACCEL);
  h.g.reset();
  h.g.tick();
  h.advance(1000);
  h.up(100, 100, 10);
  assert.equal(h.count('pressEnd'), 0);
  assert.equal(h.g.isTouching, false);
});

test('a tap far from the previous tap starts a new chain instead of a double tap', () => {
  const h = harness();
  h.tapAt(100, 100, DRIVE, 40);
  h.tapAt(480, 620, DRIVE, 60);
  h.advance(GESTURE_DEFAULTS.doubleTapWindowMs * 2);
  assert.equal(h.count('doubleTap'), 0, 'a far-apart second tap is not a double tap');
  assert.equal(h.count('tap'), 2, 'both taps are reported, neither is swallowed');
});
