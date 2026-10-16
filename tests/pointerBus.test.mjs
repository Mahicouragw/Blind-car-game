import test from 'node:test';
import assert from 'node:assert/strict';
import { createDom } from './helpers/dom.mjs';
import { createPointerBus } from '../src/input/pointerBus.js';
import { bus } from '../src/core/bus.js';
const env = createDom();
const { window, document } = env;
const forest = { id: 'easy-play', role: 'easyPlay', hold: true, allowSwipe: true, deferDoubleTap: true, tapAnywhere: true, tapWindowMs: 600 };
function event(target, type, props = {}) {
  const e = new window.Event(type, { bubbles: true, cancelable: true });
  for (const [k,v] of Object.entries(props)) Object.defineProperty(e, k, { value: v });
  target.dispatchEvent(e); return e;
}
function rig(zone = forest, pointer = true) {
  bus.clear(); const element = document.createElement('div'); document.body.append(element);
  let clock = 0; const seen = [];
  for (const type of ['tap','doubleTap','tripleTap','swipe','cancel','pressEnd']) bus.on('gesture:' + type, d => seen.push({ type, ...d }));
  const adapter = createPointerBus({ element, zoneAt: typeof zone === 'function' ? zone : () => zone, now: () => clock, usePointerEvents: pointer }).attach();
  function sample(type, x = 100, id = 1) { event(element, type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: 100, button: 0 }); }
  const touch = (type, id = 1, extra = []) => {
    const t = { identifier: id, clientX: 100, clientY: 100 };
    event(element, type, { touches: type === 'touchend' || type === 'touchcancel' ? extra : [t, ...extra], changedTouches: [t] });
  };
  return { adapter, element, seen, sample, touch,
    advance(ms) { clock += ms; adapter.tick(); },
    tap(x = 100) {
      sample('pointerdown',x); clock += 50; sample('pointerup',x);
      // This is the actual lift sequence on touch Pointer Events. The old
      // pointerleave cancellation erased single, double AND triple taps here.
      sample('lostpointercapture',x); sample('pointerout',x); sample('pointerleave',x);
    },
    dispose() { adapter.detach(); element.remove(); },
  };
}
for (const [count, kind] of [[1,'tap'],[2,'doubleTap'],[3,'tripleTap']]) {
  test(`phone pointerup -> leave: ${count} tap(s) produce exactly one ${kind}`, () => {
    const r = rig(); try {
      for (let i = 0; i < count; i++) { r.tap(); r.advance(120); }
      r.advance(700);
      const actions = r.seen.filter(e => ['tap','doubleTap','tripleTap'].includes(e.type));
      assert.deepEqual(actions.map(e => e.type), [kind]);
    } finally { r.dispose(); }
  });
}
test('a 500ms accessibility double tap over DIFFERENT menu buttons activates the cursor', () => {
  const r = rig(x => ({ id: x < 200 ? 'btn-petrol' : 'btn-main-menu', role: 'menu', immediateTap: true }));
  try { r.tap(100); r.advance(500); r.tap(300); r.advance(700);
    assert.equal(r.seen.filter(e => e.type === 'doubleTap').length, 1);
  } finally { r.dispose(); }
});
test('a normal leave AFTER menu tap cannot reset the multi-tap chain', () => {
  const r = rig({ id:'menu', role:'menu', immediateTap:true });
  try { r.tap(); r.advance(100); r.tap(); assert.ok(r.seen.some(e => e.type === 'doubleTap')); }
  finally { r.dispose(); }
});
test('compatibility touch events cannot double-feed the pointer recognizer', () => {
  const r = rig(); try {
    for (let i=0;i<3;i++) {
      r.sample('pointerdown'); r.touch('touchstart'); r.advance(40);
      r.sample('pointerup'); r.touch('touchend'); r.sample('pointerleave'); r.advance(120);
    }
    r.advance(700);
    assert.deepEqual(r.seen.filter(e => ['tap','doubleTap','tripleTap'].includes(e.type)).map(e => e.type), ['tripleTap']);
  } finally { r.dispose(); }
});
test('another finger cancelling cannot destroy a first-finger tap', () => {
  const r = rig(); try {
    r.sample('pointerdown'); r.sample('pointercancel',100,2); r.advance(40);
    r.sample('pointerup'); r.sample('pointerleave'); r.advance(700);
    assert.equal(r.seen.filter(e => e.type === 'tap').length, 1);
  } finally { r.dispose(); }
});
test('a true cancellation of a HELD finger releases it without a tap', () => {
  const r = rig(); try {
    r.sample('pointerdown'); r.advance(100); r.sample('pointercancel'); r.advance(800);
    assert.equal(r.seen.filter(e => e.type === 'tap').length, 0);
    assert.ok(r.seen.some(e => e.type === 'pressEnd' && e.cancelled));
  } finally { r.dispose(); }
});
test('pointer capture allows a swipe outside the initial hit target', () => {
  const r = rig(); try {
    r.sample('pointerdown'); r.sample('pointerleave'); r.advance(100);
    r.sample('pointermove',200); r.sample('pointerup',250); r.sample('lostpointercapture');
    assert.ok(r.seen.some(e => e.type === 'swipe' && e.direction === 'right'));
  } finally { r.dispose(); }
});
test('legacy touchend uses changedTouches, not a remaining second finger', () => {
  const r = rig(forest, false); try {
    r.touch('touchstart'); r.advance(50);
    r.touch('touchend',1,[{identifier:2,clientX:300,clientY:300}]); r.advance(700);
    assert.equal(r.seen.filter(e => e.type === 'tap').length, 1);
    assert.equal(r.adapter.recognizer.isTouching, false);
  } finally { r.dispose(); }
});
test('legacy touch mode ignores pointer and compatibility mouse duplicates', () => {
  const r = rig(forest, false); try {
    r.touch('touchstart'); r.sample('pointerdown'); event(r.element,'mousedown',{clientX:100,clientY:100,button:0});
    r.advance(50); r.touch('touchend'); r.sample('pointerup'); event(r.element,'mouseup',{clientX:100,clientY:100,button:0});
    r.advance(700); assert.equal(r.seen.filter(e => e.type === 'tap').length, 1);
  } finally { r.dispose(); }
});
test('detach removes click/context handlers too, and reattach does not duplicate taps', () => {
  const r = rig({ id:'menu',role:'menu',immediateTap:true }); try {
    r.adapter.detach(); r.tap(); assert.equal(r.seen.length,0);
    r.adapter.attach(); r.tap(); assert.equal(r.seen.filter(e => e.type==='tap').length,1);
  } finally { r.dispose(); }
});
test.after(() => env.dispose());
