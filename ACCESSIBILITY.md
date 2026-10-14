# Accessibility

This game is built to be played **without sight**. This document describes Game
TalkBack, the gesture system, and the guarantees the code makes. Everything here
is implemented and tested, except where it says otherwise.

---

## 1. Game TalkBack

Game TalkBack is the game's **own** spoken guidance system. It drives the Web
Speech API directly and keeps its own priority queue.

**It does not require Android TalkBack, VoiceOver, or any device accessibility
service to be enabled.** That is the central requirement of this project and it
is met by `src/a11y/speech.js` calling `speechSynthesis` itself.

### What it announces

| Situation | Source of truth |
| --- | --- |
| Menus, focused controls, screen changes | The screen's own title and summary |
| Car selection, description, handling ratings | `carCatalog.js` `carAnnouncement()` |
| Garage prices, ownership, affordability, purchase results | `garage.js`, including every refusal and the balance left |
| Story dialogue and choices | The scene graph node actually being rendered |
| Interview questions, answers and scoring feedback | `interview.js` |
| Negotiation offers, counters and the recorded salary | `negotiation.js` |
| Track location, corner direction and severity | `navigationFacts()` from real geometry |
| Acceleration, braking, steering | The driving input state |
| Hazards: off track, too fast, barrier contact, wrong way | Physics and geometry, measured |
| Speed, lap, position, checkpoints, finish | `raceState.js`, which validates laps |
| Settings names, values and the result of each change | `settings.js` `setSetting()` |
| Errors and how to recover | The failing subsystem's own status message |

**No announcement is ever random or speculative.** A lap is announced only when
`raceState.js` has validated that every checkpoint sector was crossed in order.
An overtake is announced only when the recomputed running order actually changed.
A corner warning names the corner the geometry says is next, with the direction
the geometry says it turns.

### Graceful fallback

`speech.explainStatus()` returns a plain-language explanation for each failure
mode, and it is spoken and displayed:

- **No `speechSynthesis`** → "This browser does not provide speech synthesis…
  Every announcement is still shown as text in the caption area…"
- **No voices installed** → says so, explains that installing a language or TTS
  voice will enable speech, and that the game picks it up automatically.
- **Utterance error mid-session** → reports it once, keeps the text mirror alive,
  and suggests turning guidance off and on.

**Every spoken line is also written to an ARIA live region**
(`#live-region`, `role="status"`, `aria-live="polite"`). So a player who uses a
screen reader, or who has no voices, receives identical information.

### Long passages

Sentences are split at sentence boundaries (`splitForSpeech`) and queued in
order, so a long passage is never truncated and a safety warning can still land
between sentences. Chunks reassemble exactly — there is a test for it.

---

## 2. Settings

`src/a11y/settings.js` defines the schema. Every row announces its **name**, its
**current value**, and what changing it does. Every change is confirmed aloud
with the old value and the new value: *"Speech rate. 1.0 changed to 1.4."*

| Setting | Type | Default |
| --- | --- | --- |
| Game TalkBack | on/off | on |
| Speech volume | 0-100% | 100% |
| Speech rate | 0.6-1.8 | 1.0 |
| Speech pitch | 0.6-1.6 | 1.0 |
| Speech voice | device voices | device default |
| Concise speech | on/off | off |
| Music | on/off | on |
| Music volume | 0-100% | 50% |
| Sound effects | on/off | on |
| Sound effects volume | 0-100% | 85% |
| Navigation announcements | minimal / balanced / detailed | balanced |
| Corner warning distance | short (70 m) / normal (120 m) / long (190 m) | normal |
| Car pace | slower (0.8x) / normal / faster (1.18x) | normal |
| Race length | race default / 1 / 2 / 3 / 5 laps | race default |
| Spoken throttle feedback | on/off | on |
| Spoken speed and lap updates | on/off | on |
| Spoken race position | on/off | on |
| Spoken opponent warnings | on/off | on |
| Vibration feedback | on/off | on |
| Accelerate and brake pads | left / right hand | right |
| Camera shake | on/off | on |
| Text size | 90-160% | 100% |
| Hero name | text | Aarav |

Volumes for **speech, music and sound effects are independent**, which is what
keeps guidance intelligible over an engine. Independence is not enough on its
own, though: while an announcement is being spoken, the engine drops to 22%,
music to 16% and effects to 55% of their set volumes, and the **voice channel is
never attenuated**. The duck is held for the whole utterance and released only
when it finishes, so a long corner warning is not drowned out halfway through.

**Car pace** scales the player's car and the opponents by the same factor. That
is deliberate: slowing only the player would make *slower* mean *harder to win*.
The point is more time to react to a spoken warning, not a handicap.

**Race length** overrides how many laps a race runs, including practice. The race
start announcement is derived from the real lap count, so it always states the
distance the race will actually run.

### Turning Game TalkBack off never traps you

This is a hard requirement and it is implemented in three places:

1. `speechQueue.setEnabled(false)` drops queued **game** speech but **keeps
   essential items**.
2. `speakNow()` lets essential items through even when `talkback` is false.
3. The settings screen's own confirmations are all marked `essential`.

So after switching guidance off you still hear *"Game TalkBack is now off. This
settings screen will keep speaking so you are never stuck in silence."* and every
subsequent settings change. Three ways back in exist, because one is never
enough: the menu button, **double-tap-and-hold** on the settings gesture area,
and **F1** on a keyboard.

---

## 3. Gesture system

Full rules, thresholds and conflict resolution are in
**[docs/GESTURES.md](docs/GESTURES.md)**. Summary:

| Gesture | Where | Action |
| --- | --- | --- |
| Single tap | menu / list | Activate the focused control |
| Single tap | driving surface | Nothing (reserved — see rule R2) |
| Swipe up / down | menus | Move between options |
| Swipe left / right | car selection | Previous / next car |
| Swipe up / down | garage | Move between cars, tyres and the wash |
| **Press and hold** | driving surface | **Accelerate**; release coasts |
| **Double tap** | driving surface | **Brake** |
| Drag left / right | driving surface | **Steer, gradually** |
| Circular drag | driving surface | Request a U-turn (only where the track allows) |
| **Double tap and hold** | settings area | **Open Game TalkBack settings** |
| Three quick taps | Start Race control | **Nothing** — by design |

Steering is **never instant**. A drag sets a steering *target*; `drivingInput.js`
rate-limits the target, and `physics.js` rate-limits the front wheels again on
top of that. Full lock needs about 130 CSS px of drag. Release and the wheels
self-centre gradually. A U-turn is performed with real steering, never by
teleporting the car sideways.

### No control is discoverable only by swiping

The gestures are announced in full **before the first race can start**
(`firstRunAnnouncement` in `src/main.js`), taught step by step in the gesture
tutorial (chapter 6), and available as keyboard equivalents
(`keyboardHelpLines()` in `src/input/keyboard.js`). The tutorial has a *practice
on the empty circuit* option: no opponents, no timing, unlimited recovery.

### Chapter 7 is gated on evidence

The tutorial records which gestures you **actually performed**
(`createTutorialHarness`). `controlsUnderstood` is only set when the accelerating,
coasting, braking, steering, U-turn and settings-access steps have all been
demonstrated. Chapter 7 refuses to start a race until then, and says why.

---

## 4. Announcement discipline

`src/a11y/speechQueue.js` prevents the interrupt-spam that ruins audio games:

- **Five priority levels**: ambient, low, normal, high, critical.
- **Per-message cooldowns**, keyed, so the same corner warning cannot nag.
- **Frequency setting** scales every cooldown: minimal ×1.75, balanced ×1.0,
  detailed ×0.7.
- **Warning distance setting** moves corner announcements to 70 / 120 / 190 m.
- **Bounded queue** (12). When full, the *least* important queued line is
  dropped — never the more important arrival, and never the start of a passage.
- **Preemption**: a critical warning cancels lower-priority speech; equal or
  lower priority never interrupts.
- **Ducking**: while speech is active, music drops to 22% and engine to 30%,
  then recovers (`DUCK_LEVELS` in `src/core/audio.js`).

Off-track recovery guidance is marked `essential`, so it survives even a player
who has turned guidance off — being stranded in a gravel trap with no information
is a safety problem, not a preference.

---

## 5. Keyboard, focus and layout

- Every interactive control is a real `<button>`, so native focus, Tab order and
  screen-reader focus all agree with the game's own focus ring.
- `:focus-visible` draws a 3 px amber outline with a 6 px halo.
- Touch targets are at least 48 px; 44 px for secondary controls.
- A skip link jumps to the game controls.
- Swipe up/down moves the focus ring, which is the touch equivalent of Tab.
- **Window blur releases the throttle and the brake.** A player who switches apps
  never comes back to a car on full lock.
- `prefers-reduced-motion` disables animation; camera shake is a setting.
- Text size scales the whole interface from 90% to 160% via `--text-scale`.
- The HUD keeps a caption strip showing the last spoken line, and an
  `aria-live="polite"` speed/lap/position sentence.

### Keyboard map

| Key | Action |
| --- | --- |
| W / ↑ | Accelerate (hold) |
| S / ↓ / Space | Brake or reverse |
| A / ← , D / → | Steer left / right, gradually |
| U | Request a U-turn |
| R | Recover onto the track |
| Enter | Activate the focused control |
| Tab / arrows | Move between controls |
| Escape | Back (or pause while racing) |
| H | Repeat the last announcement |
| M | Toggle Game TalkBack |
| **F1** | **Open voice settings from anywhere** |
| P | Pause |

Typing in a text field is never hijacked (`allowInField` in
`src/input/keyboard.js`).

---

## 6. Recovery and fairness

- Off track: the voice names **which side** you left the track on and **which way
  to steer** back, converted into the car's own frame using the heading error.
- Stop off track, go past the level's recovery margin, or press R, and the
  marshals place you back on the racing line **facing the right way** at a gentle
  speed. You are never left stuck and never dropped at a standstill in a corner.
- A failed race still awards experience for the laps you completed.
- An abandoned race is recorded as *not finished* — it is never reported as a
  result you did not earn.
- A corrupted or hand-edited save is repaired and the repairs are announced, so a
  broken file cannot brick the game or silently grant progress.

---

## 7. What is not done

- **No braille display support** beyond whatever the device screen reader does
  with the live region.
- **No subtitles for the recorded voice samples.** The Kenney voiceover clips
  ("Three", "Two", "One", "Go", "correct", "wrong") play as audio; the equivalent
  words are also spoken by Game TalkBack and written to the caption strip, so the
  information is not lost, but the samples themselves are not captioned
  individually.
- **No high-contrast or colour-blind theme.** Contrast is high by default and the
  HUD is not colour-coded alone (position and lap are numeric), but there is no
  theme switch.
- **Not verified with a real screen reader on a real device.** See
  [docs/TESTING.md](docs/TESTING.md).
