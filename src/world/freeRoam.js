/**
 * Free-roam 2D movement + collision foundation (master prompt Phases 1-3 data).
 *
 * This is the spatial layer the old 1D walkers (distance-along-a-loop with
 * scripted "turn in N metres" prompts) never had: a real position (x, y in
 * metres), a real facing heading, and independent move/turn controls.
 * Turning never moves the player; moving never turns the player.
 *
 * - Heading degrees: 0 = north (+y), 90 = east (+x), 180 = south, 270 = west.
 * - Turning right increases heading (clockwise seen from above).
 * - The player is a circle; walls, furniture and closed doors are solid
 *   rectangles. Movement is axis-separated, so the player slides along walls
 *   and can walk around furniture instead of sticking to it.
 * - Rooms connect through physical door gaps. Nothing teleports: to change
 *   rooms the player walks through a doorway.
 *
 * Pure logic, no DOM/audio: fully unit-testable. Narration (Phase 4) and
 * screen wiring (Phase 5-6) build on top of this.
 *
 * @module world/freeRoam
 */

export const WALK_SPEED_M_S = 1.2;
export const TURN_SPEED_DEG_S = 90;
export const PLAYER_RADIUS_M = 0.25;
/** Physics substep: small enough that one step never tunnels a wall. */
const MAX_SUBSTEP_S = 0.05;

const MOVES = ['forward', 'backward', 'strafeLeft', 'strafeRight'];
const TURNS = ['left', 'right'];

/**
 * Connected starter house: hallway + living room, bedroom, kitchen, washroom.
 * All rooms open onto the hallway through 1 m door gaps; the south wall has
 * the main entrance gap (wired to outdoor travel in Phase 5).
 */
export const HOUSE_MAP = {
  bounds: { x0: 0, y0: 0, x1: 10, y1: 8 },
  rooms: [
    { id: 'hallway', name: 'main hallway', x0: 0, y0: 0, x1: 10, y1: 2 },
    { id: 'living', name: 'living room', x0: 0, y0: 2, x1: 2.5, y1: 8 },
    { id: 'bedroom', name: 'bedroom', x0: 2.5, y0: 2, x1: 5, y1: 8 },
    { id: 'kitchen', name: 'kitchen', x0: 5, y0: 2, x1: 7.5, y1: 8 },
    { id: 'washroom', name: 'washroom', x0: 7.5, y0: 2, x1: 10, y1: 8 },
  ],
  // Solid wall rectangles. Door gaps are simply absent wall; a closed door
  // fills its gap via `doors` below.
  walls: [
    { x0: 0, y0: -0.2, x1: 0.8, y1: 0 }, // south, west of entrance
    { x0: 1.8, y0: -0.2, x1: 10, y1: 0 }, // south, east of entrance
    { x0: 0, y0: 8, x1: 10, y1: 8.2 }, // north
    { x0: -0.2, y0: 0, x1: 0, y1: 8 }, // west
    { x0: 10, y0: 0, x1: 10.2, y1: 8 }, // east
    // Hallway/rooms divider (y = 2) with four 1 m door gaps.
    { x0: 0, y0: 1.9, x1: 1.0, y1: 2.1 },
    { x0: 2.0, y0: 1.9, x1: 3.4, y1: 2.1 },
    { x0: 4.4, y0: 1.9, x1: 5.9, y1: 2.1 },
    { x0: 6.9, y0: 1.9, x1: 8.2, y1: 2.1 },
    { x0: 9.2, y0: 1.9, x1: 10, y1: 2.1 },
    // Room dividers.
    { x0: 2.4, y0: 2, x1: 2.6, y1: 8 },
    { x0: 4.9, y0: 2, x1: 5.1, y1: 8 },
    { x0: 7.4, y0: 2, x1: 7.6, y1: 8 },
  ],
  doors: [
    { id: 'living-door', name: 'living room door', x0: 1.0, y0: 1.9, x1: 2.0, y1: 2.1, open: true },
    { id: 'bedroom-door', name: 'bedroom door', x0: 3.4, y0: 1.9, x1: 4.4, y1: 2.1, open: true },
    { id: 'kitchen-door', name: 'kitchen door', x0: 5.9, y0: 1.9, x1: 6.9, y1: 2.1, open: true },
    { id: 'washroom-door', name: 'washroom door', x0: 8.2, y0: 1.9, x1: 9.2, y1: 2.1, open: true },
  ],
  furniture: [
    { id: 'living-table', name: 'wooden table', x0: 0.8, y0: 4.5, x1: 1.7, y1: 5.5 },
    { id: 'living-chair-w', name: 'chair', x0: 0.35, y0: 4.7, x1: 0.7, y1: 5.3 },
    { id: 'living-chair-n', name: 'chair', x0: 1.0, y0: 5.6, x1: 1.5, y1: 5.95 },
    { id: 'bed', name: 'bed', x0: 2.7, y0: 6.4, x1: 4.3, y1: 7.6 },
    { id: 'kitchen-table', name: 'kitchen table', x0: 5.9, y0: 4.0, x1: 6.9, y1: 5.0 },
    { id: 'kitchen-counter', name: 'kitchen counter', x0: 5.2, y0: 6.8, x1: 7.2, y1: 7.6 },
    { id: 'wash-basin', name: 'wash basin', x0: 7.7, y0: 6.8, x1: 8.5, y1: 7.6 },
  ],
  start: { x: 1.3, y: 1.0, headingDeg: 0 },
};

export function normalizeHeading(deg) {
  return ((deg % 360) + 360) % 360;
}

function circleHitsRect(x, y, r, rect) {
  const cx = Math.min(Math.max(x, rect.x0), rect.x1);
  const cy = Math.min(Math.max(y, rect.y0), rect.y1);
  return Math.hypot(x - cx, y - cy) < r;
}

/**
 * True when the circle (x, y, r) overlaps anything solid: map bounds, walls,
 * furniture, or a door whose id is not open.
 */
export function hitsSolid(map, x, y, r, doorOpen) {
  const b = map.bounds;
  if (x - r < b.x0 || x + r > b.x1 || y - r < b.y0 || y + r > b.y1) return true;
  for (const w of map.walls) if (circleHitsRect(x, y, r, w)) return true;
  for (const f of map.furniture) if (circleHitsRect(x, y, r, f)) return true;
  for (const d of map.doors) {
    const open = doorOpen ? doorOpen(d.id, d.open) : d.open;
    if (!open && circleHitsRect(x, y, r, d)) return true;
  }
  return false;
}

const CARDINALS = ['north', 'east', 'south', 'west'];

export function createFreeRoam({
  map = HOUSE_MAP,
  x = map.start.x,
  y = map.start.y,
  headingDeg = map.start.headingDeg,
  radius = PLAYER_RADIUS_M,
  walkSpeed = WALK_SPEED_M_S,
  turnSpeed = TURN_SPEED_DEG_S,
} = {}) {
  const doors = new Map(map.doors.map((d) => [d.id, d.open !== false]));
  const state = {
    x, y,
    headingDeg: normalizeHeading(headingDeg),
    moving: null,
    turning: null,
    /** True when the latest update() was stopped by something solid. */
    blocked: false,
  };
  const doorOpen = (id, fallback) => (doors.has(id) ? doors.get(id) : fallback);
  const solidAt = (px, py) => hitsSolid(map, px, py, radius, doorOpen);

  function roomAt() {
    for (const r of map.rooms) {
      if (r.id === 'hallway') continue;
      if (state.x >= r.x0 && state.x < r.x1 && state.y >= r.y0 && state.y < r.y1) return r.id;
    }
    return 'hallway';
  }

  function facing() {
    return CARDINALS[Math.round(state.headingDeg / 90) % 4];
  }

  function setMove(mode) {
    if (mode !== null && !MOVES.includes(mode)) throw new Error(`Unknown move: ${mode}`);
    state.moving = mode;
  }

  function setTurn(dir) {
    if (dir !== null && !TURNS.includes(dir)) throw new Error(`Unknown turn: ${dir}`);
    state.turning = dir;
  }

  function stop() {
    state.moving = null;
    state.turning = null;
  }

  function setDoorOpen(id, open) {
    if (!doors.has(id)) throw new Error(`Unknown door: ${id}`);
    doors.set(id, open === true);
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    state.blocked = false;
    const steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP_S));
    const h = dt / steps;
    const rad = () => (state.headingDeg * Math.PI) / 180;
    for (let i = 0; i < steps; i++) {
      // Turning and moving are independent: either, both, or neither.
      if (state.turning === 'right') state.headingDeg = normalizeHeading(state.headingDeg + turnSpeed * h);
      else if (state.turning === 'left') state.headingDeg = normalizeHeading(state.headingDeg - turnSpeed * h);
      if (state.moving) {
        const t = rad();
        // Forward = facing vector; strafe = side vector; facing never changes.
        let vx = 0; let vy = 0;
        if (state.moving === 'forward') { vx = Math.sin(t); vy = Math.cos(t); }
        else if (state.moving === 'backward') { vx = -Math.sin(t); vy = -Math.cos(t); }
        else if (state.moving === 'strafeRight') { vx = Math.cos(t); vy = -Math.sin(t); }
        else if (state.moving === 'strafeLeft') { vx = -Math.cos(t); vy = Math.sin(t); }
        // Axis-separated: slide along walls instead of sticking to them.
        const nx = state.x + vx * walkSpeed * h;
        if (!solidAt(nx, state.y)) state.x = nx;
        else state.blocked = true;
        const ny = state.y + vy * walkSpeed * h;
        if (!solidAt(state.x, ny)) state.y = ny;
        else state.blocked = true;
      }
    }
  }

  return {
    state, map,
    setMove, setTurn, stop, update,
    setDoorOpen, isDoorOpen: (id) => doorOpen(id, false),
    roomAt, facing, solidAt,
  };
}
