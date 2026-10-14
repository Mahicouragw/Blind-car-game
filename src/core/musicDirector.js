/**
 * Decides which music bed is playing, from game state.
 *
 * Screens do not pick their own music. They announce themselves on the bus, and
 * this module maps that to a track, which keeps the six full-length recordings
 * in one place and stops two screens fighting over the same channel. It is a
 * pure module - no DOM, no Web Audio at import time - so the mapping is testable
 * without a browser.
 *
 * Two rules shape the mapping:
 *
 * 1. Scenes where the player is listening to *values* rather than playing get
 *    silence. The settings and audio screens read numbers and play test sounds,
 *    and a music bed under that is noise the player did not ask for.
 * 2. Story scenes get their track from the chapter, not the screen id, because
 *    every chapter mounts the same `story` screen. The story screen emits
 *    `scene:music` with the track for its chapter, which overrides the default.
 *
 * Music always ducks under Game TalkBack (see DUCK_LEVELS in core/audio.js), so
 * a bed never competes with an announcement.
 *
 * @module core/musicDirector
 */

/** Track per screen id. `null` means deliberate silence. */
export const SCREEN_TRACKS = {
  menu: 'music-theme-menu',
  chapters: 'music-theme-menu',
  levels: 'music-theme-menu',
  carSelect: 'music-theme-menu',
  name: 'music-theme-menu',
  recap: 'music-theme-menu',
  map: 'music-theme-menu',
  tutorial: 'music-theme-menu',
  results: 'music-results',
  story: 'music-story-city',
  // Silence on purpose: these screens read settings values aloud and audition
  // sound effects, so a bed would sit under exactly what the player is trying
  // to hear.
  settings: null,
  audio: null,
};

/** Fallback for screens not in SCREEN_TRACKS, including tutorial step screens. */
export const DEFAULT_TRACK = 'music-theme-menu';

/**
 * Music per story chapter, matched to what the chapter is about.
 *
 * 1 is the family and the rent notice, 2 and 3 are the interview and the
 * negotiation - both pressure scenes - 4 is the workshop floor in the city,
 * 5 and 6 are the invitation and the lesson, which are warm rather than tense,
 * and 7 is the race itself.
 */
export const TRACK_FOR_CHAPTER = {
  1: 'music-story-family',
  2: 'music-story-tension',
  3: 'music-story-tension',
  4: 'music-story-city',
  5: 'music-theme-menu',
  6: 'music-theme-menu',
  7: 'music-race',
};

/** The track for a chapter, falling back to the city bed for chapters 8-10. */
export function trackForChapter(chapterId) {
  const id = Number(chapterId);
  if (!Number.isFinite(id)) return 'music-story-city';
  return TRACK_FOR_CHAPTER[id] ?? 'music-story-city';
}

/** The track for a screen id, honouring deliberate silence. */
export function trackForScreen(screenId) {
  if (screenId == null) return DEFAULT_TRACK;
  if (Object.prototype.hasOwnProperty.call(SCREEN_TRACKS, screenId)) return SCREEN_TRACKS[screenId];
  return DEFAULT_TRACK;
}

/**
 * Quiet scene beds played UNDER the music, one per story mood.
 *
 * These are the ambience slots the audio credits used to list as gaps; each is
 * now an original generated loop (see core/audio.js AUDIO_GAPS). They run at
 * low volume on the sfx bus so announcements duck them like every other sound.
 */
export const AMBIENCE_FOR_TRACK = {
  'music-story-family': 'home-ambience',
  'music-story-city': 'city-ambience',
  'music-story-tension': 'city-ambience',
  'music-race': 'pit-lane-ambience',
};

/** Every ambience slot, so they can all be stopped as one group. */
export const AMBIENCE_SLOTS = ['city-ambience', 'home-ambience', 'workshop-ambience', 'pit-lane-ambience'];

/**
 * Story scenes name their own bed (`story:ambience` with the scene kind), which
 * is finer-grained than the chapter's music: an office scene inside a city
 * chapter still sounds like a room, and the workshop floor sounds like a
 * workshop.
 */
export const AMBIENCE_FOR_STORY = {
  city: 'city-ambience',
  home: 'home-ambience',
  office: 'home-ambience',
  workshop: 'workshop-ambience',
  circuit: 'pit-lane-ambience',
  pit: 'pit-lane-ambience',
};

/**
 * @param {object} config
 * @param {object} config.audio       the audio subsystem (needs `.music`)
 * @param {object} [config.events]    an event bus; defaults to the app bus
 * @param {() => object} [config.getSettings]
 */
export function createMusicDirector(config = {}) {
  const audio = config.audio ?? null;
  const events = config.events ?? null;
  const getSettings = config.getSettings ?? (() => ({}));

  let scene = null;
  let wanted = null;
  let ambience = null;
  const offs = [];

  /** Start, swap or stop the scene bed. `null` means no bed. */
  let bedToken = 0;
  function setBed(want) {
    if (!audio?.loop) return;
    if (want === ambience) return;
    audio.stopLoops?.(AMBIENCE_SLOTS);
    ambience = null;
    const token = ++bedToken;
    if (!want || getSettings().sfx === false) return;
    // The field-recorded beds are long files and lazy-loaded, so make sure the
    // sample is in memory before looping it. If the scene changes before the
    // fetch returns, the stale start is discarded (token guard).
    const start = () => {
      if (token !== bedToken) return;
      const handle = audio.loop(want, { volume: 0.16, group: 'sfx' });
      if (handle) ambience = want;
    };
    const loaded = audio.ensureLoaded?.(want);
    if (loaded?.then) loaded.then(start).catch(() => {});
    else start();
  }

  /** Start, swap or stop the scene bed to sit under `track`. */
  function applyAmbience(track) {
    setBed(AMBIENCE_FOR_TRACK[track] ?? null);
  }

  /**
   * Ask for a track. `null` means silence. Music that is switched off in
   * settings stops rather than being started at zero volume, so the setting is
   * real and not just quiet.
   */
  function apply(track) {
    wanted = track ?? null;
    applyAmbience(wanted);
    if (!audio?.music) return false;
    if (getSettings().music === false || !track) {
      audio.music.stop(0.8);
      return false;
    }
    // Fire and forget: loading is async and a scene change mid-download is
    // handled by the pending token inside audio.music.play.
    void audio.music.play(track);
    return true;
  }

  if (events) {
    offs.push(
      events.on('screen:mounted', (payload) => {
        const id = payload?.id ?? null;
        scene = id;
        // A story screen sets its own track from the chapter; do not stamp the
        // generic default over it when the same screen re-mounts.
        if (id === 'story' && wanted) return;
        apply(trackForScreen(id));
      }),
    );
    offs.push(
      events.on('scene:music', (payload) => {
        if (payload?.scene) scene = payload.scene;
        apply(payload?.track ?? null);
      }),
    );
    offs.push(
      events.on('story:ambience', (payload) => {
        // The story node names its scene; play the matching bed if one exists.
        setBed(AMBIENCE_FOR_STORY[payload?.ambience] ?? null);
      }),
    );
    offs.push(
      events.on('settings:applied', ({ key } = {}) => {
        // Turning music off must take effect immediately, and turning it back on
        // must restore the current scene rather than waiting for a screen change.
        if (key === 'music' || key === 'musicVolume') apply(wanted);
        // The same for the scene beds under the effects switch.
        if (key === 'sfx') {
          audio?.stopLoops?.(AMBIENCE_SLOTS);
          ambience = null;
          applyAmbience(wanted);
        }
      }),
    );
  }

  return {
    get scene() {
      return scene;
    },
    get track() {
      return wanted;
    },
    /** Explicit control for the race screen, which is not a bus screen. */
    playTrack(track) {
      return apply(track);
    },
    setScene(id, track) {
      scene = id;
      return apply(track === undefined ? trackForScreen(id) : track);
    },
    stop() {
      return apply(null);
    },
    destroy() {
      for (const off of offs) {
        try {
          off?.();
        } catch {
          /* ignore */
        }
      }
      offs.length = 0;
      apply(null);
    },
  };
}
