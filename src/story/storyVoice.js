/**
 * Story voice player: character dialogue with music and effects in sync.
 *
 * This is what makes every character speak in their own voice instead of the
 * single Game TalkBack guidance voice. For each story node it:
 *
 * 1. Stops whatever the previous node was saying (a recording or synthesis),
 *    so tapping on never layers two characters over each other.
 * 2. Mirrors the line into the live region immediately, so captions and
 *    screen readers show it even while the recording is still downloading.
 * 3. Plays the node's recorded character voice when one exists and is usable
 *    (see voiceCast.js), AFTER the scene's sound effect has had its moment —
 *    the door opens, then Sudha speaks. Music keeps playing underneath at its
 *    own level; nothing here touches the mix. Nodes that mix narration and
 *    dialogue play as sequenced narrator/character beats (see storyBeats.js),
 *    each beat in its own voice with a pause wherever the voice changes.
 * 4. Speaks the dialogue choices afterwards in the guidance voice, because
 *    choices are interface, not character lines.
 * 5. Falls back to the character's distinct synthesis voice (own pitch, rate
 *    and device-voice hints) whenever no recording exists, fails to load, or
 *    would say the wrong hero name. The fallback is still the character's
 *    voice — never the flat guidance voice — unless the player switches
 *    Character voices off in settings.
 *
 * @module story/storyVoice
 */

import { bakedBeatUsable, bakedVoiceUsable, storyBeatKey, storyVoiceKey, voiceForNode, voiceForSpeaker, voiceLeadMs } from './voiceCast.js';
import { BEAT_PAUSE_CHANGE_MS, BEAT_PAUSE_SAME_MS, beatsFor } from './storyBeats.js';
import { resolveText } from './storyEngine.js';

/**
 * Generous estimate of how long a synthesis beat takes to speak, in ms.
 * Used only to schedule the NEXT beat: the queue itself prevents overlap,
 * so overshooting just lengthens the pause, while undershooting would cut
 * the narrator's tail when a file beat starts.
 */
function estimateSynthesisMs(text, rate) {
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return Math.max(2000, Math.round((String(text).length * 85) / r) + 800);
}

export function createStoryVoice(config = {}) {
  const audio = config.audio ?? null;
  const speech = config.speech ?? null;
  const getSettings = config.getSettings ?? (() => ({}));
  const getStoryState = config.getStoryState ?? (() => ({}));
  const isSuspended = config.isSuspended ?? (() => false);
  const beatPauseSame = config.beatPauseSameMs ?? BEAT_PAUSE_SAME_MS;
  const beatPauseChange = config.beatPauseChangeMs ?? BEAT_PAUSE_CHANGE_MS;
  const beatEstimateFixed = config.beatEstimateMs ?? null;

  let fileHandle = null;
  let pendingTimer = null;
  let token = 0;

  function clearPending() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  }

  function stopFile() {
    if (fileHandle) {
      try {
        fileHandle.stop(0.05);
      } catch {
        /* already ended */
      }
      fileHandle = null;
    }
  }

  function speechVolume() {
    const v = getSettings().speechVolume;
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  }

  function storyVoicesOn() {
    return getSettings().storyVoices !== false;
  }

  function sayChoices(choicesSpoken) {
    if (!choicesSpoken) return;
    speech?.say(choicesSpoken, { priority: 2, essential: true, cooldownMs: 0 });
  }

  /**
   * Speak a story node in its character's voice.
   *
   * @param {object} node  described node: {id, speaker, text, sfx}
   * @param {object} [opts]
   * @param {string} [opts.choicesSpoken]  guidance-voiced after the character
   * @returns {Promise<{mode:string, voice:string|null, key:string|null}>}
   */
  async function speakNode(node, opts = {}) {
    const my = ++token;
    clearPending();
    stopFile();
    if (!node) return { mode: 'skipped', voice: null, key: null };
    // The beat owns the ears. A tap's leftover ("Continue") or any backlog is
    // cut the moment the new line starts, so a recording never plays over (or
    // under) speech that belongs to the previous moment. This is the "action
    // supersedes the press" rule from main.js, extended to recordings, which
    // issue no speech of their own to do the superseding.
    stopSpeech();

    const profile = voiceForNode(node);
    const choicesSpoken = opts.choicesSpoken ?? '';

    // The legacy path: one guidance voice for everything.
    if (!storyVoicesOn()) {
      speech?.say(`${node.speaker ? `${node.speaker} says: ` : ''}${node.text}${choicesSpoken ? ` ${choicesSpoken}` : ''}`, {
        priority: 3,
        cooldownMs: 0,
        interrupt: true,
        essential: true,
      });
      return { mode: 'guidance', voice: null, key: null };
    }

    // Captions now; the recording may still be downloading.
    speech?.mirror?.(`${node.speaker ? `${node.speaker}: ` : ''}${node.text}`);

    // Mixed nodes play as sequenced narrator/character beats, each beat in
    // its own voice with a pause wherever the voice changes.
    const beats = beatsFor(node.id);
    if (beats) return speakBeats(my, node, beats, opts);

    // A recording that would say the wrong hero name is worse than none.
    // Files also never start while suspended (background tab): synthesis still
    // goes through so captions and the queue behave exactly as before.
    const key = storyVoiceKey(node.id);
    const canPlayFile =
      key && bakedVoiceUsable(node.id, getStoryState()) && audio?.ready && speechVolume() > 0 && !isSuspended();

    if (!canPlayFile) {
      speakWithCast(node.text, profile, node.speaker);
      // Queued behind the character's passage, so choices follow in order.
      if (choicesSpoken) sayChoices(choicesSpoken);
      return { mode: key ? 'synthesis' : 'synthesis', voice: profile.id, key: null };
    }

    let buffer = null;
    try {
      buffer = await audio.ensureLoaded(key);
    } catch {
      buffer = null;
    }
    if (my !== token) return { mode: 'superseded', voice: profile.id, key };
    if (!buffer) {
      // The file failed to load: the character still speaks, via synthesis.
      speakWithCast(node.text, profile, node.speaker);
      if (choicesSpoken) sayChoices(choicesSpoken);
      return { mode: 'synthesis', voice: profile.id, key: null };
    }

    // The scene's sound effect plays first (the story screen fires it when the
    // node renders); the voice starts once the effect has had its moment.
    const lead = voiceLeadMs(node);
    const durationMs = Number.isFinite(buffer.duration) ? buffer.duration * 1000 : 0;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (my !== token) return;
      // voice.play returns null when audio is inactive (background tab), and
      // the line below turns that into the character's synthesis voice.
      const handle = isSuspended() ? null : audio.voice?.play(key, { volume: speechVolume() });
      if (!handle) {
        speakWithCast(node.text, profile, node.speaker);
        if (choicesSpoken) sayChoices(choicesSpoken);
        return;
      }
      fileHandle = handle;
      let choicesDone = false;
      const finishChoices = () => {
        if (choicesDone || my !== token) return;
        choicesDone = true;
        sayChoices(choicesSpoken);
      };
      handle.onended = finishChoices;
      // Safety net: if the ended event never arrives, the choices still come.
      if (durationMs > 0) {
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          finishChoices();
        }, durationMs + 1500);
      }
    }, lead);

    return { mode: 'file', voice: profile.id, key };
  }

  /**
   * Play a split node as sequenced narrator/character beats. File beats play
   * their recording in the beat's own voice; only unusable clips (renamed
   * hero, salary beats) fall back to the beat's cast synthesis voice. A
   * natural pause separates beats (longer
   * where the voice changes), and the choices follow the last beat exactly
   * like the single-voice path. The whole chain belongs to one token, so
   * moving on or stop() silences it mid-sequence like any other beat.
   */
  async function speakBeats(my, node, beats, opts = {}) {
    const profile = voiceForNode(node);
    const storyState = getStoryState();
    const choicesSpoken = opts.choicesSpoken ?? '';
    const lines = beats.map((beat, i) => {
      const cast = voiceForSpeaker(beat.speaker ?? null);
      const key = storyBeatKey(node.id, i);
      const usable =
        key && bakedBeatUsable(node.id, i, storyState) && audio?.ready && speechVolume() > 0 && !isSuspended();
      return { cast, text: resolveText(beat.text, storyState), key: usable ? key : null, buffer: null };
    });
    // Preload every usable beat up front so the pauses stay pauses rather
    // than turning into download gaps.
    await Promise.all(
      lines.map(async (line) => {
        if (!line.key) return;
        try {
          line.buffer = await audio.ensureLoaded(line.key);
        } catch {
          line.buffer = null;
        }
      })
    );
    if (my !== token) return { mode: 'superseded', voice: profile.id, key: null };
    runBeat(0);
    return { mode: 'beats', voice: profile.id, key: null, beats: lines.length };

    function pauseBefore(i) {
      if (i === 0) return 0;
      return lines[i - 1].cast.id === lines[i].cast.id ? beatPauseSame : beatPauseChange;
    }

    function runBeat(i) {
      if (my !== token) return;
      if (i >= lines.length) {
        sayChoices(choicesSpoken);
        return;
      }
      const line = lines[i];
      const wait = (i === 0 ? voiceLeadMs(node) : 0) + pauseBefore(i);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        if (my !== token) return;
        const handle =
          line.key && line.buffer && !isSuspended() ? audio.voice?.play(line.key, { volume: speechVolume() }) : null;
        if (!handle) {
          speakWithCast(line.text, line.cast, null, i === 0 ? {} : { follow: true });
          if (i === lines.length - 1) {
            sayChoices(choicesSpoken);
            return;
          }
          const est = beatEstimateFixed ?? estimateSynthesisMs(line.text, line.cast.rate);
          pendingTimer = setTimeout(() => {
            pendingTimer = null;
            runBeat(i + 1);
          }, est);
          return;
        }
        // A file beat owns the ears: cut a lingering synthesis tail so the
        // recording never overlaps the narrator's last syllable.
        if (i > 0) stopSpeech();
        fileHandle = handle;
        let advanced = false;
        const advance = () => {
          if (advanced || my !== token) return;
          advanced = true;
          clearPending();
          runBeat(i + 1);
        };
        handle.onended = advance;
        // Safety net: if the ended event never arrives, the chain still runs.
        const durationMs = Number.isFinite(line.buffer.duration) ? line.buffer.duration * 1000 : 0;
        if (durationMs > 0) {
          pendingTimer = setTimeout(() => {
            pendingTimer = null;
            advance();
          }, durationMs + 1500);
        }
      }, wait);
    }
  }

  /**
   * Speak one line in a character's voice.
   *
   * A recording plays first when `opts.fileKey` names one (interview
   * questions, the negotiation primer); otherwise the character's synthesis
   * voice speaks. `opts.followSpoken` is voiced in the guidance voice when the
   * line ends, and `opts.onDone` runs then too, so a second character can
   * answer in order. Both are skipped if the player has already moved on.
   */
  function speak(text, opts = {}) {
    // A follow line joins the current beat; anything else starts a new one and
    // silences whatever the previous beat was still saying.
    if (!opts.follow) {
      token++;
      clearPending();
      stopFile();
    }
    const my = token;
    if (!text) return { mode: 'skipped', voice: null };
    // A new beat cuts leftover speech like speakNode does; a follow line joins
    // the beat it answers, so it must never silence it.
    if (!opts.follow) stopSpeech();
    if (!storyVoicesOn()) {
      speech?.say(text, { priority: opts.priority ?? 3, essential: true, cooldownMs: 0, interrupt: true });
      if (opts.followSpoken) sayChoices(opts.followSpoken);
      opts.onDone?.();
      return { mode: 'guidance', voice: null };
    }
    const profile = voiceForSpeaker(opts.speaker ?? null);
    speech?.mirror?.(`${opts.speaker ? `${opts.speaker}: ` : ''}${text}`);
    let chained = false;
    const finish = () => {
      if (chained || my !== token) return;
      chained = true;
      if (opts.followSpoken) sayChoices(opts.followSpoken);
      opts.onDone?.();
    };
    // Follow lines are always synthesis: they queue behind the beat they join.
    const fileKey = opts.follow ? null : (opts.fileKey ?? null);
    if (fileKey && audio?.ready && speechVolume() > 0 && !isSuspended()) {
      void playFileLine(fileKey, text, profile, opts, my, finish);
      return { mode: 'file', voice: profile.id, key: fileKey };
    }
    const lead = opts.leadMs ?? 0;
    if (lead > 0) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        if (my !== token) return;
        speakWithCast(text, profile, opts.speaker ?? null, opts);
        finish();
      }, lead);
    } else {
      speakWithCast(text, profile, opts.speaker ?? null, opts);
      finish();
    }
    return { mode: 'synthesis', voice: profile.id };
  }

  /** Load and play a one-off recording, falling back to the cast voice. */
  async function playFileLine(fileKey, text, profile, opts, my, finish) {
    let buffer = null;
    try {
      buffer = await audio.ensureLoaded(fileKey);
    } catch {
      buffer = null;
    }
    if (my !== token) return;
    if (!buffer) {
      speakWithCast(text, profile, opts.speaker ?? null, opts);
      finish();
      return;
    }
    const lead = opts.leadMs ?? 0;
    const durationMs = Number.isFinite(buffer.duration) ? buffer.duration * 1000 : 0;
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (my !== token) return;
      // voice.play returns null when audio is inactive (background tab), and
      // the line below turns that into the character's synthesis voice.
      const handle = isSuspended() ? null : audio.voice?.play(fileKey, { volume: speechVolume() });
      if (!handle) {
        speakWithCast(text, profile, opts.speaker ?? null, opts);
        finish();
        return;
      }
      fileHandle = handle;
      handle.onended = finish;
      // Safety net: if the ended event never arrives, the chain still runs.
      if (durationMs > 0) {
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          finish();
        }, durationMs + 1500);
      }
    }, lead);
  }

  function speakWithCast(text, profile, speaker, opts = {}) {
    // Characters never announce their own names aloud: no "Ms. Qureshi: ..."
    // before the line. Identity comes from the distinct voice itself, and the
    // speaker caption plus the mirrored "Name: line" text show who is talking
    // for readers. `follow` lines queue BEHIND the current beat instead of
    // replacing it, so a narrator primer and a character answer can share one
    // scene in order.
    void speaker;
    const follow = !!opts.follow;
    speech?.say(text, {
      priority: opts.priority ?? 3,
      essential: true,
      cooldownMs: 0,
      interrupt: !follow,
      hardInterrupt: !follow,
      key: follow ? null : (opts.key ?? 'storyBeat'),
      voice: profile.voiceHint,
      pitch: profile.pitch,
      rate: profile.rate,
    });
  }

  /** Cut whatever speech is still talking: the tap's leftover, the backlog. */
  function stopSpeech() {
    try {
      speech?.stop?.();
    } catch {
      /* a speech stub without stop */
    }
  }

  /** Silence the story voice: pending starts, the recording, and synthesis. */
  function stop() {
    token++;
    clearPending();
    stopFile();
    stopSpeech();
  }

  return { speakNode, speak, stop };
}
