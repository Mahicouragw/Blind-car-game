/**
 * Game TalkBack speech scheduler - pure logic.
 *
 * A racing game generates far more things worth saying than a player can
 * listen to. This module decides what actually gets spoken: by priority, with
 * per-message cooldowns so the same warning cannot nag, with a bounded queue so
 * stale advice is dropped instead of queued, and with explicit preemption rules
 * so a safety warning is never stuck behind a flavour line.
 *
 * It knows nothing about the Web Speech API; a11y/speech.js drives it.
 *
 * @module a11y/speechQueue
 */

/** Higher numbers win. */
export const SPEECH_PRIORITY = {
  AMBIENT: 0, // crowd colour, atmosphere
  LOW: 1, // optional flavour
  NORMAL: 2, // lap, position, zone changes
  HIGH: 3, // corner warnings, opponent proximity
  CRITICAL: 4, // off track, countdown, race start, finish, safety
};

/** Default cooldown per priority, in ms, at the "balanced" frequency. */
export const DEFAULT_COOLDOWN = {
  0: 12000,
  1: 6000,
  2: 2600,
  3: 1400,
  4: 0,
};

/**
 * How long a queued message is still worth saying, in ms, by priority.
 *
 * Without this the queue was a tape delay: a state announcement that sat behind
 * a story passage was still delivered twenty seconds later, describing a moment
 * that had passed. "You are going left" is worthless once the car is going
 * right, so anything that has waited too long is dropped rather than spoken.
 *
 * Safety and navigation messages keep a long life because they stay true; live
 * state has a short one. Callers can override per message.
 */
export const STALE_MS = {
  0: 12000, // AMBIENT
  1: 8000, // LOW
  2: 5000, // NORMAL - lap, position, driving state
  3: 10000, // HIGH - warnings
  4: 20000, // CRITICAL - safety, countdown, finish
};

export const QUEUE_LIMITS = {
  // A long passage (the welcome, story narration) is queued sentence by
  // sentence, so the queue has to hold a whole passage plus whatever arrives
  // while it is being read. Four slots silently swallowed the end of the
  // welcome; twelve holds a passage with room for a live warning.
  maxPending: 12,
  maxTextLength: 600,
};

let seq = 0;

/**
 * @param {object} [config]
 * @param {() => number} [config.now]
 * @param {number} [config.maxPending]
 * @param {number} [config.frequencyFactor] 1 = balanced; <1 = more talkative
 */
export function createSpeechQueue(config = {}) {
  let now = config.now ?? (() => Date.now());
  let maxPending = config.maxPending ?? QUEUE_LIMITS.maxPending;

  const state = {
    enabled: true,
    concise: false,
    frequencyFactor: config.frequencyFactor ?? 1,
    /** @type {Array<object>} */
    pending: [],
    speaking: null,
    lastSpokenAt: new Map(),
    stats: { offered: 0, spoken: 0, droppedCooldown: 0, droppedDisabled: 0, droppedFull: 0, droppedStale: 0, replaced: 0, interrupted: 0 },
  };

  function textFor(item) {
    if (state.concise && item.concise) return item.concise;
    return item.text;
  }

  function cooldownFor(item) {
    const base = item.cooldownMs ?? DEFAULT_COOLDOWN[item.priority] ?? 2000;
    return base * state.frequencyFactor;
  }

  function isBlockedByKey(item, t) {
    if (!item.key) return false;
    const last = state.lastSpokenAt.get(item.key);
    if (last === undefined) return false;
    return t - last < cooldownFor(item);
  }

  /** Index of the item that should be spoken next: highest priority, then oldest. */
  function pickIndex() {
    let best = 0;
    for (let i = 1; i < state.pending.length; i++) {
      const a = state.pending[i];
      const b = state.pending[best];
      if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
    }
    return best;
  }

  /** Index of the item to drop when the queue is full: lowest priority, then oldest. */
  function pickWorstIndex() {
    let worst = 0;
    for (let i = 1; i < state.pending.length; i++) {
      const a = state.pending[i];
      const b = state.pending[worst];
      if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) worst = i;
    }
    return worst;
  }

  const api = {
    state,

    setClock(fn) {
      now = fn;
    },
    setEnabled(on) {
      state.enabled = !!on;
      if (!state.enabled) {
        // Turning Game TalkBack off stops GAME speech. Essential items are the
        // accessibility surface itself, so they survive: otherwise switching
        // guidance off would silence the settings screen and trap the player.
        // The line already being spoken is allowed to finish.
        for (let i = state.pending.length - 1; i >= 0; i--) {
          if (!state.pending[i].essential) state.pending.splice(i, 1);
        }
      }
    },
    setConcise(on) {
      state.concise = !!on;
    },
    setFrequencyFactor(f) {
      if (Number.isFinite(f) && f > 0) state.frequencyFactor = f;
    },
    setMaxPending(n) {
      if (Number.isFinite(n) && n > 0) maxPending = Math.floor(n);
    },

    /**
     * Offer a message.
     * @param {{text:string, priority?:number, key?:string, cooldownMs?:number,
     *          interrupt?:boolean, essential?:boolean, concise?:string, id?:string}} item
     * @returns {{accepted:boolean, reason?:string, dropped?:object}}
     */
    offer(item) {
      if (!item || typeof item.text !== 'string' || item.text.trim() === '') {
        return { accepted: false, reason: 'empty' };
      }
      state.stats.offered++;
      const t = now();
      const priority = Number.isFinite(item.priority) ? item.priority : SPEECH_PRIORITY.NORMAL;

      // Essential messages survive the master off switch. These are the
      // accessibility surface itself (settings confirmations, "guidance is off")
      // so a blind player is never left in a silent settings screen.
      if (!state.enabled && !item.essential) {
        state.stats.droppedDisabled++;
        return { accepted: false, reason: 'talkback-off' };
      }

      if (isBlockedByKey({ ...item, priority }, t)) {
        state.stats.droppedCooldown++;
        return { accepted: false, reason: 'cooldown' };
      }

      // Never interrupt equal or lower priority speech unless asked to.
      const preempts =
        state.speaking && item.interrupt && priority > state.speaking.priority;

      // Latest wins: a newer message with the same key REPLACES the one still
      // waiting, rather than joining it.
      //
      // This was the worst bug in the whole speech system. A driving
      // announcement is offered every animation frame, and the per-key cooldown
      // only knew about messages that had already been SPOKEN - pending copies
      // were invisible to it. Sixty frames of "You are going left" queued twelve
      // identical copies, and the player then heard the car going left for the
      // next thirty seconds while it was actually going right.
      // Replace what this message supersedes - and be careful to replace only
      // the PREVIOUS saying of it.
      //
      // A passage arrives as several chunks sharing one group. Chunks of the same
      // passage must NOT replace each other, or a six-chunk paragraph collapses
      // down to its last sentence. So group matching also requires a different
      // passage: same key always supersedes, same group supersedes only across
      // passages. `passageId` is what tells those apart.
      let replaced = null;
      if (item.key || item.group) {
        for (let i = state.pending.length - 1; i >= 0; i--) {
          const p = state.pending[i];
          const sameKey = !!item.key && p.key === item.key;
          const sameGroupNewPassage =
            !!item.group && p.group === item.group && item.passageId !== undefined && p.passageId !== item.passageId;
          if (sameKey || sameGroupNewPassage) {
            replaced = state.pending.splice(i, 1)[0];
            state.stats.replaced++;
          }
        }
      }

      const record = {
        seq: ++seq,
        id: item.id ?? `msg.${seq}`,
        text: item.text.slice(0, QUEUE_LIMITS.maxTextLength),
        concise: item.concise ? String(item.concise).slice(0, QUEUE_LIMITS.maxTextLength) : null,
        priority,
        key: item.key ?? null,
        essential: !!item.essential,
        interrupt: !!item.interrupt,
        group: item.group ?? null,
        offeredAt: t,
        preempts: !!preempts,
        // A screen change or a story beat can demand the line immediately. This
        // ignores priority entirely, because equal-priority speech could never
        // interrupt equal-priority speech: every passage the player tapped past
        // stayed in the queue and was read out afterwards.
        hardInterrupt: !!item.hardInterrupt,
        // Which reading of this group it belongs to. See the replacement rule.
        passageId: item.passageId ?? null,
        expiresAt: t + (Number.isFinite(item.ttlMs) ? item.ttlMs : STALE_MS[priority] ?? 6000),
        tag: item.tag ?? null,
      };

      let dropped;
      if (state.pending.length >= maxPending) {
        // Make room by dropping the least important queued item, but only if
        // the newcomer actually outranks it.
        const worst = pickWorstIndex();
        const victim = state.pending[worst];
        if (record.priority <= victim.priority) {
          state.stats.droppedFull++;
          return { accepted: false, reason: 'queue-full', dropped: undefined };
        }
        state.pending.splice(worst, 1);
        dropped = victim;
        state.stats.droppedFull++;
      }

      state.pending.push(record);
      return { accepted: true, reason: replaced ? 'replaced' : preempts ? 'preempt' : 'queued', dropped, replaced, record };
    },

    /**
     * Is any queued message demanding the line immediately, whatever is speaking?
     *
     * This scans the whole queue rather than peeking at the head. A hard
     * interrupt can be sitting behind an equal-priority item - the head is picked
     * by priority then arrival order, so a screen announcement can be behind a
     * line queued a moment earlier - and peeking would miss it, leaving the
     * announcement stuck behind speech that should have been cut.
     */
    shouldHardInterrupt() {
      return state.pending.some((p) => p.hardInterrupt);
    },

    /** Should the adapter cancel what it is currently saying right now? */
    shouldInterrupt() {
      if (!state.speaking) return false;
      const next = api.peek();
      return !!next && !!next.interrupt && next.priority > state.speaking.priority;
    },

    /** Look at the next item without removing it. */
    peek() {
      if (state.pending.length === 0) return null;
      return state.pending[pickIndex()];
    },

    /**
     * Claim the next item to speak. Returns null while something is speaking.
     */
    take() {
      if (state.speaking || state.pending.length === 0) return null;
      const idx = pickIndex();
      const item = state.pending.splice(idx, 1)[0];
      const t = now();
      // Too late to be true any more. Say nothing rather than something wrong.
      if (item.expiresAt !== undefined && t > item.expiresAt) {
        state.stats.droppedStale++;
        return api.take();
      }
      // Re-check the cooldown at delivery time: the item may have sat queued.
      if (item.key && isBlockedByKey(item, t)) {
        state.stats.droppedCooldown++;
        return api.take();
      }
      state.speaking = item;
      if (item.key) state.lastSpokenAt.set(item.key, t);
      state.stats.spoken++;
      return { ...item, text: textFor(item), fullText: item.text };
    },

    /** Report that the current utterance ended (or was cancelled). */
    finish() {
      const was = state.speaking;
      state.speaking = null;
      if (was && was.preempts) state.stats.interrupted++;
      return was;
    },

    /** Forget the current utterance's cooldown so it can be repeated on demand. */
    releaseKey(key) {
      state.lastSpokenAt.delete(key);
    },

    /** Drop everything queued. Used on screen changes. */
    clear(reason = 'clear') {
      state.pending.length = 0;
      void reason;
    },

    /** Repeat the most recent spoken line - the triple-tap action. */
    lastSpokenText() {
      return state.speaking ? textFor(state.speaking) : null;
    },

    get pendingCount() {
      return state.pending.length;
    },
    get isSpeaking() {
      return state.speaking !== null;
    },
    stats: state.stats,
  };

  return api;
}
