import { createFreeRoam, normalizeHeading } from '../world/freeRoam.js';
import { createRoamNarrator, nearestDoor } from '../world/roamNarrate.js';
import { makeButton } from './screens.js';

export const ROAM_ZONE = {
  id: 'roam-play', role: 'easyPlay', hold: true, allowSwipe: true,
  tapAnywhere: true, tapWindowMs: 600, immediateTap: false, doubleTapHoldTarget: false, deferDoubleTap: true, allowCircle: false, preventScroll: true,
};

export const ROAM_HOW_TO_PLAY = 'Hold to walk forward; release to stop. Swipe left or right to turn a quarter turn. Swipe down to step backward. Tap to open or close a nearby door. Swipe up or double tap to hear your orientation: the room, your facing, and what is near. The Step left, Step right and Step back buttons sidestep without turning. Walk through doorways to move between rooms; nothing teleports you.';

/** Step length for tap sidesteps/steps-back: one 0.5 s walk, collision-safe. */
const STEP_S = 0.5;

/** Playable free-roam exploration of the connected starter house. */
export function buildFreeRoamScreen({ gameState, screens, speech, audio, onControlsChanged, autoTick = true }) {
  const roam = createFreeRoam({});
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
    `<rect x="${f.x0 * S}" y="${py(f.y1)}" width="${(f.x1 - f.x0) * S}" height="${(f.y1 - f.y0) * S}" rx="4" fill="#7a5c3e"/>`).join('');
  visual.innerHTML = `<svg viewBox="0 0 600 480" style="width:100%;max-height:38vh;border-radius:22px;background:#1d233b">
    <rect x="0" y="0" width="600" height="480" fill="#232a42"/>
    <text x="20" y="34" fill="#c1d2df" font-size="18">HOUSE · WALK &amp; EXPLORE</text>
    ${rects}${doors}${furn}
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
  const heldKeys = new Set();

  function say(text, priority = 3) {
    actionText.textContent = text;
    speech?.say(text, { priority, key: 'roam-current', cooldownMs: 0, hardInterrupt: true, replace: true, ttlMs: 1500 });
  }
  function flush() {
    const events = narrator.update();
    if (events.length > 0) {
      const top = events.sort((a, b) => b.priority - a.priority)[0];
      say(top.text, top.priority);
    }
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
  function stepTurn(dir) {
    if (!api.playing) return;
    roam.state.headingDeg = normalizeHeading(roam.state.headingDeg + (dir === 'right' ? 90 : -90));
    flush(); // surroundings first, so the turn confirmation is what is heard
    say(`Turned ${dir}. Now facing ${roam.facing()}.`, 3);
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
  function orientation() {
    if (!api.playing) return;
    say(narrator.orientation(), 3);
    render();
  }

  const api = {
    id: 'house', title: 'Explore House',
    summary: 'Hold to walk forward, release to stop. Swipe left or right to turn. Swipe down steps back. Tap opens or closes a nearby door. Swipe up or double tap hears your orientation. Down-left opens the menu. Up then left goes back. Choose Start when ready. How to play reads all controls.',
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
      button('Use nearby door', 'Open or close the closest door', () => useDoor());
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
      if (type === 'pressEnd') roam.stop();
      if (type === 'tap') useDoor();
      if (type === 'doubleTap') orientation();
      if (type === 'swipe') {
        if (d.direction === 'left' || d.direction === 'right') stepTurn(d.direction);
        else if (d.direction === 'down') stepWalk('backward');
        else if (d.direction === 'up') orientation();
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
      if (roam.state.moving) {
        footstepClock += dt;
        if (footstepClock >= 0.5) {
          footstepClock = 0;
          audio?.play('footstep-concrete-0', { group: 'sfx', volume: 0.3 });
        }
      }
      flush(); audio?.tick?.();
    },
    suspend() { suspended = true; roam.stop(); },
    resume() { suspended = false; api.openMenu(); lastWall = performance.now(); },
    destroy() { destroyed = true; if (tickId !== null) clearInterval(tickId); roam.stop(); },
  };

  function render() {
    const room = roam.map.rooms.find((r) => r.id === roam.roomAt());
    caption.textContent = `${room ? room.name[0].toUpperCase() + room.name.slice(1) : 'House'}. Facing ${roam.facing()}.`;
    status.textContent = `${roam.state.moving ? 'Walking' : 'Standing'} · facing ${roam.facing()} · position ${roam.state.x.toFixed(1)}, ${roam.state.y.toFixed(1)} metres`;
    const avatar = visual.querySelector('.roam-avatar');
    avatar.setAttribute('transform', `translate(${roam.state.x * S} ${py(roam.state.y)}) rotate(${roam.state.headingDeg})`);
    for (const el of visual.querySelectorAll('[data-door]')) {
      el.setAttribute('fill', roam.isDoorOpen(el.dataset.door) ? '#f8d36a' : '#b0524d');
    }
  }
  function buildMenu() {
    controls.textContent = '';
    const buttons = [];
    function button(label, hint, fn) {
      const b = makeButton({ label, hint, onActivate: fn }); buttons.push(b); controls.appendChild(b.element); return b;
    }
    button(started ? 'Return to game' : 'Start Explore House', 'Close this menu and play', () => api.closeMenu());
    button('Where am I', 'Hear the room, facing and surroundings', () => say(narrator.orientation(), 3));
    button('How to play', 'Read the controls for exploring', () => say(`${ROAM_HOW_TO_PLAY} Down-left opens this menu. Up then left goes back. Keyboard: W walks forward, S walks backward, A and D turn, Space hears orientation, R uses a nearby door.`, 3));
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
