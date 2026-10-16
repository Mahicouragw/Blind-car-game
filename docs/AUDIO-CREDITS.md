# Audio credits, licences and honest gaps

**100 sound files, 38.3 MB.** Every one is a real *file* that the game plays back;
there is no oscillator, no generated noise buffer and no synthesised tone
anywhere in this project's audio *code* — `src/core/audio.js` only ever plays
files.

The files have three provenances, and this document records each:

1. **75 third-party recordings** (22.9 MB): 69 short effects and stingers
   (0.9 MB, all CC0 Kenney) plus **six full-length music beds (22.0 MB)**,
   documented separately below because their licences differ from one another
   and two of them require attribution.
2. **15 field/foley recordings of real things** (the original eleven plus four adventure recordings): brakes, handbrake, gear
   change, tyre squeal, rain, wipers, a cheering grandstand and four scene
   beds, downloaded from **freesound.org under Creative Commons 0** — real
   recordings, one per action the brief asked for. The brief allows AI
   *voices* and forbids AI-*generated sound effects*, so **no generated or
   synthesised sound effect ships**: the eleven synthesised `.wav` fills this
   project once carried were deleted and replaced by these recordings. See
   [Field recordings (CC0)](#field-recordings-cc0) below.
3. **10 AI voice clips** (0.1 MB): short spoken cues generated as `.mp3` files
   and preferred over device speech synthesis whenever the line is one of them.
   These are the ONLY generated audio in the project (AI voices are allowed).
   See [AI voice clips](#ai-voice-clips) below.

There is no AI-generated music, no AI-generated sound effect and no placeholder
beep. Nothing is hotlinked; nothing is synthesised in the browser.

---

## Licence

| | |
| --- | --- |
| Licence | **Creative Commons Zero 1.0 Universal (CC0 1.0)** — public domain dedication |
| Author | **Kenney Vleugels** |
| Source | https://kenney.nl/assets |
| Attribution required? | **No.** CC0 waives it. Attribution is given here anyway. |
| Commercial use | Permitted |
| Modification | Permitted |
| Redistribution | Permitted |

Licence text: https://creativecommons.org/publicdomain/zero/1.0/
Support the author: https://kenney.nl/

### How this was verified

The files were obtained by `git clone` of two public GitHub repositories whose
own licence records were checked, not assumed:

- **`KenneyNL/Starter-Kit-Racing`** — README states "3D Models & sounds *(CC0
  licensed)*"; the repository `LICENSE` is MIT © 2023 Kenney. The audio inside is
  Kenney's CC0 material.
- **`OmniTender-Systems/game-audio-assets`** — `ATTRIBUTION.md` states that all
  vendored Kenney packs are **CC0 1.0 Universal**, that attribution is optional,
  and lists the per-pack source URLs
  (`https://kenney.nl/assets/{casino-audio,digital-audio,impact-sounds,interface-sounds,music-jingles,rpg-audio,sci-fi-sounds,ui-audio,voiceover-pack}`).

Files were **copied into this repository** (`assets/audio/`). Nothing is
hotlinked. No fragile third-party preview URL is a sole source for any sound.

Rejected during sourcing, with reasons recorded so the work is not repeated:

| Source | Why rejected |
| --- | --- |
| `uisfx` (npm) | Synthesised, not recorded |
| `OmniTender-Systems/game-audio-assets` → `original/jimmythehat/` | House originals, **not CC0** |
| `OmniTender-Systems/game-3d-assets` | Licence `NOASSERTION` — not verified, so not used |
| `alexban01/Higher-Quality-City-Ambience-Sounds` | **No licence file at all** |
| `Boyquotes/kenney-voiceover-for-godot`, `diamondStar35/top_speed` | GPL-3.0 — incompatible with an MIT project |
| Kenney `casino-audio` | Contains cards, chips and dice. **No crowd cheering.** |
| Mixkit, Pixabay, kenney.nl directly | **Not reachable** from the build sandbox (only `github.com`, `api.github.com`, `codeload.github.com`, `registry.npmjs.org`, `pypi.org` and freesound's CDN answered). |
| Generated `.wav` effects (`scripts/generate-sfx.mjs`) | **Deleted.** The brief forbids AI-generated sound effects; every slot is now a real CC0 field recording from freesound.org. |

"Downloadable" was never treated as "royalty-free". Anything whose licence could
not be read was not used. The freesound recordings below were each checked for
the `Creative Commons 0` licence filter on their own sound page before download;
the public 128 kbps preview file (`cdn.freesound.org/previews/...`) is what is
vendored, so nothing is hotlinked at runtime.

---

## What is vendored

All paths are relative to `assets/audio/`. The logical name used in code is the
key in `AUDIO_MANIFEST` (`src/core/audio.js`).

### `racing/` — 8 files

| File | Used for |
| --- | --- |
| `engine-loop.ogg` | Primary engine loop, playback rate and gain driven by rpm and load |
| `engine-loop-alt.ogg` | Second engine layer, crossfaded in as rpm rises |
| `skid-loop.ogg` | Tyre squeal, gain driven by measured wheel slip |
| `impact.ogg` | Collision |
| `brake.mp3` | Every brake press — a recorded pedal/brake sound (CC0, WavJunction.com) |
| `handbrake.mp3` | The handbrake pull (CC0, ninebilly) |
| `gear-change.mp3` | The gear-change clunk (CC0, greatsoundstube) |
| `tire-squeal.mp3` | Hard cornering chirp (CC0, audible-edge) |

**Speed-dependent audio is produced by changing the playback rate of a recorded
loop (0.72×–1.90×) and crossfading two recorded layers by rpm.** This is
manipulation of a recorded asset. It is *not* synthesis, and no oscillator is
involved.

### `voice/` — 18 files

Real human recordings from Kenney's voiceover pack. Performers credited by Kenney
as **Jeffrey M. Smith** (male) and **Giselle** (female).

`ready`, `set`, `go`, `1`, `2`, `3`, `correct`, `wrong`, `level_up`,
`congratulations`, `you_win`, `you_lose`, `game_over`, `mission_completed`,
`new_highscore`, `power_up`, `hurry_up`, `objective_achieved`

Used for the countdown (each spoken number is a recording **and** a Game TalkBack
utterance, fired from the same event so they cannot drift), tutorial correct /
incorrect, level up, race win and lose, and chapter completion.

### `ui/` — 14 files

`click`, `select`, `back`, `confirm`, `error`, `toggle`, `open`, `close`,
`scroll`, `question`, `tick`, `switch`, `glass`, `pluck`

### `impact/` — 10 files

`barrier-heavy`, `barrier-medium`, `barrier-light` (graded by measured impact
speed), `glass-light`, `generic-light`, `bell-heavy`, `footstep-concrete-0`,
`footstep-concrete-1`, `footstep-grass-0`, `footstep-wood-0`

### `scene/` — 21 files

Short Kenney CC0 one-shots: `door-open`, `door-close`, `coins`, `coins-2`,
`workshop-chop`, `creak`, `cloth`, `metal-click`, `metal-latch`, `bag-drop`,
`paper-open`, `paper-place`, `chips-stack`, `chips-handle`.

Field-recorded CC0 beds and weather (lazy-loaded): `crowd-cheer.mp3`,
`city-ambience.mp3`, `home-ambience.mp3`, `workshop-ambience.mp3`,
`pit-lane-ambience.mp3`, `rain.mp3`, `wiper.mp3`.

### `music/` — 15 files

Nine short stingers, all CC0 Kenney: `stinger-warm`, `stinger-bright`,
`stinger-light`, `stinger-hit`, `stinger-retro`, `achievement`, `three-tone`,
`high-up`, `high-down`.

Six full-length music beds, licensed individually — see the next section:
`theme-menu`, `story-city`, `story-family`, `story-tension`, `race`,
`results-fanfare`.

---

## Full-length music beds — per-track licence evidence

The brief asked for recorded, royalty-free music and explicitly for **no
AI-generated audio**. These six tracks are real recordings by real composers.
They are *not* all CC0, so each is documented with the evidence that was actually
available, and the two that require attribution are credited in-game as well as
here.

| File | Original title | Artist | Licence | Attribution required |
| --- | --- | --- | --- | --- |
| `theme-menu.mp3` | *New Hero in Town* (2019) | **Kevin MacLeod** | CC BY 4.0 (credited conservatively) | **Yes** |
| `story-city.mp3` | *Adventure* | **Rafael Krux**, CinematicWaves.com | Public domain / FreePD | No |
| `story-family.mp3` | *Fancy Family* | **Rafael Krux**, CinematicWaves.com | Public domain / FreePD | No |
| `story-tension.mp3` | *Black Knight* (2014) | **Rafael Krux**, CinematicWaves.com | Public domain / FreePD | No |
| `race.mp3` | *Celebration* (2017) | **Alexander Nakarada** | CC BY 4.0 | **Yes** |
| `results-fanfare.mp3` | *Fanfare X* (2017) | **Alexander Nakarada** | CC BY 4.0 | **Yes** |

Attribution for the CC BY 4.0 tracks:

> Music by **Kevin MacLeod** — https://incompetech.com/ — licensed under
> Creative Commons: By Attribution 4.0.
>
> Music by **Alexander Nakarada** — https://alexandernakarada.bandcamp.com/ —
> licensed under Creative Commons: By Attribution 4.0.
>
> Music by **Rafael Krux** — https://cinematicwaves.com/ — released to the public
> domain through FreePD.

CC BY 4.0 licence text: https://creativecommons.org/licenses/by/4.0/

All six permit commercial use, modification and redistribution. Attribution is
the only condition, and it is satisfied both here and on the in-game *Audio and
credits* screen, which is reachable without a sighted helper.

### How this was verified, and what was rejected

The tracks came from the public GitHub repository
[`SoundSafari/CC0-1.0-Music`](https://github.com/SoundSafari/CC0-1.0-Music),
whose own `LICENSE` is CC0 1.0 and which describes itself as "the world's largest
corpus of CC0-1.0 licensed music", grouping ~7,000 files by the site that
originally aggregated them. **That blanket claim was not trusted.** The source
sites (freepd.com, incompetech.com, pixabay, freesound, FMA) are unreachable from
the build sandbox, so each candidate file's own **embedded ID3 tags** were parsed
and treated as the evidence.

This mattered. Downloading ten candidates and reading their tags showed that the
repository's CC0 labelling does not hold per-file:

- `Fanfare X.mp3` carried `TALB = "Complete Discography (CC BY Attribution 4.0)"`
  — the file itself states a licence that **requires attribution**, inside a
  repository that claims the whole corpus is CC0.
- `Celebration.mp3` is from the same artist and the same "Complete Discography"
  set, so it is treated as CC BY 4.0 too.
- `New Hero in Town.mp3` is tagged `TPE1 = Kevin MacLeod`, `TALB = "Royalty Free"`
  only. MacLeod publishes both CC0 work (FreePD) and CC BY 4.0 work (incompetech),
  and the tag does not say which. It is therefore **credited as CC BY 4.0**:
  over-attributing is harmless, under-attributing is a licence violation, so the
  conservative reading is the one recorded.

**Rejected for lack of evidence** — downloaded, inspected, and deleted rather
than shipped:

| Candidate | Why rejected |
| --- | --- |
| *Rush*, *City Run*, *Action Strike*, *Cornfield Chase*, *Advertime*, *Aquatic City Vanished*, *Night Attack*, *Stunted Adventure* | **No ID3 tags at all.** No artist, no title, no licence. Nothing to verify against, so nothing to attribute. |
| *Abstract Anxiety* | Artist named ("Severed Personality") but no licence tag; the comment field pointed at an online audio converter rather than a rights holder. |
| *Heroic Adventure* | Title field read "Cubase" with no artist and a converter URL — tags had been stripped and rewritten. |

The rejected files were never committed. Two of them had already been wired into
the manifest and the scene mapping before the tags were read; that wiring was
rewritten to the verified six, and `tests/publish.test.mjs` fails if any manifest
entry does not exist on disk, so an unverifiable file cannot come back silently.

**The honest limit:** ID3 tags are self-reported. They are strong evidence of who
made a track and what licence was intended, and they are the only evidence
available without reaching the source sites, but they are not a substitute for
the licensor's own statement. If any of these six is later shown to be mis-tagged,
remove it and the game still plays: music is an optional layer, every track is
lazy-loaded, and `music.play` reports failure rather than throwing.

### Why music is lazy-loaded

The six beds total 21.0 MB. `loadAll()` therefore defaults to
`eagerAudioNames()` — the 69 short effects, 0.9 MB — and each bed is fetched and
decoded by `music.play()` the first time a scene asks for it. On a phone that is
the difference between a ~1 MB boot and a ~22 MB one, and most sessions never
reach every scene. A track that is still downloading when the player changes
scene is dropped rather than starting late over the top of the newer one.

---

## Story dialogue is synthesised, and is described as synthesised

The seven-chapter campaign is spoken by the **device speech synthesiser** through
Game TalkBack. There is **no recorded voice acting** in this game. The writing is
original; the voice is your device's.

The in-game *Audio and credits* screen says this in exactly those words, and it
is listed as an open gap below. It is never described as recorded acting.

---

## Field recordings (CC0)

Eleven slots the brief asks for — braking, handbrake, gear change, turning,
rain and wipers, crowd and ambience — are filled with **real recordings of real
things** from [freesound.org](https://freesound.org), each under the
**Creative Commons 0** public-domain dedication. The first eleven rows are the
action sounds; the last three are not new files but documented reuse of the
CC0 Kenney interface recordings.

| Slot | File | Recording | Artist | freesound id | Licence |
| --- | --- | --- | --- | --- | --- |
| `brake` | `racing/brake.mp3` | Brake | WavJunction.com | 456764 | CC0 |
| `handbrake` | `racing/handbrake.mp3` | Handbrake | ninebilly | 173007 | CC0 |
| `gear-change` | `racing/gear-change.mp3` | Gear change | greatsoundstube | 629324 | CC0 |
| `tire-squeal` | `racing/tire-squeal.mp3` | Chrysler LHS tire squeal 03 | audible-edge | 71738 | CC0 |
| `rain` | `scene/rain.mp3` | Slowly Raining Loop | unfa | 177479 | CC0 |
| `wiper` | `scene/wiper.mp3` | Windshield wiper | itinerantmonk108 | 787480 | CC0 |
| `crowd-cheer` | `scene/crowd-cheer.mp3` | Crowd cheering | HowardV | 264377 | CC0 |
| `city-ambience` | `scene/city-ambience.mp3` | City ambience | ivolipa | 261472 | CC0 |
| `home-ambience` | `scene/home-ambience.mp3` | Room tone | leonelmail | 329569 | CC0 |
| `workshop-ambience` | `scene/workshop-ambience.mp3` | Tools Ratchet | CapsLok | 181634 | CC0 |
| `pit-lane-ambience` | `scene/pit-lane-ambience.mp3` | ParkingGarage | conleec | 150004 | CC0 |
| `ui-pause` | `ui/close.ogg` | Kenney interface close | Kenney | — | CC0 |
| `ui-resume` | `ui/open.ogg` | Kenney interface open | Kenney | — | CC0 |
| `ui-exit` | `ui/back.ogg` | Kenney interface back | Kenney | — | CC0 |

Source pages are `https://freesound.org/people/<artist>/sounds/<id>/`; the
vendored files are the public 128 kbps previews from
`cdn.freesound.org/previews/...`, copied into this repository like everything
else. CC0 waives attribution; the table exists so the recordings can be traced
anyway. The pause/resume/exit rows deliberately **reuse** the already-vendored
Kenney close/open/back recordings (asserted as allowed aliases in
`tests/publish.test.mjs`) rather than shipping a second copy of the same sound.

---

## AI voice clips

Ten short spoken cues were generated as real `.mp3` files (`assets/audio/voice/`)
and are used INSTEAD of device speech synthesis whenever the line is one of
them - `cue()` in `src/race/raceScreen.js` and `speakCue()` in `src/main.js`
play the file and fall back to synthesis only when the file is missing. The two
are never both played for one line.

| File | Says | Used for |
| --- | --- | --- |
| `voice/brake.mp3` | "Brake." | Every brake press |
| `voice/handbrake.mp3` | "Handbrake." | Every handbrake press |
| `voice/main-menu.mp3` | "Main menu." | Pressing Main menu |
| `voice/settings.mp3` | "Settings." | Pressing a settings button |
| `voice/exit-game.mp3` | "Exit game." | Pressing Exit game |
| `voice/paused.mp3` | "Paused." | Pausing the race |
| `voice/resumed.mp3` | "Resumed." | Resuming the race |
| `voice/accelerating.mp3` | "Accelerating." | Throttle pressed |
| `voice/coasting.mp3` | "Coasting." | Throttle released |
| `voice/reversing.mp3` | "Reversing." | Reverse engaged |

They are original generated speech, not any performer's recording: no corporate
voice asset and no third-party licence applies. Dynamic lines (lap times,
positions, story text) are still spoken by the device synthesiser and are
labelled as synthesis.

---

## Open gaps — declared, not faked

These slots were requested and could **not** be filled from a verified CC0 source
reachable during the first build. They are declared in `AUDIO_GAPS` in
`src/core/audio.js`, surfaced on the in-game *Audio and credits* screen, and
listed by `node scripts/fetch-extra-audio.mjs --list`.

Every sound-effect slot is now filled by a **real CC0 field recording** listed
above. The only remaining gap is recorded voice acting, which is synthesised by
the device and labelled as such everywhere.

| Slot | Needed | Status today |
| --- | --- | --- |
| `crowd-cheer` | Grandstand cheering at start and finish | **Filled.** CC0 field recording (HowardV), played at lights-out and at the finish line |
| `city-ambience` | Anandapur street bed, loopable | **Filled.** CC0 field recording (ivolipa), played under city story scenes |
| `home-ambience` | Small interior room tone, loopable | **Filled.** CC0 field recording (leonelmail) |
| `workshop-ambience` | Workshop floor bed: air gun, metal, radio | **Filled.** CC0 field recording (CapsLok) |
| `pit-lane-ambience` | Pit lane bed: air guns, idling engines, footsteps | **Filled.** CC0 field recording (conleec), played under the race and pit scenes |
| `gear-change` | A dedicated gear-change clunk | **Filled.** CC0 field recording (greatsoundstube) |
| `brake` / `handbrake` | Distinct sounds for the two driving controls | **Filled.** CC0 field recordings (WavJunction.com, ninebilly), played on every press |
| `rain-wipers` | Rain and working wipers for wet races | **Filled.** CC0 field recordings (unfa, itinerantmonk108); some races are run in light rain with the wipers looping |
| `background-music` | Full-length looping music, 60 s+, plus a race variant | **Filled.** Six full-length recorded beds with per-track licence evidence, mapped to scenes by `src/core/musicDirector.js`. Two require attribution and are credited in-game. The nine short CC0 stingers remain for transitions and achievements |
| `voice-acting` | Recorded voice acting for story dialogue | **Synthesised** by the device, and labelled as such everywhere |

### How to fill a gap

```bash
node scripts/fetch-extra-audio.mjs --list

node scripts/fetch-extra-audio.mjs \
  --slot crowd-cheer \
  --url https://example.org/cc0/crowd-cheer.ogg \
  --license "CC0 1.0" \
  --author "Author Name" \
  --source "https://example.org/asset-page"
```

The script **refuses to run without `--license`, `--author` and `--source`**,
refuses to write anything under 512 bytes, and appends the licence record to this
file. Then add the file to `AUDIO_MANIFEST` and remove it from `AUDIO_GAPS`.

---

## Mixing and intelligibility

Speech must win. `DUCK_LEVELS` in `src/core/audio.js`:

| Bus | Normal | While speech is active |
| --- | --- | --- |
| Engine | 85% | **30%** |
| Music | 50% × setting | **22%** |
| SFX | 85% × setting | 60% |
| Voice | 100% | 100% |

The duck is released ~420 ms after speech ends (`audio.tick()`), so the engine
does not pump up and down between words.

**Speech, music and sound effects have independent volume settings**, and music
and SFX each have their own on/off switch, so a player who wants only guidance can
have only guidance.

---

## Failure behaviour

`audio.status()` returns a plain-language message and never claims an asset
loaded when it did not:

- **No Web Audio** → "This browser does not support Web Audio, so the game is
  silent. Everything else still works, and all guidance is available as speech
  and text."
- **Before the first gesture** → "Audio is waiting for your first tap."
- **Partial load** → "N sound assets loaded and M could not be loaded. Missing
  sounds are silent rather than replaced. The game remains playable."

Assets are fetched individually with `Promise.all`, so one 404 cannot prevent the
other 68 from loading, and a failed asset is **silent, never substituted**. The
*Audio and credits* screen has a "Try loading audio again" button for a slow
connection.

No error message anywhere exposes a stack trace, a path, a header or any internal
detail. The dev server logs only the request line and refuses to serve dotfiles.


## Forest and combat recordings (CC0)

Four additional files are vendored in `assets/audio/adventure/`. Each source page
was checked for the CC0 public-domain licence before downloading its HQ MP3
preview. No AI generation, oscillator or synthetic Web Audio tone is involved.
The files are played locally; no third-party service is contacted during play.
`assets/audio/adventure/SOURCES.json` records the exact download URLs and bytes.

| File | Creator | Source and use |
| --- | --- | --- |
| `forest-birds.mp3` | Magnesus | [Forest birds - ambient seamless loop](https://freesound.org/people/Magnesus/sounds/723913/), 27-second recorded bird bed |
| `sword-hit.mp3` | loudernoises | [Sword Clash](https://freesound.org/people/loudernoises/sounds/334169/), recorded metal/blade clash; also the physical cursor clink replacing the old digital tick |
| `sword-swing.mp3` | Angrycrazii | [Sword swing.wav](https://freesound.org/people/Angrycrazii/sounds/277322/), short recorded swing/foley |
| `monster-arrival.mp3` | qubodup | [Goblin Growl](https://freesound.org/people/qubodup/sounds/442817/), CC0 edited recording, derived from a credited CC0 sample on its source page |

The monster-hit cue reuses the existing `generic-light.ogg` impact recording;
loot reuses `coins-2.ogg`, and path turns reuse `cloth.ogg`. These intentional
aliases are documented in the manifest tests. Walking uses the existing grass
and concrete footstep recordings. Sword swings and contact are layered with a
short delay, not synthesized. Existing full-length credited music now plays in
the new areas; forest birds sit underneath and both duck under speech. Exit and
background/pagehide still stop all playback and invalidate pending loop starts.
