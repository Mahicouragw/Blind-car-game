import test from 'node:test';
import assert from 'node:assert/strict';
import { createDom } from './helpers/dom.mjs';
const env = createDom({ speech: true, audio: false });
const { window, document } = env;
const { bootApp } = await import('../src/main.js');
const { bus } = await import('../src/core/bus.js');
const { coerceSave, SAVE_KEY } = await import('../src/core/save.js');
const apps = [];
function storage() {
  const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}
function boot(coins = 0) {
  bus.clear(); const store = storage();
  store.setItem(SAVE_KEY, JSON.stringify(coerceSave({ coins }).save));
  const app = bootApp({ storage: store, welcomeDelay: 100000 }); apps.push(app); return { app, store };
}
function pick(app, name) {
  const screen = app.screens.current;
  const i = screen.focusItems.findIndex(b => b.label === name);
  assert.ok(i >= 0, `${name} exists`); screen.focusRing.focusAt(i, { silent: true });
}
function start(app, area = 'ground') {
  app.screens.openEasyWorld(area);
  const screen = app.screens.current;
  assert.equal(screen.isMenu, true);
  bus.emit('gesture:doubleTap', { zone: { role: 'menu' } });
  assert.equal(screen.playing, true); return screen;
}

test('all three easy areas are reachable without a GPU and before any tutorial gate', () => {
  const { app } = boot();
  const labels = app.screens.current.focusItems.map(b => b.label);
  for (const label of ['Easy Racing Ground', 'Forest Adventure', 'City Walk']) assert.ok(labels.includes(label));
  for (const area of ['ground','forest','city']) {
    assert.doesNotThrow(() => app.screens.openEasyWorld(area));
    assert.equal(app.screens.current.id, area);
    assert.ok(app.screens.current.summary.includes('Down-left'));
  }
  app.destroy();
});

test('fuel-out menu selects Petrol; tap ANYWHERE keeps Petrol, double tap refills', () => {
  const { app, store } = boot(12); const screen = start(app);
  screen.world.state.fuel = 0.001; screen.tick(0.1);
  assert.equal(screen.isMenu, true); assert.equal(screen.focusRing.current.label, 'Petrol');
  const wrong = screen.focusItems.find(b => b.label === 'Main menu').element;
  bus.emit('gesture:tap', { zone: { role: 'menu', element: wrong } });
  assert.equal(screen.focusRing.current.label, 'Petrol'); assert.equal(app.screens.current.id, 'ground');
  bus.emit('gesture:doubleTap', { zone: { role: 'menu', element: wrong } });
  assert.equal(screen.world.state.fuel, 100); assert.equal(app.gameState.save.coins, 7);
  assert.equal(JSON.parse(store.getItem(SAVE_KEY)).coins, 7);
  assert.equal(app.screens.current.id, 'ground', 'the wrong item under the finger must never open');
  app.destroy();
});

test('swipe changes the cursor, a tap over another item does not change or activate it', () => {
  const { app } = boot(); app.screens.openEasyWorld('city');
  const screen = app.screens.current; pick(app, 'Buy healing potion');
  bus.emit('gesture:swipe', { direction: 'right', dx: 100, dy: 0, zone: { role: 'menu' } });
  assert.equal(screen.focusRing.current.label, 'Buy city coin shop');
  bus.emit('gesture:tap', { zone: { role: 'menu', element: screen.focusItems[0].element } });
  assert.equal(screen.focusRing.current.label, 'Buy city coin shop');
  assert.equal(app.gameState.save.easyWorld.shopOwned, false);
  app.destroy();
});

test('full pointer pipeline: a slow steering swipe does not stop easy cruise', () => {
  const { app } = boot(); const screen = start(app);
  const r = app.pointerBus.recognizer; let clock = 0; r.setClock(() => clock);
  r.pointerDown(1, 100, 100, screen.zone); clock = 400; r.tick();
  r.pointerMove(1, 180, 100); clock = 600; r.pointerUp(1, 220, 100);
  assert.equal(screen.world.state.speed, 12);
  assert.equal(screen.world.state.queuedTurn, 'right'); app.destroy();
});

test('full pointer pipeline: tap stops; a 3+ second hold accelerates and keeps moving', () => {
  const { app } = boot(); const screen = start(app);
  const r = app.pointerBus.recognizer; let clock = 0; r.setClock(() => clock);
  r.pointerDown(1, 100, 100, screen.zone); clock = 80; r.pointerUp(1, 100, 100);
  assert.equal(screen.world.state.speed, 0);
  clock = 700; r.tick(); r.pointerDown(1, 100, 100, screen.zone);
  clock = 3900; r.tick(); r.pointerUp(1, 100, 100);
  assert.equal(screen.world.state.speed, 20); screen.tick(0.1);
  assert.ok(screen.world.state.distance > 0); app.destroy();
});

test('full pointer pipeline: forest triple tap heals, not a menu action or sit', () => {
  const { app, store } = boot(); const screen = start(app, 'forest');
  screen.world.state.health = 50;
  const r = app.pointerBus.recognizer; let clock = 0; r.setClock(() => clock);
  for (let i = 0; i < 3; i++) {
    r.pointerDown(1, 100, 100, screen.zone); clock += 50; r.pointerUp(1,100,100); clock += 100; r.tick();
  }
  clock += 500; r.tick();
  assert.equal(screen.world.state.health, 100); assert.equal(screen.world.state.seated, false);
  assert.equal(app.gameState.save.easyWorld.potions, 2);
  assert.equal(JSON.parse(store.getItem(SAVE_KEY)).easyWorld.potions, 2);
  assert.equal(app.screens.current.id, 'forest'); app.destroy();
});

test('down-left opens an in-game menu; up-left closes it; back from play leaves', () => {
  const { app } = boot(); const screen = start(app, 'forest');
  bus.emit('gesture:swipe', { direction: 'down', dx: -80, dy: 100, zone: screen.zone });
  assert.equal(screen.isMenu, true);
  bus.emit('gesture:swipe', { direction: 'up', dx: -80, dy: -100, zone: { role: 'menu' } });
  assert.equal(screen.playing, true);
  bus.emit('key:back', {}); assert.equal(app.screens.current.id, 'menu'); app.destroy();
});

test('city shop transactions persist, forest and existing races remain linked', () => {
  const { app, store } = boot(40); app.screens.openEasyWorld('city');
  pick(app, 'Buy city coin shop'); bus.emit('gesture:doubleTap', { zone: { role: 'menu' } });
  assert.equal(app.gameState.save.coins, 15); assert.equal(app.gameState.save.easyWorld.shopOwned, true);
  pick(app, 'Buy healing potion'); bus.emit('gesture:doubleTap', { zone: { role: 'menu' } });
  assert.equal(app.gameState.save.coins, 12); assert.equal(app.gameState.save.easyWorld.potions, 4);
  assert.equal(JSON.parse(store.getItem(SAVE_KEY)).easyWorld.shopOwned, true);
  pick(app, 'Visit Forest Adventure'); bus.emit('gesture:doubleTap', { zone: { role: 'menu' } });
  assert.equal(app.screens.current.id, 'forest'); assert.equal(app.screens.current.world.inventory.potions, 4);
  app.screens.openEasyWorld('city'); pick(app, 'Enter a racing event');
  bus.emit('gesture:doubleTap', { zone: { role: 'menu' } });
  assert.equal(app.screens.current.id, 'levels'); app.destroy();
});

test('Exit and background stop all audio; foregrounding Exit never starts menu music', () => {
  const { app } = boot(); const tracks = [];
  app.audio.music.play = async name => { tracks.push(name); return true; };
  let stops = 0; const original = app.audio.stopAll.bind(app.audio);
  app.audio.stopAll = () => { stops++; original(); };
  app.screens.gotoMenu(); assert.ok(tracks.length > 0); tracks.length = 0;
  app.screens.openExit(); assert.equal(tracks.length, 0); assert.ok(stops > 0);
  window.dispatchEvent(new window.Event('pagehide'));
  assert.equal(app.audio.play('ui-click'), false);
  window.dispatchEvent(new window.Event('pageshow'));
  assert.equal(tracks.length, 0); app.destroy();
});

test('background freezes play, return opens a safe menu, wallet survives pagehide save', () => {
  const { app, store } = boot(); const screen = start(app);
  window.dispatchEvent(new window.Event('pagehide'));
  const d = screen.world.state.distance; screen.tick(0.25); assert.equal(screen.world.state.distance, d);
  window.dispatchEvent(new window.Event('pageshow')); assert.equal(screen.isMenu, true);
  screen.closeMenu(); screen.world.state.nextCoinAt = 0; screen.tick(0.1);
  assert.equal(app.gameState.save.coins, 1);
  assert.equal(JSON.parse(store.getItem(SAVE_KEY)).coins, 1); app.destroy();
});

test.after(() => { for (const app of apps) app.destroy(); env.dispose(); });

test('stationary single taps resolve from the running input clock, with no further touch', async () => {
  const { app } = boot(); const screen = start(app, 'forest');
  let taps = 0; const original = screen.world.tap;
  screen.world.tap = () => { taps++; original(); };
  const r = app.pointerBus.recognizer;
  r.pointerDown(1, 100, 100, screen.zone); r.pointerUp(1, 100, 100);
  assert.equal(taps, 0);
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.equal(taps, 1, 'the idle input clock must settle a delayed single tap');
  app.destroy();
});
