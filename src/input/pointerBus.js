/** Real DOM input -> recognizer. A browser supplies ONE input family, never both.
 * Touchscreens emit pointerup then pointerleave on normal finger lift. Leave is
 * NOT cancellation: cancelling there erases delayed taps and every multi-tap.
 */
import { bus } from '../core/bus.js';
import { createGestureRecognizer, GESTURE_DEFAULTS } from './gestures.js';

export function createPointerBus(config = {}) {
  const element = config.element;
  const zoneAt = config.zoneAt ?? (() => null);
  const nowFn = config.now ?? (() => performance.now());
  let lastGestureAt = -Infinity;
  const recognizer = createGestureRecognizer({
    thresholds: { ...GESTURE_DEFAULTS, ...(config.thresholds ?? {}) }, now: nowFn,
    emit(type, detail) { lastGestureAt = nowFn(); bus.emit(`gesture:${type}`, detail ?? {}); },
  });
  const view = element?.ownerDocument?.defaultView ?? globalThis;
  const usePointer = config.usePointerEvents ?? typeof view.PointerEvent === 'function';
  let attached = false;
  let activeId = null;
  // A possible second finger: the two-finger tap (stop). R8 still holds for
  // anything else - a stray second contact is ignored, never a phantom tap.
  let second = null;
  // After a two-finger fire both contacts are dead until every finger lifts,
  // so the surviving first finger cannot start a phantom chain on its way up.
  let liftsNeeded = new Set();
  const handlers = [];
  function point(e, ending = false) {
    const rect = element.getBoundingClientRect();
    // touchend.touches contains the OTHER fingers, not the one which lifted.
    const list = ending ? e.changedTouches : e.touches;
    const candidates = list ? Array.from(list) : [e];
    const src = activeId === null ? candidates[0] : candidates.find(p => (p.pointerId ?? p.identifier ?? 0) === activeId);
    if (!src) return null;
    return { x: (src.clientX ?? 0) - rect.left, y: (src.clientY ?? 0) - rect.top, id: src.pointerId ?? src.identifier ?? 0 };
  }
  function liftedId(e) {
    if (e.changedTouches && e.changedTouches.length > 0) return e.changedTouches[0].identifier ?? 0;
    return e.pointerId ?? e.identifier ?? 0;
  }
  function secondDown(e) {
    if (second || liftsNeeded.size > 0) return;
    const rect = element.getBoundingClientRect();
    const list = e.touches ? Array.from(e.touches) : [e];
    const src = list.find(p => (p.pointerId ?? p.identifier ?? 0) !== activeId) ?? null;
    if (!src) return;
    second = { id: src.pointerId ?? src.identifier ?? 0, x: (src.clientX ?? 0) - rect.left, y: (src.clientY ?? 0) - rect.top, at: nowFn(), moved: false };
  }
  function secondUp() {
    const s = second; second = null;
    if (!s) return;
    // A quick, stationary second contact while the first is still down is the
    // two-finger tap. The recognizer reset kills the first finger's tap chain
    // silently, so no tap, double tap or pressEnd can also fire from this.
    const quick = nowFn() - s.at <= (recognizer.thresholds.doubleTapWindowMs ?? 400);
    if (quick && !s.moved && recognizer.isTouching && activeId !== null) {
      liftsNeeded.add(s.id); liftsNeeded.add(activeId);
      const zoneId = recognizer.currentZone;
      activeId = null;
      recognizer.reset('two-finger-tap');
      lastGestureAt = nowFn();
      bus.emit('gesture:twoFingerTap', { x: s.x, y: s.y, zoneId });
    }
  }
  function down(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (activeId !== null) { secondDown(e); return; }
    if (e.isPrimary === false) return;
    const p = point(e); if (!p) return;
    let zone = zoneAt(p.x, p.y);
    if (zone?.role === 'menu' || zone?.role === 'list' || zone?.role === 'reader') {
      zone = { ...zone, tapGroup: 'menu-cursor', tapAnywhere: true, tapWindowMs: 600 };
    }
    // All game input owns its gesture; do not let browser text selection or a
    // compatibility mouse stream cancel a menu tap after it has been delivered.
    if (e.cancelable) e.preventDefault();
    activeId = p.id;
    recognizer.pointerDown(p.id, p.x, p.y, zone);
    if (usePointer) { try { element.setPointerCapture?.(p.id); } catch { /* detached target */ } }
  }
  function move(e) {
    if (activeId === null) return;
    if (second) {
      const list = e.touches ? Array.from(e.touches) : [e];
      const c = list.find(p => (p.pointerId ?? p.identifier ?? 0) === second.id);
      if (c) {
        const rect = element.getBoundingClientRect();
        if (Math.hypot((c.clientX ?? 0) - rect.left - second.x, (c.clientY ?? 0) - rect.top - second.y) > (recognizer.thresholds.tapMaxDistPx ?? 24)) second.moved = true;
      }
    }
    const p = point(e); if (!p) return;
    if (e.cancelable) e.preventDefault();
    recognizer.pointerMove(p.id, p.x, p.y);
  }
  function up(e) {
    const lid = liftedId(e);
    if (second && lid === second.id) { secondUp(); return; }
    if (liftsNeeded.has(lid)) { liftsNeeded.delete(lid); return; }
    if (activeId === null) return;
    const p = point(e, true); if (!p) return;
    const id = activeId;
    activeId = null; // lostpointercapture after release must not cancel the tap
    recognizer.pointerUp(id, p.x, p.y);
    if (usePointer) { try { element.releasePointerCapture?.(id); } catch { /* already released */ } }
  }
  function cancel(e) {
    const lid = liftedId(e);
    if (second && lid === second.id) { second = null; return; }
    if (liftsNeeded.has(lid)) { liftsNeeded.delete(lid); return; }
    if (activeId === null) return;
    const p = point(e, true); if (!p) return;
    const id = activeId; activeId = null;
    recognizer.pointerCancel(id);
  }
  function click(e) {
    if (api.isDuplicateClick()) { e.preventDefault(); e.stopPropagation(); }
  }
  function contextMenu(e) { e.preventDefault(); }
  function listen(type, fn, options) {
    element.addEventListener(type, fn, options); handlers.push([type, fn, options]);
  }
  const api = {
    recognizer,
    get attached() { return attached; },
    attach() {
      if (attached || !element) return api;
      if (usePointer) {
        listen('pointerdown', down, { passive: false });
        listen('pointermove', move, { passive: false });
        listen('pointerup', up);
        listen('pointercancel', cancel);
        listen('lostpointercapture', cancel);
        // No pointerleave listener. Pointer capture owns a moving contact;
        // a normal lift emits leave AFTER up and must preserve the tap chain.
      } else {
        listen('touchstart', down, { passive: false });
        listen('touchmove', move, { passive: false });
        listen('touchend', up); listen('touchcancel', cancel);
        // Mouse fallback is ignored while a touch stream is in progress/recent.
        let lastTouchAt = -Infinity;
        listen('touchstart', () => { lastTouchAt = nowFn(); });
        const mouse = fn => e => { if (nowFn() - lastTouchAt > 800) fn(e); };
        listen('mousedown', mouse(down)); listen('mousemove', mouse(move)); listen('mouseup', mouse(up));
      }
      listen('click', click, { capture: true }); listen('contextmenu', contextMenu);
      attached = true; return api;
    },
    detach() {
      for (const [type, fn, options] of handlers) element.removeEventListener(type, fn, options);
      handlers.length = 0; api.reset(); attached = false; return api;
    },
    tick() { recognizer.tick(); },
    reset() { activeId = null; second = null; liftsNeeded = new Set(); recognizer.reset(); lastGestureAt = -Infinity; },
    isDuplicateClick() { return nowFn() - lastGestureAt < 500; },
  };
  return api;
}
