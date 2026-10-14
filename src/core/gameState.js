/**
 * Top-level game state.
 *
 * One object holds the save file, the accessibility settings, the story state
 * and the transient session data (which screen is showing, what race is loaded).
 * Everything mutable goes through a function here so that persistence, the
 * event bus and the speech system all see the same change at the same time.
 *
 * @module core/gameState
 */

import { bus } from './bus.js';
import {
  coerceSave,
  createSaveStore,
  freshSave,
  saveFromStoryState,
  storyStateFromSave,
} from './save.js';
import { coerceSettings, defaultSettings, setSetting } from '../a11y/settings.js';
import { applyRewards, raceRewards, unlockedLevels } from '../race/levels.js';
import { addGrime, garageCatalogue, purchase } from '../race/garage.js';
import { CAR_IDS, carUnlockLevel, getCar } from '../vehicles/carCatalog.js';
import { createStoryEngine, sanitizeName } from '../story/storyEngine.js';

export const SCREEN = {
  BOOT: 'boot',
  MENU: 'menu',
  STORY: 'story',
  CAR_SELECT: 'carSelect',
  GARAGE: 'garage',
  SETTINGS: 'settings',
  TUTORIAL: 'tutorial',
  RACE: 'race',
  RESULTS: 'results',
  REVIEW: 'review',
};

export function createGameState(config = {}) {
  const store = config.store ?? createSaveStore(config.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null));
  const loaded = store.load();
  let save = loaded.save;
  let settings = coerceSettings(save.settings).settings;

  const session = {
    screen: SCREEN.BOOT,
    previousScreen: null,
    race: null,
    levelId: 1,
    lastResults: null,
    audioUnlocked: false,
    storageWarning: null,
    loadRejected: loaded.rejected,
    storageAvailable: loaded.storageAvailable,
    restored: loaded.restored,
  };

  const story = createStoryEngine({ state: storyStateFromSave(save), emit: (e) => bus.emit(e.type, e) });

  const api = {
    session,
    story,
    get save() {
      return save;
    },
    get settings() {
      return settings;
    },
    get heroName() {
      return save.heroName;
    },
    get level() {
      return save.level;
    },
    get car() {
      return getCar(save.carId);
    },

    /** Change screen, remembering where we came from so Back works. */
    goto(screen, opts = {}) {
      if (!opts.keepHistory) session.previousScreen = session.screen;
      session.screen = screen;
      bus.emit('screen:change', { screen, previous: session.previousScreen });
      return screen;
    },
    back() {
      return api.goto(session.previousScreen ?? SCREEN.MENU, { keepHistory: true });
    },

    /**
     * Apply a settings change. `heroName` lives in both the settings schema and
     * the save profile, so it is kept in sync here rather than in two places.
     */
    setSettingValue(key, value) {
      if (key === 'heroName') {
        const named = api.setHeroName(value);
        if (!named.ok) return { ok: false, reason: named.reason };
      }
      const result = setSetting(settings, key, value);
      if (!result) return { ok: false, reason: 'That setting does not exist.' };
      settings = result.settings;
      if (key === 'heroName') settings = { ...settings, heroName: save.heroName };
      save = { ...save, settings, heroName: settings.heroName || save.heroName };
      bus.emit('settings:change', { key, value: settings[key], changed: result.changed, announcement: result.announcement, settings });
      api.persist();
      return { ok: true, ...result };
    },

    setHeroName(name) {
      const clean = sanitizeName(name);
      if (!clean) return { ok: false, reason: 'That name is empty or uses characters the game cannot read aloud.' };
      save = { ...save, heroName: clean, settings: { ...settings, heroName: clean } };
      settings = save.settings;
      story.setHeroName(clean);
      bus.emit('profile:heroName', { heroName: clean });
      api.persist();
      return { ok: true, heroName: clean };
    },

    selectCar(carId) {
      if (!CAR_IDS.includes(carId)) return { ok: false, reason: 'That car is not in the garage.' };
      if (!save.unlockedCars.includes(carId)) return { ok: false, reason: 'That car is still locked.' };
      save = { ...save, carId };
      bus.emit('car:select', { carId, car: getCar(carId) });
      api.persist();
      return { ok: true, carId };
    },

    /** Sync story state into the save and write it out. */
    syncStory() {
      save = saveFromStoryState(save, story.state);
      api.persist();
      return save;
    },

    /**
     * Record a validated race result: rewards, level-ups, unlocks, best times.
     * The result must come from raceState.js, never from a guess.
     */
    /**
     * Spend coins in the garage. Prices, refusals and the spoken reply all come
     * from the pure garage module; this only persists the outcome.
     */
    garagePurchase(itemId) {
      const outcome = purchase(save, itemId);
      if (outcome.ok) {
        save = { ...outcome.profile };
        api.persist();
      }
      bus.emit('garage:purchase', { itemId, ok: outcome.ok, reason: outcome.reason ?? null, message: outcome.message, save });
      return outcome;
    },

    /** What the garage screen shows: everything for sale, and what is owned. */
    garageView() {
      return garageCatalogue(save);
    },

    /** Add the grime that off-track laps left on the car. Cosmetic, clamped. */
    addGrime(amount) {
      if (!(amount > 0)) return save;
      save = addGrime(save, amount);
      api.persist();
      bus.emit('garage:grime', { grime: save.grime });
      return save;
    },

    recordRaceResult(result) {
      const rewards = raceRewards(result);
      const applied = applyRewards(save, rewards);
      const beforeLevel = save.level;
      save = { ...applied.profile };

      const bestKey = `level_${result.levelId ?? 1}`;
      if (Number.isFinite(result.bestLapTime) && result.bestLapTime > 0) {
        const prev = save.bestTimes[bestKey];
        if (!prev || result.bestLapTime < prev) save.bestTimes[bestKey] = result.bestLapTime;
      }
      save.racesStarted = (save.racesStarted ?? 0) + 1;
      if (result.finished) save.racesFinished = (save.racesFinished ?? 0) + 1;
      // Laps spent on the grass dirty the paint; the garage sells the wash.
      if (result.grime > 0) save = addGrime(save, result.grime);
      save.raceResult = {
        position: result.position,
        laps: result.lapsCompleted,
        timeSeconds: result.totalTime ?? 0,
        levelId: result.levelId ?? 1,
        won: result.position === 1,
      };

      // Unlock cars by level, and tell the player when something new appears.
      const unlocks = [];
      for (const car of CAR_IDS) {
        if (save.unlockedCars.includes(car)) continue;
        const c = getCar(car);
        if (c && carUnlockLevel(c) <= save.level) {
          save.unlockedCars.push(car);
          unlocks.push(c.name);
        }
      }

      session.lastResults = { ...result, rewards, unlocks, leveledUp: applied.leveledUp, newLevel: save.level };
      bus.emit('progress:raceResult', session.lastResults);
      if (applied.leveledUp) bus.emit('progress:levelUp', { from: beforeLevel, to: save.level });
      api.persist();
      return session.lastResults;
    },

    availableLevels() {
      return unlockedLevels(save.level);
    },
    nextLevelId() {
      const list = api.availableLevels();
      return list.length ? list[list.length - 1].id : 1;
    },

    persist() {
      const res = store.persist({ ...save, settings });
      if (!res.ok) {
        session.storageWarning = res.reason;
        bus.emit('save:error', { reason: res.reason });
      } else if (res.reason === 'memory-only' && !session.storageWarning) {
        session.storageWarning =
          "This browser is not letting the game store progress, so your story and level will be kept for this visit only. Refreshing the page will start a new game.";
      }
      return res;
    },

    reset() {
      save = freshSave();
      settings = coerceSettings(defaultSettings()).settings;
      store.clear();
      bus.emit('progress:reset', {});
      return save;
    },
  };

  return api;
}
