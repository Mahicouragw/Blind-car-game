/**
 * Levels, difficulty curve and progression.
 *
 * The brief asks for a deliberately easy first race and a gradual curve, so the
 * difficulty lives in data here rather than being baked into the physics or the
 * AI. Adding level 5 is a data change.
 *
 * @module race/levels
 */

/**
 * @typedef {object} LevelConfig
 * @property {number} id
 * @property {string} name
 * @property {string} brief        spoken description before the race
 * @property {number} laps
 * @property {Array<{name:string,carId:string,skill:number,aggression:number}>} opponents
 * @property {number} gripMultiplier    > 1 = more forgiving for the player
 * @property {number} steeringAssist    0..1
 * @property {number} recoveryMarginM   how far off-track before recovery is offered
 * @property {number} respawnGraceS     seconds of off-track before auto-recovery
 * @property {number} aiSpeedScale      global multiplier on AI target speed
 * @property {number} rubberBand        0 = none, 1 = strong
 * @property {number} unlockLevel       driver level required
 */

/** @type {LevelConfig[]} */
export const LEVELS = [
  {
    id: 1,
    name: 'Rookie Cup',
    brief:
      'Two laps, two opponents, and they are gentle. A lap is three point three kilometres, so allow about five minutes.' + ' Take your time. The car has extra grip and the recovery system will put you back on the racing line if you stop off track.',
    laps: 2,
    opponents: [
      { name: 'Joseph', carId: 'kestrel', skill: 0.74, aggression: 0.25 },
      { name: 'Mithin', carId: 'metro-gt', skill: 0.78, aggression: 0.3 },
    ],
    gripMultiplier: 1.18,
    steeringAssist: 0.35,
    recoveryMarginM: 16,
    respawnGraceS: 4.5,
    aiSpeedScale: 0.88,
    rubberBand: 0.75,
    unlockLevel: 1,
  },
  {
    id: 2,
    name: 'Harbour Sprint',
    brief:
      'Three laps and three opponents. They brake later than before and the extra grip is gone. Watch the Variante chicane.',
    laps: 3,
    opponents: [
      { name: 'Joseph', carId: 'metro-gt', skill: 0.8, aggression: 0.4 },
      { name: 'Mithin', carId: 'kestrel', skill: 0.79, aggression: 0.45 },
      { name: 'Rehan', carId: 'volt-e', skill: 0.83, aggression: 0.5 },
    ],
    gripMultiplier: 1.06,
    steeringAssist: 0.2,
    recoveryMarginM: 13,
    respawnGraceS: 3.5,
    aiSpeedScale: 0.93,
    rubberBand: 0.5,
    unlockLevel: 2,
  },
  {
    id: 3,
    name: 'Dockside Challenge',
    brief:
      'Three laps, four opponents, close racing. They will defend the inside into the Old Harbour hairpin.',
    laps: 3,
    opponents: [
      { name: 'Kabir', carId: 'vantage-rs', skill: 0.86, aggression: 0.7 },
      { name: 'Rehan', carId: 'metro-gt', skill: 0.83, aggression: 0.55 },
      { name: 'Joseph', carId: 'volt-e', skill: 0.82, aggression: 0.5 },
      { name: 'Leela', carId: 'kestrel', skill: 0.81, aggression: 0.45 },
    ],
    gripMultiplier: 1.0,
    steeringAssist: 0.1,
    recoveryMarginM: 11,
    respawnGraceS: 3,
    aiSpeedScale: 0.97,
    rubberBand: 0.3,
    unlockLevel: 3,
  },
  {
    id: 4,
    name: 'Vettaru Grand Prix',
    brief:
      'Four laps, five opponents, no assistance. This is the full circuit at race pace.',
    laps: 4,
    opponents: [
      { name: 'Kabir', carId: 'vantage-rs', skill: 0.9, aggression: 0.85 },
      { name: 'Leela', carId: 'volt-e', skill: 0.88, aggression: 0.7 },
      { name: 'Rehan', carId: 'metro-gt', skill: 0.86, aggression: 0.6 },
      { name: 'Mithin', carId: 'vantage-rs', skill: 0.84, aggression: 0.65 },
      { name: 'Joseph', carId: 'metro-gt', skill: 0.82, aggression: 0.55 },
    ],
    gripMultiplier: 1.0,
    steeringAssist: 0,
    recoveryMarginM: 10,
    respawnGraceS: 2.5,
    aiSpeedScale: 1.0,
    rubberBand: 0.15,
    unlockLevel: 4,
  },
];

export function getLevel(id) {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}

export function unlockedLevels(driverLevel) {
  return LEVELS.filter((l) => l.unlockLevel <= driverLevel);
}

export function nextLevel(id) {
  const i = LEVELS.findIndex((l) => l.id === id);
  return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
}

/** A free-practice session: no opponents, no penalty, unlimited recovery. */
export const PRACTICE_LEVEL = {
  id: 0,
  name: 'Practice Session',
  brief:
    'The circuit is empty. Nothing is timed and nothing is penalised. Use this to learn the corners and the gestures.',
  laps: 99,
  opponents: [],
  gripMultiplier: 1.25,
  steeringAssist: 0.4,
  recoveryMarginM: 22,
  respawnGraceS: 2.5,
  aiSpeedScale: 0,
  rubberBand: 0,
  unlockLevel: 1,
  practice: true,
};

// ------------------------------------------------------------- progression

/** Experience needed to REACH each driver level (index = level - 1). */
export const XP_THRESHOLDS = [0, 120, 320, 640, 1100, 1750, 2600, 3700, 5100, 6900];

export function levelForXp(xp) {
  let level = 1;
  for (let i = 0; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
  }
  return level;
}

export function xpForNextLevel(level) {
  if (level >= XP_THRESHOLDS.length) return null;
  return XP_THRESHOLDS[level];
}

/** Progress through the current level as 0..1. */
export function levelProgress(xp) {
  const level = levelForXp(xp);
  const floor = XP_THRESHOLDS[level - 1] ?? 0;
  const ceil = XP_THRESHOLDS[level];
  if (!ceil) return 1;
  return Math.min(1, Math.max(0, (xp - floor) / (ceil - floor)));
}

/**
 * Rewards for a validated race result. Returns experience, coins and any
 * unlocks, plus the achievement ids earned. Deterministic: same input, same
 * reward, so a save file can never be inflated by re-running the maths.
 */
export function raceRewards({ position, fieldSize, lapsCompleted, totalLaps, cleanLaps, bestLapTime, levelId, finished }) {
  const achievements = [];
  let xp = 0;
  let coins = 0;

  if (!finished) {
    xp += 15 * lapsCompleted; // showing up and completing laps still teaches
    achievements.push(lapsCompleted > 0 ? 'first_laps' : null);
  } else {
    xp += 60 + levelId * 25;
    coins += 40 + levelId * 20;
    const podium = Math.max(0, fieldSize - position + 1);
    xp += podium * 45;
    coins += podium * 35;
    if (position === 1) {
      achievements.push('race_win');
      xp += 80;
      coins += 120;
    } else if (position <= 3) achievements.push('podium');
    if (lapsCompleted >= totalLaps) achievements.push('race_complete');
  }

  if (cleanLaps > 0) {
    achievements.push('clean_lap');
    xp += 20 * cleanLaps;
    coins += 15 * cleanLaps;
  }
  if (bestLapTime && Number.isFinite(bestLapTime)) {
    achievements.push('lap_record_attempt');
    xp += 25;
  }

  return {
    xp: Math.round(xp),
    coins: Math.round(coins),
    achievements: achievements.filter(Boolean),
  };
}

/** Achievement definitions with their spoken lines. */
export const ACHIEVEMENTS = {
  first_laps: { name: 'On track', line: 'You completed racing laps.', sound: 'achievement' },
  race_complete: { name: 'Finished', line: 'You finished the race.', sound: 'achievement' },
  podium: { name: 'Podium', line: 'You finished in the top three.', sound: 'achievement' },
  race_win: { name: 'Winner', line: 'You won the race.', sound: 'achievement' },
  clean_lap: { name: 'Clean lap', line: 'You completed a lap without leaving the track.', sound: 'achievement' },
  lap_record_attempt: { name: 'Timed lap', line: 'You set a timed lap.', sound: 'checkpoint' },
  level_up: { name: 'Level up', line: 'Level up.', sound: 'level-up' },
  first_car_unlock: { name: 'New car', line: 'A new car is available in the garage.', sound: 'achievement' },
  story_chapter: { name: 'Story progress', line: 'Story progress saved.', sound: 'checkpoint' },
  interview_passed: { name: 'Hired', line: 'You passed the interview.', sound: 'achievement' },
};

/**
 * Apply rewards to a profile and report level-ups.
 * @returns {{profile:object, leveledUp:boolean, newLevel:number, unlocks:string[]}}
 */
export function applyRewards(profile, rewards) {
  const before = levelForXp(profile.xp ?? 0);
  const xp = (profile.xp ?? 0) + (rewards.xp ?? 0);
  const coins = (profile.coins ?? 0) + (rewards.coins ?? 0);
  const after = levelForXp(xp);
  const achievements = [...new Set([...(profile.achievements ?? []), ...(rewards.achievements ?? [])])];
  const bestTimes = { ...(profile.bestTimes ?? {}) };
  return {
    profile: { ...profile, xp, coins, level: after, achievements, bestTimes },
    leveledUp: after > before,
    newLevel: after,
    unlocks: [],
  };
}
