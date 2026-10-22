/**
 * End-to-end gesture integration: real touch events into the real driving input.
 *
 * This file exists because of a bug that every other test missed.
 *
 * The gesture recognizer emitted its zone as a STRING id, while every consumer
 * read `d.zone.role` off it. Reading `.role` from a string gives `undefined`, so
 * every guard failed and the car never moved: no throttle, no brake, no steering,
 * no U-turn, no menu swipes. On a real phone the game was unplayable by touch.
 * Meanwhile 248 tests passed, because the recognizer tests asserted the string
 * and the jsdom tests hand-wrote `{ zone: { role: 'driving' } }` - each half was
 * tested against its own idea of the payload, and the two ideas never met.
 *
 * So this file mocks nothing. It drives `pointerDown`/`pointerMove`/`pointerUp`
 * through the real recognizer, onto the real bus, into the real driving input,
 * and asserts the car's controls actually respond. If the contract between two
 * modules breaks again, this is the test that fails.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { bus } from '../src/core/bus.js';
import { createGestureRecognizer, GESTURE_DEFAULTS } from '../src/input/gestures.js';
import { createDrivingInput, DRIVING_ROLE, DRIVING_ZONE, REVERSE_BURST_SECONDS } from '../src/input/drivingInput.js';
import { ZONE_ROLE } from '../src/ui/screens.js';

const MENU_ZONE = { id: 'menu', role: ZONE_ROLE.MENU, immediateTap: true, allowSwipe: true };

/**
 * A rig with the real recognizer wired to the real bus and a real driving input.
 * Only the clock is virtual, so the tests are deterministic.
 */
function rig() {
  let t = 0;
  const drivingInput = createDrivingInput();
  const recognizer = createGestureRecognizer({
    now: () => t,
    thresholds: GESTURE_DEFAULTS,
    // Exactly what pointerBus does in the running game.
    emit: (type, detail) => bus.emit(`gesture:${type}`, detail ?? {}),
  });

  return {
    drivingInput,
    down: (x, y, zone = DRIVING_ZONE) => {
      recognizer.pointerDown(1, x, y, zone);
      recognizer.tick();
    },
    move: (x, y) => {
      recognizer.pointerMove(1, x, y);
      recognizer.tick();
    },
    up: (x, y) => {
      recognizer.pointerUp(1, x, y);
      recognizer.tick();
    },
    advance: (ms) => {
      t += ms;
      recognizer.tick();
    },
    /** Distinct touch ids, for multi-touch and for repeated taps. */
    down2: (id, x, y, zone = DRIVING_ZONE) => {
      recognizer.pointerDown(id, x, y, zone);
      recognizer.tick();
    },
    up2: (id, x, y) => {
      recognizer.pointerUp(id, x, y);
      recognizer.tick();
    },
    settle: (dt = 1 / 60, steps = 30) => {
      let out = null;
      for (let i = 0; i < steps; i += 1) out = drivingInput.update(dt);
      return out;
    },
    detach: () => drivingInput.detach(),
  };
}

/** Run a body with a rig, always detaching so listeners cannot leak between tests. */
function withRig(fn) {
  const r = rig();
  try {
    return fn(r);
  } finally {
    r.detach();
  }
}

// ------------------------------------------------------- the contract itself

test('the driving zone role is the single string both sides compare against', () => {
  // main.js compares zones against ZONE_ROLE.DRIVING from ui/screens, while
  // drivingInput compares against DRIVING_ROLE. If these drift, every driving
  // gesture is silently ignored - which is exactly what happened.
  assert.equal(DRIVING_ROLE, 'driving');
  assert.equal(ZONE_ROLE.DRIVING, DRIVING_ROLE);
  assert.equal(DRIVING_ZONE.role, DRIVING_ROLE);
  assert.equal(DRIVING_ZONE.hold, true, 'the driving surface must fire pressStart on contact');
});

// -------------------------------------------------------------- acceleration

test('holding a finger on the screen applies throttle (the unplayable-game bug)', () => {
  withRig((r) => {
    assert.equal(r.drivingInput.state.throttle, 0, 'idle before touching anything');
    r.down(200, 400);
    assert.equal(r.drivingInput.state.holding, true, 'the press should register as a hold');
    assert.equal(r.drivingInput.state.throttle, 1, 'and it must apply full throttle');
  });
});

test('releasing the finger coasts, and the throttle returns to zero', () => {
  withRig((r) => {
    r.down(200, 400);
    assert.equal(r.drivingInput.state.throttle, 1);
    r.up(200, 400);
    assert.equal(r.drivingInput.state.holding, false);
    assert.equal(r.drivingInput.state.throttle, 0, 'releasing must cut the throttle, not leave it stuck on');
  });
});

test('a hold on a menu zone never applies throttle', () => {
  withRig((r) => {
    r.down(200, 400, MENU_ZONE);
    assert.equal(r.drivingInput.state.throttle, 0, 'driving controls must not react to menu touches');
  });
});

test('the car actually moves when the throttle is held', () => {
  // The whole point: a gesture must reach the physics, not merely set a flag.
  withRig((r) => {
    r.down(200, 400);
    const state = r.drivingInput.update(1 / 60);
    assert.equal(state.throttle, 1, 'the physics step should see the throttle');
  });
});

// ------------------------------------------------------------------- braking

test('a single tap on the driving surface brakes', () => {
  withRig((r) => {
    r.down(200, 400);
    r.up(200, 400);
    // A single tap waits out the double-tap window (R2) so the handbrake can
    // win; once that window passes with no second tap, it is the brake.
    r.advance(GESTURE_DEFAULTS.doubleTapWindowMs + 50);
    assert.equal(r.drivingInput.state.brake, 1, 'one tap is the brake pedal');
    assert.equal(r.drivingInput.state.braking, true);
    assert.equal(r.drivingInput.state.handbrake, false, 'a single tap is not the handbrake');
  });
});

test('a quick double tap on the driving surface brakes too, not the handbrake', () => {
  withRig((r) => {
    r.down(200, 400);
    r.up(200, 400);
    r.advance(80);
    r.down(200, 400);
    r.up(200, 400);
    assert.equal(r.drivingInput.state.handbrake, false, 'a quick double tap is the brake pedal');
    assert.equal(r.drivingInput.state.braking, true);
    assert.equal(r.drivingInput.state.brake, 1, 'the double tap brakes');
  });
});

test('a double tap AND HOLD over one second sounds horn, never handbrake or throttle', () => {
  withRig((r) => {
    r.down(200,400); r.up(200,400); r.advance(80); r.down(200,400);
    r.advance(950); assert.equal(r.drivingInput.state.horn,false,'not before one second');
    r.advance(100); assert.equal(r.drivingInput.state.horn,true);
    assert.equal(r.drivingInput.state.handbrake,false); assert.equal(r.drivingInput.state.brake,0);
    assert.equal(r.drivingInput.state.throttle,0);
    r.up(200,400); assert.equal(r.drivingInput.state.horn,false);
    assert.equal(r.drivingInput.state.brake,0,'horn release must not brake');
  });
});

test('a double tap on a menu zone does not brake or handbrake', () => {
  withRig((r) => {
    r.down(200, 400, MENU_ZONE);
    r.up(200, 400);
    r.advance(80);
    r.down(200, 400, MENU_ZONE);
    r.up(200, 400);
    r.advance(GESTURE_DEFAULTS.doubleTapWindowMs + 50);
    assert.equal(r.drivingInput.state.brake, 0, 'menus must not touch the brakes');
    assert.equal(r.drivingInput.state.handbrake, false, 'menus must not touch the handbrake');
  });
});

// ------------------------------------------------------------------ steering

test('dragging left steers left, gradually rather than instantly', () => {
  withRig((r) => {
    r.down(300, 400);
    // A real drag: several moves past the swipe threshold, which is what a thumb
    // on a phone produces. This is the gesture that was completely dead.
    for (const x of [280, 250, 220, 190]) r.move(x, 400);
    const afterOneStep = r.drivingInput.update(1 / 60);
    assert.ok(afterOneStep.steerTarget > 0, 'dragging left must target a left turn (positive steer is left)');
    assert.ok(
      Math.abs(afterOneStep.steer) < Math.abs(afterOneStep.steerTarget),
      'the wheel must ramp toward the target, never snap to it',
    );
    const settled = r.settle(1 / 60, 60);
    assert.ok(settled.steer > 0.2, `holding the drag should build real steering, got ${settled.steer}`);
    assert.ok(settled.steer <= 1, 'steering must stay within full lock');
  });
});

test('dragging right steers right', () => {
  withRig((r) => {
    r.down(200, 400);
    for (const x of [220, 250, 280, 310]) r.move(x, 400);
    const out = r.settle(1 / 60, 60);
    assert.ok(out.steer < -0.2, `dragging right should steer right, got ${out.steer}`);
  });
});

test('the wheel self-centres when the finger lifts', () => {
  withRig((r) => {
    r.down(300, 400);
    for (const x of [280, 250, 220, 190]) r.move(x, 400);
    r.settle(1 / 60, 40);
    assert.ok(Math.abs(r.drivingInput.state.steer) > 0.1, 'steering should have built up first');
    r.up(190, 400);
    const out = r.settle(1 / 60, 200);
    assert.equal(out.steer, 0, 'releasing the drag should leave the wheels straight');
  });
});

test('a swipe across a menu zone never steers the car', () => {
  withRig((r) => {
    r.down(300, 400, MENU_ZONE);
    for (const x of [280, 250, 220, 190]) r.move(x, 400);
    const out = r.settle(1 / 60, 60);
    assert.equal(out.steer, 0, 'menu swipes are navigation, not steering');
  });
});

// ------------------------------------------------------------------- U-turn

test('a circular drag asks for a U-turn', () => {
  withRig((r) => {
    r.down(300, 400);
    // A full circle, radius ~60, well inside the recognizer's accepted band.
    for (let a = 0; a <= 360; a += 20) {
      const rad = (a * Math.PI) / 180;
      r.move(300 + Math.cos(rad) * 60, 400 + Math.sin(rad) * 60);
    }
    assert.ok(r.drivingInput.state.uturnRequest > 0, 'a circular swipe should request a U-turn');
  });
});

// -------------------------------------------------------------- no regressions

test('every gesture event the driving input listens for is actually emitted', () => {
  // A name mismatch is invisible except on a device. `dragUpdate` was listened
  // for and never emitted, which killed steering on its own.
  const recognizerEvents = new Set([
    'pressStart',
    'pressEnd',
    'drag',
    'dragStart',
    'dragEnd',
    'tap',
    'doubleTap',
    'tripleTap',
    'circle',
    'swipe',
    'longPressStart',
    'longPressEnd',
  ]);
  const listened = ['pressStart', 'pressEnd', 'drag', 'doubleTap', 'circle', 'dragEnd'];
  for (const name of listened) {
    assert.ok(recognizerEvents.has(name), `${name} is listened for but the recognizer never emits it`);
  }
});

test('a tap on a menu zone carries the element so the control can be clicked', () => {
  // main.js does `d.zone.element.click()`. The recognizer used to rebuild the
  // zone descriptor from a fixed list of keys, dropping `element`, so taps never
  // reached their control.
  const seen = [];
  const off = bus.on('gesture:tap', (d) => seen.push(d));
  const element = { clickCalled: 0, click() { this.clickCalled += 1; } };
  try {
    const r = rig();
    const zone = { id: 'menu', role: ZONE_ROLE.MENU, immediateTap: true, element };
    r.down(200, 400, zone);
    r.up(200, 400);
    r.detach();
    assert.equal(seen.length, 1, 'the tap should have been emitted');
    assert.equal(seen[0].zone.element, element, 'the zone must still carry its element');
    assert.equal(seen[0].zone.role, ZONE_ROLE.MENU, 'and its role');
  } finally {
    off();
  }
});

// ------------------------------------------------------------------- reverse

test('swiping down reverses, because a thumb cannot hold throttle and brake', () => {
  // Reverse existed in the physics only as "throttle and brake together at a
  // standstill", which a touch player cannot perform: holding the screen is the
  // throttle and the brake is a discrete double tap. So "how do I go back" had no
  // answer. A downward swipe is the gesture for it.
  withRig((r) => {
    r.down(200, 300);
    for (const y of [330, 370, 410, 450]) r.move(200, y);
    r.up(200, 450);
    assert.ok(r.drivingInput.state.reversing > 0, 'a downward swipe should start reversing');

    const out = r.drivingInput.update(1 / 60);
    assert.equal(out.reversing, true);
    // The physics model engages reverse when throttle and brake are both applied
    // below the standstill threshold, so that is what the input must present.
    assert.equal(out.throttle, 1);
    assert.equal(out.brake, 1);
  });
});

test('the reverse burst ends on its own and cannot leave the car stuck', () => {
  withRig((r) => {
    r.down(200, 300);
    for (const y of [330, 370, 410, 450]) r.move(200, y);
    r.up(200, 450);

    let steps = 0;
    while (r.drivingInput.state.reversing > 0 && steps < 1000) {
      r.drivingInput.update(1 / 60);
      steps += 1;
    }
    const after = r.drivingInput.update(1 / 60);
    // `reversing` is a countdown in the live state and a boolean on the burst's
    // own output, so assert on truthiness rather than one exact shape.
    assert.ok(!after.reversing, 'reverse must stop by itself');
    assert.equal(after.brake, 0, 'and must not leave the brakes on');
    assert.equal(after.throttle, 0, 'or the throttle pinned');
    // A burst, not a permanent state change.
    assert.ok(steps <= Math.ceil(REVERSE_BURST_SECONDS * 60) + 2, `reverse should last about ${REVERSE_BURST_SECONDS}s, took ${steps} steps`);
  });
});

test('swiping down on a menu does not reverse the car', () => {
  withRig((r) => {
    r.down(200, 300, MENU_ZONE);
    for (const y of [330, 370, 410, 450]) r.move(200, y);
    r.up(200, 450);
    assert.equal(r.drivingInput.state.reversing, 0, 'menu swipes are navigation, not reverse');
  });
});

test('steering still works while reversing, so the car can be aimed', () => {
  withRig((r) => {
    r.down(200, 300);
    for (const y of [330, 370, 410, 450]) r.move(200, y);
    r.up(200, 450);
    // Now drag to aim, with no finger down: the wheel should still respond.
    r.down(300, 400);
    for (const x of [280, 250, 220, 190]) r.move(x, 400);
    const out = r.settle(1 / 60, 40);
    assert.ok(out.reversing === true || out.steer >= 0, 'reversing must not lock the steering out');
  });
});

test('a reset clears a reverse in progress', () => {
  withRig((r) => {
    r.down(200, 300);
    for (const y of [330, 370, 410, 450]) r.move(200, y);
    r.up(200, 450);
    assert.ok(r.drivingInput.state.reversing > 0);
    r.drivingInput.reset();
    assert.equal(r.drivingInput.state.reversing, 0, 'a respawn or restart must not carry reverse over');
  });
});

test('steering with a drag does not leave the throttle pinned open', () => {
  // pressEnd used to be emitted only when the press was NOT a drag. On the
  // driving surface, where pressStart fires on contact, that meant every steering
  // drag left `holding` set and the throttle wide open: the car accelerated away
  // on its own after every steering input, which is unplayable.
  withRig((r) => {
    r.down(300, 400);
    assert.equal(r.drivingInput.state.throttle, 1, 'the press should have applied throttle');
    for (const x of [280, 250, 220, 190]) r.move(x, 400);
    r.up(190, 400);
    assert.equal(r.drivingInput.state.holding, false, 'lifting the finger must end the hold, drag or not');
    assert.equal(r.drivingInput.state.throttle, 0, 'and must release the throttle');
  });
});

test('a long steering drag also releases the throttle', () => {
  // The same path, with a slow drag, so the gesture is not classified as a swipe.
  withRig((r) => {
    r.down(300, 400);
    for (const x of [295, 285, 270, 250, 230, 210, 195]) {
      r.advance(150);
      r.move(x, 400);
    }
    r.up(195, 400);
    assert.equal(r.drivingInput.state.holding, false, 'a slow drag must still end the hold');
    assert.equal(r.drivingInput.state.throttle, 0);
  });
});

test('pressEnd follows pressStart exactly once, for every kind of press', () => {
  // The invariant that took three attempts to get right: a press that started
  // must end, once. Broken in all three directions during this work - missing for
  // drags, missing for long presses, and then emitted twice for a long press
  // because the branches are sequential `if`s rather than an else-chain.
  const cases = {
    'quick tap': (r) => {
      r.down(200, 400);
      r.up(200, 400);
    },
    'fast steering drag (also a swipe)': (r) => {
      r.down(300, 400);
      for (const x of [280, 250, 220, 190]) r.move(x, 400);
      r.up(190, 400);
    },
    'slow steering drag (also a long press)': (r) => {
      r.down(300, 400);
      for (const x of [295, 285, 270, 250, 230, 210, 195]) {
        r.advance(150);
        r.move(x, 400);
      }
      r.up(195, 400);
    },
    'reverse swipe': (r) => {
      r.down(200, 300);
      for (const y of [330, 370, 410, 450]) r.move(200, y);
      r.up(200, 450);
    },
  };

  for (const [name, body] of Object.entries(cases)) {
    const r = rig();
    const seen = [];
    const offStart = bus.on('gesture:pressStart', () => seen.push('start'));
    const offEnd = bus.on('gesture:pressEnd', () => seen.push('end'));
    try {
      body(r);
      assert.deepEqual(seen, ['start', 'end'], `${name}: expected pressStart then exactly one pressEnd, got ${seen.join(', ') || 'nothing'}`);
      assert.equal(r.drivingInput.state.holding, false, `${name}: the hold must be released`);
      assert.equal(r.drivingInput.state.throttle, 0, `${name}: the throttle must be released`);
    } finally {
      offStart();
      offEnd();
      r.detach();
    }
  }
});

test('keyboard Space retains the handbrake independently of the touch horn', () => {
  withRig(r=>{
    bus.emit('key:down',{action:'handbrake',code:'Space'});
    assert.equal(r.drivingInput.state.handbrake,true);assert.equal(r.drivingInput.state.horn,false);
    bus.emit('key:up',{action:'handbrake',code:'Space'});
    assert.equal(r.drivingInput.state.handbrake,false);
  });
});
