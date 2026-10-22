/**
 * Track navigation: turns the car's real position, heading and speed plus the
 * measured circuit geometry into spoken facts.
 *
 * Requirement 3 is explicit that announcements must come from actual geometry
 * and never be random. Everything here is derived: `navigationFacts()` measures
 * where the car is, and `createAnnouncementDirector()` decides what is worth
 * saying right now. Both are pure and both are unit tested.
 *
 * @module race/navigation
 */

import { zoneAtS } from '../world/trackData.js';
import { cornerSpeed, toKph, wrapPi, resolveSurface, barrierDistance } from '../vehicles/physics.js';
import { WARNING_DISTANCE, NAV_FREQUENCY } from '../a11y/settings.js';

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];

export function ordinal(n) {
  return ORDINALS[n - 1] ?? `${n}th`;
}

/** 'left' | 'right' | 'ahead' | 'behind' from the player's point of view. */
export function relativeBearing(playerHeading, playerX, playerZ, otherX, otherZ) {
  const dx = otherX - playerX;
  const dz = otherZ - playerZ;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.001) return { side: 'alongside', distance: 0, angle: 0 };
  // Player forward vector and right vector in this frame.
  const fx = Math.cos(playerHeading);
  const fz = -Math.sin(playerHeading);
  const rx = -fz;
  const rz = fx;
  const forward = dx * fx + dz * fz;
  const right = dx * rx + dz * rz;
  let side;
  if (Math.abs(forward) > Math.abs(right) * 1.3) side = forward > 0 ? 'ahead' : 'behind';
  else if (Math.abs(right) > Math.abs(forward) * 1.3) side = right > 0 ? 'right' : 'left';
  else side = forward > 0 ? (right > 0 ? 'ahead right' : 'ahead left') : right > 0 ? 'behind right' : 'behind left';
  return { side, distance: dist, forward, right, angle: Math.atan2(right, forward) };
}

/**
 * Measure everything the voice system needs to know about the car right now.
 *
 * @param {object} track
 * @param {{x:number,z:number,heading:number,speed:number}} car speed in m/s
 * @param {object} [opts]
 */
export function navigationFacts(track, car, opts = {}) {
  const g = track.geometry;
  const near = g.nearest(car.x, car.z);
  const s = g.normaliseS(near.s);
  const lateral = near.lateral;
  const absLateral = Math.abs(lateral);
  const zone = zoneAtS(track, s);
  const speed = car.speed;
  const speedKph = toKph(speed);

  // Heading error: how far the car points away from the track direction.
  const headingError = wrapPi(car.heading - near.heading);

  const onTrack = absLateral <= g.halfWidth;
  const offTrack = absLateral > g.halfWidth + 0.8;
  const surface = opts.surface ?? (offTrack ? (absLateral > g.halfWidth + 7 ? 'gravel' : 'grass') : 'track');

  // --- next corner, scanning forward from here ---
  let nextCorner = null;
  const scanLimit = Math.min(g.length * 0.9, 900);
  for (const z of track.zones) {
    if (z.kind !== 'corner' && z.kind !== 'chicane') continue;
    let d = (z.from - s + g.length) % g.length;
    if (d > scanLimit) continue;
    if (!nextCorner || d < nextCorner.distanceM) {
      nextCorner = {
        id: z.id,
        name: z.name,
        label: z.label,
        kind: z.kind,
        direction: z.direction,
        severity: z.severity,
        radius: z.radius,
        distanceM: d,
        totalAngle: z.totalAngle ?? 0,
        callout: z.callout ?? null,
      };
    }
  }

  // --- distance to the start/finish line, and lap progress ---
  const toFinish = (track.startFinishS - s + g.length) % g.length;
  const lapProgress = 1 - toFinish / g.length;

  // --- pit lane mouth ---
  const toPitEntry = (track.pitEntryS - s + g.length) % g.length;
  const pitEntrySide = 'right';

  // --- recovery direction when off track ---
  let recovery = null;
  if (offTrack) {
    // To get back, steer towards the centre-line: if the car is right of it
    // (lateral > 0) the centre-line is to the car's left in track terms.
    const towardCentre = lateral > 0 ? 'left' : 'right';
    // But that is in TRACK coordinates. Convert to the car's own frame using
    // the heading error so the instruction is always correct for the driver.
    const carFrame =
      Math.abs(headingError) > Math.PI * 0.6
        ? towardCentre === 'left'
          ? 'right'
          : 'left'
        : towardCentre;
    recovery = {
      steer: carFrame,
      distanceM: Math.max(0, absLateral - g.halfWidth),
      facingTrackWay: Math.abs(headingError) < Math.PI * 0.5,
      headingErrorDeg: (headingError * 180) / Math.PI,
    };
  }

  // --- is the car too fast for what is coming? ---
  let tooFast = false;
  let suggestedSpeedKph = null;
  if (nextCorner && nextCorner.distanceM < 220 && Number.isFinite(nextCorner.radius)) {
    const carForCorner = opts.car ?? null;
    const mu = carForCorner ? carForCorner.gripMu : 1.0;
    const vmax = cornerSpeed({ gripMu: mu }, nextCorner.radius, opts.gripMultiplier ?? 1);
    suggestedSpeedKph = toKph(vmax);
    // Braking distance from current speed at a comfortable 0.8 g.
    const brakeDistance = (speed * speed) / (2 * 0.8 * 9.81);
    tooFast = brakeDistance > nextCorner.distanceM * 0.85 && speedKph > suggestedSpeedKph + 12;
  }

  // --- what is around the car? (the "you can go right" scout) ---
  // Sample the world in the CAR's frame: a few metres ahead on each side. The
  // player asked to hear what is on the left, what is on the right, and which
  // way there is room to go - 5 to 10 seconds before it matters.
  const look = lookAround(track, car);

  return {
    s,
    lateral,
    absLateral,
    zone,
    zoneId: zone.id,
    zoneKind: zone.kind,
    zoneName: zone.name,
    onTrack,
    offTrack,
    surface,
    headingError,
    headingErrorDeg: (headingError * 180) / Math.PI,
    speedKph,
    speed,
    nextCorner,
    toFinish,
    lapProgress,
    toPitEntry,
    pitEntrySide,
    recovery,
    tooFast,
    suggestedSpeedKph,
    look,
    trackLength: g.length,
  };
}

/**
 * What is around the car, in the car's own frame: is the left tight, is the
 * right tight, is there a barrier close on one side, are there kerbs ("speed
 * breakers")? Sampled from real geometry with `resolveSurface` and
 * `barrierDistance` - never guessed - so the words always match the world.
 *
 * Forward is `(cos h, -sin h)` and the car's left is `(-sin h, -cos h)`
 * (increasing heading is left in this model). Side samples sit 2.6 m out and
 * 6-20 m ahead: exactly the window the driver can still react in.
 *
 * @param {object} track
 * @param {{x:number, z:number, heading:number}} car
 */
export function lookAround(track, car) {
  const h = car.heading ?? 0;
  const fx = Math.cos(h);
  const fz = -Math.sin(h);
  const lx = -Math.sin(h);
  const lz = -Math.cos(h);
  const RANGES = [6, 13, 20];

  function sample(ahead, sideOffset) {
    const x = car.x + fx * ahead + lx * sideOffset;
    const z = car.z + fz * ahead + lz * sideOffset;
    const surf = resolveSurface(track, x, z);
    const bar = barrierDistance(track, x, z);
    return {
      surf: surf.surface,
      offTrack: surf.offTrack,
      barrier: bar.distance < 2.5,
      kerb: surf.surface === 'kerb',
    };
  }

  const left = RANGES.map((r) => sample(r, 2.6));
  const right = RANGES.map((r) => sample(r, -2.6));
  const ahead = [12, 20].map((r) => sample(r, 0));

  return {
    left: {
      tight: left.some((s) => s.offTrack || s.kerb),
      barrier: left.some((s) => s.barrier),
      kerb: left.some((s) => s.kerb),
    },
    right: {
      tight: right.some((s) => s.offTrack || s.kerb),
      barrier: right.some((s) => s.barrier),
      kerb: right.some((s) => s.kerb),
    },
    aheadTight: ahead.some((s) => s.offTrack),
  };
}

/**
 * The announcement director: given measured facts, decide what deserves to be
 * spoken, and phrase it. Returns plain speech items for the queue to schedule.
 *
 * It is deliberately conservative. Nothing is announced unless the facts
 * support it - no "you overtook" unless the race state really changed.
 */
export function createAnnouncementDirector(config = {}) {
  const state = {
    lastZoneId: null,
    lastZoneKind: null,
    warnedCorners: new Set(),
    brakeCalledCorners: new Set(),
    lastPosition: null,
    lastLap: null,
    finishAnnounced: false,
    offTrackAnnouncedAt: -Infinity,
    recoveryStepCount: 0,
    lastSpeedBand: null,
    lastSpeedAnnounceAt: -Infinity,
    lastCoachAt: -Infinity,
    /** Per-corner distance-callout state: {lastAt, said:Set, first}. */
    callouts: new Map(),
    lastScoutAt: -Infinity,
    opponentCooldownUntil: new Map(),
    started: false,
  };

  const settings = config.settings ?? {
    warningDistance: 'normal',
    navFrequency: 'balanced',
    conciseSpeech: false,
    speakSpeedLaps: true,
    speakPosition: true,
    speakOpponents: true,
  };
  let getSettings = config.getSettings ?? (() => settings);
  let now = config.now ?? (() => Date.now());

  function warningMetres() {
    const s = getSettings();
    return (WARNING_DISTANCE.find((w) => w.id === s.warningDistance) ?? WARNING_DISTANCE[1]).metres;
  }
  function frequencyFactor() {
    const s = getSettings();
    return (NAV_FREQUENCY.find((f) => f.id === s.navFrequency) ?? NAV_FREQUENCY[1]).factor;
  }
  const api = {
    state,
    setClock(fn) {
      now = fn;
    },
    setSettingsSource(fn) {
      getSettings = fn;
    },

    /** Reset between sessions so warnings are not carried over. */
    reset() {
      state.lastZoneId = null;
      state.lastZoneKind = null;
      state.warnedCorners.clear();
      state.brakeCalledCorners.clear();
      state.lastPosition = null;
      state.lastLap = null;
      state.finishAnnounced = false;
      state.offTrackAnnouncedAt = -Infinity;
      state.recoveryStepCount = 0;
      state.lastSpeedBand = null;
      state.lastCoachAt = -Infinity;
      state.callouts.clear();
      state.lastScoutAt = -Infinity;
      state.opponentCooldownUntil.clear();
      state.started = false;
    },

    /**
     * @param {object} facts from navigationFacts()
     * @param {object} race  {lap, totalLaps, position, fieldSize, phase, raceStarted, finished, finishPosition}
     * @param {Array<object>} opponents [{id, name, x, z, distanceM}]
     * @param {object} car   the player's car physics object (for grip)
     * @returns {Array<object>} speech items for the queue
     */
    update(facts, race = {}, opponents = [], car = null) {
      const s = getSettings();
      const out = [];
      const t = now();
      if (race.lap !== state.calloutLap) { state.callouts.clear(); state.calloutLap = race.lap; }
      const warn = warningMetres();
      const ff = frequencyFactor();

      // ---------------------------------------------------------- zone entry
      if (facts.zoneId !== state.lastZoneId) {
        const prev = state.lastZoneId;
        const prevKind = state.lastZoneKind;
        state.lastZoneId = facts.zoneId;
        state.lastZoneKind = facts.zone?.kind ?? null;
        const zone = facts.zone;

        // LEAVING a corner is the moment a blind player most needs coaching:
        // "what do I do after turning?" - let go, and the wheel straightens
        // itself; then power out. Said on every corner exit, once.
        if (prevKind === 'corner' || prevKind === 'chicane') {
          out.push({
            text: 'Straighten up. Let go of the steering and the car centres itself. Now accelerate.',
            concise: 'Straighten up. Accelerate.',
            priority: 3,
            key: `exit.${prev ?? 'zone'}`,
            cooldownMs: 1500,
            interrupt: true,
            tag: 'corner',
          });
        }

        if (zone.kind === 'grid' && zone.enterLine) {
          out.push({ text: zone.enterLine, priority: 2, key: 'zone.grid', cooldownMs: 4000 });
        } else if (zone.kind === 'straight' && zone.enterLine && prev !== null) {
          out.push({
            text: zone.enterLine,
            concise: 'Straight ahead.',
            priority: 2,
            key: `zone.${zone.id}`,
            cooldownMs: 5000 * ff,
          });
        } else if (zone.kind === 'braking') {
          const corner = facts.nextCorner;
          if (corner) {
            out.push({
              text: `Braking zone for ${corner.label}. ${corner.direction === 'left' ? 'Left' : 'Right'} hander.`,
              concise: `Braking zone. ${corner.direction} corner.`,
              priority: 3,
              key: `brake.${corner.id}`,
              cooldownMs: 3000,
            });
          }
        } else if (zone.kind === 'corner' || zone.kind === 'chicane') {
          // TURN IN: the action call at the corner itself - not just "a corner
          // is near" but "do this now".
          const dir = zone.direction ?? facts.nextCorner?.direction ?? 'right';
          out.push({
            text: `Turn in. Steer ${dir} now and hold the drag through the corner.`,
            concise: `Steer ${dir} now.`,
            priority: 4,
            key: `turnin.${zone.id}`,
            cooldownMs: 0,
            interrupt: true,
            tag: 'corner',
          });
        }
      }

      // ------------------------------------------------------- corner warning
      const corner = facts.nextCorner;
      if (corner && !state.warnedCorners.has(corner.id)) {
        if (corner.distanceM <= warn) {
          state.warnedCorners.add(corner.id);
          out.push({
            // `text` is always the full sentence and `concise` always the short
            // one; the queue picks between them from the settings. Writing the
            // short form into `text` made the two identical and the concise
            // setting did nothing.
            text: cornerWarningText(corner, false),
            concise: cornerWarningText(corner, true),
            priority: corner.severity === 'hairpin' ? 4 : 3,
            key: `warn.${corner.id}`,
            cooldownMs: 0,
            interrupt: corner.severity === 'hairpin',
            tag: 'corner',
          });
        }
      }

      // ---------------------------------------------- brake-now call at turn-in
      if (corner && !state.brakeCalledCorners.has(corner.id)) {
        const brakeAt = corner.severity === 'hairpin' ? 110 : corner.severity === 'sharp' ? 85 : 60;
        if (corner.distanceM <= brakeAt * (0.7 + ff * 0.3)) {
          state.brakeCalledCorners.add(corner.id);
          out.push({
            text: `Brake now for ${corner.label}. Then steer ${corner.direction}.`,
            concise: `Brake now, then ${corner.direction}.`,
            priority: 4,
            key: `brakenow.${corner.id}`,
            cooldownMs: 0,
            interrupt: true,
            tag: 'brake',
          });
        }
      }

      // Forget a corner once we are well past it, so the next lap warns again.
      // Well past means far beyond the 500 m callout range: wiping callout state
      // while still approaching re-fired the callout every frame.
      if (corner && corner.distanceM > Math.max(warn * 3, 510)) {
        state.warnedCorners.delete(corner.id);
        state.brakeCalledCorners.delete(corner.id);
        state.callouts.delete(corner.id);
      }

      // ------------------------------------------------------------ too fast
      if (facts.tooFast && corner) {
        out.push({
          text: `Too fast for ${corner.label}. Ease off. ${Math.round(facts.suggestedSpeedKph)} kilometres per hour.`,
          concise: 'Too fast. Ease off.',
          priority: 4,
          key: 'tooFast',
          cooldownMs: 2600 * ff,
          interrupt: true,
        });
      }

      // ------------------------------------------------- periodic status coach
      // While nothing needs doing, a racing radio still keeps the driver
      // oriented: which lap, which place, what is next, how fast. Every
      // couple of announce intervals, only while actually racing.
      const coachEvery = Math.max(6, s.announceIntervalMs / 1000 * 2);
      const racingNow = race.phase === 'racing' || race.phase === 'RACING';
      if (racingNow && t - state.lastCoachAt > coachEvery * 1000) {
        state.lastCoachAt = t;
        const parts = [];
        if (race.lap && race.totalLaps) parts.push(`Lap ${race.lap} of ${race.totalLaps}`);
        if (race.position && race.fieldSize) {
          parts.push(`you are in place ${race.position} of ${race.fieldSize}`);
        }
        if (corner) {
          parts.push(`next is ${corner.label}, ${corner.direction} hander, ${Math.round(corner.distanceM)} metres`);
        } else {
          parts.push('the road ahead is clear');
        }
        parts.push(`${Math.round(facts.speedKph)} kilometres per hour`);
        out.push({
          text: parts.join('. ') + '.',
          concise: parts.slice(0, 2).join('. ') + '.',
          priority: 1,
          key: 'coach',
          cooldownMs: 0,
          nonInterrupt: true,
          tag: 'coach',
        });
      }

      // Exactly two routine turn calls: first at 500m, final at 50m.
      // If visibility starts on a shorter leg, state its actual distance.
      if (racingNow && corner && facts.speed > 2.5 && corner.distanceM <= 500) {
        const rec = state.callouts.get(corner.id) ?? { early: false, now: false };
        const urgent = corner.distanceM <= 50;
        if ((urgent && !rec.now) || (!urgent && !rec.early)) {
          const number = Math.max(50, Math.round(corner.distanceM / 50) * 50);
          const text = urgent ? `Turn ${corner.direction} now.` : `Turn ${corner.direction} in ${number} metres.`;
          rec.early = true; if (urgent) rec.now = true;
          out.push({ text, concise: text, priority: urgent ? 4 : 3,
            key: `calls.${corner.id}.${urgent ? 'now' : 'early'}`, cooldownMs: 0,
            ttlMs: urgent ? 1500 : 5000, interrupt: true, tag: 'corner' });
        }
        state.callouts.set(corner.id, rec);
      }

      // ------------------------------------------------- the side scout
      // "Watch out - barrier on the left. The right is clear." Only when
      // something is actually close, and rarely: this is background awareness,
      // not chatter.
      if (racingNow && facts.look && t - state.lastScoutAt > 9500 * ff) {
        const look = facts.look;
        const leftTight = look.left.barrier || look.left.tight;
        const rightTight = look.right.barrier || look.right.tight;
        if (leftTight || rightTight) {
          state.lastScoutAt = t;
          const saySide = (side, info) => {
            if (info.barrier) return `watch out, there is a barrier close on the ${side}`;
            if (info.kerb) return `there are speed breakers on the ${side} edge`;
            return `the ${side} edge is close`;
          };
          const openSide = (side) => `The ${side} is clear. You can go ${side}.`;
          let text;
          if (leftTight && rightTight) {
            text = `${saySide('left', look.left)[0].toUpperCase()}${saySide('left', look.left).slice(1)}, and ${saySide('right', look.right)}. Keep in the middle.`;
          } else if (leftTight) {
            text = `${saySide('left', look.left)[0].toUpperCase()}${saySide('left', look.left).slice(1)}. ${openSide('right')}`;
          } else {
            text = `${saySide('right', look.right)[0].toUpperCase()}${saySide('right', look.right).slice(1)}. ${openSide('left')}`;
          }
          out.push({
            text,
            priority: 1,
            key: 'scout',
            cooldownMs: 0,
            nonInterrupt: true,
            tag: 'scout',
          });
        }
      }

      // -------------------------------------------------------------- off track
      if (facts.offTrack) {
        if (t - state.offTrackAnnouncedAt > 6500) {
          state.offTrackAnnouncedAt = t;
          state.recoveryStepCount++;
          const rec = facts.recovery;
          const first = state.recoveryStepCount === 1;
          out.push({
            text: first
              ? `You have left the track on the ${facts.lateral > 0 ? 'right' : 'left'}. ${
                  rec
                    ? `Steer ${rec.steer} to get back on. ${rec.facingTrackWay ? '' : 'You are facing the wrong way, so turn around first. '}`
                    : ''
                }${facts.surface === 'gravel' ? 'You are in the gravel trap.' : 'You are on the grass.'}`
              : `Still off the track. Steer ${rec?.steer ?? 'left'} and keep your speed down. If you cannot recover, stop and choose Try again when it is offered.`,
            concise: `Off track. Steer ${rec?.steer ?? 'left'}.`,
            priority: 4,
            key: 'offTrack',
            cooldownMs: 0,
            interrupt: true,
            essential: true, // safety guidance survives the master switch
          });
        }
      } else {
        state.recoveryStepCount = 0;
        state.offTrackAnnouncedAt = -Infinity;
      }

      // ------------------------------------------------------- pit lane mouth
      if (facts.toPitEntry < 90 && facts.toPitEntry > 8) {
        out.push({
          text: `Pit lane entrance on the ${facts.pitEntrySide}.`,
          concise: 'Pit lane entrance.',
          priority: 2,
          key: 'pitEntry',
          cooldownMs: 9000,
        });
      }

      // -------------------------------------------------- finish line approach
      if (facts.toFinish < 140 && !state.finishAnnounced && race.phase === 'racing') {
        state.finishAnnounced = true;
        out.push({
          text:
            race.lap >= race.totalLaps
              ? 'You are approaching the finish line. This is your last lap.'
              : 'You are approaching the start and finish line.',
          concise: 'Finish line ahead.',
          priority: 3,
          key: 'finishApproach',
          cooldownMs: 6000,
        });
      }
      if (facts.toFinish > 400) state.finishAnnounced = false;

      // ----------------------------------------------------------------- laps
      if (s.speakSpeedLaps && race.lap !== state.lastLap && state.lastLap !== null) {
        if (race.lap > state.lastLap) {
          out.push({
            text: `Lap ${race.lap} of ${race.totalLaps}. Lap completed.`,
            concise: `Lap ${race.lap} of ${race.totalLaps}.`,
            priority: 3,
            key: `lap.${race.lap}`,
            cooldownMs: 0,
          });
        }
      }
      if (race.lap !== state.lastLap) state.lastLap = race.lap;

      // ------------------------------------------------------------ position
      if (s.speakPosition && race.position !== state.lastPosition && race.position) {
        const first = state.lastPosition === null;
        state.lastPosition = race.position;
        if (!first || race.phase === 'racing') {
          const better = race.previousPosition && race.position < race.previousPosition;
          out.push({
            text: better
              ? `You overtook an opponent. You are currently in ${ordinal(race.position)} place.`
              : `You are currently in ${ordinal(race.position)} place${race.fieldSize ? ` of ${race.fieldSize}` : ''}.`,
            concise: `${ordinal(race.position)} place.`,
            priority: better ? 3 : 2,
            key: `position.${race.position}`,
            cooldownMs: 3200 * ff,
          });
        }
      }

      // ------------------------------------------------------------ opponents
      if (s.speakOpponents && opponents.length) {
        for (const opp of opponents) {
          if (opp.distanceM > 26 || opp.distanceM < 0.5) continue;
          const until = state.opponentCooldownUntil.get(opp.id) ?? 0;
          if (t < until) continue;
          state.opponentCooldownUntil.set(opp.id, t + 5200 * ff);
          const closing = opp.closingSpeedKph > 8;
          out.push({
            text: closing
              ? `${opp.name} approaching fast on your ${opp.side}.`
              : `${opp.name} is on your ${opp.side}.`,
            concise: `Car on your ${opp.side}.`,
            priority: closing ? 3 : 2,
            key: `opp.${opp.id}.${opp.side}`,
            cooldownMs: 4200 * ff,
          });
        }
      }

      // ------------------------------------------------------- speed trend
      if (s.speakSpeedLaps && s.navFrequency === 'detailed') {
        const band = speedBand(facts.speedKph);
        if (band !== state.lastSpeedBand) {
          if (state.lastSpeedBand !== null && t - state.lastSpeedAnnounceAt > 9000) {
            state.lastSpeedAnnounceAt = t;
            const rising = band > state.lastSpeedBand;
            out.push({
              text: rising ? 'Your speed is increasing.' : 'The car is slowing down.',
              priority: 1,
              key: 'speedTrend',
              cooldownMs: 9000,
            });
          }
          state.lastSpeedBand = band;
        }
      }

      // Old corner warnings, coaches, speed/position reports and barrier scout
      // must not fill the 500m→50m silence. Critical off-track/wrong-way safety
      // events are retained; explicit player requests are outside this director.
      return out.filter(item => {
        if (/^(warn\.|brake\.|brakenow\.|turnin\.)/.test(item.key ?? '')) return false;
        if (racingNow && corner && corner.distanceM <= 500) {
          return item.key?.startsWith('calls.') || item.essential === true;
        }
        return true;
      });
    },

    /** Explicit lines the game triggers on discrete events. */
    raceStarted() {
      state.started = true;
      return { text: 'Race started.', concise: 'Go.', priority: 4, key: 'raceStarted', cooldownMs: 0, interrupt: true };
    },
    countdown(step) {
      const words = { 3: 'Three', 2: 'Two', 1: 'One', 0: 'Go' };
      return {
        text: words[step] ?? String(step),
        priority: 4,
        key: `countdown.${step}`,
        cooldownMs: 0,
        interrupt: true,
        essential: true,
      };
    },
    finished(position, fieldSize, timeText) {
      const place = position === 1 ? 'first place' : `${ordinal(position)} place`;
      const of = fieldSize ? ` of ${fieldSize}` : '';
      return {
        text: `You finished in ${place}${of}.${timeText ? ` Race time ${timeText}.` : ''}`,
        concise: position === 1 ? 'First place.' : `${ordinal(position)} place.`,
        priority: 4,
        key: 'finished',
        cooldownMs: 0,
        interrupt: true,
        essential: true,
      };
    },
    respawned() {
      return {
        text: 'Recovery complete. You are back on the racing line, facing the right way.',
        concise: 'Back on track.',
        priority: 4,
        key: 'respawned',
        cooldownMs: 0,
        interrupt: true,
        essential: true,
      };
    },
    /** Called when the lap counter wraps so corner warnings re-arm. */
    onLapComplete() {
      state.warnedCorners.clear();
      state.brakeCalledCorners.clear();
      state.finishAnnounced = false;
    },
    warningMetres,
    frequencyFactor,
  };

  return api;
}

function speedBand(kph) {
  if (kph < 20) return 0;
  if (kph < 70) return 1;
  if (kph < 130) return 2;
  if (kph < 190) return 3;
  return 4;
}

/** The spoken corner warning, phrased by severity exactly as the brief asks. */
export function cornerWarningText(corner, short = false) {
  const dir = corner.direction === 'left' ? 'left' : 'right';
  const hand = corner.direction === 'left' ? 'left-hand' : 'right-hand';
  const name = corner.label;
  if (corner.kind === 'chicane') {
    return short
      ? `Chicane ahead. ${dir === 'left' ? 'Left' : 'Right'} first.`
      : `Chicane ahead, ${name}. Quick ${dir}, then the other way. Keep it straight and short.`;
  }
  switch (corner.severity) {
    case 'hairpin':
      return corner.callout === 'uturn'
        ? short
          ? `U-turn ahead. ${dir === 'left' ? 'Left' : 'Right'}.`
          : `Prepare for a U-turn. ${name} is a ${dir} hander that turns you right around. Brake early and prepare to steer ${dir}.`
        : short
          ? `Hairpin ahead. ${dir === 'left' ? 'Left' : 'Right'}.`
          : `Hairpin approaching, ${name}. Brake and prepare to turn ${dir}.`;
    case 'sharp':
      return short
        ? `Sharp ${dir === 'left' ? 'left' : 'right'} turn.`
        : `Sharp ${dir} turn ahead, ${name}. Reduce speed.`;
    case 'medium':
      return short
        ? `Medium ${dir === 'left' ? 'left' : 'right'} corner.`
        : `Approaching a ${hand} corner, ${name}. Prepare to steer ${dir}.`;
    case 'gentle':
      return short
        ? `Gentle ${dir === 'left' ? 'left' : 'right'} bend.`
        : `Gentle ${hand} bend ahead, ${name}. You can carry speed.`;
    default:
      return short
        ? `${dir === 'left' ? 'Left' : 'Right'} corner.`
        : `Approaching a ${hand} corner, ${name}. Prepare to steer ${dir}.`;
  }
}
