# Audio credits, licences and honest gaps

**69 recorded sound files, 1.1 MB.** Every one is a real recording. There is no
oscillator, no generated noise buffer, no synthesised tone and no placeholder beep
anywhere in this project's audio code.

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
| Mixkit, Pixabay, freesound.org, kenney.nl directly | **Not reachable** from the build sandbox. Only `github.com`, `api.github.com`, `codeload.github.com`, `registry.npmjs.org` and `pypi.org` were available. |

"Downloadable" was never treated as "royalty-free". Anything whose licence could
not be read was not used.

---

## What is vendored

All paths are relative to `assets/audio/`. The logical name used in code is the
key in `AUDIO_MANIFEST` (`src/core/audio.js`).

### `racing/` — 4 files

| File | Used for |
| --- | --- |
| `engine-loop.ogg` | Primary engine loop, playback rate and gain driven by rpm and load |
| `engine-loop-alt.ogg` | Second engine layer, crossfaded in as rpm rises |
| `skid-loop.ogg` | Tyre squeal, gain driven by measured wheel slip |
| `impact.ogg` | Collision |

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

### `scene/` — 14 files

`door-open`, `door-close`, `coins`, `coins-2`, `workshop-chop`, `creak`, `cloth`,
`metal-click`, `metal-latch`, `bag-drop`, `paper-open`, `paper-place`,
`chips-stack`, `chips-handle`

### `music/` — 9 files

`stinger-warm`, `stinger-bright`, `stinger-light`, `stinger-hit`,
`stinger-retro`, `achievement`, `three-tone`, `high-up`, `high-down`

---

## Story dialogue is synthesised, and is described as synthesised

The seven-chapter campaign is spoken by the **device speech synthesiser** through
Game TalkBack. There is **no recorded voice acting** in this game. The writing is
original; the voice is your device's.

The in-game *Audio and credits* screen says this in exactly those words, and it
is listed as an open gap below. It is never described as recorded acting.

---

## Open gaps — declared, not faked

These slots were requested and could **not** be filled from a verified CC0 source
reachable during the build. They are declared in `AUDIO_GAPS` in
`src/core/audio.js`, surfaced on the in-game *Audio and credits* screen, and
listed by `node scripts/fetch-extra-audio.mjs --list`.

**None of them is filled with generated audio.** Where a stand-in is used, it is
another *recorded* CC0 file and the substitution is stated.

| Slot | Needed | Status today |
| --- | --- | --- |
| `crowd-cheer` | Grandstand cheering at start and finish, 4-10 s, loopable tail | **Empty.** Kenney `casino-audio` has no crowd; no other reachable source had a verified CC0 crowd recording |
| `city-ambience` | Anandapur street bed, 30 s+, loopable | **Empty.** Chapter 1 plays with no room tone |
| `home-ambience` | Small interior room tone, loopable | **Empty.** The family argument scenes have no bed |
| `workshop-ambience` | Workshop floor bed: air gun, metal, radio | **Empty.** Chapters 4 and 6 have no bed |
| `pit-lane-ambience` | Pit lane bed: air guns, idling engines, footsteps | **Empty.** The chapter 7 paddock has no bed |
| `gear-change` | A dedicated recorded gear-change clunk, several variants | **Substituted** with the recorded `metal-click.ogg`. Disclosed here and in code |
| `background-music` | Full-length looping music, 60 s+, plus a race variant | **Partial.** Only short recorded stingers (10-20 KB jingles) exist under CC0 in the sources reached. They are used for transitions and achievements, not as a continuous score |
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
