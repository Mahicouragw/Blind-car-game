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
  for (const name of ['Step left', 'Step right', 'Step back', 'Orientation', 'Use nearby door', 'Open game menu']) {
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

test('tap toggles the nearby door; swipe up reads orientation', () => {
  const app = boot(); const screen = start(app);
  assert.equal(screen.roam.isDoorOpen('living-door'), true);
  screen.handleGesture('tap');
  assert.equal(screen.roam.isDoorOpen('living-door'), false);
  assert.match(actionText(screen), /You close the living room door/);
  screen.handleGesture('tap');
  assert.equal(screen.roam.isDoorOpen('living-door'), true);
  screen.handleGesture('swipe', { direction: 'up' });
  assert.match(actionText(screen), /You are in the main hallway, facing north/);
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
