/**
 * Menu, car selection, Game TalkBack settings, gesture tutorial, level select
 * and results screens.
 *
 * Every control here is a real button, is reachable by keyboard, is announced on
 * focus, and is reachable by gesture. Nothing is a fake button: chapters that
 * are not playable say so in their label and cannot be entered.
 *
 * @module ui/menuScreens
 */

import * as THREE from '../../vendor/three/three.module.js';
import { bus } from '../core/bus.js';
import { SCREEN } from '../core/gameState.js';
import { makeButton, makeReaderBlock, ZONE_ROLE } from './screens.js';
import { musicAttributionLines } from '../core/audio.js';
import {
  cycleSetting,
  SETTINGS_SCHEMA,
  setSetting,
  settingFocusSentence,
  stepSetting,
} from '../a11y/settings.js';
import { availableCars, carAnnouncement } from '../vehicles/carCatalog.js';
import { carAvailable, carPrice, tyreTier } from '../race/garage.js';
import { buildCarMesh } from '../vehicles/carMesh.js';
import { ACHIEVEMENTS, LEVELS, PRACTICE_LEVEL, xpForNextLevel } from '../race/levels.js';
import { CHAPTERS } from '../story/storyData.js';
import { keyboardHelpLines } from '../input/keyboard.js';
import { formatRaceTime, formatTimeSpoken } from '../race/raceState.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function screenShell(title, subtitle) {
  const root = el('section', 'screen');
  const head = el('header', 'screen-head');
  const h1 = el('h1', 'screen-title', title);
  h1.tabIndex = -1;
  head.appendChild(h1);
  if (subtitle) head.appendChild(el('p', 'screen-subtitle', subtitle));
  root.appendChild(head);
  return { root, head, h1 };
}

/** Collect focus-ring items in DOM order from a container. */
function collectFocusItems(container, speech) {
  const items = [];
  container.querySelectorAll('button, [role="option"], [tabindex="0"]').forEach((node) => {
    if (node.disabled) return;
    items.push({
      element: node,
      label: node.dataset.announceLabel || node.textContent.trim().slice(0, 120),
      announce: () => node.dataset.announce || node.textContent.trim(),
      activate: () => node.click(),
    });
  });
  void speech;
  return items;
}

// ---------------------------------------------------------------- main menu

export function buildMenuScreen({ gameState, screens, speech, audio }) {
  const { root, h1 } = screenShell('Vettaru: The Blind Driver', 'An accessible racing story in seven chapters');
  const save = gameState.save;

  const status = el('div', 'menu-status');
  status.setAttribute('data-zone', 'status');
  status.setAttribute('data-zone-role', ZONE_ROLE.READER);
  const profile = el('p', 'menu-profile');
  profile.textContent = `${save.heroName}. Driver level ${save.level}. ${save.xp} experience. ${save.coins} coins. ${save.chaptersCompleted.length} of 7 chapters complete.`;
  const next = xpForNextLevel(save.level);
  if (next) profile.textContent += ` ${Math.max(0, next - save.xp)} experience to level ${save.level + 1}.`;
  status.appendChild(profile);

  if (!gameState.settings.talkback) {
    const warn = el('p', 'menu-warning');
    warn.textContent = 'Game TalkBack is currently OFF. The voice settings button below turns it back on, and this screen keeps speaking so you are never left in silence.';
    status.appendChild(warn);
  }
  if (gameState.session.storageWarning) {
    const w = el('p', 'menu-warning');
    w.textContent = gameState.session.storageWarning;
    status.appendChild(w);
  }
  root.appendChild(status);

  const list = el('div', 'menu-list');
  root.appendChild(list);

  const nextChapter = CHAPTERS.find((c) => c.playable && !save.chaptersCompleted.includes(c.id)) ?? CHAPTERS[0];
  const buttons = [];

  buttons.push(
    makeButton({
      label: save.chaptersCompleted.length ? `Continue the story - chapter ${nextChapter.id}` : 'Start the story - chapter one',
      hint: nextChapter.title,
      onActivate: () => screens.openStory(nextChapter.id),
    })
  );

  buttons.push(
    makeButton({
      label: 'Chapters',
      hint: 'Choose a chapter, including ones not yet playable',
      onActivate: () => screens.openChapterList(),
    })
  );

  buttons.push(
    makeButton({
      label: 'Car selection',
      hint: `${gameState.car.name}. Swipe left and right to browse`,
      onActivate: () => screens.openCarSelect(),
    })
  );

  const spendable = save.coins > 0 || save.grime >= 0.15;
  buttons.push(
    makeButton({
      label: 'Garage',
      hint: spendable
        ? `Spend your ${save.coins} coins on cars, tyres or a wash`
        : `You have ${save.coins} coins. Win races to earn more, then buy cars, tyres or a wash`,
      onActivate: () => screens.openGarage(),
    })
  );

  const levelButtons = LEVELS.filter((l) => l.unlockLevel <= save.level);
  buttons.push(
    makeButton({
      label: 'Race',
      hint: levelButtons.length ? `Level ${levelButtons[levelButtons.length - 1].id}, ${levelButtons[levelButtons.length - 1].name}` : 'Complete the story first',
      onActivate: () => screens.openLevelSelect(),
      disabled: levelButtons.length === 0,
    })
  );

  buttons.push(
    makeButton({
      label: 'Practice session',
      hint: 'Empty circuit, nothing timed, unlimited recovery',
      onActivate: () => screens.startRace(PRACTICE_LEVEL),
    })
  );

  buttons.push(
    makeButton({
      label: 'Gesture tutorial',
      hint: 'Learn every control with the car standing still',
      onActivate: () => screens.openTutorial(),
    })
  );

  buttons.push(
    makeButton({
      label: 'Game TalkBack settings',
      hint: 'Speech, volume, announcement frequency. Also F1, or double tap and hold anywhere.',
      onActivate: () => screens.openSettings(),
    })
  );

  buttons.push(
    makeButton({
      label: 'Circuit map',
      hint: 'Vettaru International Circuit, three point three kilometres',
      onActivate: () => screens.openMap(),
    })
  );

  buttons.push(
    makeButton({
      label: 'Story so far',
      hint: 'A spoken recap of your choices',
      onActivate: () => screens.openRecap(),
    })
  );

  buttons.push(
    makeButton({
      label: 'Audio and credits',
      hint: 'Which sounds loaded, their licence, and what is missing',
      onActivate: () => screens.openAudioStatus(),
    })
  );

  buttons.push(
    makeButton({
      label: 'Reset progress',
      hint: 'Erases your saved story, level and settings',
      className: 'ui-button-danger',
      onActivate: () => screens.confirmReset(),
    })
  );

  for (const b of buttons) list.appendChild(b.element);

  const foot = el('footer', 'screen-foot');
  foot.textContent = 'Voice guidance is built in. It does not require TalkBack or any device screen reader.';
  root.appendChild(foot);

  return {
    id: 'menu',
    title: 'Main menu',
    summary: save.chaptersCompleted.length
      ? `You have completed ${save.chaptersCompleted.length} chapters.`
      : 'A new story is waiting.',
    element: root,
    focusIndex: 0,
    onMount(focusRing) {
      h1.focus?.();
      void focusRing;
    },
    focusItems: buttons,
    destroy() {
      root.remove();
    },
    announceText: `${save.heroName}. Driver level ${save.level}.`,
  };
}

// ----------------------------------------------------------- chapter select

export function buildChapterScreen({ gameState, screens }) {
  const { root } = screenShell('Chapters', 'Playable chapters, and the ones that are declared but not written yet');
  const list = el('div', 'menu-list');
  root.appendChild(list);
  const items = [];
  const save = gameState.save;

  list.appendChild(makeButton({ label: 'Back to menu', onActivate: () => screens.back() }).element);

  for (const chapter of CHAPTERS) {
    const completed = save.chaptersCompleted.includes(chapter.id);
    const available = chapter.playable && (chapter.requires ?? []).every((r) => save.chaptersCompleted.includes(r));
    let label = `Chapter ${chapter.id}. ${chapter.title}.`;
    let hint = chapter.summary;
    if (!chapter.playable) {
      label += ' Not yet playable.';
      hint = chapter.status ?? 'Planned. Not implemented. This entry cannot be started.';
    } else if (completed) label += ' Completed.';
    else if (!available) {
      label += ' Locked.';
      hint = `Finish chapter ${(chapter.requires ?? []).slice(-1)[0]} first.`;
    } else label += ' Available now.';

    const b = makeButton({
      label,
      hint,
      disabled: !chapter.playable || !available,
      className: chapter.playable ? '' : 'ui-button-planned',
      onActivate: () => screens.openStory(chapter.id),
    });
    b.element.setAttribute('data-planned', String(!chapter.playable));
    list.appendChild(b.element);
    items.push(b);
  }

  return {
    id: 'chapters',
    title: 'Chapters',
    summary: `${CHAPTERS.filter((c) => c.playable).length} playable chapters and ${CHAPTERS.filter((c) => !c.playable).length} declared but not yet playable.`,
    element: root,
    focusItems: items,
    destroy() {
      root.remove();
    },
  };
}

// -------------------------------------------------------------- car select

export function buildCarSelectScreen({ gameState, screens, speech, audio, previewCanvas }) {
  const save = gameState.save;
  // Level unlocks cars, and the garage sells them early. Both routes count here,
  // so a car bought with coins appears as available on this screen too.
  const cars = availableCars(save.level).map((car) => {
    if (!car.locked) return car;
    if (carAvailable(car.id, save)) return { ...car, locked: false, lockReason: null };
    const price = carPrice(car.id);
    return price
      ? { ...car, lockReason: `${car.lockReason}, or buy it in the garage for ${price} coins` }
      : car;
  });
  let index = Math.max(0, cars.findIndex((c) => c.id === save.carId));
  if (index < 0) index = 0;

  const { root } = screenShell('Car selection', 'Swipe left and right on the car to browse. Single tap to select.');
  const stage = el('div', 'car-stage');
  stage.setAttribute('data-zone', 'carBrowser');
  stage.setAttribute('data-zone-role', ZONE_ROLE.CAR_BROWSER);
  stage.setAttribute('data-allow-swipe', 'true');
  stage.tabIndex = 0;
  stage.setAttribute('role', 'group');
  stage.setAttribute('aria-label', 'Car preview. Swipe left and right to browse cars.');
  // A real rotating 3D preview, created inside this screen so it is laid out
  // with the rest of it and disposed when the screen goes away.
  const preview = document.createElement('canvas');
  preview.className = 'car-preview';
  preview.setAttribute('aria-hidden', 'true');
  stage.appendChild(preview);
  root.appendChild(stage);

  const panel = el('div', 'car-panel');
  panel.setAttribute('data-zone', 'carInfo');
  panel.setAttribute('data-zone-role', ZONE_ROLE.READER);
  const nameEl = el('h2', 'car-name');
  const tagEl = el('p', 'car-tagline');
  const descEl = el('p', 'car-description');
  const statsEl = el('dl', 'car-stats');
  const noteEl = el('p', 'car-note');
  const counterEl = el('p', 'car-counter');
  panel.append(nameEl, tagEl, descEl, statsEl, noteEl, counterEl);
  root.appendChild(panel);

  const controls = el('div', 'car-controls');
  const prevBtn = makeButton({ label: 'Previous car', hint: 'Swipe left on the car does the same', onActivate: () => browse(-1) });
  const nextBtn = makeButton({ label: 'Next car', hint: 'Swipe right on the car does the same', onActivate: () => browse(1) });
  const selectBtn = makeButton({ label: 'Select this car', hint: 'Confirms your choice and returns to the menu', className: 'ui-button-primary', onActivate: () => confirm() });
  const backBtn = makeButton({ label: 'Back', hint: 'Your progress is kept', onActivate: () => screens.back() });
  controls.append(backBtn.element, prevBtn.element, nextBtn.element, selectBtn.element);
  root.appendChild(controls);

  function render(announce = true) {
    const entry = cars[index];
    nameEl.textContent = entry.name;
    tagEl.textContent = entry.tagline ?? '';
    descEl.textContent = entry.description ?? '';
    statsEl.textContent = '';
    const h = entry.handling ?? {};
    const rows = [
      ['Acceleration', `${h.acceleration ?? '-'} of 5`],
      ['Braking', `${h.braking ?? '-'} of 5`],
      ['Grip and handling', `${h.handling ?? '-'} of 5`],
      ['Top speed', `${h.topSpeed ?? '-'} of 5`],
      ['Difficulty', `${h.difficulty ?? '-'} of 5`],
      ['Mass', `${entry.physics?.mass ?? '-'} kilograms`],
      ['Claimed top speed', `${entry.physics?.topSpeedKph ?? '-'} kilometres per hour`],
      ['Power', `${entry.physics?.peakPowerKw ?? '-'} kilowatts`],
      ['Gears', `${entry.physics?.gearRatios?.length ?? '-'} speed`],
      ['Engine character', entry.soundProfile ?? entry.engineNote ?? 'Recorded engine loop, pitch tracked to rpm'],
    ];
    for (const [k, v] of rows) {
      const dt = el('dt', null, k);
      const dd = el('dd', null, v);
      statsEl.append(dt, dd);
    }
    noteEl.textContent = entry.handlingNote ?? '';
    counterEl.textContent = `Car ${index + 1} of ${cars.length}${entry.locked ? '. Locked.' : ''}.`;
    selectBtn.setDisabled(!!entry.locked);
    if (entry.locked) selectBtn.setLabel(`Locked. ${entry.lockReason ?? 'Not available yet.'}`);
    else selectBtn.setLabel(`Select ${entry.name}`);
    stage.setAttribute('aria-label', `${entry.name}. Car ${index + 1} of ${cars.length}.`);
    if (announce) {
      speech?.say(carAnnouncement(entry, index, cars.length, entry.locked), { priority: 3, cooldownMs: 0 });
    }
    bus.emit('carSelect:index', { index, carId: entry.id });
  }

  function browse(delta) {
    const next = index + delta;
    if (next < 0 || next >= cars.length) {
      speech?.say(delta < 0 ? 'That is the first car.' : 'That is the last car.', { priority: 2, cooldownMs: 400 });
      audio?.play('ui-error', { group: 'sfx', volume: 0.4 });
      return;
    }
    index = next;
    audio?.play('ui-scroll', { group: 'sfx', volume: 0.5 });
    render();
  }

  function confirm() {
    const entry = cars[index];
    if (entry.locked) {
      speech?.say(`${entry.name} is locked. ${entry.lockReason ?? 'Not available yet.'}`, { priority: 3, essential: true });
      return;
    }
    const res = gameState.selectCar(entry.id);
    if (!res.ok) {
      speech?.say(res.reason, { priority: 3, essential: true });
      return;
    }
    audio?.play('ui-confirm', { group: 'sfx', volume: 0.8 });
    speech?.say(`${entry.name} selected. This is the car you will race.`, { priority: 4, interrupt: true, essential: true });
    screens.back();
  }

  render(false);

  return {
    id: 'carSelect',
    title: 'Car selection',
    summary: `${cars.length} cars in your garage. ${cars.filter((c) => c.locked).length} are locked at your level.`,
    element: root,
    focusItems: [backBtn, prevBtn, nextBtn, selectBtn],
    carStage: stage,
    previewCanvas: preview,
    browse,
    render,
    /**
     * Called when the browser cannot give us a WebGL context, so the rotating
     * preview cannot be drawn. The screen stays completely usable: every car is
     * described in words and in figures, and this explains the missing picture
     * rather than leaving a blank rectangle unexplained.
     */
    reportNoPreview() {
      preview.style.display = 'none';
      noteEl.textContent =
        'This browser cannot create a three-dimensional drawing context, so the rotating car preview is not shown. Nothing else is affected: browse with the buttons below or by swiping, and every car is described in words.';
      stage.setAttribute('aria-label', 'No 3D preview available in this browser. Use the buttons below to browse cars.');
    },
    get currentCar() {
      return cars[index];
    },
    get currentIndex() {
      return index;
    },
    cars,
    destroy() {
      root.remove();
    },
  };
}

/**
 * Rotating 3D preview of the selected car. Real geometry, not a picture, so the
 * requirement for a real vehicle preview is met without any external asset.
 */
const NO_PREVIEW = { setCar() {}, render() {}, resize() {}, dispose() {} };

export function createCarPreview(canvas, { quality = 'medium' } = {}) {
  if (!canvas) return NO_PREVIEW;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high', alpha: true });
  } catch {
    // No WebGL: the car selection screen still works completely, it just shows
    // the written description instead of a rotating model. Say so honestly.
    return NO_PREVIEW;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1.6, 0.1, 100);
  camera.position.set(6.4, 2.6, 6.4);
  camera.lookAt(0, 0.7, 0);
  scene.add(new THREE.HemisphereLight(0xcfe4f5, 0x3a3f34, 1.1));
  const key = new THREE.DirectionalLight(0xfff0d8, 1.6);
  key.position.set(5, 8, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4e8, 0.7);
  rim.position.set(-6, 4, -5);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(7, 40),
    new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.85 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  let current = null;
  let angle = 0;

  function setCar(car) {
    if (current) {
      scene.remove(current.group);
      current.dispose();
    }
    current = buildCarMesh(car, { shadows: false, number: 3 });
    scene.add(current.group);
    angle = 0.6;
  }

  function resize() {
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 200;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render(dt = 0.016) {
    if (!current) return;
    angle += dt * 0.35;
    const r = 7.2;
    camera.position.set(Math.cos(angle) * r, 2.7, Math.sin(angle) * r);
    camera.lookAt(0, 0.75, 0);
    resize();
    renderer.render(scene, camera);
  }

  resize();
  return {
    setCar,
    render,
    resize,
    dispose() {
      current?.dispose();
      renderer.dispose();
    },
  };
}

// ---------------------------------------------------------------- settings

/**
 * The Game TalkBack settings screen. Every row announces its name, current
 * value and what changing it does, and every change is confirmed out loud.
 *
 * Turning Game TalkBack off stops game speech but this screen keeps speaking:
 * that is the requirement, and it is why these announcements are `essential`.
 */
export function buildSettingsScreen({ gameState, screens, speech, audio, onSettingsChanged }) {
  const { root } = screenShell('Game TalkBack settings', 'Every change is spoken. Turning guidance off never makes this screen silent.');

  const statusLine = el('p', 'settings-status');
  statusLine.setAttribute('data-zone', 'speechStatus');
  statusLine.setAttribute('data-zone-role', ZONE_ROLE.READER);
  statusLine.textContent = speech?.explainStatus?.() ?? '';
  root.appendChild(statusLine);

  const list = el('div', 'settings-list');
  root.appendChild(list);
  const rows = [];

  const ORDER = [
    'talkback',
    'speechVolume',
    'speechRate',
    'speechPitch',
    'speechVoice',
    'conciseSpeech',
    'navFrequency',
    'warningDistance',
    'speakSpeedLaps',
    'speakPosition',
    'speakOpponents',
    'music',
    'musicVolume',
    'sfx',
    'sfxVolume',
    'haptics',
    'controlSide',
    'cameraShake',
    'textScale',
    'heroName',
  ];

  function valueText(key) {
    const def = SETTINGS_SCHEMA[key];
    return def ? def.announce(gameState.settings[key]) : String(gameState.settings[key]);
  }

  for (const key of ORDER) {
    const def = SETTINGS_SCHEMA[key];
    if (!def) continue;
    const row = el('div', 'settings-row');
    row.setAttribute('data-zone', `setting-${key}`);
    row.setAttribute('data-zone-role', ZONE_ROLE.SETTINGS);

    const label = el('span', 'settings-label', def.label);
    const value = el('span', 'settings-value', valueText(key));
    row.append(label, value);

    const controls = el('div', 'settings-controls');
    const items = [];

    const focusBtn = makeButton({
      label: def.label,
      className: 'ui-button-row',
      hint: valueText(key),
      onActivate: () => toggleOrCycle(key),
      announce: () => settingFocusSentence(key, gameState.settings[key]),
    });
    focusBtn.element.setAttribute('data-announce', settingFocusSentence(key, gameState.settings[key]));
    controls.appendChild(focusBtn.element);
    items.push(focusBtn);

    if (def.type === 'range') {
      const down = makeButton({
        label: `Decrease ${def.label}`,
        className: 'ui-button-small',
        onActivate: () => change(() => stepSetting(gameState.settings, key, -1)),
      });
      const up = makeButton({
        label: `Increase ${def.label}`,
        className: 'ui-button-small',
        onActivate: () => change(() => stepSetting(gameState.settings, key, 1)),
      });
      controls.append(down.element, up.element);
      items.push(down, up);
    } else if (def.type === 'boolean' || def.type === 'enum') {
      const cycle = makeButton({
        label: `Change ${def.label}`,
        className: 'ui-button-small',
        onActivate: () => change(() => cycleSetting(gameState.settings, key, 1)),
      });
      controls.append(cycle.element);
      items.push(cycle);
    } else if (def.type === 'string' && key === 'heroName') {
      const edit = makeButton({
        label: 'Edit hero name',
        className: 'ui-button-small',
        onActivate: () => screens.editHeroName(),
      });
      controls.append(edit.element);
      items.push(edit);
    } else if (def.type === 'string' && key === 'speechVoice') {
      const pick = makeButton({
        label: 'Choose voice',
        className: 'ui-button-small',
        onActivate: () => screens.pickVoice(),
      });
      controls.append(pick.element);
      items.push(pick);
    }

    row.appendChild(controls);
    list.appendChild(row);
    rows.push({ key, row, value, items, def });
  }

  function refreshRow(key) {
    const r = rows.find((x) => x.key === key);
    if (!r) return;
    r.value.textContent = valueText(key);
    r.items[0].element.dataset.announce = settingFocusSentence(key, gameState.settings[key]);
  }

  function refreshAll() {
    for (const r of rows) refreshRow(r.key);
    applyTextScale();
  }

  function change(fn) {
    const result = fn();
    if (!result) {
      speech?.sayEssential('That setting cannot be changed here.');
      return;
    }
    // `result.settings` holds the NEW coerced value. Passing the current one
    // back would silently re-apply the old value and change nothing.
    gameState.setSettingValue(result.key, result.settings[result.key]);
    refreshRow(result.key);
    audio?.play(result.key === 'talkback' ? 'ui-toggle' : 'ui-switch', { group: 'sfx', volume: 0.6 });
    speech?.sayEssential(result.announcement);
    if (result.key === 'talkback' && !gameState.settings.talkback) {
      // Say goodbye through the essential channel, then explain how to return.
      speech?.sayEssential(
        'Game TalkBack is now off. Game announcements have stopped. This settings screen will keep speaking so you are never stuck in silence. Press F1 on a keyboard, or use the Game TalkBack settings button on the menu, to turn it back on.'
      );
    }
    onSettingsChanged?.(result.key, gameState.settings[result.key]);
    bus.emit('settings:applied', { key: result.key, settings: gameState.settings });
  }

  function toggleOrCycle(key) {
    change(() => cycleSetting(gameState.settings, key, 1));
  }

  function applyTextScale() {
    const scale = gameState.settings.textScale ?? 1;
    document.documentElement.style.setProperty('--text-scale', String(scale));
  }

  const footer = el('div', 'settings-footer');
  const closeBtn = makeButton({
    label: 'Close and return',
    hint: 'Returns you to where you were',
    className: 'ui-button-primary',
    onActivate: () => {
      audio?.play('ui-close', { group: 'sfx', volume: 0.6 });
      screens.back();
    },
  });
  const testBtn = makeButton({
    label: 'Test the voice',
    hint: 'Speaks a sample line at your current volume and rate',
    onActivate: () => {
      speech?.queue?.clear?.();
      speech?.sayEssential(
        `This is Game TalkBack. Speech rate is ${valueText('speechRate')}, volume is ${valueText('speechVolume')}, and announcements are set to ${valueText('navFrequency')}. Ahead of you, a right-hand corner in one hundred metres. Brake now.`
      );
    },
  });
  footer.append(testBtn.element, closeBtn.element);
  root.appendChild(footer);

  applyTextScale();

  return {
    id: 'settings',
    title: 'Game TalkBack settings',
    summary: `${ORDER.length} settings. ${gameState.settings.talkback ? 'Spoken guidance is on.' : 'Spoken guidance is OFF, and this screen still speaks.'}`,
    element: root,
    focusItems: [...rows.map((r) => r.items[0]), testBtn, closeBtn],
    refreshAll,
    refreshRow,
    destroy() {
      root.remove();
    },
  };
}

// ---------------------------------------------------------------- tutorial

const TUTORIAL_STEPS = [
  {
    id: 'listen',
    title: 'Listening before driving',
    text: 'Nothing to do here. The car is stationary and the circuit is empty. Read or listen to how each control works, then move on when you are ready. You can repeat any step as many times as you like.',
    require: null,
  },
  {
    id: 'accelerate',
    title: 'Accelerate: press and hold',
    text: 'Press and hold anywhere on the driving surface. The car accelerates only while you hold. Let go and it coasts - it does not stop instantly, because a real car does not.',
    require: 'accelerated',
  },
  {
    id: 'coast',
    title: 'Coast: release',
    text: 'Let go of the surface. Feel the car slow on its own. On a keyboard, W or the up arrow does the same thing and only works while held.',
    require: 'coasted',
  },
  {
    id: 'brake',
    title: 'Brake: double tap',
    text: 'Tap the driving surface twice quickly. That is the brake. It is deliberately different from a single tap so that a stray tap can never brake you, and so that three quick taps cannot start a race.',
    require: 'braked',
  },
  {
    id: 'steer',
    title: 'Steer: drag, gradually',
    text: 'Drag left or right across the driving surface. The wheels turn gradually, never instantly, and the car cannot jump sideways. Full lock needs about a third of the screen width. Let go and the wheels self-centre.',
    require: 'steered',
  },
  {
    id: 'uturn',
    title: 'U-turn: circular drag',
    text: 'Draw a circle on the driving surface to ask for a U-turn. The game only performs one where the track allows it, and it performs it with real steering rather than turning the car around on the spot.',
    require: 'uturned',
  },
  {
    id: 'recovery',
    title: 'Recovery: what happens off track',
    text: 'If you leave the track, the voice tells you which side you left it on and which way to steer back. If you stop, or go too far, the marshals place you back on the racing line facing the right way. You are never left stuck.',
    require: null,
  },
  {
    id: 'settings',
    title: 'Voice settings: two ways in',
    text: 'On the settings area, tap twice and hold the second tap to open Game TalkBack settings. On a keyboard, press F1. There is also always a button on the menu, because one route to the accessibility settings is never enough.',
    require: 'openedSettings',
  },
  {
    id: 'menus',
    title: 'Menus: tap and swipe',
    text: 'In a menu, one tap activates the focused control. Swipe up or down moves between options. Swipe left and right browses cars. Tap three times quickly on the start race control and nothing happens, because that control waits to be sure.',
    require: 'menuNavigated',
  },
  {
    id: 'keyboard',
    title: 'Keyboard and switch equivalents',
    text: keyboardHelpLines().join(' '),
    require: null,
  },
];

export function buildTutorialScreen({ gameState, screens, speech, audio, tutorialHarness }) {
  const { root } = screenShell('Gesture tutorial', 'Learn every control with the car standing still. No race starts until you have done this.');
  let step = 0;
  const done = new Set(gameState.save.tutorialSteps ?? []);

  const progress = el('p', 'tutorial-progress');
  const titleEl = el('h2', 'tutorial-title');
  const textEl = el('p', 'tutorial-text');
  const stateEl = el('p', 'tutorial-state');
  const pad = el('div', 'tutorial-pad');
  pad.setAttribute('data-zone', 'driving');
  pad.setAttribute('data-zone-role', ZONE_ROLE.DRIVING);
  pad.setAttribute('data-hold', 'true');
  pad.setAttribute('data-allow-circle', 'true');
  pad.tabIndex = 0;
  pad.setAttribute('role', 'application');
  pad.setAttribute('aria-label', 'Driving surface for practising gestures. Press and hold to accelerate, double tap to brake, drag to steer, draw a circle for a U-turn.');

  const hotspot = el('div', 'tutorial-hotspot');
  hotspot.setAttribute('data-zone', 'settingsHotspot');
  hotspot.setAttribute('data-zone-role', ZONE_ROLE.SETTINGS_HOTSPOT);
  hotspot.setAttribute('data-double-tap-hold', 'true');
  hotspot.setAttribute('role', 'button');
  hotspot.tabIndex = 0;
  hotspot.textContent = 'Settings gesture area - tap twice and hold to open voice settings';

  const body = el('div', 'tutorial-body');
  body.append(progress, titleEl, textEl, stateEl);
  root.append(body, pad, hotspot);

  const controls = el('div', 'menu-list');
  const repeatBtn = makeButton({ label: 'Repeat this step', onActivate: () => render(true) });
  const prevBtn = makeButton({ label: 'Previous step', onActivate: () => move(-1) });
  const nextBtn = makeButton({ label: 'Next step', onActivate: () => move(1) });
  const practiceBtn = makeButton({
    label: 'Practise on the empty circuit',
    hint: 'No opponents, no timing, unlimited recovery',
    onActivate: () => screens.startRace(PRACTICE_LEVEL),
  });
  const finishBtn = makeButton({
    label: 'Finish the tutorial',
    className: 'ui-button-primary',
    onActivate: () => complete(),
  });
  const backBtn = makeButton({ label: 'Back to menu', onActivate: () => screens.back() });
  controls.append(backBtn.element, prevBtn.element, repeatBtn.element, nextBtn.element, practiceBtn.element, finishBtn.element);
  root.appendChild(controls);

  function render(force = false) {
    const s = TUTORIAL_STEPS[step];
    progress.textContent = `Step ${step + 1} of ${TUTORIAL_STEPS.length}.${done.has(s.id) ? ' Done.' : ''}`;
    titleEl.textContent = s.title;
    textEl.textContent = s.text;
    updateState();
    nextBtn.setDisabled(step >= TUTORIAL_STEPS.length - 1);
    prevBtn.setDisabled(step <= 0);
    pad.setAttribute('aria-label', `${s.title}. ${s.text}`);
    if (force || true) {
      speech?.say(`${s.title}. Step ${step + 1} of ${TUTORIAL_STEPS.length}. ${s.text}`, {
        priority: 3,
        cooldownMs: 0,
        interrupt: true,
      });
    }
  }

  function updateState() {
    const s = TUTORIAL_STEPS[step];
    const report = tutorialHarness?.report?.() ?? {};
    if (!s.require) {
      stateEl.textContent = done.has(s.id) ? 'Step recorded as done.' : 'This step is only reading. Move on when you are ready.';
      markDone(s.id);
      return;
    }
    const satisfied = !!report[s.require];
    stateEl.textContent = satisfied
      ? 'Done. The game saw you do it.'
      : `Waiting for you to do it on the driving surface below. ${s.title}.`;
    if (satisfied) markDone(s.id);
  }

  function markDone(id) {
    if (done.has(id)) return;
    done.add(id);
    audio?.play('voice-correct', { group: 'voice', volume: 0.8 });
    speech?.say('Correct. That step is recorded.', { priority: 3, key: `tut.${id}`, cooldownMs: 0 });
    gameState.save.tutorialSteps = [...done];
    gameState.persist();
    updateState();
  }

  function move(delta) {
    const next = step + delta;
    if (next < 0 || next >= TUTORIAL_STEPS.length) return;
    step = next;
    audio?.play('ui-scroll', { group: 'sfx', volume: 0.5 });
    render();
  }

  function complete() {
    const missing = TUTORIAL_STEPS.filter((s) => s.require && !done.has(s.id));
    if (missing.length) {
      const names = missing.map((m) => m.title).join('; ');
      speech?.say(
        `You have not demonstrated these yet: ${names}. Chapter seven stays locked until the controls are understood, so let us go back to them. You can also practise on the empty circuit first.`,
        { priority: 4, interrupt: true, essential: true }
      );
      const firstMissing = TUTORIAL_STEPS.findIndex((s) => s.id === missing[0].id);
      if (firstMissing >= 0) {
        step = firstMissing;
        render();
      }
      return false;
    }
    gameState.save.tutorialSteps = [...done];
    gameState.save.tutorialComplete = true;
    gameState.save.controlsUnderstood = true;
    gameState.story.setState({ tutorialComplete: true, controlsUnderstood: true });
    gameState.syncStory();
    audio?.play('voice-level-up', { group: 'voice', volume: 0.9 });
    speech?.say('Tutorial complete. The controls are recorded as understood, and chapter seven is now open.', {
      priority: 4,
      interrupt: true,
      essential: true,
    });
    screens.back();
    return true;
  }

  render();
  const timer = setInterval(updateState, 500);

  return {
    id: 'tutorial',
    title: 'Gesture tutorial',
    summary: `${TUTORIAL_STEPS.length} steps, ${done.size} already recorded.`,
    element: root,
    focusItems: [backBtn, prevBtn, repeatBtn, nextBtn, practiceBtn, finishBtn],
    get steps() {
      return TUTORIAL_STEPS;
    },
    get doneCount() {
      return done.size;
    },
    refresh: updateState,
    destroy() {
      clearInterval(timer);
      root.remove();
    },
  };
}

export { TUTORIAL_STEPS };

// ------------------------------------------------------------- level select

export function buildLevelScreen({ gameState, screens }) {
  const { root } = screenShell('Choose a race', 'Difficulty increases gradually. Your first race is deliberately easy.');
  const list = el('div', 'menu-list');
  root.appendChild(list);
  const items = [];
  const save = gameState.save;

  items.push(makeButton({ label: 'Back to menu', onActivate: () => screens.back() }));
  list.appendChild(items[0].element);

  for (const level of LEVELS) {
    const unlocked = level.unlockLevel <= save.level;
    const best = save.bestTimes[`level_${level.id}`];
    const label = `Level ${level.id}. ${level.name}.`;
    const hint = unlocked
      ? `${level.laps} laps. ${level.opponents.length} opponents.${best ? ` Best lap ${formatRaceTime(best)}.` : ' No time recorded yet.'}`
      : `Locked. Reach driver level ${level.unlockLevel}.`;
    const b = makeButton({
      label: unlocked ? label : `${label} Locked.`,
      hint,
      disabled: !unlocked,
      onActivate: () => screens.startRace(level),
    });
    list.appendChild(b.element);
    items.push(b);
  }

  const practice = makeButton({
    label: 'Practice session',
    hint: PRACTICE_LEVEL.brief,
    onActivate: () => screens.startRace(PRACTICE_LEVEL),
  });
  list.appendChild(practice.element);
  items.push(practice);

  return {
    id: 'levels',
    title: 'Choose a race',
    summary: `${LEVELS.filter((l) => l.unlockLevel <= save.level).length} of ${LEVELS.length} levels unlocked.`,
    element: root,
    focusItems: items,
    destroy() {
      root.remove();
    },
  };
}

// ------------------------------------------------------------------ results

export function buildResultsScreen({ gameState, screens, speech, audio, result }) {
  const won = result.position === 1;
  const { root } = screenShell(
    won ? 'You won the race' : `You finished ${ordinalText(result.position)}`,
    `${result.results.length} cars started. ${result.lapsCompleted} of ${result.totalLaps} laps completed.`
  );

  const summary = el('div', 'results-summary');
  summary.setAttribute('data-zone', 'resultsSummary');
  summary.setAttribute('data-zone-role', ZONE_ROLE.READER);
  const p = el('p');
  p.textContent = `You finished in position ${result.position} of ${result.results.length}. Race time ${formatTimeSpoken(result.totalTime)}.${
    result.bestLapTime ? ` Best lap ${formatRaceTime(result.bestLapTime)}.` : ''
  }${result.collisions ? ` Barrier or car contacts: ${result.collisions}.` : ' No contacts.'}`;
  summary.appendChild(p);

  const reward = el('p', 'results-reward');
  reward.textContent = `You earned ${result.rewards?.xp ?? 0} experience and ${result.rewards?.coins ?? 0} coins. Driver level ${gameState.save.level}.`;
  summary.appendChild(reward);

  if (result.leveledUp) {
    const up = el('p', 'results-levelup');
    up.textContent = `Level up. You are now driver level ${result.newLevel}.`;
    summary.appendChild(up);
  }
  if (result.unlocks?.length) {
    const u = el('p', 'results-unlock');
    u.textContent = `New car available in the garage: ${result.unlocks.join(', ')}.`;
    summary.appendChild(u);
  }
  if (result.rewards?.achievements?.length) {
    const a = el('p', 'results-achievements');
    a.textContent = result.rewards.achievements.map((id) => ACHIEVEMENTS[id]?.name ?? id).join('. ');
    summary.appendChild(a);
  }
  root.appendChild(summary);

  const table = el('table', 'results-table');
  table.setAttribute('data-zone', 'resultsTable');
  table.setAttribute('data-zone-role', ZONE_ROLE.READER);
  const caption = el('caption', null, 'Finishing order. These positions come from where each car actually crossed the line.');
  table.appendChild(caption);
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['Pos', 'Driver', 'Laps', 'Time']) hr.appendChild(el('th', null, h));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const r of result.results) {
    const tr = el('tr', r.isPlayer ? 'is-player' : '');
    tr.appendChild(el('td', null, String(r.position)));
    tr.appendChild(el('td', null, r.isPlayer ? `${r.name} (you)` : r.name));
    tr.appendChild(el('td', null, `${r.lapsCompleted}/${result.totalLaps}`));
    tr.appendChild(el('td', null, r.finished ? r.timeText : 'Did not finish'));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  root.appendChild(table);

  const controls = el('div', 'menu-list');
  const items = [];
  const restart = makeButton({
    label: 'Restart this race',
    hint: 'Same level, same car, back on the grid',
    className: 'ui-button-primary',
    onActivate: () => screens.startRace(result.level ?? null, { restart: true }),
  });
  const menu = makeButton({ label: 'Return to menu', hint: 'Your progress is saved', onActivate: () => screens.gotoMenu() });
  const next = makeButton({
    label: 'Next level',
    hint: result.nextLevel ? `${result.nextLevel.name}` : 'Nothing unlocked yet',
    disabled: !result.nextLevel,
    onActivate: () => screens.startRace(result.nextLevel),
  });
  const recap = makeButton({
    label: 'Read the results again',
    onActivate: () =>
      speech?.say(`${p.textContent} ${reward.textContent}`, { priority: 3, essential: true, cooldownMs: 0 }),
  });
  controls.append(menu.element, restart.element, next.element, recap.element);
  root.appendChild(controls);
  items.push(menu, restart, next, recap);

  return {
    id: 'results',
    title: won ? 'Race won' : 'Race results',
    summary: `Position ${result.position} of ${result.results.length}.`,
    element: root,
    focusItems: items,
    onMount() {
      // The result is spoken once on mount, without repeating on Back.
      speech?.say(`${p.textContent} ${reward.textContent}`, { priority: 4, interrupt: true, essential: true, cooldownMs: 0 });
      audio?.play(won ? 'music-achievement' : 'music-three-tone', { group: 'music', volume: 0.7 });
    },
    destroy() {
      root.remove();
    },
  };
}

function ordinalText(n) {
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
  return words[n - 1] ?? `${n}th`;
}

// -------------------------------------------------------------- map + recap

export function buildMapScreen({ screens, speech, track }) {
  const { root } = screenShell('Vettaru International Circuit', 'The map below is the actual playable geometry, not an illustration.');
  const wrap = el('div', 'map-wrap');
  wrap.setAttribute('data-zone', 'map');
  wrap.setAttribute('data-zone-role', ZONE_ROLE.READER);
  const img = document.createElement('img');
  img.src = 'docs/circuit-map.svg';
  img.alt = `Map of the Vettaru International Circuit. ${Math.round(track.geometry.length)} metres per lap, ${track.zones.filter((z) => z.kind === 'corner' || z.kind === 'chicane').length} corners.`;
  img.className = 'map-image';
  wrap.appendChild(img);
  root.appendChild(wrap);

  const text = el('div', 'reader-block');
  const corners = track.zones.filter((z) => z.kind === 'corner' || z.kind === 'chicane');
  const straights = track.zones.filter((z) => z.kind === 'straight');
  text.appendChild(el('p', 'reader-paragraph', `One lap is ${Math.round(track.geometry.length)} metres. The track is ${track.width} metres wide and runs clockwise.`));
  text.appendChild(el('p', 'reader-paragraph', `There are ${corners.length} corners: ${corners.filter((c) => c.direction === 'left').length} left and ${corners.filter((c) => c.direction === 'right').length} right.`));
  text.appendChild(el('p', 'reader-paragraph', `Corners in order: ${cornarsText(corners)}.`));
  text.appendChild(el('p', 'reader-paragraph', `The longest straight is ${Math.round(Math.max(...straights.map((s) => s.span)))} metres.`));
  text.appendChild(el('p', 'reader-paragraph', `The pit lane is ${Math.round(track.pit.length)} metres long with ${track.pit.garages} garages, entering ${Math.round(track.pitEntryS)} metres into the lap and rejoining at ${Math.round(track.pitExitS)} metres. The pit lane limit is 60 kilometres per hour.`));
  root.appendChild(text);

  const back = makeButton({ label: 'Back to menu', className: 'ui-button-primary', onActivate: () => screens.back() });
  const speak = makeButton({
    label: 'Read the corner list aloud',
    onActivate: () => speech?.say(corners.map((c, i) => `${i + 1}. ${c.label}, ${c.direction}, ${c.severity}.`).join(' '), { priority: 3, essential: true, cooldownMs: 0 }),
  });
  const controls = el('div', 'menu-list');
  controls.append(back.element, speak.element);
  root.appendChild(controls);

  return {
    id: 'map',
    title: 'Circuit map',
    summary: `${Math.round(track.geometry.length)} metres per lap.`,
    element: root,
    focusItems: [back, speak],
    destroy() {
      root.remove();
    },
  };
}

function cornersText(corners) {
  return corners.map((c, i) => `${i + 1}. ${c.label} - ${c.direction} hander, ${c.severity}${c.kind === 'chicane' ? ', a chicane' : ''}`).join('. ');
}
function cornarsText(corners) {
  return cornersText(corners);
}

export function buildRecapScreen({ gameState, screens, speech }) {
  const { root } = screenShell('Your story so far', 'Everything here comes from choices you actually made.');
  const save = gameState.save;
  const block = makeReaderBlock('Recap', [
    gameState.story.recap(),
    save.salary ? `You are employed at Kalpesh Motors on ${save.salary} rupees a month, and that figure is used in later chapters.` : 'You are not employed yet.',
    `Joseph: relationship ${save.relationships?.joseph ?? 0}. Mithin: relationship ${save.relationships?.mithin ?? 0}. Your mother: ${save.relationships?.mother ?? 0}. Your father: ${save.relationships?.father ?? 0}. Divya: ${save.relationships?.divya ?? 0}.`,
    save.interviewResult ? `Interview result: ${save.interviewResult.band}, scoring ${save.interviewResult.total} out of ${save.interviewResult.max}.` : 'No interview has been taken yet.',
    save.controlsUnderstood ? 'The driving controls are recorded as understood.' : 'The driving controls are not yet recorded as understood, so chapter seven is locked.',
    save.raceResult ? `Your last race: position ${save.raceResult.position}${save.raceResult.won ? ', a win' : ''}.` : 'You have not raced yet.',
    `Achievements: ${save.achievements?.length ? save.achievements.map((a) => ACHIEVEMENTS[a]?.name ?? a).join(', ') : 'none yet'}.`,
  ]);
  root.appendChild(block.element);

  const speakAll = makeButton({
    label: 'Read the whole recap aloud',
    onActivate: () => speech?.say(block.element.textContent, { priority: 3, essential: true, cooldownMs: 0 }),
  });
  const back = makeButton({ label: 'Back to menu', className: 'ui-button-primary', onActivate: () => screens.back() });
  const controls = el('div', 'menu-list');
  controls.append(back.element, speakAll.element);
  root.appendChild(controls);

  return {
    id: 'recap',
    title: 'Story so far',
    summary: '',
    element: root,
    focusItems: [back, speakAll],
    destroy() {
      root.remove();
    },
  };
}

export function buildAudioStatusScreen({ screens, speech, audio }) {
  const { root } = screenShell('Audio and credits', 'What loaded, what it is licensed as, and what is honestly missing.');
  const status = audio?.status?.() ?? { ok: false, message: 'Audio is not available.' };
  const lines = [
    status.message,
    'Every sound in this game is a real recorded file. Nothing is generated at runtime: there is no oscillator, no synthesised tone, and no AI-generated music anywhere in the audio code.',
    'Sound effects and voice recordings are licensed Creative Commons Zero 1.0, recorded by Kenney Vleugels and published at kenney.nl.',
    'The full-length music is licensed separately, and three of the six tracks require attribution. ' + musicAttributionLines().join(' '),
    'The other three music tracks are by Rafael Krux of CinematicWaves.com, released to the public domain through FreePD, and are credited here as a courtesy.',
    audio?.buffers ? `${audio.buffers.size} recorded assets decoded and ready to play.` : '',
    audio?.failedAssets?.length ? `These assets could not be loaded and are silent rather than replaced: ${audio.failedAssets.map((f) => f.name).join(', ')}.` : '',
    'Engine and tyre audio are recorded loops whose playback rate and gain follow engine rpm and wheel slip. Changing the rate of a recording is not synthesis.',
    'Story dialogue is spoken by the device speech synthesiser. That is synthesised speech and it is described as such; it is not recorded voice acting.',
    'Music is lazy-loaded: the six full-length beds total about 21 megabytes, so each one is downloaded the first time a scene asks for it rather than at boot.',
    'Known gaps, not filled with generated substitutes: crowd cheering, city ambience, family and workplace room tone, pit lane ambience, and a dedicated gear-change recording, for which a recorded metal click is used instead. See docs/AUDIO-CREDITS.md for the full ledger and the per-track licence evidence.',
  ].filter(Boolean);

  const block = makeReaderBlock('Audio ledger', lines);
  root.appendChild(block.element);

  const controls = el('div', 'menu-list');
  const read = makeButton({ label: 'Read this aloud', onActivate: () => speech?.say(lines.join(' '), { priority: 3, essential: true, cooldownMs: 0 }) });
  const retry = makeButton({
    label: 'Try loading audio again',
    hint: 'Useful if a download failed on a slow connection',
    onActivate: async () => {
      const res = await audio?.loadAll?.();
      speech?.sayEssential(res ? `${res.loaded} assets loaded, ${res.failed} failed. ${audio.status().message}` : 'Audio is not available in this browser.');
    },
  });
  const back = makeButton({ label: 'Back to menu', className: 'ui-button-primary', onActivate: () => screens.back() });
  controls.append(back.element, read.element, retry.element);
  root.appendChild(controls);

  return {
    id: 'audio',
    title: 'Audio and credits',
    summary: status.ok ? 'All recorded assets loaded.' : 'Some audio is unavailable.',
    element: root,
    focusItems: [back, read, retry],
    destroy() {
      root.remove();
    },
  };
}

export function buildConfirmScreen({ screens, speech, title, message, confirmLabel, onConfirm }) {
  const { root } = screenShell(title, message);
  const controls = el('div', 'menu-list');
  const yes = makeButton({
    label: confirmLabel,
    className: 'ui-button-danger',
    onActivate: () => {
      onConfirm?.();
      screens.back();
    },
  });
  const no = makeButton({ label: 'Cancel', className: 'ui-button-primary', onActivate: () => screens.back() });
  controls.append(no.element, yes.element);
  root.appendChild(controls);
  return {
    id: 'confirm',
    title,
    summary: message,
    element: root,
    focusItems: [no, yes],
    onMount() {
      speech?.say(message, { priority: 4, essential: true, cooldownMs: 0, interrupt: true });
    },
    destroy() {
      root.remove();
    },
  };
}

export function buildNameScreen({ screens, speech, gameState }) {
  const { root } = screenShell('Your name in the story', 'Other characters will call you this. Letters, spaces, apostrophes and hyphens only, up to 24 characters.');
  const field = el('input', 'ui-input');
  field.type = 'text';
  field.maxLength = 24;
  field.value = gameState.heroName;
  field.setAttribute('aria-label', 'Hero name');
  field.setAttribute('data-zone', 'heroNameField');
  field.setAttribute('data-zone-role', ZONE_ROLE.SETTINGS);
  field.autocomplete = 'off';
  field.spellcheck = false;
  const hint = el('p', 'ui-hint', 'The name is stored only in this browser and is used to speak the story.');
  const saveBtn = makeButton({
    label: 'Save name',
    className: 'ui-button-primary',
    onActivate: () => {
      const res = gameState.setHeroName(field.value);
      speech?.sayEssential(res.ok ? `Your name is now ${res.heroName}. It is used in every chapter.` : res.reason);
      if (res.ok) screens.back();
    },
  });
  const cancel = makeButton({ label: 'Cancel', onActivate: () => screens.back() });
  const controls = el('div', 'menu-list');
  controls.append(cancel.element, saveBtn.element);
  root.append(field, hint, controls);
  setTimeout(() => field.focus(), 60);
  return {
    id: 'name',
    title: 'Hero name',
    summary: '',
    element: root,
    focusItems: [cancel, saveBtn],
    destroy() {
      root.remove();
    },
  };
}

export function buildVoicePickerScreen({ screens, speech, gameState }) {
  const voices = speech?.voices ?? [];
  const { root } = screenShell('Choose a voice', voices.length ? `${voices.length} voices installed on this device.` : 'This device reports no installed voices. The game will still show every announcement as text.');
  const list = el('div', 'menu-list');
  const items = [];
  const useDefault = makeButton({
    label: 'Use the device default voice',
    className: 'ui-button-primary',
    onActivate: () => {
      gameState.setSettingValue('speechVoice', '');
      speech?.sayEssential('Using the device default voice.');
      screens.back();
    },
  });
  list.appendChild(useDefault.element);
  items.push(useDefault);
  voices.slice(0, 40).forEach((v, i) => {
    const b = makeButton({
      label: `${v.name} (${v.lang})`,
      hint: gameState.settings.speechVoice === (v.name || v.uri) ? 'Currently selected' : '',
      onActivate: () => {
        gameState.setSettingValue('speechVoice', v.name || v.uri);
        speech?.sayEssential(`Voice set to ${v.name}. This is how Game TalkBack will sound.`);
        screens.back();
      },
    });
    b.element.setAttribute('data-announce', `${v.name}, language ${v.lang}. Option ${i + 2} of ${Math.min(voices.length, 40) + 1}.`);
    list.appendChild(b.element);
    items.push(b);
  });
  const back = makeButton({ label: 'Cancel', onActivate: () => screens.back() });
  list.appendChild(back.element);
  items.push(back);
  root.appendChild(list);
  return {
    id: 'voicePicker',
    title: 'Choose a voice',
    summary: '',
    element: root,
    focusItems: items,
    destroy() {
      root.remove();
    },
  };
}

export { collectFocusItems, screenShell, el, SCREEN };

// ------------------------------------------------------------------- garage

/**
 * The garage: where the coins earned by racing are spent.
 *
 * Every row states its own price, whether it is owned, and whether it can be
 * afforded, so a player moving through the list hears everything needed to
 * decide without tapping anything. There is no separate confirmation step: a
 * tap buys, and the outcome is spoken either way. A refusal is a normal answer,
 * not an error, and says what would have to change.
 *
 * Buying refreshes the list in place and puts the focus back on the row just
 * used, so a player is never thrown back to the top of the list after a purchase.
 */
export function buildGarageScreen({ gameState, screens, speech, audio, keepId = null }) {
  const view = gameState.garageView();
  const coins = view.coins;
  const coinWord = coins === 1 ? 'coin' : 'coins';
  const { root } = screenShell('Garage', 'Swipe up or down to move between items, then single tap to buy.');

  const block = makeReaderBlock('What is for sale', [
    `You have ${coins} ${coinWord}.`,
    'Coins are won by racing. Cars unlocked here can also still be unlocked for free by reaching the driver level shown in car selection.',
    'Tyres are a real upgrade rather than a label: a better set gives the car more grip, so it holds the line through corners.',
    `A wash costs ${view.wash.cost} coins and removes the grime that laps spent on the grass leave on the paint. It is cosmetic only.`,
  ]);
  root.appendChild(block.element);

  const list = el('div', 'menu-list');
  root.appendChild(list);
  const buttons = [];

  /** Add one purchasable row with its own spoken sentence. */
  function addRow(key, { label, hint, sentence, enabled }) {
    const btn = makeButton({
      label,
      hint,
      disabled: !enabled,
      announce: () => sentence,
      onActivate: () => {
        if (!enabled) return;
        const outcome = gameState.garagePurchase(key);
        audio?.play(outcome.ok ? 'ui-confirm' : 'ui-back', { group: 'sfx', volume: 0.55 });
        speech?.sayEssential(outcome.message);
        // Rebuild so prices, ownership and affordability all reflect the new
        // balance, and keep the focus on the row just used.
        screens.openGarage?.(key);
      },
    });
    buttons.push({ key, btn });
    return btn.element;
  }

  function sectionTitle(text) {
    const h = el('h3', 'menu-section', text);
    return h;
  }

  // --- cars ---
  if (view.cars.length) {
    list.appendChild(sectionTitle('Cars'));
    for (const car of view.cars) {
      const price = car.cost;
      let sentence;
      let hint;
      if (car.owned) {
        sentence = `${car.name}. Already in your garage. ${car.description}`;
        hint = 'Already yours. Choose it in car selection.';
      } else if (price === null) {
        sentence = `${car.name}. Not for sale. Unlock it by reaching driver level ${car.unlockLevel}.`;
        hint = `Unlocks at level ${car.unlockLevel}`;
      } else {
        sentence = `${car.name}. ${price} coins. ${car.description} ${
          car.affordable ? `Single tap to buy. You have ${coins} ${coinWord}.` : `You have ${coins} ${coinWord}, so you cannot afford this yet.`
        }`;
        hint = car.affordable ? `Buy for ${price} coins` : `Costs ${price} coins`;
      }
      list.appendChild(addRow(car.id, { label: car.owned ? `${car.name} - owned` : `${car.name} - ${price === null ? 'locked' : `${price} coins`}`, hint, sentence, enabled: car.purchasable }));
    }
  }

  // --- tyres ---
  if (view.tyres.length) {
    list.appendChild(sectionTitle('Tyres'));
    const fitted = tyreTier(gameState.save.tyreTier);
    for (const tyre of view.tyres) {
      const better = tyre.tier < fitted.tier;
      const sentence = tyre.owned
        ? better
          ? `${tyre.name}. You already have ${fitted.label}, which is better, so this is not for sale to you.`
          : `${tyre.name}. Already fitted. ${tyre.description}.`
        : `${tyre.name}. ${tyre.cost} coins. That is ${tyre.description}. ${
            tyre.affordable ? `Single tap to fit them. You have ${coins} ${coinWord}.` : `You have ${coins} ${coinWord}, so you cannot afford this yet.`
          }`;
      list.appendChild(
        addRow(tyre.id, {
          label: tyre.owned ? `${tyre.name} - ${better ? 'outclassed' : 'fitted'}` : `${tyre.name} - ${tyre.cost} coins`,
          hint: tyre.owned ? (better ? `You have ${fitted.label}` : 'Already fitted') : `Fit for ${tyre.cost} coins`,
          sentence,
          enabled: tyre.purchasable,
        }),
      );
    }
  }

  // --- wash ---
  list.appendChild(sectionTitle('Appearance'));
  const wash = view.wash;
  list.appendChild(
    addRow('wash', {
      label: wash.purchasable ? `Wash and polish - ${wash.cost} coins` : 'Wash and polish - car is clean',
      hint: wash.purchasable ? `Cleans the car for ${wash.cost} coins` : 'Nothing to clean',
      sentence: wash.purchasable
        ? `Wash and polish. ${wash.cost} coins. The car is dirty; this cleans it and brings the paint back. ${
            wash.affordable ? `Single tap to buy. You have ${coins} ${coinWord}.` : `You have ${coins} ${coinWord}, so you cannot afford this yet.`
          }`
        : `Wash and polish. The car is already clean, so there is nothing to buy. You have ${coins} ${coinWord}.`,
      enabled: wash.purchasable,
    }),
  );

  const back = makeButton({ label: 'Back to menu', className: 'ui-button-primary', onActivate: () => screens.back() });
  list.appendChild(back.element);
  buttons.push({ key: null, btn: back });

  const focusItems = buttons.map((b) => b.btn);
  // Where the focus starts: the row just bought if there is one, otherwise the
  // first thing that can actually be bought.
  const keptIndex = keepId ? buttons.findIndex((b) => b.key === keepId) : -1;
  const firstBuyable = buttons.findIndex((b) => !b.btn.element.disabled);
  const startIndex = keptIndex >= 0 ? keptIndex : firstBuyable >= 0 ? firstBuyable : 0;
  focusItems.forEach((b, i) => {
    b.focused = i === startIndex;
  });

  return {
    id: 'garage',
    title: 'Garage',
    summary: `${coins} ${coinWord} to spend.`,
    element: root,
    focusItems,
    onMount(ring) {
      if (startIndex > 0) ring.focusAt(startIndex, { silent: true });
    },
    destroy() {
      root.remove();
    },
  };
}
