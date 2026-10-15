# Gestures: map, thresholds and conflict resolution

The recognizer is `src/input/gestures.js`. It is a **pure deterministic state
machine** with no DOM dependencies: you feed it pointer samples in CSS pixels and
a clock, it emits gesture events. That is why it can be tested with a virtual
clock, and why every rule below is asserted by `tests/gestures.test.mjs`.

Wiring lives in `src/input/pointerBus.js` (real pointer events → recognizer),
`src/input/drivingInput.js` (gesture events → throttle/brake/steer) and
`src/main.js` (gesture events → screen actions).

---

## Gesture map

| Gesture | Zone | Emits | Game action |
| --- | --- | --- | --- |
| Press and hold | driving surface | `pressStart` on contact, `pressEnd` on lift | **Accelerate** while held; release **coasts** |
| Single tap | driving surface | `tap` | **Brake** (held ~620 ms, like a pedal tap; announced "Brake") |
| Tap twice quickly | driving surface | `doubleTap` | **Brake too** — play-testing showed people instinctively double-tap to brake |
| **Tap twice and hold** | driving surface | `doubleTapHold` | **Handbrake / drift** (1.1 s burst; the rears lock and the car slides) |
| Drag left / right | driving surface | `dragStart`, `drag`, `dragEnd` | **Steer gradually** toward the drag offset |
| Circular drag | driving surface | `circle` | **Request a U-turn** where the track allows it |
| Swipe straight down (`\|dx\| ≤ 60`) | driving surface | `swipe` (`direction: 'down'`) | **Reverse** for 1.8 s, then stop on its own |
| **Swipe down-and-left / left / up** | driving surface | `swipe` | **Open the race menu** (coins, repair, petrol, settings, where am I…) — the race pauses behind it |
| **Swipe down-and-left** | anywhere else | `swipe` | **Open the quick menu** — chapters, garage, story, everywhere (where am I, coins, experience, settings, how to play, garage, main menu, exit) |
| **Swipe up-and-left** (or up, then left within 450 ms) | anywhere | `swipe` | **Go back** — close the open menu, leave the screen, or open the race menu while driving |
| Single tap | menu / list / menu panel | `tap` | **Select** the button under the finger and say its name — a tap NEVER activates |
| **Double tap** | menu / list / menu panel | `doubleTap` | **Activate the selected control** (the TalkBack rule the player asked for) |
| Swipe up / down | menu / list | `swipe` | Move the focus ring |
| Swipe left / right | car browser | `swipe` | Previous / next car |
| **Tap twice and hold** | settings hotspot | `doubleTapHold` | **Open Game TalkBack settings** |
| Tap three times | any | `tripleTap` | **Nothing** — see rule R6 |
| Long press | settings hotspot | `longPressStart` | Open Game TalkBack settings (alternative) |

Every gesture has a keyboard equivalent in `src/input/keyboard.js`; see
[ACCESSIBILITY.md](../ACCESSIBILITY.md#keyboard-map). While racing, **double
tap and hold is the handbrake and must never open a menu over a moving car**;
the race menu is the down-and-left swipe, and the pause menu is Escape, P, or
the Pause button.

**Brake and handbrake are two different controls.** One tap - or a quick double
tap - is the brake: a pedal tap, held briefly and released, and always announced
("Brake") with its own recorded sound. Double tap and HOLD the second tap pulls
the handbrake: the physics lose rear grip and the car slides, so the held double
tap is the drift input. Each press is talked back ("Brake", "Handbrake") and has
its own recorded sound effect, so the player always hears which control they
just used. The recognizer separates them (R2/R4): a quick double tap resolves as
the double tap when the second contact lifts inside `doubleTapHoldMs`, and only
the hold past that threshold is the handbrake.

**Reverse is a swipe, not a held control.** The physics model already reverses
when throttle and brake are applied together below the standstill threshold, but
no thumb can hold the screen for throttle and tap the brake at the same time, so
reverse would be unreachable on a touch device. A mostly-vertical downward swipe
applies that combination for 1.8 seconds and then releases it, so the car cannot
be left stuck in reverse. It is announced once, and steering keeps working while
it runs so the car can be aimed. A swipe that also travels left (`dx < -60`) is
the **down-and-left** menu gesture and must not throw the car into reverse -
`REVERSE_MAX_DX` in `drivingInput.js` is the guard.

---

## Thresholds

`GESTURE_DEFAULTS`, overridable per instance:

| Threshold | Value | Purpose |
| --- | --- | --- |
| `tapMaxMs` | 320 ms | Longer than this is a hold, not a tap (accessibility-sized) |
| `tapMaxDistPx` | 24 px | Further than this is a drag, not a tap |
| `doubleTapWindowMs` | 400 ms | Gap allowed between taps in a chain (deliberate double taps are slow) |
| `longPressMs` | 500 ms | Hold with no movement |
| `doubleTapHoldMs` | 300 ms | Second tap of a chain held this long |
| `swipeMinPx` | 34 px | Minimum travel to be a swipe |
| `swipeMaxMs` | 900 ms | Slower than this is a drag, not a swipe |
| `swipeDominance` | 1.35× | One axis must dominate the other |
| `circleMinTurnDeg` | 300° | Accumulated turn to count as a circle |
| `circleMinRadiusPx` / `Max` | 22 / 260 px | Rejects dots and whole-screen sweeps |
| `circleTolerancePx` | 60 px | How uneven the radius may be |
| `circleMinPathPx` | 120 px | Minimum path length |

Zones carry flags that change how taps resolve: `immediateTap`, `hold`,
`doubleTapHoldTarget`, `allowCircle`, `allowSwipe`, `preventScroll`, `role`.

---

## Conflict resolution rules

These are authoritative. Each has a test.

**R1 — Drag beats tap, with a wobble allowance.** A contact that travels more
than `tapMaxDistPx` before lifting starts a *drag*. A drag that travels less
than `swipeMinPx` and never circles is still a **tap with a wobble**: it emits
`dragEnd` (so steering re-centres) and then resolves as a tap. Play-testing
showed why this matters: a real thumb drifts, and without the allowance those
contacts were classified as drags and the tap — the brake — was silently
dropped. A genuine drag or swipe still kills the tap chain: steering can never
be misread as a command tap.

**R2 — Single-tap latency is zone-dependent.** A zone flagged `immediateTap`
(menus, lists, **and the driving surface**) fires `tap` on lift: responsive. The
brake is a safety control and must land the instant the finger lifts. Zones that
suppress the immediate tap (the settings hotspot) still delay it by
`doubleTapWindowMs`. Tap and double tap now mean the same thing on the driving
surface (both brake), so there is nothing left to disambiguate and nothing to
wait for.

**R3 — A second contact inside the window is a double tap.** The chain stays open
after an immediate tap so a second tap can still be reported. When that happens,
`tapSuperseded` is emitted first so the consumer can undo the single tap's
effect. The chain does *not* close on the first tap — closing it was a bug that
made double and triple taps unreachable in menus.

**R4 — Double-tap-and-hold wins over brake.** On a `doubleTapHoldTarget`, if the
second contact is still down after `doubleTapHoldMs`, `doubleTapHold` fires and
`brakeSuppressed` is set, so the `doubleTap` (brake) is suppressed on lift.
Releasing the second tap *early* produces a plain `doubleTap` instead. The
settings gesture can therefore never accidentally brake the car, and braking can
never accidentally open settings.

**R5 — A hold after a completed double tap is a long press**, not a third tap and
not a brake. `longPressStart` only arms on a fresh single contact.

**R6 — Three taps never activate.** A third tap inside the window emits
`tripleTap` and suppresses both the pending tap and the double tap. **The Start
Race control is deliberately a non-`immediateTap` zone**, so three rapid taps on
it produce exactly one `tripleTap` and **zero** activations. This is structural,
not a heuristic: there is no code path from three taps to a race start. The game
also says so out loud when it happens, rather than staying silent.

**R9 — `pressEnd` follows `pressStart` exactly once.** For any zone with `hold`,
on contact the recognizer emits `pressStart`, and on release it emits `pressEnd`
regardless of what the gesture turned out to be: tap, drag, swipe, long press or
circle. Getting this wrong in any direction is severe. Emitting it only for
non-drag presses left the throttle pinned wide open and the wheels still turned
after any steering input; emitting it twice made the hold state flicker. The
emission happens once, before the gesture branches, gated on `pressStartFired`.

**R7 — A circle consumes the gesture.** Circle detection runs while the finger is
still down. Once `circle` fires, lifting the finger emits `dragEnd` and **not**
`swipe`, so a U-turn request cannot also move the menu focus.

**R8 — Only the first contact is tracked.** Extra fingers are ignored, never
averaged. A palm resting on the screen while a thumb steers cannot brake the car,
change the steering target, or fire a tap.

---

## Implementation notes worth knowing

Four stale-state bugs were found by the tests and fixed. They are recorded here
because they are easy to reintroduce:

1. `setTimer` clears by tag, so a newer pending tap silently swallowed an
   earlier unresolved one. `flushTimer()` now *runs* a due timer instead of
   discarding it.
2. A `chainExpire` timer left over from a previous chain killed the next chain.
   It is cleared when a new chain starts.
3. A pending `tapResolve` could fire mid-hold on the settings hotspot and emit a
   spurious `doubleTap`. It is cleared as soon as `chain.count >= 2`.
4. `immediateTap` originally closed the chain, so double and triple taps could
   never accumulate in menus. The chain now stays open with `settled` /
   `emittedTap` flags and emits `tapSuperseded`.

`pointerCancel` releases any held accelerate pad. Window blur does too
(`src/input/keyboard.js`), because a player who switches apps must not come back
to a car on full throttle.

`src/input/pointerBus.js` suppresses the synthetic `click` that follows a touch
tap within 500 ms of a recognized gesture, so a tap never activates a control
twice.

---

## Testing

`tests/gestures.test.mjs` — **26 tests**, all passing. It drives the recognizer
with a virtual clock and synthetic pointer sequences, and asserts each rule above
individually, including:

- drag versus tap at exactly `tapMaxDistPx`
- immediate-tap zones firing on lift, and `tapSuperseded` on a following tap
- delayed single tap resolving after `doubleTapWindowMs`
- double-tap-and-hold firing at `doubleTapHoldMs` and suppressing the brake
- early release of the second tap producing a plain double tap
- hold after a completed double tap being a long press
- three taps producing `tripleTap` and no `tap`
- circle detection consuming the swipe
- a second finger being ignored
- cancel releasing a held pad

`tests/dom.smoke.test.mjs` then proves the wiring: a `gesture:tap` on a zone
element clicks the real button, a `gesture:swipe` moves the real focus ring, and
a `gesture:tripleTap` on the Race control produces **zero** clicks.
