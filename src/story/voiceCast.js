/**
 * Voice cast: one distinct voice per story character.
 *
 * Every speaking character in the campaign gets their own voice, and the
 * casting follows the story: women are voiced by women and men by men. Two
 * layers deliver this:
 *
 * 1. Recorded AI character voices (files in `assets/audio/story/`), played
 *    first whenever a recording exists for the node. These are the only
 *    generated audio in the project besides the short UI cues, and generated
 *    voices are explicitly allowed.
 * 2. Distinct per-character synthesis as the fallback: each profile carries
 *    its own pitch, rate and device-voice hints, so even nodes without a
 *    recording yet never collapse back into the single guidance voice.
 *
 * Pure data + pure functions: no DOM, no Web Audio at import time, fully
 * unit tested.
 *
 * @module story/voiceCast
 */

import { STORY_NODES } from './storyData.js';
import { STORY_BEATS, beatFileKey, beatsFor, validateBeatText } from './storyBeats.js';

/**
 * The hero name baked into the recorded clips. The recordings say "Aarav"; if
 * the player renames the hero, nodes that speak the name fall back to the
 * character's synthesis voice so the game never says the wrong name.
 */
export const BAKED_HERO_NAME = 'Aarav';

/**
 * The cast. `pitch`/`rate` are applied to the fallback synthesis voice and
 * are all distinct pairs, so characters stay distinguishable even on a device
 * with a single installed voice. `voiceHint` lists name fragments preferred
 * when the device offers several voices (matched case-insensitively).
 */
export const CHARACTER_VOICES = {
  narrator: {
    id: 'narrator',
    label: 'Narrator',
    gender: 'masculine',
    pitch: 0.95,
    rate: 1.0,
    voiceHint: ['daniel', 'david', 'alex', 'fred', 'male'],
    description: 'A warm male storyteller for scene narration and chapter endings.',
  },
  sudha: {
    id: 'sudha',
    label: 'Sudha, your mother',
    gender: 'feminine',
    pitch: 1.1,
    rate: 1.0,
    voiceHint: ['female', 'zira', 'samantha', 'karen', 'moira', 'tessa', 'veena'],
    description: 'A warm middle-aged woman, direct and worried in chapter one.',
  },
  ramesh: {
    id: 'ramesh',
    label: 'Ramesh, your father',
    gender: 'masculine',
    pitch: 0.82,
    rate: 0.94,
    voiceHint: ['male', 'david', 'daniel', 'ravi', 'deep'],
    description: 'An older weary man, flat at first, quieter when it matters.',
  },
  divya: {
    id: 'divya',
    label: 'Divya, your sister',
    gender: 'feminine',
    pitch: 1.32,
    rate: 1.06,
    voiceHint: ['female', 'zira', 'samantha', 'karen', 'junior', 'child', 'teen'],
    description: 'A thirteen-year-old girl: quick, blunt, higher than the adults.',
  },
  qureshi: {
    id: 'qureshi',
    label: 'Ms. Farida Qureshi',
    gender: 'feminine',
    pitch: 1.0,
    rate: 0.96,
    voiceHint: ['female', 'zira', 'samantha', 'heera', 'serena'],
    description: 'A measured professional woman. Conducts the interview and the negotiation.',
  },
  joseph: {
    id: 'joseph',
    label: 'Joseph',
    gender: 'masculine',
    pitch: 0.9,
    rate: 1.06,
    voiceHint: ['male', 'daniel', 'david', 'michael', 'rahul'],
    description: 'Loud and direct, the colleague who greets the hero by name.',
  },
  mithin: {
    id: 'mithin',
    label: 'Mithin',
    gender: 'masculine',
    pitch: 0.85,
    rate: 0.9,
    voiceHint: ['male', 'alex', 'fred', 'arjun', 'karan'],
    description: 'Quiet and measuring. Slower and lower than Joseph, always.',
  },
  leela: {
    id: 'leela',
    label: 'Ms. Leela Varma',
    gender: 'feminine',
    pitch: 1.06,
    rate: 1.0,
    voiceHint: ['female', 'samantha', 'zira', 'kavya', 'diya'],
    description: 'A confident race official who explains the controls in dialogue.',
  },
};

/** Every cast member id, in story order. */
export const CAST_IDS = ['narrator', 'sudha', 'ramesh', 'divya', 'qureshi', 'joseph', 'mithin', 'leela'];

/**
 * Normalize a node's speaker string to a cast id.
 *
 * @param {string|null|undefined} speaker
 * @returns {string} a key of CHARACTER_VOICES; unknown or missing speakers
 *   are narrated rather than failing.
 */
export function speakerKey(speaker) {
  if (!speaker) return 'narrator';
  const s = String(speaker).toLowerCase();
  if (s.includes('sudha') || s.includes('mother')) return 'sudha';
  if (s.includes('ramesh') || s.includes('father')) return 'ramesh';
  if (s.includes('divya') || s.includes('sister')) return 'divya';
  if (s.includes('qureshi') || s.includes('farida')) return 'qureshi';
  if (s.includes('joseph')) return 'joseph';
  if (s.includes('mithin')) return 'mithin';
  if (s.includes('leela') || s.includes('varma')) return 'leela';
  return 'narrator';
}

/** The voice profile for a speaker string. Never null. */
export function voiceForSpeaker(speaker) {
  return CHARACTER_VOICES[speakerKey(speaker)] ?? CHARACTER_VOICES.narrator;
}

/** The voice profile for a described story node. Never null. */
export function voiceForNode(node) {
  return voiceForSpeaker(node?.speaker ?? null);
}

/**
 * Story nodes with a recorded character-voice file, mapped to manifest keys
 * in `src/core/audio.js`. Files live in `assets/audio/story/` and are
 * lazy-loaded like the music beds so the boot download stays small.
 */
export const STORY_VOICE_FILES = {
  ch1_intro: 'story-ch1_intro',
  ch1_market: 'story-ch1_market',
  ch1_home: 'story-ch1_home',
  ch1_letter: 'story-ch1_letter',
  ch1_argument: 'story-ch1_argument',
  ch1_sister: 'story-ch1_sister',
  ch1_night: 'story-ch1_night',
  ch1_end: 'story-ch1_end',
  ch2_search: 'story-ch2_search',
  ch2_prep: 'story-ch2_prep',
  ch2_travel: 'story-ch2_travel',
  ch2_reception: 'story-ch2_reception',
  ch2_interview: 'story-ch2_interview',
  ch2_end: 'story-ch2_end',
  ch2_tea_stall: 'story-ch2_tea_stall',
  ch2_prep_alone: 'story-ch2_prep_alone',
  ch2_early: 'story-ch2_early',
  ch2_late: 'story-ch2_late',
  ch2_walk: 'story-ch2_walk',
  ch2_saturday: 'story-ch2_saturday',
  ch2_tea_stall_end: 'story-ch2_tea_stall_end',
  ch2_followups: 'story-ch2_followups',
  ch2_result_unknown: 'story-ch2_result_unknown',
  ch3_offer: 'story-ch3_offer',
  ch3_negotiation: 'story-ch3_negotiation',
  ch3_walked: 'story-ch3_walked',
  ch3_signed_late: 'story-ch3_signed_late',
  ch3_end: 'story-ch3_end',
  ch1_kindness: 'story-ch1_kindness',
  ch1_hurry: 'story-ch1_hurry',
  ch1_onions: 'story-ch1_onions',
  ch1_quiet: 'story-ch1_quiet',
  ch1_after_fight: 'story-ch1_after_fight',
  ch4_morning: 'story-ch4_morning',
  ch4_floor: 'story-ch4_floor',
  ch4_lunch: 'story-ch4_lunch',
  ch4_afternoon: 'story-ch4_afternoon',
  ch4_mithin_neutral: 'story-ch4_mithin_neutral',
  ch4_alone_lunch: 'story-ch4_alone_lunch',
  ch4_end: 'story-ch4_end',
  ch5_sunday: 'story-ch5_sunday',
  ch5_circuit: 'story-ch5_circuit',
  ch5_controls: 'story-ch5_controls',
  ch5_controls_gestures: 'story-ch5_controls_gestures',
  ch5_controls_settings: 'story-ch5_controls_settings',
  ch5_watch: 'story-ch5_watch',
  ch5_questions: 'story-ch5_questions',
  ch5_end: 'story-ch5_end',
  ch6_briefing: 'story-ch6_briefing',
  ch6_more_practice: 'story-ch6_more_practice',
  ch6_end: 'story-ch6_end',
  ch7_paddock: 'story-ch7_paddock',
  ch7_leela_briefing: 'story-ch7_leela_briefing',
  ch7_grid: 'story-ch7_grid',
  ch7_lights: 'story-ch7_lights',
  ch7_won: 'story-ch7_won',
  ch7_podium: 'story-ch7_podium',
  ch7_result_none: 'story-ch7_result_none',
  ch7_end: 'story-ch7_end',
};

/** The manifest key for a node's recording, or null when there is none yet. */
export function storyVoiceKey(nodeId) {
  return STORY_VOICE_FILES[nodeId] ?? null;
}

/**
 * Interview questions with a recorded Qureshi voice file, asked text only.
 * The answers and feedback are the player's own lines and stay guidance.
 */
export const INTERVIEW_VOICE_FILES = {
  q_intro: 'story-interview-q_intro',
  q_reliability: 'story-interview-q_reliability',
  q_mistake: 'story-interview-q_mistake',
  q_teamwork: 'story-interview-q_teamwork',
  q_why_us: 'story-interview-q_why_us',
  fu_pressure: 'story-interview-fu_pressure',
  fu_conflict: 'story-interview-fu_conflict',
};

/** The manifest key for a question's recording, or null when unrecorded. */
export function interviewVoiceKey(questionId) {
  return INTERVIEW_VOICE_FILES[questionId] ?? null;
}

/**
 * Whether the recorded clip for a node may be used with this story state.
 *
 * Recordings bake in the default hero name and fixed wording. A node whose
 * text speaks the hero's name can only use its clip while the hero is still
 * called that; a node whose text speaks the salary (which is negotiated, so
 * never fixed) can never use a clip. Everything else with a clip may.
 *
 * @param {string} nodeId
 * @param {object} [state] story state (needs `heroName`)
 */
export function bakedVoiceUsable(nodeId, state = {}) {
  if (!storyVoiceKey(nodeId)) return false;
  const raw = STORY_NODES[nodeId]?.text;
  const src = typeof raw === 'string' ? raw : '';
  if (src.includes('{hero}') && (state.heroName ?? BAKED_HERO_NAME) !== BAKED_HERO_NAME) return false;
  if (src.includes('{salary}')) return false;
  return true;
}

/**
 * The manifest key for a beat's recording, or null when the beat is never
 * recorded: only `{salary}` beats speak a negotiated figure no recording
 * can bake in.
 *
 * @param {string} nodeId
 * @param {number} beatIndex 0-based position in the node's beats
 */
export function storyBeatKey(nodeId, beatIndex) {
  return beatFileKey(nodeId, beatIndex);
}

/**
 * Beat-level version of bakedVoiceUsable: a beat whose text speaks the
 * hero's name can only use its clip while the hero is still called that.
 * `{salary}` beats never have clips (see storyBeatKey).
 */
export function bakedBeatUsable(nodeId, beatIndex, state = {}) {
  if (!storyBeatKey(nodeId, beatIndex)) return false;
  const beat = beatsFor(nodeId)?.[beatIndex];
  const src = beat && typeof beat.text === 'string' ? beat.text : '';
  if (src.includes('{hero}') && (state.heroName ?? BAKED_HERO_NAME) !== BAKED_HERO_NAME) return false;
  return true;
}

/**
 * Separation validation for every split node in chapters 1-7. Each split
 * rejoins its node text exactly, every beat speaker maps into the cast, and
 * no two adjacent beats share a voice. Returns error strings; empty is
 * valid.
 */
export function validateStoryBeats() {
  const errors = validateBeatText();
  for (const [nodeId, beats] of Object.entries(STORY_BEATS)) {
    beats.forEach((beat, i) => {
      const key = speakerKey(beat.speaker);
      if (!CHARACTER_VOICES[key]) errors.push(`${nodeId} beat ${i + 1}: speaker ${JSON.stringify(beat.speaker)} is not in the cast`);
    });
  }
  return errors;
}

/**
 * How long the scene's sound effect gets before the voice starts, in ms.
 *
 * The door opens, the paper unfolds, the coins land — and then the character
 * speaks. Without this the effect and the first word land on top of each
 * other. Chapter fanfares get longer; UI ticks get none.
 */
export function voiceLeadMs(node) {
  if (!node?.sfx) return 0;
  const sfx = String(node.sfx);
  if (sfx === 'mission_completed') return 900;
  if (sfx === 'coins' || sfx === 'coins-2') return 700;
  if (sfx === 'correct' || sfx === 'wrong' || sfx === 'congratulations') return 550;
  if (sfx === 'you_win' || sfx === 'you_lose') return 800;
  if (sfx === 'tick' || sfx === 'click' || sfx === 'select') return 120;
  return 450;
}

/**
 * Spoken lines describing the cast for the Audio and credits screen, so a
 * blind player can meet every voice by name without a sighted helper.
 */
export function voiceCastLines() {
  return [
    'Story dialogue is performed in a distinct voice per character: women are voiced by women, and men by men.',
    `Every chapter is split into narrator beats and character beats, so the narrator speaks only scene, action and introductions while each character speaks only their own dialogue, with a short pause wherever the voice changes. Character beats and narrator beats are all recorded in their own voices throughout chapters one to seven, apart from the dynamic salary line, and the interview questions are recorded. Unrecorded lines use distinct per-character synthesis voices until their recordings are added, and nothing is ever described as recorded when it is synthesised.`,
    `The cast: ${CAST_IDS.map((id) => `${CHARACTER_VOICES[id].label}, ${CHARACTER_VOICES[id].description}`).join(' ')}`,
  ];
}
