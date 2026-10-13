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

export const STEER_TARGET_RATE = 2.6; // how fast a swipe moves the steering target, per second

export function createDrivingInput(config = {}) {
  const state = {
    throttle: 0,
    brake: 0,
    steer: 0, // -1 right .. +1 left, applied to the physics model
    steerTarget: 0,
    handbrake: false,
    uturnRequest: 0, // countdown in seconds while a U-turn is being asked for
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
    if (d.zone?.role !== 'driving') return;
    state.holding = true;
    state.throttle = 1;
  });
  on('gesture:pressEnd', () => {
    state.holding = false;
    state.throttle = 0;
  });

  // ---- double tap on the driving surface brakes ----
  on('gesture:doubleTap', (d) => {
    if (d.zone?.role !== 'driving') return;
    state.braking = true;
    state.brake = 1;
    // Held for a moment, then released, exactly like tapping a brake pedal.
    setTimeout(() => {
      state.braking = false;
      state.brake = 0;
    }, 620);
  });

  // ---- gradual steering by drag ----
  on('gesture:dragUpdate', (d) => {
    if (d.zone?.role !== 'driving') return;
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

  // ---- circle or directional swipe asks for a U-turn ----
  on('gesture:circle', (d) => {
    if (d.zone?.role !== 'driving') return;
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
      state.braking = false;
      state.brake = 0;
    } else if (d.action === 'steerLeft' || d.action === 'steerRight') dragSteer = 0;
  });
  // Losing window focus must never leave the throttle open.
  on('key:up', (d) => {
    if (d.code === 'blur') {
      state.throttle = 0;
      state.brake = 0;
      state.holding = false;
      dragSteer = 0;
    }
  });

  return {
    state,
    /** Ramp steering toward its target and decay one-shot requests. */
    update(dt) {
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
      state.throttle = 0;
      state.brake = 0;
      state.steer = 0;
      state.steerTarget = 0;
      state.uturnRequest = 0;
      state.respawnRequest = false;
      state.holding = false;
      state.braking = false;
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
