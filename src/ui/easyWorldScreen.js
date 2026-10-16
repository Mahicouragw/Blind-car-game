import { createEasyWorld } from '../play/easyWorld.js';
import { makeButton } from './screens.js';

export const PLAY_ZONE = {
  id: 'easy-play', role: 'easyPlay', hold: true, allowSwipe: true,
  tapAnywhere: true, tapWindowMs: 600, immediateTap: false, doubleTapHoldTarget: false, deferDoubleTap: true, allowCircle: false, preventScroll: true,
};
const TITLES = { ground: 'Easy Racing Ground', forest: 'Forest Adventure', city: 'City Walk' };
export const EASY_CONTROLS = {
  ground: 'The car drives automatically. Hold more than three seconds and release to accelerate and keep driving. Single tap, or hold one or two seconds and release, to stop. Hear the metres, then swipe left or right to select the next turn; the car turns at the junction. Missing a turn causes a crash and a restart. Coins come as you drive. Petrol runs out; its menu opens automatically.',
  forest: 'Hold to walk; release to stop. Double tap to sit or stand. Swipe left or right to follow a path. Monsters are announced ahead, left or right. Single tap to strike the announced nearby monster with your sword. Aiming is automatic; swipes can also aim. Triple tap to use a healing potion. You start with three potions. Monsters take two hits. Your health is spoken after each attack.',
  city: 'Hold to walk; release to stop. Double tap to sit or stand. Swipe left or right to follow a path. Collect coins as you walk. Open the menu to buy healing potions, buy a city shop, visit the forest or enter racing. There is no timer and no combat in the city.',
};

/** A complete spoken mini-game, also usable without WebGL or a GPU. */
export function buildEasyWorldScreen({ area, gameState, screens, speech, audio, onControlsChanged, autoTick = true }) {
  const wallet = {
    get coins() { return gameState.save.coins; },
    set coins(value) { gameState.save.coins = value; },
    get xp() { return gameState.save.xp; },
    set xp(value) { gameState.save.xp = value; },
    get level() { return gameState.save.level; },
    set level(value) { gameState.save.level = value; },
  };
  const world = createEasyWorld({ area, wallet, inventory: gameState.save.easyWorld });
  const root = document.createElement('section');
  root.className = 'screen easy-world';
  const head = document.createElement('h1'); head.className = 'screen-title'; head.textContent = TITLES[area];
  const caption = document.createElement('p'); caption.className = 'screen-subtitle';
  const visual = document.createElement('div'); visual.setAttribute('aria-hidden', 'true');
  visual.innerHTML = `<svg viewBox="0 0 600 280" style="width:100%;max-height:38vh;border-radius:22px;background:${area === 'ground' ? '#122033' : area === 'forest' ? '#102b21' : '#1d233b'}">
    <path class="easy-road" d="M300 290V105H${area === 'ground' ? '540' : '65'}" fill="none" stroke="${area === 'ground' ? '#374d69' : area === 'forest' ? '#6d6650' : '#5c6488'}" stroke-width="90" stroke-linejoin="round"/>
    <path class="easy-centreline" d="M300 290V105H540" fill="none" stroke="#f8d36a" stroke-width="3" stroke-dasharray="14 15"/>
    ${area === 'forest' ? '<g fill="#245840"><path d="M55 200L100 90L145 200Z"/><path d="M435 235L480 125L525 235Z"/><path d="M145 265L175 185L205 265Z"/></g>' : area === 'city' ? '<g fill="#434e71" stroke="#8795b5" stroke-width="2"><rect x="55" y="125" width="100" height="135" rx="5"/><rect x="445" y="170" width="100" height="90" rx="5"/></g><g fill="#f4d878"><rect x="70" y="145" width="20" height="20"/><rect x="115" y="145" width="20" height="20"/><rect x="465" y="190" width="20" height="20"/></g>' : ''}
    <g class="monster-marker" style="display:none"><circle r="25" fill="#e27679"/><text y="8" text-anchor="middle" font-size="26" fill="#1c1020">!</text></g>
    <g fill="#ecd26e"><circle cx="300" cy="150" r="7"/><circle cx="300" cy="180" r="7"/><circle cx="355" cy="105" r="7"/></g>
    <text x="30" y="40" fill="#c1d2df" font-size="18">${area === 'ground' ? 'ENDLESS · EASY DRIVE' : area === 'forest' ? 'FOREST · WALK & EXPLORE' : 'CITY · WALK & TRADE'}</text>
    <g class="play-avatar" transform="translate(300 235)"><rect x="-15" y="-25" width="30" height="50" rx="9" fill="#78d4ed"/><path d="M-8 -10L0 -20L8 -10" fill="none" stroke="#102033" stroke-width="3"/></g>
    <text class="turn-marker" x="460" y="210" fill="#fff" font-size="40">→</text>
  </svg>`;
  const status = document.createElement('p'); status.className = 'easy-status';
  status.style.cssText = 'font-size:1.3rem;line-height:1.7;font-variant-numeric:tabular-nums;';
  const actionText = document.createElement('p'); actionText.className = 'easy-action';
  actionText.style.cssText = 'font-size:1.5rem;color:#f8d36a;min-height:2em;';
  const controls = document.createElement('div'); controls.className = 'menu-list';
  root.append(head, caption, visual, status, actionText, controls);
  let started = false, destroyed = false, suspended = false, lastWall = performance.now(), tickId = null;
  let saved = JSON.stringify([gameState.save.coins, gameState.save.xp, gameState.save.level, gameState.save.easyWorld]);
  let keyStart = null;
  let engineRunning = false;
  let footstepClock = 0;
  const api = {
    id: area, title: TITLES[area], summary: `${area === 'ground' ? 'Automatic driving with spoken metre countdowns. Single tap stops. Hold over three seconds to accelerate. Swipe left or right to take a turn.' : area === 'forest' ? 'Hold to walk, release to stop. Single tap strikes a monster, double tap sits, triple tap heals.' : 'Hold to walk, release to stop. Collect coins and open the menu for shops and racing.'} Down-left opens the menu. Up then left goes back. Choose Start when ready. How to play reads all controls.`,
    element: root, focusItems: [], zone: area === 'ground' ? { ...PLAY_ZONE, immediateTap: true, deferDoubleTap: false } : PLAY_ZONE, world,
    get isMenu() { return world.state.menu; },
    get playing() { return started && !world.state.menu && !suspended && !destroyed; },
    onMount() { onControlsChanged?.(api); },
    openMenu(fuel = false) {
      if (destroyed) return;
      world.menu(); stopEngine(); buildMenu(fuel ? 'Petrol' : null); flush();
    },
    closeMenu() {
      if (destroyed) return;
      started = true; world.closeMenu(); controls.textContent = '';
      api.focusItems = [];
      const menu = makeButton({ label: 'Open game menu', hint: 'Or swipe down and left', onActivate: () => api.openMenu() });
      controls.appendChild(menu.element);
      onControlsChanged?.(api); lastWall = performance.now(); render(); flush();
    },
    handleGesture(type, d = {}) {
      if (!api.playing) return false;
      if (type === 'pressStart' && area === 'ground') world.pressStart();
      if (type === 'longPressStart' && area !== 'ground') {
        world.pressStart();
        if (world.state.speed > 0) {
          audio?.play(area === 'forest' ? 'footstep-grass-0' : 'footstep-concrete-0', { group: 'sfx', volume: 0.3 });
          footstepClock = 0;
        }
      }
      if (type === 'pressEnd' && (area === 'ground' || world.state.holding)) world.pressEnd(d.durationMs, d.cancelled || (area === 'ground' && d.moved));
      if (type === 'tap') world.tap();
      if (type === 'doubleTap') world.doubleTap();
      if (type === 'tripleTap') world.heal();
      if (type === 'swipe') world.swipe(d.direction);
      render(); flush(); return true;
    },
    handleKey(type, d) {
      if (!api.playing) return false;
      if (type === 'down') {
        if (d.action === 'accelerate') { keyStart = performance.now(); world.pressStart(); }
        else if (d.action === 'brake') world.tap();
        else if (d.action === 'steerLeft') world.swipe('left');
        else if (d.action === 'steerRight') world.swipe('right');
        else if (d.action === 'handbrake') world.doubleTap();
        else if (d.action === 'requestRespawn') world.heal();
      } else if (d.action === 'accelerate') {
        world.pressEnd(keyStart === null ? 0 : performance.now() - keyStart, d.code === 'blur'); keyStart = null;
      }
      render(); flush(); return true;
    },
    tick(dt) {
      if (!api.playing) return;
      world.update(dt);
      if (area !== 'ground' && world.state.speed > 0) {
        footstepClock += dt;
        if (footstepClock >= 0.5) {
          footstepClock = 0;
          audio?.play(area === 'forest' ? 'footstep-grass-0' : 'footstep-concrete-0', { group: 'sfx', volume: 0.3 });
        }
      }
      if (world.state.menu) { stopEngine(); buildMenu('Petrol'); }
      render(); flush(); audio?.tick?.();
    },
    suspend() { suspended = true; world.pause(); stopEngine(); persist(); },
    resume() {
      suspended = false;
      // Never resume movement in the background or unexpectedly after settings.
      api.openMenu(); lastWall = performance.now();
    },
    destroy() {
      destroyed = true; if (tickId !== null) clearInterval(tickId);
      stopEngine(); persist();
    },
  };
  function persist() {
    const now = JSON.stringify([gameState.save.coins, gameState.save.xp, gameState.save.level, gameState.save.easyWorld]);
    if (now !== saved) { gameState.persist(); saved = now; }
  }
  function stopEngine() {
    if (area === 'ground' && engineRunning) audio?.engine?.stop();
    engineRunning = false;
  }
  function flush() {
    const items = world.drain();
    for (const item of items) {
      const sounds = Array.isArray(item.sound) ? item.sound : item.sound ? [item.sound] : [];
      sounds.forEach((name, index) => audio?.play(name, { group: 'sfx', volume: name === 'monster-arrival' ? 0.55 : 0.4, delay: index * 0.09 }));
    }
    // One PRESENT instruction wins this update. Coins never queue ahead of a turn.
    const message = items.filter(i => i.text).sort((a, b) => b.priority - a.priority)[0];
    if (message) {
      actionText.textContent = message.text;
      speech?.say(message.text, {
        priority: message.priority, key: 'easy-current', cooldownMs: 0,
        hardInterrupt: true, replace: true, ttlMs: 1200,
      });
    }
    persist();
  }
  function render() {
    const s = world.state;
    caption.textContent = world.describe();
    status.textContent = area === 'ground'
      ? `${Math.round(s.speed * 3.6)} km/h · Petrol ${Math.ceil(s.fuel)}% · ${gameState.save.coins} coins · ${s.turns} turns completed`
      : `Health ${s.health}/100 · ${world.inventory.potions} potions · ${gameState.save.coins} coins · XP ${gameState.save.xp} · Level ${gameState.save.level} · ${Math.floor(s.distance)} metres walked`;
    const left = world.segment().direction === 'left';
    visual.querySelector('.turn-marker').textContent = left ? '←' : '→';
    for (const path of visual.querySelectorAll('.easy-road, .easy-centreline')) path.setAttribute('d', `M300 290V105H${left ? 60 : 540}`);
    visual.querySelector('.easy-centreline').setAttribute('stroke-dashoffset', String(-s.distance * 3));
    const monster = visual.querySelector('.monster-marker');
    monster.style.display = s.monster ? '' : 'none';
    if (s.monster) monster.setAttribute('transform', `translate(${s.monster.side === 'left' ? 225 : s.monster.side === 'right' ? 375 : 300} 170)`);
    visual.querySelector('.play-avatar').setAttribute('transform', `translate(300 ${235 + (s.speed > 0 && area !== 'ground' ? Math.sin(s.distance * 5) * 2 : 0)})`);
    visual.style.opacity = s.out ? '0.4' : '1';
    if (area === 'ground') {
      if (api.playing && s.speed > 0 && !s.out && !document.hidden) {
        if (!engineRunning) engineRunning = !!audio?.engine?.start();
        audio?.engine?.update({ rpm: 1800 + s.speed * 90, throttle: s.speed > 0 ? 0.5 : 0, speedNorm: s.speed / 25 });
      } else stopEngine();
    }
  }
  function buildMenu(focusLabel) {
    world.menu();
    controls.textContent = '';
    const buttons = [];
    function button(label, hint, fn) {
      const b = makeButton({ label, hint, onActivate: fn }); buttons.push(b); controls.appendChild(b.element); return b;
    }
    button(started ? 'Return to game' : `Start ${TITLES[area]}`, 'Close this menu and play', () => api.closeMenu());
    if (area === 'ground') button('Petrol', 'Fill for five coins. Free emergency refill if you cannot afford it.', () => { world.buyPetrol(); flush(); render(); });
    button('Where am I', 'Read current position, health and coins', () => { speech?.say(world.describe(), { hardInterrupt: true, replace: true, cooldownMs: 0 }); });
    button('Experience and level', 'Read your saved progress', () => speech?.say(`Experience ${gameState.save.xp}. Level ${gameState.save.level}. Monsters give 25 experience and five coins each.`, { hardInterrupt: true, replace: true, cooldownMs: 0 }));
    button('How to play', 'Read the controls for this area', () => { speech?.say(`${EASY_CONTROLS[area]} Down-left opens this menu. Up then left goes back. Keyboard: W to hold, S to stop or strike, A and D to choose direction, Space to sit, R to heal.`, { hardInterrupt: true, replace: true, cooldownMs: 0 }); });
    if (area === 'city') {
      button('Buy healing potion', 'Three coins. Use by triple tapping in the forest.', () => { world.buyPotion(); flush(); render(); });
      button('Buy city coin shop', '25 coins. Earn one coin per thirty seconds of city walking.', () => { world.buyShop(); flush(); render(); });
      button('Enter a racing event', 'Open the existing race level selection', () => screens.openLevelSelect());
      button('Cars and upgrades', 'Open the existing garage', () => screens.openGarage());
    }
    button('Easy quest', 'Collect ten coins, with no time limit', () => {
      speech?.say(world.inventory.questDone ? 'Quest complete. You have already received the ten-coin bonus. Keep exploring for unlimited coins.' : `Collect ten coins in a single visit to any area. ${Math.min(10, world.state.collected)} of ten collected. Reward: ten bonus coins.`, { hardInterrupt: true, replace: true, cooldownMs: 0 });
    });
    for (const dest of ['ground', 'forest', 'city']) if (dest !== area) button(`Visit ${TITLES[dest]}`, 'Your coins and inventory are saved', () => screens.openEasyWorld(dest));
    button('Main menu', 'Save and leave this area', () => screens.gotoMenu());
    button('Exit game', 'Save and stop game audio', () => screens.openExit());
    api.focusItems = buttons;
    onControlsChanged?.(api);
    if (focusLabel) {
      const index = buttons.findIndex(b => b.label === focusLabel);
      if (index >= 0) api.focusRing?.focusAt(index, { silent: true });
    }
    render();
  }
  buildMenu();
  if (autoTick) tickId = setInterval(() => {
    const now = performance.now(); const dt = Math.min(0.25, (now - lastWall) / 1000); lastWall = now;
    if (document.hidden) { if (!suspended) api.suspend(); return; }
    api.tick(dt);
  }, 100);
  tickId?.unref?.();
  return api;
}
