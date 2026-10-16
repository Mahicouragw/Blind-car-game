import test from 'node:test';
import assert from 'node:assert/strict';
import { createEasyWorld, ACCELERATE_HOLD_MS } from '../src/play/easyWorld.js';
import { coerceSave } from '../src/core/save.js';
import { createGestureRecognizer } from '../src/input/gestures.js';
import { PLAY_ZONE } from '../src/ui/easyWorldScreen.js';

const advance = (w, seconds) => { for (let i = 0; i < Math.round(seconds * 10); i++) w.update(0.1); };
const words = w => w.drain().map(e => e.text).join(' ');

test('easy ground drives automatically; this is separate from simulation driving', () => {
  const w = createEasyWorld(); advance(w, 2);
  assert.equal(w.state.speed, 12); assert.ok(w.state.distance >= 23);
});
test('a hold must exceed THREE seconds; release keeps automatic driving', () => {
  const w = createEasyWorld(); w.tap(); w.drain();
  w.pressStart(); w.pressEnd(2000); assert.equal(w.state.speed, 0);
  w.pressStart(); w.pressEnd(ACCELERATE_HOLD_MS); assert.equal(w.state.speed, 0);
  w.pressStart(); w.pressEnd(3001); assert.equal(w.state.speed, 20);
  advance(w, 2); assert.equal(w.state.speed, 20); assert.equal(w.state.holding, false);
});
test('the car accelerates while a long hold is still down', () => {
  const w = createEasyWorld(); w.tap(); w.pressStart();
  advance(w, 2.9); assert.equal(w.state.speed, 0);
  advance(w, 0.3); assert.equal(w.state.speed, 20);
  w.pressEnd(3200); advance(w, 1); assert.equal(w.state.speed, 20);
});
test('tap or a short one/two second hold stops and stays stopped', () => {
  for (const duration of [1000, 2000]) {
    const w = createEasyWorld(); w.pressStart(); w.pressEnd(duration); advance(w, 2);
    assert.equal(w.state.speed, 0); assert.equal(w.state.distance, 0);
  }
  const w = createEasyWorld(); w.tap(); advance(w, 10); assert.equal(w.state.distance, 0);
});
test('cancelling a hold never accelerates', () => {
  const w = createEasyWorld(); w.tap(); w.pressStart(); w.pressEnd(4000, true);
  advance(w, 2); assert.equal(w.state.speed, 0);
});
test('a swipe selects a turn; the car turns only at the junction', () => {
  const w = createEasyWorld(); w.swipe('right');
  assert.equal(w.state.leg, 0); assert.equal(w.state.queuedTurn, 'right');
  w.state.remaining = 1; w.update(0.1);
  assert.equal(w.state.leg, 1); assert.equal(w.state.turns, 1);
  assert.equal(w.segment().direction, 'left'); assert.equal(w.state.queuedTurn, null);
  assert.match(words(w), /Turning right/);
});
test('wrong-direction swipe is corrected, never silently accepted', () => {
  const w = createEasyWorld(); w.swipe('left');
  assert.equal(w.state.queuedTurn, null); assert.match(words(w), /Not left. Take right/);
});
test('missing a junction crashes out and restarts, keeping coins', () => {
  const wallet = { coins: 9 }; const w = createEasyWorld({ wallet });
  w.state.remaining = 1; w.update(0.1); assert.equal(w.state.out, true);
  assert.equal(w.state.speed, 0); advance(w, 3.2);
  assert.equal(w.state.out, false); assert.ok(w.state.fuel > 99);
  assert.equal(w.state.speed, 12); assert.equal(wallet.coins, 9);
});
test('metre countdown is current and paced 3-5 seconds, not every frame', () => {
  const w = createEasyWorld(); w.update(0.1);
  assert.match(words(w), /Turn right in 500 metres/);
  advance(w, 2.8); assert.ok(!/Turn right/.test(words(w)));
  advance(w, 0.4); const text = words(w); assert.match(text, /Turn right in 450 metres/);
  assert.doesNotMatch(text, /seconds/);
});
test('fuel really burns with distance; empty tank stops, pauses, and opens menu', () => {
  const w = createEasyWorld(); const initial = w.state.fuel; advance(w, 2);
  assert.ok(w.state.fuel < initial); w.state.fuel = 0.001; w.update(0.1);
  assert.equal(w.state.fuel, 0); assert.equal(w.state.speed, 0);
  assert.equal(w.state.menu, true); assert.equal(w.state.paused, true);
  const text = words(w); assert.match(text, /Petrol is over/); assert.match(text, /Petrol selected/);
});
test('petrol transaction is real and an empty wallet cannot strand a player', () => {
  const w = createEasyWorld({ wallet: { coins: 8 } }); w.state.fuel = 0;
  assert.equal(w.buyPetrol(), true); assert.equal(w.state.fuel, 100); assert.equal(w.wallet.coins, 3);
  w.state.fuel = 0; assert.equal(w.buyPetrol(), true); assert.equal(w.wallet.coins, 3);
  assert.match(words(w), /Free emergency refill/);
  assert.equal(w.buyPetrol(), false); assert.equal(w.wallet.coins, 3);
});
test('coins accrue from travel, never tapping in place; quest pays once', () => {
  const inventory = {}; const w = createEasyWorld({ inventory });
  w.tap(); advance(w, 10); assert.equal(w.wallet.coins, 0);
  w.pressStart(); w.pressEnd(3100); advance(w, 13);
  assert.equal(w.state.collected, 20); // ten pickups + one ten-coin quest bonus
  assert.equal(w.wallet.coins, 20); assert.equal(inventory.questDone, true);
  const next = createEasyWorld({ wallet: w.wallet, inventory });
  next.pressStart(); next.pressEnd(3100); advance(next, 13);
  assert.equal(next.wallet.coins, 30); // no second quest payment
});
test('forest hold walks, release stops, double tap sits; hold stands again', () => {
  const w = createEasyWorld({ area: 'forest' }); advance(w, 1); assert.equal(w.state.distance, 0);
  w.pressStart(); advance(w, 2); assert.ok(Math.abs(w.state.distance - 4) < 0.0001);
  w.pressEnd(2000); advance(w, 1); assert.ok(Math.abs(w.state.distance - 4) < 0.0001);
  w.doubleTap(); assert.equal(w.state.seated, true);
  w.pressStart(); assert.equal(w.state.seated, false); assert.equal(w.state.speed, 2);
});
test('forest monster is announced, stops walking, takes two sword hits, gives coins', () => {
  const w = createEasyWorld({ area: 'forest' }); w.pressStart(); advance(w, 12.2);
  assert.equal(w.state.monster.side, 'ahead'); assert.equal(w.state.speed, 0);
  assert.match(words(w), /Monster ahead/);
  w.tap(); assert.equal(w.state.monster.health, 25); w.tap();
  assert.equal(w.state.monster, null); assert.equal(w.state.kills, 1); assert.ok(w.wallet.coins >= 5);
});
test('left/right monsters require aiming; health and potion counts are real', () => {
  const w = createEasyWorld({ area: 'forest' });
  w.state.monster = { side: 'left', health: 50 }; w.tap(); assert.equal(w.state.monster.health, 50);
  w.swipe('left'); w.tap(); assert.equal(w.state.monster.health, 25);
  advance(w, 5.1); assert.equal(w.state.health, 92); assert.match(words(w), /Health 92/);
  w.heal(); assert.equal(w.state.health, 100); assert.equal(w.inventory.potions, 2);
  w.heal(); assert.equal(w.inventory.potions, 2, 'full health must not waste a potion');
});
test('three physical taps heal WITHOUT the double-tap sit side effect', () => {
  let clock = 0; const w = createEasyWorld({ area: 'forest' }); w.state.health = 50;
  const events = [];
  const r = createGestureRecognizer({ now: () => clock, emit(type, d) {
    events.push(type);
    if (type === 'tap') w.tap(); if (type === 'doubleTap') w.doubleTap(); if (type === 'tripleTap') w.heal();
  } });
  for (let i = 0; i < 3; i++) {
    r.pointerDown(1, 100, 100, PLAY_ZONE); clock += 40; r.pointerUp(1, 100, 100); clock += 100; r.tick();
  }
  clock += 500; r.tick();
  assert.equal(events.filter(e => e === 'tripleTap').length, 1);
  assert.ok(!events.includes('doubleTap')); assert.ok(!events.includes('tap'));
  assert.equal(w.state.health, 100); assert.equal(w.state.seated, false); assert.equal(w.inventory.potions, 2);
});
test('a physical double tap still sits after its disambiguation window', () => {
  let clock = 0; const events = [];
  const r = createGestureRecognizer({ now: () => clock, emit: type => events.push(type) });
  for (let i = 0; i < 2; i++) { r.pointerDown(1, 100, 100, PLAY_ZONE); clock += 40; r.pointerUp(1, 100, 100); clock += 100; }
  clock += 500; r.tick();
  assert.equal(events.filter(e => e === 'doubleTap').length, 1); assert.ok(!events.includes('tap'));
});
test('forest death returns safely without confiscating the wallet', () => {
  const w = createEasyWorld({ area: 'forest', wallet: { coins: 8 } });
  w.state.health = 8; w.state.monster = { side: 'right', health: 50 }; advance(w, 5.2);
  assert.equal(w.state.out, true); advance(w, 3.2);
  assert.equal(w.state.health, 100); assert.equal(w.state.monster, null); assert.equal(w.wallet.coins, 8);
});
test('city purchases deduct coins and shop income comes only while walking', () => {
  const w = createEasyWorld({ area: 'city', wallet: { coins: 40 } });
  assert.ok(w.buyPotion()); assert.equal(w.inventory.potions, 4); assert.equal(w.wallet.coins, 37);
  assert.ok(w.buyShop()); assert.equal(w.wallet.coins, 12); assert.equal(w.inventory.shopOwned, true);
  assert.equal(w.buyShop(), false); advance(w, 40); assert.equal(w.wallet.coins, 12);
  w.state.shopClock = 29.9; w.pressStart(); advance(w, 0.2);
  assert.equal(w.wallet.coins, 13); assert.equal(w.state.monster, null);
});
test('pause/menu stops time, petrol, monsters, coins and movement', () => {
  const w = createEasyWorld(); w.menu(); advance(w, 30);
  assert.equal(w.state.distance, 0); assert.equal(w.state.fuel, 100); assert.equal(w.wallet.coins, 0);
});
test('new inventory survives save/reload and rejects corrupt values', () => {
  const a = coerceSave({ easyWorld: { potions: 6, shopOwned: true, questDone: true } }).save;
  assert.deepEqual(coerceSave(JSON.parse(JSON.stringify(a))).save.easyWorld, a.easyWorld);
  const b = coerceSave({ easyWorld: { potions: -2, shopOwned: 'yes', questDone: 'yes' } }).save;
  assert.deepEqual(b.easyWorld, { potions: 0, shopOwned: false, questDone: false });
  assert.equal(coerceSave({}).save.easyWorld.potions, 3);
});
