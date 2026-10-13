/**
 * Pointer bus: connects real touch/mouse events to the gesture recognizer.
 *
 * The recognizer (input/gestures.js) is pure and knows nothing about the DOM.
 * This module supplies it with pointer samples in CSS pixels, asks the UI layer
 * which zone a contact landed in, and republishes recognized gestures on the
 * event bus.
 *
 * Multi-touch policy: only the FIRST contact is tracked (rule R8 in gestures.js).
 * Extra fingers are ignored rather than averaged, so a second palm resting on the
 * screen can never steer the car or fire a double tap.
 *
 * @module input/pointerBus
 */

import { bus } from '../core/bus.js';
import { createGestureRecognizer, GESTURE_DEFAULTS } from './gestures.js';

export function createPointerBus(config = {}) {
  const element = config.element;
  const zoneAt = config.zoneAt ?? (() => null);
  const nowFn = config.now ?? (() => performance.now());
  /** Timestamp of the last recognized gesture, used to swallow synthetic clicks. */
  let lastGestureAt = -Infinity;

  const recognizer = createGestureRecognizer({
    thresholds: { ...GESTURE_DEFAULTS, ...(config.thresholds ?? {}) },
    now: nowFn,
    emit: (type, detail) => {
      lastGestureAt = nowFn();
      bus.emit(`gesture:${type}`, detail ?? {});
    },
  });

  /** Clicks that arrive right after a recognized gesture are duplicates. */
  const CLICK_SUPPRESS_MS = 500;
  function isDuplicateClick() {
    return nowFn() - lastGestureAt < CLICK_SUPPRESS_MS;
  }

  let attached = false;
  const handlers = {};

  function pointFromEvent(e) {
    const rect = element.getBoundingClientRect();
    const src = e.touches?.[0] ?? e.changedTouches?.[0] ?? e;
    return {
      x: (src.clientX ?? 0) - rect.left,
      y: (src.clientY ?? 0) - rect.top,
      id: e.pointerId ?? src.identifier ?? 0,
    };
  }

  function onDown(e) {
    // Let the browser keep native scrolling only outside the driving surface.
    const p = pointFromEvent(e);
    const zone = zoneAt(p.x, p.y);
    if (zone?.role === 'driving' || zone?.preventScroll) {
      if (e.cancelable) e.preventDefault();
    }
    recognizer.pointerDown(p.id, p.x, p.y, zone);
  }
  function onMove(e) {
    const p = pointFromEvent(e);
    if (recognizer.isTouching && (zoneAt(p.x, p.y)?.role === 'driving' || recognizer.currentZone?.preventScroll)) {
      if (e.cancelable) e.preventDefault();
    }
    recognizer.pointerMove(p.id, p.x, p.y);
  }
  function onUp(e) {
    const p = pointFromEvent(e);
    recognizer.pointerUp(p.id, p.x, p.y);
  }
  function onCancel(e) {
    const p = pointFromEvent(e);
    recognizer.pointerCancel(p.id, p.x, p.y);
  }

  const api = {
    recognizer,
    get attached() {
      return attached;
    },
    attach() {
      if (attached || !element) return api;
      handlers.pointerdown = onDown;
      handlers.pointermove = onMove;
      handlers.pointerup = onUp;
      handlers.pointercancel = onCancel;
      element.addEventListener('pointerdown', onDown, { passive: false });
      element.addEventListener('pointermove', onMove, { passive: false });
      element.addEventListener('pointerup', onUp);
      element.addEventListener('pointercancel', onCancel);
      element.addEventListener('pointerleave', onCancel);
      // Legacy touch events for older Android WebViews.
      element.addEventListener('touchstart', onDown, { passive: false });
      element.addEventListener('touchmove', onMove, { passive: false });
      element.addEventListener('touchend', onUp);
      element.addEventListener('touchcancel', onCancel);
      // Suppress the synthetic click that follows a tap, because the recognizer
      // already handled it. Without this a tap would activate twice.
      element.addEventListener(
        'click',
        (e) => {
          if (isDuplicateClick()) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
        { capture: true }
      );
      element.addEventListener('contextmenu', (e) => e.preventDefault());
      attached = true;
      return api;
    },
    detach() {
      if (!attached || !element) return api;
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onCancel);
      element.removeEventListener('pointerleave', onCancel);
      element.removeEventListener('touchstart', onDown);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onUp);
      element.removeEventListener('touchcancel', onCancel);
      attached = false;
      return api;
    },
    /** Called from the animation frame; resolves pending tap timers. */
    tick() {
      recognizer.tick();
    },
    reset() {
      recognizer.reset();
      lastGestureAt = -Infinity;
    },
    isDuplicateClick,
  };

  return api;
}
