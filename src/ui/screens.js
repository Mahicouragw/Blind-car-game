/**
 * Screen manager, gesture zone mapping, focus management and shared widgets.
 *
 * Every interactive control is a real focusable element with a role, so native
 * keyboard focus, screen-reader focus and the game's own gesture recognizer all
 * agree about what "focused" means. The recognizer works in screen coordinates
 * and asks `zoneAt(x, y)` which control or surface a touch landed on; that map
 * is rebuilt whenever a screen changes.
 *
 * @module ui/screens
 */

import { bus } from '../core/bus.js';

export const ZONE_ROLE = {
  MENU: 'menu',
  LIST: 'list',
  DRIVING: 'driving',
  SETTINGS: 'settings',
  SETTINGS_HOTSPOT: 'settingsHotspot',
  CAR_BROWSER: 'carBrowser',
  READER: 'reader',
};

/**
 * Build the zone map from a container. Elements opt in with `data-zone` and
 * `data-zone-role`; anything unmarked falls back to the screen's default zone.
 */
export function createZoneMap(container, defaultZone) {
  let entries = [];

  function rebuild() {
    entries = [];
    if (!container) return;
    const nodes = container.querySelectorAll('[data-zone]');
    nodes.forEach((el, i) => {
      const role = el.dataset.zoneRole || ZONE_ROLE.MENU;
      entries.push({
        el,
        index: i,
        id: el.dataset.zone,
        role,
        immediateTap: el.dataset.immediateTap === 'true' || role === ZONE_ROLE.MENU || role === ZONE_ROLE.LIST,
        doubleTapHoldTarget: el.dataset.doubleTapHold === 'true',
        hold: el.dataset.hold === 'true' || role === ZONE_ROLE.DRIVING,
        allowCircle: el.dataset.allowCircle === 'true' || role === ZONE_ROLE.DRIVING,
        allowSwipe: el.dataset.allowSwipe !== 'false',
        preventScroll: role === ZONE_ROLE.DRIVING || el.dataset.preventScroll === 'true',
        rect: null,
      });
    });
    measure();
    return entries;
  }

  function measure() {
    for (const entry of entries) {
      const r = entry.el.getBoundingClientRect();
      const host = container.getBoundingClientRect();
      entry.rect = { left: r.left - host.left, top: r.top - host.top, right: r.right - host.left, bottom: r.bottom - host.top };
    }
  }

  function zoneAt(x, y) {
    for (const entry of entries) {
      const r = entry.rect;
      if (!r) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return { ...entry, element: entry.el };
      }
    }
    return defaultZone ?? null;
  }

  return { rebuild, measure, zoneAt, get entries() { return entries; } };
}

/**
 * Focus management for a screen: an ordered list of controls, a current index,
 * and announcements on every move. Swiping up/down in a menu moves through this
 * list, which is the keyboard-equivalent of Tab.
 *
 * The announcement rule here is the one the brief calls "only talk back the
 * current present announcement". Focus lines all share ONE speech key, so a
 * newer focus REPLACES whatever is still waiting instead of queueing behind it:
 * swiping quickly through a menu used to leave a backlog of "3 of 12... 4 of
 * 12..." lines describing buttons the player had already left, and the player
 * heard stale options for the next half a minute. Now the only line that can
 * survive a swipe is the button under the finger right now.
 */
export function createFocusRing(items, { speech, audio, announceOnMove = true, loop = true } = {}) {
  let index = Math.max(0, items.findIndex((i) => i.focused));
  if (index < 0) index = 0;

  function describe(item) {
    return item?.announce?.() ?? item?.label ?? '';
  }

  function apply() {
    items.forEach((item, i) => {
      item.element?.setAttribute('aria-current', i === index ? 'true' : 'false');
      item.element?.classList.toggle('is-focused', i === index);
      if (i === index) {
        try {
          item.element?.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }
    });
  }

  /** Speak ONLY the newly focused control. Shared key: latest wins. */
  function announceFocus(text, opts = {}) {
    speech?.say(text, {
      priority: 2,
      key: 'focus',
      cooldownMs: 0,
      ttlMs: 2200,
      ...opts,
    });
  }

  const api = {
    get index() {
      return index;
    },
    get current() {
      return items[index] ?? null;
    },
    get count() {
      return items.length;
    },
    move(delta, opts = {}) {
      if (!items.length) return null;
      const next = index + delta;
      if (next < 0) index = loop ? items.length - 1 : 0;
      else if (next >= items.length) index = loop ? 0 : items.length - 1;
      else index = next;
      apply();
      // A tick under every focus move: sound effects for every action, even the
      // ones that also speak. The spoken line below is the one that matters.
      audio?.play('ui-tick', { group: 'sfx', volume: 0.35 });
      if (announceOnMove && !opts.silent) {
        announceFocus(`${describe(api.current)} ${index + 1} of ${items.length}.`);
      }
      bus.emit('focus:move', { index, label: describe(api.current) });
      return api.current;
    },
    focusAt(i, opts = {}) {
      index = Math.max(0, Math.min(items.length - 1, i));
      apply();
      if (!opts.silent) announceFocus(describe(api.current));
      return api.current;
    },
    activate() {
      const item = api.current;
      if (!item) return false;
      // Activate EXACTLY ONCE. This used to call `item.activate()` and then
      // `item.element.click()`, which fired every button's handler twice: two
      // announcements of the same action ("repeated announcements"), and
      // confirmable actions asked twice. Prefer the item's own handler; fall
      // back to a real click for items that only have an element.
      if (typeof item.activate === 'function') item.activate();
      else item.element?.click?.();
      return true;
    },
    announceCurrent() {
      announceFocus(describe(api.current), { priority: 3, essential: true });
    },
    apply,
    describe,
  };
  apply();
  return api;
}

/** Small helper: build a labelled button that announces itself on focus. */
export function makeButton({ label, hint, onActivate, className = '', disabled = false, announce }) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `ui-button ${className}`.trim();
  el.innerHTML = `<span class="ui-button-label"></span>`;
  el.querySelector('.ui-button-label').textContent = label;
  if (hint) {
    const h = document.createElement('span');
    h.className = 'ui-button-hint';
    h.textContent = hint;
    el.appendChild(h);
  }
  el.disabled = disabled;
  el.setAttribute('data-zone', `btn-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  el.setAttribute('data-zone-role', ZONE_ROLE.MENU);
  // One path for every activation, whether it came from a tap, a click or the
  // focus ring, so the handler runs EXACTLY ONCE per press. Press feedback
  // (sound + spoken label) is wired globally in main.js: a real click is caught
  // there in the capture phase, and a focus-ring activation passes no event, so
  // it announces itself here - exactly once either way.
  const run = (e) => {
    e?.preventDefault?.();
    if (!e) bus.emit('ui:press', { label, hint });
    onActivate?.(e);
  };
  el.addEventListener('click', run);
  return {
    element: el,
    label,
    focused: false,
    announce: announce ?? (() => `${label}. ${hint ?? ''}`.trim()),
    activate: () => run(),
    setLabel(text) {
      label = text;
      el.querySelector('.ui-button-label').textContent = text;
    },
    setDisabled(d) {
      disabled = !!d;
      el.disabled = disabled;
      el.setAttribute('aria-disabled', String(disabled));
    },
  };
}

/**
 * Screen manager. One screen is mounted at a time; the previous screen is
 * remembered so Back always returns somewhere sensible without losing progress.
 */
export function createScreenManager(config) {
  const host = config.host;
  const speech = config.speech;
  const audio = config.audio;
  const stack = [];
  let current = null;
  let zoneMap = null;

  function announceScreen(screen) {
    const title = screen.title ?? 'Screen';
    const summary = screen.summary ? ` ${screen.summary}` : '';
    const count = screen.focusRing?.count;
    // Say how to leave, using the screen's own labels so this can never claim a
    // Back option that is not there. "I do not know how to get back" is the one
    // thing a player must never have to guess.
    const items = screen.focusItems ?? [];
    const backItem = items.find((i) => /^back/i.test(String(i.label ?? '').trim()));
    const howMany = count
      ? ` ${count} options. Swipe up or down to move between them, single tap to activate.${
          backItem ? ` To leave, swipe to ${backItem.label.split('.')[0]}, or press Escape.` : ' Press Escape to leave.'
        }`
      : '';
    // The screen's own description is always spoken, and it is marked essential
    // so a player who has turned Game TalkBack off still learns where they are
    // and how to turn it back on.
    // hardInterrupt: arriving on a screen must always be heard. Without it the
    // announcement queued behind whatever the previous screen was still saying.
    speech?.say(`${title}.${summary}${howMany}`, { priority: 3, essential: true, cooldownMs: 0, interrupt: true, hardInterrupt: true });
  }

  const api = {
    get current() {
      return current;
    },
    get zoneMap() {
      return zoneMap;
    },
    zoneAt(x, y) {
      return zoneMap?.zoneAt(x, y) ?? config.defaultDrivingZone ?? null;
    },

    mount(screen, opts = {}) {
      // NOTE: the queue is deliberately NOT cleared here. A screen speaks as it
      // is BUILT, before it is mounted, so clearing at mount time threw away the
      // new screen's own opening lines. Ending the previous screen's narration is
      // the caller's job and happens in main.js before the screen is built.
      if (current && !opts.replace) {
        current.suspend?.();
        stack.push(current);
      } else if (current) {
        current.destroy?.();
      }
      host.textContent = '';
      current = screen;
      if (screen.element) host.appendChild(screen.element);
      zoneMap = createZoneMap(host, config.defaultZone ?? { id: 'background', role: ZONE_ROLE.READER, immediateTap: false, allowSwipe: false });
      zoneMap.rebuild();
      screen.focusRing?.apply?.();
      if (!opts.silent) announceScreen(screen);
      bus.emit('screen:mounted', { id: screen.id, title: screen.title });
      audio?.play(opts.sound ?? 'ui-open', { group: 'sfx', volume: 0.55 });
      return screen;
    },

    back(opts = {}) {
      const prev = stack.pop();
      if (!prev) {
        speech?.say('There is nothing to go back to.', { priority: 2, essential: true });
        return null;
      }
      speech?.stop?.();
      current?.destroy?.();
      host.textContent = '';
      current = prev;
      if (prev.element) host.appendChild(prev.element);
      prev.resume?.();
      zoneMap = createZoneMap(host, config.defaultZone);
      zoneMap.rebuild();
      prev.focusRing?.apply?.();
      if (!opts.silent) announceScreen(prev);
      audio?.play('ui-back', { group: 'sfx', volume: 0.55 });
      bus.emit('screen:mounted', { id: prev.id, title: prev.title, back: true });
      return prev;
    },

    /** Re-measure zone rectangles after layout changes (resize, text scale). */
    remeasure() {
      zoneMap?.measure();
    },

    /**
     * Destroy the mounted screen and everything on the back stack. Screens can
     * own timers (the tutorial polls for demonstrated gestures), so leaving one
     * alive on the stack would keep running after the player has moved on.
     */
    destroyAll() {
      current?.destroy?.();
      current = null;
      for (const screen of stack) screen.destroy?.();
      stack.length = 0;
      zoneMap = null;
      host.textContent = '';
    },

    clearStack() {
      stack.length = 0;
    },
  };

  window.addEventListener('resize', () => api.remeasure());
  return api;
}

/** A spoken heading plus paragraph, used by every text-heavy screen. */
export function makeReaderBlock(title, paragraphs, { level = 2 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'reader-block';
  wrap.setAttribute('data-zone', 'reader');
  wrap.setAttribute('data-zone-role', ZONE_ROLE.READER);
  const h = document.createElement(`h${level}`);
  h.className = 'reader-title';
  h.textContent = title;
  h.tabIndex = -1;
  wrap.appendChild(h);
  for (const p of paragraphs ?? []) {
    const el = document.createElement('p');
    el.className = 'reader-paragraph';
    el.textContent = p;
    wrap.appendChild(el);
  }
  return { element: wrap, title };
}
