/** Accessible, untimed play areas. No DOM, renderer, network, or sound synthesis.
 * Existing simulation races are intentionally unaffected by these easy modes.
 * Coins share the existing wallet; all inventory is validated by save.js.
 */
export const ACCELERATE_HOLD_MS = 3000;
export const GROUND_ROUTE = [
  { metres: 500, direction: 'right' }, { metres: 300, direction: 'left' },
  { metres: 400, direction: 'right' }, { metres: 300, direction: 'left' },
];
export const WALK_ROUTE = [
  { metres: 40, direction: 'left' }, { metres: 35, direction: 'right' },
  { metres: 45, direction: 'right' }, { metres: 40, direction: 'left' },
];
const n = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createEasyWorld({ area = 'ground', wallet = {}, inventory = {}, route } = {}) {
  if (!['ground', 'forest', 'city'].includes(area)) throw new Error('Unknown play area');
  const driving = area === 'ground';
  const path = route ?? (driving ? GROUND_ROUTE : WALK_ROUTE);
  if (!path.length || path.some(p => !Number.isFinite(p.metres) || p.metres <= 0 || !['left', 'right'].includes(p.direction))) {
    throw new Error('Invalid route');
  }
  inventory.potions = clamp(Math.floor(n(inventory.potions, 3)), 0, 99);
  inventory.shopOwned = inventory.shopOwned === true;
  inventory.questDone = inventory.questDone === true;
  wallet.coins = clamp(Math.floor(n(wallet.coins)), 0, 10000000);
  const state = {
    area, paused: false, menu: false, elapsed: 0, leg: 0, remaining: path[0].metres,
    distance: 0, speed: driving ? 12 : 0, cruiseSpeed: 12, holding: false, holdElapsed: 0,
    fuel: 100, health: 100, seated: false, monster: null, aim: 'ahead',
    queuedTurn: null, turns: 0, collected: 0, kills: 0, out: false, restartIn: 0,
    nextCoinAt: driving ? 25 : 10, nextMonsterAt: 24, attackClock: 0, shopClock: 0,
    lastGuideAt: -Infinity, lastNumber: null, lowFuelSaid: false,
  };
  let events = [];
  function emit(text, sound, priority = 3) { events.push({ text, sound, priority }); }
  function gain(amount) {
    wallet.coins = Math.min(10000000, wallet.coins + amount);
    state.collected += amount;
  }
  function segment() { return path[state.leg % path.length]; }
  function metres() {
    const d = state.remaining;
    const step = d > 150 ? 50 : d > 60 ? 25 : d > 25 ? 10 : 5;
    return Math.max(5, Math.round(d / step) * step);
  }
  function describe() {
    if (state.out) return driving ? 'You are out. Restarting the racing ground.' : 'You are resting safely at the forest entrance.';
    if (state.monster) return `Monster ${state.monster.side}. Monster health ${state.monster.health}. Your health ${state.health}. Swipe toward it, then single tap to strike. Triple tap to heal.`;
    if (driving) return `${state.speed > 0 ? 'Driving' : 'Stopped'}. Turn ${segment().direction} in ${metres()} metres. Petrol ${Math.ceil(state.fuel)} percent. ${wallet.coins} coins.`;
    return `${area === 'forest' ? 'Forest' : 'City'}. ${state.seated ? 'Seated' : state.speed > 0 ? 'Walking' : 'Standing'}. Path turns ${segment().direction} in ${metres()} metres. Health ${state.health}. ${wallet.coins} coins.`;
  }
  function reset() {
    Object.assign(state, {
      remaining: path[0].metres, leg: 0, queuedTurn: null, speed: driving ? 12 : 0,
      cruiseSpeed: 12, holding: false, fuel: 100, health: 100, seated: false,
      monster: null, aim: 'ahead', out: false, restartIn: 0, lastGuideAt: -Infinity,
      lastNumber: null, lowFuelSaid: false, distance: 0, nextCoinAt: driving ? 25 : 10,
      nextMonsterAt: 24, attackClock: 0,
    });
    state.lastGuideAt = state.elapsed; state.lastNumber = metres();
    emit(driving ? `New start. The car is driving automatically. Turn ${segment().direction} in ${metres()} metres.` : 'You are safe at the forest entrance. Health 100. Hold to walk.', 'ui-confirm', 4);
  }
  function crash() {
    if (state.out) return;
    state.out = true; state.restartIn = 3; state.speed = 0; state.holding = false;
    emit('You missed the turn and hit the barrier. You are out. Restarting in three seconds. Your coins are safe.', 'barrier-heavy', 4);
  }
  function guide() {
    const value = metres();
    const since = state.elapsed - state.lastGuideAt;
    if ((value !== state.lastNumber && since >= 3) || since >= 5) {
      state.lastGuideAt = state.elapsed; state.lastNumber = value;
      emit(`${driving ? 'Turn' : 'Path turns'} ${segment().direction} in ${value} metres.${state.queuedTurn ? ' Turn selected.' : ' Swipe ' + segment().direction + ' to take it.'}`, null, 3);
    }
  }
  function quest() {
    // One simple, optional task. No time limit and no progress is required to play.
    if (!inventory.questDone && state.collected >= 10) {
      inventory.questDone = true; gain(10);
      emit('Easy quest complete: collect ten coins. Ten bonus coins added.', 'ui-confirm', 3);
    }
  }
  const api = {
    state, wallet, inventory, segment, describe,
    drain() { const result = events; events = []; return result; },
    pause() { state.paused = true; state.holding = false; if (!driving) state.speed = 0; },
    resume() { state.paused = false; },
    menu() { api.pause(); state.menu = true; },
    closeMenu() {
      state.menu = false; api.resume();
      state.lastGuideAt = state.elapsed; state.lastNumber = metres();
      emit(describe());
    },
    pressStart() {
      if (state.paused || state.out) return;
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
      if (area !== 'forest' || !state.monster) { emit(describe()); return; }
      if (state.aim !== state.monster.side) {
        emit(`Monster ${state.monster.side}. Swipe ${state.monster.side === 'ahead' ? 'up' : state.monster.side} to aim, then tap.`, 'ui-error'); return;
      }
      state.monster.health = Math.max(0, state.monster.health - 25);
      if (state.monster.health === 0) {
        state.monster = null; state.kills++; gain(5); state.attackClock = 0;
        state.nextMonsterAt = state.distance + 35;
        emit(`Monster defeated. Five coins. Your health ${state.health}. Hold to keep walking.`, 'generic-light'); quest();
      } else emit(`Sword strike. Monster health ${state.monster.health}. Your health ${state.health}.`, 'generic-light');
    },
    doubleTap() {
      if (state.paused || state.out) return;
      if (driving) { api.tap(); return; }
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
        emit(`Aiming ${state.aim}. Monster ${state.monster.side}. Single tap to strike.`); return;
      }
      if (direction !== 'left' && direction !== 'right') { emit(describe()); return; }
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
      if (state.out) { state.restartIn -= dt; if (state.restartIn <= 0) reset(); return; }
      if (state.monster) {
        state.speed = 0; state.attackClock += dt;
        if (state.attackClock >= 5) {
          state.attackClock = 0; state.health = Math.max(0, state.health - 8);
          if (state.health === 0) {
            state.out = true; state.restartIn = 3;
            emit('Health zero. Returning safely to the forest entrance. Your coins are safe.', 'generic-light', 4);
          } else emit(`Monster ${state.monster.side} attacks. Health ${state.health}. Swipe toward it and tap to strike. Triple tap to heal.`, 'generic-light', 4);
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
      if (state.speed <= 0) return;
      const distance = state.speed * dt;
      state.distance += distance; state.remaining -= distance;
      if (driving) {
        state.fuel = Math.max(0, state.fuel - distance / 15);
        if (state.fuel <= 0) {
          state.speed = 0; state.holding = false; api.menu();
          emit('Petrol is over. The car has stopped. Race menu open. Petrol selected. Single tap confirms Petrol. Double tap refills.', 'ui-open', 4);
          return;
        }
        if (state.fuel <= 15 && !state.lowFuelSaid) {
          state.lowFuelSaid = true; emit('Petrol low. Open the menu with a down-left swipe and choose Petrol.', 'ui-error', 4);
        }
      }
      if (state.distance >= state.nextCoinAt) {
        state.nextCoinAt += driving ? 25 : 10; gain(1);
        // Sound for each coin; speech only every five to keep directions clear.
        events.push({ sound: 'ui-pluck', text: state.collected % 5 === 0 ? `Five more coins. ${wallet.coins} coins total.` : '', priority: 1 });
        quest();
      }
      if (area === 'forest' && state.distance >= state.nextMonsterAt) {
        const side = ['ahead', 'left', 'right'][state.kills % 3];
        state.monster = { side, health: 50 }; state.speed = 0; state.attackClock = 0; state.aim = 'ahead';
        emit(`Monster ${side}. Monster health 50. Your health ${state.health}. ${side === 'ahead' ? 'Single tap to strike.' : 'Swipe ' + side + ', then single tap to strike.'} Triple tap to heal.`, 'ui-question', 4);
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
        emit(`${driving ? 'Turning' : 'Walking'} ${direction}. Next: ${segment().direction} in ${metres()} metres.`, 'ui-select', 4);
      } else guide();
    },
  };
  return api;
}
