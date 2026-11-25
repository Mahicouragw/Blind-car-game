/** Spatial narrator: room entries, relative directions, bumps, orientation. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFreeRoam } from '../src/world/freeRoam.js';
import { createRoamNarrator, nearestDoor, relativeDirection } from '../src/world/roamNarrate.js';

function run(roam, secs) {
  const n = Math.round(secs / 0.1);
  for (let i = 0; i < n; i++) roam.update(0.1);
}
function texts(events) {
  return events.map((e) => e.text);
}

test('relative directions follow the master-prompt wording', () => {
  assert.equal(relativeDirection(0, 0, 0, 0, 1), 'directly ahead');
  assert.equal(relativeDirection(0, 0, 0, 1, 1), 'ahead and slightly to the right');
  assert.equal(relativeDirection(0, 0, 0, -1, 1), 'ahead and slightly to the left');
  assert.equal(relativeDirection(0, 0, 0, 1, 0), 'on your right');
  assert.equal(relativeDirection(0, 0, 0, -1, 0), 'on your left');
  assert.equal(relativeDirection(0, 0, 0, 0, -1), null, 'behind is never announced unprompted');
});

test('room entry speaks once, then the doorway ahead, then silence', () => {
  const roam = createFreeRoam({}); // hallway start, facing the living-room door
  const narrator = createRoamNarrator({ roam });
  const first = narrator.update();
  assert.deepEqual(texts(first), ['You are standing in the main hallway.']);
  assert.equal(first[0].priority, 4);
  assert.deepEqual(texts(narrator.update()), ['The living room door is directly ahead.']);
  assert.deepEqual(texts(narrator.update()), ['The bedroom door is on your right.']);
  assert.deepEqual(texts(narrator.update()), ['Living room door nearby. Double tap to close it.']);
  assert.deepEqual(narrator.update(), [], 'nothing repeats while standing still');
});

test('leaving range resets a target so returning re-announces it', () => {
  const roam = createFreeRoam({});
  const narrator = createRoamNarrator({ roam });
  narrator.update(); narrator.update(); narrator.update(); // room + two doors
  roam.state.x = 9; // walk to the far end of the hallway
  assert.deepEqual(texts(narrator.update()), ['The washroom door is directly ahead.']);
  assert.deepEqual(texts(narrator.update()), ['The kitchen door is on your left.']);
  assert.deepEqual(texts(narrator.update()), ['Washroom door nearby. Double tap to close it.']);
});

test('walking through a doorway announces the new room', () => {
  const roam = createFreeRoam({ x: 3.9, y: 1.0, headingDeg: 0 });
  const narrator = createRoamNarrator({ roam });
  narrator.update();
  roam.setMove('forward'); run(roam, 1.5); roam.stop();
  assert.deepEqual(texts(narrator.update()), ['You are standing in the bedroom.']);
});

test('orientation names room, facing, doors by side, and the wall ahead', () => {
  const roam = createFreeRoam({ x: 5, y: 1.0, headingDeg: 0 });
  const narrator = createRoamNarrator({ roam });
  const said = narrator.orientation();
  assert.match(said, /You are in the main hallway, facing north\./);
  assert.match(said, /The bedroom door is ahead and slightly to the left\./);
  assert.match(said, /The kitchen door is ahead and slightly to the right\./);
  assert.match(said, /There is a wall directly ahead\./);
});

test('orientation facing away reports nothing close by', () => {
  const roam = createFreeRoam({ x: 5, y: 1.0, headingDeg: 180 });
  const narrator = createRoamNarrator({ roam });
  assert.match(narrator.orientation(), /Nothing close by\./);
});

test('bumping a wall names it once per block episode', () => {
  const roam = createFreeRoam({ x: 5, y: 1.0, headingDeg: 180 });
  const narrator = createRoamNarrator({ roam });
  narrator.update();
  roam.setMove('forward'); run(roam, 1.0); roam.stop();
  assert.equal(roam.state.blocked, true);
  assert.deepEqual(texts(narrator.update()), ['There is a wall directly ahead.']);
  assert.deepEqual(narrator.update(), [], 'the bump does not repeat');
});

test('bumping a closed door names the door', () => {
  const roam = createFreeRoam({ x: 3.9, y: 1.0, headingDeg: 0 });
  roam.setDoorOpen('bedroom-door', false);
  const narrator = createRoamNarrator({ roam });
  narrator.update();
  roam.setMove('forward'); run(roam, 1.0); roam.stop();
  assert.deepEqual(texts(narrator.update()), ['The bedroom door is closed.']);
});

test('bumping furniture names the furniture', () => {
  const roam = createFreeRoam({ x: 1.25, y: 3.5, headingDeg: 0 });
  const narrator = createRoamNarrator({ roam });
  narrator.update();
  roam.setMove('forward'); run(roam, 1.0); roam.stop();
  assert.deepEqual(texts(narrator.update()), ['A wooden table blocks your way.']);
});

test('nearest door finds the action-panel target', () => {
  const roam = createFreeRoam({ x: 3.9, y: 1.0, headingDeg: 0 });
  assert.equal(nearestDoor(roam).door.id, 'bedroom-door');
  roam.state.x = 1.3; roam.state.y = 5.5; // deep in the living room
  assert.equal(nearestDoor(roam), null, 'no door within reach');
});

test('orientation speaks eight-wind facing when set', () => {
  const roam = createFreeRoam({ x: 5, y: 1.0, headingDeg: 45 });
  const narrator = createRoamNarrator({ roam, facingSteps: 8 });
  assert.match(narrator.orientation(), /facing northeast/);
  narrator.setFacingSteps(4);
  assert.match(narrator.orientation(), /facing east/);
});

test('a nearby apple is announced by relative direction', () => {
  const roam = createFreeRoam({ x: 3.9, y: 4.2, headingDeg: 0 });
  const narrator = createRoamNarrator({ roam });
  narrator.update(); // room entry
  assert.deepEqual(texts(narrator.update()), ['An apple is ahead and slightly to the left.']);
});

test('the chest is announced, then the apple beside it, then the action hint', () => {
  const roam = createFreeRoam({ x: 0.7, y: 6.5, headingDeg: 0 });
  const narrator = createRoamNarrator({ roam });
  narrator.update(); // room entry
  assert.deepEqual(texts(narrator.update()), ['The wooden chest is directly ahead.']);
  assert.deepEqual(texts(narrator.update()), ['An apple is on your right.']);
  assert.deepEqual(texts(narrator.update()), ['Wooden chest nearby. Double tap to open it.']);
});

test('an apple in reach offers collection', () => {
  const roam = createFreeRoam({ x: 7.0, y: 2.9, headingDeg: 0 });
  const narrator = createRoamNarrator({ roam });
  narrator.update();
  assert.deepEqual(texts(narrator.update()), ['An apple is directly ahead.']);
  const rest = [texts(narrator.update()), texts(narrator.update()), texts(narrator.update())].flat();
  assert.ok(rest.includes('Apple nearby. Double tap to collect it.'));
});

test('taken apples and the opened chest go silent', () => {
  const roam = createFreeRoam({ x: 7.0, y: 2.9, headingDeg: 0 });
  roam.takeItem('apple-kitchen');
  const narrator = createRoamNarrator({ roam });
  const heard = [];
  for (let i = 0; i < 5; i++) heard.push(...texts(narrator.update()));
  assert.ok(heard.every((t) => !/apple/i.test(t)), 'no apple lines after taking');

  roam.state.x = 0.7; roam.state.y = 6.5;
  roam.openChest();
  const heard2 = [];
  for (let i = 0; i < 6; i++) heard2.push(...texts(narrator.update()));
  assert.ok(heard2.every((t) => !/chest/i.test(t)), 'no chest lines after opening');
});

test('the main entrance announces itself once per approach', () => {
  const roam = createFreeRoam({ x: 1.3, y: 1.5, headingDeg: 180 });
  const narrator = createRoamNarrator({ roam });
  narrator.update(); // room entry
  roam.state.y = 0.4;
  assert.deepEqual(texts(narrator.update()), ['You are at the main entrance. Swipe up to walk out to the city.']);
  assert.ok(!texts(narrator.update()).some((t) => /main entrance/.test(t)), 'no repeat while standing there');
  roam.state.y = 1.5; // step away resets the approach
  narrator.update();
  roam.state.y = 0.4;
  assert.deepEqual(texts(narrator.update()), ['You are at the main entrance. Swipe up to walk out to the city.']);
});

test('orientation at the entrance names the way out', () => {
  const roam = createFreeRoam({ x: 1.3, y: 0.4, headingDeg: 180 });
  const narrator = createRoamNarrator({ roam });
  assert.match(narrator.orientation(), /The main entrance is here\. Swipe up to walk out to the city\./);
});
