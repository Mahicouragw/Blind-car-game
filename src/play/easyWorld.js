/** Accessible, untimed play areas. No DOM, renderer, network, or sound synthesis.
 * Existing simulation races are intentionally unaffected by these easy modes.
 * Coins share the existing wallet; all inventory is validated by save.js.
 */
import { levelForXp } from '../race/levels.js';

export const ACCELERATE_HOLD_MS = 3000;
export const GROUND_ROUTE = [
  { metres: 500, direction: 'right' }, { metres: 500, direction: 'left' },
  { metres: 500, direction: 'right' }, { metres: 500, direction: 'left' },
];
export const WALK_ROUTE = [
  { metres: 40, direction: 'left' }, { metres: 35, direction: 'right' },
  { metres: 45, direction: 'right' }, { metres: 40, direction: 'left' },
];
/**
 * City shops, fixed to the walking loop. `at` is metres along each loop of
 * the route; the route repeats, so the shops repeat with it. Entry is
 * direction-gated: near a shop you must swipe toward its side, then tap to
 * confirm, so a blind player can never walk into the wrong shop by accident.
 */
export const CITY_SHOPS = [
  { id: 'potion', name: 'potion shop', side: 'left', at: 25 },
  { id: 'coinshop', name: 'city coin shop', side: 'right', at: 65 },
];
/** Shops announce their side and distance within this range, in metres. */
export const SHOP_ANNOUNCE_M = 30;
/** Entry is offered within this distance of a shop, in metres. */
export const SHOP_ENTER_M = 6;
/**
 * Named places on the city walking loop, in route order. `at` is metres along
 * each loop, like the shops. Plazas are announced as you arrive; the palace
 * offers the herald's quest on tap; the North Gate road leaves the city for
 * the forest on swipe up. Together they make one walkable city map.
 */
export const CITY_PLACES = [
  { id: 'harbour', name: 'Harbour Gate', at: 0, kind: 'plaza' },
  { id: 'market', name: 'Market Square', at: 25, kind: 'plaza' },
  { id: 'palace', name: 'Palace Steps', at: 65, kind: 'palace' },
  { id: 'boltgreen', name: 'Bolt Green', at: 100, kind: 'christmas' },
  { id: 'northgate', name: 'North Gate', at: 135, kind: 'forestgate' },
];
/** A place counts as reached within this loop distance, in metres. */
export const PLACE_ENTER_M = 6;
/** The Christmas Bolt fair opens every real-world December 1st and runs through December. */
export function fairOpen(date = new Date()) {
  return date instanceof Date && !Number.isNaN(date.getTime()) && date.getMonth() === 11;
}
/**
 * Forest creatures in encounter order. The roster cycles, so the same
 * creature never appears twice in a row. Health sets the sword hits at 25
 * damage a strike (spiders fall in one, imps in three); damage is dealt to
 * the hero every five seconds until the creature falls.
 */
/**
 * Named places on the Christmas fair loop. The Fair Gate leads back to the
 * city; the Bolt Tree is the fair's landmark; the Gift Stalls name the
 * Starlight Quest; Carol Corner is carols. One hero walks it, on foot.
 */
export const CHRISTMAS_PLACES = [
  { id: 'fairgate', name: 'Fair Gate', at: 0, kind: 'citygate' },
  { id: 'bolttree', name: 'Bolt Tree', at: 40, kind: 'plaza' },
  { id: 'giftstalls', name: 'Gift Stalls', at: 80, kind: 'gifts' },
  { id: 'carols', name: 'Carol Corner', at: 120, kind: 'plaza' },
];
export const FOREST_CREATURES = [
  { id: 'goblin', name: 'goblin', health: 50, damage: 8, note: 'It rattles a tin shield and grins.' },
  { id: 'spider', name: 'giant spider', health: 25, damage: 6, note: 'It drops from the branches on a silk thread.' },
  { id: 'wolf', name: 'grey wolf', health: 50, damage: 10, note: 'It circles once, low and silent.' },
  { id: 'imp', name: 'moss imp', health: 75, damage: 6, note: 'It puffs up like a toad to look bigger.' },
];
const n = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function createEasyWorld({ area = 'ground', wallet = {}, inventory = {}, route, now } = {}) {
  const nowFn = typeof now === 'function' ? now : () => new Date();
  const fairIsOpen = () => {
    try { return fairOpen(nowFn()); } catch { return false; }
  };
  if (!['ground', 'forest', 'city', 'christmas'].includes(area)) throw new Error('Unknown play area');
  const driving = area === 'ground';
  const path = route ?? (driving ? GROUND_ROUTE : WALK_ROUTE);
  if (!path.length || path.some(p => !Number.isFinite(p.metres) || p.metres <= 0 || !['left', 'right'].includes(p.direction))) {
    throw new Error('Invalid route');
  }
  inventory.potions = clamp(Math.floor(n(inventory.potions, 3)), 0, 99);
  inventory.shopOwned = inventory.shopOwned === true;
  inventory.questDone = inventory.questDone === true;
  inventory.palaceQuest = inventory.palaceQuest === true;
  inventory.palaceHave = clamp(Math.floor(n(inventory.palaceHave, 0)), 0, 99);
  inventory.palaceDone = inventory.palaceDone === true;
  inventory.starsDone = inventory.starsDone === true;
  wallet.coins = clamp(Math.floor(n(wallet.coins)), 0, 10000000);
  wallet.xp = clamp(Math.floor(n(wallet.xp)), 0, 10000000);
  wallet.level = levelForXp(wallet.xp);
  const state = {
    area, paused: false, menu: false, elapsed: 0, leg: 0, remaining: path[0].metres,
    distance: 0, speed: driving ? 12 : 0, cruiseSpeed: 12, holding: false, holdElapsed: 0,
    fuel: 100, health: 100, seated: false, monster: null, aim: 'ahead',
    backward: false, maxDistance: 0, backwardBlocked: false,
    pendingShop: null, confirmShop: null, inShop: null, lastShopGuideAt: -Infinity,
    pendingQuest: false, lastPlaceKey: null, starsAnnounced: false,
    queuedTurn: null, turns: 0, collected: 0, kills: 0, out: false, restartIn: 0,
    nextCoinAt: driving ? 25 : 10, nextMonsterAt: 24, attackClock: 0, shopClock: 0,
    lastGuideAt: -Infinity, lastNumber: null, lowFuelSaid: false, earlySaid: false, nowSaid: false,
  };
  let events = [];
  function emit(text, sound, priority = 3) { events.push({ text, sound, priority }); }
  function gain(amount) {
    wallet.coins = Math.min(10000000, wallet.coins + amount);
    state.collected += amount;
  }
  function segment() { return path[state.leg % path.length]; }
  const loopLength = path.reduce((sum, p) => sum + p.metres, 0);
  const shops = area === 'city' ? CITY_SHOPS.filter((s) => s.at < loopLength) : [];
  const places = (area === 'city' ? CITY_PLACES : area === 'christmas' ? CHRISTMAS_PLACES : []).filter((p) => p.at < loopLength);
  function shopById(id) { return shops.find((s) => s.id === id) ?? null; }
  function placeAhead(place) {
    const pos = ((state.distance % loopLength) + loopLength) % loopLength;
    return (place.at - pos + loopLength) % loopLength;
  }
  function placeNear() {
    const pos = ((state.distance % loopLength) + loopLength) % loopLength;
    let best = null, bestDist = PLACE_ENTER_M;
    for (const p of places) {
      const d = Math.min((p.at - pos + loopLength) % loopLength, (pos - p.at + loopLength) % loopLength);
      if (d <= bestDist) { best = p; bestDist = d; }
    }
    return best;
  }
  function shopAhead(shop) {
    const pos = state.distance % loopLength;
    return (shop.at - pos + loopLength) % loopLength;
  }
  function metres() {
    const d = state.remaining;
    const step = d > 150 ? 50 : d > 60 ? 25 : d > 25 ? 10 : 5;
    return Math.max(5, Math.round(d / step) * step);
  }
  function describe() {
    if (state.out) return driving ? 'The car is stopped after a crash. Choose Try again when you are ready. Your coins are safe.' : 'You are resting safely at the forest entrance.';
    if (state.monster) {
      const foe = state.monster.name ? cap(state.monster.name) : 'Monster';
      return `${foe} ${state.monster.side}. ${foe} health ${state.monster.health}. Your health ${state.health}. Single tap to strike it. Triple tap to heal.`;
    }
    if (driving) return `${state.speed > 0 ? 'Driving' : 'Stopped'}. Turn ${segment().direction} in ${metres()} metres. Petrol ${Math.ceil(state.fuel)} percent. ${wallet.coins} coins.`;
    if (state.inShop) {
      const shop = shopById(state.inShop);
      return `Inside the ${shop ? shop.name : 'shop'}. Tap to buy, swipe down to leave. ${wallet.coins} coins.`;
    }
    const text = `${area === 'forest' ? 'Forest' : area === 'christmas' ? 'Christmas Fair' : 'City'}. ${state.seated ? 'Seated' : state.speed > 0 ? (state.backward ? 'Walking backward' : 'Walking') : 'Standing'}. Path turns ${segment().direction} in ${metres()} metres. Health ${state.health}. ${wallet.coins} coins.`;
    const confirm = shopById(state.confirmShop);
    if (confirm) return `${text} Enter the ${confirm.name}? Tap to confirm.`;
    const pending = shopById(state.pendingShop);
    if (pending) return `${text} The ${pending.name} is on your ${pending.side}. Swipe ${pending.side} to enter.`;
    if (area === 'city') {
      const near = placeNear();
      if (near && near.kind === 'palace' && !state.pendingShop) {
        if (inventory.palaceDone) return `${text} Palace Steps. The herald waves. Palace quest complete.`;
        if (inventory.palaceQuest) return `${text} Palace Steps. Monsters driven out: ${inventory.palaceHave} of 3.`;
        return `${text} Palace Steps. Tap to hear the herald's quest.`;
      }
      if (near && near.kind === 'forestgate') return `${text} North Gate. Swipe up to walk to the forest.`;
      if (near && near.kind === 'christmas') {
        return fairIsOpen()
          ? `${text} Bolt Green. The Christmas Bolt fair is open! Swipe up to enter.`
          : `${text} Bolt Green. The Christmas fair opens December 1st.`;
      }
    }
    if (area === 'christmas') {
      const near = placeNear();
      let suffix = '';
      if (near && near.kind === 'citygate') suffix += ' Fair Gate. Swipe up to return to the city.';
      suffix += inventory.starsDone
        ? ' Starlight quest complete.'
        : ` Starlight walk: ${Math.min(loopLength, Math.floor(state.maxDistance))} of ${loopLength} metres.`;
      return text + suffix;
    }
    if (area === 'forest' && !state.monster && state.speed === 0 && state.distance <= PLACE_ENTER_M) {
      return `${text} City Gate. Swipe up to return to the city.`;
    }
    return text;
  }
  function reset() {
    Object.assign(state, {
      remaining: path[0].metres, leg: 0, queuedTurn: null, speed: driving ? 12 : 0,
      cruiseSpeed: 12, holding: false, fuel: 100, health: 100, seated: false,
      monster: null, aim: 'ahead', out: false, restartIn: 0, lastGuideAt: -Infinity,
      backward: false, maxDistance: 0, backwardBlocked: false,
      pendingShop: null, confirmShop: null, inShop: null, lastShopGuideAt: -Infinity,
      pendingQuest: false, lastPlaceKey: null, starsAnnounced: false,
      lastNumber: null, lowFuelSaid: false, earlySaid: true, nowSaid: false, distance: 0, nextCoinAt: driving ? 25 : 10,
      nextMonsterAt: 24, attackClock: 0,
    });
    state.lastGuideAt = state.elapsed; state.lastNumber = metres();
    emit(driving ? `New start. The car is driving automatically. Turn ${segment().direction} in ${metres()} metres.` : area === 'city' ? 'You are safe at the Harbour Gate. Health 100. Hold to walk.' : area === 'christmas' ? 'You are safe at the Fair Gate. Starlight Quest: walk the full fair loop for fifteen bonus coins. Hold to walk.' : 'You are safe at the forest entrance. Health 100. Hold to walk. Swipe up to return to the city.', 'ui-confirm', 4);
  }
  function crash() {
    if (state.out) return;
    state.out = true; state.restartIn = 0; state.speed = 0; state.holding = false;
    api.menu();
    emit('You missed the turn and hit the barrier. The car is stopped. Choose Try again when you are ready. Your coins are safe.', 'barrier-heavy', 4);
  }
  function guide() {
    if (driving) {
      // Two calls per junction, measured from the actual distance, never time.
      // Short legs announce their honest starting distance instead of a false 500m.
      if (state.remaining <= 50 && !state.nowSaid) {
        state.earlySaid = true; state.nowSaid = true;
        emit(`Turn ${segment().direction} now.`, null, 4);
      } else if (state.remaining <= 500 && !state.earlySaid) {
        state.earlySaid = true;
        emit(`Turn ${segment().direction} in ${metres()} metres.`, null, 3);
      }
      return;
    }
    if (state.backward) return; // footsteps are the feedback while reversing
    const value = metres();
    const since = state.elapsed - state.lastGuideAt;
    if ((value !== state.lastNumber && since >= 3) || since >= 5) {
      state.lastGuideAt = state.elapsed; state.lastNumber = value;
      emit(`${driving ? 'Turn' : 'Path turns'} ${segment().direction} in ${value} metres.${state.queuedTurn ? ' Turn selected.' : ' Swipe ' + segment().direction + ' to take it.'}`, null, 3);
    }
  }
  function shopPrompt(shop) {
    if (!shop) return describe();
    if (shop.id === 'coinshop') {
      if (inventory.shopOwned) return 'Your city coin shop. It earns one coin for every thirty seconds you walk in the city. Swipe down to leave.';
      return `City coin shop. It costs 25 coins and earns one coin for every thirty seconds you walk in the city. You have ${wallet.coins} coins. Tap to buy it. Swipe down to leave.`;
    }
    return `Potion shop. Healing potions cost three coins. You have ${wallet.coins} coins and ${inventory.potions} potions. Tap to buy one. Swipe down to leave.`;
  }
  function enterShop(id) {
    const shop = shopById(id);
    if (!shop) return;
    state.inShop = id; state.confirmShop = null; state.pendingShop = null;
    state.speed = 0; state.holding = false;
    emit(`Entering the ${shop.name}. ${shopPrompt(shop)}`, 'door-open', 4);
  }
  function leaveShop() {
    const shop = shopById(state.inShop);
    state.inShop = null;
    emit(shop ? `Leaving the ${shop.name}. Standing.` : 'Standing.', 'door-close', 3);
  }
  function shopGuide() {
    if (driving || shops.length === 0 || state.inShop) return;
    // Passed it: a pending offer with the shop far ahead again means we walked by.
    const offered = shopById(state.confirmShop ?? state.pendingShop);
    if (offered && shopAhead(offered) > 15) {
      state.pendingShop = null; state.confirmShop = null;
      emit(`You walked past the ${offered.name}.`, null, 1);
      return;
    }
    let nearest = null, nearDist = Infinity;
    for (const shop of shops) {
      const ahead = shopAhead(shop);
      if (ahead < nearDist) { nearest = shop; nearDist = ahead; }
    }
    if (!nearest || nearDist > SHOP_ANNOUNCE_M) return;
    if (nearDist <= SHOP_ENTER_M) {
      if (state.pendingShop !== nearest.id) {
        state.pendingShop = nearest.id;
        emit(`The ${nearest.name} is on your ${nearest.side}. Swipe ${nearest.side} to enter.`, 'ui-select', 3);
      }
      return;
    }
    state.pendingShop = null;
    if (state.elapsed - state.lastShopGuideAt >= 4) {
      state.lastShopGuideAt = state.elapsed;
      emit(`${cap(nearest.name)} on your ${nearest.side}, ${Math.max(5, Math.round(nearDist / 5) * 5)} metres.`, null, 2);
    }
  }
  function placeGuide() {
    if (driving || (area !== 'city' && area !== 'christmas') || places.length === 0 || state.inShop) return;
    if (state.speed <= 0 || state.backward) return; // standing offers come from describe(); reversing stays quiet
    const lap = Math.floor(state.distance / loopLength);
    for (const place of places) {
      if (placeAhead(place) <= 3 && state.lastPlaceKey !== `${lap}:${place.id}`) {
        state.lastPlaceKey = `${lap}:${place.id}`;
        const extra = place.kind === 'palace' ? ' Tap to hear the herald.'
          : place.kind === 'forestgate' ? ' Swipe up to walk to the forest.'
          : place.kind === 'christmas'
            ? (fairIsOpen() ? ' The Christmas Bolt fair is open! Swipe up to enter.' : ' The Christmas fair opens December 1st.')
            : place.kind === 'citygate' ? ' Swipe up to return to the city.'
            : place.kind === 'gifts' && !inventory.starsDone ? ' The Starlight Quest: walk the full loop.'
            : '';
        emit(`${place.name}.${extra}`, place.kind === 'plaza' ? null : 'ui-select', 3);
        return;
      }
    }
  }
  function quest() {
    // One simple, optional task. No time limit and no progress is required to play.
    if (!inventory.questDone && state.collected >= 10) {
      inventory.questDone = true; gain(10);
      emit(driving ? '' : 'Easy quest complete: collect ten coins. Ten bonus coins added.', 'ui-confirm', 3);
    }
  }
  const api = {
    state, wallet, inventory, segment, describe,
    drain() { const result = events; events = []; return result; },
    pause() { state.paused = true; state.holding = false; if (!driving) state.speed = 0; },
    resume() { state.paused = false; },
    menu() { api.pause(); state.menu = true; },
    retry() {
      if (!driving || !state.out) return false;
      reset(); state.menu = false; api.resume(); return true;
    },
    closeMenu() {
      if (driving && state.out) { emit('The car is stopped. Choose Try again when you are ready.', null, 4); return false; }
      state.menu = false; api.resume();
      state.lastGuideAt = state.elapsed; state.lastNumber = metres();
      if (driving && state.remaining <= 500) { state.earlySaid = true; if (state.remaining <= 50) state.nowSaid = true; }
      emit(driving && state.remaining <= 50 ? `Turn ${segment().direction} now.` : describe());
      return true;
    },
    pressStart() {
      if (state.paused || state.out) return;
      if (!driving && state.inShop) {
        const shop = shopById(state.inShop);
        state.inShop = null;
        emit(shop ? `Leaving the ${shop.name}.` : 'Leaving.', 'door-close', 3);
      }
      state.holding = true; state.holdElapsed = 0;
      if (!driving && !state.monster) { state.seated = false; state.speed = 2; }
    },
    pressEnd(durationMs = 0, cancelled = false) {
      state.holding = false;
      if (cancelled || state.paused || state.out) { if (!driving) state.speed = 0; return; }
      if (driving) {
        if (durationMs > ACCELERATE_HOLD_MS && state.fuel > 0) {
          state.cruiseSpeed = 20; state.speed = 20;
          emit('Accelerating. Cruise is on. The car keeps driving after you release.', 'gear-change');
        } else if (durationMs >= 320) {
          state.speed = 0; emit('Stopped. Hold more than three seconds and release to drive again.', 'brake');
        }
      } else { state.speed = 0; emit('Standing.'); }
    },
    tap() {
      if (state.paused || state.out) return;
      if (driving) { state.speed = 0; emit('Stopped.', 'brake', 4); return; }
      if (state.confirmShop) { enterShop(state.confirmShop); return; }
      if (state.inShop) {
        if (state.inShop === 'coinshop') api.buyShop();
        else api.buyPotion();
        return;
      }
      if (area === 'city') {
        const near = placeNear();
        if (near && near.kind === 'palace') {
          if (inventory.palaceDone) { emit('The palace herald bows. The roads are safe thanks to you.'); return; }
          if (!inventory.palaceQuest) {
            if (!state.pendingQuest) {
              state.pendingQuest = true;
              emit('The palace herald offers a quest: drive out three forest creatures with your sword. Tap again to accept.', 'ui-select', 4);
            } else {
              state.pendingQuest = false; inventory.palaceQuest = true; inventory.palaceHave = 0;
              emit('Quest accepted: drive out three forest creatures. Take the North Gate road to the forest.', 'ui-confirm', 4);
            }
            return;
          }
          emit(`Palace quest: ${inventory.palaceHave} of three forest creatures driven out.`, null, 3); return;
        }
        emit(describe()); return;
      }
      if (area !== 'forest' || !state.monster) { emit(describe()); return; }
      // Easy combat: one tap always attacks the announced nearby monster.
      // Directional swipes are optional aiming feedback, not an invisible gate.
      state.aim = state.monster.side;
      state.monster.health = Math.max(0, state.monster.health - 25);
      if (state.monster.health === 0) {
        const foe = state.monster.name ? cap(state.monster.name) : 'Monster';
        state.monster = null; state.kills++; gain(5); state.attackClock = 0;
        state.nextMonsterAt = state.distance + 35;
        const before = levelForXp(wallet.xp);
        wallet.xp = Math.min(10000000, wallet.xp + 25);
        wallet.level = levelForXp(wallet.xp);
        const potion = state.kills % 3 === 0 && inventory.potions < 99;
        if (potion) inventory.potions++;
        let palaceLine = '';
        let fanfare = null;
        if (inventory.palaceQuest && !inventory.palaceDone) {
          inventory.palaceHave = Math.min(3, inventory.palaceHave + 1);
          if (inventory.palaceHave >= 3) {
            inventory.palaceDone = true; gain(20); fanfare = 'mission_completed';
            palaceLine = ' Palace quest complete! Twenty bonus coins. The herald will want to thank you.';
          } else palaceLine = ` Palace quest: ${inventory.palaceHave} of three.`;
        }
        emit(`${foe} defeated. Loot: five coins and 25 experience.${potion ? ' One healing potion dropped.' : ''}${palaceLine} ${wallet.xp} experience total. ${wallet.level > before ? 'Level up! ' : ''}Level ${wallet.level}. Your health ${state.health}. Hold to keep walking.`, fanfare ? ['sword-swing', 'sword-hit', 'loot-drop', fanfare] : ['sword-swing', 'sword-hit', 'loot-drop'], 4); quest();
      } else {
        const foe = state.monster.name ? cap(state.monster.name) : 'Monster';
        emit(`Sword strike. ${foe} health ${state.monster.health}. Your health ${state.health}.`, ['sword-swing', 'sword-hit']);
      }
    },
    doubleTap() {
      if (state.paused || state.out) return;
      if (driving) { api.tap(); return; }
      if (state.inShop) { leaveShop(); return; }
      state.speed = 0; state.holding = false; state.seated = !state.seated;
      emit(state.seated ? 'Seated. Hold to stand and walk.' : 'Standing. Hold to walk.', 'ui-select');
    },
    heal() {
      if (state.paused || state.out || area !== 'forest') return;
      if (state.health === 100) { emit('Health is already full. No potion used.'); return; }
      if (inventory.potions < 1) { emit('No healing potions. Visit the city shop to buy one for three coins.'); return; }
      inventory.potions--; state.health = Math.min(100, state.health + 50);
      emit(`Healed. Health ${state.health}. ${inventory.potions} healing potions left.`, 'ui-confirm', 4);
    },
    swipe(direction) {
      if (state.paused || state.out) return;
      if (state.monster) {
        state.aim = direction === 'up' ? 'ahead' : direction;
        const foe = state.monster.name ? cap(state.monster.name) : 'Monster';
        emit(`Aiming ${state.aim}. ${foe} ${state.monster.side}. Single tap to strike.`); return;
      }
      if (!driving && direction === 'down') {
        if (state.inShop) { leaveShop(); return; }
        if (state.confirmShop) {
          const shop = shopById(state.confirmShop);
          state.confirmShop = null;
          emit(shop ? `Staying outside the ${shop.name}.` : 'Staying on the path.', null, 2);
          return;
        }
        state.backward = !state.backward;
        state.backwardBlocked = false;
        emit(state.backward ? 'Walking backward.' : 'Walking forward.', 'ui-select', 3);
        return;
      }
      if (!driving && state.inShop && (direction === 'left' || direction === 'right')) {
        emit(shopPrompt(shopById(state.inShop)), null, 3); return;
      }
      if (!driving && direction === 'up' && !state.monster && !state.inShop) {
        if (area === 'city') {
          const gate = placeNear();
          if (gate && gate.kind === 'forestgate') {
            state.speed = 0; state.holding = false;
            events.push({ text: 'Walking the North Gate road to the forest.', sound: 'path-turn', priority: 4, travel: 'forest' });
            return;
          }
          if (gate && gate.kind === 'christmas') {
            if (!fairIsOpen()) { emit('The Christmas fair opens December 1st.', null, 3); return; }
            state.speed = 0; state.holding = false;
            events.push({ text: 'Entering the Christmas Bolt fair.', sound: 'path-turn', priority: 4, travel: 'christmas' });
            return;
          }
        } else if (area === 'christmas' && state.speed === 0 && placeNear()?.kind === 'citygate') {
          events.push({ text: 'Walking back through the Fair Gate.', sound: 'path-turn', priority: 4, travel: 'city' });
          return;
        } else if (area === 'forest' && state.speed === 0 && state.distance <= PLACE_ENTER_M) {
          events.push({ text: 'Walking back through the City Gate.', sound: 'path-turn', priority: 4, travel: 'city' });
          return;
        }
      }
      if (direction !== 'left' && direction !== 'right') { emit(describe()); return; }
      if (!driving && (state.pendingShop || state.confirmShop)) {
        const shop = shopById(state.confirmShop ?? state.pendingShop);
        if (shop && direction === shop.side) {
          if (!state.confirmShop) {
            state.confirmShop = shop.id;
            emit(`Enter the ${shop.name}? Tap to confirm.`, 'ui-select', 4);
          } else emit(`Enter the ${shop.name}? Tap to confirm.`, null, 3);
          return;
        }
        // Cancelling is explicit; anything else is turn business, not a wrong door.
        if (shop && state.confirmShop) {
          state.confirmShop = null;
          emit(`Staying outside the ${shop.name}.`, null, 2);
          return;
        }
      }
      if (direction !== segment().direction) {
        emit(`Not ${direction}. Take ${segment().direction} in ${metres()} metres.`, 'ui-error'); return;
      }
      state.queuedTurn = direction;
      emit(`${direction === 'left' ? 'Left' : 'Right'} selected. ${driving ? 'The car will turn automatically' : 'You will follow the path'} at the junction in ${metres()} metres.`, 'ui-select');
    },
    buyPetrol() {
      if (!driving) return false;
      if (state.fuel >= 99.9) { emit('The tank is full.'); return false; }
      // Free emergency refill prevents a blind player getting stranded. Normal
      // refills cost five; the price and assistance are always spoken honestly.
      const cost = wallet.coins >= 5 ? 5 : 0;
      wallet.coins -= cost; state.fuel = 100; state.lowFuelSaid = false;
      emit(`Petrol filled. ${cost ? 'Five coins spent.' : 'Free emergency refill.'} ${wallet.coins} coins left. Return to the ground, then hold more than three seconds to drive.`, 'ui-confirm', 4);
      return true;
    },
    buyPotion() {
      if (wallet.coins < 3) { emit('A healing potion costs three coins. Walk to collect more.'); return false; }
      if (inventory.potions >= 99) { emit('Your potion bag is full.'); return false; }
      wallet.coins -= 3; inventory.potions++;
      emit(`Healing potion bought. ${inventory.potions} potions. ${wallet.coins} coins left.`, 'ui-confirm'); return true;
    },
    buyShop() {
      if (inventory.shopOwned) { emit('You already own the city coin shop. It earns one coin for every thirty seconds you walk in the city.'); return false; }
      if (wallet.coins < 25) { emit(`The city coin shop costs 25 coins. You have ${wallet.coins}. Walk to collect more.`); return false; }
      wallet.coins -= 25; inventory.shopOwned = true;
      emit('City coin shop purchased. It earns one coin every thirty seconds you walk in the city.', 'ui-confirm'); return true;
    },
    update(seconds) {
      if (state.paused || state.menu) return;
      const dt = clamp(n(seconds), 0, 0.25); // no background-time catch-up
      state.elapsed += dt;
      if (state.out && driving) return;
      if (state.out) { state.restartIn -= dt; if (state.restartIn <= 0) reset(); return; }
      if (state.monster) {
        state.speed = 0; state.attackClock += dt;
        if (state.attackClock >= 5) {
          state.attackClock = 0; state.health = Math.max(0, state.health - (state.monster.damage ?? 8));
          if (state.health === 0) {
            state.out = true; state.restartIn = 3;
            emit('Health zero. Returning safely to the forest entrance. Your coins are safe.', 'monster-hit', 4);
          } else {
            const foe = state.monster.name ? cap(state.monster.name) : 'Monster';
            emit(`${foe} ${state.monster.side} attacks. Health ${state.health}. Single tap to strike. Triple tap to heal.`, 'monster-hit', 4);
          }
        }
        return;
      }
      if (driving && state.holding && state.fuel > 0) {
        state.holdElapsed += dt;
        if (state.holdElapsed > ACCELERATE_HOLD_MS / 1000 && state.speed < 20) {
          state.cruiseSpeed = 20; state.speed = 20;
          emit('Accelerating. Release to keep driving automatically.', 'gear-change');
        }
      }
      if (!driving && state.speed <= 0 && !state.monster && state.pendingShop && !state.inShop && state.elapsed - state.lastShopGuideAt >= 6) {
        // Standing at the door: repeat the offer, but never nag a walker.
        const door = shopById(state.pendingShop);
        if (door && shopAhead(door) <= SHOP_ENTER_M) {
          state.lastShopGuideAt = state.elapsed;
          emit(`The ${door.name} is on your ${door.side}. Swipe ${door.side} to enter.`, null, 3);
        }
      }
      if (state.speed <= 0) return;
      const step = state.speed * dt;
      if (!driving && state.backward) {
        state.distance = Math.max(0, state.distance - step);
        state.remaining = Math.min(segment().metres, state.remaining + step);
        if (state.remaining >= segment().metres) {
          // The start of this stretch: no further back to go.
          state.speed = 0; state.holding = false;
          if (!state.backwardBlocked) {
            state.backwardBlocked = true;
            emit('Start of this stretch. Swipe down to walk forward again.', 'ui-select', 3);
          }
          return;
        }
      } else {
        state.backwardBlocked = false;
        state.distance += step; state.remaining -= step;
      }
      // Coins, monsters and quests only ever come from NEW ground: walking
      // back over old ground and forward again must not pay twice.
      const advancing = state.distance > state.maxDistance;
      if (advancing) state.maxDistance = state.distance;
      if (area === 'christmas' && !inventory.starsDone && state.maxDistance >= loopLength) {
        inventory.starsDone = true; gain(15);
        emit('Starlight Quest complete! You walked the whole fair. Fifteen bonus coins.', 'mission_completed', 4);
      }
      if (driving) {
        state.fuel = Math.max(0, state.fuel - step / 15);
        if (state.fuel <= 0) {
          state.speed = 0; state.holding = false; api.menu();
          emit('Petrol is over. The car has stopped. Race menu open. Petrol selected. Single tap confirms Petrol. Double tap refills.', 'ui-open', 4);
          return;
        }
        if (state.fuel <= 15 && !state.lowFuelSaid) {
          state.lowFuelSaid = true; emit('Petrol low. Open the menu with a down-left swipe and choose Petrol.', 'ui-error', 4);
        }
      }
      if (advancing && state.distance >= state.nextCoinAt) {
        state.nextCoinAt += driving ? 25 : 10; gain(1);
        // Sound for each coin; speech only every five to keep directions clear.
        events.push({ sound: 'ui-pluck', text: !driving && state.collected % 5 === 0 ? `Five more coins. ${wallet.coins} coins total.` : '', priority: 1 });
        quest();
      }
      if (area === 'forest' && advancing && state.distance >= state.nextMonsterAt) {
        const side = ['ahead', 'left', 'right'][state.kills % 3];
        // The roster cycles, so the same creature never appears twice in a row.
        const creature = FOREST_CREATURES[state.kills % FOREST_CREATURES.length];
        state.monster = { side, health: creature.health, damage: creature.damage, name: creature.name, id: creature.id };
        state.speed = 0; state.attackClock = 0; state.aim = 'ahead';
        const foe = cap(creature.name);
        emit(`${foe} ${side}. ${creature.note} ${foe} health ${creature.health}. Your health ${state.health}. Single tap to strike. Triple tap to heal.`, 'monster-arrival', 4);
        return;
      }
      if (area === 'city' && inventory.shopOwned) {
        state.shopClock += dt;
        if (state.shopClock >= 30) { state.shopClock -= 30; gain(1); emit('Your city shop earns one coin.', 'ui-pluck', 1); }
      }
      if (state.remaining <= 0) {
        if (driving && !state.queuedTurn) { crash(); return; }
        if (!driving && !state.queuedTurn) {
          state.speed = 0; state.remaining = 1; state.holding = false;
          emit(`Junction. Stopped safely. Swipe ${segment().direction} to select the path, then hold to walk.`); return;
        }
        const direction = segment().direction;
        state.leg++; state.turns++; state.remaining = segment().metres;
        state.queuedTurn = null; state.lastGuideAt = state.elapsed; state.lastNumber = metres();
        state.earlySaid = segment().metres <= 500; state.nowSaid = false;
        emit(`${driving ? 'Turning' : 'Walking'} ${direction}. Next: ${segment().direction} in ${metres()} metres.`, 'path-turn', 4);
      } else guide();
      if (!driving) shopGuide();
      if (area === 'city' || area === 'christmas') placeGuide();
    },
  };
  return api;
}
