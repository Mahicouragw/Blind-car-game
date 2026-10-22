/**
 * Audio: file playback, engine feel FROM FILES, and ducking.
 *
 * Every sound in this game is a real file in assets/audio. Nothing here
 * generates a tone at runtime: there is no oscillator, no noise buffer, no
 * synthesised substitute anywhere in this module, and no Web-Audio-API
 * generated sound is ever used to fill a gap. If a file fails to load, that
 * sound is silent and the failure is reported - it is never quietly replaced by
 * something generated in the browser.
 *
 * The files come from two sources, both royalty-free and free of corporate
 * audio (see docs/AUDIO-CREDITS.md for the per-file evidence):
 *
 * 1. Short effects and music by Kenney, licensed CC0 1.0.
 * 2. Field recordings from freesound.org under Creative Commons 0 (brakes,
 *    handbrake, gear change, tyre squeal, rain, wipers, crowd, and the scene
 *    beds) - real recordings of real things, one per action the brief asked
 *    for. NO generated or AI sound effects are shipped: the brief allows AI
 *    VOICES and forbids generated sound effects, and the voice cues in
 *    assets/audio/voice are the only generated audio in the project.
 *
 * Engine and tyre audio are recorded loops whose playback rate and gain are
 * driven by rpm and slip. Changing the playback rate of a file is
 * manipulation of a file asset, not synthesis; that distinction is stated
 * here and in the credits because the brief asks for it explicitly.
 *
 * @module core/audio
 */

const A = 'assets/audio';

/** Logical name -> recorded file. Every entry must exist on disk. */
export const AUDIO_MANIFEST = {
  // racing
  'engine-loop': `${A}/racing/engine-loop.ogg`,
  'engine-loop-alt': `${A}/racing/engine-loop-alt.ogg`,
  'skid-loop': `${A}/racing/skid-loop.ogg`,
  'collision': `${A}/racing/impact.ogg`,
  'brake': `${A}/racing/brake.mp3`,
  'handbrake': `${A}/racing/handbrake.mp3`,
  'gear-change': `${A}/racing/gear-change.mp3`,
  'tire-squeal': `${A}/racing/tire-squeal.mp3`,
  // voice (real recordings, Kenney voiceover pack)
  'voice-ready': `${A}/voice/ready.ogg`,
  'voice-set': `${A}/voice/set.ogg`,
  'voice-go': `${A}/voice/go.ogg`,
  'voice-1': `${A}/voice/1.ogg`,
  'voice-2': `${A}/voice/2.ogg`,
  'voice-3': `${A}/voice/3.ogg`,
  'voice-correct': `${A}/voice/correct.ogg`,
  'voice-wrong': `${A}/voice/wrong.ogg`,
  'voice-level-up': `${A}/voice/level_up.ogg`,
  'voice-congratulations': `${A}/voice/congratulations.ogg`,
  'voice-you-win': `${A}/voice/you_win.ogg`,
  'voice-you-lose': `${A}/voice/you_lose.ogg`,
  'voice-game-over': `${A}/voice/game_over.ogg`,
  'voice-mission-complete': `${A}/voice/mission_completed.ogg`,
  'voice-highscore': `${A}/voice/new_highscore.ogg`,
  'voice-power-up': `${A}/voice/power_up.ogg`,
  'voice-hurry': `${A}/voice/hurry_up.ogg`,
  'voice-objective': `${A}/voice/objective_achieved.ogg`,
  // AI voice clips: short spoken cues generated as real files (see
  // docs/AUDIO-CREDITS.md). Preferred over device speech synthesis whenever the
  // phrase is one of these - the sample wins, synthesis is only the fallback -
  // so the player hears ONE voice saying the line, never two.
  'voice-brake': `${A}/voice/brake.mp3`,
  'voice-handbrake': `${A}/voice/handbrake.mp3`,
  'voice-main-menu': `${A}/voice/main-menu.mp3`,
  'voice-settings': `${A}/voice/settings.mp3`,
  'voice-exit-game': `${A}/voice/exit-game.mp3`,
  'voice-paused': `${A}/voice/paused.mp3`,
  'voice-resumed': `${A}/voice/resumed.mp3`,
  'voice-accelerating': `${A}/voice/accelerating.mp3`,
  'voice-coasting': `${A}/voice/coasting.mp3`,
  'voice-reversing': `${A}/voice/reversing.mp3`,
  // ui
  'ui-click': `${A}/ui/click.ogg`,
  'ui-select': `${A}/ui/select.ogg`,
  'ui-back': `${A}/ui/back.ogg`,
  'ui-confirm': `${A}/ui/confirm.ogg`,
  'ui-error': `${A}/ui/error.ogg`,
  'ui-toggle': `${A}/ui/toggle.ogg`,
  'ui-open': `${A}/ui/open.ogg`,
  'ui-close': `${A}/ui/close.ogg`,
  'ui-scroll': `${A}/ui/scroll.ogg`,
  'ui-question': `${A}/ui/question.ogg`,
  'ui-tick': `${A}/adventure/sword-hit.mp3`,
  'ui-switch': `${A}/ui/switch.ogg`,
  'ui-glass': `${A}/ui/glass.ogg`,
  'ui-pluck': `${A}/ui/pluck.ogg`,
  // Pause, resume and exit use the CC0 Kenney interface recordings rather than
  // anything generated: the brief asks for royalty-free recorded effects only.
  'ui-pause': `${A}/ui/close.ogg`,
  'ui-resume': `${A}/ui/open.ogg`,
  'ui-exit': `${A}/ui/back.ogg`,
  // impact
  'barrier-heavy': `${A}/impact/barrier-heavy.ogg`,
  'barrier-medium': `${A}/impact/barrier-medium.ogg`,
  'barrier-light': `${A}/impact/barrier-light.ogg`,
  'glass-light': `${A}/impact/glass-light.ogg`,
  'generic-light': `${A}/impact/generic-light.ogg`,
  'bell-heavy': `${A}/impact/bell-heavy.ogg`,
  'footstep-concrete-0': `${A}/impact/footstep-concrete-0.ogg`,
  'footstep-concrete-1': `${A}/impact/footstep-concrete-1.ogg`,
  'footstep-grass-0': `${A}/impact/footstep-grass-0.ogg`,
  'footstep-wood-0': `${A}/impact/footstep-wood-0.ogg`,
  // scene / ambience
  'door-open': `${A}/scene/door-open.ogg`,
  'door-close': `${A}/scene/door-close.ogg`,
  'coins': `${A}/scene/coins.ogg`,
  'coins-2': `${A}/scene/coins-2.ogg`,
  'workshop-chop': `${A}/scene/workshop-chop.ogg`,
  'creak': `${A}/scene/creak.ogg`,
  'cloth': `${A}/scene/cloth.ogg`,
  'metal-click': `${A}/scene/metal-click.ogg`,
  'metal-latch': `${A}/scene/metal-latch.ogg`,
  'bag-drop': `${A}/scene/bag-drop.ogg`,
  'paper-open': `${A}/scene/paper-open.ogg`,
  'paper-place': `${A}/scene/paper-place.ogg`,
  'chips-stack': `${A}/scene/chips-stack.ogg`,
  'chips-handle': `${A}/scene/chips-handle.ogg`,
  'crowd-cheer': `${A}/scene/crowd-cheer.mp3`,
  'city-ambience': `${A}/scene/city-ambience.mp3`,
  'home-ambience': `${A}/scene/home-ambience.mp3`,
  'workshop-ambience': `${A}/scene/workshop-ambience.mp3`,
  'pit-lane-ambience': `${A}/scene/pit-lane-ambience.mp3`,
  'rain': `${A}/scene/rain.mp3`,
  'wiper': `${A}/scene/wiper.mp3`,
  // CC0 recorded adventure effects. Provenance: adventure/SOURCES.json.
  'car-horn': `${A}/adventure/car-horn.mp3`,
  'forest-birds': `${A}/adventure/forest-birds.mp3`,
  'sword-swing': `${A}/adventure/sword-swing.mp3`,
  'sword-hit': `${A}/adventure/sword-hit.mp3`,
  'monster-arrival': `${A}/adventure/monster-arrival.mp3`,
  'monster-hit': `${A}/impact/generic-light.ogg`,
  'loot-drop': `${A}/scene/coins-2.ogg`,
  'path-turn': `${A}/scene/cloth.ogg`,
  // music (short recorded stingers - see AUDIO_GAPS for the honest limitation)
  'music-warm': `${A}/music/stinger-warm.ogg`,
  'music-bright': `${A}/music/stinger-bright.ogg`,
  'music-light': `${A}/music/stinger-light.ogg`,
  'music-hit': `${A}/music/stinger-hit.ogg`,
  'music-retro': `${A}/music/stinger-retro.ogg`,
  'music-achievement': `${A}/music/achievement.ogg`,
  'music-three-tone': `${A}/music/three-tone.ogg`,
  'music-high-up': `${A}/music/high-up.ogg`,
  'music-high-down': `${A}/music/high-down.ogg`,

  // Full-length recorded music beds. Megabytes each, so they are listed in
  // LAZY_AUDIO below and fetched on first use rather than at boot.
  'music-theme-menu': `${A}/music/theme-menu.mp3`,
  'music-story-city': `${A}/music/story-city.mp3`,
  'music-story-family': `${A}/music/story-family.mp3`,
  'music-story-tension': `${A}/music/story-tension.mp3`,
  'music-race': `${A}/music/race.mp3`,
  'music-results': `${A}/music/results-fanfare.mp3`,
};

/**
 * Sound slots the brief asks for. Earlier builds could not verify a CC0
 * recording for several of them and declared the gaps honestly here rather than
 * silently faking them. The brief then allowed generated files ("generated AI
 * is ok", as long as nothing is Web-Audio-API generated at runtime), so every
 * slot is now filled by an ORIGINAL file written by `scripts/generate-sfx.mjs`.
 * The list is kept, with honest statuses, so the credits screen still shows
 * what came from where.
 */
/**
 * Assets large enough to matter on a mobile connection, fetched on first use
 * instead of at boot. The six full-length music beds total about 17 MB; pulling
 * them down before the menu appears would be the slowest thing about the game on
 * a phone, and most players never reach every scene in one session.
 */
export const LAZY_AUDIO = new Set([
  'music-theme-menu',
  'music-story-city',
  'music-story-family',
  'music-story-tension',
  'music-race',
  'music-results',
  // Field-recorded beds are long files; fetch them when a scene actually needs
  // them instead of making the menu wait for eight megabytes of pit lane.
  'forest-birds',
  'rain',
  'wiper',
  'city-ambience',
  'home-ambience',
  'workshop-ambience',
  'pit-lane-ambience',
]);

/**
 * Per-track licence evidence for the full-length music beds.
 *
 * These are NOT all CC0, unlike the effects, and pretending otherwise would
 * break two licences. Three tracks are CC BY 4.0 and require attribution; three
 * are public domain through FreePD and do not.
 *
 * The evidence is each file's own embedded ID3 tags, read from the binary rather
 * than taken from the aggregator repository that claimed the whole corpus was
 * CC0 - a claim one of these files directly contradicted by tagging itself
 * "CC BY Attribution 4.0". Candidates with no tags at all were downloaded,
 * inspected and deleted instead of shipped. docs/AUDIO-CREDITS.md records the
 * full trail, including what was rejected and why.
 *
 * Where a tag was ambiguous (Kevin MacLeod publishes both CC0 and CC BY 4.0
 * work), the track is credited as CC BY 4.0: over-attributing is harmless and
 * under-attributing is a licence violation.
 */
export const MUSIC_CREDITS = [
  { key: 'forest-birds', title: 'Forest birds - ambient seamless loop', artist: 'Magnesus', url: 'https://freesound.org/people/Magnesus/sounds/723913/', licence: 'Creative Commons 0', attributionRequired: false },
  { key: 'music-theme-menu', title: 'New Hero in Town', artist: 'Kevin MacLeod', url: 'https://incompetech.com/', licence: 'Creative Commons: By Attribution 4.0', attributionRequired: true, year: 2019 },
  { key: 'music-story-city', title: 'Adventure', artist: 'Rafael Krux', url: 'https://cinematicwaves.com/', licence: 'Public domain, released through FreePD', attributionRequired: false },
  { key: 'music-story-family', title: 'Fancy Family', artist: 'Rafael Krux', url: 'https://cinematicwaves.com/', licence: 'Public domain, released through FreePD', attributionRequired: false },
  { key: 'music-story-tension', title: 'Black Knight', artist: 'Rafael Krux', url: 'https://cinematicwaves.com/', licence: 'Public domain, released through FreePD', attributionRequired: false, year: 2014 },
  { key: 'music-race', title: 'Celebration', artist: 'Alexander Nakarada', url: 'https://alexandernakarada.bandcamp.com/', licence: 'Creative Commons: By Attribution 4.0', attributionRequired: true, year: 2017 },
  { key: 'music-results', title: 'Fanfare X', artist: 'Alexander Nakarada', url: 'https://alexandernakarada.bandcamp.com/', licence: 'Creative Commons: By Attribution 4.0', attributionRequired: true, year: 2017 },
  // The long field-recorded scene beds are lazy-loaded like the music beds and
  // are covered by the same "documented before shipping" rule. All six are
  // Creative Commons 0 from freesound.org - real recordings, credited in
  // docs/AUDIO-CREDITS.md with the sound ids that prove the licence.
  { key: 'rain', title: 'Slowly Raining Loop', artist: 'unfa', url: 'https://freesound.org/people/unfa/sounds/177479/', licence: 'Creative Commons 0', attributionRequired: false },
  { key: 'wiper', title: 'Windshield wiper', artist: 'itinerantmonk108', url: 'https://freesound.org/people/itinerantmonk108/sounds/787480/', licence: 'Creative Commons 0', attributionRequired: false },
  { key: 'city-ambience', title: 'City ambience', artist: 'ivolipa', url: 'https://freesound.org/people/ivolipa/sounds/261472/', licence: 'Creative Commons 0', attributionRequired: false },
  { key: 'home-ambience', title: 'Room tone', artist: 'leonelmail', url: 'https://freesound.org/people/leonelmail/sounds/329569/', licence: 'Creative Commons 0', attributionRequired: false },
  { key: 'workshop-ambience', title: 'Tools Ratchet', artist: 'CapsLok', url: 'https://freesound.org/people/CapsLok/sounds/181634/', licence: 'Creative Commons 0', attributionRequired: false },
  { key: 'pit-lane-ambience', title: 'ParkingGarage', artist: 'conleec', url: 'https://freesound.org/people/conleec/sounds/150004/', licence: 'Creative Commons 0', attributionRequired: false },
];

/**
 * The attribution lines the CC BY 4.0 tracks require, as speakable text, one per
 * artist. Surfaced on the in-game credits screen so the obligation is met
 * somewhere a blind player can reach without a sighted helper.
 */
export function musicAttributionLines() {
  const seen = new Map();
  for (const credit of MUSIC_CREDITS) {
    if (!credit.attributionRequired || seen.has(credit.artist)) continue;
    seen.set(credit.artist, credit);
  }
  return [...seen.values()].map(
    (c) => `Music by ${c.artist}, ${c.url}, licensed ${c.licence}.`,
  );
}

/** Everything except LAZY_AUDIO: the set `loadAll()` fetches at boot. */
export function eagerAudioNames() {
  return Object.keys(AUDIO_MANIFEST).filter((name) => !LAZY_AUDIO.has(name));
}

/**
 * Plain names the story scripts use, mapped to manifest keys.
 *
 * The story writes `sfx: 'mission_completed'` and `sfx: 'tick'`; the manifest
 * spells them 'voice-mission-complete' and 'ui-tick'. Without this table every
 * one of those plays nothing at all - the play() call finds no buffer and
 * silently returns - so a whole class of story sound effects was dead. Aliases
 * are resolved in one place so the story can keep naming sounds in its own
 * words while the manifest stays the single source of truth for files.
 */
export const SFX_ALIASES = {
  tick: 'ui-tick',
  click: 'ui-click',
  select: 'ui-select',
  back: 'ui-back',
  confirm: 'ui-confirm',
  error: 'ui-error',
  correct: 'voice-correct',
  wrong: 'voice-wrong',
  congratulations: 'voice-congratulations',
  you_win: 'voice-you-win',
  you_lose: 'voice-you-lose',
  game_over: 'voice-game-over',
  mission_completed: 'voice-mission-complete',
  new_highscore: 'voice-highscore',
  level_up: 'voice-level-up',
  power_up: 'voice-power-up',
  ready: 'voice-ready',
  set: 'voice-set',
  go: 'voice-go',
};

/** Resolve a sound name (alias or manifest key) to a manifest key. */
export function resolveSoundName(name) {
  return SFX_ALIASES[name] ?? name;
}

export const AUDIO_GAPS = [
  { slot: 'crowd-cheer', want: 'Grandstand crowd cheering at the start and finish.', cueUsed: 'crowd-cheer (CC0 field recording, HowardV via freesound.org)', status: 'filled' },
  { slot: 'city-ambience', want: 'Anandapur street ambience for chapter one.', cueUsed: 'city-ambience (CC0 field recording, ivolipa via freesound.org)', status: 'filled' },
  { slot: 'home-ambience', want: 'Family home room tone for the argument scenes.', cueUsed: 'home-ambience (CC0 field recording, leonelmail via freesound.org)', status: 'filled' },
  { slot: 'workshop-ambience', want: 'Continuous workshop floor ambience.', cueUsed: 'workshop-ambience (CC0 field recording, CapsLok via freesound.org)', status: 'filled' },
  { slot: 'pit-lane-ambience', want: 'Pit lane ambience with air guns and engines.', cueUsed: 'pit-lane-ambience (CC0 field recording, conleec via freesound.org)', status: 'filled' },
  { slot: 'gear-change', want: 'A dedicated gear-change clunk.', cueUsed: 'gear-change (CC0 field recording, greatsoundstube via freesound.org)', status: 'filled' },
  { slot: 'brake', want: 'A brake sound for every brake press.', cueUsed: 'brake (CC0 field recording, WavJunction.com via freesound.org)', status: 'filled' },
  { slot: 'handbrake', want: 'A handbrake sound for the drift input.', cueUsed: 'handbrake (CC0 field recording, ninebilly via freesound.org)', status: 'filled' },
  { slot: 'rain-wipers', want: 'Rain and working wipers for wet races.', cueUsed: 'rain and wiper (CC0 field recordings, unfa and itinerantmonk108 via freesound.org)', status: 'filled' },
  { slot: 'background-music', want: 'Full-length looping background music.', cueUsed: 'six full-length CC0 recordings from freepd.com, lazily loaded', status: 'filled' },
  { slot: 'voice-acting', want: 'Recorded voice acting for story dialogue.', cueUsed: 'speech synthesis, labelled as synthesis', status: 'synthesised-not-recorded' },
];

/** Compatibility mix constants: speech NEVER changes music/effect/engine gains.
 * Manual volume changes are still smoothed to avoid clicks. */
export const DUCK_LEVELS = {
  engine: 1,
  music: 1,
  sfx: 1,
  recoveryMs: 420,
  holdMs: 15000,
  rampSeconds: 0.09,
};

export function createAudio(config = {}) {
  const getSettings = config.getSettings ?? (() => ({}));
  const fetchImpl = config.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const AudioCtor = config.AudioContext ?? (typeof AudioContext !== 'undefined' ? AudioContext : null);

  let ctx = null;
  let master = null;
  const groups = {};
  const buffers = new Map();
  const failed = new Map();
  const loops = new Map();
  const activeSources = new Set();
  let active = true;
  let unlocked = false;


  function ensureContext() {
    if (ctx || !AudioCtor) return ctx;
    try {
      ctx = new AudioCtor();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      for (const name of ['sfx', 'music', 'voice', 'engine']) {
        const g = ctx.createGain();
        g.gain.value = name === 'engine' ? 0.85 : name === 'music' ? 0.4 : 1;
        g.connect(master);
        groups[name] = g;
      }
    } catch {
      ctx = null;
    }
    return ctx;
  }

  /** Effective gain per group, so tests and the status readout can see them. */
  function targetLevels() {
    const s = getSettings();
    const sfxBase = s.sfx === false ? 0 : (s.sfxVolume ?? 0.7);
    const musicBase = s.music === false ? 0 : (s.musicVolume ?? 0.2);
    return {
      // Voice is never ducked: it is the accessibility surface.
      voice: 1,
      sfx: sfxBase,
      music: musicBase,
      engine: sfxBase,
    };
  }

  /**
   * Move a gain to `value` without a click. Setting `.value` directly on a
   * running graph produces a step change that is audible as a tick, and ducking
   * happens on every announcement, so it is worth smoothing.
   */
  function setGain(param, value) {
    if (!param) return;
    try {
      if (typeof param.setTargetAtTime === 'function' && ctx && typeof ctx.currentTime === 'number') {
        param.setTargetAtTime(value, ctx.currentTime, DUCK_LEVELS.rampSeconds);
        return;
      }
    } catch {
      /* fall through to the direct assignment */
    }
    param.value = value;
  }

  const lastLevels = { voice: null, sfx: null, music: null, engine: null };

  /**
   * Fetch and decode one asset on demand. Shared by `loadAll` and the music
   * player, so a large music bed does not have to be part of the boot download.
   * Failures are recorded and returned as null rather than thrown: a missing
   * track must never break a race.
   */
  async function ensureLoaded(name) {
    ensureContext();
    if (buffers.has(name)) return buffers.get(name);
    const url = AUDIO_MANIFEST[name];
    if (!url) {
      failed.set(name, 'not in the manifest');
      return null;
    }
    if (!ctx || !fetchImpl) {
      failed.set(name, 'Web Audio is not available in this browser');
      return null;
    }
    try {
      const res = await fetchImpl(url, { mode: 'same-origin', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(data);
      buffers.set(name, buf);
      failed.delete(name);
      return buf;
    } catch (err) {
      failed.set(name, err?.message || 'could not be loaded');
      return null;
    }
  }

  function applyVolumes() {
    if (!ctx) return;
    const levels = targetLevels();
    for (const name of Object.keys(levels)) {
      // tick() runs every frame; only touch the graph when something moved.
      if (lastLevels[name] === levels[name]) continue;
      lastLevels[name] = levels[name];
      if (groups[name]) setGain(groups[name].gain, levels[name]);
    }
  }

  const api = {
    get available() {
      return !!AudioCtor;
    },
    get ready() {
      return unlocked && !!ctx;
    },
    get buffers() {
      return buffers;
    },
    get failedAssets() {
      return [...failed.entries()].map(([name, reason]) => ({ name, reason }));
    },
    get gaps() {
      return AUDIO_GAPS;
    },
    get context() {
      return ctx;
    },

    /**
     * Browsers require a user gesture before audio can start. Called from the
     * first tap or keypress.
     */
    async unlock() {
      ensureContext();
      if (!ctx) return false;
      try {
        if (ctx.state === 'suspended') await ctx.resume();
      } catch {
        /* ignore */
      }
      unlocked = ctx.state === 'running';
      applyVolumes();
      return unlocked;
    },

    /**
     * Load the eager asset set. Failures are isolated and recorded, never fatal.
     *
     * Defaults to `eagerAudioNames()`, not the whole manifest: the full-length
     * music beds are megabytes each and are fetched by `music.play` on demand.
     */
    async loadAll(names = eagerAudioNames()) {
      ensureContext();
      if (!ctx || !fetchImpl) {
        for (const n of names) failed.set(n, 'Web Audio is not available in this browser');
        return { loaded: 0, failed: names.length };
      }
      const results = await Promise.all(names.map((name) => ensureLoaded(name)));
      return { loaded: results.filter(Boolean).length, failed: failed.size };
    },

    /** Fetch one asset now; used by the music player and by the audio screen. */
    ensureLoaded,

    /**
     * Play a recorded one-shot.
     * @param {string} name  a manifest key, or one of SFX_ALIASES
     * @param {{volume?:number, rate?:number, group?:string, delay?:number}} [opts]
     */
    play(name, opts = {}) {
      if (!active || !ctx || !unlocked) return false;
      const buf = buffers.get(resolveSoundName(name));
      if (!buf) return false;
      const group = groups[opts.group ?? 'sfx'] ?? groups.sfx;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // Rate variation is applied to a RECORDING, not synthesised.
      src.playbackRate.value = clamp(opts.rate ?? 1, 0.25, 4);
      const gain = ctx.createGain();
      gain.gain.value = clamp(opts.volume ?? 1, 0, 1);
      src.connect(gain).connect(group);
      try {
        src.start(ctx.currentTime + (opts.delay ?? 0));
        activeSources.add(src);
        src.onended = () => { activeSources.delete(src); src.disconnect?.(); gain.disconnect?.(); };
      } catch {
        return false;
      }
      return true;
    },

    /**
     * Start a recorded loop. Returns a handle to change rate/gain and stop it.
     */
    loop(name, opts = {}) {
      if (!active || !ctx || !unlocked) return null;
      const buf = buffers.get(name);
      if (!buf) return null;
      const group = groups[opts.group ?? 'engine'] ?? groups.sfx;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = clamp(opts.rate ?? 1, 0.25, 4);
      const gain = ctx.createGain();
      gain.gain.value = clamp(opts.volume ?? 0, 0, 1);
      src.connect(gain).connect(group);
      try {
        src.start();
        activeSources.add(src);
        src.onended = () => { activeSources.delete(src); src.disconnect?.(); gain.disconnect?.(); };
      } catch {
        return null;
      }
      const handle = {
        name,
        get running() {
          return !handle._stopped;
        },
        setRate(rate) {
          try {
            src.playbackRate.setTargetAtTime(clamp(rate, 0.25, 4), ctx.currentTime, 0.06);
          } catch {
            /* ignore */
          }
        },
        setVolume(v) {
          try {
            gain.gain.setTargetAtTime(clamp(v, 0, 1), ctx.currentTime, 0.08);
          } catch {
            /* ignore */
          }
        },
        stop(fade = 0.15) {
          if (handle._stopped) return;
          handle._stopped = true;
          try {
            if (fade > 0) gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
            src.stop(ctx.currentTime + Math.max(0, fade));
          } catch {
            /* ignore */
          }
          if (loops.get(name) === handle) loops.delete(name);
        },
        _stopped: false,
      };
      loops.set(name, handle);
      return handle;
    },

    /** Stop even one-shots, crossfading sources and delayed starts. */
    stopAll() {
      api.music.stop(0);
      for (const handle of loops.values()) handle._stopped = true;
      loops.clear();
      for (const src of activeSources) {
        try { src.stop(ctx?.currentTime ?? 0); src.disconnect?.(); } catch { /* already ended */ }
      }
      activeSources.clear();
      api.engine.handleLow = null;
      api.engine.handleHigh = null;
      api.skid.handle = null;
      api.horn.handle = null; api.horn.wanted = false;
    },
    setActive(value) {
      active = !!value;
      if (!active) api.stopAll();
    },
    stopLoops(names) {
      const list = names ? names.map((n) => loops.get(n)).filter(Boolean) : [...loops.values()];
      for (const h of list) h.stop();
    },

    /**
     * Engine audio: two recorded loops crossfaded by rpm, with playback rate
     * tracking engine speed. This is what makes the audio speed-dependent
     * without generating anything.
     */
    horn: {
      handle: null, wanted: false, pending: null,
      start() {
        if (!active) return null;
        api.horn.wanted = true;
        if (!ctx || !unlocked || !buffers.has('car-horn')) {
          if (!api.horn.pending) api.horn.pending = Promise.all([api.unlock(), ensureLoaded('car-horn')]).then(([ready, buffer]) => {
            api.horn.pending = null;
            if (ready && buffer && api.horn.wanted && active) api.horn.start();
          });
          return null;
        }
        if (!api.horn.handle) api.horn.handle = api.loop('car-horn', { group: 'sfx', volume: 1 });
        return api.horn.handle;
      },
      stop() { api.horn.wanted = false; api.horn.handle?.stop(0.03); api.horn.handle = null; },
    },
    engine: {
      handleLow: null,
      handleHigh: null,
      start() {
        api.engine.handleLow = api.loop('engine-loop', { volume: 0, group: 'engine' });
        api.engine.handleHigh = api.loop('engine-loop-alt', { volume: 0, group: 'engine' });
        return !!(api.engine.handleLow || api.engine.handleHigh);
      },
      /**
       * @param {{rpm:number, idleRpm:number, redlineRpm:number, throttle:number, speedNorm:number, load:number}} s
       */
      update(s) {
        const low = api.engine.handleLow;
        const high = api.engine.handleHigh;
        if (!low && !high) return false;
        const span = Math.max(1, (s.redlineRpm ?? 7000) - (s.idleRpm ?? 900));
        const frac = clamp((s.rpm - (s.idleRpm ?? 900)) / span, 0, 1);
        const load = clamp(s.load ?? s.throttle ?? 0, 0, 1);
        const speed = clamp(s.speedNorm ?? 0, 0, 1);
        // A recorded loop pitched up covers idle to redline - that is a rate
        // change on a recording, not synthesis. The range is wide enough that
        // pressing the throttle is obvious by ear alone, and road speed adds a
        // little on top so a tall gear at speed does not sound like a short gear
        // at idle. Both terms are capped so the total stays inside what Web Audio
        // accepts and inside the two layers' crossfade.
        const rate = 0.66 + frac * 1.42 + speed * 0.12;
        const loud = 0.2 + load * 0.58 + frac * 0.14 + speed * 0.08;
        if (low) {
          low.setRate(rate);
          low.setVolume(loud * (1 - frac * 0.75));
        }
        if (high) {
          high.setRate(rate * 1.04);
          high.setVolume(loud * frac * 0.85);
        }
        return true;
      },
      stop() {
        api.engine.handleLow?.stop(0.25);
        api.engine.handleHigh?.stop(0.25);
        api.engine.handleLow = null;
        api.engine.handleHigh = null;
      },
    },

    /**
     * A crash, built by LAYERING several recorded files.
     *
     * The single Kenney impact samples are short thuds: they read as a knock, not
     * as a car hitting a barrier, and a player cannot reliably tell "I have hit
     * something" from them at racing volume over an engine. Layering is not
     * synthesis - every layer here is a real recording, played at its own rate and
     * gain on a small delay - and it produces the two-part sound a real impact
     * makes: a low body thud followed by the sharp brittle sound of glass and
     * metal. That two-part shape is what makes impact recognisable by ear.
     *
     * @param {number} severity 0..1, from the impact speed
     */
    crash(severity = 0.5) {
      const s = clamp(severity, 0, 1);
      const jitter = () => 0.94 + Math.random() * 0.12;
      // Body: the heavy thud. Always present.
      api.play(s > 0.55 ? 'barrier-heavy' : 'barrier-medium', {
        group: 'sfx',
        volume: 0.55 + s * 0.45,
        rate: jitter(),
      });
      // Debris: brittle, sharp, slightly late. This is the layer that makes it a
      // crash rather than a bump.
      if (s > 0.25) {
        api.play('glass-light', { group: 'sfx', volume: 0.3 + s * 0.5, rate: 0.9 * jitter(), delay: 0.035 });
      }
      // Metal on metal, a touch later again.
      if (s > 0.4) {
        api.play('metal-click', { group: 'sfx', volume: 0.25 + s * 0.35, rate: 0.82 * jitter(), delay: 0.075 });
      }
      // A very heavy hit gets a second, darker thud underneath for weight.
      if (s > 0.75) {
        api.play('barrier-heavy', { group: 'sfx', volume: 0.5, rate: 0.7 * jitter(), delay: 0.02 });
      }
      return true;
    },

    /**
     * Full-length music beds, crossfaded.
     *
     * One track at a time on the `music` bus, so the settings volume and the
     * speech duck both apply to it. Tracks are loaded lazily; a request that is
     * superseded by a newer one while its file is still downloading is dropped
     * rather than starting late over the top of the newer track.
     */
    music: {
      current: null,
      handle: null,
      pending: null,

      get playing() {
        return !!api.music.handle;
      },

      /**
       * @param {string} name  a manifest key
       * @param {{volume?:number, fade?:number}} [opts]
       * @returns {Promise<boolean>} false if music is off or the track failed to load
       */
      async play(name, opts = {}) {
        const fade = opts.fade ?? 1.2;
        if (!name || getSettings().music === false) {
          api.music.stop(fade);
          return false;
        }
        if (api.music.current === name && api.music.handle) return true;

        const token = Symbol(name);
        api.music.pending = token;
        const buf = await ensureLoaded(name);
        // A newer scene changed while this file was in flight; let it win.
        if (api.music.pending !== token) return false;
        if (!buf) return false;

        const previous = api.music.handle;
        const handle = api.loop(name, { group: 'music', volume: 0, rate: 1 });
        if (!handle) return false;
        api.music.handle = handle;
        api.music.current = name;
        handle.setVolume(clamp(opts.volume ?? 1, 0, 1));
        if (previous) previous.stop(fade);
        return true;
      },

      stop(fade = 1.0) {
        api.music.pending = null;
        api.music.handle?.stop(fade);
        api.music.handle = null;
        api.music.current = null;
      },
    },

    /** Tyre squeal: recorded loop, gain from slip. */
    skid: {
      handle: null,
      start() {
        api.skid.handle = api.loop('skid-loop', { volume: 0, group: 'sfx', rate: 1 });
        return !!api.skid.handle;
      },
      update(level) {
        if (!api.skid.handle) return false;
        const v = clamp(level, 0, 1);
        api.skid.handle.setVolume(v > 0.06 ? v * 0.55 : 0);
        api.skid.handle.setRate(0.9 + v * 0.5);
        return true;
      },
      stop() {
        api.skid.handle?.stop(0.2);
        api.skid.handle = null;
      },
    },

    // Retained for older speech adapters, deliberately no-ops. No auto ducking.
    duck() {},
    unduck() {},
    get ducked() { return false; },
    get levels() { return targetLevels(); },
    tick() { applyVolumes(); },

    setVolumes() {
      applyVolumes();
    },

    /**
     * Honest status string for the settings screen and for the audio-failure
     * test. Never claims an asset loaded when it did not.
     */
    status() {
      const missing = api.failedAssets;
      if (!AudioCtor) {
        return { ok: false, message: 'This browser does not support Web Audio, so the game is silent. Everything else still works, and all guidance is available as speech and text.' };
      }
      if (!unlocked) {
        return { ok: false, message: 'Audio is waiting for your first tap. Browsers require it before any sound can play.' };
      }
      if (missing.length === 0) {
        return { ok: true, message: `All ${buffers.size} recorded sound assets loaded.` };
      }
      return {
        ok: false,
        partial: true,
        message: `${buffers.size} sound assets loaded and ${missing.length} could not be loaded. Missing sounds are silent rather than replaced. The game remains playable.`,
        missing: missing.map((m) => m.name),
      };
    },
  };

  return api;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}
