/**
 * The garage: what coins buy.
 *
 * Coins were already earned from races but there was nothing to spend them on, so
 * a win paid out into a counter that only went up. This module is the spending
 * side, kept pure so every price, refusal and message is testable without a
 * browser.
 *
 * Three things are for sale:
 *
 * - **Cars.** Level still unlocks cars as it always did, and that is untouched. A
 *   coin price is a second route to the same car for a player who wants it sooner.
 *   A car is available if EITHER the level was reached OR it was bought, so nobody
 *   loses anything they had already earned.
 * - **Tyres.** A real handling upgrade, applied through the `gripMultiplier` the
 *   physics step already takes.
 * - **A wash.** Driving on grass and gravel makes the car visibly grubby: the
 *   paint dulls and darkens. Washing restores the shine. This is cosmetic only,
 *   and it is cheap.
 *
 * Every purchase returns a sentence to speak, including refusals, because a
 * player who cannot see the screen has to be told what happened and what they
 * have left.
 *
 * @module race/garage
 */

import { CARS, carUnlockLevel } from '../vehicles/carCatalog.js';

/**
 * Price of a car in coins, set from the level it would otherwise need.
 *
 * Priced so that a patient player unlocks by level first - reaching the level is
 * cheaper - while a player who wants the car now can race for it. Roughly: one
 * full race win pays between 200 and 400 coins depending on the level, so the
 * quickest car is a few wins away.
 */
export function carPrice(carId) {
  const level = carUnlockLevel(carId);
  if (!Number.isFinite(level) || level >= 99) return null; // not obtainable
  if (level <= 1) return 0; // starter cars are free
  if (level === 2) return 700;
  if (level === 3) return 1600;
  return 3000;
}

/** Tyre tiers. `grip` multiplies the level's grip in the physics step. */
export const TYRE_TIERS = [
  { tier: 0, id: 'standard', label: 'Standard tyres', grip: 1, cost: 0, describe: 'the tyres the car came with' },
  { tier: 1, id: 'sport', label: 'Sport tyres', grip: 1.05, cost: 450, describe: 'five percent more grip, so the car holds the line a little better' },
  { tier: 2, id: 'slick', label: 'Racing slicks', grip: 1.11, cost: 1100, describe: 'eleven percent more grip, for the fastest lap times' },
];

/** Cost of washing a car, in coins. */
export const WASH_COST = 60;

/** Grime at which the car starts to look neglected. */
export const GRIME_NOTICEABLE = 0.15;

/** The tyre tier record for a tier number, falling back to standard. */
export function tyreTier(tier) {
  const n = Number.isFinite(tier) ? Math.max(0, Math.min(TYRE_TIERS.length - 1, Math.round(tier))) : 0;
  return TYRE_TIERS[n];
}

/** The grip multiplier a profile's tyres give the physics step. */
export function tyreGrip(profile) {
  return tyreTier(profile?.tyreTier).grip;
}

/**
 * Is this car available to the player?
 *
 * Either route counts: the level reached, or the coins spent. Level unlocking is
 * the original behaviour and is not weakened by buying.
 */
export function carAvailable(carId, profile) {
  if (!carId) return false;
  const cars = CARS;
  if (!cars.some((c) => c.id === carId)) return false;
  const bought = Array.isArray(profile?.boughtCars) ? profile.boughtCars : [];
  if (bought.includes(carId)) return true;
  return carUnlockLevel(carId) <= (profile?.level ?? 1);
}

/**
 * Everything for sale, with what it costs and whether it is already owned.
 * Consumed by the garage screen, so the screen decides nothing about pricing.
 */
export function garageCatalogue(profile = {}) {
  const coins = profile.coins ?? 0;
  const cars = CARS.map((car) => {
    const cost = carPrice(car.id);
    const owned = carAvailable(car.id, profile);
    return {
      kind: 'car',
      id: car.id,
      name: car.name,
      description: car.description ?? '',
      cost,
      owned,
      // Null cost means the car cannot be bought at all; the screen shows it as
      // level-locked rather than pretending there is a price.
      purchasable: cost !== null && cost > 0 && !owned,
      affordable: cost !== null && cost > 0 && coins >= cost,
      unlockLevel: carUnlockLevel(car.id),
    };
  });

  const tyres = TYRE_TIERS.filter((t) => t.cost > 0).map((t) => {
    const owned = tyreTier(profile.tyreTier).tier >= t.tier;
    return {
      kind: 'tyres',
      id: t.id,
      tier: t.tier,
      name: t.label,
      description: t.describe,
      cost: t.cost,
      owned,
      purchasable: !owned,
      affordable: !owned && coins >= t.cost,
    };
  });

  const grime = Number.isFinite(profile.grime) ? profile.grime : 0;
  const needsWash = grime >= GRIME_NOTICEABLE;
  const wash = {
    kind: 'wash',
    id: 'wash',
    name: 'Wash and polish',
    description: 'Cleans the car and brings the paint back. Cosmetic only.',
    cost: WASH_COST,
    owned: false,
    purchasable: needsWash,
    affordable: needsWash && coins >= WASH_COST,
  };

  return { coins, cars, tyres, wash, grime };
}

/** Round a sentence off so spoken messages never trail into a comma. */
function coinsLeft(coins) {
  return `${coins} ${coins === 1 ? 'coin' : 'coins'}`;
}

/**
 * Buy something.
 *
 * Returns a new profile rather than mutating, plus a `message` written to be
 * spoken aloud. A refusal is a normal outcome, not an error: it carries a reason
 * and a message, and changes nothing.
 *
 * @param {object} profile
 * @param {string} itemId a car id, a tyre id, or 'wash'
 * @returns {{ok:boolean, profile:object, message:string, reason?:string}}
 */
export function purchase(profile = {}, itemId) {
  const coins = profile.coins ?? 0;
  const catalogue = garageCatalogue(profile);

  const car = catalogue.cars.find((c) => c.id === itemId);
  if (car) {
    if (car.owned) {
      return { ok: false, profile, reason: 'already-owned', message: `${car.name} is already yours. You have ${coinsLeft(coins)}.` };
    }
    if (!car.purchasable) {
      return {
        ok: false,
        profile,
        reason: 'not-purchasable',
        message: `${car.name} cannot be bought. Unlock it by reaching driver level ${car.unlockLevel}.`,
      };
    }
    if (coins < car.cost) {
      return {
        ok: false,
        profile,
        reason: 'too-expensive',
        message: `Not enough coins for ${car.name}. It costs ${car.cost} and you have ${coinsLeft(coins)}.`,
      };
    }
    const next = {
      ...profile,
      coins: coins - car.cost,
      boughtCars: [...new Set([...(profile.boughtCars ?? []), car.id])],
    };
    return {
      ok: true,
      profile: next,
      message: `${car.name} bought for ${car.cost} coins. You have ${coinsLeft(next.coins)} left. Go to car selection to drive it.`,
    };
  }

  const tyre = catalogue.tyres.find((t) => t.id === itemId);
  if (tyre) {
    if (tyre.owned) {
      return { ok: false, profile, reason: 'already-owned', message: `You already have ${tyre.name}. You have ${coinsLeft(coins)}.` };
    }
    const current = tyreTier(profile.tyreTier);
    if (tyre.tier < current.tier) {
      return { ok: false, profile, reason: 'downgrade', message: `${tyre.name} would be a downgrade from ${current.label}. Nothing was bought.` };
    }
    if (coins < tyre.cost) {
      return {
        ok: false,
        profile,
        reason: 'too-expensive',
        message: `Not enough coins for ${tyre.name}. It costs ${tyre.cost} and you have ${coinsLeft(coins)}.`,
      };
    }
    const next = { ...profile, coins: coins - tyre.cost, tyreTier: tyre.tier };
    return {
      ok: true,
      profile: next,
      message: `${tyre.name} fitted for ${tyre.cost} coins. ${tyre.describe}. You have ${coinsLeft(next.coins)} left.`,
    };
  }

  if (itemId === 'wash') {
    const grime = Number.isFinite(profile.grime) ? profile.grime : 0;
    if (grime < GRIME_NOTICEABLE) {
      return { ok: false, profile, reason: 'already-clean', message: `The car is already clean. You have ${coinsLeft(coins)}.` };
    }
    if (coins < WASH_COST) {
      return {
        ok: false,
        profile,
        reason: 'too-expensive',
        message: `Not enough coins for a wash. It costs ${WASH_COST} and you have ${coinsLeft(coins)}.`,
      };
    }
    const next = { ...profile, coins: coins - WASH_COST, grime: 0 };
    return {
      ok: true,
      profile: next,
      message: `Washed and polished for ${WASH_COST} coins. You have ${coinsLeft(next.coins)} left.`,
    };
  }

  return { ok: false, profile, reason: 'unknown-item', message: 'That is not something the garage sells.' };
}

/**
 * Add grime for time spent off the racing line.
 *
 * Grass and gravel are what actually dirty a car, so this comes from real laps
 * rather than from time passing. Capped at 1.
 */
export function addGrime(profile = {}, amount = 0) {
  const grime = Math.min(1, (Number.isFinite(profile.grime) ? profile.grime : 0) + Math.max(0, amount));
  return { ...profile, grime };
}

/**
 * How dirty the car looks, for the mesh: 0 clean, 1 filthy.
 * Thresholded so a single excursion onto the grass does not visibly change it.
 */
export function dirtLevel(profile) {
  const grime = Number.isFinite(profile?.grime) ? profile.grime : 0;
  if (grime < GRIME_NOTICEABLE) return 0;
  return Math.min(1, (grime - GRIME_NOTICEABLE) / (1 - GRIME_NOTICEABLE));
}
