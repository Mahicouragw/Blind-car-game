/**
 * Audio: recorded sample playback, engine synthesis FROM RECORDINGS, and ducking.
 *
 * Every sound in this game is a real recorded file from assets/audio, licensed
 * CC0 1.0 (see docs/AUDIO-CREDITS.md). Nothing here generates a tone: there is
 * no oscillator, no noise buffer, no synthesised substitute anywhere in this
 * module. If a file fails to load, that sound is silent and the failure is
 * reported - it is never quietly replaced by something generated.
 *
 * Engine and tyre audio are recorded loops whose playback rate and gain are
 * driven by rpm and slip. Changing the playback rate of a recording is
 * manipulation of a recorded asset, not synthesis; that distinction is stated
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
  'ui-tick': `${A}/ui/tick.ogg`,
  'ui-switch': `${A}/ui/switch.ogg`,
  'ui-glass': `${A}/ui/glass.ogg`,
  'ui-pluck': `${A}/ui/pluck.ogg`,
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
};

/**
 * Sound slots the brief asks for that have NO verified CC0 recording available
 * from the sources reachable while building this. They are declared here so the
 * gap is visible in code and in the credits, and so nothing silently pretends to
 * fill them with generated audio.
 */
export const AUDIO_GAPS = [
  { slot: 'crowd-cheer', want: 'Grandstand crowd cheering at the start and finish.', status: 'unfilled' },
  { slot: 'city-ambience', want: 'Anandapur street ambience for chapter one.', status: 'unfilled' },
  { slot: 'home-ambience', want: 'Family home room tone for the argument scenes.', status: 'unfilled' },
  { slot: 'workshop-ambience', want: 'Continuous workshop floor ambience.', status: 'unfilled' },
  { slot: 'pit-lane-ambience', want: 'Pit lane ambience with air guns and engines.', status: 'unfilled' },
  { slot: 'gear-change', want: 'A dedicated recorded gear-change clunk.', cueUsed: 'metal-click', status: 'substituted-with-recording' },
  { slot: 'background-music', want: 'Full-length looping background music.', cueUsed: 'short stingers only', status: 'partial' },
  { slot: 'voice-acting', want: 'Recorded voice acting for story dialogue.', cueUsed: 'speech synthesis, labelled as synthesis', status: 'synthesised-not-recorded' },
];

/** How far engine and music drop while Game TalkBack is speaking. */
export const DUCK_LEVELS = { engine: 0.3, music: 0.22, sfx: 0.6, recoveryMs: 420 };

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
  let unlocked = false;
  let duckUntil = 0;
  let ducked = false;

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

  function applyVolumes() {
    const s = getSettings();
    if (!ctx) return;
    const duck = ducked ? 1 : 1;
    if (groups.sfx) groups.sfx.gain.value = (s.sfx === false ? 0 : (s.sfxVolume ?? 0.85)) * (ducked ? DUCK_LEVELS.sfx : 1);
    if (groups.music) groups.music.gain.value = (s.music === false ? 0 : (s.musicVolume ?? 0.5)) * (ducked ? DUCK_LEVELS.music : 1);
    if (groups.voice) groups.voice.gain.value = 1;
    if (groups.engine) groups.engine.gain.value = (s.sfx === false ? 0 : (s.sfxVolume ?? 0.85)) * (ducked ? DUCK_LEVELS.engine : 1);
    void duck;
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

    /** Load every asset. Failures are isolated and recorded, never fatal. */
    async loadAll(names = Object.keys(AUDIO_MANIFEST)) {
      ensureContext();
      if (!ctx || !fetchImpl) {
        for (const n of names) failed.set(n, 'Web Audio is not available in this browser');
        return { loaded: 0, failed: names.length };
      }
      let loaded = 0;
      await Promise.all(
        names.map(async (name) => {
          const url = AUDIO_MANIFEST[name];
          if (!url) {
            failed.set(name, 'not in the manifest');
            return;
          }
          if (buffers.has(name)) {
            loaded++;
            return;
          }
          try {
            const res = await fetchImpl(url, { mode: 'same-origin', credentials: 'omit' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.arrayBuffer();
            const buf = await ctx.decodeAudioData(data);
            buffers.set(name, buf);
            loaded++;
          } catch (err) {
            failed.set(name, err?.message || 'could not be loaded');
          }
        })
      );
      return { loaded, failed: failed.size };
    },

    /**
     * Play a recorded one-shot.
     * @param {string} name
     * @param {{volume?:number, rate?:number, group?:string, delay?:number}} [opts]
     */
    play(name, opts = {}) {
      if (!ctx || !unlocked) return false;
      const buf = buffers.get(name);
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
      } catch {
        return false;
      }
      return true;
    },

    /**
     * Start a recorded loop. Returns a handle to change rate/gain and stop it.
     */
    loop(name, opts = {}) {
      if (!ctx || !unlocked) return null;
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
            gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
            src.stop(ctx.currentTime + fade);
          } catch {
            /* ignore */
          }
          loops.delete(name);
        },
        _stopped: false,
      };
      loops.set(name, handle);
      return handle;
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
        // A recorded loop pitched up 0.7x..1.9x covers idle to redline.
        const rate = 0.72 + frac * 1.18;
        const load = clamp(s.load ?? s.throttle ?? 0, 0, 1);
        const loud = 0.22 + load * 0.5 + frac * 0.18;
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

    /** Called by the speech system so guidance stays intelligible. */
    duck(ms = DUCK_LEVELS.recoveryMs) {
      ducked = true;
      duckUntil = Date.now() + ms;
      applyVolumes();
    },
    unduck() {
      duckUntil = Date.now() + 120;
    },
    /** Call once per frame; releases the duck after speech has finished. */
    tick() {
      if (ducked && Date.now() > duckUntil) {
        ducked = false;
        applyVolumes();
      }
      applyVolumes();
    },

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
