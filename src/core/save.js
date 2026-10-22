/**
 * Save games: validation, versioning and storage.
 *
 * Everything read back out of storage is treated as untrusted and passed
 * through `coerceSave()`, because a save file can be edited by hand, corrupted
 * by an old version, or contain a name that ends up in speech and in the DOM.
 * No personal data beyond the hero name is collected, and no network call is
 * ever made.
 *
 * @module core/save
 */

import { DEFAULT_STORY_STATE, sanitizeName } from '../story/storyEngine.js';
import { coerceSettings, defaultSettings } from '../a11y/settings.js';
import { levelForXp, XP_THRESHOLDS } from '../race/levels.js';
import { CAR_IDS as _IDS, carUnlockLevel as _unlockLevel } from '../vehicles/carCatalog.js';
import { TYRE_TIERS } from '../race/garage.js';

/** Unlock level for a car id; unknown cars are treated as unobtainable. */
function carUnlockLevel(id) {
  return _IDS.includes(id) ? _unlockLevel(id) : 99;
}
import { CAR_IDS } from '../vehicles/carCatalog.js';

export const SAVE_KEY = 'vettaru.save.v1';
export const SAVE_VERSION = 1;

const MAX_HERO_NAME = 24;
const MAX_VISITED_NODES = 400;

function clampInt(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function clampNum(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function asStringArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string' && v.length <= 64).slice(0, limit);
}

/** Integers only. Used for chapter numbers, which arrive as numbers, not strings. */
function asIntArray(value, limit, lo, hi) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= lo && n <= hi)
    .slice(0, limit);
}

/**
 * Validate an arbitrary value into a save object.
 * @returns {{save:object, rejected:string[]}}
 */
export function coerceSave(raw) {
  const rejected = [];
  const note = (msg) => rejected.push(msg);
  if (raw === null || typeof raw !== 'object') {
    note('save was not an object; started a new game');
    return { save: freshSave(), rejected };
  }

  const version = clampInt(raw.version, 0, SAVE_VERSION + 5, SAVE_VERSION);
  if (version !== SAVE_VERSION) note(`save version ${version} != ${SAVE_VERSION}; migrated`);

  const heroName = sanitizeName(raw.heroName ?? DEFAULT_STORY_STATE.heroName) || DEFAULT_STORY_STATE.heroName;
  if (heroName.length > MAX_HERO_NAME) note('hero name truncated');

  const xp = clampInt(raw.xp, 0, 10_000_000, 0);
  const coins = clampInt(raw.coins, 0, 10_000_000, 0);
  // Level is DERIVED from xp, never trusted from the file. A hand-edited save
  // claiming level 10 must not unlock cars the player has not earned.
  const level = levelForXp(xp);
  const storedLevel = clampInt(raw.level, 1, XP_THRESHOLDS.length, level);
  if (storedLevel !== level) note(`stored level ${storedLevel} ignored; derived ${level} from xp ${xp}`);

  if (raw.carId && !CAR_IDS.includes(raw.carId)) note('unknown car id rejected');

  // Only cars that exist AND whose unlock level has genuinely been reached are
  // kept, so an edited save cannot grant a locked vehicle.
  const earned = asStringArray(raw.unlockedCars, CAR_IDS.length).filter((id) => CAR_IDS.includes(id) && carUnlockLevel(id) <= level);

  // Cars bought with coins. Validated the same way as unlocked ones: only ids
  // that exist are kept, so a hand-edited save cannot conjure a car that is not
  // in the catalogue. Unlike level unlocks they are NOT filtered by level - the
  // whole point of buying is to get a car sooner than the level would allow.
  const boughtCars = asStringArray(raw.boughtCars, CAR_IDS.length).filter((id) => CAR_IDS.includes(id));
  const owned = [...new Set([...earned, ...boughtCars])];

  const unlockedCars = owned.length ? owned : ['kestrel', 'metro-gt'];
  const carId = CAR_IDS.includes(raw.carId) && unlockedCars.includes(raw.carId) ? raw.carId : unlockedCars[0];

  // Tyre tier: an integer inside the catalogue's range, never a multiplier read
  // straight from the file. A save claiming tier 99 must not turn the car into a
  // machine with impossible grip.
  const tyreTierStored = clampInt(raw.tyreTier, 0, TYRE_TIERS.length - 1, 0);

  // Grime is cosmetic, so it is simply clamped.
  const grime = Number.isFinite(raw.grime) ? Math.max(0, Math.min(1, raw.grime)) : 0;
  const achievements = asStringArray(raw.achievements, 200);
  const chaptersCompleted = [...new Set(asIntArray(raw.chaptersCompleted, 40, 1, 20))].sort((x, y) => x - y);

  const relationships = {};
  if (raw.relationships && typeof raw.relationships === 'object') {
    for (const [k, v] of Object.entries(raw.relationships)) {
      if (typeof k !== 'string' || k.length > 32) continue;
      relationships[k] = clampInt(v, -20, 20, 0);
    }
  }

  const flags = {};
  if (raw.flags && typeof raw.flags === 'object') {
    let count = 0;
    for (const [k, v] of Object.entries(raw.flags)) {
      if (count++ > 200) {
        note('too many story flags; truncated');
        break;
      }
      if (typeof k !== 'string' || k.length > 64) continue;
      // Booleans must stay booleans: story branches test them with `if (flag)`,
      // and turning `true` into 1 would survive but `false` into 0 would too,
      // while any later strict comparison would silently break.
      if (typeof v === 'boolean') flags[k] = v;
      else if (typeof v === 'number') flags[k] = clampNum(v, -1e6, 1e6, 0);
      else if (typeof v === 'string') flags[k] = v.slice(0, 120);
    }
  }

  const salary = raw.salary === null ? null : clampInt(raw.salary, 0, 1_000_000, null);
  const bestTimes = {};
  if (raw.bestTimes && typeof raw.bestTimes === 'object') {
    for (const [k, v] of Object.entries(raw.bestTimes)) {
      if (typeof k !== 'string' || k.length > 24) continue;
      bestTimes[k] = clampNum(v, 0, 86400, Number(v));
    }
  }

  const raceResult =
    raw.raceResult && typeof raw.raceResult === 'object'
      ? {
          position: clampInt(raw.raceResult.position, 1, 20, 1),
          laps: clampInt(raw.raceResult.laps, 0, 50, 0),
          timeSeconds: clampNum(raw.raceResult.timeSeconds, 0, 86400, 0),
          levelId: clampInt(raw.raceResult.levelId, 0, 20, 1),
          won: !!raw.raceResult.won,
        }
      : null;

  // One-time upgrade of previous DEFAULT mix only. Preserve customised levels,
  // and never re-migrate a user's later choice of 50%/85%.
  const mix = { ...(raw.settings ?? {}) };
  if (raw.audioMixVersion !== 1 && mix.musicVolume === 0.5 && mix.sfxVolume === 0.85) {
    mix.musicVolume = 0.2; mix.sfxVolume = 0.7;
  }
  const settings = coerceSettings(mix);
  rejected.push(...settings.rejected);

  const save = {
    version: SAVE_VERSION,
    audioMixVersion: 1,
    savedAt: clampInt(raw.savedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    heroName,
    xp,
    coins,
    easyWorld: {
      potions: clampInt(raw.easyWorld?.potions, 0, 99, 3),
      shopOwned: raw.easyWorld?.shopOwned === true,
      questDone: raw.easyWorld?.questDone === true,
    },
    level,
    carId,
    unlockedCars,
    boughtCars,
    tyreTier: tyreTierStored,
    grime,
    achievements,
    chaptersCompleted,
    currentNode: typeof raw.currentNode === 'string' && raw.currentNode.length <= 64 ? raw.currentNode : null,
    visitedNodes: asStringArray(raw.visitedNodes, MAX_VISITED_NODES),
    relationships,
    flags,
    salary,
    employed: !!raw.employed,
    jobRoute: typeof raw.jobRoute === 'string' && raw.jobRoute.length <= 32 ? raw.jobRoute : null,
    interviewResult:
      raw.interviewResult && typeof raw.interviewResult === 'object'
        ? {
            total: clampInt(raw.interviewResult.total, 0, 100, 0),
            max: clampInt(raw.interviewResult.max, 1, 100, 1),
            ratio: clampNum(raw.interviewResult.ratio, 0, 1, 0),
            band: ['pass', 'mixed', 'fail'].includes(raw.interviewResult.band) ? raw.interviewResult.band : 'fail',
            passed: !!raw.interviewResult.passed,
          }
        : null,
    controlsUnderstood: !!raw.controlsUnderstood,
    tutorialComplete: !!raw.tutorialComplete,
    tutorialSteps: asStringArray(raw.tutorialSteps, 40),
    raceResult,
    bestTimes,
    racesStarted: clampInt(raw.racesStarted, 0, 100000, 0),
    racesFinished: clampInt(raw.racesFinished, 0, 100000, 0),
    settings: settings.settings,
    audioConsent: !!raw.audioConsent,
  };
  return { save, rejected };
}

export function freshSave() {
  return coerceSave({
    version: SAVE_VERSION,
    heroName: DEFAULT_STORY_STATE.heroName,
    xp: 0,
    coins: 0,
    carId: 'kestrel',
    unlockedCars: ['kestrel', 'metro-gt'],
    settings: defaultSettings(),
  }).save;
}

/** Story state view of a save, shaped for createStoryEngine(). */
export function storyStateFromSave(save) {
  return {
    heroName: save.heroName,
    chapter: save.chaptersCompleted.length ? Math.max(...save.chaptersCompleted) + 1 : 1,
    chaptersCompleted: save.chaptersCompleted,
    flags: save.flags,
    interviewResult: save.interviewResult,
    salary: save.salary,
    employed: save.employed,
    jobRoute: save.jobRoute,
    relationships: save.relationships,
    tutorialComplete: save.tutorialComplete,
    controlsUnderstood: save.controlsUnderstood,
    raceResult: save.raceResult,
    visitedNodes: save.visitedNodes,
  };
}

/** Fold story state back into a save object. */
export function saveFromStoryState(save, storyState) {
  return {
    ...save,
    heroName: sanitizeName(storyState.heroName) || save.heroName,
    chaptersCompleted: asIntArray(storyState.chaptersCompleted, 40, 1, 20),
    flags: storyState.flags ?? {},
    relationships: storyState.relationships ?? {},
    interviewResult: storyState.interviewResult ?? null,
    salary: storyState.salary ?? null,
    employed: !!storyState.employed,
    jobRoute: storyState.jobRoute ?? null,
    controlsUnderstood: !!storyState.controlsUnderstood,
    tutorialComplete: !!storyState.tutorialComplete,
    raceResult: storyState.raceResult ?? save.raceResult,
    visitedNodes: asStringArray(storyState.visitedNodes, MAX_VISITED_NODES),
    currentNode: storyState.currentNode ?? save.currentNode,
    savedAt: Date.now(),
  };
}

/**
 * Storage adapter. Injectable so tests can run without localStorage, and so a
 * private-browsing quota failure degrades to memory instead of breaking the game.
 */
export function createSaveStore(storage) {
  let backend = storage ?? null;
  let available = false;
  let memory = null;

  try {
    if (backend) {
      const probe = '__probe__';
      backend.setItem(probe, '1');
      backend.removeItem(probe);
      available = true;
    }
  } catch {
    available = false;
  }

  return {
    get available() {
      return available;
    },
    /** @returns {{save:object, rejected:string[], restored:boolean, storageAvailable:boolean}} */
    load() {
      let raw = null;
      try {
        if (available) {
          const text = backend.getItem(SAVE_KEY);
          raw = text ? JSON.parse(text) : null;
        } else if (memory) raw = memory;
      } catch (err) {
        return {
          save: freshSave(),
          rejected: [`saved game could not be read (${err?.name ?? 'error'}); started a new game`],
          restored: false,
          storageAvailable: available,
        };
      }
      if (!raw) {
        return { save: freshSave(), rejected: [], restored: false, storageAvailable: available };
      }
      const { save, rejected } = coerceSave(raw);
      return { save, rejected, restored: true, storageAvailable: available };
    },
    /** @returns {{ok:boolean, reason?:string}} */
    persist(save) {
      const { save: clean } = coerceSave(save);
      memory = clean;
      if (!available) return { ok: true, reason: 'memory-only' };
      try {
        backend.setItem(SAVE_KEY, JSON.stringify(clean));
        return { ok: true };
      } catch (err) {
        // Never surface internals. Quota or privacy-mode failures are reported
        // in plain language and the game keeps running from memory.
        return { ok: false, reason: `Progress could not be written to this browser's storage (${err?.name ?? 'error'}). The game will continue, but progress may be lost when you close the tab.` };
      }
    },
    clear() {
      memory = null;
      try {
        if (available) backend.removeItem(SAVE_KEY);
      } catch {
        /* ignore */
      }
      return freshSave();
    },
  };
}
