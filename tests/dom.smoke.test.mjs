/**
 * Browser-surface smoke tests, run in jsdom.
 *
 * These verify the parts of the game that only exist in a DOM: that it boots,
 * that screens mount and announce themselves, that gestures reach real buttons,
 * that the story renders and branches, and that turning Game TalkBack off never
 * produces a silent settings screen.
 *
 * WebGL is not available in jsdom, so the race renderer and the 3D car preview
 * are out of scope here; both are covered by the graceful-degradation paths
 * these tests do exercise. See docs/TESTING.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDom } from './helpers/dom.mjs';

const env = createDom({ speech: true, audio: false });
const { window, document } = env;
/** Every app instance created here, so teardown can stop their timers. */
const apps = [];
function boot(storage = newStorage()) {
  const app = bootApp({
    welcomeDelay: 0,
    storage,
    canvas: document.getElementById('scene'),
    host: document.getElementById('screen-host'),
    overlay: document.getElementById('race-overlay'),
    liveRegion: document.getElementById('live-region'),
    gestureLayer: document.getElementById('gesture-layer'),
  });
  apps.push(app);
  return app;
}

const { bus } = await import('../src/core/bus.js');
const { coerceSave } = await import('../src/core/save.js');
const { getCar } = await import('../src/vehicles/carCatalog.js');
const { carPrice } = await import('../src/race/garage.js');
const { bootApp, createTutorialHarness } = await import('../src/main.js');

function newStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

function buttons() {
  return [...document.querySelectorAll('#screen-host button')];
}
function labels() {
  return buttons().map((b) => b.textContent.trim());
}

test('the game boots into an announced main menu', () => {
  bus.clear();
  const app = boot();
  assert.ok(app, 'bootApp returned an app');
  assert.equal(app.screens.current.id, 'menu');
  const text = labels().join(' | ');
  for (const expected of ['Start the story', 'Car selection', 'Race', 'Practice session', 'Gesture tutorial', 'Game TalkBack settings', 'Circuit map', 'Story so far', 'Audio and credits', 'Reset progress']) {
    assert.ok(text.includes(expected), `menu is missing "${expected}": ${text}`);
  }
  window.__app = app;
});

test('the menu announces itself through Game TalkBack', () => {
  const spoken = window.speechSynthesis.spoken.join(' \n ');
  assert.match(spoken, /Main menu/, 'the screen title should be spoken');
});

test('the welcome explanation covers the gestures before any race', () => {
  // The welcome is delayed in the real app so it does not talk over the menu
  // announcement; here it is triggered explicitly to keep the test synchronous.
  window.__app.announceWelcome();
  const spoken = window.speechSynthesis.spoken.join(' \n ');
  assert.match(spoken, /Press and hold/i);
  assert.match(spoken, /Tap once to brake/);
  assert.match(spoken, /handbrake/i);
  assert.match(spoken, /circle/i);
  assert.match(spoken, /Three quick taps never start a race/);
});

test('speech-unsupported devices get an explanation, not silence', () => {
  const app = window.__app;
  // jsdom installs a fake synth, so force the unsupported path explicitly.
  app.speech.setSynth(null);
  const msg = app.speech.explainStatus();
  assert.match(msg, /does not provide speech synthesis/);
  assert.match(msg, /caption area/);
  app.speech.setSynth(window.speechSynthesis);
});

test('swiping down moves focus and announces the new control', () => {
  const app = window.__app;
  const before = app.screens.current.focusRing.index;
  bus.emit('gesture:swipe', { direction: 'down', zone: { role: 'menu' } });
  const after = app.screens.current.focusRing.index;
  assert.notEqual(after, before, 'focus should move on swipe down');
});

test('a single tap confirms the CURSOR anywhere, a double tap ACTIVATES it', () => {
  const app = window.__app;
  const target = buttons().find((b) => b.textContent.includes('Gesture tutorial'));
  assert.ok(target, 'tutorial button exists');
  app.screens.current.focusRing.focusAt(app.screens.current.focusRing.indexOf(target));
  before();
  // TalkBack model: the single tap only moves the cursor and speaks the label -
  // it must never open anything (taps were "automatically clicking on other
  // things"). The double tap takes you to the selected control.
  bus.emit('gesture:tap', { zone: { role: 'menu', element: target } });
  assert.notEqual(app.screens.current.id, 'tutorial', 'a single tap must not activate');
  assert.equal(app.screens.current.focusRing.current?.element, target, 'a single tap keeps the cursor selected');
  bus.emit('gesture:doubleTap', { zone: { role: 'menu', element: target } });
  assert.equal(app.screens.current.id, 'tutorial', 'the double tap opened the tutorial screen');
  function before() {
    window.speechSynthesis.spoken.length = 0;
  }
});

test('the tutorial lists every gesture and refuses to finish early', () => {
  const app = window.__app;
  const screen = app.screens.current;
  assert.equal(screen.steps.length, 11);
  // Only the current step is on screen, so check the step content itself: every
  // gesture must be taught somewhere in the lesson, not just on step one.
  const taught = screen.steps.map((s) => `${s.title} ${s.text}`).join(' ').toLowerCase();
  for (const phrase of ['press and hold', 'tap the driving surface once', 'twice quickly', 'double tap and hold', 'handbrake', 'drag left or right', 'circular drag', 'f1', 'gradually', 'straightens itself', 'recovery']) {
    assert.ok(taught.includes(phrase.toLowerCase()), `tutorial should teach "${phrase}"`);
  }
  assert.ok(document.body.textContent.includes('Step 1 of 11'), 'the on-screen step is labelled with its position');
  // Nothing has been demonstrated yet, so finishing must be refused.
  const finish = buttons().find((b) => b.textContent.includes('Finish the tutorial'));
  window.speechSynthesis.spoken.length = 0;
  finish.click();
  assert.equal(app.screens.current.id, 'tutorial', 'still on the tutorial');
  assert.match(window.speechSynthesis.spoken.join(' '), /have not demonstrated/i);
});

test('demonstrating a gesture is what unlocks the tutorial step', () => {
  const app = window.__app;
  const harness = app.tutorialHarness;
  harness.reset();
  bus.emit('gesture:pressStart', { zone: { role: 'driving' } });
  bus.emit('gesture:pressEnd', { zone: { role: 'driving' } });
  // A tap is the brake; the dummy element stops the tap handler activating a
  // menu button behind the tutorial, which is not what is under test here.
  bus.emit('gesture:tap', { zone: { role: 'driving', element: { click() {} } } });
  bus.emit('gesture:doubleTap', { zone: { role: 'driving', element: { click() {} } } });
  // Double-tap-and-HOLD sounds the horn (a quick double tap only brakes).
  bus.emit('gesture:doubleTapHold', { zone: { role: 'driving', element: { click() {} } } });
  // `dx`, not `totalDx`: this test used to hand-write a field the recognizer
  // never emits, which is precisely why the suite stayed green while the real
  // steering gesture was dead. See tests/integration.test.mjs, which drives the
  // real recognizer instead of describing its payload.
  bus.emit('gesture:dragEnd', { zone: { role: 'driving', id: 'drivingSurface' }, dx: -140 });
  bus.emit('gesture:circle', { zone: { role: 'driving' } });
  const report = harness.report();
  for (const key of ['accelerated', 'coasted', 'braked', 'horned', 'steered', 'uturned']) {
    assert.ok(report[key], `${key} should be recorded once performed`);
  }
});

test('triple tap on a menu control never activates it', () => {
  const app = window.__app;
  app.screens.gotoMenu();
  const startRace = buttons().find((b) => b.textContent.trim().startsWith('Race'));
  let clicks = 0;
  startRace.addEventListener('click', () => clicks++);
  bus.emit('gesture:tripleTap', { zone: { role: 'menu', element: startRace } });
  assert.equal(clicks, 0, 'a triple tap must not activate the control');
  assert.match(window.speechSynthesis.spoken.join(' '), /Three quick taps do nothing on purpose/);
});

test('Game TalkBack settings opens, and stays speaking when guidance is off', () => {
  const app = window.__app;
  app.screens.openSettings();
  assert.equal(app.screens.current.id, 'settings');
  const body = document.body.textContent;
  for (const label of ['Game TalkBack', 'Speech volume', 'Speech rate', 'Music', 'Sound effects', 'Navigation announcements', 'Music volume', 'Sound effects volume', 'Spoken speed and lap updates', 'Close and return']) {
    assert.ok(body.includes(label), `settings screen is missing "${label}"`);
  }

  window.speechSynthesis.spoken.length = 0;
  const toggle = buttons().find((b) => b.querySelector('.ui-button-label')?.textContent === 'Game TalkBack');
  toggle.click();
  assert.equal(app.gameState.settings.talkback, false, 'guidance is now off');
  const said = window.speechSynthesis.spoken.join(' ');
  assert.match(said, /Game TalkBack is now off/, 'turning it off must be confirmed aloud');
  assert.match(said, /keep speaking|never stuck in silence/i, 'the settings screen must not go silent');

  // Ordinary game speech is now dropped, essential speech still gets through.
  const dropped = app.speech.say('You are approaching a right-hand corner.', { priority: 3 });
  assert.equal(dropped, false, 'non-essential speech must stop when guidance is off');
  const kept = app.speech.sayEssential('Speech volume. 80 percent.');
  assert.equal(kept, true, 'the settings screen keeps speaking');

  toggle.click();
  assert.equal(app.gameState.settings.talkback, true);
  app.screens.back();
});

test('a saved setting survives a reload', async () => {
  const storage = newStorage();
  bus.clear();
  const first = boot(storage);
  first.gameState.setSettingValue('speechRate', 1.4);
  first.gameState.setHeroName('Divya Test');
  const second = boot(storage);
  assert.equal(second.gameState.settings.speechRate, 1.4);
  assert.equal(second.gameState.heroName, 'Divya Test');
});

test('unplayable chapters are labelled and cannot be entered', () => {
  const app = boot();
  app.screens.openChapterList();
  const planned = buttons().filter((b) => b.dataset.planned === 'true');
  assert.ok(planned.length >= 3, `expected at least three planned chapters, found ${planned.length}`);
  for (const b of planned) {
    assert.equal(b.disabled, true, 'a planned chapter must be disabled, not a fake button');
    assert.match(b.textContent, /Not yet playable/);
  }
  window.__app2 = app;
});

test('story chapter one renders and branches on a real choice', () => {
  const app = window.__app2;
  app.screens.openStory(1);
  const scene = document.querySelector('.story-text');
  assert.ok(scene, 'a scene is rendered');
  assert.match(scene.textContent, /Anandapur/);
  app.screens.current.speakNode();

  // Walk to the first branching choice.
  let guard = 0;
  while (document.querySelectorAll('.story-choices .ui-button-choice').length === 0 && guard++ < 12) {
    const cont = buttons().find((b) => b.textContent.trim() === 'Continue');
    if (!cont) break;
    cont.click();
  }
  const choices = [...document.querySelectorAll('.story-choices .ui-button-choice')];
  assert.ok(choices.length >= 3, `expected at least three dialogue choices, found ${choices.length}`);
  window.speechSynthesis.spoken.length = 0;
  choices[0].click();
  assert.ok(guard < 40, 'the story advanced');
  assert.notEqual(document.querySelector('.story-text').textContent, '', 'a new scene rendered');
});

test('the hero name is sanitised before it reaches speech or the DOM', () => {
  const app = boot();
  const res = app.gameState.setHeroName('<img src=x onerror=alert(1)>Bob');
  assert.equal(res.ok, true);
  // The whitelist is letters, marks, spaces, apostrophes and hyphens, so no
  // markup, attribute syntax or script can survive into speech or the DOM.
  assert.ok(!/[<>=(){}[\]`"'\\]/.test(res.heroName), `markup characters stripped, got ${JSON.stringify(res.heroName)}`);
  assert.match(res.heroName, /^[\p{L}\p{M}'\- ]+$/u);
  assert.equal(app.gameState.setHeroName('!!!').ok, false, 'a name with no letters is rejected');
});

test('the tutorial harness only records a gesture once', () => {
  const h = createTutorialHarness();
  assert.equal(h.record('braked'), true);
  assert.equal(h.record('braked'), false, 'the second time is not a new demonstration');
  assert.equal(h.report().braked, true);
  h.reset();
  assert.equal(h.report().braked, false);
});

test('the car preview degrades when WebGL is unavailable', async () => {
  const { createCarPreview } = await import('../src/ui/menuScreens.js');
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const preview = createCarPreview(canvas);
  assert.ok(preview, 'a preview handle is returned even without WebGL');
  assert.doesNotThrow(() => preview.setCar({ id: 'kestrel' }));
  assert.doesNotThrow(() => preview.render(0.016));
  preview.dispose();
  canvas.remove();
});

test('starting a race without WebGL explains the limitation instead of white-screening', () => {
  const app = boot();
  // Chapter seven only hands off to a race once the controls are understood, so
  // satisfy that gate first and then prove the WebGL path explains itself.
  app.gameState.save.controlsUnderstood = true;
  window.speechSynthesis.spoken.length = 0;
  app.screens.startRaceFromStory(7);
  const said = window.speechSynthesis.spoken.join(' ');
  assert.match(said, /cannot create a WebGL context/, 'the player is told why');
  assert.notEqual(app.screens.current.id, 'race', 'no broken race screen was mounted');
});

test('the garage is reachable from the menu and lists real prices', () => {
  const storage = newStorage();
  // The bus is a singleton shared by every app booted in this file, so earlier
  // apps are still listening unless it is cleared. The first test in this file
  // does the same thing for the same reason.
  bus.clear();
  bus.clear();
  storage.setItem('vettaru.save.v1', JSON.stringify(coerceSave({ coins: 5000 }).save));
  const app = boot(storage);
  app.gameState.setSettingValue('talkback', true);

  const garageButton = buttons().find((b) => b.textContent.includes('Garage'));
  assert.ok(garageButton, 'the menu offers the garage');
  assert.match(garageButton.textContent, /5000/, 'the menu says how many coins the player has');

  // Swipes select; a tap anywhere confirms that cursor.
  app.screens.current.focusRing.focusAt(app.screens.current.focusRing.indexOf(garageButton));
  bus.emit('gesture:tap', { zone: { role: 'menu', element: garageButton } });
  assert.notEqual(app.screens.current.id, 'garage', 'the single tap does not navigate');
  bus.emit('gesture:doubleTap', { zone: { role: 'menu', element: garageButton } });
  assert.equal(app.screens.current.id, 'garage', 'the double tap opened the garage');
  assert.equal(app.gameState.save.coins, 5000, 'looking is free');

  // Every car is on the list, with its price in the label the player hears.
  const shown = labels().join(' | ');
  // Names come from the catalogue so this does not drift when a car is renamed.
  assert.ok(shown.includes(`${getCar('vantage-rs').name} - ${carPrice('vantage-rs')} coins`), shown);
  assert.ok(shown.includes(`${getCar('haulmaster').name} - ${carPrice('haulmaster')} coins`), shown);
  assert.ok(shown.includes(`${getCar('kestrel').name} - owned`), shown);
  assert.match(shown, /Wash and polish/);
  app.destroy();
});

test('buying a car in the garage charges the coins and makes it drivable', () => {
  const storage = newStorage();
  bus.clear();
  storage.setItem('vettaru.save.v1', JSON.stringify(coerceSave({ coins: 5000 }).save));
  const app = boot(storage);
  app.gameState.setSettingValue('talkback', true);
  app.screens.openGarage();
  assert.equal(app.screens.current.id, 'garage');

  const buy = buttons().find((b) => b.textContent.includes(`${getCar('vantage-rs').name} - ${carPrice('vantage-rs')} coins`));
  assert.ok(buy, 'the car is offered at its price');
  window.speechSynthesis.spoken.length = 0;
  // Single tap selects (and says the car and its price); the double tap buys.
  bus.emit('gesture:tap', { zone: { role: 'menu', element: buy } });
  assert.equal(app.gameState.save.coins, 5000, 'selecting does not buy');
  bus.emit('gesture:doubleTap', { zone: { role: 'menu', element: buy } });

  // The purchase is spoken, with the new balance, and the screen refreshed.
  const said = window.speechSynthesis.spoken.join(' ');
  assert.match(said, /bought for 1600 coins/i);
  assert.match(said, /3400/, 'the spoken reply states what is left');
  assert.equal(app.gameState.save.coins, 3400);
  assert.ok(app.gameState.save.boughtCars.includes('vantage-rs'));
  assert.ok(app.gameState.save.unlockedCars.includes('vantage-rs'), 'a bought car is selectable');
  assert.equal(app.screens.current.id, 'garage', 'the player stays in the garage');
  assert.ok(labels().join(' | ').includes(`${getCar('vantage-rs').name} - owned`), 'the list reflects the purchase');

  // And the car really is drivable: car selection offers it without a lock.
  app.screens.openCarSelect();
  assert.equal(app.screens.current.id, 'carSelect');
  const cars = app.screens.current.cars ?? [];
  const bought = cars.find((c) => c.id === 'vantage-rs');
  assert.ok(bought, 'the bought car is in the list');
  assert.equal(bought.locked, false, 'a car bought with coins is not locked');
  app.destroy();
});

test('a purchase the player cannot afford is refused in words, and changes nothing', () => {
  const storage = newStorage();
  bus.clear();
  storage.setItem('vettaru.save.v1', JSON.stringify(coerceSave({ coins: 300 }).save));
  const app = boot(storage);
  app.gameState.setSettingValue('talkback', true);
  app.screens.openGarage();

  const expensive = buttons().find((b) => b.textContent.includes(getCar('haulmaster').name));
  assert.ok(expensive, 'the expensive car is still listed, not hidden');
  window.speechSynthesis.spoken.length = 0;
  bus.emit('gesture:tap', { zone: { role: 'menu', element: expensive } });

  assert.equal(app.gameState.save.coins, 300, 'no coins left the account');
  assert.deepEqual(app.gameState.save.boughtCars, [], 'nothing was bought');
  const said = window.speechSynthesis.spoken.join(' ');
  assert.match(said, /300/, 'the refusal says how many coins the player has');
  app.destroy();
});

test('the garage never offers a car the player already owns, or a wash with nothing to clean', () => {
  const storage = newStorage();
  bus.clear();
  storage.setItem('vettaru.save.v1', JSON.stringify(coerceSave({ coins: 9000, grime: 0 }).save));
  const app = boot(storage);
  app.screens.openGarage();
  const wash = buttons().find((b) => b.textContent.includes('Wash and polish'));
  assert.ok(wash.disabled, 'a clean car is not offered a wash');
  const starter = buttons().find((b) => b.textContent.includes(getCar('kestrel').name));
  assert.ok(starter.disabled, 'the starter car is listed as owned, not for sale again');
  app.destroy();
});

test('car selection opens without WebGL and explains the missing preview', () => {
  // jsdom has no WebGL context at all, which is also what a locked-down or
  // very low-end browser looks like. Opening car selection used to throw from
  // inside the renderer and take the screen down with it.
  bus.clear();
  const app = boot();
  assert.doesNotThrow(() => app.screens.openCarSelect());
  assert.equal(app.screens.current.id, 'carSelect');
  const text = document.getElementById('screen-host').textContent;
  assert.match(text, /cannot create a three-dimensional drawing context/i, 'the player is told why there is no picture');
  // The screen must still be fully operable without the picture.
  assert.ok(buttons().some((b) => b.textContent.includes('Next car')), 'browsing still works');
  // The select button names the focused car, so match the verb, not a full label.
  assert.ok(labels().some((l) => /^Select /.test(l)), 'choosing still works');
  app.destroy();
});

test('the story screen always offers a way back to the menu', () => {
  // There was no way out of the story on a touch device: the screen offered only
  // the scene's own choices, so a player who wanted to leave was stuck, and
  // nothing told them otherwise.
  bus.clear();
  const app = boot();
  app.gameState.save.chaptersCompleted = [1, 2, 3, 4, 5, 6];
  app.screens.openStory(7);
  assert.equal(app.screens.current.id, 'story');
  const leave = buttons().find((b) => /back to the menu/i.test(b.textContent));
  assert.ok(leave, 'a way out is on screen');
  assert.match(leave.textContent, /progress/i, 'and it says progress is kept');
  // It must be reachable by the focus ring too, not just present in the DOM.
  assert.ok(
    app.screens.current.focusItems.some((i) => i.element === leave),
    'the way out is in the focus order',
  );
  app.destroy();
});

test('arriving on a new screen is heard even while a long passage is still being read', () => {
  bus.clear();
  const app = boot();
  const synth = window.speechSynthesis;
  const realSpeak = synth.speak;
  // Hold the utterance open: a real long passage does not finish instantly, and
  // this is exactly the state that used to swallow the next screen's welcome.
  synth.speak = (u) => {
    window.speechSynthesis.spoken.push(u.text);
  };
  app.speech.say('A very long passage about the city and the family and the rent notice.', {
    priority: 4,
    essential: true,
    interrupt: true,
    cooldownMs: 0,
  });
  assert.equal(app.speech.queue.isSpeaking, true, 'something is mid-sentence');

  window.speechSynthesis.spoken.length = 0;
  app.screens.openSettings();
  const said = window.speechSynthesis.spoken.join(' ');
  assert.match(said, /Settings/i, 'the new screen announces itself instead of waiting behind the old speech');

  synth.speak = realSpeak;
  app.speech.stop();
  app.destroy();
});

test.after(() => {
  // Screens own timers (the tutorial polls for demonstrated gestures), so every
  // app has to be torn down or the test process never exits.
  for (const app of apps) {
    try {
      app.destroy();
    } catch {
      /* ignore */
    }
  }
  apps.length = 0;
  env.dispose();
});
