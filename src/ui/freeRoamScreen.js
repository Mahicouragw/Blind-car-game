import { createFreeRoam, normalizeHeading } from '../world/freeRoam.js';
import { createRoamNarrator, nearestDoor } from '../world/roamNarrate.js';
import { makeButton } from './screens.js';

export const ROAM_ZONE = {
  id: 'roam-play', role: 'easyPlay', hold: true, allowSwipe: true,
  tapAnywhere: true, tapWindowMs: 600, immediateTap: false, doubleTapHoldTarget: false, deferDoubleTap: true, allowCircle: true, preventScroll: true,
};

export const ROAM_HOW_TO_PLAY = 'Single tap starts or stops walking. Hold to walk only while held. Swipe left or right to turn without moving. Swipe up steps forward and swipe down steps back. Two-finger tap stops at once. Draw a circle to turn around. Double tap collects, opens, or uses the nearest thing, or hears your orientation when nothing is near. Triple tap repeats the last announcement. The Step and Stop buttons and the keyboard do the same without gestures. Walk through doorways to move between rooms; nothing teleports you. At the main entrance, swipe up to walk out to the city.';

/** Step length for tap sidesteps/steps-back: one 0.5 s walk, collision-safe. */
const STEP_S = 0.5;

/** Playable free-roam exploration of the connected starter house. */
export function buildFreeRoamScreen({ gameState, screens, speech, audio, onControlsChanged, autoTick = true }) {
  const roam = createFreeRoam({ store: gameState.save.roam ?? null });
  const narrator = createRoamNarrator({ roam });
  const root = document.createElement('section');
  root.className = 'screen free-roam';
  const head = document.createElement('h1'); head.className = 'screen-title'; head.textContent = 'Explore House';
  const caption = document.createElement('p'); caption.className = 'screen-subtitle';
  const visual = document.createElement('div'); visual.setAttribute('aria-hidden', 'true');
  const S = 60; // px per metre
  const py = (y) => (8 - y) * S;
  const rects = roam.map.walls.map((w) =>
    `<rect x="${w.x0 * S}" y="${py(w.y1)}" width="${(w.x1 - w.x0) * S}" height="${(w.y1 - w.y0) * S}" fill="#3a3f52"/>`).join('');
  const doors = roam.map.doors.map((d) =>
    `<rect data-door="${d.id}" x="${d.x0 * S}" y="${py(d.y1)}" width="${(d.x1 - d.x0) * S}" height="${(d.y1 - d.y0) * S}" fill="#f8d36a"/>`).join('');
  const furn = roam.map.furniture.map((f) =>
    `<rect data-fur="${f.id}" x="${f.x0 * S}" y="${py(f.y1)}" width="${(f.x1 - f.x0) * S}" height="${(f.y1 - f.y0) * S}" rx="4" fill="#7a5c3e"/>`).join('');
  const items = (roam.map.items ?? []).map((i) =>
    `<circle data-item="${i.id}" cx="${i.x * S}" cy="${py(i.y)}" r="8" fill="#8fd18f" stroke="#2c4a2c" stroke-width="2"/>`).join('');
  visual.innerHTML = `<svg viewBox="0 0 600 480" style="width:100%;max-height:38vh;border-radius:22px;background:#1d233b">
    <rect x="0" y="0" width="600" height="480" fill="#232a42"/>
    <text x="20" y="34" fill="#c1d2df" font-size="18">HOUSE · WALK &amp; EXPLORE</text>
    ${rects}${doors}${furn}${items}
    <g class="roam-avatar"><circle r="10" fill="#78d4ed"/><line x1="0" y1="0" x2="0" y2="-18" stroke="#102033" stroke-width="4"/></g>
  </svg>`;
  const status = document.createElement('p'); status.className = 'roam-status';
  status.style.cssText = 'font-size:1.3rem;line-height:1.7;font-variant-numeric:tabular-nums;';
  const actionText = document.createElement('p'); actionText.className = 'roam-action';
  actionText.style.cssText = 'font-size:1.5rem;color:#f8d36a;min-height:2em;';
  const controls = document.createElement('div'); controls.className = 'menu-list';
  root.append(head, caption, visual, status, actionText, controls);

  let started = false, menuOpen = true, destroyed = false, suspended = false, lastWall = performance.now(), tickId = null;
  let footstepClock = 0;
  let tapWalking = false;
  let lastSpoken = '';
  let tapHintSpoken = false;
  let saved = JSON.stringify([gameState.save.coins, gameState.save.roam]);
  const heldKeys = new Set();

  function say(text, priority = 3) {
    lastSpoken = text;
    actionText.textContent = text;
    speech?.say(text, { priority, key: 'roam-current', cooldownMs: 0, hardInterrupt: true, replace: true, ttlMs: 1500 });
  }
  function turnAngle() {
    const v = Number(gameState.settings.roamTurnAngle);
    return v === 45 || v === 180 ? v : 90;
  }
  function faceWords() {
    return roam.facing(turnAngle() === 45 ? 8 : 4);
  }
  function flush() {
    narrator.setFacingSteps(turnAngle() === 45 ? 8 : 4);
    const events = narrator.update();
    if (events.length > 0) {
      const top = events.sort((a, b) => b.priority - a.priority)[0];
      say(top.text, top.priority);
    }
    persist();
    render();
  }
  /** Run a short collision-safe walk synchronously (tap steps). */
  function stepWalk(mode) {
    if (!api.playing) return;
    roam.setMove(mode);
    const n = Math.round(STEP_S / 0.1);
    for (let i = 0; i < n; i++) roam.update(0.1);
    roam.stop();
    audio?.play('footstep-concrete-0', { group: 'sfx', volume: 0.3 });
    flush();
  }
  function stopNow(announce = true) {
    tapWalking = false;
    roam.stop();
    if (announce) say('Stopped.', 3);
    render();
  }
  function toggleWalk() {
    if (!api.playing) return;
    if (gameState.settings.roamWalkTap === false) {
      if (!tapHintSpoken) { tapHintSpoken = true; say('Tap walking is off. Hold to walk.', 2); }
      render(); return;
    }
    if (tapWalking || roam.state.moving) { stopNow(); return; }
    tapWalking = true;
    roam.setMove('forward');
    audio?.play('footstep-concrete-0', { group: 'sfx', volume: 0.3 });
    flush(); // surroundings first, so the walking confirmation is what is heard
    say('Walking.', 3);
  }
  function stepTurn(dir) {
    if (!api.playing) return;
    const angle = turnAngle();
    roam.state.headingDeg = normalizeHeading(roam.state.headingDeg + (dir === 'right' ? angle : -angle));
    flush(); // surroundings first, so the turn confirmation is what is heard
    say(`Turned ${dir}. Now facing ${faceWords()}.`, 3);
  }
  function turnAround() {
    if (!api.playing) return;
    if (gameState.settings.roamCircleTurn === false) { render(); return; }
    roam.state.headingDeg = normalizeHeading(roam.state.headingDeg + 180);
    flush();
    say(`Turned around. Now facing ${faceWords()}.`, 3);
  }
  function repeatLast() {
    if (!api.playing) return;
    if (lastSpoken) say(lastSpoken, 3);
    else orientation();
  }
  function satchelText() {
    const n = roam.store.apples ?? 0;
    const chest = roam.chestOpened() ? 'The wooden chest stands open.' : 'A wooden chest waits in the living room.';
    return `Satchel: ${n} apple${n === 1 ? '' : 's'}. Health ${Math.round(roam.store.health ?? 100)}. ${chest}`;
  }
  function persist() {
    const now = JSON.stringify([gameState.save.coins, gameState.save.roam]);
    if (now !== saved) { gameState.persist(); saved = now; }
  }
  function eatApple() {
    const r = roam.eatApple();
    if (!r.ok && r.reason === 'none') { say('No apples in your satchel.', 2); return; }
    if (!r.ok) { say('You are full and healthy. Save your apples.', 2); return; }
    audio?.play('ui-confirm', { group: 'sfx', volume: 0.5 });
    const feel = roam.hungerWord() === 'Full' ? 'You feel full' : `You are still ${roam.hungerWord().toLowerCase()}`;
    say(`You eat an apple. Health ${r.health}. ${feel}. ${r.apples} apple${r.apples === 1 ? '' : 's'} left.`, 3);
  }
  function smartInteract() {
    if (!api.playing) return;
    const t = roam.nearestInteractable(1.6);
    if (!t) { orientation(); return; }
    if (t.kind === 'door') { useDoor(); return; }
    if (t.kind === 'item') {
      const item = roam.takeItem(t.id);
      if (!item) { orientation(); return; }
      audio?.play('loot-drop', { group: 'sfx', volume: 0.35 });
      const n = roam.store.apples;
      const an = /^[aeiou]/i.test(item.name) ? 'an' : 'a';
      flush();
      say(`You collect ${an} ${item.name}. ${n} apple${n === 1 ? '' : 's'} in your satchel.`, 3);
      return;
    }
    const loot = roam.openChest();
    if (!loot) { orientation(); return; }
    gameState.save.coins += loot.coins;
    roam.store.apples += loot.apples;
    audio?.play('coins', { group: 'sfx', volume: 0.5 });
    flush();
    say(`You open the wooden chest. Inside: ${loot.coins} coins and ${loot.apples} apples.`, 3);
  }
  function useDoor() {
    if (!api.playing) return;
    const near = nearestDoor(roam);
    if (!near) { say('No door close enough.', 2); render(); return; }
    const opening = !roam.isDoorOpen(near.door.id);
    roam.setDoorOpen(near.door.id, opening);
    audio?.play('ui-click', { group: 'sfx', volume: 0.4 });
    flush(); // the toggled action hint first, so the result is what is heard
    say(`You ${opening ? 'open' : 'close'} the ${near.door.name}.`, 3);
  }
  function goToCity() {
    if (!api.playing) return;
    tapWalking = false;
    roam.stop();
    say('Walking out to the city.', 3);
    screens.openEasyWorld('city');
  }
  function orientation() {
    if (!api.playing) return;
    say(narrator.orientation(), 3);
    render();
  }

  const api = {
    id: 'house', title: 'Explore House',
    summary: 'Single tap starts or stops walking. Hold to walk while held. Swipe left or right to turn. Swipe up steps forward, swipe down steps back. Two-finger tap stops. A circle turns you around. Double tap collects, opens, or uses the nearest thing, or hears orientation. Triple tap repeats. Down-left opens the menu. One up-and-left stroke goes back. Choose Start when ready. How to play reads all controls.',
    element: root, focusItems: [], zone: ROAM_ZONE, roam, narrator,
    get isMenu() { return menuOpen; },
    get playing() { return started && !menuOpen && !suspended && !destroyed; },
    onMount() { onControlsChanged?.(api); },
    openMenu() {
      if (destroyed) return;
      roam.stop(); menuOpen = true; buildMenu(); flush();
    },
    closeMenu() {
      if (destroyed) return;
      menuOpen = false; started = true;
      controls.textContent = '';
      const buttons = [];
      const button = (label, hint, fn) => {
        const b = makeButton({ label, hint, onActivate: fn }); buttons.push(b); controls.appendChild(b.element); return b;
      };
      button('Step left', 'Sidestep left without turning', () => stepWalk('strafeLeft'));
      button('Step right', 'Sidestep right without turning', () => stepWalk('strafeRight'));
      button('Step back', 'Step backward without turning', () => stepWalk('backward'));
      button('Orientation', 'Hear the room, facing and surroundings', () => orientation());
      button('Use nearby', 'Collect, open, or use the closest thing', () => smartInteract());
      button('Stop walking', 'Stop immediately', () => stopNow());
      button('Walk out to the city', 'Stand at the main entrance first', () => {
        if (roam.atEntrance()) goToCity();
        else say('Walk to the main entrance first.', 2);
      });
      button('Open game menu', 'Or swipe down and left', () => api.openMenu());
      api.focusItems = buttons;
      onControlsChanged?.(api); lastWall = performance.now(); flush();
    },
    handleGesture(type, d = {}) {
      if (!api.playing) return false;
      if (type === 'longPressStart') {
        roam.setMove('forward');
        audio?.play('footstep-concrete-0', { group: 'sfx', volume: 0.3 });
        footstepClock = 0;
      }
      // Release stops hold-walking, but a tap-toggle walk survives touches:
      // only a tap, two fingers, or Stop ends it.
      if (type === 'pressEnd' && !tapWalking) roam.stop();
      if (type === 'tap') toggleWalk();
      if (type === 'doubleTap') smartInteract();
      if (type === 'tripleTap') repeatLast();
      if (type === 'twoFingerTap') stopNow();
      if (type === 'circle') turnAround();
      if (type === 'swipe') {
        if (d.direction === 'left' || d.direction === 'right') stepTurn(d.direction);
        else if (d.direction === 'down') stepWalk('backward');
        else if (d.direction === 'up') { if (roam.atEntrance()) goToCity(); else stepWalk('forward'); }
      }
      render(); return true;
    },
    handleKey(type, d) {
      if (!api.playing) return false;
      if (type === 'down') {
        if (d.action === 'accelerate') { heldKeys.add('accelerate'); roam.setMove('forward'); }
        else if (d.action === 'brake') { heldKeys.add('brake'); roam.setMove('backward'); }
        else if (d.action === 'steerLeft') stepTurn('left');
        else if (d.action === 'steerRight') stepTurn('right');
        else if (d.action === 'handbrake') orientation();
        else if (d.action === 'requestRespawn') useDoor();
      } else if (d.action === 'accelerate' || d.action === 'brake') {
        heldKeys.delete(d.action);
        if (heldKeys.size === 0) roam.stop();
      }
      render(); return true;
    },
    tick(dt) {
      if (!api.playing) return;
      roam.update(dt);
      if (roam.fainted()) {
        roam.recover();
        flush();
        say('You feel faint from hunger and wake up at the house entrance.', 4);
      }
      if (roam.state.moving) {
        footstepClock += dt;
        if (footstepClock >= 0.5) {
          footstepClock = 0;
          audio?.play('footstep-concrete-0', { group: 'sfx', volume: 0.3 });
        }
      }
      flush(); audio?.tick?.();
    },
    suspend() { suspended = true; tapWalking = false; roam.stop(); },
    resume() { suspended = false; api.openMenu(); lastWall = performance.now(); },
    destroy() { destroyed = true; if (tickId !== null) clearInterval(tickId); roam.stop(); persist(); },
  };

  function render() {
    const room = roam.map.rooms.find((r) => r.id === roam.roomAt());
    caption.textContent = `${room ? room.name[0].toUpperCase() + room.name.slice(1) : 'House'}. Facing ${faceWords()}.`;
    status.textContent = `${roam.state.moving ? 'Walking' : 'Standing'} · facing ${faceWords()} · position ${roam.state.x.toFixed(1)}, ${roam.state.y.toFixed(1)} metres · Health ${Math.round(roam.store.health ?? 100)} · ${roam.hungerWord()}`;
    const avatar = visual.querySelector('.roam-avatar');
    avatar.setAttribute('transform', `translate(${roam.state.x * S} ${py(roam.state.y)}) rotate(${roam.state.headingDeg})`);
    for (const el of visual.querySelectorAll('[data-door]')) {
      el.setAttribute('fill', roam.isDoorOpen(el.dataset.door) ? '#f8d36a' : '#b0524d');
    }
    for (const el of visual.querySelectorAll('[data-item]')) {
      el.style.display = roam.isTaken(el.dataset.item) ? 'none' : '';
    }
    const chestEl = visual.querySelector('[data-fur="wooden-chest"]');
    if (chestEl) chestEl.setAttribute('fill', roam.chestOpened() ? '#c9a227' : '#7a5c3e');
  }
  function buildMenu() {
    controls.textContent = '';
    const buttons = [];
    function button(label, hint, fn) {
      const b = makeButton({ label, hint, onActivate: fn }); buttons.push(b); controls.appendChild(b.element); return b;
    }
    button(started ? 'Return to game' : 'Start Explore House', 'Close this menu and play', () => api.closeMenu());
    button('Where am I', 'Hear the room, facing and surroundings', () => say(narrator.orientation(), 3));
    button('Satchel', 'Hear what you carry', () => say(satchelText(), 3));
    button('Eat an apple', 'Lower hunger and heal a little', () => eatApple());
    button('Visit City Walk', 'Fast travel; the forest road leaves from the North Gate', () => screens.openEasyWorld('city'));
    button('How to play', 'Read the controls for exploring', () => say(`${ROAM_HOW_TO_PLAY} Down-left opens this menu. One up-and-left stroke goes back. Keyboard: W walks forward, S walks backward, A and D turn, Space hears orientation, R uses a nearby door.`, 3));
    button('Main menu', 'Leave the house', () => screens.gotoMenu());
    button('Exit game', 'Save and stop game audio', () => screens.openExit());
    api.focusItems = buttons;
    onControlsChanged?.(api);
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
