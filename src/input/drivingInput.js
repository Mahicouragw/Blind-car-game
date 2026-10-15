/**
 * Driving input: merges gestures, keyboard and on-screen pads into one control
 * state consumed by the physics step.
 *
 * The important rule is that steering is GRADUAL. Nothing here can move the car
 * sideways instantly; a swipe changes a steering TARGET and the vehicle model
 * ramps the front wheels toward it at a limited rate, so a U-turn is a real turn
 * rather than a teleport.
 *
 * @module input/drivingInput
 */

import { bus } from '../core/bus.js';

/**
 * The role the driving surface must carry for these handlers to act on it.
 *
 * Exported so the zone descriptor below and the guards underneath cannot drift
 * apart. They did once: the recognizer emitted `zone` as a string id while every
 * handler read `d.zone.role`, so the guard never matched and a finger held on the
 * screen produced no throttle at all. The game was unplayable by touch and every
 * test still passed, because the two sides were each tested against their own
 * idea of the payload.
 */
export const DRIVING_ROLE = 'driving';

/**
 * The gesture zone for the driving surface. `main.js` installs this as the
 * default zone for the whole race, and the tests import the same object rather
 * than describing it a second time.
 */
export const DRIVING_ZONE = {
  id: 'drivingSurface',
  role: DRIVING_ROLE,
  // The brake is a SAFETY control: it must land the instant the finger lifts,
  // never 300 ms later. Tap and double tap now mean the same thing (brake), so
  // there is no longer any reason to delay the first tap to disambiguate - and
  // the delay is exactly what made taps feel dead in play-testing. The
  // double-tap-and-hold handbrake chain still resolves on top of this.
  immediateTap: true,
  hold: true,
  allowCircle: true,
  allowSwipe: true,
  preventScroll: true,
  // The driving surface owns a double-tap-and-hold meaning (the handbrake), so
  // a quick double tap still brakes while a held second tap drifts. See R4 in
  // input/gestures.js.
  doubleTapHoldTarget: true,
};

/** How fast a swipe moves the steering target, per second. */
export const STEER_TARGET_RATE = 2.6;

/**
 * How long one downward swipe keeps the car reversing.
 *
 * A burst rather than a hold, because the reverse gear in the physics model is
 * engaged by holding throttle and brake together, which is not something a thumb
 * can do while also steering. This is applied for exactly as long as `state.reversing`
 * lasts, so releasing the car happens on its own and it cannot be left stuck.
 */
export const REVERSE_BURST_SECONDS = 1.8;

/**
 * How long one brake tap holds the pedal, in ms. A tap, not a hold: the finger
 * is wanted for steering, so braking is a deliberate tap rhythm like a real
 * pedal tap.
 */
export const BRAKE_TAP_MS = 620;

/**
 * How long one handbrake pull lasts, in seconds.
 *
 * A burst for the same reason as reverse: the e-brake is pulled and released.
 * Inside that window the physics lose rear grip and the car slides, which is
 * what makes the hold a DRIFT input rather than a harder brake.
 */
export const HANDBRAKE_BURST_SECONDS = 1.1;

/**
 * A downward swipe is only "reverse" when it is almost exactly vertical. A
 * swipe that leans left is the "swipe down and left" the brief asks for: it
 * opens the menu and must NOT throw the car into reverse. A real thumb cannot
 * draw a perfectly vertical line, so the tolerance is small and the menu gets
 * the benefit of the doubt - opening a menu is safe, reversing by accident is
 * not.
 */
export const REVERSE_MAX_DX = 24;

/**
 * True for the "swipe down and left" menu gesture: any clear diagonal into the
 * down-left quadrant of the screen. Both raw deltas matter - a mostly-vertical
 * swipe that leans left is the menu, and a mostly-horizontal one that dips
 * down is too. Straight down is reverse; the rest of the compass belongs to
 * the menus it is already mapped to.
 *
 * @param {{dx?: number, dy?: number}} d swipe payload
 */
export function isDownLeftSwipe(d) {
  const dx = d.dx ?? 0;
  const dy = d.dy ?? 0;
  return dx <= -REVERSE_MAX_DX && dy >= REVERSE_MAX_DX;
}

export function createDrivingInput(config = {}) {
  const state = {
    throttle: 0,
    brake: 0,
    steer: 0, // -1 right .. +1 left, applied to the physics model
    steerTarget: 0,
    handbrake: false,
    uturnRequest: 0, // countdown in seconds while a U-turn is being asked for
    reversing: 0, // seconds of reverse still to apply
    respawnRequest: false,
    holding: false,
    braking: false,
  };

  // Full lock needs about 130 CSS px of drag, roughly a third of a phone
  // screen. Any more sensitive and steering is unusable with a thumb.
  const swipeSteerGain = config.swipeSteerGain ?? 0.0077; // per pixel of drag
  const maxSteerFromSwipe = config.maxSteerFromSwipe ?? 1;
  const keyboard = config.keyboard ?? null;
  let dragSteer = 0;
  let dragActive = false;
  let dragStartX = 0;
  let off = [];

  function on(type, fn) {
    bus.on(type, fn);
    off.push([type, fn]);
  }

  // ---- press and hold to accelerate; release to coast ----
  on('gesture:pressStart', (d) => {
    if (d.zone?.role !== DRIVING_ROLE) return;
    state.holding = true;
    state.throttle = 1;
  });
  on('gesture:pressEnd', () => {
    state.holding = false;
    state.throttle = 0;
  });

  // ---- one tap OR two quick taps on the driving surface brake ----
  //
  // Play-testing settled this: people instinctively DOUBLE TAP to brake, and a
  // single tap must brake too. Both are the same pedal tap, both are announced
  // ("Brake"), and the recognizer already separates them from the hold below.
  on('gesture:tap', (d) => {
    if (d.zone?.role !== DRIVING_ROLE) return;
    startBrake();
    bus.emit('race:brakePressed', {});
  });
  on('gesture:doubleTap', (d) => {
    if (d.zone?.role !== DRIVING_ROLE) return;
    startBrake();
    bus.emit('race:brakePressed', {});
  });

  // ---- double tap AND HOLD is the handbrake ----
  //
  // The second tap held for a moment pulls the e-brake: the car slides (see
  // HANDBRAKE_BURST_SECONDS). A quick double tap is NOT this - it brakes - so
  // the recognizer's doubleTapHold is exactly the right gesture: same rhythm as
  // braking, but the finger stays down for the drift.
  on('gesture:doubleTapHold', (d) => {
    if (d.zone?.role !== DRIVING_ROLE) return;
    startHandbrake();
    bus.emit('race:handbrakeStarted', { seconds: HANDBRAKE_BURST_SECONDS });
  });

  /** Brake pedal tap: held briefly, then released, exactly like tapping a pedal. */
  function startBrake() {
    state.braking = true;
    state.brake = 1;
    setTimeout(() => {
      if (state.handbrake) return; // the handbrake owns the pedal right now
      state.braking = false;
      state.brake = 0;
    }, BRAKE_TAP_MS);
  }

  /** Handbrake pull: strong, brief, and it engages the drift physics. */
  function startHandbrake() {
    state.handbrake = true;
    state.braking = true;
    state.brake = Math.max(state.brake, 0.55);
    setTimeout(() => {
      state.handbrake = false;
      state.braking = false;
      state.brake = 0;
    }, Math.round(HANDBRAKE_BURST_SECONDS * 1000));
  }

  // ---- gradual steering by drag ----
  // The recognizer emits `drag` for continuous movement (with `dragStart` and
  // `dragEnd` around it). This listened for `dragUpdate`, which nothing has ever
  // emitted, so drag steering was dead: the wheel never turned on touch, and the
  // tutorial's required "steer" step could never be demonstrated.
  on('gesture:drag', (d) => {
    if (d.zone?.role !== DRIVING_ROLE) return;
    if (!dragActive) {
      dragActive = true;
      dragStartX = d.x;
      return;
    }
    const dx = d.x - dragStartX;
    // Dragging LEFT steers LEFT: positive steer is left in the physics model.
    dragSteer = Math.max(-maxSteerFromSwipe, Math.min(maxSteerFromSwipe, -dx * swipeSteerGain));
  });
  on('gesture:dragEnd', () => {
    dragActive = false;
    // Wheels self-centre gradually rather than snapping back.
    dragSteer = 0;
  });

  // ---- swipe down reverses ----
  // Reverse already existed in the physics, but only as "throttle and brake
  // together at a standstill", which a touch player cannot perform: holding the
  // screen is the throttle, and the brake is a discrete tap. So reverse was
  // unreachable, and "how do I go back" had no answer. A mostly-vertical
  // downward swipe is the natural gesture for it and does not collide with the
  // throttle, since the throttle needs the finger down and a swipe ends with it
  // up. A swipe that also travels LEFT is the "down and left" menu gesture and
  // is left alone (REVERSE_MAX_DX).
  on('gesture:swipe', (d) => {
    if (d.zone?.role !== DRIVING_ROLE) return;
    if (d.direction !== 'down') return;
    if (Math.abs(d.dx ?? 0) > REVERSE_MAX_DX) return;
    state.reversing = REVERSE_BURST_SECONDS;
    state.braking = false;
    bus.emit('race:reverseStarted', { seconds: REVERSE_BURST_SECONDS });
  });

  // ---- circle or directional swipe asks for a U-turn ----
  on('gesture:circle', (d) => {
    if (d.zone?.role !== DRIVING_ROLE) return;
    state.uturnRequest = 1.4;
    bus.emit('race:uturnRequested', { direction: d.direction });
  });

  // ---- keyboard equivalents ----
  on('key:down', (d) => {
    if (d.action === 'accelerate') {
      state.holding = true;
      state.throttle = 1;
    } else if (d.action === 'brake') {
      state.braking = true;
      state.brake = 1;
    } else if (d.action === 'handbrake') {
      state.handbrake = true;
      state.braking = true;
      state.brake = Math.max(state.brake, 0.55);
    } else if (d.action === 'steerLeft') dragSteer = Math.min(maxSteerFromSwipe, dragSteer + 0.55);
    else if (d.action === 'steerRight') dragSteer = Math.max(-maxSteerFromSwipe, dragSteer - 0.55);
    else if (d.action === 'requestUturn') state.uturnRequest = 1.4;
    else if (d.action === 'requestRespawn') state.respawnRequest = true;
  });
  on('key:up', (d) => {
    if (d.action === 'accelerate') {
      state.holding = false;
      state.throttle = 0;
    } else if (d.action === 'brake') {
      if (!state.handbrake) {
        state.braking = false;
        state.brake = 0;
      }
    } else if (d.action === 'handbrake') {
      state.handbrake = false;
      state.braking = false;
      state.brake = 0;
    } else if (d.action === 'steerLeft' || d.action === 'steerRight') dragSteer = 0;
  });
  // Losing window focus must never leave the throttle or the handbrake on.
  on('key:up', (d) => {
    if (d.code === 'blur') {
      state.throttle = 0;
      state.brake = 0;
      state.holding = false;
      state.handbrake = false;
      dragSteer = 0;
    }
  });

  return {
    state,
    /** Ramp steering toward its target and decay one-shot requests. */
    update(dt) {
      // Reverse is expressed to the physics model the way it already understands:
      // throttle and brake together below the standstill threshold engages the
      // reverse gear. See REVERSE_BURST_SECONDS.
      if (state.reversing > 0) {
        state.reversing = Math.max(0, state.reversing - dt);
        const out = {
          ...state,
          throttle: 1,
          brake: 1,
          reversing: true,
          reverseSecondsLeft: state.reversing,
          consumeRespawn: false,
        };
        if (state.respawnRequest) {
          state.respawnRequest = false;
          out.consumeRespawn = true;
        }
        return out;
      }
      state.steerTarget = dragSteer;
      // Gradual: the target itself is rate-limited, and the vehicle model
      // rate-limits the wheels again on top of that.
      const maxStep = STEER_TARGET_RATE * dt;
      const delta = state.steerTarget - state.steer;
      state.steer += Math.max(-maxStep, Math.min(maxStep, delta));
      if (!dragActive && Math.abs(state.steer) < 0.02) state.steer = 0;

      if (state.uturnRequest > 0) state.uturnRequest = Math.max(0, state.uturnRequest - dt);
      if (state.respawnRequest) {
        state.respawnRequest = false;
        return { ...state, consumeRespawn: true };
      }
      return { ...state, consumeRespawn: false };
    },
    reset() {
      state.reversing = 0;
      state.throttle = 0;
      state.brake = 0;
      state.steer = 0;
      state.steerTarget = 0;
      state.uturnRequest = 0;
      state.respawnRequest = false;
      state.holding = false;
      state.braking = false;
      state.handbrake = false;
      dragSteer = 0;
      dragActive = false;
    },
    detach() {
      for (const [type, fn] of off) bus.off(type, fn);
      off = [];
      keyboard?.detach?.();
    },
  };
}
