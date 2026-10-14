/**
 * A fake Web Audio graph, so the mix can be tested headlessly.
 *
 * Web Audio cannot be exercised in jsdom and there is no audio device in CI, so
 * without this the ducking behaviour — the thing that decides whether Game
 * TalkBack can be heard over the engine — would be untestable and would have to
 * be reasoned about instead of verified. It already regressed once that way.
 *
 * Only what `createAudio` actually touches is implemented: gain nodes, buffer
 * sources, a clock, and enough state for `unlock()` to succeed. Every gain
 * created is recorded in creation order (master, then sfx, music, voice, engine)
 * and every parameter change is logged, so a test can assert both the intended
 * level and that it reached the graph as a ramp rather than a click.
 */

export function createFakeAudioContext(options = {}) {
  const gains = [];
  const sources = [];
  const started = [];
  const contexts = [];
  const decoded = [];

  let now = options.startTime ?? 0;

  function makeParam(value) {
    const param = {
      value,
      ramps: [],
      setTargetAtTime(target, when, timeConstant) {
        param.ramps.push({ target, when, timeConstant });
        param.value = target;
        return param;
      },
      setValueAtTime(target, when) {
        param.ramps.push({ target, when, timeConstant: 0 });
        param.value = target;
        return param;
      },
      cancelScheduledValues() {
        return param;
      },
    };
    return param;
  }

  function makeGain(label) {
    const node = {
      label,
      gain: makeParam(1),
      connections: [],
      connect(dest) {
        node.connections.push(dest);
        return dest;
      },
      disconnect() {},
    };
    gains.push(node);
    return node;
  }

  class FakeAudioContext {
    constructor() {
      this.state = options.state ?? 'running';
      this.currentTime = now;
      this.sampleRate = 48000;
      this.destination = { label: 'destination', connect: () => {} };
      this.resumeCalls = 0;
      contexts.push(this);
    }

    createGain() {
      return makeGain(`gain-${gains.length}`);
    }

    createBufferSource() {
      const src = {
        buffer: null,
        loop: false,
        playbackRate: makeParam(1),
        started: false,
        stoppedAt: null,
        connect(dest) {
          return dest;
        },
        start() {
          src.started = true;
          started.push(src);
        },
        stop(when) {
          src.stoppedAt = when ?? null;
        },
      };
      sources.push(src);
      return src;
    }

    async resume() {
      this.resumeCalls += 1;
      this.state = 'running';
    }

    async decodeAudioData(data) {
      decoded.push({ bytes: data?.byteLength ?? 0, at: now });
      return { decoded: true, bytes: data?.byteLength ?? 0 };
    }

    async close() {
      this.state = 'closed';
    }
  }

  return {
    AudioContext: FakeAudioContext,
    /** Every gain node created, in creation order: master, sfx, music, voice, engine. */
    gains,
    sources,
    started,
    /** Move the audio clock forward; every created context follows. */
    advance(seconds) {
      now += seconds;
      for (const c of contexts) c.currentTime = now;
      return now;
    },
    contexts,
    decoded,
    get time() {
      return now;
    },
  };
}

/**
 * Hold `Date.now()` at a controllable value, because the duck timing in
 * `createAudio` is wall-clock based. Restores the real clock on release.
 */
export function createFakeClock(startMs = 1_000_000) {
  const real = Date.now;
  let current = startMs;
  Date.now = () => current;
  return {
    advance(ms) {
      current += ms;
      return current;
    },
    get time() {
      return current;
    },
    release() {
      Date.now = real;
    },
  };
}

/** A stand-in decoded buffer; `createAudio` never reads its contents. */
export function fakeBuffer(name = 'fake', duration = 2) {
  return { name, duration, length: 96000, numberOfChannels: 2, sampleRate: 48000 };
}

/**
 * A fetch stand-in that records every URL asked for and answers with a few
 * bytes. Used to prove that the large music beds are fetched on demand and not
 * at boot, which is the whole point of LAZY_AUDIO.
 */
export function createFakeFetch(options = {}) {
  const requested = [];
  const failFor = new Set(options.failFor ?? []);
  const impl = async (url) => {
    requested.push(String(url));
    if (failFor.has(String(url))) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(options.bytes ?? 64) };
  };
  impl.requested = requested;
  return impl;
}
