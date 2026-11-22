import test from 'node:test';
import assert from 'node:assert/strict';
import { createEasyWorld, ACCELERATE_HOLD_MS, fairOpen } from '../src/play/easyWorld.js';
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
test('missing a junction stops indefinitely; only manual retry restarts, keeping coins', () => {
  const wallet={coins:9}; const w=createEasyWorld({wallet});
  w.state.remaining=1; w.update(0.1);
  assert.equal(w.state.out,true); assert.equal(w.state.speed,0);
  assert.equal(w.state.menu,true); assert.equal(w.state.paused,true);
  assert.match(words(w),/Choose Try again/); advance(w,60);
  assert.equal(w.state.out,true); assert.equal(w.state.speed,0);
  assert.equal(w.closeMenu(),false); assert.equal(w.state.menu,true);
  assert.equal(w.retry(),true); assert.equal(w.state.out,false);
  assert.equal(w.state.speed,12); assert.equal(wallet.coins,9);
  assert.equal(w.retry(),false,'retry is not available during live driving');
});
test('turn calls once at 500m, complete routine silence until 50m, then turn now', () => {
  const w=createEasyWorld(); w.update(0.1);
  assert.match(words(w),/Turn right in 500 metres/);
  for(const distance of [490,450,400,300,200,100,51]) {
    w.state.remaining=distance; advance(w,0.01); w.update(0.001);
    assert.equal(words(w),'',`silent at ${distance}m`);
  }
  w.state.remaining=50; w.update(0.001); assert.match(words(w),/^Turn right now\./);
  advance(w,1); assert.equal(words(w),'','no repeated urgent chatter');
  w.swipe('right'); w.drain(); w.state.remaining=1; w.update(0.1);
  assert.match(words(w),/Turning right. Next: left in 500 metres/);
  w.state.remaining=50; w.update(0.001); assert.match(words(w),/Turn left now/);
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
  assert.match(words(w), /Goblin ahead/);
  w.tap(); assert.equal(w.state.monster.health, 25); w.tap();
  assert.equal(w.state.monster, null); assert.equal(w.state.kills, 1); assert.ok(w.wallet.coins >= 5);
});
test('left/right monsters auto-aim on a single tap; health and potions are real', () => {
  const w = createEasyWorld({ area: 'forest' });
  w.state.monster = { side: 'left', health: 50 }; w.tap(); assert.equal(w.state.monster.health, 25);
  assert.equal(w.state.aim, 'left');
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
  clock += 700; r.tick();
  assert.equal(events.filter(e => e === 'tripleTap').length, 1);
  assert.ok(!events.includes('doubleTap')); assert.ok(!events.includes('tap'));
  assert.equal(w.state.health, 100); assert.equal(w.state.seated, false); assert.equal(w.inventory.potions, 2);
});
test('a physical double tap still sits after its disambiguation window', () => {
  let clock = 0; const events = [];
  const r = createGestureRecognizer({ now: () => clock, emit: type => events.push(type) });
  for (let i = 0; i < 2; i++) { r.pointerDown(1, 100, 100, PLAY_ZONE); clock += 40; r.pointerUp(1, 100, 100); clock += 100; }
  clock += 700; r.tick();
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
  const b = coerceSave({ easyWorld: { potions: -2, shopOwned: 'yes', questDone: 'yes', palaceQuest: 'yes', palaceHave: -5, palaceDone: 1, starsDone: 'yes' } }).save;
  assert.deepEqual(b.easyWorld, { potions: 0, shopOwned: false, questDone: false, palaceQuest: false, palaceHave: 0, palaceDone: false, starsDone: false });
  assert.equal(coerceSave({}).save.easyWorld.potions, 3);
});

test('monster defeat gives five coins, 25 XP and a real level crossing exactly once', () => {
  const wallet={coins:0,xp:110}; const w=createEasyWorld({area:'forest',wallet});
  w.state.monster={side:'right',health:25}; w.tap();
  assert.equal(wallet.coins,5); assert.equal(wallet.xp,135); assert.equal(wallet.level,2);
  assert.match(words(w),/Level up!/);
  w.tap(); assert.equal(wallet.xp,135); assert.equal(wallet.coins,5,'a dead monster cannot pay twice');
});

test('each third defeated monster drops a potion; attacks and arrival have distinct recorded cues', () => {
  const w=createEasyWorld({area:'forest'});
  for(let i=0;i<3;i++) { w.state.monster={side:'ahead',health:25}; w.tap(); }
  assert.equal(w.inventory.potions,4);
  const defeat=w.drain().filter(e=>Array.isArray(e.sound));
  assert.ok(defeat.every(e=>e.sound.includes('sword-swing') && e.sound.includes('sword-hit') && e.sound.includes('loot-drop')));
  w.state.monster={side:'left',health:50}; advance(w,5.1);
  assert.ok(w.drain().some(e=>e.sound==='monster-hit'));
});

test('default mix, one-time legacy-default migration, and custom-volume preservation', () => {
  const fresh=coerceSave({}).save;
  assert.equal(fresh.settings.musicVolume,0.2); assert.equal(fresh.settings.sfxVolume,0.7);
  const legacy=coerceSave({settings:{musicVolume:0.5,sfxVolume:0.85}}).save;
  assert.equal(legacy.settings.musicVolume,0.2); assert.equal(legacy.settings.sfxVolume,0.7);
  assert.equal(legacy.audioMixVersion,1);
  for(const settings of [{musicVolume:0.35,sfxVolume:0.85},{musicVolume:0.5,sfxVolume:0.6},{musicVolume:0,sfxVolume:0}]) {
    const save=coerceSave({settings}).save;
    assert.equal(save.settings.musicVolume,settings.musicVolume); assert.equal(save.settings.sfxVolume,settings.sfxVolume);
  }
  const chosen=coerceSave({audioMixVersion:1,settings:{musicVolume:0.5,sfxVolume:0.85}}).save;
  assert.equal(chosen.settings.musicVolume,0.5); assert.equal(chosen.settings.sfxVolume,0.85);
  assert.deepEqual(coerceSave(chosen).save,chosen,'migration is idempotent');
});

test('every default ground leg allows a truthful 500m first warning', () => {
  const w=createEasyWorld();
  for(let i=0;i<8;i++) {
    assert.equal(w.segment().metres,500);
    w.swipe(w.segment().direction); w.state.remaining=1; w.update(0.1); w.drain();
    advance(w,1); assert.equal(words(w),'','next-leg initial direction is not repeated');
  }
});

test('forest health-zero recovery stays unchanged, including opening and closing menu', () => {
  const w=createEasyWorld({area:'forest'});
  w.state.health=8; w.state.monster={side:'left',health:50}; w.state.attackClock=4.9;
  w.update(0.2); assert.equal(w.state.out,true);
  w.menu(); assert.equal(w.closeMenu(),true); advance(w,3.2);
  assert.equal(w.state.out,false); assert.equal(w.state.health,100);
});
test('city shops announce their side and distance as you approach', () => {
  const w = createEasyWorld({ area: 'city' }); w.pressStart(); advance(w, 3);
  assert.match(words(w), /Potion shop on your left, 25 metres/);
});
test('shop entry is direction-gated: swipe the side, tap to confirm, tap to buy', () => {
  const w = createEasyWorld({ area: 'city', wallet: { coins: 10 } });
  w.state.distance = 21; w.state.maxDistance = 21; w.state.nextCoinAt = 100;
  w.pressStart(); w.update(0.1); w.pressEnd(100);
  assert.match(words(w), /potion shop is on your left. Swipe left to enter/);
  assert.equal(w.state.pendingShop, 'potion');
  w.swipe('left');
  assert.equal(w.state.confirmShop, 'potion');
  assert.match(words(w), /Enter the potion shop\? Tap to confirm/);
  w.tap();
  assert.equal(w.state.inShop, 'potion');
  assert.match(words(w), /Entering the potion shop/);
  w.tap();
  assert.equal(w.inventory.potions, 4); assert.equal(w.wallet.coins, 7);
  w.swipe('down');
  assert.equal(w.state.inShop, null);
  assert.match(words(w), /Leaving the potion shop/);
});
test('a wrong-side swipe never enters; walking past clears the offer', () => {
  const w = createEasyWorld({ area: 'city' });
  w.state.distance = 21; w.state.maxDistance = 21; w.state.nextCoinAt = 100;
  w.pressStart(); w.update(0.1); w.drain();
  w.swipe('right');
  assert.equal(w.state.confirmShop, null);
  assert.equal(w.state.pendingShop, 'potion', 'the offer stays until you pass or confirm');
  advance(w, 10);
  assert.equal(w.state.pendingShop, null);
  assert.match(words(w), /walked past the potion shop/);
});
test('swipe down walks backward and announces it; forward toggle announces too', () => {
  const w = createEasyWorld({ area: 'forest' });
  w.pressStart(); advance(w, 5); w.pressEnd(5000); w.drain();
  assert.ok(w.state.distance >= 9.9);
  w.swipe('down');
  assert.equal(w.state.backward, true);
  assert.match(words(w), /Walking backward\./);
  w.pressStart(); advance(w, 2);
  assert.ok(w.state.distance < 6.5 && w.state.distance > 5, `walked back to ${w.state.distance}`);
  w.pressEnd(2000); w.swipe('down');
  assert.equal(w.state.backward, false);
  assert.match(words(w), /Walking forward\./);
});
test('backward walking stops at the start of the stretch', () => {
  const w = createEasyWorld({ area: 'forest' });
  w.swipe('down'); w.drain();
  w.pressStart(); advance(w, 1);
  assert.equal(w.state.speed, 0);
  assert.match(words(w), /Start of this stretch/);
});
test('walking back over old ground pays no coins twice', () => {
  const w = createEasyWorld({ area: 'forest' });
  w.pressStart(); advance(w, 6); w.pressEnd(6000); w.drain();
  const coins = w.wallet.coins;
  assert.ok(coins >= 1, 'forward walking pays');
  w.swipe('down'); w.pressStart(); advance(w, 3); w.pressEnd(3000);
  w.swipe('down'); w.pressStart(); advance(w, 3); w.pressEnd(3000);
  assert.equal(w.wallet.coins, coins, 're-walked ground pays nothing');
});
test('city streets announce their names once as you arrive', () => {
  for (const [at, name] of [[23, 'Market Square'], [63, 'Palace Steps'], [133, 'North Gate']]) {
    const w = createEasyWorld({ area: 'city' });
    w.state.distance = at; w.state.maxDistance = at; w.state.nextCoinAt = 10000;
    w.pressStart(); w.update(0.5); w.pressEnd(500);
    assert.match(words(w), new RegExp(name), `arriving near ${at}m announces ${name}`);
    w.pressStart(); advance(w, 2); w.pressEnd(2000);
    assert.doesNotMatch(words(w), new RegExp(name), `${name} is not repeated`);
  }
});
test('the palace herald offers a quest and a second tap accepts it', () => {
  const w = createEasyWorld({ area: 'city' });
  w.state.distance = 64; w.state.maxDistance = 64;
  w.tap();
  assert.equal(w.state.pendingQuest, true);
  assert.match(words(w), /herald offers a quest: drive out three forest creatures/);
  w.tap();
  assert.equal(w.inventory.palaceQuest, true);
  assert.match(words(w), /Quest accepted/);
  w.tap();
  assert.match(words(w), /Palace quest: 0 of three/);
});
test('forest kills advance the palace quest and the third pays twenty coins', () => {
  const inventory = {};
  const city = createEasyWorld({ area: 'city', inventory });
  city.state.distance = 64; city.tap(); city.tap();
  assert.equal(inventory.palaceQuest, true);
  const forest = createEasyWorld({ area: 'forest', inventory, wallet: { coins: 0 } });
  for (let i = 0; i < 3; i++) {
    forest.state.monster = { side: 'ahead', health: 25 };
    forest.tap();
  }
  assert.equal(inventory.palaceHave, 3);
  assert.equal(inventory.palaceDone, true);
  assert.match(words(forest), /Palace quest complete! Twenty bonus coins/);
  assert.equal(forest.wallet.coins, 45, 'three loot drops plus the easy-quest and palace bonuses');
});
test('swipe up at the North Gate walks to the forest; the City Gate returns', () => {
  const city = createEasyWorld({ area: 'city' });
  city.state.distance = 134; city.state.maxDistance = 134;
  city.swipe('up');
  const road = city.drain().find((e) => e.travel);
  assert.equal(road && road.travel, 'forest');
  assert.match(road.text, /North Gate road/);
  const market = createEasyWorld({ area: 'city' });
  market.state.distance = 25; market.swipe('up');
  assert.equal(market.drain().some((e) => e.travel), false, 'no gate at Market Square');
  const forest = createEasyWorld({ area: 'forest' });
  forest.state.distance = 5;
  forest.swipe('up');
  assert.equal(forest.drain().find((e) => e.travel).travel, 'city');
  const deep = createEasyWorld({ area: 'forest' });
  deep.state.distance = 50; deep.state.maxDistance = 50;
  deep.swipe('up');
  assert.equal(deep.drain().some((e) => e.travel), false, 'no gate deep in the forest');
});
test('forest creatures cycle goblin, spider, wolf, imp and never repeat twice', () => {
  const w = createEasyWorld({ area: 'forest' });
  w.state.nextCoinAt = 100000;
  const names = [];
  for (let i = 0; i < 8; i++) {
    w.state.distance = w.state.nextMonsterAt; w.state.maxDistance = w.state.nextMonsterAt;
    w.pressStart(); w.update(0.1); w.pressEnd(100);
    assert.ok(w.state.monster, `spawn ${i + 1} appears`);
    names.push(w.state.monster.name);
    if (i === 0) assert.match(words(w), /Goblin ahead. It rattles a tin shield/);
    w.state.monster.health = 25; w.tap();
    assert.equal(w.state.monster, null, `spawn ${i + 1} can be killed`);
  }
  assert.deepEqual(names.slice(0, 4), ['goblin', 'giant spider', 'grey wolf', 'moss imp']);
  for (let i = 1; i < names.length; i++) assert.notEqual(names[i], names[i - 1], 'no immediate repeats');
});
test('spiders fall in one hit, imps in three, and wolves hit hardest', () => {
  const w = createEasyWorld({ area: 'forest' });
  w.state.monster = { side: 'ahead', health: 25, damage: 6, name: 'giant spider' };
  w.tap(); assert.equal(w.state.monster, null, 'spider dies in one hit');
  w.state.monster = { side: 'ahead', health: 75, damage: 6, name: 'moss imp' };
  w.tap(); w.tap(); assert.equal(w.state.monster.health, 25);
  w.tap(); assert.equal(w.state.monster, null, 'imp dies in three hits');
  w.state.health = 100; w.state.monster = { side: 'ahead', health: 50, damage: 10, name: 'grey wolf' };
  w.state.attackClock = 4.9; w.update(0.2);
  assert.equal(w.state.health, 90, 'wolf deals ten damage');
  assert.match(words(w), /Grey wolf ahead attacks/);
});
test('the Christmas fair opens every December 1st and runs through December', () => {
  assert.equal(fairOpen(new Date(2026, 11, 1)), true);
  assert.equal(fairOpen(new Date(2026, 11, 31)), true);
  assert.equal(fairOpen(new Date(2026, 10, 30)), false);
  assert.equal(fairOpen(new Date(2027, 0, 1)), false);
});
test('Bolt Green opens its gate in December and names the date outside it', () => {
  const w = createEasyWorld({ area: 'city', now: () => new Date(2026, 11, 5) });
  w.state.distance = 99; w.state.maxDistance = 99; w.state.nextCoinAt = 100000;
  w.pressStart(); w.update(0.2); w.pressEnd(200);
  assert.match(words(w), /Bolt Green. The Christmas Bolt fair is open! Swipe up to enter/);
  w.swipe('up');
  assert.equal(w.drain().find((e) => e.travel).travel, 'christmas');
  const nov = createEasyWorld({ area: 'city', now: () => new Date(2026, 10, 20) });
  nov.state.distance = 99; nov.state.maxDistance = 99; nov.state.nextCoinAt = 100000;
  nov.pressStart(); nov.update(0.2); nov.pressEnd(200);
  assert.match(words(nov), /Bolt Green. The Christmas fair opens December 1st/);
  nov.swipe('up');
  assert.equal(nov.drain().some((e) => e.travel), false, 'no entry outside December');
});
test('walking the full fair loop completes the Starlight Quest for fifteen coins', () => {
  const w = createEasyWorld({ area: 'christmas', wallet: { coins: 0 } });
  w.state.nextCoinAt = 100000; w.state.distance = 159.5; w.state.maxDistance = 159.5;
  w.pressStart(); w.update(0.5); w.pressEnd(500);
  assert.equal(w.inventory.starsDone, true);
  assert.equal(w.wallet.coins, 15);
  assert.match(words(w), /Starlight Quest complete! You walked the whole fair/);
});
test('swipe up at the Fair Gate returns to the city', () => {
  const w = createEasyWorld({ area: 'christmas' });
  w.state.distance = 2;
  w.swipe('up');
  assert.equal(w.drain().find((e) => e.travel).travel, 'city');
});
