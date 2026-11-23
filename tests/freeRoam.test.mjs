/** Master-prompt movement scenarios 1-11: free-roam foundation (Phases 1-2). */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFreeRoam, HOUSE_MAP } from '../src/world/freeRoam.js';

const NEAR = 0.06;
function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < NEAR, `${label}: ${actual} should be near ${expected}`);
}
/** Advance in 0.1 s ticks, like the game loop. */
function run(roam, secs) {
  const n = Math.round(secs / 0.1);
  for (let i = 0; i < n; i++) roam.update(0.1);
}

// 1. Walk forward and stop.
test('walk forward moves ahead of the facing direction, stop halts', () => {
  const roam = createFreeRoam({ x: 1.25, y: 3.0, headingDeg: 0 });
  roam.setMove('forward'); run(roam, 1.0); roam.stop();
  near(roam.state.x, 1.25, 'x unchanged');
  near(roam.state.y, 4.2, 'y advanced 1.2 m north');
  run(roam, 1.0);
  near(roam.state.y, 4.2, 'stopped dead');
  assert.equal(roam.state.moving, null);
});

// 2. Turn right without moving.
test('turn right rotates facing but never moves', () => {
  const roam = createFreeRoam({ x: 1.25, y: 3.0, headingDeg: 0 });
  roam.setTurn('right'); run(roam, 1.0); roam.stop();
  near(roam.state.headingDeg, 90, 'now facing east');
  assert.equal(roam.facing(), 'east');
  near(roam.state.x, 1.25, 'x unchanged');
  near(roam.state.y, 3.0, 'y unchanged');
});

// 3. Turn left without moving.
test('turn left rotates facing but never moves', () => {
  const roam = createFreeRoam({ x: 1.25, y: 3.0, headingDeg: 90 });
  roam.setTurn('left'); run(roam, 1.0); roam.stop();
  near(roam.state.headingDeg, 0, 'now facing north');
  near(roam.state.x, 1.25, 'x unchanged');
  near(roam.state.y, 3.0, 'y unchanged');
});

// 4. Walk backward.
test('walk backward retreats without turning', () => {
  const roam = createFreeRoam({ x: 1.25, y: 3.0, headingDeg: 0 });
  roam.setMove('backward'); run(roam, 0.5); roam.stop();
  near(roam.state.y, 2.4, 'y retreated south');
  near(roam.state.x, 1.25, 'x unchanged');
  near(roam.state.headingDeg, 0, 'still facing north');
});

// 5. Strafe left and right.
test('strafe moves sideways without changing facing', () => {
  const roam = createFreeRoam({ x: 1.0, y: 3.0, headingDeg: 0 });
  roam.setMove('strafeRight'); run(roam, 0.5);
  near(roam.state.x, 1.6, 'sidestepped east');
  near(roam.state.y, 3.0, 'y unchanged');
  roam.setMove('strafeLeft'); run(roam, 0.5); roam.stop();
  near(roam.state.x, 1.0, 'sidestepped back west');
  near(roam.state.headingDeg, 0, 'facing never changed');
});

// Move and turn are independent: both can run together.
test('moving and turning are independent controls', () => {
  const roam = createFreeRoam({ x: 1.25, y: 3.0, headingDeg: 0 });
  roam.setMove('forward'); roam.setTurn('right'); run(roam, 0.5); roam.stop();
  assert.ok(roam.state.headingDeg > 30, 'turned while walking');
  assert.ok(roam.state.y > 3.1, 'walked while turning');
});

// 6. Approach a wall and stop safely.
test('a wall stops movement safely, never penetrated', () => {
  const roam = createFreeRoam({ x: 5, y: 1.0, headingDeg: 180 });
  roam.setMove('forward'); run(roam, 2.0); roam.stop();
  assert.equal(roam.state.blocked, true);
  near(roam.state.y, 0.25, 'rests one body-radius off the wall');
  near(roam.state.x, 5, 'x unchanged');
  assert.equal(roam.solidAt(roam.state.x, roam.state.y), false);
});

// 7. Walk around a table.
test('walk around the living-room table without passing through it', () => {
  const roam = createFreeRoam({ x: 1.25, y: 3.5, headingDeg: 0 });
  roam.setMove('forward'); run(roam, 1.0);
  assert.equal(roam.state.blocked, true, 'table stops the north walk');
  near(roam.state.y, 4.25, 'stopped south of the table');
  roam.setMove('strafeRight'); run(roam, 0.6);
  assert.ok(roam.state.x > 1.9, 'sidestepped clear of the table edge');
  roam.setMove('forward'); run(roam, 1.5); roam.stop();
  assert.ok(roam.state.y > 5.5, `ended north of the table (y=${roam.state.y})`);
  assert.equal(roam.solidAt(roam.state.x, roam.state.y), false);
});

// 8. Find and enter a bedroom through its doorway (no teleport).
test('walk through the bedroom doorway into the bedroom', () => {
  const roam = createFreeRoam({ x: 3.9, y: 1.0, headingDeg: 0 });
  assert.equal(roam.roomAt(), 'hallway');
  roam.setMove('forward'); run(roam, 1.5); roam.stop();
  near(roam.state.y, 2.8, 'walked through the door gap');
  assert.equal(roam.roomAt(), 'bedroom');
});

// 9. Turn around inside the bedroom.
test('turn around inside the bedroom without leaving it', () => {
  const roam = createFreeRoam({ x: 3.9, y: 2.8, headingDeg: 0 });
  roam.setTurn('right'); run(roam, 2.0); roam.stop();
  near(roam.state.headingDeg, 180, 'facing back south');
  near(roam.state.x, 3.9, 'position unchanged');
  near(roam.state.y, 2.8, 'position unchanged');
  assert.equal(roam.roomAt(), 'bedroom');
});

// 10. Find the doorway and return to the hallway.
test('walk back through the doorway into the hallway', () => {
  const roam = createFreeRoam({ x: 3.9, y: 2.8, headingDeg: 180 });
  roam.setMove('forward'); run(roam, 1.5); roam.stop();
  near(roam.state.y, 1.0, 'walked back through the door gap');
  assert.equal(roam.roomAt(), 'hallway');
});

// 11. Choose a left or right path at an intersection.
test('hallway intersection: freely choose kitchen or washroom', () => {
  const toKitchen = createFreeRoam({ x: 6.4, y: 1.0, headingDeg: 0 });
  toKitchen.setMove('forward'); run(toKitchen, 1.5); toKitchen.stop();
  assert.equal(toKitchen.roomAt(), 'kitchen');

  const toWashroom = createFreeRoam({ x: 6.4, y: 1.0, headingDeg: 90 });
  toWashroom.setMove('forward'); run(toWashroom, 1.9); toWashroom.stop();
  toWashroom.setTurn('left'); run(toWashroom, 1.0); toWashroom.stop();
  near(toWashroom.state.headingDeg, 0, 'turned to face the washroom door');
  toWashroom.setMove('forward'); run(toWashroom, 1.5); toWashroom.stop();
  assert.equal(toWashroom.roomAt(), 'washroom');
});

// Closed doors are solid; opening one allows passage.
test('a closed door blocks entry until it is opened', () => {
  const roam = createFreeRoam({ x: 3.9, y: 1.0, headingDeg: 0 });
  roam.setDoorOpen('bedroom-door', false);
  roam.setMove('forward'); run(roam, 1.5); roam.stop();
  assert.equal(roam.state.blocked, true);
  assert.ok(roam.state.y < 1.8, 'stopped at the closed door');
  assert.equal(roam.roomAt(), 'hallway');
  roam.setDoorOpen('bedroom-door', true);
  roam.setMove('forward'); run(roam, 1.5); roam.stop();
  assert.equal(roam.roomAt(), 'bedroom');
});

test('the starter map is fully connected through door gaps', () => {
  // Every room door gap sits on the hallway wall line, wide enough to pass.
  for (const d of HOUSE_MAP.doors) {
    assert.ok(d.x1 - d.x0 >= 0.8, `${d.id} is walkable`);
    assert.ok(d.y0 < 2 && d.y1 > 2, `${d.id} straddles the hallway wall`);
  }
  assert.equal(HOUSE_MAP.rooms.length, 5);
});

test('eight-wind facing names diagonals for 45-degree turns', () => {
  const roam = createFreeRoam({ headingDeg: 45 });
  assert.equal(roam.facing(), 'east', 'cardinal default rounds up');
  assert.equal(roam.facing(8), 'northeast');
  roam.state.headingDeg = 225;
  assert.equal(roam.facing(8), 'southwest');
  roam.state.headingDeg = 359;
  assert.equal(roam.facing(8), 'north', '359 rounds to north');
});

test('items rest on walkable ground in their rooms; the chest is solid but approachable', () => {
  const roam = createFreeRoam({});
  const rooms = { 'apple-living': 'living', 'apple-bedroom': 'bedroom', 'apple-kitchen': 'kitchen' };
  for (const item of HOUSE_MAP.items) {
    assert.equal(roam.solidAt(item.x, item.y), false, `${item.id} is reachable`);
    roam.state.x = item.x; roam.state.y = item.y;
    assert.equal(roam.roomAt(), rooms[item.id]);
  }
  assert.equal(roam.solidAt(0.7, 7.35), true, 'inside the chest is solid');
  assert.equal(roam.solidAt(0.7, 6.5), false, 'south of the chest is walkable');
});

test('taking an apple fills the satchel once and only once', () => {
  const roam = createFreeRoam({});
  assert.equal(roam.takeItem('apple-kitchen').id, 'apple-kitchen');
  assert.equal(roam.store.apples, 1);
  assert.equal(roam.isTaken('apple-kitchen'), true);
  assert.equal(roam.takeItem('apple-kitchen'), null, 'no double take');
  assert.equal(roam.takeItem('nope'), null, 'unknown items give nothing');
  assert.equal(roam.store.apples, 1);
});

test('the chest opens once with its loot', () => {
  const roam = createFreeRoam({});
  assert.deepEqual(roam.openChest(), { coins: 5, apples: 2 });
  assert.equal(roam.chestOpened(), true);
  assert.equal(roam.openChest(), null, 'no second loot');
});

test('the nearest usable thing wins across doors, items and the chest', () => {
  const roam = createFreeRoam({ x: 1.3, y: 1.0 });
  assert.equal(roam.nearestInteractable().id, 'living-door');
  roam.state.x = 7.0; roam.state.y = 2.9;
  const near = roam.nearestInteractable();
  assert.equal(near.kind, 'item');
  assert.equal(near.id, 'apple-kitchen');
  roam.state.x = 0.7; roam.state.y = 6.5;
  assert.equal(roam.nearestInteractable().kind, 'chest');
  roam.state.x = 5; roam.state.y = 0.5;
  assert.equal(roam.nearestInteractable(), null, 'nothing in reach mid-hallway');
});

test('takes persist through a shared store', () => {
  const store = { apples: 0, chestOpened: false, taken: [] };
  createFreeRoam({ store }).takeItem('apple-living');
  assert.deepEqual(store.taken, ['apple-living']);
  const again = createFreeRoam({ store });
  assert.equal(again.isTaken('apple-living'), true);
  const rest = again.nearestItem(99);
  assert.ok(rest && rest.item.id !== 'apple-living', 'taken apples are skipped');
});

test('save files carry the roam satchel with safe defaults', async () => {
  const { coerceSave } = await import('../src/core/save.js');
  assert.deepEqual(coerceSave({}).save.roam, { apples: 0, chestOpened: false, taken: [] });
  const dirty = coerceSave({ roam: { apples: -5, chestOpened: 'yes', taken: 'x' } }).save.roam;
  assert.deepEqual(dirty, { apples: 0, chestOpened: false, taken: [] });
});
