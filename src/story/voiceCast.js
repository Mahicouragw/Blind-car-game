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
  ch1_argument_choice: 'story-ch1_argument_choice',
  ch1_offer: 'story-ch1_offer',
  ch1_sister: 'story-ch1_sister',
  ch1_night: 'story-ch1_night',
  ch1_end: 'story-ch1_end',
  ch2_search: 'story-ch2_search',
  ch2_prep: 'story-ch2_prep',
  ch2_prep_mother: 'story-ch2_prep_mother',
  ch2_prep_father: 'story-ch2_prep_father',
  ch2_travel: 'story-ch2_travel',
  ch2_reception: 'story-ch2_reception',
  ch2_interview: 'story-ch2_interview',
  ch2_passed: 'story-ch2_passed',
  ch2_failed: 'story-ch2_failed',
  ch2_end: 'story-ch2_end',
  ch2_tea_stall: 'story-ch2_tea_stall',
  ch2_prep_alone: 'story-ch2_prep_alone',
  ch2_early: 'story-ch2_early',
  ch2_late: 'story-ch2_late',
  ch2_walk: 'story-ch2_walk',
  ch2_retry: 'story-ch2_retry',
  ch2_saturday: 'story-ch2_saturday',
  ch2_saturday_result: 'story-ch2_saturday_result',
  ch2_tea_stall_end: 'story-ch2_tea_stall_end',
  ch2_followups: 'story-ch2_followups',
  ch2_result_unknown: 'story-ch2_result_unknown',
  ch3_offer: 'story-ch3_offer',
  ch3_negotiation: 'story-ch3_negotiation',
  ch3_walked: 'story-ch3_walked',
  ch3_saturdays: 'story-ch3_saturdays',
  ch3_signed_late: 'story-ch3_signed_late',
  ch3_end: 'story-ch3_end',
  ch1_kindness: 'story-ch1_kindness',
  ch1_hurry: 'story-ch1_hurry',
  ch1_onions: 'story-ch1_onions',
  ch1_quiet: 'story-ch1_quiet',
  ch1_after_fight: 'story-ch1_after_fight',
  ch4_morning: 'story-ch4_morning',
  ch4_floor: 'story-ch4_floor',
  ch4_joseph: 'story-ch4_joseph',
  ch4_joseph_name: 'story-ch4_joseph_name',
  ch4_mithin: 'story-ch4_mithin',
  ch4_mithin_respect: 'story-ch4_mithin_respect',
  ch4_lunch: 'story-ch4_lunch',
  ch4_friends: 'story-ch4_friends',
  ch4_afternoon: 'story-ch4_afternoon',
  ch4_qureshi: 'story-ch4_qureshi',
  ch4_joseph_mumble: 'story-ch4_joseph_mumble',
  ch4_joseph_joke: 'story-ch4_joseph_joke',
  ch4_keen: 'story-ch4_keen',
  ch4_mithin_fair: 'story-ch4_mithin_fair',
  ch4_mithin_neutral: 'story-ch4_mithin_neutral',
  ch4_alone_lunch: 'story-ch4_alone_lunch',
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
    `Chapter one is fully recorded with character voices, chapter two is fully recorded including its interview questions, and chapter three is recorded apart from its dynamic salary line, and chapter four is recorded apart from its closing line. Unrecorded lines use distinct per-character synthesis voices until their recordings are added, and nothing is ever described as recorded when it is synthesised.`, 
    `The cast: ${CAST_IDS.map((id) => `${CHARACTER_VOICES[id].label}, ${CHARACTER_VOICES[id].description}`).join(' ')}`,
  ];
}
