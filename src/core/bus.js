/**
 * Minimal synchronous event bus.
 *
 * Every subsystem communicates through this instead of holding direct
 * references to each other, which keeps the game modular: a new chapter,
 * car, track or game mode can be added by subscribing/emitting here without
 * editing existing screens.
 *
 * @module core/bus
 */

/**
 * @typedef {(...payload: any[]) => void} Handler
 */

export function createBus() {
  /** @type {Map<string, Set<Handler>>} */
  const listeners = new Map();

  return {
    /**
     * @param {string} event
     * @param {Handler} handler
     * @returns {() => void} unsubscribe function
     */
    on(event, handler) {
      if (typeof handler !== 'function') throw new TypeError('handler must be a function');
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(handler);
      return () => set.delete(handler);
    },

    /**
     * Subscribe once.
     * @param {string} event
     * @param {Handler} handler
     */
    once(event, handler) {
      const off = this.on(event, (...args) => {
        off();
        handler(...args);
      });
      return off;
    },

    /**
     * @param {string} event
     * @param {...any} args
     */
    emit(event, ...args) {
      const set = listeners.get(event);
      if (!set || set.size === 0) return;
      // Copy first: a handler may unsubscribe itself while we iterate.
      for (const handler of [...set]) {
        try {
          handler(...args);
        } catch (err) {
          // A broken listener must never take the game loop down with it.
          console.error(`[bus] listener for "${event}" failed`, err);
        }
      }
    },

    off(event, handler) {
      const set = listeners.get(event);
      if (!set) return;
      if (handler) set.delete(handler);
      else listeners.delete(event);
    },

    clear() {
      listeners.clear();
    },

    /** Test/debug helper: number of listeners for an event. */
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

/** Application-wide bus. */
export const bus = createBus();
