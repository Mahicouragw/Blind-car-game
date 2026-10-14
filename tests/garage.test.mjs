/**
 * The garage: coins earned by racing have to be spendable, and every refusal has
 * to be something a player can hear and understand.
 *
 * The economy is pure, so these tests check prices and refusals directly, then
 * check that the save survives a round trip and rejects an edited file. The last
 * group drives the real vehicle physics to prove a bought tyre actually changes
 * how the car grips - a garage that sells an upgrade the physics ignores would
 * be a shop full of nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addGrime,
  carAvailable,
  carPrice,
  dirtLevel,
  garageCatalogue,
  GRIME_NOTICEABLE,
  purchase,
  tyreGrip,
  tyreTier,
  TYRE_TIERS,
  WASH_COST,
} from '../src/race/garage.js';
import { CARS, carUnlockLevel } from '../src/vehicles/carCatalog.js';
import { coerceSave, freshSave } from '../src/core/save.js';
import { cornerSpeed, createVehicleState, fromKph, stepVehicle, toKph } from '../src/vehicles/physics.js';
import { getCar } from '../src/vehicles/carCatalog.js';
import { LEVELS } from '../src/race/levels.js';

/** A believable profile: a starter car, some racing done, some coins banked. */
function profile(over = {}) {
  return { coins: 3000, level: 1, boughtCars: [], unlockedCars: ['kestrel', 'metro-gt'], tyreTier: 0, grime: 0, ...over };
}

// ---------------------------------------------------------------- pricing

test('starter cars are free and the others are priced by unlock level', () => {
  assert.equal(carPrice('kestrel'), 0);
  assert.equal(carPrice('metro-gt'), 0);
  const paid = CARS.filter((c) => carUnlockLevel(c.id) > 1).map((c) => [c.id, carPrice(c.id)]);
  assert.equal(paid.length, 3, 'three cars should be buyable');
  for (const [, price] of paid) assert.ok(price > 0 && Number.isFinite(price), 'price must be a positive number');
  // A car that needs a higher level should never be cheaper than one that does not.
  const sorted = CARS.map((c) => ({ lvl: carUnlockLevel(c.id), price: carPrice(c.id) ?? 0 }));
  for (const a of sorted) {
    for (const b of sorted) {
      if (a.lvl > b.lvl) assert.ok(a.price >= b.price, 'a higher-level car must not cost less');
    }
  }
});

test('an unobtainable car has no price rather than a made-up one', () => {
  assert.equal(carPrice('not-a-real-car'), null);
});

test('the catalogue reports what is owned, affordable and locked', () => {
  const cat = garageCatalogue(profile({ coins: 800 }));
  const volt = cat.cars.find((c) => c.id === 'volt-e');
  const vantage = cat.cars.find((c) => c.id === 'vantage-rs');
  assert.equal(volt.affordable, true, '800 coins covers a 700 coin car');
  assert.equal(vantage.affordable, false);
  assert.equal(volt.purchasable, true);
  assert.equal(cat.cars.find((c) => c.id === 'kestrel').owned, true);
  assert.equal(cat.cars.find((c) => c.id === 'kestrel').purchasable, false, 'an owned car is not for sale');
  assert.equal(cat.wash.purchasable, false, 'a clean car needs no wash');
  assert.equal(garageCatalogue(profile({ grime: 0.5 })).wash.purchasable, true);
});

// ------------------------------------------------------------ car purchase

test('buying a car deducts the coins and makes it selectable immediately', () => {
  const before = profile({ coins: 2000 });
  const { ok, profile: after, message } = purchase(before, 'vantage-rs');
  assert.equal(ok, true);
  assert.equal(after.coins, 2000 - carPrice('vantage-rs'));
  assert.ok(after.boughtCars.includes('vantage-rs'));
  // Car selection checks unlockedCars, so a paid-for car must be in it.
  assert.ok(after.unlockedCars.includes('vantage-rs'), 'a bought car must be selectable at once');
  assert.match(message, /bought/i);
  assert.match(message, new RegExp(String(after.coins)), 'the message states what is left');
});

test('the original profile is not mutated by a purchase', () => {
  const before = profile({ coins: 2000 });
  const snapshot = JSON.stringify(before);
  purchase(before, 'volt-e');
  assert.equal(JSON.stringify(before), snapshot, 'purchase must return a new profile, not edit the old one');
});

test('a car cannot be bought twice, or bought when the coins are short', () => {
  const owned = profile({ coins: 5000, boughtCars: ['volt-e'], unlockedCars: ['kestrel', 'metro-gt', 'volt-e'] });
  const again = purchase(owned, 'volt-e');
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already-owned');
  assert.equal(again.profile.coins, 5000, 'a refused purchase changes nothing');
  assert.match(again.message, /already/i);

  const poor = profile({ coins: 100 });
  const broke = purchase(poor, 'vantage-rs');
  assert.equal(broke.ok, false);
  assert.equal(broke.reason, 'too-expensive');
  assert.equal(broke.profile.coins, 100);
  assert.match(broke.message, /not enough/i);
  assert.match(broke.message, /100/, 'the refusal says how many coins the player actually has');
});

test('an unknown item is refused in words a player can act on', () => {
  const res = purchase(profile(), 'warp-drive');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown-item');
  assert.ok(res.message.length > 10);
});

test('buying a car early works, and the level route is not taken away', () => {
  const poor = profile({ level: 1 });
  assert.equal(carAvailable('vantage-rs', poor), false, 'locked before buying');

  const bought = purchase(poor, 'vantage-rs').profile;
  assert.equal(carAvailable('vantage-rs', bought), true, 'owned after buying');

  // Reaching the level still unlocks it for free, for a player who never bought it.
  assert.equal(carAvailable('vantage-rs', profile({ level: 3 })), true);
  assert.equal(carAvailable('vantage-rs', profile({ level: 2 })), false);
  assert.equal(carAvailable('kestrel', profile({ level: 1 })), true, 'starters are always available');
  assert.equal(carAvailable('nonsense', profile({ level: 9 })), false);
});

// ------------------------------------------------------------------- tyres

test('tyre tiers get progressively more grip, and only upward purchases are allowed', () => {
  assert.ok(TYRE_TIERS[0].grip < TYRE_TIERS[1].grip);
  assert.ok(TYRE_TIERS[1].grip < TYRE_TIERS[2].grip);

  const fitted = purchase(profile({ coins: 2000 }), 'sport');
  assert.equal(fitted.ok, true);
  assert.equal(fitted.profile.tyreTier, 1);
  assert.ok(fitted.profile.coins < 2000);

  const downhill = purchase(profile({ coins: 9000, tyreTier: 2 }), 'sport');
  assert.equal(downhill.ok, false);
  assert.equal(downhill.reason, 'downgrade');
  assert.equal(downhill.profile.tyreTier, 2, 'a downgrade must not be applied');
  assert.match(downhill.message, /downgrade/i);
  // Asking for the set already fitted is a different, equally useful answer.
  const same = purchase(profile({ coins: 9000, tyreTier: 1 }), 'sport');
  assert.equal(same.ok, false);
  assert.equal(same.reason, 'already-owned');
  assert.equal(same.profile.coins, 9000);
});

test('every spoken reply is a finished sentence with no missing values', () => {
  // A message that reads "fitted for 450 coins. undefined." is worse than no
  // message at all. This walks every refusal and success path and checks the text.
  const cases = [
    ['kestrel', profile()],
    ['vantage-rs', profile({ coins: 9000 })],
    ['vantage-rs', profile({ coins: 10 })],
    ['vantage-rs', profile({ coins: 9000, boughtCars: ['vantage-rs'] })],
    ['sport', profile({ coins: 9000 })],
    ['sport', profile({ coins: 10 })],
    ['sport', profile({ coins: 9000, tyreTier: 1 })],
    ['sport', profile({ coins: 9000, tyreTier: 2 })],
    ['slick', profile({ coins: 5000 })],
    ['wash', profile({ coins: 9000, grime: 0.5 })],
    ['wash', profile({ coins: 9000 })],
    ['wash', profile({ coins: 1, grime: 0.5 })],
    ['nonsense', profile()],
  ];
  for (const [item, prof] of cases) {
    const { message } = purchase(prof, item);
    assert.ok(typeof message === 'string' && message.length > 8, item + ': message too short');
    assert.doesNotMatch(message, /undefined|NaN|\[object|null/, item + ': message contains a missing value: "' + message + '"');
    assert.match(message, /[.!]$/, item + ': message should end in punctuation: "' + message + '"');
    assert.match(message, /coins/i, item + ': the player should always learn their balance: "' + message + '"');
  }
});

test('tyre grip reads safely from a missing or damaged profile', () => {
  assert.equal(tyreGrip({ tyreTier: 0 }), 1);
  assert.equal(tyreGrip({ tyreTier: 2 }), TYRE_TIERS[2].grip);
  assert.equal(tyreGrip(undefined), 1, 'no profile means standard tyres, not a crash or a bonus');
  assert.equal(tyreGrip({ tyreTier: 99 }), TYRE_TIERS[TYRE_TIERS.length - 1].grip);
  assert.equal(tyreGrip({ tyreTier: -5 }), 1);
  assert.equal(tyreGrip({ tyreTier: 1.4 }), TYRE_TIERS[1].grip, 'a fractional tier rounds to the fitted set');
  assert.equal(tyreTier(undefined).tier, 0);
});

test('bought tyres really do change how the car grips', () => {
  const car = getCar('vantage-rs');
  const level = LEVELS[0];
  const gripFor = (tier) => (level.gripMultiplier ?? 1) * tyreGrip({ tyreTier: tier });

  // A corner has a maximum speed for the grip available. Standard tyres and
  // slicks must not give the same answer, or the upgrade is decorative.
  const standardCorner = cornerSpeed(car, 60, gripFor(0));
  const slickCorner = cornerSpeed(car, 60, gripFor(2));
  assert.ok(slickCorner > standardCorner, `slicks (${slickCorner.toFixed(1)}) must corner faster than standard (${standardCorner.toFixed(1)})`);

  // And through the real physics step, the same aggressive manoeuvre at the same
  // entry speed should saturate the tyres less when there is more grip to use.
  function cornerRun(tier) {
    const v = createVehicleState({ x: 0, z: 0, heading: 0, speed: fromKph(120) });
    let peakSlip = 0;
    for (let i = 0; i < 150; i += 1) {
      stepVehicle(v, { throttle: 0.6, brake: 0, steer: 1 }, car, 1 / 60, { surface: 'track', gripMultiplier: gripFor(tier) });
      peakSlip = Math.max(peakSlip, v.lateralSlip);
    }
    return { peakSlip, speed: toKph(Math.abs(v.speed)) };
  }

  const standard = cornerRun(0);
  const slicks = cornerRun(2);
  assert.ok(standard.speed > 20, 'the car has to be moving for this to mean anything');
  assert.ok(
    slicks.peakSlip <= standard.peakSlip + 1e-6,
    `slicks should saturate the tyres no more than standard (slicks ${slicks.peakSlip.toFixed(3)} vs standard ${standard.peakSlip.toFixed(3)})`,
  );
  assert.ok(slicks.speed >= standard.speed - 0.5, `slicks should not slow the car (${slicks.speed.toFixed(1)} vs ${standard.speed.toFixed(1)} kph)`);
});

// -------------------------------------------------------------------- wash

test('the wash costs coins, cleans the car, and refuses when there is nothing to do', () => {
  const dirty = profile({ coins: 500, grime: 0.6 });
  const washed = purchase(dirty, 'wash');
  assert.equal(washed.ok, true);
  assert.equal(washed.profile.grime, 0);
  assert.equal(washed.profile.coins, 500 - WASH_COST);

  const clean = purchase(profile({ coins: 500, grime: 0 }), 'wash');
  assert.equal(clean.ok, false);
  assert.equal(clean.reason, 'already-clean');
  assert.equal(clean.profile.coins, 500);

  const noCoins = purchase(profile({ coins: 10, grime: 0.9 }), 'wash');
  assert.equal(noCoins.ok, false);
  assert.equal(noCoins.reason, 'too-expensive');
  assert.equal(noCoins.profile.grime, 0.9, 'a refused wash leaves the car dirty');
});

test('grime accumulates from real laps off the track and is capped', () => {
  let p = { grime: 0 };
  p = addGrime(p, 0.045);
  assert.ok(p.grime > 0);
  p = addGrime(p, 0.045);
  assert.ok(Math.abs(p.grime - 0.09) < 1e-9);
  // A ludicrous amount cannot push it past its bound.
  assert.equal(addGrime(p, 50).grime, 1);
  // Negative amounts are ignored rather than silently cleaning the car.
  assert.equal(addGrime({ grime: 0.5 }, -1).grime, 0.5);
  assert.equal(addGrime(undefined, 0).grime, 0);
});

test('the car only looks dirty once the grime is worth noticing', () => {
  assert.equal(dirtLevel({ grime: 0 }), 0);
  assert.equal(dirtLevel({ grime: GRIME_NOTICEABLE - 0.01 }), 0, 'one excursion must not visibly change the paint');
  assert.ok(dirtLevel({ grime: 0.5 }) > 0);
  assert.equal(dirtLevel({ grime: 1 }), 1);
  assert.equal(dirtLevel({ grime: 5 }), 1, 'capped, never more than fully filthy');
  assert.equal(dirtLevel(undefined), 0);
});

// --------------------------------------------------------------- the save

test('bought cars, tyres and grime survive a save and load', () => {
  const saved = purchase(purchase(purchase(profile({ coins: 4000 }), 'volt-e').profile, 'sport').profile, 'wash').profile;
  assert.ok(saved.grime === 0);

  const round = coerceSave({ ...saved, grime: 0.42 }).save;
  assert.deepEqual(round.boughtCars, saved.boughtCars);
  assert.equal(round.tyreTier, saved.tyreTier);
  assert.ok(Math.abs(round.grime - 0.42) < 1e-9);
  assert.ok(round.unlockedCars.includes('volt-e'), 'a bought car is still available after a reload');
  assert.equal(carAvailable('volt-e', round), true);
});

test('an edited save cannot conjure a car, impossible grip or negative grime', () => {
  const hacked = coerceSave({
    level: 1,
    boughtCars: ['vantage-rs', 'haulmaster', 'tank-of-doom', '', null, 42],
    tyreTier: 99,
    grime: 5.5,
  }).save;
  assert.deepEqual(hacked.boughtCars.filter((id) => !CARS.some((c) => c.id === id)), [], 'no invented cars');
  assert.ok(hacked.boughtCars.length <= CARS.length);
  assert.equal(hacked.tyreTier, TYRE_TIERS.length - 1, 'an out-of-range tyre tier is clamped, not honoured');
  assert.equal(hacked.grime, 1, 'grime is clamped into its range');

  const negative = coerceSave({ grime: -3, tyreTier: -9 }).save;
  assert.equal(negative.grime, 0);
  assert.equal(negative.tyreTier, 0);

  const junk = coerceSave({ tyreTier: 'slicks', grime: 'filthy', boughtCars: 'all' }).save;
  assert.equal(junk.tyreTier, 0);
  assert.equal(junk.grime, 0);
  assert.deepEqual(junk.boughtCars, []);
});

test('a fresh save starts with no purchases, standard tyres and a clean car', () => {
  const s = freshSave();
  assert.deepEqual(s.boughtCars, []);
  assert.equal(s.tyreTier, 0);
  assert.equal(s.grime, 0);
  assert.equal(carAvailable('vantage-rs', s), false, 'a new player cannot drive the fastest car');
  assert.equal(carAvailable('kestrel', s), true);
});

test('level unlocks keep working for a player who never opens the garage', () => {
  // Reaching level 3 the old way must still hand over the car for free.
  const levelled = coerceSave({ xp: 700, unlockedCars: ['kestrel', 'metro-gt', 'vantage-rs'] }).save;
  assert.ok(levelled.level >= 3);
  assert.ok(levelled.unlockedCars.includes('vantage-rs'));
  assert.deepEqual(levelled.boughtCars, [], 'nothing was bought');
});
