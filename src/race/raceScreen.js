/**
 * The race screen: real-time loop, camera, HUD, minimap, countdown, collisions,
 * recovery and the voice guidance that makes all of it usable without sight.
 *
 * Phases: grid -> countdown (three seconds, spoken and lit) -> racing ->
 * finished. Announcements are produced by race/navigation.js from the measured
 * car state, so nothing is ever said that is not actually happening.
 *
 * @module race/raceScreen
 */

import * as THREE from '../../vendor/three/three.module.js';
import {
  buildBarriers,
  buildGround,
  buildRoad,
  buildSkyAndLighting,
  createRenderer,
  QUALITY,
} from '../world/scene3d.js';
import {
  buildGrandstands,
  buildPitLane,
  buildScenery,
  buildSignage,
  buildStartGantry,
  setStartLights,
  updateLapBoard,
} from '../world/trackside.js';
import { buildCarMesh } from '../vehicles/carMesh.js';
import {
  clamp01,
  applyCollision,
  barrierDistance,
  createVehicleState,
  resolveSurface,
  respawnOnTrack,
  stepVehicle,
  toKph,
  withPace,
} from '../vehicles/physics.js';
import { intToWords, paceScale, raceLapsFor } from '../a11y/settings.js';
import { createAiDriver, separateRacers, updateAiDriver } from '../vehicles/ai.js';
import {
  buildResults,
  createRace,
  formatRaceTime,
  formatTimeSpoken,
  opponentsNearPlayer,
  RACE_PHASE,
  recomputePositions,
  updateRacer,
} from './raceState.js';
import { createAnnouncementDirector, navigationFacts, relativeBearing } from './navigation.js';
import { SPEECH_PRIORITY } from '../a11y/speechQueue.js';

const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.1;

export function createRaceScreen(config) {
  const {
    canvas,
    overlay,
    track,
    level,
    playerCar,
    gameState,
    speech,
    audio,
    drivingInput,
    quality = 'medium',
    onFinish,
    onAbort,
  } = config;

  const q = QUALITY[quality] ?? QUALITY.medium;
  const renderer = createRenderer({ canvas, quality });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.4, 3200);
  camera.position.set(0, 12, -20);

  const world = new THREE.Group();
  world.name = 'world';
  scene.add(world);
  world.add(buildGround(track));
  world.add(buildRoad(track, { shadows: q.shadows }));
  world.add(buildBarriers(track, { shadows: q.shadows }));
  world.add(buildPitLane(track, { shadows: q.shadows }));
  world.add(buildGrandstands(track, { spectators: q.spectators, shadows: q.shadows }));
  world.add(buildSignage(track, { shadows: q.shadows }));
  world.add(buildScenery(track, { trees: q.trees, shadows: q.shadows }));
  const gantry = buildStartGantry(track, { shadows: q.shadows });
  world.add(gantry.group);
  const lighting = buildSkyAndLighting(scene, { shadowMapSize: q.shadowMapSize });

  // ------------------------------------------------------------- entrants
  const entrants = [
    { id: 'player', name: gameState?.heroName ?? 'You', isPlayer: true, gridPosition: level.gridPosition ?? 3, carId: playerCar.id },
    ...level.opponents.map((o, i) => ({
      id: `ai${i}`,
      name: o.name,
      isPlayer: false,
      gridPosition: i === 0 ? 1 : i === 1 ? 2 : 4 + i,
      carId: o.carId,
    })),
  ];
  // Lap count comes from the Race length setting, falling back to what the
  // level was designed for. Everything downstream - the lap board, the HUD, the
  // spoken lap updates and the finish condition - reads race.totalLaps, so the
  // choice applies to all of them rather than only to the finish line.
  const race = createRace({
    track,
    totalLaps: raceLapsFor(level, gameState?.settings?.raceLength),
    entrants,
  });

  // Car pace is read once, at race start. It scales the player's car and the
  // opponents by the same factor, so it changes the pace of the race rather than
  // how hard it is to win - see CAR_PACE in a11y/settings.js.
  const pace = paceScale(gameState?.settings?.carPace);
  const pacedCar = withPace(playerCar, pace);

  const vehicle = createVehicleState({ x: race.player.x, z: race.player.z, heading: race.player.heading });
  const carMeshes = new Map();
  const playerMesh = buildCarMesh(playerCar, { shadows: q.shadows, number: entrants[0].gridPosition });
  carMeshes.set('player', playerMesh);
  scene.add(playerMesh.group);

  const ais = level.opponents.map((o, i) => {
    const id = `ai${i}`;
    const r = race.racers.find((x) => x.id === id);
    const ai = createAiDriver({
      track,
      car: config.getCar(o.carId),
      start: { x: r.x, z: r.z, heading: r.heading },
      skill: o.skill,
      aggression: o.aggression,
      id,
      name: o.name,
    });
    ai.lapsCompleted = 0;
    const mesh = buildCarMesh(config.getCar(o.carId), { shadows: q.shadows, number: r.gridPosition, color: opponentColor(i) });
    carMeshes.set(id, mesh);
    scene.add(mesh.group);
    return ai;
  });

  const director = createAnnouncementDirector({ getSettings: () => gameState?.settings ?? {}, now: () => performance.now() });
  director.reset();

  // ------------------------------------------------------------------ HUD
  const hud = buildHud(overlay, track, level);
  const minimap = createMinimap(hud.minimapCanvas, track);

  // ---------------------------------------------------------------- state
  const S = {
    phase: RACE_PHASE.GRID,
    gridWait: 0,
    awaitingBriefing: false,
    lastHolding: false,
    lastReversing: false,
    lastThrottleSay: -99,
    direction: null,
    lastDirectionSay: -99,
    recoverIn: 0,
    recoveries: 0,
    countdown: 3.999,
    countdownStep: 3,
    running: false,
    paused: false,
    elapsed: 0,
    accumulator: 0,
    offTrackTimer: 0,
    recoveryOffered: false,
    lastFrame: 0,
    frames: 0,
    fps: 60,
    fpsAccum: 0,
    fpsFrames: 0,
    finished: false,
    aborted: false,
    collisions: 0,
    cleanLaps: 0,
    lapWasClean: true,
    started: false,
  };

  let rafId = null;

  function opponentColor(i) {
    const palette = [
      { body: 0x7a3fa8, trim: 0x1b1d21, accent: 0xe8d9f5 },
      { body: 0x2f8f8a, trim: 0x14211f, accent: 0xd6f2ef },
      { body: 0xc2622a, trim: 0x231a14, accent: 0xf6dcc4 },
      { body: 0x39424e, trim: 0x15181c, accent: 0xb9c2cc },
      { body: 0x8f2f4a, trim: 0x20141a, accent: 0xf0cdd8 },
    ];
    return palette[i % palette.length];
  }

  /** Bounds on how long the controls briefing may delay the countdown. */
  const GRID_MIN_WAIT = 0.8;
  const GRID_MAX_WAIT = 26;

  /**
   * Spoken direction.
   *
   * The car is "going forward" when it is pointing along the racing line, "going
   * left" or "going right" when it is meaningfully angled off it, and "going
   * backward" when it is reversed. Derived from `race.player.headingError`, the
   * signed angle between the car's heading and the track direction that the
   * wrong-way guard already computes - so this reports real geometry, never a
   * guess, and can never claim a turn the car did not make.
   *
   * Hysteresis matters: without it, a car drifting across the threshold in a
   * corner would announce its direction over and over. LEAVING a direction needs
   * a smaller angle than ENTERING one, so the state can only change on a real
   * change of direction, and a hard cooldown stops any remaining chatter.
   */
  const DIRECTION_ENTER_DEG = 30;
  const DIRECTION_EXIT_DEG = 18;
  const DIRECTION_COOLDOWN_MS = 2600;
  const DIRECTION_MIN_SPEED_KPH = 8;

  // ------------------------------------------------------------- countdown
  function say(text, opts = {}) {
    speech?.say(text, opts);
  }

  /**
   * Deliver a short cue EXACTLY ONCE.
   *
   * Where a recorded human sample exists - the countdown numbers, Ready, Go, the
   * finish lines - it is used INSTEAD of device speech synthesis rather than as
   * well as it. Playing both is what made every count number audible twice in two
   * different voices; a listener cannot tell that the two voices are meant to be
   * one announcement, so it reads as the game repeating itself.
   *
   * The recorded sample wins because it is a real recording and it cannot fail to
   * load the way a device voice can; synthesis is the fallback, so guidance still
   * arrives on a device with no audio support. The text is mirrored to the caption
   * area either way.
   *
   * @param {string} text what to say if the sample is unavailable
   * @param {string|null} voiceName manifest key of the recorded sample
   * @param {object} [opts] speech options
   */
  function cue(text, voiceName, opts = {}) {
    const settings = gameState?.settings ?? {};
    const speechWouldSpeak = settings.talkback !== false || opts.essential;
    if (!speechWouldSpeak) return false;

    const volume = Number.isFinite(settings.speechVolume) ? settings.speechVolume : 1;
    const hasSample = !!voiceName && audio?.ready && audio.buffers?.has(voiceName);
    if (hasSample && volume > 0) {
      speech?.mirror?.(text);
      audio.play(voiceName, { group: 'voice', volume: clamp01(volume) });
      return true;
    }
    if (volume <= 0) {
      speech?.mirror?.(text);
      return false;
    }
    say(text, opts);
    return true;
  }

  /**
   * The controls, in the order a player needs them.
   *
   * This used to be spoken from inside `startCountdown`, immediately before the
   * countdown began, so "Three" interrupted it about a second in and the player
   * never heard the second half - which is why holding the screen to accelerate
   * was not discoverable. It is now spoken by `start()` and the countdown WAITS
   * for it (see `gridWait` in the frame loop). It also used to say "Three laps"
   * on every race regardless of the distance, and mentioned neither reverse nor
   * how to leave a race.
   */
  function controlBriefing() {
    const laps = race.totalLaps;
    return [
      `On the grid, position ${race.player.gridPosition} of ${race.racers.length}, for ${intToWords(laps)} ${laps === 1 ? 'lap' : 'laps'} of the Vettaru circuit.`,
      'Hold your finger anywhere on the screen to accelerate. Release to coast.',
      'Tap twice quickly to brake.',
      'Drag left or right to steer. The car turns gradually, so hold the drag through the corner.',
      'Draw a circle with your finger to turn around.',
      'Swipe down to reverse.',
      'Press the back gesture or key to leave the race at any time.',
    ].join(' ');
  }

  function startCountdown() {
    S.phase = RACE_PHASE.COUNTDOWN;
    race.phase = RACE_PHASE.COUNTDOWN;
    S.countdown = 3.999;
    S.countdownStep = 4;
    setStartLights(gantry.lights, 0, false);
    cue('Ready.', 'voice-ready', { priority: SPEECH_PRIORITY.CRITICAL, essential: true, cooldownMs: 0 });
    updateHud();
  }

  function tickCountdown(dt) {
    S.countdown -= dt;
    const step = Math.ceil(S.countdown);
    if (step !== S.countdownStep && step >= 0 && step <= 3) {
      S.countdownStep = step;
      // The spoken count, the recorded voice sample and the lights are the SAME
      // event, so the audio and visual start can never drift apart.
      setStartLights(gantry.lights, step === 0 ? 5 : 3 - step + 1, step === 0);
      if (step > 0) {
        cue(step === 3 ? 'Three' : step === 2 ? 'Two' : 'One', `voice-${step}`, {
          priority: SPEECH_PRIORITY.CRITICAL,
          cooldownMs: 0,
          interrupt: true,
          essential: true,
          key: `count.${step}`,
        });
      } else {
        cue('Go!', 'voice-go', {
          priority: SPEECH_PRIORITY.CRITICAL,
          cooldownMs: 0,
          interrupt: true,
          essential: true,
        });
      }
      hud.countdownEl.textContent = step === 0 ? 'GO' : String(step);
      hud.countdownEl.hidden = false;
      hud.countdownEl.setAttribute('aria-hidden', 'true');
    }
    if (S.countdown <= 0) {
      S.phase = RACE_PHASE.RACING;
      race.phase = RACE_PHASE.RACING;
      race.startedAt = S.elapsed;
      S.started = true;
      setStartLights(gantry.lights, 0, true);
      hud.countdownEl.hidden = true;
      // Derived from race.totalLaps, not a literal. This line used to say "Two
      // laps to go" on every race, including the three and four lap ones, which
      // is exactly the kind of announcement that must come from real game state:
      // a player who cannot see the lap board would plan the whole race around a
      // number that was wrong.
      const laps = race.totalLaps;
      say(`Race started. ${intToWords(laps)} ${laps === 1 ? 'lap' : 'laps'} to go.`, {
        priority: SPEECH_PRIORITY.CRITICAL,
        interrupt: true,
        essential: true,
      });
      audio?.engine?.start();
      audio?.skid?.start();
      for (const r of race.racers) r.lapStartTime = S.elapsed;
    }
  }

  // ---------------------------------------------------------------- physics
  /**
   * Tell the player whether their finger is actually on the throttle.
   *
   * Holding the screen is the accelerator, and with no visible needle and an
   * engine note that is already loud, "am I holding it?" is a fair question. This
   * announces the two edges - pressed and released - rather than a continuous
   * stream, so it cannot become chatter, and it is governed by its own setting.
   */
  function announceDriveInput() {
    const holding = !!drivingInput?.state?.holding;
    const reversing = !!drivingInput?.state?.reversing;
    if (reversing && !S.lastReversing) {
      say('Reversing.', {
        priority: SPEECH_PRIORITY.CRITICAL,
        key: 'reverse',
        cooldownMs: 900,
        essential: true,
      });
    }
    S.lastReversing = reversing;
    if (holding === S.lastHolding) return;
    S.lastHolding = holding;
    if (gameState?.settings?.speakThrottle === false) return;
    const now = S.elapsed;
    if (now - S.lastThrottleSay < 0.55) return;
    S.lastThrottleSay = now;
    // NORMAL, not CRITICAL: this is feedback about the player's own finger, and it
    // must never outrank a corner warning or a collision callout.
    say(holding ? 'Accelerating.' : 'Coasting.', {
      priority: SPEECH_PRIORITY.NORMAL,
      key: 'throttle',
      cooldownMs: 400,
    });
  }

  /**
   * Announce the direction the car is pointing, once per real change.
   *
   * Positive headingError is left of the racing line, negative is right, because
   * increasing heading is left in this model. Reversed counts as backward before
   * any angle is considered - a car travelling backwards is going backwards no
   * matter which way its nose points.
   */
  function announceDirection() {
    if (gameState?.settings?.speakDirection === false) return;
    const speedKph = Math.abs(toKph(vehicle.speed));
    const reversing = !!drivingInput?.state?.reversing || vehicle.speed < -0.5;
    const errDeg = ((race.player.headingError ?? 0) * 180) / Math.PI;

    const previous = S.direction;
    let next;
    if (reversing) {
      next = 'backward';
    } else if (previous === 'left') {
      next = errDeg > DIRECTION_EXIT_DEG ? 'left' : errDeg < -DIRECTION_ENTER_DEG ? 'right' : 'forward';
    } else if (previous === 'right') {
      next = errDeg < -DIRECTION_EXIT_DEG ? 'right' : errDeg > DIRECTION_ENTER_DEG ? 'left' : 'forward';
    } else if (errDeg > DIRECTION_ENTER_DEG) {
      next = 'left';
    } else if (errDeg < -DIRECTION_ENTER_DEG) {
      next = 'right';
    } else {
      next = 'forward';
    }

    if (next === previous) return;
    // A stationary car has no useful direction to report, and the car is jostled
    // around on the grid and while being respawned.
    if (speedKph < DIRECTION_MIN_SPEED_KPH && next !== 'backward') {
      S.direction = next;
      return;
    }
    if (S.elapsed - S.lastDirectionSay < DIRECTION_COOLDOWN_MS / 1000) return;

    S.direction = next;
    S.lastDirectionSay = S.elapsed;
    const words = {
      forward: 'Going forward.',
      left: 'You are going left.',
      right: 'You are going right.',
      backward: 'Going backward.',
    };
    say(words[next], {
      priority: SPEECH_PRIORITY.NORMAL,
      key: 'direction',
      cooldownMs: DIRECTION_COOLDOWN_MS,
    });
  }

  function stepPlayer(dt) {
    const input = drivingInput.update(dt);
    const surf = resolveSurface(track, vehicle.x, vehicle.z);

    // U-turn request: only where the track allows it. Never a teleport - it is
    // a real steering input held for a moment.
    let steer = input.steer;
    if (input.uturnRequest > 0) {
      const facts = navigationFacts(track, vehicle, { surface: surf.surface, car: playerCar.physics });
      const allowed = facts.zone.kind === 'corner' || facts.zone.kind === 'chicane' || Math.abs(vehicle.speed) < 9;
      if (allowed) {
        const dir = facts.nextCorner?.direction ?? 'right';
        steer = dir === 'left' ? 1 : -1;
      } else {
        if (input.uturnRequest > 1.35) {
          say('A U-turn is not safe here. Wait for a corner or slow down first.', {
            priority: SPEECH_PRIORITY.HIGH,
            key: 'uturnDenied',
            cooldownMs: 3000,
          });
        }
        steer = input.steer;
      }
    }

    stepVehicle(vehicle, { throttle: input.throttle, brake: input.brake, steer }, pacedCar, dt, {
      surface: surf.surface,
      gripMultiplier: level.gripMultiplier ?? 1,
      steeringAssist: level.steeringAssist ?? 0,
    });

    // --- track boundary / barrier collision ---
    const bar = barrierDistance(track, vehicle.x, vehicle.z);
    if (bar.distance < 0) {
      const nx = bar.lateral > 0 ? -Math.sin(surf.near.heading) : Math.sin(surf.near.heading);
      const nz = bar.lateral > 0 ? -Math.cos(surf.near.heading) : Math.cos(surf.near.heading);
      const res = applyCollision(vehicle, { x: nx, z: nz }, { now: S.elapsed });
      if (res.impacted && res.impactSpeed > 3) {
        S.collisions++;
        S.lapWasClean = false;
        const hard = res.impactSpeed > 14;
        const severity = Math.min(1, res.impactSpeed / 18);
        // A layered crash - body thud plus brittle debris - reads as a car hitting
        // a barrier. A single short impact sample read as a knock and was easy to
        // miss over the engine.
        if (audio?.crash) audio.crash(severity);
        else audio?.play('barrier-medium', { group: 'sfx', volume: severity });

        // Come back automatically. Leaving a player stopped against a barrier with
        // no visible cue is a dead end, so a solid hit schedules a return to the
        // racing line: announced, at a modest speed, with the car in full working
        // order. The delay lets the crash be felt before the car is moved.
        if (res.impactSpeed > 9 && S.phase === RACE_PHASE.RACING) {
          S.recoverIn = Math.min(S.recoverIn > 0 ? S.recoverIn : 1.1, 1.1);
        }
        navigator.vibrate?.(gameState?.settings?.haptics ? (hard ? [60, 30, 90] : 45) : 0);
        say(hard ? 'Heavy barrier contact. Check your speed.' : 'Barrier contact.', {
          priority: SPEECH_PRIORITY.CRITICAL,
          key: 'collision',
          cooldownMs: 1800,
          interrupt: true,
          essential: true,
        });
      }
    }

    // --- car-to-car collision ---
    for (const other of [...race.racers]) {
      if (other.id === 'player') continue;
      const d = Math.hypot(other.x - vehicle.x, other.z - vehicle.z);
      const minD = 3.6;
      if (d < minD && d > 0.001) {
        const nx = (vehicle.x - other.x) / d;
        const nz = (vehicle.z - other.z) / d;
        const res = applyCollision(vehicle, { x: -nx, z: -nz }, { now: S.elapsed });
        // Push both apart rather than letting them overlap.
        const push = (minD - d) / 2;
        vehicle.x += nx * push;
        vehicle.z += nz * push;
        const ai = ais.find((a) => a.id === other.id);
        if (ai) {
          ai.state.x -= nx * push;
          ai.state.z -= nz * push;
          ai.state.speed *= 0.93;
        }
        if (res.impacted && res.impactSpeed > 2.5) {
          S.collisions++;
          S.lapWasClean = false;
          // A lighter version of the same layered crash, so a car-to-car hit is
          // recognisable as a hit without being as loud as the barrier.
          if (audio?.crash) audio.crash(Math.min(0.5, res.impactSpeed / 14));
          else audio?.play('barrier-light', { group: 'sfx', volume: 0.7 });
          navigator.vibrate?.(gameState?.settings?.haptics ? 30 : 0);
          say(`Contact with ${other.name}.`, { priority: SPEECH_PRIORITY.HIGH, key: 'carContact', cooldownMs: 2200, interrupt: true });
        }
      }
    }

    // --- off-track recovery ---
    // ------------------------------------------------- automatic post-crash return
    // A car left wedged against a barrier cannot be recovered by a player who
    // cannot see where the wall is, so a significant hit returns it to the racing
    // line by itself. This is deliberately generous: it is a recovery, not a
    // penalty, and the car comes back fully working.
    if (S.recoverIn > 0 && S.phase === RACE_PHASE.RACING) {
      S.recoverIn -= dt;
      if (S.recoverIn <= 0) {
        S.recoverIn = 0;
        S.recoveries += 1;
        respawnOnTrack(vehicle, track, surf.near.s, { speed: 10 });
        drivingInput?.reset?.();
        S.direction = null;
        S.offTrackTimer = 0;
        S.recoveryOffered = false;
        say('Repaired and back on the racing line. Carry on.', {
          priority: SPEECH_PRIORITY.CRITICAL,
          interrupt: true,
          essential: true,
          key: 'repaired',
          cooldownMs: 1500,
        });
        audio?.play('ui-confirm', { group: 'sfx', volume: 0.5 });
      }
    }

    if (surf.offTrack) {
      S.offTrackTimer += dt;
      const limit = level.respawnGraceS ?? 3.5;
      if (S.offTrackTimer > limit * 0.55 && !S.recoveryOffered) {
        S.recoveryOffered = true;
        say('You are off the track. Keep driving toward the racing line, or stop and the marshals will recover you.', {
          priority: SPEECH_PRIORITY.CRITICAL,
          key: 'recoveryOffer',
          cooldownMs: 6000,
          interrupt: true,
          essential: true,
        });
      }
      // Stopped off track, or well past the level's margin: safe respawn.
      const tooFar = Math.abs(surf.near.lateral) > (level.recoveryMarginM ?? 12);
      const stopped = Math.abs(vehicle.speed) < 1.2 && S.offTrackTimer > limit * 0.7;
      if (input.consumeRespawn || tooFar || stopped || S.offTrackTimer > limit * 2.4) {
        respawnOnTrack(vehicle, track, surf.near.s, { speed: 8 });
        S.offTrackTimer = 0;
        S.recoveryOffered = false;
        drivingInput.reset();
        say(director.respawned().text, { priority: SPEECH_PRIORITY.CRITICAL, interrupt: true, essential: true, cooldownMs: 0 });
        audio?.play('voice-objective', { group: 'voice', volume: 0.7 });
      }
    } else {
      if (S.offTrackTimer > 0.4 && S.recoveryOffered) {
        say('Back on the track.', { priority: SPEECH_PRIORITY.HIGH, key: 'backOn', cooldownMs: 2500 });
      }
      S.offTrackTimer = 0;
      S.recoveryOffered = false;
    }

    playerMesh.group.position.set(vehicle.x, 0, vehicle.z);
    playerMesh.group.rotation.y = vehicle.heading;
    playerMesh.setSteer(vehicle.steer);
    playerMesh.setWheelSpin(vehicle.speed, dt);
    playerMesh.setBrakeLights(input.brake > 0.05);

    // --- race bookkeeping ---
    const events = updateRacer(race, 'player', {
      x: vehicle.x,
      z: vehicle.z,
      s: surf.near.s,
      speed: vehicle.speed,
      heading: vehicle.heading,
      offTrack: surf.offTrack,
    });
    race.player.lapsCompleted = race.player.lapsCompleted;
    handleRaceEvents(events);
    return { surf, input };
  }

  function stepAi(dt) {
    const flatRacers = race.racers.map((r) => ({ id: r.id, x: r.x, z: r.z }));
    for (const ai of ais) {
      updateAiDriver(ai, dt, {
        track,
        speedScale: (level.aiSpeedScale ?? 1) * pace,
        rubberBand: level.rubberBand ?? 0,
        gripMultiplier: level.gripMultiplier ?? 1,
        racers: flatRacers,
        player: race.player,
      });
      const surf = resolveSurface(track, ai.x, ai.z);
      const events = updateRacer(race, ai.id, {
        x: ai.x,
        z: ai.z,
        s: surf.near.s,
        speed: ai.speed,
        heading: ai.heading,
        offTrack: surf.offTrack,
      });
      const r = race.racers.find((x) => x.id === ai.id);
      ai.lapsCompleted = r.lapsCompleted;
      handleRaceEvents(events, ai.name);
      const mesh = carMeshes.get(ai.id);
      mesh.group.position.set(ai.x, 0, ai.z);
      mesh.group.rotation.y = ai.heading;
      mesh.setSteer(ai.steer);
      mesh.setWheelSpin(ai.speed, dt);
    }
    // Physical separation so nobody occupies the same space as anybody else.
    separateRacers(
      [
        { id: 'player', x: vehicle.x, z: vehicle.z, speed: vehicle.speed, state: vehicle },
        ...ais.map((a) => ({ id: a.id, x: a.x, z: a.z, speed: a.speed, state: a.state })),
      ],
      3.3
    );
    vehicle.x = race.player.x;
    vehicle.z = race.player.z;
  }

  function handleRaceEvents(events, who) {
    for (const e of events) {
      if (e.type === 'lap') {
        if (e.racerId === 'player') {
          if (S.lapWasClean) S.cleanLaps++;
          S.lapWasClean = true;
          director.onLapComplete();
          updateLapBoard(gantry.lapBoard, Math.min(race.player.lap, race.totalLaps), race.totalLaps);
          audio?.play('voice-objective', { group: 'voice', volume: 0.85 });
          say(`Lap ${race.player.lapsCompleted} of ${race.totalLaps} completed. ${formatTimeSpoken(e.lapTime)}`, {
            priority: SPEECH_PRIORITY.HIGH,
            cooldownMs: 0,
          });
        } else if (who) {
          say(`${who} completed a lap.`, { priority: SPEECH_PRIORITY.LOW, key: `lapOther.${who}.${e.lap}`, cooldownMs: 9000 });
        }
      } else if (e.type === 'finish') {
        if (e.isPlayer) finishRace();
      } else if (e.type === 'lapRejected' && e.racerId === 'player') {
        say('That did not count as a lap. You missed a checkpoint, so you probably cut across the infield or crossed the line going the wrong way.', {
          priority: SPEECH_PRIORITY.HIGH,
          key: 'lapRejected',
          cooldownMs: 6000,
        });
      }
    }
  }

  function finishRace() {
    if (S.finished) return;
    S.finished = true;
    S.phase = RACE_PHASE.FINISHED;
    race.phase = RACE_PHASE.FINISHED;
    recomputePositions(race);
    audio?.engine?.stop();
    audio?.skid?.stop();
    const results = buildResults(race);
    const mine = results.find((r) => r.isPlayer);
    const pos = mine?.position ?? race.player.position;
    // The recorded victory line and the placed result are BOTH wanted - one is
    // the human voice the brief asked for, the other is the information - but
    // playing them together is the same duplication bug as the countdown. So they
    // are sequenced: the sample first, then the result once it has finished. The
    // sample's real decoded duration is used rather than a guessed delay.
    const resultText = director.finished(pos, results.length, formatTimeSpoken(race.player.finishTime)).text;
    const victorySample = pos === 1 ? 'voice-you-win' : 'voice-congratulations';
    const sampleSeconds = audio?.buffers?.get?.(victorySample)?.duration ?? 0;
    const speakResult = (delayMs = 0) => {
      if (delayMs <= 0) {
        say(resultText, { priority: SPEECH_PRIORITY.CRITICAL, interrupt: true, essential: true, cooldownMs: 0 });
        return;
      }
      // Guarded on S.running: a player who leaves during the sample must not have
      // the result announced over the menu.
      setTimeout(() => {
        if (!S.running) return;
        say(resultText, { priority: SPEECH_PRIORITY.CRITICAL, interrupt: true, essential: true, cooldownMs: 0 });
      }, delayMs);
    };
    const canPlaySample =
      gameState?.settings?.talkback !== false &&
      (gameState?.settings?.speechVolume ?? 1) > 0 &&
      audio?.ready &&
      audio.buffers?.has(victorySample) &&
      sampleSeconds > 0;
    if (canPlaySample) {
      speech?.mirror?.(resultText);
      audio.play(victorySample, { group: 'voice', volume: clamp01(gameState.settings.speechVolume ?? 1) });
      speakResult(Math.min(5000, Math.round(sampleSeconds * 1000) + 300));
    } else {
      speakResult(0);
    }
    setTimeout(() => {
      onFinish?.({
        results,
        player: mine,
        position: pos,
        fieldSize: results.length,
        lapsCompleted: race.player.lapsCompleted,
        totalLaps: race.totalLaps,
        bestLapTime: race.player.bestLapTime,
        totalTime: race.player.finishTime ?? race.elapsed,
        finished: true,
        levelId: level.id,
        collisions: S.collisions,
        cleanLaps: S.cleanLaps,
      });
    }, 2200);
  }

  // ------------------------------------------------------------------ voice
  function updateVoice() {
    const surf = resolveSurface(track, vehicle.x, vehicle.z);
    const facts = navigationFacts(track, vehicle, { surface: surf.surface, car: playerCar.physics, gripMultiplier: level.gripMultiplier ?? 1 });
    const opponents = opponentsNearPlayer(race, relativeBearing, 55);
    const items = director.update(
      facts,
      {
        lap: race.player.lap,
        totalLaps: race.totalLaps,
        position: race.player.position,
        previousPosition: race.player.previousPosition,
        fieldSize: race.racers.length,
        phase: race.phase,
      },
      opponents,
      playerCar.physics
    );
    for (const item of items) speech?.say(item.text, item);
    return facts;
  }

  // ------------------------------------------------------------------- loop
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!S.running || S.paused) return;
    const dtReal = Math.min(MAX_FRAME_DT, (now - S.lastFrame) / 1000 || FIXED_DT);
    S.lastFrame = now;

    // fps meter for the performance readout
    S.fpsAccum += dtReal;
    S.fpsFrames++;
    if (S.fpsAccum > 0.5) {
      S.fps = S.fpsFrames / S.fpsAccum;
      S.fpsAccum = 0;
      S.fpsFrames = 0;
    }

    // Fixed-step physics so handling is identical at 30fps and 120fps.
    S.accumulator += dtReal;
    let steps = 0;
    while (S.accumulator >= FIXED_DT && steps < 5) {
      S.accumulator -= FIXED_DT;
      steps++;
      S.elapsed += FIXED_DT;
      race.elapsed = S.elapsed;
      if (S.phase === RACE_PHASE.GRID && S.awaitingBriefing) {
        S.gridWait += FIXED_DT;
        // Wait for the controls briefing to finish. `holding` lets the player skip
        // it by holding the screen - the same gesture that accelerates, so an
        // eager player is not made to wait. The cap bounds a speech engine that
        // never reports finishing; a muted or unsupported one goes idle at once,
        // so this normally costs nothing.
        const speaking = speech?.queue?.isSpeaking ?? false;
        const skip = drivingInput?.state?.holding;
        if (S.gridWait >= GRID_MIN_WAIT && (!speaking || skip || S.gridWait >= GRID_MAX_WAIT)) {
          S.awaitingBriefing = false;
          startCountdown();
        }
      } else if (S.phase === RACE_PHASE.COUNTDOWN) tickCountdown(FIXED_DT);
      else if (S.phase === RACE_PHASE.RACING) {
        stepPlayer(FIXED_DT);
        stepAi(FIXED_DT);
      } else if (S.phase === RACE_PHASE.FINISHED) {
        // Roll to a stop; no more inputs.
        stepVehicle(vehicle, { throttle: 0, brake: 0.4, steer: 0 }, pacedCar, FIXED_DT, {});
        playerMesh.group.position.set(vehicle.x, 0, vehicle.z);
        playerMesh.group.rotation.y = vehicle.heading;
      }
      if (S.phase !== RACE_PHASE.COUNTDOWN) recomputePositions(race);
    }

    const facts = updateVoice();
    updateHud(facts);
    updateCamera(dtReal);
    updateAudio();
    audio?.tick();
    speech?.tick();
    drivingInput.tick?.();
    renderer.render(scene, camera);
    S.frames++;
  }

  function updateCamera(dt) {
    const speed = Math.abs(vehicle.speed);
    const behind = 8.6 + speed * 0.14;
    const height = 3.5 + speed * 0.028;
    const fx = Math.cos(vehicle.heading);
    const fz = -Math.sin(vehicle.heading);
    const target = new THREE.Vector3(vehicle.x - fx * behind, height, vehicle.z - fz * behind);
    const k = 1 - Math.pow(0.0016, dt);
    camera.position.lerp(target, k);
    const look = new THREE.Vector3(vehicle.x + fx * (10 + speed * 0.22), 1.5, vehicle.z + fz * (10 + speed * 0.22));
    camera.lookAt(look);
    // Field of view widens with speed, which is how a real car feels faster.
    const wantFov = 60 + Math.min(18, speed * 0.32);
    if (Math.abs(camera.fov - wantFov) > 0.05) {
      camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 3);
      camera.updateProjectionMatrix();
    }
    // Keep the shadow camera centred on the action.
    lighting.sun.position.set(vehicle.x + 240, 330, vehicle.z + 160);
    lighting.sun.target.position.set(vehicle.x, 0, vehicle.z);
    lighting.sun.target.updateMatrixWorld();
  }

  function updateAudio() {
    if (!audio?.ready) return;
    audio.engine.update({
      rpm: vehicle.rpm,
      idleRpm: playerCar.physics.idleRpm,
      redlineRpm: playerCar.physics.redlineRpm,
      throttle: drivingInput?.state?.throttle ?? 0,
      load: drivingInput?.state?.throttle ?? 0,
      speedNorm: Math.min(1, Math.abs(vehicle.speed) / 60),
    });
    audio.skid.update(vehicle.skidLevel ?? 0);
    announceDriveInput();
    announceDirection();
    if (S.phase === RACE_PHASE.RACING && S.frames % 90 === 0 && vehicle.gear !== S.lastGear) {
      // No dedicated gear-change recording exists; a recorded metal click is
      // used instead and that substitution is listed in docs/AUDIO-CREDITS.md.
      audio.play('metal-click', { group: 'sfx', volume: 0.4, rate: 0.9 + Math.random() * 0.25 });
      S.lastGear = vehicle.gear;
    }
  }

  function updateHud(facts) {
    const speed = Math.round(toKph(Math.abs(vehicle.speed)));
    hud.speedEl.textContent = String(speed);
    hud.speedUnitEl.textContent = 'km/h';
    hud.lapEl.textContent = `${Math.min(race.player.lap, race.totalLaps)}/${race.totalLaps}`;
    hud.positionEl.textContent = `${race.player.position}/${race.racers.length}`;
    hud.timeEl.textContent = formatRaceTime(race.elapsed);
    hud.gearEl.textContent = S.phase === RACE_PHASE.RACING ? `${vehicle.gear}` : 'N';
    hud.zoneEl.textContent = facts?.zone?.label ?? '';
    hud.offTrackEl.hidden = !facts?.offTrack;
    hud.wrongWayEl.hidden = !race.player.wrongWay;
    hud.nextCornerEl.textContent = facts?.nextCorner
      ? `${facts.nextCorner.label} ${Math.round(facts.nextCorner.distanceM)} m ${facts.nextCorner.direction}`
      : '';
    hud.captionEl.textContent = speech?.lastSpoken ?? '';
    hud.fpsEl.textContent = `${Math.round(S.fps)} fps`;
    minimap.draw(race.racers, vehicle, track);
    // Keep the ARIA live text in step with the spoken caption.
    hud.ariaSpeedEl.textContent = `${speed} kilometres per hour. Lap ${Math.min(race.player.lap, race.totalLaps)} of ${race.totalLaps}. Position ${race.player.position} of ${race.racers.length}.`;
  }

  function resize() {
    const w = overlay?.clientWidth || window.innerWidth;
    const h = overlay?.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    minimap.resize();
  }

  const api = {
    scene,
    camera,
    renderer,
    race,
    get state() {
      return S;
    },
    get hud() {
      return hud;
    },
    start() {
      if (S.running) return api;
      S.running = true;
      S.lastFrame = performance.now();
      resize();
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', resize);
      rafId = requestAnimationFrame(frame);
      // Announce the grid before the countdown so the player knows where they are.
      const slot = race.player.gridPosition;
      const gridZone = track.zones.find((z) => z.kind === 'grid');
      say(
        `You are on the grid in position ${slot} of ${race.racers.length}. ${gridZone?.enterLine ?? ''} ${race.racers.length - 1} opponents: ${level.opponents.map((o) => o.name).join(', ')}. ${level.brief}`,
        { priority: SPEECH_PRIORITY.CRITICAL, essential: true, cooldownMs: 0 }
      );
      // The control briefing follows the grid announcement in the speech queue.
      // The countdown is started from the frame loop once the queue has drained,
      // so the controls are actually heard rather than cut off by "Three".
      say(controlBriefing(), { priority: SPEECH_PRIORITY.CRITICAL, essential: true, cooldownMs: 0 });
      S.gridWait = 0;
      S.awaitingBriefing = true;
      return api;
    },
    pause() {
      S.paused = true;
      audio?.engine?.stop();
      audio?.skid?.stop();
      speech?.stop();
      return api;
    },
    resume() {
      if (!S.paused) return api;
      S.paused = false;
      S.lastFrame = performance.now();
      if (S.phase === RACE_PHASE.RACING) {
        audio?.engine.start();
        audio?.skid.start();
      }
      return api;
    },
    /** Deliberately abandon the race. Recorded as not finished, fairly. */
    abort(reason = 'abandoned') {
      if (S.aborted) return;
      S.aborted = true;
      S.running = false;
      if (rafId) cancelAnimationFrame(rafId);
      audio?.engine?.stop();
      audio?.skid?.stop();
      speech?.stop();
      onAbort?.({ reason, elapsed: S.elapsed, lapsCompleted: race.player.lapsCompleted });
    },
    destroy() {
      S.running = false;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', resize);
      audio?.engine?.stop();
      audio?.skid?.stop();
      for (const mesh of carMeshes.values()) mesh.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
        else m?.dispose?.();
      });
      renderer.dispose();
      hud.destroy();
    },
    resize,
  };

  return api;
}

// -------------------------------------------------------------------- HUD

function buildHud(overlay, track, level) {
  const root = document.createElement('div');
  root.className = 'race-hud';
  root.innerHTML = `
    <div class="hud-top">
      <div class="hud-chip"><span class="hud-label">Lap</span><span class="hud-value" data-hud="lap">1/2</span></div>
      <div class="hud-chip"><span class="hud-label">Pos</span><span class="hud-value" data-hud="position">1/3</span></div>
      <div class="hud-chip"><span class="hud-label">Time</span><span class="hud-value" data-hud="time">0:00.00</span></div>
      <div class="hud-chip hud-chip-small"><span class="hud-label">Gear</span><span class="hud-value" data-hud="gear">N</span></div>
      <button type="button" class="hud-button" data-hud="pause">Pause</button>
    </div>
    <div class="hud-corner" data-hud="nextCorner" aria-hidden="true"></div>
    <div class="hud-zone" data-hud="zone" aria-hidden="true"></div>
    <div class="hud-warning" data-hud="offTrack" hidden>OFF TRACK</div>
    <div class="hud-warning hud-warning-red" data-hud="wrongWay" hidden>WRONG WAY</div>
    <div class="hud-countdown" data-hud="countdown" hidden aria-hidden="true">3</div>
    <div class="hud-speed">
      <span class="hud-speed-value" data-hud="speed">0</span>
      <span class="hud-speed-unit" data-hud="speedUnit">km/h</span>
    </div>
    <canvas class="hud-minimap" data-hud="minimap" width="180" height="180" aria-hidden="true"></canvas>
    <div class="hud-caption" data-hud="caption" aria-hidden="true"></div>
    <div class="hud-fps" data-hud="fps" aria-hidden="true"></div>
    <p class="sr-only" aria-live="polite" data-hud="ariaSpeed"></p>
  `;
  overlay.appendChild(root);

  const q = (name) => root.querySelector(`[data-hud="${name}"]`);
  const els = {
    root,
    lapEl: q('lap'),
    positionEl: q('position'),
    timeEl: q('time'),
    gearEl: q('gear'),
    speedEl: q('speed'),
    speedUnitEl: q('speedUnit'),
    zoneEl: q('zone'),
    nextCornerEl: q('nextCorner'),
    offTrackEl: q('offTrack'),
    wrongWayEl: q('wrongWay'),
    countdownEl: q('countdown'),
    captionEl: q('caption'),
    fpsEl: q('fps'),
    minimapCanvas: q('minimap'),
    ariaSpeedEl: q('ariaSpeed'),
    pauseButton: q('pause'),
    destroy() {
      root.remove();
    },
  };
  return els;
}

/** Top-down minimap drawn on a 2D canvas from the same centre-line data. */
export function createMinimap(canvas, track) {
  const ctx = canvas.getContext('2d');
  const g = track.geometry;
  const b = g.bounds;
  const pad = 10;
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let path = [];

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.max(120, Math.min(220, Math.round(canvas.clientWidth || 160)));
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    scale = (size - pad * 2) / Math.max(spanX, spanZ);
    ox = pad + (size - pad * 2 - spanX * scale) / 2;
    oy = pad + (size - pad * 2 - spanZ * scale) / 2;
    path = g.points.map((p) => [ox + (p.x - b.minX) * scale, oy + (p.z - b.minZ) * scale]);
  }

  function draw(racers, vehicle) {
    if (!ctx || !path.length) return;
    const size = canvas.width / (Math.min(2, window.devicePixelRatio || 1) || 1);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(12,16,20,0.62)';
    ctx.beginPath();
    ctx.roundRect?.(0, 0, size, size, 10) ?? ctx.rect(0, 0, size, size);
    ctx.fill();

    ctx.strokeStyle = '#7f8b96';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();

    // Start/finish marker.
    const sf = g.pointAt(track.startFinishS);
    const sx = ox + (sf.x - b.minX) * scale;
    const sy = oy + (sf.z - b.minZ) * scale;
    ctx.fillStyle = '#f4f2ec';
    ctx.beginPath();
    ctx.arc(sx, sy, 3.4, 0, Math.PI * 2);
    ctx.fill();

    // Opponents first so the player marker draws on top.
    for (const r of racers ?? []) {
      if (r.isPlayer) continue;
      const x = ox + (r.x - b.minX) * scale;
      const y = oy + (r.z - b.minZ) * scale;
      ctx.fillStyle = '#d98c3a';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (vehicle) {
      const x = ox + (vehicle.x - b.minX) * scale;
      const y = oy + (vehicle.z - b.minZ) * scale;
      ctx.fillStyle = '#38e07b';
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fill();
      // Heading tick so the dot shows which way the car points.
      ctx.strokeStyle = '#0d1116';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(vehicle.heading) * 7, y - Math.sin(vehicle.heading) * 7);
      ctx.stroke();
    }
  }

  resize();
  return { draw, resize };
}

export { RACE_PHASE };
