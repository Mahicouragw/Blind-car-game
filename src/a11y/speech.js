/**
 * Game TalkBack: the built-in spoken guidance system.
 *
 * This is the piece that must work WITHOUT Android TalkBack or any device
 * accessibility service, so it drives the Web Speech API directly and keeps its
 * own priority queue (a11y/speechQueue.js). It also mirrors every line into a
 * polite ARIA live region, so a player who does use a screen reader, or who has
 * no speech synthesis voices installed, still receives the same information as
 * text.
 *
 * If `speechSynthesis` is missing or has no voices, the game says so in plain
 * language and keeps the live region working - it never silently fails.
 *
 * @module a11y/speech
 */

import { createSpeechQueue, SPEECH_PRIORITY } from './speechQueue.js';
import { bus } from '../core/bus.js';

export const SPEECH_STATUS = {
  READY: 'ready',
  UNSUPPORTED: 'unsupported',
  NO_VOICES: 'no-voices',
  ERROR: 'error',
  OFF: 'off',
};

export function createSpeech(config = {}) {
  const queue = createSpeechQueue({ now: config.now });
  const getSettings = config.getSettings ?? (() => ({}));
  const onDuck = config.onDuck ?? (() => {});
  const onUnduck = config.onUnduck ?? (() => {});

  let synth = typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
  let liveRegion = config.liveRegion ?? null;
  let status = synth ? SPEECH_STATUS.READY : SPEECH_STATUS.UNSUPPORTED;
  let voices = [];
  let pumpTimer = null;
  let lastSpoken = '';
  let supported = !!synth;
  let passageSeq = 0;

  /** When a passage preempts what was being said, its own leftovers stay. */
  function dropOtherPassages(keepGroup) {
    const pending = queue.state.pending;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].group && pending[i].group !== keepGroup) pending.splice(i, 1);
    }
    void keepGroup;
  }

  function loadVoices() {
    if (!synth) return;
    try {
      voices = synth.getVoices() ?? [];
    } catch {
      voices = [];
    }
    if (voices.length === 0) {
      status = SPEECH_STATUS.NO_VOICES;
      bus.emit('speech:status', { status, message: NO_VOICE_MESSAGE });
    } else if (status === SPEECH_STATUS.NO_VOICES) {
      status = SPEECH_STATUS.READY;
      bus.emit('speech:status', { status, message: '' });
    }
  }

  if (synth) {
    loadVoices();
    // Chrome populates the voice list asynchronously and fires this once ready.
    try {
      synth.addEventListener?.('voiceschanged', loadVoices);
    } catch {
      /* older browsers */
    }
  }

  function pickVoice() {
    const want = getSettings().speechVoice;
    if (want && voices.length) {
      const exact = voices.find((v) => v.name === want || v.voiceURI === want);
      if (exact) return exact;
    }
    if (!voices.length) return null;
    // Prefer an English voice, then whatever the device offers first.
    const en = voices.find((v) => /^en/i.test(v.lang ?? ''));
    return en ?? voices[0];
  }

  function pushToLiveRegion(text) {
    if (!liveRegion) return;
    try {
      // Clearing first forces assistive tech to re-announce identical lines.
      liveRegion.textContent = '';
      liveRegion.textContent = text;
    } catch {
      /* ignore DOM failures */
    }
    lastSpoken = text;
  }

  function speakNow(item) {
    const settings = getSettings();
    pushToLiveRegion(item.text);

    // Essential items are the accessibility surface itself: the confirmation
    // that guidance was turned off, and the settings screen that turns it back
    // on. They must survive the master switch, otherwise switching Game TalkBack
    // off would leave a blind player in a silent settings screen with no way out.
    if (!supported || (!settings.talkback && !item.essential)) {
      queue.finish();
      onUnduck();
      return;
    }

    onDuck();
    let utterance;
    try {
      utterance = new SpeechSynthesisUtterance(item.text);
    } catch {
      status = SPEECH_STATUS.ERROR;
      queue.finish();
      onUnduck();
      return;
    }
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = Number.isFinite(settings.speechRate) ? settings.speechRate : 1;
    utterance.pitch = Number.isFinite(settings.speechPitch) ? settings.speechPitch : 1;
    utterance.volume = Number.isFinite(settings.speechVolume) ? settings.speechVolume : 1;

    let settled = false;
    let safety = null;
    const done = () => {
      if (settled) return;
      settled = true;
      if (safety) {
        clearTimeout(safety);
        safety = null;
      }
      queue.finish();
      onUnduck();
      pump();
    };
    utterance.onend = done;
    utterance.onerror = () => {
      // A single failed utterance must not kill guidance for the rest of the
      // session; report it once and carry on with the live region.
      if (status === SPEECH_STATUS.READY) {
        status = SPEECH_STATUS.ERROR;
        bus.emit('speech:status', { status, message: ERROR_MESSAGE });
      }
      done();
    };

    try {
      synth.speak(utterance);
    } catch {
      done();
    }
    // Safety net: some browsers never fire onend for a cancelled utterance.
    // It is cleared as soon as the utterance settles, so a long paragraph does
    // not leave a timer running for minutes afterwards.
    safety = setTimeout(done, Math.min(12000, 1600 + item.text.length * 55));
  }

  function pump() {
    if (pumpTimer) {
      clearTimeout(pumpTimer);
      pumpTimer = null;
    }
    const settings = getSettings();
    // `enabled` is driven explicitly by the settings screen (see main.js), not
    // re-derived here: pump() runs while essential confirmations are queued, and
    // re-deriving it would drop the very line telling the player guidance is off.
    queue.setConcise(!!settings.conciseSpeech);

    if (queue.isSpeaking) {
      // A hard interrupt ignores priority. Equal-priority speech could never
      // interrupt equal-priority speech, which is how every story passage the
      // player tapped past stayed in the queue and was read out afterwards, and
      // how a screen announcement ended up behind the previous screen's backlog.
      if (queue.shouldHardInterrupt() || queue.shouldInterrupt()) {
        // A CRITICAL warning outranks what is currently being said.
        try {
          synth?.cancel();
        } catch {
          /* ignore */
        }
        queue.finish();
        onUnduck();
      } else {
        pumpTimer = setTimeout(pump, 120);
        return;
      }
    }
    const next = queue.take();
    if (!next) return;
    speakNow(next);
  }

  const api = {
    queue,
    get status() {
      return status;
    },
    get supported() {
      return supported;
    },
    get voices() {
      return voices.map((v) => ({ name: v.name, lang: v.lang, uri: v.voiceURI }));
    },
    get lastSpoken() {
      return lastSpoken;
    },

    attach(region) {
      liveRegion = region;
    },
    /** Mirror the master switch into the queue. Called on boot and on change. */
    setEnabled(on) {
      queue.setEnabled(on);
    },
    setSynth(s) {
      synth = s;
      supported = !!s;
      status = s ? SPEECH_STATUS.READY : SPEECH_STATUS.UNSUPPORTED;
      if (s) loadVoices();
    },

    /**
     * The single entry point used by the whole game.
     *
     * Long passages (the welcome, story narration, results) are split into
     * sentence-sized chunks and queued in order, so nothing is truncated and an
     * interruption can still land between sentences.
     *
     * @param {string} text
     * @param {object} [opts] priority, key, cooldownMs, interrupt, essential, concise
     */
    /**
     * Show a line in the caption area WITHOUT speaking it.
     *
     * Some cues are delivered as recorded human samples rather than synthesis -
     * the countdown numbers, Ready, Go and the finish lines. Those used to be
     * spoken as well, which made every count number audible twice in two different
     * voices. When the sample is the delivery, this keeps the text visible and
     * available to assistive technology without a second voice saying it.
     */
    mirror(text) {
      if (!text) return false;
      pushToLiveRegion(text);
      return true;
    },

    say(text, opts = {}) {
      if (!text) return false;
      const chunks = splitForSpeech(text);
      if (chunks.length <= 1) {
        const res = queue.offer({ text, ...opts });
        if (res.accepted) pump();
        return res.accepted;
      }
      // A keyed passage shares one group named after its key, so a later passage
      // with the same key supersedes every chunk of the earlier one. Story beats
      // are keyed for exactly this reason: tapping on must replace the beat, not
      // queue behind it. `passageId` separates one reading from the next.
      const passageId = ++passageSeq;
      const group = opts.key ? `key:${opts.key}` : `passage.${passageId}`;
      let accepted = false;
      chunks.forEach((chunk, i) => {
        const res = queue.offer({
          ...opts,
          text: chunk,
          group,
          passageId,
          // Only the first chunk carries the caller's cooldown key, otherwise
          // every following sentence would be swallowed as a duplicate.
          key: i === 0 ? opts.key : null,
          // Preemption applies once, at the start of the passage.
          interrupt: i === 0 ? opts.interrupt : false,
        });
        if (res.accepted) accepted = true;
      });
      if (accepted && opts.interrupt) dropOtherPassages(group);
      if (accepted) pump();
      return accepted;
    },

    sayCritical(text, opts = {}) {
      return api.say(text, { priority: SPEECH_PRIORITY.CRITICAL, interrupt: true, cooldownMs: 0, ...opts });
    },

    /** Settings-screen lines: spoken even when Game TalkBack is off. */
    sayEssential(text, opts = {}) {
      return api.say(text, { essential: true, priority: SPEECH_PRIORITY.HIGH, ...opts });
    },

    stop() {
      queue.clear();
      try {
        synth?.cancel();
      } catch {
        /* ignore */
      }
      queue.finish();
      onUnduck();
    },

    /** Repeat the last line - used by the triple-tap action. */
    repeat() {
      const text = queue.lastSpokenText() || lastSpoken;
      if (!text) {
        api.sayEssential('Nothing has been announced yet.');
        return false;
      }
      queue.releaseKey('repeat');
      return api.say(text, { priority: SPEECH_PRIORITY.HIGH, key: 'repeat', cooldownMs: 0, essential: true });
    },

    /** Called every animation frame while driving. */
    tick() {
      pump();
    },

    /** What to tell a player when speech cannot work on their device. */
    explainStatus() {
      switch (status) {
        case SPEECH_STATUS.UNSUPPORTED:
          return UNSUPPORTED_MESSAGE;
        case SPEECH_STATUS.NO_VOICES:
          return NO_VOICE_MESSAGE;
        case SPEECH_STATUS.ERROR:
          return ERROR_MESSAGE;
        case SPEECH_STATUS.OFF:
          return 'Game TalkBack is off. Every line is still shown in the caption area, and the voice settings button is always available to turn it back on.';
        default:
          return 'Game TalkBack is ready. Spoken guidance is on and does not require your phone screen reader.';
      }
    },
    SPEECH_PRIORITY,
  };

  return api;
}

/**
 * Split text into speakable chunks at sentence boundaries.
 *
 * A single utterance that is too long gets clipped by the queue, and a very long
 * utterance also cannot be interrupted by a safety warning. Both problems go
 * away if passages are queued sentence by sentence.
 */
export function splitForSpeech(text, maxLen = 240) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean ? [clean] : [];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (!current) current = sentence;
    else if (current.length + 1 + sentence.length <= maxLen) current += ' ' + sentence;
    else {
      chunks.push(current);
      current = sentence;
    }
    // A single sentence longer than the limit is hard-split at a comma or space.
    while (current.length > maxLen) {
      let cut = current.lastIndexOf(',', maxLen);
      if (cut < maxLen * 0.5) cut = current.lastIndexOf(' ', maxLen);
      if (cut < maxLen * 0.3) cut = maxLen;
      chunks.push(current.slice(0, cut).trim());
      current = current.slice(cut).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export const UNSUPPORTED_MESSAGE =
  'This browser does not provide speech synthesis, so Game TalkBack cannot speak. Every announcement is still shown as text in the caption area below the screen, and you can play the whole game by reading it. If you want spoken guidance, try the game in Chrome on Android or in a desktop browser.';

export const NO_VOICE_MESSAGE =
  'This device has no speech voices installed, so Game TalkBack cannot speak yet. Announcements are still shown as text in the caption area. Installing a language or text-to-speech voice in your device settings will enable speech, and the game will pick it up automatically.';

export const ERROR_MESSAGE =
  'Speech stopped working part-way through. Announcements continue as text in the caption area. Turning Game TalkBack off and on again in the voice settings usually restores speech.';
