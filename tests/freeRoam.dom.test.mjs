/** Explore House screen: menu entry, hold-to-walk, turns, doors, orientation. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDom } from './helpers/dom.mjs';
const env = createDom({ speech: true, audio: false });
const { window, document } = env;
window.PointerEvent = window.Event;
const { bootApp } = await import('../src/main.js');
window.vettaru?.destroy();
const { bus } = await import('../src/core/bus.js');
const { coerceSave, SAVE_KEY } = await import('../src/core/save.js');
const { trackForScreen } = await import('../src/core/musicDirector.js');

function storage() {
  const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}
function boot() {
  bus.clear(); const store = storage();
  store.setItem(SAVE_KEY, JSON.stringify(coerceSave({}).save));
  return bootApp({ storage: store, welcomeDelay: 100000 });
}
function start(app) {
  app.screens.openFreeRoam();
  const screen = app.screens.current;
  assert.equal(screen.id, 'house');
  assert.equal(screen.isMenu, true);
  bus.emit('gesture:doubleTap', { zone: { role: 'menu' } });
  assert.equal(screen.playing, true);
  return screen;
}
function actionText(screen) {
  return screen.element.querySelector('.roam-action').textContent;
}

test('the main menu offers Explore House with a warm music bed', () => {
  const app = boot();
  const labels = app.screens.current.focusItems.map(b => b.label);
  assert.ok(labels.includes('Explore House'));
  assert.equal(trackForScreen('house'), 'music-story-family');
  app.destroy();
});

test('starting announces the hallway; holding walks forward, release stops', () => {
  const app = boot(); const screen = start(app);
  assert.match(actionText(screen), /You are standing in the main hallway/);
  const labels = screen.focusItems.map(b => b.label);
  for (const name of ['Step left', 'Step right', 'Step back', 'Orientation', 'Use nearby', 'Stop walking', 'Walk out to the city', 'Open game menu']) {
    assert.ok(labels.includes(name), `${name} button exists for TalkBack`);
  }
  const y0 = screen.roam.state.y;
  screen.handleGesture('longPressStart');
  screen.tick(0.5);
  assert.ok(screen.roam.state.y > y0 + 0.3, 'held walk advances');
  screen.handleGesture('pressEnd');
  const y1 = screen.roam.state.y;
  screen.tick(0.5);
  assert.equal(screen.roam.state.y, y1, 'release stops dead');
  app.destroy();
});

test('swipes turn a quarter turn and announce the new facing', () => {
  const app = boot(); const screen = start(app);
  screen.handleGesture('swipe', { direction: 'right' });
  assert.equal(screen.roam.facing(), 'east');
  assert.match(actionText(screen), /Turned right\. Now facing east/);
  screen.handleGesture('swipe', { direction: 'left' });
  assert.equal(screen.roam.facing(), 'north');
  app.destroy();
});

test('tap toggles walking; release never kills the toggle; two fingers stop', () => {
  const app = boot(); const screen = start(app);
  screen.handleGesture('tap');
  assert.equal(screen.roam.state.moving, 'forward');
  assert.match(actionText(screen), /Walking/);
  const y0 = screen.roam.state.y;
  screen.tick(0.5);
  assert.ok(screen.roam.state.y > y0, 'toggle walk advances without touch');
  screen.handleGesture('pressEnd');
  assert.equal(screen.roam.state.moving, 'forward', 'a stray release never stops a toggle walk');
  screen.handleGesture('tap');
  assert.equal(screen.roam.state.moving, null);
  assert.match(actionText(screen), /Stopped/);
  screen.handleGesture('tap');
  assert.equal(screen.roam.state.moving, 'forward');
  screen.handleGesture('twoFingerTap');
  assert.equal(screen.roam.state.moving, null);
  assert.match(actionText(screen), /Stopped/);
  app.destroy();
});

test('double tap uses the door, or orientation when no door is near', () => {
  const app = boot(); const screen = start(app);
  assert.equal(screen.roam.isDoorOpen('living-door'), true);
  screen.handleGesture('doubleTap');
  assert.equal(screen.roam.isDoorOpen('living-door'), false);
  assert.match(actionText(screen), /You close the living room door/);
  screen.roam.state.x = 5; screen.roam.state.y = 0.5;
  screen.handleGesture('doubleTap');
  assert.match(actionText(screen), /You are in the main hallway, facing north/);
  app.destroy();
});

test('circle turns around; triple tap repeats the last announcement', () => {
  const app = boot(); const screen = start(app);
  screen.handleGesture('circle');
  assert.equal(screen.roam.state.headingDeg, 180);
  assert.match(actionText(screen), /Turned around\. Now facing south/);
  screen.handleGesture('tripleTap');
  assert.match(actionText(screen), /Turned around\. Now facing south/);
  app.destroy();
});

test('the turn-angle setting changes steps and facing words', () => {
  const app = boot(); const screen = start(app);
  app.gameState.settings.roamTurnAngle = '45';
  screen.handleGesture('swipe', { direction: 'right' });
  assert.equal(screen.roam.state.headingDeg, 45);
  assert.match(actionText(screen), /Now facing northeast/);
  app.gameState.settings.roamTurnAngle = '180';
  screen.handleGesture('swipe', { direction: 'left' });
  assert.equal(screen.roam.state.headingDeg, 225);
  app.destroy();
});

test('tap walking can be disabled without losing hold walking', () => {
  const app = boot(); const screen = start(app);
  app.gameState.settings.roamWalkTap = false;
  screen.handleGesture('tap');
  assert.equal(screen.roam.state.moving, null);
  assert.match(actionText(screen), /Tap walking is off/);
  screen.handleGesture('longPressStart');
  assert.equal(screen.roam.state.moving, 'forward', 'hold still walks');
  screen.handleGesture('pressEnd');
  assert.equal(screen.roam.state.moving, null);
  app.destroy();
});

test('the Stop button stops a tap-toggle walk', () => {
  const app = boot(); const screen = start(app);
  screen.handleGesture('tap');
  assert.equal(screen.roam.state.moving, 'forward');
  screen.focusItems.find((b) => b.label === 'Stop walking').activate();
  assert.equal(screen.roam.state.moving, null);
  assert.match(actionText(screen), /Stopped/);
  app.destroy();
});

test('swipe up then left walks then turns; the one-stroke diagonal goes back', () => {
  const app = boot(); const screen = start(app);
  bus.emit('gesture:swipe', { direction: 'up', dx: 0, dy: -60, zone: { id: 'roam-play' } });
  bus.emit('gesture:swipe', { direction: 'left', dx: -60, dy: 0, zone: { id: 'roam-play' } });
  assert.equal(app.screens.current.id, 'house', 'the pair never leaves Explore House');
  assert.ok(screen.roam.state.y > 1.0, 'stepped forward');
  assert.equal(screen.roam.state.headingDeg, 270, 'then turned left');
  bus.emit('gesture:swipe', { direction: 'up', dx: -30, dy: -30, zone: { id: 'roam-play' } });
  assert.ok(app.screens.current.id !== 'house', 'the diagonal still goes back');
  app.destroy();
});

test('double tap collects the nearest apple, then falls through to the door', () => {
  const app = boot(); const screen = start(app);
  screen.roam.state.x = 7.0; screen.roam.state.y = 2.9; screen.roam.state.headingDeg = 0;
  screen.handleGesture('doubleTap');
  assert.match(actionText(screen), /You collect an apple\. 1 apple in your satchel/);
  assert.equal(app.gameState.save.roam.apples, 1);
  assert.deepEqual(app.gameState.save.roam.taken, ['apple-kitchen']);
  assert.equal(screen.element.querySelector('[data-item="apple-kitchen"]').style.display, 'none');
  screen.handleGesture('doubleTap');
  assert.match(actionText(screen), /You close the kitchen door/, 'next-nearest wins after the take');
  app.destroy();
});

test('double tap opens the chest once for coins and apples', () => {
  const app = boot(); const screen = start(app);
  screen.roam.state.x = 0.7; screen.roam.state.y = 6.5; screen.roam.state.headingDeg = 0;
  screen.handleGesture('doubleTap');
  assert.match(actionText(screen), /You open the wooden chest\. Inside: 5 coins and 2 apples/);
  assert.equal(app.gameState.save.coins, 5);
  assert.equal(app.gameState.save.roam.apples, 2);
  assert.equal(app.gameState.save.roam.chestOpened, true);
  assert.equal(screen.element.querySelector('[data-fur="wooden-chest"]').getAttribute('fill'), '#c9a227');
  screen.handleGesture('doubleTap');
  assert.match(actionText(screen), /You collect an apple\. 3 apples in your satchel/, 'next-nearest wins after opening');
  screen.handleGesture('doubleTap');
  assert.match(actionText(screen), /You are in the living room/, 'empty reach falls through to orientation');
  app.destroy();
});

test('the Satchel menu speaks what you carry', () => {
  const app = boot(); const screen = start(app);
  screen.roam.state.x = 7.0; screen.roam.state.y = 2.9;
  screen.handleGesture('doubleTap');
  screen.openMenu();
  screen.focusItems.find((b) => b.label === 'Satchel').activate();
  assert.match(actionText(screen), /Satchel: 1 apple\. Health 100\. A wooden chest waits/);
  app.destroy();
});

test('walking near an apple announces it without collecting', () => {
  const app = boot(); const screen = start(app);
  screen.roam.state.x = 3.9; screen.roam.state.y = 4.2; screen.roam.state.headingDeg = 0;
  const heard = [];
  for (let i = 0; i < 6; i++) { screen.tick(0.1); heard.push(actionText(screen)); }
  assert.ok(heard.some((t) => /An apple is ahead and slightly to the left/.test(t)));
  assert.equal(app.gameState.save.roam.apples, 0, 'announcement never collects');
  assert.equal(app.gameState.save.roam.taken.length, 0);
  app.destroy();
});

test('swipe up at the main entrance walks out to the city', () => {
  const app = boot(); const screen = start(app);
  screen.roam.state.x = 1.3; screen.roam.state.y = 0.4;
  screen.handleGesture('swipe', { direction: 'up' });
  assert.equal(app.screens.current.id, 'city');
  assert.equal(app.screens.current.world.state.distance, 0, 'arrive at the Harbour Gate');
  app.destroy();
});

test('swipe up at the Cottage Door enters the house', () => {
  const app = boot();
  app.screens.openEasyWorld('city');
  bus.emit('gesture:doubleTap', { zone: { role: 'menu' } });
  const city = app.screens.current;
  assert.equal(city.playing, true);
  city.world.state.distance = 149; city.world.state.maxDistance = 149;
  city.handleGesture('swipe', { direction: 'up' });
  assert.equal(app.screens.current.id, 'house');
  assert.equal(app.screens.current.roam.roomAt(), 'hallway');
  app.destroy();
});

test('menu Visit links connect house and city both ways', () => {
  const app = boot();
  app.screens.openFreeRoam();
  app.screens.current.focusItems.find((b) => b.label === 'Visit City Walk').activate();
  assert.equal(app.screens.current.id, 'city');
  app.screens.current.focusItems.find((b) => b.label === 'Visit Explore House').activate();
  assert.equal(app.screens.current.id, 'house');
  app.destroy();
});

test('Eat an apple lowers hunger and speaks the result', () => {
  const app = boot(); const screen = start(app);
  app.gameState.save.roam.apples = 2;
  app.gameState.save.roam.hunger = 80;
  app.gameState.save.roam.health = 90;
  screen.openMenu();
  screen.focusItems.find((b) => b.label === 'Eat an apple').activate();
  assert.match(actionText(screen), /You eat an apple\. Health 100\. You feel full\. 1 apple left/);
  assert.equal(app.gameState.save.roam.apples, 1);
  assert.equal(app.gameState.save.roam.hunger, 30);
  app.destroy();
});

test('eating with no apples says so; fainting wakes at the entrance', () => {
  const app = boot(); const screen = start(app);
  screen.openMenu();
  screen.focusItems.find((b) => b.label === 'Eat an apple').activate();
  assert.match(actionText(screen), /No apples in your satchel/);
  screen.closeMenu();
  app.gameState.save.roam.hunger = 100;
  app.gameState.save.roam.health = 3;
  screen.roam.state.x = 6.4; screen.roam.state.y = 3.0;
  screen.tick(2);
  assert.match(actionText(screen), /feel faint from hunger/);
  assert.deepEqual([screen.roam.state.x, screen.roam.state.y], [1.3, 1.0]);
  assert.equal(app.gameState.save.roam.health, 50);
  app.destroy();
});

test('standard sensitivity is applied to the recognizer at boot', () => {
  const app = boot();
  assert.equal(app.pointerBus.recognizer.thresholds.swipeMinPx, 34);
  app.destroy();
});

test('walking through the bedroom doorway announces the bedroom', () => {
  const app = boot(); const screen = start(app);
  screen.roam.state.x = 3.9; screen.roam.state.y = 1.0; screen.roam.state.headingDeg = 0;
  screen.handleGesture('longPressStart');
  const heard = [];
  for (let i = 0; i < 15; i++) { screen.tick(0.1); heard.push(actionText(screen)); }
  screen.handleGesture('pressEnd');
  assert.equal(screen.roam.roomAt(), 'bedroom');
  assert.ok(heard.some((t) => /You are standing in the bedroom/.test(t)), 'the room entry was announced mid-walk');
  app.destroy();
});
