/**
 * Narrator/character beat splits for mixed story nodes.
 *
 * Most story nodes are already single-voiced: scene nodes belong to the
 * narrator and dialogue nodes belong to one character. Thirty-one nodes mix
 * both in one text ("She closes the folder. I am going to make you an
 * offer..."), and a single recording can only speak them in one voice. Those
 * nodes are split here into ordered beats so the narrator speaks only scene,
 * action and "X says" introductions while each character speaks only their
 * own dialogue, with a natural pause wherever the voice changes.
 *
 * Rules, pinned by tests:
 * - Beat texts rejoin with single spaces into the node's exact `text` from
 *   storyData.js. Captions show the full text; this file only directs voices.
 * - `speaker: null` is a narrator beat (always synthesis, never a file).
 * - A beat with a speaker is a character beat and gets a stable file id
 *   `<nodeId>_b<N>` (1-based beat position, narrator beats included so ids
 *   never shift when wording changes). Beats containing `{salary}` are the
 *   exception: the figure is negotiated, so they stay synthesis by design.
 * - Adjacent beats never share a voice; otherwise they would be one beat.
 *
 * Pure data + pure functions: no DOM, no audio at import time.
 *
 * @module story/storyBeats
 */

import { STORY_NODES } from './storyData.js';

/** Pause between two beats in the same voice, in ms. */
export const BEAT_PAUSE_SAME_MS = 2000;
/** Pause where the voice changes between beats, in ms. */
export const BEAT_PAUSE_CHANGE_MS = 3000;

/**
 * speaker: null = narrator; otherwise the exact speaker string from the node
 * (or the quoted character for lines spoken inside another node's scene).
 */
export const STORY_BEATS = {
  ch1_argument_choice: [
    { speaker: 'Sudha, your mother', text: 'Do not shout at me, Ramesh. I did not write the letter.' },
    { speaker: null, text: 'Then she hears you in the doorway and stops. Both of them turn.' },
    { speaker: 'Sudha, your mother', text: '{hero}, you are old enough now, and you are standing there, so say something.' },
  ],
  ch1_offer: [
    { speaker: 'Ramesh, your father', text: 'You will find work.' },
    { speaker: null, text: 'He says it flat, not as a question. Then he sits down heavily on the chair by the window, and after a while he says, quieter, that he is not trying to stop you. He is trying to stop himself from needing you to. Your mother puts her hand flat on the letter and does not move it.' },
  ],
  ch2_prep_mother: [
    { speaker: 'Sudha, your mother', text: 'Three things. Say your name clearly, because if they cannot hear you they cannot remember you. Tell them one true thing about a mistake you made, because everybody else will tell them a lie about a virtue. And do not mention the rent.' },
    { speaker: null, text: 'She straightens your collar although it was already straight.' },
    { speaker: 'Sudha, your mother', text: 'They are not hiring your family, {hero}. They are hiring you.' },
  ],
  ch2_prep_father: [
    { speaker: 'Ramesh, your father', text: 'Arrive early. Not on time, early, and wait outside where they can see you waiting. When they ask why us, you say something about their business and not about your needs. And when they offer you money, do not say yes in the same breath, because whatever number comes out first is the number they were hoping for.' },
    { speaker: null, text: 'He looks at you for a long second.' },
    { speaker: 'Ramesh, your father', text: 'I have done this badly my whole life. Do it better.' },
  ],
  ch2_passed: [
    { speaker: 'Ms. Farida Qureshi', text: 'Right.' },
    { speaker: null, text: 'She closes the folder.' },
    { speaker: 'Ms. Farida Qureshi', text: 'I am going to make you an offer, and I would like you to hear the number before you say anything, because whatever you say first becomes the number. Do you understand me?' },
    { speaker: null, text: 'Then she almost smiles.' },
    { speaker: 'Ms. Farida Qureshi', text: 'Wait here.' },
  ],
  ch2_failed: [
    { speaker: 'Ms. Farida Qureshi', text: 'I am not going to offer you the role today.' },
    { speaker: null, text: 'She does not soften it and she does not explain it away, which you will later understand was a kindness. Then she says:' },
    { speaker: 'Ms. Farida Qureshi', text: 'but I am short on the floor on Saturdays. If you come in and work one Saturday properly, unpaid, I will read your application again on Monday. I am not promising you anything. I am telling you where the door is.' },
  ],
  ch2_retry: [
    { speaker: 'Ms. Farida Qureshi', text: 'You want to do it again, right now.' },
    { speaker: null, text: 'She considers it.' },
    { speaker: 'Ms. Farida Qureshi', text: 'Most people ask for a week and never come back. Fine. Sit down. Same questions, and I will know which answers you have had time to think about, so do not give me better ones, give me truer ones.' },
  ],
  ch2_saturday_result: [
    { speaker: 'Ms. Farida Qureshi', text: 'Monday, nine o\'clock, and we will talk about money. You swept a floor nobody asked you to sweep and you did not stand around being useful-looking. That is the whole job, in the beginning.' },
    { speaker: null, text: 'She hands you the card.' },
    { speaker: 'Ms. Farida Qureshi', text: 'Do not be late, and do not thank me now, thank me in a year.' },
  ],
  ch3_signed: [
    { speaker: 'Ms. Farida Qureshi', text: '{salary} a month, starting Wednesday, seven o\'clock, and you get one paid training day a month if you ask for it in advance.' },
    { speaker: null, text: 'She pushes the form across.' },
    { speaker: 'Ms. Farida Qureshi', text: 'Sign at the bottom, not in the corner, everybody signs in the corner. Welcome to Kalpesh Motors. Your salary is now recorded and the game will remember it.' },
  ],
  ch3_saturdays: [
    { speaker: null, text: 'You go back on Saturday, and the Saturday after that, and you are not paid and you do not pretend it does not hurt. In the fourth week Ms. Qureshi comes out onto the floor, says a figure out loud without any ceremony, and says' },
    { speaker: 'Ms. Farida Qureshi', text: 'take it or leave it,' },
    { speaker: null, text: 'and this time the figure is higher than the one you walked away from, because you came back.' },
  ],
  ch4_joseph: [
    { speaker: null, text: 'A voice from under the second truck:' },
    { speaker: 'Joseph', text: 'Do not stand there, you are in my light.' },
    { speaker: null, text: 'Then a face appears, upside down, about thirty years old, with a rag in one hand.' },
    { speaker: 'Joseph', text: 'You are the new one. What is your name? Say it properly, I will be shouting it across this floor for the next four years so I would like to get it right the first time.' },
  ],
  ch4_joseph_name: [
    { speaker: 'Joseph', text: '{hero}. Right.' },
    { speaker: null, text: 'He says it once, properly, and then he says it again the way the floor will say it for the next four years, faster and shorter.' },
    { speaker: 'Joseph', text: 'Come here and hold this. Do not let go of it. If it moves, tell me before it moves, not after.' },
  ],
  ch4_joseph_mumble: [
    { speaker: 'Joseph', text: 'What? Louder.' },
    { speaker: null, text: 'He waits, and the waiting goes on long enough that the man in the third bay looks over. Then he says, not unkindly:' },
    { speaker: 'Joseph', text: 'on this floor you will be shouting over an impact wrench all day. Start now, it gets easier. What is your name?' },
  ],
  ch4_joseph_joke: [
    { speaker: null, text: 'Joseph laughs once, hard, like a door slamming, and slides back under the truck.' },
    { speaker: 'Joseph', text: 'Good. You will do. Now say your name before I make one up, because I will, and I made up the last one and he had it for two years.' },
  ],
  ch4_mithin: [
    { speaker: null, text: 'The parts cage bell goes, and the man who comes out with the filter is younger than Joseph and much quieter. He looks at you the way you would look at a new tyre: measuring. Then he says, to Joseph and not to you, that the new one is standing in the aisle again. Joseph says leave him alone, he has been here eleven minutes. The quiet man says, still not to you:' },
    { speaker: 'Mithin', text: 'Mithin. If you are going to stand in the aisle you can at least know who you are standing in front of.' },
  ],
  ch4_mithin_respect: [
    { speaker: 'Mithin', text: 'Mm.' },
    { speaker: null, text: 'He puts the filter down on the bench and, without looking at you, marks a square on the floor with a piece of chalk and says that is where you stand when you are not holding anything. Then he tells you his name properly, which he clearly has decided you have now earned.' },
    { speaker: 'Mithin', text: 'Joseph and Mithin. You will be shouting both of those. Learn which is which.' },
  ],
  ch4_mithin_fair: [
    { speaker: null, text: 'Mithin stops. He looks at you for the first time directly, and then at Joseph, and something passes between them. Joseph says:' },
    { speaker: 'Joseph', text: 'fair. He has a point.' },
    { speaker: null, text: 'Mithin says:' },
    { speaker: 'Mithin', text: 'he has a point, which is worse than being wrong,' },
    { speaker: null, text: 'and chalks a square on the floor and tells you it is yours. That is the first real conversation you have at Kalpesh Motors.' },
  ],
  ch4_friends: [
    { speaker: 'Mithin', text: 'The man argued for forty minutes. Forty. And then Qureshi came out and asked him one question, which was whether he would like his brakes to work or to be cheap, and he could only have one.' },
    { speaker: null, text: 'The fitter laughs so hard he has to put his tin down. Joseph leans across and says to you, quietly:' },
    { speaker: 'Joseph', text: 'he has been here two years and that is the most he has said to anybody new. Do not make a thing of it.' },
  ],
  ch4_keen: [
    { speaker: null, text: 'Joseph finds you at half one, wiping a bay that was already wiped. He takes the rag out of your hand. He says:' },
    { speaker: 'Joseph', text: 'sit down and eat.' },
    { speaker: null, text: 'Then he says, and this is the part you remember:' },
    { speaker: 'Joseph', text: 'on this floor, if you do not rest when everybody rests, you will make a mistake at four o\'clock, and at four o\'clock a mistake is a hand.' },
    { speaker: null, text: 'He does not raise his voice at any point.' },
  ],
  ch4_qureshi: [
    { speaker: null, text: 'Ms. Qureshi catches you at the gate. She does not ask how the day went, which you appreciate. She says:' },
    { speaker: 'Ms. Farida Qureshi', text: 'you will get your first paid training day next month. Spend it on something that will still be useful in ten years, not something that is useful next week.' },
    { speaker: null, text: 'Then she goes back inside without waiting for an answer.' },
  ],
  ch5_question: [
    { speaker: null, text: 'Three weeks later, Friday, and the floor is being swept. Joseph is leaning on a broom, which for him is a formal occasion. He says:' },
    { speaker: 'Joseph', text: 'do you like car racing?' },
    { speaker: null, text: 'He says it the way you would ask if someone wants tea, and then he does not move or look away, which means it was not really about tea.' },
  ],
  ch5_yes: [
    { speaker: null, text: 'You have heard them from your room. He repeats it back to you like a man checking a measurement. Then he says:' },
    { speaker: 'Joseph', text: 'Sunday. Vettaru International Circuit. There is a club day, beginners, nobody famous, and Mithin has a spare helmet that has never been on a head. He will not admit he bought it. Be at the gate at eight.' },
  ],
  ch5_never: [
    { speaker: 'Joseph', text: 'Never thought about it.' },
    { speaker: null, text: 'He is not offended, he is delighted, in the way he is delighted by a bolt that comes off first time.' },
    { speaker: 'Joseph', text: 'Then everybody has a first one. Sunday. Vettaru circuit. Club day. Beginners. You will think about it on Sunday and then you will never stop.' },
  ],
  ch5_no: [
    { speaker: null, text: 'Joseph puts the broom down properly, which is worse than shouting. He says:' },
    { speaker: 'Joseph', text: 'I know what your week looks like. I have read the notice on your mother\'s door when you left it in your bag. And I am still asking you, on a Sunday, at a club day, where the entry is free and nobody is betting anything.' },
    { speaker: null, text: 'He picks the broom up.' },
    { speaker: 'Joseph', text: 'Racing is not for people with money. It is for people who turn up.' },
  ],
  ch5_leela: [
    { speaker: null, text: 'A woman in a white shirt with a radio comes over. Joseph introduces you and she does not look at Joseph while she does it, she looks at you, which is a thing you notice. She says:' },
    { speaker: 'Ms. Leela Varma, race official', text: 'Leela Varma, I run club days. You are not driving today unless you have done the induction, and the induction is not a form, it is thirty minutes of me explaining how not to hurt yourself. Are you here to watch or to learn?' },
  ],
  ch6_confident: [
    { speaker: 'Ms. Leela Varma, race official', text: 'Right.' },
    { speaker: null, text: 'She has a clipboard but she does not write on it.' },
    { speaker: 'Ms. Leela Varma, race official', text: 'You accelerated, you let go and coasted, you tapped twice and braked while moving, you steered gradually without the car jumping sideways, and you asked for a U-turn and the car actually turned around under its own steering instead of being picked up and dropped. That is the whole of it. That is driving.' },
  ],
  ch6_mithin_helmet: [
    { speaker: null, text: 'Mithin takes the helmet back off you and looks at it as though checking for damage, and then, still not looking at you, he says:' },
    { speaker: 'Mithin', text: 'there is a beginner race in two weeks. Two laps. Joseph has already put your name down, which is typical of Joseph.' },
    { speaker: null, text: 'He puts the helmet in the bag.' },
    { speaker: 'Mithin', text: 'I will be there. I am not racing. I am holding the bag.' },
  ],
  ch7_joseph_words: [
    { speaker: 'Joseph', text: 'Listen. There are two of them out there and both of them have done this before and neither of them is fast.' },
    { speaker: null, text: 'He crouches down by the front wheel.' },
    { speaker: 'Joseph', text: 'Do not try to win it in the first corner. You will lose it in the first corner if you try to win it in the first corner. Brake early. You can always take the throttle back on and you cannot take the wall back off.' },
  ],
  ch7_mithin_bag: [
    { speaker: 'Mithin', text: 'He is right and he will say it four more times.' },
    { speaker: null, text: 'Mithin holds up the helmet.' },
    { speaker: 'Mithin', text: 'Your radio is not working, so if you need anything, stop. Stopping is allowed. Everybody on this circuit would rather you stopped than guessed.' },
    { speaker: null, text: 'Then, quietly, so that Joseph does not hear it:' },
    { speaker: 'Mithin', text: 'I have put your name on the entry as well. You are third on the grid.' },
  ],
  ch7_answer_corners: [
    { speaker: 'Ms. Leela Varma, race official', text: 'Turn eleven, the last one, because it puts you onto the straight and the straight is where everything you got wrong earlier gets counted. But if you want the honest answer, it is the U-turn at four, because that is where new drivers run wide and end up in the gravel with the race over and their dignity in the boot.' },
    { speaker: null, text: 'She hands you the helmet.' },
    { speaker: 'Ms. Leela Varma, race official', text: 'Brake before it, not during it.' },
  ],
  ch7_lost: [
    { speaker: null, text: 'You finish third, last of the finishers. Nothing is broken and nobody is angry and the race happened exactly as it should have, which is that you lost it. Mithin has the helmet bag open and does not comment. Joseph says, later, in the car park:' },
    { speaker: 'Joseph', text: 'right, now you know what it feels like. Come back in two weeks and lose it slightly less.' },
  ],
};

/** The beats for a node, or null when the node speaks in a single voice. */
export function beatsFor(nodeId) {
  return STORY_BEATS[nodeId] ?? null;
}

/**
 * The manifest key for a beat's recording, or null when the beat is never
 * recorded: narrator beats always use the narrator synthesis voice, and
 * `{salary}` beats speak a negotiated figure that no recording can bake in.
 */
export function beatFileKey(nodeId, beatIndex) {
  const beat = beatsFor(nodeId)?.[beatIndex];
  if (!beat || !beat.speaker) return null;
  if (beat.text.includes('{salary}')) return null;
  return `story-${nodeId}_b${beatIndex + 1}`;
}

/** Every beat file id (`<nodeId>_b<N>`), in node order. Stable: ids never shift. */
export function allBeatFileIds() {
  const ids = [];
  for (const [nodeId, beats] of Object.entries(STORY_BEATS)) {
    beats.forEach((beat, i) => {
      if (beat.speaker && !beat.text.includes('{salary}')) ids.push(`${nodeId}_b${i + 1}`);
    });
  }
  return ids;
}

/**
 * Structural validation of every split node. Returns an array of error
 * strings; empty means every beat rejoins its node text exactly, every beat
 * carries a speaker the cast understands (checked by the caller, which owns
 * the cast), and no two adjacent beats share a voice.
 */
export function validateBeatText() {
  const errors = [];
  for (const [nodeId, beats] of Object.entries(STORY_BEATS)) {
    const node = STORY_NODES[nodeId];
    if (!node) {
      errors.push(`${nodeId}: split declared for a node that does not exist`);
      continue;
    }
    if (typeof node.text !== 'string') {
      errors.push(`${nodeId}: node text is not a string`);
      continue;
    }
    const joined = beats.map((b) => b.text).join(' ');
    if (joined !== node.text) {
      errors.push(`${nodeId}: beats rejoin to ${joined.length} chars, node text is ${node.text.length}`);
    }
    beats.forEach((beat, i) => {
      if (!beat.text) errors.push(`${nodeId} beat ${i + 1}: empty text`);
      if (i > 0 && (beats[i - 1].speaker ?? null) === (beat.speaker ?? null)) {
        errors.push(`${nodeId} beats ${i} and ${i + 1}: adjacent beats share a voice`);
      }
    });
  }
  return errors;
}
