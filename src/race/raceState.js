/**
 * Race state: laps, checkpoint validation, live positions and finish order.
 *
 * Pure and deterministic. Lap counting is gated on ordered checkpoints, so
 * driving backwards over the line, or cutting across the infield, cannot
 * complete a lap. This is the module the brief asks to have tested.
 *
 * @module race/raceState
 */

import { wrapPi } from '../vehicles/physics.js';

export const RACE_PHASE = {
  IDLE: 'idle',
  GRID: 'grid',
  COUNTDOWN: 'countdown',
  RACING: 'racing',
  FINISHED: 'finished',
  PAUSED: 'paused',
};

/**
 * @param {object} config
 * @param {object} config.track
 * @param {number} config.totalLaps
 * @param {Array<{id:string,name:string,isPlayer?:boolean,gridPosition:number,carId:string}>} config.entrants
 */
export function createRace(config) {
  const { track, totalLaps, entrants } = config;
  const length = track.geometry.length;

  const cpCount = track.checkpoints.length;
  const racers = entrants.map((e) => {
    const slot = track.grid.find((g) => g.position === e.gridPosition) ?? track.grid[0];
    // The grid sits inside sector 0, so the first boundary to reach is sector 1.
    const startSector = Math.floor((slot.s / track.geometry.length) * cpCount) % cpCount;
    return {
      startSector,
      id: e.id,
      name: e.name,
      isPlayer: !!e.isPlayer,
      carId: e.carId,
      gridPosition: e.gridPosition,
      x: slot.x,
      z: slot.z,
      heading: slot.heading,
      s: slot.s,
      speed: 0,
      lap: 1,
      lapsCompleted: 0,
      checkpoints: new Set(),
      nextCheckpoint: (startSector + 1) % cpCount,
      totalDistance: slot.s,
      position: e.gridPosition,
      previousPosition: e.gridPosition,
      lastLapTime: null,
      bestLapTime: null,
      raceTime: 0,
      lapStartTime: 0,
      finished: false,
      finishTime: null,
      finishPosition: null,
      wrongWay: false,
      offTrack: false,
      pitLane: false,
      penaltySeconds: 0,
      retired: false,
    };
  });

  return {
    track,
    length,
    totalLaps,
    racers,
    phase: RACE_PHASE.GRID,
    elapsed: 0,
    countdownStep: 3,
    startedAt: null,
    finishOrder: [],
    events: [],
    player: racers.find((r) => r.isPlayer) ?? racers[0],
  };
}

export function racerById(race, id) {
  return race.racers.find((r) => r.id === id) ?? null;
}

/**
 * Which checkpoint index lies at an arc length.
 * Checkpoints are evenly spaced; index 0 is at s = 0 (the start/finish line).
 */
function checkpointIndexAt(race, s) {
  const n = race.track.checkpoints.length;
  const idx = Math.floor((s / race.length) * n) % n;
  return idx < 0 ? idx + n : idx;
}

/**
 * Move a racer to a new position and validate any lap that results.
 *
 * @param {object} race
 * @param {string} id
 * @param {{x:number,z:number,s:number,speed?:number,heading?:number,offTrack?:boolean,pitLane?:boolean}} pose
 * @returns {Array<object>} events produced by this update
 */
export function updateRacer(race, id, pose) {
  const racer = racerById(race, id);
  if (!racer) return [];
  const events = [];
  const length = race.length;
  const prevS = racer.s;
  const s = race.track.geometry.normaliseS(pose.s);
  const near = race.track.geometry.nearest(pose.x, pose.z);

  // Signed forward delta, robust to wrapping at the line.
  let delta = s - prevS;
  if (delta < -length / 2) delta += length;
  else if (delta > length / 2) delta -= length;

  racer.x = pose.x;
  racer.z = pose.z;
  if (pose.heading !== undefined) racer.heading = pose.heading;
  if (pose.speed !== undefined) racer.speed = pose.speed;
  if (pose.offTrack !== undefined) racer.offTrack = pose.offTrack;
  if (pose.pitLane !== undefined) racer.pitLane = pose.pitLane;

  // Arc length alone cannot tell a car crossing the line forwards from one
  // crossing it backwards: both look like a wrap. Heading settles it, which is
  // why reversing over the line cannot bank a lap.
  const headingError = pose.heading === undefined ? 0 : wrapPi(pose.heading - near.heading);
  const facingTrackWay = Math.cos(headingError) > 0;
  racer.wrongWay = !facingTrackWay || delta < -0.05;
  if (!facingTrackWay) {
    racer.s = s;
    return events;
  }

  if (racer.finished || race.phase !== RACE_PHASE.RACING) {
    racer.s = s;
    return events;
  }

  // ---------------------------------------------------- checkpoint validation
  const cpCount = race.track.checkpoints.length;
  if (delta > 0) {
    // Walk every sector boundary swept this frame (usually one, more after a
    // hitchy frame or at very high speed).
    const fromIdx = checkpointIndexAt(race, prevS);
    const toIdx = checkpointIndexAt(race, s);
    if (fromIdx !== toIdx) {
      let i = fromIdx;
      let guard = 0;
      let crossedLine = false;
      while (i !== toIdx && guard++ <= cpCount) {
        i = (i + 1) % cpCount;
        if (i === 0) crossedLine = true;
        if (i === racer.nextCheckpoint) {
          racer.checkpoints.add(i);
          racer.nextCheckpoint = (i + 1) % cpCount;
          events.push({ type: 'checkpoint', racerId: id, index: i });
        }
      }
      // A lap counts only when the line is crossed AND every sector was proved
      // in order. Driving backwards over the line, or cutting the infield,
      // leaves sectors uncollected and is rejected.
      if (crossedLine && racer.checkpoints.size >= cpCount) {
        const lapTime = race.elapsed - racer.lapStartTime;
        racer.lapStartTime = race.elapsed;
        racer.lastLapTime = lapTime;
        if (racer.bestLapTime === null || lapTime < racer.bestLapTime) racer.bestLapTime = lapTime;
        racer.lapsCompleted += 1;
        racer.lap += 1;
        racer.checkpoints.clear();
        // We are back inside sector 0, so the next boundary to prove is 1.
        racer.nextCheckpoint = 1;
        events.push({ type: 'lap', racerId: id, lap: racer.lapsCompleted, lapTime });

        if (racer.lapsCompleted >= race.totalLaps) {
          racer.finished = true;
          racer.finishTime = race.elapsed + racer.penaltySeconds;
          race.finishOrder.push(id);
          racer.finishPosition = race.finishOrder.length;
          events.push({
            type: 'finish',
            racerId: id,
            position: racer.finishPosition,
            time: racer.finishTime,
            isPlayer: racer.isPlayer,
          });
        }
      } else if (crossedLine) {
        events.push({
          type: 'lapRejected',
          racerId: id,
          reason: 'missing-checkpoints',
          collected: racer.checkpoints.size,
          required: cpCount,
        });
      }
    }
  }

  racer.s = s;
  racer.totalDistance = racer.lapsCompleted * length + s;
  return events;
}

/** Recompute live running order. Returns racers whose position changed. */
export function recomputePositions(race) {
  const order = [...race.racers]
    .filter((r) => !r.retired)
    .sort((a, b) => {
      // Finished cars order by finish position first.
      if (a.finished && b.finished) return a.finishPosition - b.finishPosition;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalDistance - a.totalDistance;
    });

  const changed = [];
  order.forEach((racer, i) => {
    const newPos = i + 1;
    if (racer.position !== newPos) {
      racer.previousPosition = racer.position;
      racer.position = newPos;
      changed.push(racer);
    }
  });
  return changed;
}

/**
 * Opponent proximity report for the player, used by the voice director.
 * @returns {Array<{id,name,x,z,distanceM,side,closingSpeedKph,ahead:boolean}>}
 */
export function opponentsNearPlayer(race, bearingFn, limit = 60) {
  const player = race.player;
  if (!player) return [];
  const out = [];
  for (const r of race.racers) {
    if (r.id === player.id || r.retired) continue;
    const d = Math.hypot(r.x - player.x, r.z - player.z);
    if (d > limit) continue;
    const b = bearingFn(player.heading, player.x, player.z, r.x, r.z);
    const closing = (player.speed - r.speed) * 3.6; // positive = we are catching them
    out.push({
      id: r.id,
      name: r.name,
      x: r.x,
      z: r.z,
      distanceM: d,
      side: b.side,
      closingSpeedKph: closing,
      ahead: b.forward > 0,
      position: r.position,
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM);
}

/** mm:ss.mmm */
export function formatRaceTime(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function formatTimeSpoken(seconds) {
  if (!Number.isFinite(seconds)) return 'no time recorded';
  const m = Math.floor(seconds / 60);
  const s = (seconds - m * 60).toFixed(1);
  return m > 0 ? `${m} minutes ${s} seconds` : `${s} seconds`;
}

/** Race results table for the results screen. */
export function buildResults(race) {
  return [...race.racers]
    .sort((a, b) => {
      if (a.finished && b.finished) return a.finishPosition - b.finishPosition;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.totalDistance - a.totalDistance;
    })
    .map((r, i) => ({
      id: r.id,
      name: r.name,
      isPlayer: r.isPlayer,
      position: r.finished ? r.finishPosition : i + 1,
      finished: r.finished,
      lapsCompleted: r.lapsCompleted,
      bestLapTime: r.bestLapTime,
      totalTime: r.finishTime ?? race.elapsed,
      timeText: formatRaceTime(r.finishTime ?? race.elapsed),
      retired: r.retired,
    }));
}
