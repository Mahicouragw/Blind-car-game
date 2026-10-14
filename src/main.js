/**
 * Application bootstrap.
 *
 * Wires the pure modules (story, race, physics, settings, gestures) to the
 * browser adapters (WebGL, Web Audio, Web Speech, DOM) and owns the screen
 * controller. Everything the player can reach goes through `screens`.
 *
 * @module main
 */

import { bus } from './core/bus.js';
import { createMusicDirector } from './core/musicDirector.js';
import { createGameState, SCREEN } from './core/gameState.js';
import { createAudio } from './core/audio.js';
import { createSpeech } from './a11y/speech.js';
import { SPEECH_PRIORITY } from './a11y/speechQueue.js';
import { attachKeyboard } from './input/keyboard.js';
import { createPointerBus } from './input/pointerBus.js';
import { createDrivingInput, DRIVING_ZONE, DRIVING_ROLE } from './input/drivingInput.js';
import { createRaceScreen } from './race/raceScreen.js';
import { dirtLevel } from './race/garage.js';
import { webglAvailable } from './world/scene3d.js';
import { getTrack } from './world/trackData.js';
import { getCar } from './vehicles/carCatalog.js';
import { getLevel, LEVELS, PRACTICE_LEVEL, nextLevel } from './race/levels.js';
import { createScreenManager, createFocusRing, makeButton, ZONE_ROLE } from './ui/screens.js';
import {
  buildAudioStatusScreen,
  buildCarSelectScreen,
  buildChapterScreen,
  buildConfirmScreen,
  buildExitScreen,
  buildGarageScreen,
  buildLevelScreen,
  buildMapScreen,
  buildMenuScreen,
  buildNameScreen,
  buildRecapScreen,
  buildResultsScreen,
  buildSettingsScreen,
  buildTutorialScreen,
  buildVoicePickerScreen,
  createCarPreview,
} from './ui/menuScreens.js';
import { buildStoryScreen } from './ui/storyScreen.js';

const FIRST_RUN_KEY = 'vettaru.firstrun.v1';

export function bootApp(config = {}) {
  const canvas = config.canvas ?? document.getElementById('scene');
  const host = config.host ?? document.getElementById('screen-host');
  const overlay = config.overlay ?? document.getElementById('race-overlay');
  const liveRegion = config.liveRegion ?? document.getElementById('live-region');
  const gestureLayer = config.gestureLayer ?? document.getElementById('gesture-layer');

  // ------------------------------------------------------------- subsystems
  const gameState = createGameState({ storage: config.storage });
  const speech = createSpeech({
    getSettings: () => gameState.settings,
    onDuck: () => audio.duck(),
    onUnduck: () => audio.unduck(),
  });
  speech.attach(liveRegion);
  speech.setEnabled(gameState.settings.talkback !== false);

  const audio = createAudio({ getSettings: () => gameState.settings });
  const track = getTrack();

  // Music follows the scene rather than being started by each screen, so the six
  // full-length beds are mapped in one place and two screens cannot fight over
  // the same channel. The race screen is not a bus screen, so it is driven
  // explicitly from beginRace below.
  const musicDirector = createMusicDirector({
    audio,
    events: bus,
    getSettings: () => gameState.settings,
  });

  const drivingInput = createDrivingInput({ keyboard: null });
  const keyboard = attachKeyboard(typeof window !== 'undefined' ? window : null, {
    allowInField: (e) => {
      const t = e.target;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    },
  });

  // Tutorial harness: records which gestures the player has actually performed,
  // so "controls understood" is earned rather than assumed.
  const tutorialHarness = createTutorialHarness();

  // ----------------------------------------------------------- zone defaults
  let defaultZone = { id: 'background', role: ZONE_ROLE.READER, immediateTap: false, allowSwipe: false };
  const screens = createScreenManager({
    host,
    speech,
    audio,
    get defaultZone() {
      return defaultZone;
    },
  });

  let focusRing = null;
  let pauseRing = null;
  let raceScreen = null;
  let carPreview = null;
  let previewRaf = null;
  let storyReturnChapter = null;
  let lastRaceLevel = null;

  // ---------------------------------------------------------------- pointers
  const pointerBus = createPointerBus({
    element: gestureLayer,
    zoneAt: (x, y) => {
      if (raceScreen && !raceScreen.state.paused) {
        // While racing the whole layer is the driving surface. HUD controls sit
        // ABOVE this layer in CSS and receive native pointer events, so they
        // never reach the recognizer and can never be mistaken for a gesture.
        return DRIVING_ZONE;
      }
      if (raceScreen && raceScreen.state.paused) {
        const zone = screens.zoneAt(x, y);
        return zone ?? { id: 'pauseBackground', role: ZONE_ROLE.MENU, immediateTap: true };
      }
      const zone = screens.zoneAt(x, y);
      if (zone) return zone;
      return defaultZone;
    },
  }).attach();

  // DRIVING_ZONE is imported from drivingInput rather than redeclared here: the
  // handlers that decide whether a gesture is a driving gesture, and the zone
  // that says "this is the driving surface", have to agree, and keeping a second
  // copy of this object is how they stopped agreeing once already.
  //
  // This file compares gesture zones against ZONE_ROLE.DRIVING (from ui/screens)
  // while drivingInput compares against DRIVING_ROLE. Two spellings of one
  // contract, so check them at boot: if they drift, every driving gesture is
  // silently ignored and the game becomes unplayable by touch while the test
  // suite stays green.
  if (ZONE_ROLE.DRIVING !== DRIVING_ROLE) {
    throw new Error(
      `Driving zone role mismatch: ui/screens says "${ZONE_ROLE.DRIVING}", input/drivingInput says "${DRIVING_ROLE}". ` +
        'Driving gestures would be ignored. Make them the same string.',
    );
  }

  // --------------------------------------------------- press feedback (every button)
  //
  // The brief asks for a sound effect for every action and for the game to talk
  // back the button that was actually pressed - "exit game, main menu, settings
  // like that, where I am to press that button" - and only that: the current
  // present announcement, never a queue of old ones.
  //
  // ONE delegated listener covers every button in the game (menus, settings
  // rows, the pause panel, the HUD) however it was pressed: tap, click or
  // Enter. It runs in the capture phase so the label is spoken BEFORE the
  // button's own action speaks; whatever the action then says supersedes it,
  // which is exactly the "only the present" rule.
  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target?.closest?.('button');
      if (!btn || btn.disabled) return;
      const label = (
        btn.querySelector('.ui-button-label')?.textContent ||
        btn.dataset.announceLabel ||
        btn.textContent ||
        ''
      )
        .trim()
        .slice(0, 80);
      if (!label) return;
      bus.emit('ui:press', { label });
    },
    true,
  );

  bus.on('ui:press', ({ label } = {}) => {
    if (!label) return;
    audio.play('ui-click', { group: 'sfx', volume: 0.5 });
    const line = /[.!?]$/.test(label) ? label : `${label}.`;
    // Essential: pressing a button is the accessibility surface itself, so the
    // label is spoken even with game chatter off - a blind player must always
    // hear where they just pressed. Shared key: pressing quickly speaks only
    // the latest press.
    speech.say(line, {
      priority: SPEECH_PRIORITY.HIGH,
      essential: true,
      key: 'uiPress',
      cooldownMs: 250,
      ttlMs: 2500,
      interrupt: true,
    });
  });

  // ------------------------------------------------------------ gesture map
  //
  // The focus ring that gestures and keys should drive right now:
  // - racing: nothing (the pause panel is its own ring, and the menu behind the
  //   race MUST NOT be reachable - it used to announce menu options mid-race);
  // - paused: the pause panel's ring;
  // - otherwise: the mounted screen's ring.
  function activeRing() {
    if (raceScreen) return raceScreen.state.paused ? pauseRing : null;
    return focusRing;
  }

  bus.on('gesture:tap', (d) => {
    unlockAudio();
    if (d.zone?.element) {
      d.zone.element.click();
      return;
    }
    if (raceScreen) {
      // A tap outside the pause panel while paused activates the focused pause
      // option - the same "single tap activates" rule every menu follows.
      if (raceScreen.state.paused) pauseRing?.activate();
      return;
    }
    focusRing?.activate();
  });

  bus.on('gesture:tripleTap', (d) => {
    // Requirement 12: three quick taps must never start a race. The Start Race
    // control is a non-immediate zone, so three taps produce this event and
    // zero activations. We say so rather than staying silent.
    if (d.zone?.role === ZONE_ROLE.MENU) {
      speech.say('Three quick taps do nothing on purpose, so a race can never start by accident. Use a single tap to activate.', {
        priority: SPEECH_PRIORITY.HIGH,
        key: 'tripleExplained',
        cooldownMs: 4000,
      });
    }
  });

  bus.on('gesture:swipe', (d) => {
    unlockAudio();
    const zone = d.zone;
    if (zone?.role === ZONE_ROLE.CAR_BROWSER) {
      const screen = screens.current;
      if (screen?.browse) {
        screen.browse(d.direction === 'left' ? -1 : 1);
        tutorialHarness.record('menuNavigated');
      }
      return;
    }
    const ring = activeRing();
    if (!ring) return;
    if (d.direction === 'up') ring.move(-1);
    else if (d.direction === 'down') ring.move(1);
    else if (d.direction === 'left') ring.move(-1);
    else if (d.direction === 'right') ring.move(1);
    tutorialHarness.record('menuNavigated');
  });

  bus.on('gesture:doubleTapHold', (d) => {
    unlockAudio();
    // The documented way into Game TalkBack settings from anywhere, and the
    // accessible alternative is F1 (see input/keyboard.js). Mid-race it pauses
    // first: opening a settings screen over a running race would leave the car
    // driving itself while the player is reading.
    if (raceScreen && !raceScreen.state.paused) {
      pauseRace();
      return;
    }
    if (d.zone?.doubleTapHoldTarget || d.zone?.role === ZONE_ROLE.SETTINGS_HOTSPOT || d.zone?.role === ZONE_ROLE.DRIVING) {
      screens.openSettings();
      tutorialHarness.record('openedSettings');
      return;
    }
    if (!raceScreen || raceScreen.state.paused) {
      screens.openSettings();
      tutorialHarness.record('openedSettings');
    }
  });

  // The recognizer emits longPressStart/longPressEnd; `longPress` on its own was
  // never a thing, so this alternative route into the voice settings was dead and
  // only the double-tap-and-hold worked.
  bus.on('gesture:longPressStart', (d) => {
    if (d.zone?.role === ZONE_ROLE.SETTINGS_HOTSPOT) {
      screens.openSettings();
      tutorialHarness.record('openedSettings');
    }
  });

  bus.on('gesture:circle', () => tutorialHarness.record('uturned'));
  bus.on('gesture:pressStart', () => tutorialHarness.record('accelerated'));
  bus.on('gesture:pressEnd', () => tutorialHarness.record('coasted'));
  bus.on('gesture:tap', (d) => {
    // A single tap on the driving surface is the brake (the brief's mapping).
    if (d.zone?.role === ZONE_ROLE.DRIVING) tutorialHarness.record('braked');
  });
  bus.on('gesture:doubleTap', (d) => {
    // Two quick taps pull the handbrake.
    if (d.zone?.role === ZONE_ROLE.DRIVING) tutorialHarness.record('handbraked');
  });
  bus.on('gesture:dragEnd', (d) => {
    // `dragEnd` carries `dx`, not `totalDx`. Reading a field that does not exist
    // made this always false, so the tutorial never recorded "steered" and
    // chapter seven stayed locked no matter how well the player drove.
    if (d.zone?.role === ZONE_ROLE.DRIVING && Math.abs(d.dx ?? 0) > 24) tutorialHarness.record('steered');
  });

  // ---------------------------------------------------------- keyboard map
  bus.on('key:activate', () => activeRing()?.activate());
  bus.on('key:nextFocus', () => activeRing()?.move(1));
  bus.on('key:back', () => {
    if (raceScreen) {
      // Escape is the "get me out of here" key: it pauses while racing, and
      // while paused it goes back to driving. It used to dead-end: pauseRace()
      // early-returns when already paused, so Escape did nothing at all.
      if (raceScreen.state.paused) resumeRace();
      else pauseRace();
      return;
    }
    screens.back();
  });
  bus.on('key:repeatLastAnnouncement', () => speech.repeat());
  bus.on('key:openVoiceSettings', () => screens.openSettings());
  bus.on('key:toggleMuteGuidance', () => {
    const on = !gameState.settings.talkback;
    gameState.setSettingValue('talkback', on);
    speech.sayEssential(on ? 'Game TalkBack is on.' : 'Game TalkBack is off. This settings screen keeps speaking. Press F1 to turn it back on.');
  });
  bus.on('key:pause', () => (raceScreen ? pauseRace() : null));

  function unlockAudio() {
    if (gameState.session.audioUnlocked) return;
    gameState.session.audioUnlocked = true;
    audio.unlock().then(async (ok) => {
      if (!ok) {
        speech.sayEssential(audio.status().message);
        return;
      }
      const res = await audio.loadAll();
      const status = audio.status();
      if (!status.ok) speech.sayEssential(status.message);
      void res;
    });
  }

  // ------------------------------------------------------------- screen API
  // NOTE: spreading `screens` would copy its `current` GETTER as a frozen
  // value (null at construction time), so the live properties are re-declared.
  /**
   * End the previous screen's narration before building the next one.
   *
   * A screen speaks as it is built, so this has to happen BEFORE the builder runs
   * or it would throw away the new screen's own opening lines. Without it, a
   * story passage still queued when the player moved on kept playing over the
   * next screen - the game announcing the previous thing while you are already
   * doing the next one.
   */
  function endPreviousSpeech() {
    speech?.stop?.();
  }

  const screensApi = {
    get current() {
      return screens.current;
    },
    get zoneMap() {
      return screens.zoneMap;
    },
    zoneAt: (x, y) => screens.zoneAt(x, y),
    mount: (...args) => screens.mount(...args),
    remeasure: () => screens.remeasure(),
    clearStack: () => screens.clearStack(),
    gotoMenu() {
      endPreviousSpeech();
      stopPreview();
      screens.clearStack();
      mountMenu();
    },
    back() {
      const prev = screens.back();
      if (!prev) mountMenu();
      else rebuildFocus(prev);
      return prev;
    },
    openStory(chapterId) {
      endPreviousSpeech();
      stopPreview();
      storyReturnChapter = chapterId;
      const screen = buildStoryScreen({ gameState, screens: screensApi, speech, audio, chapterId });
      mount(screen);
      return screen;
    },
    openChapterList() {
      endPreviousSpeech();
      stopPreview();
      mount(buildChapterScreen({ gameState, screens: screensApi }));
    },
    openGarage(keepId) {
      endPreviousSpeech();
      const screen = buildGarageScreen({ gameState, screens: screensApi, speech, audio, keepId });
      // The first open stacks on top of wherever the player came from, so Back
      // returns there. A rebuild after a purchase REPLACES the previous garage
      // instead, so the stack does not grow one layer per coin spent.
      mount(screen, keepId ? { replace: true, silent: true } : {});
      return screen;
    },
    openCarSelect() {
      endPreviousSpeech();
      const screen = buildCarSelectScreen({ gameState, screens: screensApi, speech, audio });
      mount(screen);
      startPreview(screen);
      return screen;
    },
    openSettings() {
      endPreviousSpeech();
      const screen = buildSettingsScreen({
        gameState,
        screens: screensApi,
        speech,
        audio,
        onSettingsChanged: (key, value) => {
          if (key === 'speechRate' || key === 'speechVolume' || key === 'speechPitch') audio.setVolumes();
          if (key === 'textScale') document.documentElement.style.setProperty('--text-scale', String(value));
          if (key === 'talkback') {
            speech.setEnabled(value !== false);
            bus.emit('speech:talkback', { on: !!value });
          }
        },
      });
      mount(screen);
      return screen;
    },
    openTutorial(opts = {}) {
      endPreviousSpeech();
      const screen = buildTutorialScreen({ gameState, screens: screensApi, speech, audio, tutorialHarness });
      mount(screen);
      if (opts.returnToStory) storyReturnChapter = storyReturnChapter;
      return screen;
    },
    openLevelSelect() {
      endPreviousSpeech();
      stopPreview();
      mount(buildLevelScreen({ gameState, screens: screensApi }));
    },
    openMap() {
      endPreviousSpeech();
      stopPreview();
      mount(buildMapScreen({ screens: screensApi, speech, track }));
    },
    openRecap() {
      endPreviousSpeech();
      stopPreview();
      mount(buildRecapScreen({ gameState, screens: screensApi, speech }));
    },
    openAudioStatus() {
      endPreviousSpeech();
      stopPreview();
      mount(buildAudioStatusScreen({ screens: screensApi, speech, audio }));
    },
    openExit() {
      endPreviousSpeech();
      stopPreview();
      mount(buildExitScreen({ gameState, screens: screensApi, speech, audio }));
    },
    editHeroName() {
      mount(buildNameScreen({ screens: screensApi, speech, gameState }));
    },
    pickVoice() {
      mount(buildVoicePickerScreen({ screens: screensApi, speech, gameState }));
    },
    confirmReset() {
      mount(
        buildConfirmScreen({
          screens: screensApi,
          speech,
          title: 'Reset all progress',
          message:
            'This erases your story chapters, your driver level, your coins, your selected car and your accessibility settings, and it cannot be undone. Are you sure?',
          confirmLabel: 'Yes, erase everything',
          onConfirm: () => {
            gameState.reset();
            tutorialHarness.reset();
            speech.sayEssential('All progress erased. A new game has started.');
            screensApi.gotoMenu();
          },
        })
      );
    },

    /** Start a race from the menu or level select. */
    startRace(level, opts = {}) {
      const lvl = level ?? lastRaceLevel ?? getLevel(gameState.nextLevelId());
      if (opts.restart) lastRaceLevel = lvl;
      else lastRaceLevel = lvl;
      beginRace(lvl);
    },

    /** Chapter 7 hands off to the real race. */
    startRaceFromStory(chapterId) {
      storyReturnChapter = chapterId;
      if (!gameState.save.controlsUnderstood) {
        speech.sayCritical(
          'Chapter seven needs the controls to be understood first, and the tutorial is not complete yet. Let us go back to the lesson. Nothing is lost; your story progress is saved.'
        );
        gameState.syncStory();
        screensApi.openTutorial();
        return;
      }
      beginRace(getLevel(1), { fromStory: true, chapterId });
    },
  };

  // ------------------------------------------------------------- race flow
  function beginRace(level, opts = {}) {
    // If WebGL is unavailable the race cannot be rendered, and the honest thing
    // is to say so rather than to show a black screen or pretend it started.
    if (!webglAvailable()) {
      speech.sayCritical(
        'This browser cannot create a WebGL context, so the 3D race cannot be drawn. The story, the settings, the gesture tutorial and your saved progress all still work. To race, open the game in Chrome on Android or in a current desktop browser with hardware acceleration enabled.'
      );
      screensApi.openAudioStatus();
      return;
    }
    stopPreview();
    musicDirector.playTrack('music-race');
    const car = gameState.car;
    host.hidden = true;
    canvas.hidden = false;
    overlay.hidden = false;
    gestureLayer.classList.add('is-driving');

    defaultZone = DRIVING_ZONE;
    raceScreen = createRaceScreen({
      canvas,
      overlay,
      track,
      level,
      playerCar: car,
      gameState,
      speech,
      audio,
      drivingInput,
      getCar,
      quality: pickQuality(),
      onFinish: (result) => endRace(result, level, opts),
      onAbort: () => abortRace(level, opts),
    });
    raceScreen.hud.pauseButton.addEventListener('click', () => pauseRace());
    raceScreen.start();
    bus.emit('race:start', { levelId: level.id, carId: car.id });
  }

  function pickQuality() {
    // Mobile-first: default to medium, drop to low on small or slow devices.
    const cores = navigator.hardwareConcurrency ?? 4;
    const small = Math.min(window.innerWidth, window.innerHeight) < 480;
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    if ((coarse && small) || cores <= 4) return 'low';
    if (cores >= 8) return 'high';
    return 'medium';
  }

  function pauseRace() {
    if (!raceScreen || raceScreen.state.paused) return;
    raceScreen.pause();
    audio.play('ui-pause', { group: 'sfx', volume: 0.6 });
    const panel = document.createElement('div');
    panel.className = 'pause-panel';
    panel.id = 'pause-panel';
    panel.innerHTML = '<h2 class="pause-title">Paused</h2>';
    // Every pause option is a real, announced, focus-ring-navigable button.
    // Swiping up or down moves between them exactly like in the menus - the
    // pause panel used to be tap-only, which is not usable without sight.
    const buttons = [
      makeButton({
        label: 'Resume the race',
        hint: 'Back to driving',
        className: 'ui-button-primary',
        onActivate: () => resumeRace(),
      }),
      makeButton({
        label: 'Where am I on the track',
        hint: 'Lap, position and race time',
        onActivate: () => {
          const facts = raceScreen.state;
          void facts;
          speech.sayEssential(describeRacePosition(), { key: 'whereAmI', cooldownMs: 0 });
        },
      }),
      makeButton({ label: 'Game TalkBack settings', hint: 'Speech and announcement settings', onActivate: () => screensApi.openSettings() }),
      makeButton({ label: 'Repeat the controls', hint: 'Every driving control, spoken again', onActivate: () => speech.sayEssential(controlsSummary(), { key: 'controls', cooldownMs: 0 }) }),
      makeButton({
        label: 'Main menu',
        hint: 'Abandons the race and returns to the menu',
        className: 'ui-button-danger',
        onActivate: () => {
          panel.remove();
          pauseRing = null;
          raceScreen.abort('player');
        },
      }),
      makeButton({
        label: 'Exit game',
        hint: 'Says goodbye and closes the session',
        onActivate: () => {
          panel.remove();
          pauseRing = null;
          raceScreen.abort('player');
          screensApi.openExit();
        },
      }),
    ];
    for (const b of buttons) panel.appendChild(b.element);
    overlay.appendChild(panel);
    screens.remeasure();
    pauseRing = createFocusRing(buttons, { speech, audio });
    const first = buttons[0].label;
    speech.say(
      `Paused. ${buttons.length} options. ${first} is first. Swipe up or down to move between them, single tap to activate.`,
      { priority: 4, essential: true, interrupt: true }
    );
    panel.querySelector('button')?.focus();
  }

  /** Leave the pause panel and go back to driving. */
  function resumeRace() {
    if (!raceScreen || !raceScreen.state.paused) return;
    document.getElementById('pause-panel')?.remove();
    pauseRing = null;
    raceScreen.resume();
    audio.play('ui-resume', { group: 'sfx', volume: 0.6 });
    speech.say('Resumed.', { priority: 4, essential: true, interrupt: true });
  }

  function describeRacePosition() {
    if (!raceScreen) return 'There is no race running.';
    const race = raceScreen.race;
    const p = race.player;
    return `You are on lap ${Math.min(p.lap, race.totalLaps)} of ${race.totalLaps}, in position ${p.position} of ${race.racers.length}. Race time so far ${Math.round(race.elapsed)} seconds.`;
  }

  function controlsSummary() {
    return 'Press and hold to accelerate, release to coast. Tap the driving surface once to brake. Tap twice quickly for the handbrake, which makes the car slide. Drag left or right to steer gradually. Draw a circle to ask for a U-turn where the track allows it. Press R or use the recovery option to be placed back on the racing line. Press Escape or P to pause.';
  }

  function endRace(result, level, opts) {
    const enriched = gameState.recordRaceResult({
      position: result.position,
      fieldSize: result.fieldSize,
      lapsCompleted: result.lapsCompleted,
      totalLaps: result.totalLaps,
      cleanLaps: result.cleanLaps,
      grime: result.grime,
      bestLapTime: result.bestLapTime,
      totalTime: result.totalTime,
      levelId: level.id,
      finished: result.finished,
    });

    destroyRace();

    if (opts.fromStory) {
      // Feed the genuine result back into the story graph.
      gameState.story.setState({
        raceResult: {
          position: result.position,
          fieldSize: result.fieldSize,
          lapsCompleted: result.lapsCompleted,
          won: result.position === 1,
          timeSeconds: result.totalTime,
        },
      });
      gameState.syncStory();
      gameState.story.goto('ch7_result');
      host.hidden = false;
      canvas.hidden = true;
      overlay.hidden = true;
      gestureLayer.classList.remove('is-driving');
      defaultZone = { id: 'background', role: ZONE_ROLE.READER, immediateTap: false, allowSwipe: false };
      const screen = buildStoryScreen({ gameState, screens: screensApi, speech, audio, chapterId: opts.chapterId ?? 7 });
      mount(screen, { silent: true });
      screen.focusButtons?.length;
      return;
    }

    const screen = buildResultsScreen({
      gameState,
      screens: screensApi,
      speech,
      audio,
      result: { ...result, ...enriched, level, nextLevel: nextLevel(level.id) },
    });
    host.hidden = false;
    canvas.hidden = true;
    overlay.hidden = true;
    gestureLayer.classList.remove('is-driving');
    defaultZone = { id: 'background', role: ZONE_ROLE.READER, immediateTap: false, allowSwipe: false };
    mount(screen);
  }

  function abortRace(level, opts) {
    destroyRace();
    host.hidden = false;
    canvas.hidden = true;
    overlay.hidden = true;
    gestureLayer.classList.remove('is-driving');
    defaultZone = { id: 'background', role: ZONE_ROLE.READER, immediateTap: false, allowSwipe: false };
    if (opts?.fromStory) {
      // Fair recovery: an abandoned race is recorded as not finished, and the
      // story offers to run it again rather than pretending it happened.
      gameState.story.goto('ch7_result_none');
      const screen = buildStoryScreen({ gameState, screens: screensApi, speech, audio, chapterId: opts.chapterId ?? 7 });
      mount(screen, { silent: true });
      return;
    }
    speech.say(
      `Race abandoned after ${Math.round(level.laps)} laps were scheduled. Nothing is recorded as finished. You can start it again whenever you like.`,
      { priority: 4, essential: true, interrupt: true }
    );
    void level;
    screensApi.gotoMenu();
  }

  function destroyRace() {
    if (!raceScreen) return;
    raceScreen.destroy();
    raceScreen = null;
    drivingInput.reset();
  }

  // ------------------------------------------------------------- preview 3D
  function startPreview(screen) {
    const previewCanvas = screen?.previewCanvas;
    if (!previewCanvas) return;
    // Check for a WebGL context BEFORE handing the canvas to three.js. Without
    // this guard a browser that cannot create a context throws from inside the
    // renderer, which took the whole car selection screen down: the screen is
    // usable without a picture, and says so.
    if (!webglAvailable()) {
      screen.reportNoPreview?.();
      return;
    }
    carPreview = createCarPreview(previewCanvas, { quality: 'low' });
    const dirt = dirtLevel(gameState.save);
    carPreview.setCar(getCar(screen.currentCar?.id ?? gameState.save.carId), { dirt });
    const onIndex = ({ carId }) => carPreview?.setCar(getCar(carId), { dirt: dirtLevel(gameState.save) });
    bus.on('carSelect:index', onIndex);
    screen._offPreview = () => bus.off('carSelect:index', onIndex);
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      carPreview?.render(dt);
      previewRaf = requestAnimationFrame(tick);
    };
    previewRaf = requestAnimationFrame(tick);
  }

  function stopPreview() {
    if (previewRaf) cancelAnimationFrame(previewRaf);
    previewRaf = null;
    carPreview?.dispose();
    carPreview = null;
  }

  // ----------------------------------------------------------------- mount
  function mount(screen, opts = {}) {
    screens.mount(screen, opts);
    rebuildFocus(screen);
    screen.onMount?.(focusRing);
    return screen;
  }

  function rebuildFocus(screen) {
    const items = screen.focusItems ?? screen.focusButtons ?? [];
    focusRing = createFocusRing(items, { speech, audio });
    screen.focusRing = focusRing;
    screens.remeasure();
  }

  function mountMenu() {
    const screen = buildMenuScreen({ gameState, screens: screensApi, speech, audio });
    // Replace rather than stack: the menu is the root, so whatever was mounted
    // before (including a tutorial screen and its polling timer) is destroyed.
    screens.clearStack();
    mount(screen, { replace: true });
  }

  // ------------------------------------------------------------ first run
  /**
   * The spoken welcome, including every gesture and both routes into the voice
   * settings. Requirement: a player must never have to discover the controls by
   * swiping around, so this runs before any race can be started.
   */
  function firstRunAnnouncement() {
    let seen = false;
    try {
      seen = localStorage.getItem(FIRST_RUN_KEY) === '1';
      localStorage.setItem(FIRST_RUN_KEY, '1');
    } catch {
      seen = false;
    }
    const lines = [
      'Welcome to Vettaru, The Blind Driver.',
      'This game has its own spoken guidance called Game TalkBack. It does not need TalkBack or any screen reader on your phone to be switched on.',
      speech.explainStatus(),
      'Controls. Press and hold anywhere on the driving surface to accelerate, and release to coast. Tap once to brake. Tap twice quickly for the handbrake, which makes the car slide. Drag left or right to steer, and the steering is gradual, never instant. Draw a circle to ask for a U-turn, which the game only performs where the track allows it.',
      'In menus, a single tap activates the focused control, and swiping up or down moves between options. Swipe left and right to browse cars.',
      'Tap twice and hold on the settings area, or press F1 on a keyboard, to open the voice settings at any time. There is also always a button on the menu.',
      'Three quick taps never start a race. That is deliberate.',
      'You can practise all of this in the gesture tutorial, and then on the empty circuit, before any race starts.',
    ];
    speech.say(lines.join(' '), { priority: SPEECH_PRIORITY.CRITICAL, essential: true, cooldownMs: 0, interrupt: true });
    void seen;
  }

  // ------------------------------------------------------------------ start
  document.documentElement.style.setProperty('--text-scale', String(gameState.settings.textScale ?? 1));
  document.documentElement.classList.toggle('talkback-off', !gameState.settings.talkback);
  bus.on('settings:applied', ({ key, settings }) => {
    if (key === 'textScale') document.documentElement.style.setProperty('--text-scale', String(settings.textScale));
    document.documentElement.classList.toggle('talkback-off', !settings.talkback);
    screens.remeasure();
  });
  bus.on('progress:levelUp', ({ to }) => {
    audio.play('voice-level-up', { group: 'voice', volume: 1 });
    audio.play('music-high-up', { group: 'music', volume: 0.8 });
    speech.sayCritical(`Level up. You are now driver level ${to}. New cars may be available in the garage.`);
  });

  mountMenu();
  // The welcome is spoken after the menu is on screen so the player hears both.
  const welcomeDelay = Number.isFinite(config.welcomeDelay) ? config.welcomeDelay : 900;
  const welcomeTimer = setTimeout(announceWelcome, welcomeDelay);

  function announceWelcome() {
    firstRunAnnouncement();
    if (gameState.session.loadRejected?.length) {
      speech.sayEssential(`Some saved data could not be used and was reset: ${gameState.session.loadRejected.join('; ')}.`);
    }
    if (gameState.session.storageWarning) {
      speech.sayEssential(gameState.session.storageWarning);
    }
  }

  window.addEventListener('beforeunload', () => gameState.syncStory());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && raceScreen) pauseRace();
  });

  /** Tear everything down: timers, listeners, WebGL and audio. */
  function destroy() {
    clearTimeout(welcomeTimer);
    destroyRace();
    stopPreview();
    screens.destroyAll();
    pointerBus.detach();
    keyboard.detach();
    drivingInput.detach();
    bus.clear();
    speech.stop();
  }

  return {
    destroy,
    gameState,
    speech,
    audio,
    screens: screensApi,
    track,
    get raceScreen() {
      return raceScreen;
    },
    tutorialHarness,
    announceWelcome,
    pointerBus,
    keyboard,
    drivingInput,
    LEVELS,
    PRACTICE_LEVEL,
    SCREEN,
  };
}

/**
 * Records which gestures the player has genuinely performed, so the tutorial
 * and the chapter seven gate are based on evidence rather than on tapping
 * "Finish".
 */
export function createTutorialHarness() {
  const seen = new Set();
  return {
    record(action) {
      if (!action || seen.has(action)) return false;
      seen.add(action);
      bus.emit('tutorial:gesture', { action });
      return true;
    },
    report() {
      return {
        accelerated: seen.has('accelerated'),
        coasted: seen.has('coasted'),
        braked: seen.has('braked'),
        handbraked: seen.has('handbraked'),
        steered: seen.has('steered'),
        uturned: seen.has('uturned'),
        openedSettings: seen.has('openedSettings'),
        menuNavigated: seen.has('menuNavigated'),
      };
    },
    has(action) {
      return seen.has(action);
    },
    reset() {
      seen.clear();
    },
    get all() {
      return [...seen];
    },
  };
}

if (typeof document !== 'undefined' && document.getElementById('app-root')) {
  const app = bootApp();
  window.vettaru = app;
}
