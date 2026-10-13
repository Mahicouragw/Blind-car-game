/**
 * Game TalkBack gesture recogniser.
 *
 * A pure, deterministic state machine. It has no DOM dependencies: you feed it
 * pointer events and a clock, it hands back named gestures. That makes the
 * trickiest accessibility requirement in the game - resolving conflicts between
 * tap, double tap, double-tap-and-hold, long press, swipe and circular swipe -
 * something we can unit test rather than something we can only hope works.
 *
 * ---------------------------------------------------------------------------
 * CONFLICT RESOLUTION RULES (authoritative - tests assert each one)
 * ---------------------------------------------------------------------------
 * R1  A contact that travels more than `tapMaxDistPx` before lifting is a DRAG,
 *     never a tap. Steering therefore can never be mistaken for tapping, which
 *     is what stops a player starting a race while they are steering.
 *
 * R2  Single tap latency is zone-dependent. Zones flagged `immediateTap`
 *     (menus, car selection) fire on lift so they feel responsive. Zones that
 *     also own a double-tap meaning (the driving surface, where double tap is
 *     brake) wait out `doubleTapWindowMs` so brake always wins.
 *
 * R3  A second contact landing inside `doubleTapWindowMs` is a DOUBLE TAP.
 *     On a normal zone it fires immediately on touch-down, because braking is
 *     a reflex action and must not be delayed.
 *
 * R4  If the zone is a double-tap-and-hold target (the settings hotspot) the
 *     immediate double tap is SUPPRESSED. If the second contact is held for
 *     `doubleTapHoldMs` we emit `doubleTapHold` and set `brakeSuppressed`,
 *     so braking and opening settings can never both happen. If the second
 *     contact lifts before that threshold, we emit the `doubleTap` normally.
 *
 * R5  A hold that begins after a completed double tap is a NEW gesture
 *     (`longPressStart`), never a settings gesture. Settings needs the two taps
 *     to be connected.
 *
 * R6  A third tap inside the window emits `tripleTap` and suppresses both
 *     `tap` and `doubleTap`. `tripleTap` is mapped to "repeat the last
 *     guidance" - it is never mapped to starting a race. Starting a race is
 *     only possible through an explicit control plus a re-entry guard.
 *
 * R7  A circular swipe is detected while the finger is still down and consumes
 *     the gesture, so no swipe fires on lift.
 *
 * R8  Only the first contact is recognised. Extra fingers (a palm resting on
 *     the screen, a second hand) are ignored instead of creating phantom
 *     gestures.
 *
 * @module input/gestures
 */

export const GESTURE_DEFAULTS = {
  tapMaxMs: 220,
  tapMaxDistPx: 16,
  doubleTapWindowMs: 300,
  longPressMs: 420,
  doubleTapHoldMs: 360,
  swipeMinPx: 34,
  swipeMaxMs: 900,
  /** |dx| must exceed |dy| by this factor to be a horizontal swipe. */
  swipeDominance: 1.35,
  circleMinTurnDeg: 300,
  circleMinRadiusPx: 22,
  circleMaxRadiusPx: 260,
  circleTolerancePx: 60,
  circleMinPathPx: 120,
};

export const GESTURE_EVENTS = [
  'pressStart',
  'pressEnd',
  'tap',
  'tapSuperseded',
  'doubleTap',
  'doubleTapHold',
  'tripleTap',
  'longPressStart',
  'longPressEnd',
  'swipe',
  'dragStart',
  'drag',
  'dragEnd',
  'circle',
  'cancel',
];

const DIRECTIONS = ['left', 'right', 'up', 'down'];

let timerSeq = 0;

/**
 * @param {object} [config]
 * @param {object} [config.thresholds] merged over GESTURE_DEFAULTS
 * @param {() => number} [config.now] clock in ms (inject a virtual one in tests)
 * @param {(event:string, payload:object) => void} [config.emit]
 */
export function createGestureRecognizer(config = {}) {
  const T = { ...GESTURE_DEFAULTS, ...(config.thresholds ?? {}) };
  let now = config.now ?? (() => Date.now());
  const emitFn = config.emit ?? (() => {});

  /** @type {Array<{id:number, at:number, fn:() => void, tag:string}>} */
  let timers = [];
  /** The single tracked contact (R8). */
  let touch = null;
  /** Tap-chain state, independent of whether a finger is currently down. */
  let chain = { count: 0, zone: null, x: 0, y: 0, at: 0, active: false, settled: false, emittedTap: false };
  /** Set when a double-tap-and-hold won, so the brake event is never emitted. */
  let brakeSuppressed = false;
  /** Recent gesture log, useful for the on-screen tutorial and for debugging. */
  const history = [];
  const HISTORY_LIMIT = 24;

  function emit(event, payload) {
    const record = { event, at: now(), ...payload };
    history.push(record);
    if (history.length > HISTORY_LIMIT) history.shift();
    emitFn(event, record);
    return record;
  }

  function clearTimer(tag) {
    timers = timers.filter((t) => t.tag !== tag);
  }

  function setTimer(tag, delayMs, fn) {
    clearTimer(tag);
    timers.push({ id: ++timerSeq, tag, at: now() + delayMs, fn });
  }

  /**
   * Run any pending timer of this tag immediately instead of letting a newer
   * timer of the same tag cancel it. Without this, a second tap far away from
   * an unresolved first tap would silently swallow the first one.
   */
  function flushTimer(tag) {
    const due = timers.filter((t) => t.tag === tag);
    timers = timers.filter((t) => t.tag !== tag);
    for (const timer of due) timer.fn();
  }

  function resetChain(reason) {
    chain = { count: 0, zone: null, x: 0, y: 0, at: 0, active: false, settled: false, emittedTap: false };
    clearTimer('tapResolve');
    clearTimer('doubleTapHold');
    clearTimer('chainExpire');
    if (reason) emit('cancel', { reason });
  }

  /**
   * Zone descriptors default to the safe (delayed) behaviour.
   *
   * The caller's own fields are spread in first and preserved: `element` is what
   * lets a tap click the real control, and `preventScroll` is read by the pointer
   * bus. An earlier version rebuilt the descriptor from a fixed list of keys,
   * which silently dropped both.
   */
  function zoneOpts(zone) {
    return {
      ...(zone ?? {}),
      id: zone?.id ?? 'surface',
      immediateTap: !!zone?.immediateTap,
      doubleTapHoldTarget: !!zone?.doubleTapHoldTarget,
      hold: !!zone?.hold,
      allowCircle: zone?.allowCircle !== false,
      allowSwipe: zone?.allowSwipe !== false,
      role: zone?.role ?? zone?.id ?? 'surface',
    };
  }

  // --------------------------------------------------------------- detection
  function detectCircle(path) {
    if (path.length < 8) return null;
    let pathLen = 0;
    for (let i = 1; i < path.length; i++) {
      pathLen += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    }
    if (pathLen < T.circleMinPathPx) return null;

    let cx = 0;
    let cz = 0;
    for (const p of path) {
      cx += p.x;
      cz += p.y;
    }
    cx /= path.length;
    cz /= path.length;

    let radii = 0;
    let rMin = Infinity;
    let rMax = -Infinity;
    for (const p of path) {
      const r = Math.hypot(p.x - cx, p.y - cz);
      radii += r;
      if (r < rMin) rMin = r;
      if (r > rMax) rMax = r;
    }
    const rAvg = radii / path.length;
    if (rAvg < T.circleMinRadiusPx || rAvg > T.circleMaxRadiusPx) return null;
    if (rMax - rMin > T.circleTolerancePx * 2) return null;

    // Screen Y grows downwards, so a positive accumulated angle in this frame
    // is a CLOCKWISE circle on screen. Report it in the player's terms.
    let turn = 0;
    for (let i = 1; i < path.length; i++) {
      const ax = path[i - 1].x - cx;
      const ay = path[i - 1].y - cz;
      const bx = path[i].x - cx;
      const by = path[i].y - cz;
      const cross = ax * by - ay * bx;
      const dot = ax * bx + ay * by;
      turn += Math.atan2(cross, dot);
    }
    const turnDeg = (turn * 180) / Math.PI;
    if (Math.abs(turnDeg) < T.circleMinTurnDeg) return null;
    return { direction: turnDeg > 0 ? 'clockwise' : 'anticlockwise', turnDeg, radiusPx: rAvg };
  }

  function classifySwipe(dx, dy) {
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx >= ady * T.swipeDominance) return dx > 0 ? 'right' : 'left';
    if (ady >= adx * T.swipeDominance) return dy > 0 ? 'down' : 'up';
    // Ambiguous diagonal: fall back to the larger axis rather than dropping it.
    return adx >= ady ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  // ------------------------------------------------------------------ public
  const api = {
    thresholds: T,
    history,

    /** Replace the clock (tests) or the emitter (wiring). */
    setClock(fn) {
      now = fn;
    },
    setEmitter(fn) {
      // eslint-disable-next-line no-func-assign
      emitFn = fn;
    },

    /**
     * @param {string|number} id pointer id
     * @param {number} x
     * @param {number} y
     * @param {object} [zone]
     */
    pointerDown(id, x, y, zone = {}) {
      if (touch) return false; // R8: ignore extra fingers
      const z = zoneOpts(zone);
      const t = now();

      // --- R4/R6: are we continuing a tap chain? ---
      const inWindow = chain.active && t - chain.at <= T.doubleTapWindowMs && chain.zone?.id === z.id;
      const near = inWindow && Math.hypot(x - chain.x, y - chain.y) < T.tapMaxDistPx * 3.5;

      if (inWindow && near) {
        chain.count += 1;
        chain.at = t;
        chain.x = x;
        chain.y = y;
      } else {
        // A genuinely new tap. Flush anything still waiting to resolve so the
        // previous tap is reported rather than dropped, and cancel the previous
        // chain's expiry timer so it cannot kill the new chain.
        flushTimer('tapResolve');
        clearTimer('chainExpire');
        chain = { count: 1, zone: z, x, y, at: t, active: true, settled: false, emittedTap: false };
        brakeSuppressed = false;
      }

      touch = {
        id,
        zone: z,
        startX: x,
        startY: y,
        startT: t,
        x,
        y,
        path: [{ x, y, t }],
        isDrag: false,
        circleFired: false,
        longPressFired: false,
        pressStartFired: false,
        tapCount: chain.count,
      };

      // Hold semantics: an accelerate pad must respond on contact, not after a
      // threshold, otherwise the car feels like it is lagging behind the thumb.
      if (z.hold) {
        touch.pressStartFired = true;
        emit('pressStart', { zone: z, zoneId: z.id, role: z.role, x, y, tapCount: chain.count });
      }

      // Long press (R5): only when this is a fresh single contact.
      if (chain.count === 1) {
        setTimer('longPress', T.longPressMs, () => {
          if (!touch || touch.isDrag || touch.tapCount !== 1) return;
          touch.longPressFired = true;
          emit('longPressStart', { zone: touch.zone, zoneId: touch.zone.id, role: touch.zone.role, x: touch.x, y: touch.y });
        });
      }

      // Double-tap-and-hold (R4): only on a designated hotspot, only on tap 2+.
      if (chain.count >= 2) clearTimer('tapResolve');

      if (chain.count >= 2 && z.doubleTapHoldTarget) {
        setTimer('doubleTapHold', T.doubleTapHoldMs, () => {
          if (!touch || touch.isDrag) return;
          brakeSuppressed = true;
          clearTimer('tapResolve');
          emit('doubleTapHold', {
            zone: touch.zone, zoneId: touch.zone.id,
            role: touch.zone.role,
            x: touch.x,
            y: touch.y,
            tapCount: touch.tapCount,
          });
          chain.active = false;
          chain.count = 0;
          chain.settled = true;
        });
      } else if (chain.count >= 2) {
        // R3/R6. If an immediate tap was already delivered for tap 1, tell the
        // consumer to undo it before we report the multi-tap meaning.
        if (chain.emittedTap) {
          emit('tapSuperseded', { zone: z, zoneId: z.id, role: z.role, x, y });
          chain.emittedTap = false;
        }
        if (chain.count >= 3) {
          emit('tripleTap', { zone: z, zoneId: z.id, role: z.role, x, y, tapCount: chain.count });
        } else {
          emit('doubleTap', { zone: z, zoneId: z.id, role: z.role, x, y });
        }
        chain.settled = true;
      }
      return true;
    },

    pointerMove(id, x, y) {
      if (!touch || touch.id !== id) return false;
      const t = now();
      touch.x = x;
      touch.y = y;
      touch.path.push({ x, y, t });
      if (touch.path.length > 240) touch.path.shift();

      const dx = x - touch.startX;
      const dy = y - touch.startY;
      const dist = Math.hypot(dx, dy);

      if (!touch.isDrag && dist > T.tapMaxDistPx) {
        // R1: this is a drag, so the tap chain dies and no tap/double tap can
        // fire from it. Steering can never be mistaken for a command tap.
        touch.isDrag = true;
        clearTimer('longPress');
        clearTimer('doubleTapHold');
        clearTimer('tapResolve');
        if (chain.count >= 1 && touch.tapCount === chain.count) chain.active = false;
        emit('dragStart', { zone: touch.zone, zoneId: touch.zone.id, role: touch.zone.role, x: touch.startX, y: touch.startY });
      }

      if (touch.isDrag) {
        emit('drag', { zone: touch.zone, zoneId: touch.zone.id, role: touch.zone.role, dx, dy, x, y });
        if (touch.zone.allowCircle && !touch.circleFired) {
          const circle = detectCircle(touch.path);
          if (circle) {
            touch.circleFired = true;
            emit('circle', { zone: touch.zone, zoneId: touch.zone.id, role: touch.zone.role, ...circle });
          }
        }
      }
      return true;
    },

    pointerUp(id, x, y) {
      if (!touch || touch.id !== id) return false;
      const t = now();
      const z = touch.zone;
      const dx = x - touch.startX;
      const dy = y - touch.startY;
      const dist = Math.hypot(dx, dy);
      const duration = t - touch.startT;
      const wasDrag = touch.isDrag;
      const wasLongPress = touch.longPressFired;
      // Captured before `touch` is cleared: the drag branch below has to be able
      // to emit the matching pressEnd.
      const pressStartWasFired = touch.pressStartFired;
      const tapCount = touch.tapCount;
      const circleFired = touch.circleFired;
      touch = null;

      clearTimer('longPress');
      clearTimer('doubleTapHold');

      // pressEnd must follow pressStart EXACTLY ONCE, whatever the gesture turned
      // out to be. It used to be emitted only for a press that was neither a drag
      // nor a long press, and the long-press branch returns before the drag branch
      // can run, so a slow steering drag emitted neither pressEnd nor dragEnd. On
      // the driving surface that left `holding` set with the throttle wide open
      // and the wheels still turned: the car accelerated away and kept turning
      // after every unhurried steering input.
      //
      // `pressStartFired` is only ever true for a zone with `hold`, so gating on it
      // is exactly the old `z.hold` check, minus the drag hole.
      if (pressStartWasFired) {
        emit('pressEnd', { zone: z, zoneId: z.id, role: z.role, x, y, durationMs: duration, tapCount });
      }

      if (wasLongPress) {
        emit('longPressEnd', { zone: z, zoneId: z.id, role: z.role, x, y, durationMs: duration });
        // A long press can also have been a drag, and the wheels need the same
        // release signal as any other drag.
        if (wasDrag) {
          emit('dragEnd', { zone: z, zoneId: z.id, role: z.role, dx, dy, dist, durationMs: duration, circle: circleFired });
        }
        chain.active = false;
        chain.count = 0;
        chain.settled = false;
        chain.emittedTap = false;
        return true;
      }

      if (wasDrag) {
        // R7: a recognised circular swipe consumes the gesture, so lifting the
        // finger afterwards must not also produce a swipe.
        if (z.allowSwipe && !circleFired && dist >= T.swipeMinPx && duration <= T.swipeMaxMs) {
          emit('swipe', {
            zone: z, zoneId: z.id,
            role: z.role,
            direction: classifySwipe(dx, dy),
            dx,
            dy,
            dist,
            durationMs: duration,
          });
        }
        // A swipe does NOT replace dragEnd. `dragEnd` is what tells the driving
        // input the finger has lifted so the wheels can self-centre; emitting a
        // swipe instead of it left `dragActive` set forever and the steering
        // frozen at whatever angle the finger happened to leave it at, so the car
        // kept turning after release. Most steering drags qualify as swipes, so
        // this affected nearly every steering input.
        emit('dragEnd', { zone: z, zoneId: z.id, role: z.role, dx, dy, dist, durationMs: duration, circle: circleFired });
        chain.active = false;
        chain.count = 0;
        chain.settled = false;
        chain.emittedTap = false;
        return true;
      }

      // A tap. If pointerDown already settled this chain (R3/R4/R6) we are done.
      chain.at = t;
      if (chain.settled) return true;
      if (brakeSuppressed) {
        chain.active = false;
        chain.settled = true;
        chain.emittedTap = false;
        return true;
      }

      if (z.immediateTap && tapCount === 1 && !chain.emittedTap) {
        // Responsive menus fire on lift, but the chain STAYS OPEN so a second
        // tap can still be reported as a double/triple tap plus tapSuperseded.
        emit('tap', { zone: z, zoneId: z.id, role: z.role, x, y });
        chain.emittedTap = true;
        setTimer('chainExpire', T.doubleTapWindowMs, () => {
          chain.active = false;
          chain.emittedTap = false;
        });
      } else if (!z.immediateTap && tapCount === 1) {
        // R2: this zone owns a double-tap meaning, so the single tap waits.
        setTimer('tapResolve', T.doubleTapWindowMs, () => resolveTapChain(z, x, y, tapCount));
      } else if (tapCount === 2) {
        // Second tap of a double-tap-and-hold zone, released before the hold
        // threshold: this is a plain double tap (second half of R4). Ordinary
        // zones already settled on pointerDown and never reach here.
        if (chain.emittedTap) emit('tapSuperseded', { zone: z, zoneId: z.id, role: z.role, x, y });
        emit('doubleTap', { zone: z, zoneId: z.id, role: z.role, x, y });
        chain.active = false;
        chain.settled = true;
        chain.emittedTap = false;
      } else {
        chain.active = false;
        chain.settled = true;
        chain.emittedTap = false;
      }
      return true;
    },

    pointerCancel(id) {
      if (touch && touch.id === id) {
        const z = touch.zone;
        if (z.hold && touch.pressStartFired) {
          emit('pressEnd', { zone: z, zoneId: z.id, role: z.role, x: touch.x, y: touch.y, cancelled: true });
        }
        if (touch.longPressFired) emit('longPressEnd', { zone: z, zoneId: z.id, role: z.role, cancelled: true });
        touch = null;
      }
      clearTimer('longPress');
      clearTimer('doubleTapHold');
      clearTimer('tapResolve');
      clearTimer('chainExpire');
      resetChain('cancelled');
      brakeSuppressed = false;
    },

    /** Advance pending timers. Called from requestAnimationFrame in the browser. */
    tick() {
      if (timers.length === 0) return;
      const t = now();
      const due = timers.filter((x) => x.at <= t);
      if (due.length === 0) return;
      timers = timers.filter((x) => x.at > t);
      due.sort((a, b) => a.at - b.at);
      for (const timer of due) {
        try {
          timer.fn();
        } catch (err) {
          console.error('[gestures] timer failed', err);
        }
      }
    },

    /** True while a finger is down. */
    get isTouching() {
      return touch !== null;
    },
    get currentZone() {
      return touch ? touch.zone.id : null;
    },
    get pendingTapCount() {
      return chain.active ? chain.count : 0;
    },
    get isBrakeSuppressed() {
      return brakeSuppressed;
    },

    /** Forget any in-flight gesture - used when the game changes screen. */
    reset(reason = 'reset') {
      touch = null;
      brakeSuppressed = false;
      timers = [];
      chain = { count: 0, zone: null, x: 0, y: 0, at: 0, active: false, settled: false, emittedTap: false };
      history.length = 0;
      void reason;
    },
  };

  function resolveTapChain(z, x, y, tapCount) {
    if (!chain.active || chain.settled) return;
    if (brakeSuppressed) {
      // R4: the double-tap-and-hold won, so braking must never also fire.
      chain.active = false;
      chain.count = 0;
      chain.settled = true;
      return;
    }
    const count = chain.count || tapCount;
    if (count >= 3) {
      if (chain.emittedTap) emit('tapSuperseded', { zone: z, zoneId: z.id, role: z.role, x, y });
      emit('tripleTap', { zone: z, zoneId: z.id, role: z.role, x, y, tapCount: count });
    } else if (count === 2) {
      // Reached when the zone suppressed the immediate double tap (R4) and the
      // hold threshold did not fire.
      if (chain.emittedTap) emit('tapSuperseded', { zone: z, zoneId: z.id, role: z.role, x, y });
      emit('doubleTap', { zone: z, zoneId: z.id, role: z.role, x, y });
    } else if (!chain.emittedTap) {
      emit('tap', { zone: z, zoneId: z.id, role: z.role, x, y });
    }
    chain.active = false;
    chain.count = 0;
    chain.settled = true;
    chain.emittedTap = false;
  }

  return api;
}

export { DIRECTIONS as SWIPE_DIRECTIONS };
