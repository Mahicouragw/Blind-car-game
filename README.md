# Vettaru: The Blind Driver

An accessible, story-driven, realistic 3D car racing game that runs in the
browser. It is built so a **blind or low-vision player can play the whole thing
by ear**, using its own spoken guidance system that does **not** require Android
TalkBack or any device screen reader to be switched on.

Everything is original: the city of Anandapur, the Vettaru International
Circuit, the cars, the characters and the seven-chapter story.

- **No build step.** Plain ES modules, vendored Three.js, vendored CC0 audio.
- **No runtime dependencies.** `jsdom` is a dev-only dependency used by the tests.
- **No server, no account, no API keys, no analytics.** Progress is saved in
  `localStorage` in the player's own browser.

---

## Play it

**Live: <https://mahicouragw.github.io/Blind-car-game/>** — published
automatically by GitHub Actions, no build step.

Open it on a phone, tap once to unlock audio, and the game talks you through
everything from there. Mobile-first: it is designed for Android Chrome and works
on desktop with a keyboard.

To run it locally instead:

```bash
npm install        # dev only: installs jsdom for the DOM tests
npm run serve      # http://localhost:8080
```

### Deployed on GitHub Pages

The workflow `.github/workflows/deploy-pages.yml` publishes the repository root
as a static site. Pages serves it from a **sub-directory**
(`/Blind-car-game/`), not from a domain root, so:

- Every `href`, `src`, texture and audio path in the app is **document-relative**
  (`styles/main.css`, `assets/audio/...`, `vendor/three/...`).
- **Do not introduce an absolute path** such as `/src/main.js` or
  `/assets/audio/x.ogg`. It resolves against the domain root, works on
  `npm run serve` and on the branch preview, and then 404s on Pages. This is the
  single easiest way to break a deployed site, so `tests/publish.test.mjs` fails
  the build if one is ever introduced.
- There is no `<base>` tag and nothing reads `location.pathname` or
  `import.meta.url` to build a URL, so the same files run unmodified from `/`,
  from a sub-path and from the dev server.
- The workflow does **not** upload the repository root. `scripts/publish-list.mjs`
  stages an explicit include list into `_site/` and that is what ships — 114
  files, 24.44 MB. `tests/`, `scripts/`, `package-lock.json` and the prose docs
  are development material and stay out of the public site, as does every
  dotfile, so no git history is reachable. Add a new runtime asset to
  `PUBLISH_INCLUDE` or the deploy will 404 on it; `tests/publish.test.mjs` fails
  first if you forget.
- After deploying, the workflow runs `scripts/verify-deploy.mjs` against the live
  URL and fails the job unless the real site serves the shell, the JS, the CSS,
  the Three.js chunks, the audio and the track map with correct MIME types — and
  does **not** serve the development material. A green tick then means the site
  was checked, not merely uploaded.

### Commands

| Command | What it does |
| --- | --- |
| `npm run serve` | Static dev server on `0.0.0.0:8080` (no build step) |
| `npm test` | All 273 automated tests (`node --test`) |
| `npm run validate` | Track geometry gate — fails if the circuit does not close or self-intersects |
| `npm run map` | Regenerates `docs/circuit-map.svg` from the live geometry |
| `npm run publish:list` | Prints the exact files the Pages deploy publishes |
| `npm run fit` | Circuit shape fitter (authoring tool, see below) |

---

## What is actually playable

**Seven complete story chapters**, all playable end to end:

| Ch | Title | What happens |
| --- | --- | --- |
| 1 | The Weight of the City | Anandapur, the family, a rent notice, an argument with real dialogue choices |
| 2 | The Interview | Job search, preparation, travel, and a scored five-question interview with follow-ups |
| 3 | The Number | Salary negotiation driven by the offer, the interview result and your story state |
| 4 | The First Day | The workshop floor; **Joseph** and **Mithin** as separate characters; friendships via choices |
| 5 | An Invitation | "Do you like car racing?" — a circuit visit and the controls explained in dialogue |
| 6 | Learning the Car | A forgiving lesson on an empty circuit. Chapter 7 stays locked until the controls are understood |
| 7 | The First Race | Grid, opponents, start lights, countdown, two laps, a genuine finishing result |

Chapters 8-10 are **declared in the architecture but not implemented**. They
appear in the chapter list labelled *"Not yet playable"*, are disabled, and
cannot be entered. There are no fake buttons anywhere in this game.

**Racing:** 4 difficulty levels plus an unlimited practice session, 5 cars with
measurably different physics, opponents that drive the same physics model as the
player (not rails), lap and checkpoint validation, XP/coins/unlocks and level-ups.

---

## The circuit

`docs/circuit-map.svg` is **the actual playable geometry**, rendered from the
same centre-line the physics, the AI and the voice guidance all read. It is not
an illustration.

**Vettaru International Circuit** — 3,312 m per lap, 13 m wide, clockwise, closes
to within **0.070 m** with exactly −360° of total turn.

- Start/finish straight **337 m**, with a six-slot staggered grid painted on it
- **12 corner zones** — 5 left-hand and 7 right-hand, made of 14 individual turns
- **The Vettaru U-Turn** (T4, 172°, r = 30 m) — a genuine reversal
- **Old Harbour Hairpin** (T9, 168°, r = 23 m) — a second reversal
- **The Variante** chicane — three direction changes in 186 m
- Four long straights (full length): Start/Finish **337 m**, Quayside **372 m**, Fort **308 m**, East Terrace **283 m**. Braking zones eat into these, so the open-throttle zone spans are 303 m, 272 m, 233 m and 207 m
- 12 braking zones with 100 m / 50 m / turn-in distance boards
- 397 m pit lane with 6 garages, entry at s = 3112 m, exit at s = 230 m, 60 km/h limit
- Four grandstands with spectators, marshals and officials at every corner
- Armco barriers, stacked tyre walls at sharp corners, catch fencing, gravel traps
- Ten original sponsor boards, painted direction arrows, chequered finish line
- Five-light start gantry, finish banner, and a lap board that repaints per lap
- Paddock service buildings: race control, medical centre, hospitality, tyre store
- Harbour, salt flats, Anandapur skyline and harbour cranes on the horizon

The circuit is authored as a **spec of straight and constant-radius turn
elements** (`src/world/trackData.js`), solved to exact closure by
`scripts/closure-solver.mjs`, and gated by `scripts/validate-track.mjs`, which
fails the build on self-intersection, insufficient separation between non-adjacent
parts of the lap, or a lap that does not close. `scripts/fit-circuit.mjs` is the
authoring tool that searches corner angles and radii for a layout that satisfies
all of those constraints plus the required corner mix.

---

## How it is put together

```
src/
  core/       bus, save (+validation), gameState, audio (recorded samples only)
  a11y/       settings schema, speech queue, Game TalkBack adapter
  input/      gesture recognizer (pure), pointer bus, keyboard, driving input
  world/      layout, trackGeometry, trackData, scene3d, trackside
  vehicles/   physics, carCatalog, ai, carMesh
  race/       raceState, navigation, levels, raceScreen
  story/      storyData, storyEngine, interview, negotiation
  ui/         screens, menuScreens, storyScreen
  main.js     bootstrap and screen controller
```

**Design rule:** everything under `core`, `a11y`, `input`, `world`, `vehicles`,
`race` and `story` is a pure ES module with **no DOM, WebGL or Web Audio access at
import time**. That is why 256 of the 273 tests run headless in Node. Only `ui/`,
`race/raceScreen.js`, `core/audio.js`, `a11y/speech.js` and `main.js` touch the
browser, and they are covered by the jsdom suite.

| Concern | Choice |
| --- | --- |
| Rendering | Three.js r186, vendored in `vendor/three/` (MIT), procedural geometry |
| Physics | Custom bicycle model in `src/vehicles/physics.js` — no engine |
| Audio | Web Audio, **recorded samples only**, no oscillators anywhere |
| Speech | Web Speech API + an ARIA live region mirror |
| Tests | Node's built-in `node --test` + jsdom |
| Deploy | GitHub Pages, static, no build |

---

## Accessibility

See **[ACCESSIBILITY.md](ACCESSIBILITY.md)** for Game TalkBack, the full gesture
map and conflict rules, and **[docs/GESTURES.md](docs/GESTURES.md)** for the
timing thresholds.

The short version:

- Built-in spoken guidance that works with **no screen reader enabled**
- Every announcement is derived from real car position, heading, speed, track
  geometry, opponent positions and race state — **never random**
- Adjustable corner warning distance, announcement frequency and concise mode
- A priority queue with per-message cooldowns, so warnings never nag and a
  hairpin is never stuck behind a flavour line
- Turning Game TalkBack off stops game speech but **never silences the settings
  screen** — essential confirmations keep working, and F1 or the menu button is
  always a way back
- Every spoken line is mirrored as text in a live region, so a player with no
  speech voices installed still gets everything
- Full keyboard control, visible focus, 48 px touch targets, adjustable text size

---

## Audio

**75 recorded sound files, 21.8 MB.** Nothing is synthesised and nothing is
AI-generated.

- **69 effects and voice recordings, 0.9 MB — Creative Commons Zero 1.0**, by
  Kenney Vleugels, [kenney.nl](https://kenney.nl/). Attribution is optional under
  CC0 and is given anyway.
- **6 full-length music beds, 21.0 MB — licensed individually.** Three are
  **CC BY 4.0** (Kevin MacLeod, Alexander Nakarada) and attribution is *required*,
  so it is credited both in [docs/AUDIO-CREDITS.md](docs/AUDIO-CREDITS.md) and on
  the in-game *Audio and credits* screen. Three are public domain through FreePD
  (Rafael Krux).

The music beds are **lazy-loaded** — `loadAll()` fetches the 69 short effects at
boot and each bed is downloaded the first time a scene asks for it, so a phone
never pulls 21 MB before the menu appears.

**Nothing in this game is synthesised.** There is no oscillator, no generated
noise buffer and no placeholder beep anywhere in the audio code. Engine and tyre
audio are *recorded loops* whose playback rate and gain follow rpm and slip —
changing the rate of a recording is not synthesis.

Seven slots could **not** be filled from verified CC0 sources and are declared
openly in [`docs/AUDIO-CREDITS.md`](docs/AUDIO-CREDITS.md) and in
`AUDIO_GAPS` in `src/core/audio.js`: crowd cheering, city/home/workshop/pit-lane
ambience, a dedicated gear-change recording, and full-length background music.
Story dialogue is spoken by the device speech synthesiser and is described as
**synthesised speech, not recorded voice acting**.

`node scripts/fetch-extra-audio.mjs --list` shows every gap and what it needs;
the same script fills a gap only when given `--license`, `--author` and
`--source`, and records them in the credits ledger.

---

## Testing

```bash
npm test         # 273 tests
npm run validate # track geometry gate
```

273 automated tests across gesture recognition, settings state, the speech
queue, lap counting and checkpoint validation, race completion and finishing
order, navigation announcement rules, vehicle physics, opponent AI, story
branching, interview scoring, salary negotiation, save/load validation and
progression, plus a mock-free integration suite that drives real touch events
through the recognizer into the driving input — plus a jsdom suite that actually boots the game, mounts the
screens and drives them with gesture events, and a deployment-safety suite that
guards the relative asset paths and the dev server's path guard.

See **[docs/TESTING.md](docs/TESTING.md)** for what was executed, what was not,
and the manual test plan. **Nothing is claimed as tested that was not run.**

---

## Known limitations

Recorded honestly, in full, in [docs/TESTING.md](docs/TESTING.md). The headline
items:

1. **Not verified on a physical Android device.** The sandbox has no browser, so
   touch behaviour on real hardware is **untested** and is the first thing to check.
2. **Seven audio slots are unfilled** (listed above) rather than faked.
3. **The 3D race renderer could not be executed in this environment** — no WebGL.
   The geometry, materials and scene graph are all built and asserted headless;
   the drawn frame was not observed.
4. **Chapter 7's race is level 1.** Higher levels are reachable from the menu but
   are not part of the story campaign.
5. **Lap length.** A lap is 3.3 km, so a two-lap beginner race takes about four
   minutes. That is realistic for a pro circuit and stated in the level brief,
   but it is longer than a typical mobile race.

---

## Licence

Game code MIT. Three.js MIT (`vendor/three/LICENSE`). All audio CC0 1.0.
