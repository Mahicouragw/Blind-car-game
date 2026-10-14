/**
 * Keyboard input, and the accessible alternative to the touch-only gestures.
 *
 * The brief requires that double-tap-and-hold is not the only way into the voice
 * settings, and that the game be navigable by keyboard. Every gesture therefore
 * has a keyboard equivalent, listed in KEYBOARD_MAP and announced in the
 * tutorial.
 *
 * @module input/keyboard
 */

import { bus } from '../core/bus.js';

/**
 * key -> gesture-equivalent action. `code` values are used so the mapping is
 * stable across keyboard layouts for the driving keys.
 */
export const KEYBOARD_MAP = {
  // driving
  ArrowUp: 'accelerate',
  KeyW: 'accelerate',
  ArrowDown: 'brake',
  KeyS: 'brake',
  Space: 'handbrake',
  ArrowLeft: 'steerLeft',
  KeyA: 'steerLeft',
  ArrowRight: 'steerRight',
  KeyD: 'steerRight',
  KeyU: 'requestUturn',
  KeyR: 'requestRespawn',
  // interface
  Enter: 'activate',
  NumpadEnter: 'activate',
  Tab: 'nextFocus',
  Escape: 'back',
  Backspace: 'back',
  KeyH: 'repeatLastAnnouncement',
  KeyM: 'toggleMuteGuidance',
  F1: 'openVoiceSettings',
  Slash: 'openVoiceSettings',
  KeyP: 'pause',
};

/**
 * The spoken table of keyboard equivalents. The tutorial reads this out so a
 * keyboard or switch user is never expected to discover controls by swiping.
 */
export function keyboardHelpLines() {
  return [
    'Keyboard controls. Accelerate: W or the up arrow, and it accelerates only while you hold it.',
    'Brake: S or the down arrow, held.',
    'Handbrake: the space bar, held. The handbrake makes the car slide, the same as a double tap on the driving surface.',
    'Steer gradually: A and D, or the left and right arrows. Steering is never instant.',
    'Request a U-turn: U. It only turns where the track allows it.',
    'Recover onto the track: R.',
    'Activate the focused control: Enter.',
    'Move between controls: Tab, and arrow keys inside a list.',
    'Go back: Escape.',
    'Repeat the last announcement: H.',
    'Open the voice settings from anywhere: F1. This is the alternative to double tap and hold.',
    'Pause: P.',
  ];
}

export function attachKeyboard(target = (typeof window !== 'undefined' ? window : null), config = {}) {
  if (!target) return { detach() {}, pressed: new Set() };
  const pressed = new Set();
  const preventScrollKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);
  const allowInField = config.allowInField ?? (() => false);

  function onKeyDown(e) {
    const action = KEYBOARD_MAP[e.code] ?? KEYBOARD_MAP[e.key];
    if (!action) return;
    // Never hijack typing in a text field.
    if (allowInField(e)) return;
    if (preventScrollKeys.has(e.code)) e.preventDefault();
    if (e.repeat) {
      bus.emit('key:hold', { action, code: e.code });
      return;
    }
    pressed.add(action);
    bus.emit('key:down', { action, code: e.code });
    bus.emit(`key:${action}`, { code: e.code });
  }
  function onKeyUp(e) {
    const action = KEYBOARD_MAP[e.code] ?? KEYBOARD_MAP[e.key];
    if (!action) return;
    pressed.delete(action);
    bus.emit('key:up', { action, code: e.code });
  }
  function onBlur() {
    // A lost focus must never leave the car stuck on full throttle.
    for (const action of pressed) bus.emit('key:up', { action, code: 'blur' });
    pressed.clear();
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);
  return {
    pressed,
    isDown(action) {
      return pressed.has(action);
    },
    detach() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      pressed.clear();
    },
  };
}
