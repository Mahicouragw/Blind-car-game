/**
 * Spatial narrator for free-roam exploration (master prompt Phase 4).
 *
 * Pure logic: it reads a free-roam world and returns announcement events.
 * The screen speaks them. It understands room, facing, nearby doors and
 * furniture by relative direction, and what stops the player.
 *
 * Anti-spam rules: room entries speak once per visit; each nearby target
 * speaks once per approach (leaving range resets it); bumps speak once per
 * block episode; the action hint only speaks when it changes and nothing
 * more important is happening.
 *
 * @module world/roamNarrate
 */

const DOOR_RANGE_M = 3.0;
const FURNITURE_RANGE_M = 2.5;
const ACTION_RANGE_M = 1.6;
const RESET_MARGIN_M = 1.5;

function center(rect) {
  return { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** Bearing in heading-degrees: 0 = north (+y), 90 = east (+x). */
function bearingTo(fx, fy, tx, ty) {
  return ((Math.atan2(tx - fx, ty - fy) * 180) / Math.PI + 360) % 360;
}

/** Signed turn from facing to bearing, in [-180, 180]; + means right. */
function relativeAngle(facing, bearing) {
  return ((bearing - facing + 540) % 360) - 180;
}

/**
 * Master-prompt wording: directly ahead, ahead-and-slightly, on the side.
 * Returns null for targets behind the player (never announced unprompted).
 */
export function relativeDirection(facing, fx, fy, tx, ty) {
  const d = relativeAngle(facing, bearingTo(fx, fy, tx, ty));
  const side = d > 0 ? 'right' : 'left';
  const a = Math.abs(d);
  if (a <= 25) return 'directly ahead';
  if (a <= 65) return `ahead and slightly to the ${side}`;
  if (a <= 125) return `on your ${side}`;
  return null;
}

function roomName(map, id) {
  return map.rooms.find((r) => r.id === id)?.name ?? id;
}

/** Nearest door gap to the player, within maxDist. */
export function nearestDoor(roam, maxDist = ACTION_RANGE_M) {
  let best = null;
  for (const d of roam.map.doors) {
    const c = center(d);
    const m = dist(roam.state.x, roam.state.y, c.x, c.y);
    if (m <= maxDist && (!best || m < best.dist)) best = { door: d, dist: m };
  }
  return best;
}

/**
 * What solid thing (if any) sits at a point: a closed door, furniture,
 * or a wall/bounds. Used to name what the player bumped into.
 */
function whatsAt(roam, x, y) {
  const inside = (r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  for (const d of roam.map.doors) {
    if (!roam.isDoorOpen(d.id) && inside(d)) return { kind: 'door', door: d };
  }
  for (const f of roam.map.furniture) {
    if (inside(f)) return { kind: 'furniture', furniture: f };
  }
  return { kind: 'wall' };
}

function pointAhead(roam, metres) {
  const t = (roam.state.headingDeg * Math.PI) / 180;
  return { x: roam.state.x + Math.sin(t) * metres, y: roam.state.y + Math.cos(t) * metres };
}

export function createRoamNarrator({ roam, facingSteps = 4 }) {
  let lastRoom = null;
  // 8-wind facing words when the turn-angle setting is 45 degrees.
  const api = { update, orientation, setFacingSteps };
  function setFacingSteps(n) { facingSteps = n === 8 ? 8 : 4; }
  let blockedActive = false;
  let lastActionKey = null;
  const announced = new Set();

  function bumpText() {
    const p = pointAhead(roam, 0.4);
    const hit = whatsAt(roam, p.x, p.y);
    if (hit.kind === 'door') return `The ${hit.door.name} is closed.`;
    if (hit.kind === 'furniture') return `A ${hit.furniture.name} blocks your way.`;
    return 'There is a wall directly ahead.';
  }

  function nearbyTargets() {
    const { x, y, headingDeg } = roam.state;
    const out = [];
    for (const d of roam.map.doors) {
      const c = center(d);
      const m = dist(x, y, c.x, c.y);
      if (m > DOOR_RANGE_M) continue;
      const rel = relativeDirection(headingDeg, x, y, c.x, c.y);
      if (!rel) continue;
      out.push({ key: `door:${d.id}`, dist: m, text: `The ${d.name} is ${rel}.` });
    }
    for (const f of roam.map.furniture) {
      const c = center(f);
      const m = dist(x, y, c.x, c.y);
      if (m > FURNITURE_RANGE_M) continue;
      const rel = relativeDirection(headingDeg, x, y, c.x, c.y);
      if (!rel) continue;
      out.push({ key: `fur:${f.id}`, dist: m, text: `A ${f.name} is ${rel}.` });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  /** On-demand orientation: room, facing, and the nearest surroundings. */
  function orientation() {
    const room = roam.roomAt();
    const parts = [`You are in the ${roomName(roam.map, room)}, facing ${roam.facing(facingSteps)}.`];
    const near = nearbyTargets().slice(0, 3);
    for (const t of near) parts.push(t.text);
    if (near.length === 0) parts.push('Nothing close by.');
    const p = pointAhead(roam, 1.0);
    if (roam.solidAt(p.x, p.y)) {
      const hit = whatsAt(roam, p.x, p.y);
      if (hit.kind === 'wall') parts.push('There is a wall directly ahead.');
      else if (hit.kind === 'door') parts.push(`The ${hit.door.name} is closed, directly ahead.`);
    }
    return parts.join(' ');
  }

  /**
   * Poll after each world update. Returns announcement events ordered by
   * importance; the screen speaks the first.
   */
  function update() {
    const room = roam.roomAt();
    if (room !== lastRoom) {
      lastRoom = room;
      announced.clear();
      blockedActive = false;
      lastActionKey = null;
      return [{ text: `You are standing in the ${roomName(roam.map, room)}.`, priority: 4 }];
    }
    if (roam.state.blocked && !blockedActive) {
      blockedActive = true;
      return [{ text: bumpText(), priority: 4 }];
    }
    if (!roam.state.blocked) blockedActive = false;

    // Leaving range resets a target, so returning re-announces it once.
    for (const key of [...announced]) {
      const [kind, id] = key.split(':');
      const list = kind === 'door' ? roam.map.doors : roam.map.furniture;
      const target = list.find((t) => t.id === id);
      const range = (kind === 'door' ? DOOR_RANGE_M : FURNITURE_RANGE_M) + RESET_MARGIN_M;
      if (!target || dist(roam.state.x, roam.state.y, center(target).x, center(target).y) > range) {
        announced.delete(key);
      }
    }
    const fresh = nearbyTargets().find((t) => !announced.has(t.key));
    if (fresh) {
      announced.add(fresh.key);
      return [{ text: fresh.text, priority: 2 }];
    }

    // Action panel hint: only when it changes, and only when quiet.
    const near = nearestDoor(roam);
    const key = near ? `${near.door.id}:${roam.isDoorOpen(near.door.id) ? 'open' : 'closed'}` : null;
    if (key !== lastActionKey) {
      lastActionKey = key;
      if (near) {
        const verb = roam.isDoorOpen(near.door.id) ? 'close' : 'open';
        return [{ text: `${cap(near.door.name)} nearby. Tap to ${verb} it.`, priority: 1, action: { type: 'door', id: near.door.id } }];
      }
    }
    return [];
  }

  return api;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
