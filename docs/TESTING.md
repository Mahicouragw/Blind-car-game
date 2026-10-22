# Testing

**Nothing in this document is claimed as tested unless it was actually executed.**
Where something could not be run in this environment, it is listed under
*Not tested* with the reason and how to test it yourself.

---

## Latest phone-tap, audio and loot regression run

- `npm test`: **385 tests, 385 pass, zero failures**, Node 20.20.2 / jsdom 26.
- New adapter tests dispatch actual DOM events, including the phone's
  `pointerup → lostpointercapture → pointerout → pointerleave` sequence, mixed
  compatibility streams, ignored second fingers, legacy touchend with another
  finger still down, a true cancellation, and a slower cross-button double tap.
- Full app tests cover DOM-origin menu activation, auto-aim sword attack, sit,
  heal without spurious “Standing”, and saved coins/XP/level/potion rewards.
- **Executed Chromium with Playwright, Pixel 7 mobile/touch emulation:** real
  `touchscreen.tap()` calls opened the Forest menu, started play, attacked a
  left-side monster, sat, healed once, killed the monster, awarded XP and stopped
  music on Exit. All four new MP3s decoded successfully; no page exceptions.
- **Negative control executed:** substituting the pre-fix `pointerBus.js` and
  `gestures.js` reproduced the failure in that same Chromium test: the menu did
  not activate on double tap. The observed finger-lift stream included
  `pointerleave`, exactly as the regression explains.
- This is browser automation, **not physical Android/TalkBack or audible
  speaker/headphone verification**. Those hands-on checks remain outstanding.

## Previous easy-play and lifecycle regression run

- `npm test`: **367 tests, 367 pass, zero failures**, Node 20.20.2 with jsdom 26.
- `npm run validate`: original circuit geometry gate passed.
- Added model and full application/recognizer tests for all three easy areas,
  3+ second hold timing, short-hold and tap stops, deferred triple-tap healing,
  real fuel exhaustion and refill, cursor retention over a different button,
  coin/quest rewards, health, city purchases, save round-trip, background freeze,
  Exit silence and late ambience-download cancellation.
- Real Android audio hardware, TalkBack interaction and hands-on phone usability
  have **not** been tested in this environment. Automated tests are not a
  substitute for that play-test. See [EASY-PLAY.md](EASY-PLAY.md) for the new modes.

The table below is the older baseline and is kept for historical context.

## Executed

```bash
npm test          # 307 tests, 307 passing
npm run validate  # track geometry gate
npm run map       # regenerates docs/circuit-map.svg
```

Last run: **307 tests, 307 pass, 0 fail**, Node v22.22.3, ~20 s.

| File | Tests | Covers |
| --- | --- | --- |
| `tests/gestures.test.mjs` | 26 | Gesture recognizer, rules R1–R8 |
| `tests/settings.test.mjs` | 44 | Settings state, coercion, the speech queue, speech chunking, Car pace, Race length |
| `tests/race.test.mjs` | 44 | Lap counting, checkpoints, race completion, positions, navigation, physics, AI, pace-scaled vehicle specs |
| `tests/story.test.mjs` | 47 | Story branching, interview scoring, negotiation, saving, progression |
| `tests/dom.smoke.test.mjs` | 24 | Boots the real game in jsdom and drives it with gesture events |
| `tests/garage.test.mjs` | 21 | Pricing and every refusal path, tyre grip measured through the real physics step, save round-trip and tamper rejection, and grime reaching the car's materials |
| `tests/publish.test.mjs` | 37 | Deployment safety: relative asset paths, the module graph, what the staged artefact does and does not contain, the dev server's path guard over a real socket, and the post-deploy verifier in both directions |
| `tests/audio.test.mjs` | 26 | The audio mix against a fake Web Audio graph: no speech-driven gain changes, independent manual volumes and horn lifecycle, engine response to rpm, load and road speed, lazy loading of the music beds, and per-track licence and attribution obligations |
| `tests/music.test.mjs` | 16 | The music director: scene and chapter to track mapping, deliberate silence, settings interaction, and teardown |
| `tests/integration.test.mjs` | 23 | **No mocks**: real touch events through the real recognizer, onto the real bus, into the real driving input. Holding applies throttle, releasing cuts it, a single tap and a quick double tap both brake, a double-tap-and-hold pulls the handbrake, dragging steers gradually, the wheel self-centres, swiping down reverses, a circle asks for a U-turn, menu gestures never touch the car, and pressEnd follows pressStart exactly once for every kind of press |
| **Total** | **307** | |

`npm run validate` reports **"Track geometry OK."** — the lap closes to 0.070 m
with exactly −360° of total turn, has no self-intersection, and keeps every pair
of non-adjacent centre-line points at least 27 m apart.

All logic modules are pure ES modules with no DOM, WebGL or Web Audio access at
import time, which is why 283 of these tests run headless in Node with no
browser. The remaining 24 run in **jsdom** (dev-only dependency).

---

## What each requirement is covered by

### Gesture recognizer — `tests/gestures.test.mjs`

Every rule in [GESTURES.md](GESTURES.md) is asserted individually: drag beats tap
at exactly `tapMaxDistPx`; immediate-tap zones fire on lift and emit
`tapSuperseded` when a second tap follows; delayed single taps resolve after
`doubleTapWindowMs`; double-tap-and-hold fires at `doubleTapHoldMs` **and
suppresses the brake**; releasing the second tap early yields a plain double tap;
a hold after a completed double tap is a long press; **three taps produce
`tripleTap` and zero `tap`**; a circle consumes the swipe; a second finger is
ignored; cancel releases a held accelerate pad.

`tests/dom.smoke.test.mjs` then proves the *wiring*: a `gesture:tap` on a zone
element clicks the real button, a `gesture:swipe` moves the real focus ring, and
a `gesture:tripleTap` on the Race control produces **zero** clicks.

### Settings state — `tests/settings.test.mjs`

Schema completeness (every key has a default, a label and an announce function);
`coerceSettings` rejects garbage, clamps ranges, falls back to real enum options,
strips markup from the hero name, drops unknown keys and **reports what it
rejected**; `setSetting` reports name, old value, new value and whether it
changed; `stepSetting` clamps at both ends without wrapping; `cycleSetting`
cycles enums and toggles booleans; warning distances are ordered; announcement
frequency factors scale cooldowns.

### Announcement discipline — `tests/settings.test.mjs`

Priority ordering regardless of arrival order; oldest-first within a priority;
nothing taken while something is speaking; per-key cooldowns actually block and
actually expire; critical warnings have no default cooldown; the frequency setting
scales cooldowns; **turning Game TalkBack off drops game speech but keeps
essential speech**; a critical warning preempts lower-priority speech; an equal or
lower priority warning never interrupts; a bounded queue drops the **least**
important item and refuses a weaker arrival; concise mode substitutes the short
wording; empty text is refused; long passages split at sentence boundaries and
**reassemble exactly**.

### Lap counting and race completion — `tests/race.test.mjs`

The grid is staggered and inside the grid zone. A full lap of the **real
centre-line** counts exactly one lap and proves every checkpoint sector. Two laps
finish at the right time with the right position. **Driving backwards over the
line counts nothing** (heading alignment decides, because arc length alone cannot
distinguish the two). **Cutting across the infield is rejected** for missing
checkpoints. Laps are not counted before the race starts. Positions follow real
distance, not the starting grid. A finished car always outranks one still running.
**Finish order is the order cars actually crossed the line.**

### Navigation announcements — `tests/race.test.mjs`

Facts come from real geometry for every corner zone. The next corner reports the
true direction, severity and distance. **The U-turn and the hairpin get distinct
spoken callouts.** Every corner warning states the real direction and never
mentions the opposite one. Going off track produces a recovery direction, and it
is the correct one. "Too fast" is only reported when the car genuinely cannot make
the corner. Bearings are computed in the player's frame.

A corner is called **once at 500m and once at 50m**, with no intermediate chatter. Legacy warning-distance preferences cannot add extra calls. An overtake is
announced **only when the position really changed**. A lap is announced **only
when the lap count really increases**. Off-track guidance is essential and repeats
only after a pause. Opponents are announced with their real name, side and closing
speed, and do not nag. Concise speech shortens the wording. The countdown lines
are Three, Two, One, Go.

### Physics — `tests/race.test.mjs`

**Steering never moves the car sideways instantly**: one frame of full lock at
100 km/h moves the car less than 0.35 m laterally, the wheel angle is rate
limited, and the resulting lateral load stays inside the tyre limit. Acceleration,
top speed and a controlled 100 km/h stopping distance are all in plausible bands.
Grip is finite — the car scrubs speed rather than holding an impossible line. A
barrier collision kills most of the speed and pushes the car *away* from the
barrier. Driving away from a wall is not a collision. **Respawn puts the car back
on the racing surface facing the right way** at a gentle speed. Track, kerb,
grass, gravel and pit lane are all distinguished.

### Opponents — `tests/race.test.mjs`

An opponent **stays on the circuit for a whole lap** within tolerance and never
reaches the barrier line. An opponent **completes a validated lap** in the race
state in a plausible time. Opponents do not occupy the same space as each other,
and contact costs both cars speed. The difficulty curve is asserted: level 1
gives extra grip, steering assist and strong rubber-banding so it is winnable;
level 4 has no assist, more opponents, more laps and faster opponents. **Every
opponent in every level drives a real car from the catalogue**, with a sane skill
and no duplicate names within a level.

### Story branching — `tests/story.test.mjs`

Every chapter declares an entry node that exists. **Planned chapters are labelled
not-playable and cannot be entered**, and their placeholder nodes say so honestly.
Every node reference in the graph resolves. Chapters 1–7 are gated in order. **The
whole campaign is walked end to end** from chapter 1 to chapter 7 through the
interview, negotiation, tutorial and race hand-offs, and all seven chapters
complete. **Different choices produce different recorded state.** The chapter 2
failure branch offers both a retry and an alternative route. Walking away from the
negotiation routes to the alternative branch; staying routes to the signed branch.
Placeholders resolve from state including the configured hero name. **Names are
sanitised so markup cannot reach speech or the DOM.** `applyEffects` never mutates
the previous state. **Joseph and Mithin are separate consistent characters.** The
racing invitation asks the question the brief specifies.

### Interview scoring — `tests/story.test.mjs`

Every question has one strong, one middling and one weak answer, and **each
explanation is substantive** (at least two sentences, not just a verdict). Strong
answers pass, weak answers fail, middling answers are **mixed and earn follow-up
questions**, and follow-ups are scored the same way and merged. Each answer is
individually scoreable; unanswered questions score zero. The evaluation reports
per-question feedback explaining why each answer worked.

### Salary negotiation — `tests/story.test.mjs`

**A strong interview produces a better opening offer than a weak one.** Story
state changes the leverage and every leverage source is explained. **The accepted
salary is recorded and reused.** Asking above the ceiling is refused and
countered, not granted. Pushing too hard with no goodwill can reduce the offer.
Asking about conditions rather than money improves the offer. Negotiation is capped
at three rounds, and running out of rounds still leaves a figure — never a hole.
Figures stay inside the stated market band. Money is spoken as words, not digits.

### Progress saving — `tests/story.test.mjs`

A fresh save has sane defaults. **Progress survives a round trip through storage**,
including chapters, salary, flags, relationships and the interview result. **Story
state survives a refresh and resumes the right chapter.** A corrupted save is
**repaired rather than crashing** — non-numeric XP becomes 0, an unknown car falls
back to a starter, markup is stripped from the name, a non-array chapter list is
emptied, and the repairs are reported. Unparseable storage falls back to a new
game. **The game still runs when storage is unavailable.** **A save cannot grant a
car the player has not earned** — level is derived from XP, never trusted from the
file. Clearing storage removes the save.

### Progression — `tests/story.test.mjs`

XP thresholds increase and levels are derived. **Rewards scale with the result and
are deterministic.** Applying rewards can level the player up and unlocks cars.
Difficulty increases gradually across all four levels. Every achievement has a
name, a spoken line and a dedicated sound. The car catalogue is complete and **no
two cars share the same mass, top speed and grip**.

### The browser surface — `tests/dom.smoke.test.mjs`

The game **boots into an announced main menu** with every required entry. The menu
announces itself. **The welcome explanation covers every gesture before any
race**, including that three quick taps never start one. Speech-unsupported devices
get an explanation, not silence. Swiping moves focus and announces the new control.
A tap activates the real button underneath. The tutorial lists every gesture and
**refuses to finish early**. Demonstrating a gesture is what unlocks a step. **A
triple tap on a menu control never activates it.** Game TalkBack settings opens,
and **turning guidance off still confirms aloud and never silences the settings
screen** — non-essential speech is refused while essential speech still gets
through. A saved setting survives a reload. **Unplayable chapters are labelled and
cannot be entered.** Story chapter 1 renders and branches on a real choice. The
hero name is sanitised before it reaches speech or the DOM. The car preview
degrades when WebGL is unavailable, and **opening car selection without WebGL no
longer throws**: it opens, says why there is no picture, and stays fully operable
by button and by swipe. **Starting a race without WebGL explains the limitation
instead of white-screening.** The garage is reachable from the menu, lists every
car with its price, **charges the coins and makes the bought car selectable
without a reload**, **refuses a purchase the player cannot afford without
changing anything**, and never offers a car already owned or a wash with nothing
to clean.

### Announcement discipline — the queue — `tests/settings.test.mjs`

The bug this exists for: a driving announcement is offered every animation frame,
and the per-key cooldown only knew about messages already SPOKEN — pending copies
were invisible to it. Sixty frames of "You are going left" queued **twelve
identical copies**, and the player then heard the car going left for half a
minute while it was actually going right. Now:

- **Latest wins.** A newer message with the same key replaces the waiting one
  instead of joining it. Sixty frames leave one message, and turning right
  replaces a stale "going left".
- **Different keys are not collapsed.** A corner warning and an opponent callout
  both survive.
- **Messages have a shelf life by priority.** A queued NORMAL driving line is
  dropped after roughly five seconds rather than delivered late and wrong; a
  CRITICAL safety message is still worth saying much later. A dropped-late
  message is counted as stale, never as spoken.
- **A hard interrupt cuts through regardless of priority.** Priority 4 cannot
  preempt priority 4, which is how every story passage a player tapped past
  stayed queued and was read out afterwards. `hardInterrupt` is the explicit
  exception, and the check scans the whole queue rather than the head, because a
  hard interrupt can be sitting behind an equal-priority item.
- **The chunks of one passage never replace each other.** A passage is spoken
  sentence by sentence sharing one group; only a DIFFERENT reading of that group
  may replace. Getting this wrong collapsed a six-sentence paragraph to its last
  sentence, which a test caught.

### The garage — `tests/garage.test.mjs`

Prices are derived from the unlock level, and a car that is not in the catalogue
has **no price rather than being free**. Buying deducts the coins, adds the car to
the selectable list and leaves the original profile untouched. Buying early works
**and the level route is not taken away**. Refusals — already owned, too
expensive, a downgrade, an unnecessary wash, an unknown item — each change nothing
and **every spoken reply is a finished sentence naming the balance**, with no
`undefined` in it anywhere. Tyres are proved to be real rather than cosmetic by
**measuring through the physics step**: the same manoeuvre on slicks holds 44.4
kph against 42.4 kph on standard tyres, and a 60 m corner has a higher maximum
speed. Bought cars, tyre tier and grime survive a save and a reload, and an edited
save **cannot conjure a car, an impossible grip value or a negative or oversized
grime figure**. Grime reaches the car's materials — the paint dulls and roughens,
the tyres, rims and lights are untouched — and a wash restores the original finish
exactly.

### Deployment safety — `tests/publish.test.mjs`

The failure mode this suite exists for is a site that passes every local check
and then 404s in production, because Pages serves from the sub-path
`/Blind-car-game/` while the dev server serves from `/`. It asserts that
`index.html` and every module and stylesheet contain **no absolute-root URL**,
that nothing builds a URL from `location.pathname`, `document.baseURI` or
`import.meta.url`, that **all 75 audio manifest entries are relative and exist
on disk**, that **every relative import across `src/` resolves**, and that
vendored Three.js ships **both** of its chunks — `three.module.js` imports
`./three.core.js`, and vendoring only the first gives a blank canvas with no
obvious error.

The second half drives the **real dev-server request handler over a socket**,
because the guard that stops `.git/config` reaching a browser must not be
allowed to regress into a comment. It reproduces the encoded-traversal bug that
was actually found and fixed: decoding `%2e%2e` yields `../..`, `normalize()`
collapses it, and the result *looks* like a legitimate path inside the root, so
a containment check alone is not enough. Requests are sent with `node:http`
rather than `fetch` on purpose — the WHATWG URL parser treats `%2e%2e` as a
double-dot path segment and would silently rewrite the attack before it reached
the server.

All three mutations were verified to be caught: removing the dotfile-segment
check fails the traversal test, making `index.html` reference `/src/main.js`
fails two tests, and pointing one manifest entry at a missing file or an
absolute path fails three.

---

## Track geometry gate — `npm run validate`

Fails the build on:

- a lap that does not close (position error > 1 m or heading error > 0.5°)
- total turn that is not exactly ±360°
- **any centre-line self-intersection**
- **any pair of non-adjacent centre-line points closer than 27 m** (track width
  13 m plus a grass strip), so two parts of the lap can never be within a
  car's width of each other
- a grid slot outside the grid zone
- a pit lane that crosses the racing line
- missing corner zones, braking zones or checkpoints

Current result: **Track geometry OK.** Lap 3,312 m, closure 0.070 m, −360.0°,
12 corner zones (5 left / 7 right), 2 reversals, 29 zones total.

---

## Not tested — and how to test it

These were **not executed**. They are listed as untested, not as passing.

### 1. Real Android Chrome touch behaviour — **UNTESTED**

**Why:** the build sandbox has no browser and no device. jsdom simulates the DOM
but not touch hardware, scroll physics, `pointer` event coalescing, or a real GPU.

**How to test:** open the preview on Android Chrome. Check, in order:

1. Tap once — audio unlocks and the welcome speaks.
2. Menu: single tap activates; swipe up/down moves focus; the focused control has
   a visible amber ring.
3. Car selection: swipe left/right on the preview changes cars and the 3D model
   changes with it.
4. Settings: toggle Game TalkBack off. **Confirm the screen keeps speaking.**
   Turn it back on.
5. Tutorial: press and hold on the driving surface (accelerate), release (coast),
   double tap (brake), drag left/right (steer), draw a circle (U-turn).
6. Triple tap the Race control. **Nothing should happen** except a spoken
   explanation.
7. Start a race: watch the five lights and listen to "Three, two, one, go" —
   **they must be the same instant**.
8. Drive a lap. Confirm corner warnings name the real next corner and direction.
9. Deliberately drive off track. Confirm the recovery guidance names the correct
   side and direction, and that a crash/stranding stops and selects Try again. Verify nothing restarts until you activate it.
10. Rotate the device and resize. Confirm the HUD, minimap and gesture zones
    follow.
11. Switch apps mid-race and come back. **The throttle must be released** and the
    race paused.
12. Finish. Confirm the result matches where you actually crossed the line.
13. Refresh. Confirm your chapters, level, car and settings are restored.

### 2. Physical-device 3D rendering — **UNTESTED** (software-WebGL smoke verified below)

**Why:** the sandbox smoke uses software WebGL, not a physical phone GPU. The scene graph, geometry, materials, lighting
and object counts are all constructed and asserted headless (896 scene objects,
~316 draw calls, 11 instanced meshes), but **the drawn image was never observed**.

**How to test:** load the page, start any race, and check that the road ribbon,
kerbs, gravel traps, barriers, tyre walls, fencing, grandstands, spectators,
officials, sponsor boards, distance boards, direction arrows, start gantry, five
lights, lap board, pit lane, garages, paddock buildings, harbour, skyline, cranes
and shadows are all visible and correctly placed relative to the centre-line.
Watch the frame rate on a mid-range phone; drop to `low` quality in
`pickQuality()` if needed.

### 3. Web Speech on a real device — **UNTESTED**

**Why:** jsdom has no speech synthesiser; the tests use a fake one.

**How to test:** confirm a voice is picked, that rate/pitch/volume apply, that
interrupts actually cut off the previous utterance, and that engine/music/effects stay steady throughout speech, with no dip or recovery rise. Then remove all TTS voices from the device
and confirm the fallback message appears **and** the caption strip still shows
every line.

### 4. Web Audio playback of the recorded samples — **UNTESTED**

**Why:** no audio device in the sandbox. The manifest paths were verified against
the files on disk and every audio file is served with the right MIME (`audio/ogg`
for the effects, `audio/mpeg` for the music beds), but actual
playback was not heard.

**How to test:** confirm the engine loop's pitch rises with rpm, the two layers
crossfade, tyre squeal tracks slip, the gear-change click is audible, impacts are
graded by severity, the horn sounds recorded and stops on release, and music does not change with speech. Then block one asset in devtools
and confirm the game reports it missing, stays silent for that sound, **does not
substitute anything**, and remains playable.

### 5. GitHub Pages deployment

**Deployed, and verified against the live URL.** The workflow's execution result
is always read from the real API, never assumed: run `38375031052` (commit
`17806fc`) completed with **both jobs green** and all eight Deploy steps
executed, and the deployment record progressed
`waiting → queued → in_progress → success` with `environment_url` set to
<https://mahicouragw.github.io/Blind-car-game/>.

The two runs before it both died at `waiting → failure` with an empty
`environment_url`, reporting `Branch "arena/..." is not allowed to deploy to
github-pages due to environment protection rules`. That was a repository
permission, not a code defect: the auto-created `github-pages` environment
accepts only `main` until its deployment branch policy is widened. Nothing in the
workflow needed to change to fix it.

Three facts about the deployment that are easy to get wrong:

- Pages serves from the sub-path `/Blind-car-game/`, so **every asset reference
  must stay document-relative**. An absolute `/src/...` or `/assets/...` path
  works under `npm run serve` and 404s only on the deployed site. This is now
  caught automatically by `tests/publish.test.mjs` rather than relying on review;
  see the README section "Deployed on GitHub Pages".
- What actually ships is decided by `scripts/publish-list.mjs`, which stages an
  explicit include list into `_site/` and uploads that — rather than uploading
  the repository root and relying on `actions/upload-pages-artifact` to strip
  things. Staged locally: **114 files, 24.44 MB** — `index.html`, `styles/`,
  `src/`, `assets/` (all **69** audio samples), `vendor/` (both Three.js chunks)
  and `docs/circuit-map.svg`. Nothing else: no `tests/`, no `scripts/`, no
  `package-lock.json`, no prose docs, and **no dotfiles at any level**, so no git
  history or dependency tree can reach a public URL. `tests/publish.test.mjs`
  stages the tree with the same function and asserts both halves of that — every
  file the game loads is present, and every development file is absent.
- `.nojekyll` is committed but **does not ship** in that artefact, and it is not
  needed while Pages is on `build_type: workflow` — no Jekyll step runs at all.
  It is kept because it matters immediately if the source is ever switched back
  to "Deploy from a branch", where Jekyll does run against the branch and would
  strip directories beginning with `_`.

A green `deploy-pages` step only proves Pages accepted the artefact, so the
workflow runs one more step: `scripts/verify-deploy.mjs` fetches the live URL and
asserts 13 things about it — the shell returns `200` `text/html` and references
its entry module, the JS/CSS/SVG/OGG assets return `200` with usable MIME types,
and `package-lock.json`, `README.md`, `tests/`, `scripts/` and `.git/config` are
**not** served. Retries exist only for files that should be present, because a
propagation delay is real while a published file will not become unpublished by
asking again; if the site root never comes up it reports that once and stops
rather than spending the retry budget thirteen times.

`mahicouragw.github.io` is **not reachable from the Arena sandbox**, so that step
cannot be run from here — but it is not taken on faith either. The same
`verifySite` function is exercised by three tests against locally staged
servers: it passes against the real staged tree, it pinpoints a single missing
asset when one is punched out, and it **fails** against a server rooted at the
repository root, naming exactly the four development files that would have been
exposed. That last one is the negative control; without it the check could pass
vacuously and the CI step would be decoration.

Still worth confirming the URL in a real browser afterwards, because the verifier
checks that files serve — not that WebGL draws, that speech is heard, or that
touch works.

### 6. Multi-touch under a real palm — **UNTESTED**

Rule R8 is tested with synthetic second contacts. A real palm resting on a phone
screen produces large, wandering contact areas; verify on hardware that a palm
cannot steer, brake or fire a tap.

### 7. Long-session memory — **UNTESTED**

Screens, meshes, materials and audio buffers are disposed on teardown, and the
race screen disposes the whole scene graph, but no long-run leak test was
performed. Play ten races in a row and watch the heap.

---

## Manual test plan (simulated)

The brief asks for manual or simulated tests of specific flows. Here is where
each one is covered:

| Flow | Status |
| --- | --- |
| Game TalkBack on and off | **Automated** (`dom.smoke`: settings screen keeps speaking when off; non-essential speech refused, essential speech accepted) |
| Speech volume and rate | **Automated** (`settings.test`: clamping, stepping, announcement text) |
| Single tap versus double tap | **Automated** (`gestures.test`) |
| Double-tap-and-hold opening settings | **Automated** (`gestures.test` R4 + `dom.smoke` wiring) |
| Steering versus menu navigation | **Automated** (`gestures.test` R1/R7 + `drivingInput` gradual steering) |
| Accelerate hold and release | **Automated** (`dom.smoke`: `pressStart`/`pressEnd` recorded by the harness) |
| Braking while moving | **Automated** (`race.test`: `doubleTap` sets brake; physics test brakes from 100 km/h) |
| U-turn | **Automated** (`gestures.test` circle detection; `race.test` asserts no instant lateral teleport) |
| Spoken corner warnings | **Automated** (`race.test`: real direction, fixed 500m/50m, no intermediate chatter) |
| Opponent announcements | **Automated** (`race.test`: real name, side, closing speed, no nagging) |
| Countdown sync | **Partly automated.** `race.test` asserts the Three/Two/One/Go lines; `raceScreen.js` fires the spoken count, the recorded voice sample and the lights from the same event. **The visual/audio simultaneity on hardware is untested.** |
| Race completion and restart | **Automated** (`race.test` finish order; `dom.smoke` results screen has Restart and Return to menu) |
| Losing an interview and continuing | **Automated** (`story.test`: fail branch offers retry and an alternative route) |
| Winning an interview and negotiating | **Automated** (`story.test`: pass → better opening offer → salary recorded) |
| Refresh and saved progress | **Automated** (`story.test` round trip and resume; `dom.smoke` reload) |
| Audio load failure | **Automated in code, untested in a browser.** `audio.status()` reports partial loads; `dom.smoke` proves the WebGL-unavailable path explains itself. **Blocking a real asset in devtools is not done.** |
| No accidental repeated race starts | **Automated** (`gestures.test` R6 + `dom.smoke` zero clicks on triple tap) |
| Keyboard navigation and focus management | **Partly automated.** `dom.smoke` proves swipe moves the focus ring and taps click real buttons; the keyboard map is exercised through the same bus events. **Tab order in a real browser is untested.** |
| Resize and orientation change | **Not tested.** `raceScreen.resize()` and the zone remeasure are wired to both events; no automated coverage |
| Recovery from invalid states | **Automated** (`story.test`: corrupted save repaired, unparseable storage falls back, no storage still runs, cheated unlocks rejected) |

## Round 8 verification (2026-10-22)

- **396/396 Node tests**: fixed real/fake gain graphs; 20%/70% defaults; independent
  persistent 5% controls and clamps; one-time default-pair migration; horn threshold,
  no handbrake/throttle/short-hold-stop on release, cancel/background handling;
  500m→50m silence across elapsed time, new legs/laps; manual retry cursor and
  indefinite stopped state. Existing forest combat/loot/heal/phone regressions pass.
- **Chromium Pixel-7 touch emulation:** real mobile taps plus CDP touch hold decoded
  the CC0 horn (3.2006576s), sounded it after >1s, stopped on release, retained cruise,
  retained single-tap brake, confirmed single-tap retry vs double-tap activation,
  exercised independent volume buttons, and verified Exit silence. **Actual Web Audio
  group gains before/during/after speech were identical:** SFX .7, music .2, voice 1,
  engine .7 (floating-point representation within 1e-6). No page exceptions.
- **Original 3D simulation:** drove into a barrier through real keyboard input;
  collision stopped at 0m/s, froze the clock and position for >3 seconds, and a real
  phone single tap did not retry. A phone double tap on the Try again cursor made
  a new attempt. No page exceptions. Software WebGL, not physical phone performance.
- Round-7 Chromium phone forest/attack/sit/heal/XP/audio/Exit regression reran PASS.
- **Not verified:** listening by a human, physical Android, TalkBack touch exploration,
  actual loudness/intelligibility on a phone speaker, or hardware frame/audio timing.

Optional browser regressions (Node22+, local server on8080):

```sh
npm install --no-save --package-lock=false playwright
npx playwright install --with-deps chromium
npm run serve -- 8080
# In another terminal:
node scripts/phone-smoke.mjs
node scripts/simulation-retry-smoke.mjs
```

Set `GAME_TEST_URL` if using another local test server. These checks are not part
of `npm test`, which intentionally does not require a browser installation.
