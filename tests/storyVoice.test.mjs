/**
 * Voice cast and story voice player.
 *
 * Every story character must have their own distinct voice, women voiced by
 * women and men by men. These tests pin the speaker mapping for every speaker
 * string the campaign actually uses, the recorded-file lookup, the hero-rename
 * fallback (a clip must never say the wrong name), the SFX-then-voice sync,
 * and the per-utterance casting through the speech queue.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BAKED_HERO_NAME,
  CAST_IDS,
  CHARACTER_VOICES,
  bakedBeatUsable,
  bakedVoiceUsable,
  interviewVoiceKey,
  speakerKey,
  storyBeatKey,
  storyVoiceKey,
  validateStoryBeats,
  voiceCastLines,
  voiceForNode,
  voiceForSpeaker,
  voiceLeadMs,
} from '../src/story/voiceCast.js';
import { STORY_BEATS, beatsFor } from '../src/story/storyBeats.js';
import { createStoryVoice } from '../src/story/storyVoice.js';
import { STORY_NODES } from '../src/story/storyData.js';
import { INTERVIEW_QUESTIONS, FOLLOW_UPS } from '../src/story/interview.js';
import { createSpeechQueue } from '../src/a11y/speechQueue.js';
import { findVoiceByHint } from '../src/a11y/speech.js';
import { AUDIO_MANIFEST, LAZY_AUDIO } from '../src/core/audio.js';

// ------------------------------------------------------------------- the cast

test('the cast has eight distinct members, women voiced by women and men by men', () => {
  assert.deepEqual([...CAST_IDS].sort(), Object.keys(CHARACTER_VOICES).sort());
  const feminine = CAST_IDS.filter((id) => CHARACTER_VOICES[id].gender === 'feminine').sort();
  const masculine = CAST_IDS.filter((id) => CHARACTER_VOICES[id].gender === 'masculine').sort();
  assert.deepEqual(feminine, ['divya', 'leela', 'qureshi', 'sudha']);
  assert.deepEqual(masculine, ['joseph', 'mithin', 'narrator', 'ramesh']);
});

test('every cast member has a distinct pitch and rate pair', () => {
  const pairs = CAST_IDS.map((id) => `${CHARACTER_VOICES[id].pitch}x${CHARACTER_VOICES[id].rate}`);
  assert.equal(new Set(pairs).size, pairs.length, `cast prosody must be distinct: ${pairs.join(', ')}`);
  for (const id of CAST_IDS) {
    assert.ok(CHARACTER_VOICES[id].voiceHint.length > 0, `${id} needs device-voice hints`);
    assert.ok(CHARACTER_VOICES[id].label, `${id} needs a label`);
  }
});

test('every speaker string in the campaign maps to a cast member', () => {
  const speakers = new Set(
    Object.values(STORY_NODES)
      .map((n) => n.speaker)
      .filter(Boolean)
  );
  for (const q of [...INTERVIEW_QUESTIONS, ...FOLLOW_UPS]) speakers.add(q.speaker);
  assert.ok(speakers.size > 0, 'the campaign should have speakers to map');
  for (const speaker of speakers) {
    const key = speakerKey(speaker);
    assert.ok(CHARACTER_VOICES[key], `"${speaker}" maps to ${key}, which is not in the cast`);
  }
});

test('the speaker mapping follows the story, and Joseph and Mithin stay distinct', () => {
  assert.equal(speakerKey(null), 'narrator');
  assert.equal(speakerKey(undefined), 'narrator');
  assert.equal(speakerKey('Someone never written'), 'narrator');
  assert.equal(speakerKey('Sudha, your mother'), 'sudha');
  assert.equal(speakerKey('Ramesh, your father'), 'ramesh');
  assert.equal(speakerKey('Divya, your sister'), 'divya');
  assert.equal(speakerKey('Ms. Farida Qureshi'), 'qureshi');
  assert.equal(speakerKey('Ms. Leela Varma, race official'), 'leela');
  assert.equal(speakerKey('Joseph'), 'joseph');
  assert.equal(speakerKey('Mithin'), 'mithin');
  assert.notEqual(speakerKey('Joseph'), speakerKey('Mithin'));
  assert.notEqual(voiceForSpeaker('Joseph').pitch, voiceForSpeaker('Mithin').pitch);
  assert.notEqual(voiceForSpeaker('Joseph').rate, voiceForSpeaker('Mithin').rate);
});

test('voiceForNode never returns null', () => {
  assert.equal(voiceForNode(null).id, 'narrator');
  assert.equal(voiceForNode({}).id, 'narrator');
  assert.equal(voiceForNode({ speaker: 'Mithin' }).id, 'mithin');
});

// ------------------------------------------------------------- recorded files

test('recorded voice files cover every single-voice node; split nodes use beats', () => {
  const recorded = [
    'ch1_intro', 'ch1_market', 'ch1_home', 'ch1_letter', 'ch1_argument',
    'ch1_sister', 'ch1_night', 'ch1_end',
    'ch2_search', 'ch2_prep', 'ch2_travel',
    'ch2_reception', 'ch2_interview', 'ch2_end',
    'ch2_tea_stall', 'ch2_prep_alone', 'ch2_early', 'ch2_late', 'ch2_walk',
    'ch2_saturday', 'ch2_tea_stall_end', 'ch2_followups',
    'ch2_result_unknown', 'ch3_offer', 'ch3_negotiation',
    'ch3_walked', 'ch3_signed_late', 'ch3_end',
    'ch1_kindness', 'ch1_hurry', 'ch1_onions', 'ch1_quiet', 'ch1_after_fight',
    'ch4_morning', 'ch4_floor',
    'ch4_lunch', 'ch4_afternoon',
    'ch4_mithin_neutral', 'ch4_alone_lunch',
    'ch4_end', 'ch5_invite', 'ch5_sunday',
    'ch5_circuit', 'ch5_controls', 'ch5_controls_gestures', 'ch5_controls_settings',
    'ch5_watch', 'ch5_questions', 'ch5_end',
    'ch6_briefing', 'ch6_more_practice', 'ch6_end',
    'ch7_paddock', 'ch7_leela_briefing',
    'ch7_grid', 'ch7_lights', 'ch7_won', 'ch7_podium',
    'ch7_result_none', 'ch7_end',
  ];
  assert.equal(recorded.length, 60);
  for (const id of recorded) {
    assert.equal(storyVoiceKey(id), `story-${id}`);
  }
  const split = [
    'ch1_argument_choice', 'ch1_offer', 'ch2_prep_mother', 'ch2_prep_father',
    'ch2_passed', 'ch2_failed', 'ch2_retry', 'ch2_saturday_result',
    'ch3_saturdays', 'ch4_joseph', 'ch4_joseph_name', 'ch4_mithin',
    'ch4_mithin_respect', 'ch4_friends', 'ch4_qureshi',
    'ch4_joseph_mumble', 'ch4_joseph_joke', 'ch4_keen', 'ch4_mithin_fair',
    'ch5_question', 'ch5_yes', 'ch5_leela', 'ch5_never', 'ch5_no',
    'ch6_confident', 'ch6_mithin_helmet',
    'ch7_joseph_words', 'ch7_mithin_bag', 'ch7_answer_corners', 'ch7_lost',
  ];
  assert.equal(split.length, 30);
  for (const id of split) {
    assert.equal(storyVoiceKey(id), null, `${id} is split into beats and must not keep a whole-node file`);
    assert.ok(beatsFor(id), `${id} must declare its beats`);
  }
  assert.equal(storyVoiceKey('ch6_tutorial'), null);
  assert.equal(storyVoiceKey('ch7_race'), null);
  assert.equal(storyVoiceKey('no-such-node'), null);
});

test('every recorded-file key is a lazy manifest entry', () => {
  for (const id of Object.keys(STORY_NODES)) {
    const key = storyVoiceKey(id);
    if (!key) continue;
    assert.ok(AUDIO_MANIFEST[key], `${key} is announced but missing from the manifest`);
    assert.ok(LAZY_AUDIO.has(key), `${key} must be lazy so dialogue never gates the boot`);
  }
  for (const [nodeId, beats] of Object.entries(STORY_BEATS)) {
    beats.forEach((beat, i) => {
      const key = storyBeatKey(nodeId, i);
      if (!key) return;
      assert.ok(AUDIO_MANIFEST[key], `${key} is announced but missing from the manifest`);
      assert.ok(LAZY_AUDIO.has(key), `${key} must be lazy so dialogue never gates the boot`);
    });
  }
});

test('every story manifest entry exists on disk as a non-empty file', () => {
  const keys = Object.keys(AUDIO_MANIFEST).filter((k) => k.startsWith('story-'));
  assert.equal(keys.length, 121);
  for (const key of keys) {
    const file = fileURLToPath(new URL(`../${AUDIO_MANIFEST[key]}`, import.meta.url));
    assert.ok(fs.existsSync(file), `${key} is announced but ${AUDIO_MANIFEST[key]} is missing from the checkout`);
    assert.ok(fs.statSync(file).size > 0, `${key} exists but is empty`);
  }
});

test('every interview question has a recorded Qureshi voice file', () => {
  const questions = [...INTERVIEW_QUESTIONS, ...FOLLOW_UPS];
  assert.equal(questions.length, 7);
  for (const q of questions) {
    const key = interviewVoiceKey(q.id);
    assert.ok(key, `${q.id} has no recorded question file`);
    assert.ok(AUDIO_MANIFEST[key], `${key} is announced but missing from the manifest`);
    assert.ok(LAZY_AUDIO.has(key), `${key} must be lazy so dialogue never gates the boot`);
  }
  assert.equal(interviewVoiceKey('no-such-question'), null);
});

test('a renamed hero falls back to synthesis rather than hearing the wrong name', () => {
  assert.equal(BAKED_HERO_NAME, 'Aarav');
  // ch1_home speaks the hero's name; ch1_letter does not.
  assert.ok(STORY_NODES.ch1_home.text.includes('{hero}'));
  assert.ok(!STORY_NODES.ch1_letter.text.includes('{hero}'));
  assert.equal(bakedVoiceUsable('ch1_home', { heroName: 'Aarav' }), true);
  assert.equal(bakedVoiceUsable('ch1_home', {}), true);
  assert.equal(bakedVoiceUsable('ch1_home', { heroName: 'Meera' }), false);
  assert.equal(bakedVoiceUsable('ch1_letter', { heroName: 'Meera' }), true);
  assert.equal(bakedVoiceUsable('ch6_after', { heroName: 'Aarav' }), false);
});

test('the scene effect plays before the voice starts', () => {
  assert.equal(voiceLeadMs({ sfx: null }), 0);
  assert.equal(voiceLeadMs({}), 0);
  assert.equal(voiceLeadMs({ sfx: 'door-open' }), 450);
  assert.equal(voiceLeadMs({ sfx: 'paper-open' }), 450);
  assert.equal(voiceLeadMs({ sfx: 'mission_completed' }), 900);
  assert.equal(voiceLeadMs({ sfx: 'coins' }), 700);
  assert.equal(voiceLeadMs({ sfx: 'tick' }), 120);
});

test('the cast lines introduce every voice honestly', () => {
  const lines = voiceCastLines();
  assert.ok(lines.length >= 3);
  const joined = lines.join(' ');
  assert.match(joined, /women are voiced by women/i);
  assert.match(joined, /men by men/i);
  assert.match(joined, /narrator beats and character beats/i);
  for (const id of CAST_IDS) {
    assert.ok(joined.includes(CHARACTER_VOICES[id].label), `cast lines should name ${id}`);
  }
});

// ------------------------------------------------------- per-utterance casting

test('the speech queue carries per-utterance voice casting', () => {
  const queue = createSpeechQueue();
  const res = queue.offer({
    text: 'Divya: Are you going to do something?',
    voice: ['female', 'zira'],
    pitch: 1.32,
    rate: 1.06,
  });
  assert.equal(res.accepted, true);
  const taken = queue.take();
  assert.deepEqual(taken.voice, ['female', 'zira']);
  assert.equal(taken.pitch, 1.32);
  assert.equal(taken.rate, 1.06);
});

test('guidance lines carry no casting and use the player settings', () => {
  const queue = createSpeechQueue();
  queue.offer({ text: 'Main menu.' });
  const taken = queue.take();
  assert.equal(taken.voice, null);
  assert.equal(taken.pitch, null);
  assert.equal(taken.rate, null);
});

test('findVoiceByHint prefers matching English voices', () => {
  const voices = [
    { name: 'Microsoft David Desktop', lang: 'en-US' },
    { name: 'Microsoft Zira Desktop', lang: 'en-US' },
    { name: 'Google français', lang: 'fr-FR' },
  ];
  assert.equal(findVoiceByHint(voices, ['female', 'zira'])?.name, 'Microsoft Zira Desktop');
  assert.equal(findVoiceByHint(voices, 'david')?.name, 'Microsoft David Desktop');
  assert.equal(findVoiceByHint(voices, ['zira', 'female'])?.name, 'Microsoft Zira Desktop');
  assert.equal(findVoiceByHint(voices, 'no-such-voice'), null);
  assert.equal(findVoiceByHint(voices, []), null);
  assert.equal(findVoiceByHint([], 'zira'), null);
});

// ------------------------------------------------------------ the voice player

function makeSpeechStub() {
  return {
    said: [],
    mirrored: [],
    stops: 0,
    say(text, opts = {}) {
      this.said.push({ text, opts });
      return true;
    },
    mirror(text) {
      this.mirrored.push(text);
      return true;
    },
    stop() {
      this.stops++;
    },
  };
}

function makeAudioStub({ buffer = { duration: 2 }, ready = true } = {}) {
  const stub = {
    ready,
    loadedKeys: [],
    played: [],
    handle: null,
    async ensureLoaded(key) {
      stub.loadedKeys.push(key);
      return buffer;
    },
    voice: {
      play(key, opts = {}) {
        const handle = {
          key,
          volume: opts.volume ?? 1,
          stopped: false,
          onended: null,
          stop() {
            this.stopped = true;
          },
        };
        stub.played.push(handle);
        stub.handle = handle;
        return handle;
      },
    },
  };
  return stub;
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

test('character voices off keeps the single guidance voice and touches no files', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub();
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: false, speechVolume: 1 }),
    getStoryState: () => ({ heroName: 'Aarav' }),
  });
  const res = await player.speakNode(
    { id: 'ch1_home', speaker: 'Sudha, your mother', text: 'Aarav, is that you?', sfx: null },
    { choicesSpoken: 'Swipe up or tap to continue.' }
  );
  assert.equal(res.mode, 'guidance');
  assert.equal(audio.loadedKeys.length, 0);
  assert.equal(speech.said.length, 1);
  assert.match(speech.said[0].text, /Sudha, your mother says:/);
  assert.match(speech.said[0].text, /Swipe up or tap to continue/);
  assert.equal(speech.said[0].opts.voice, undefined);
});

test('a recorded node plays its character file, then the choices follow', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub();
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 0.8 }),
    getStoryState: () => ({ heroName: 'Aarav' }),
  });
  const res = await player.speakNode(
    { id: 'ch1_letter', speaker: null, text: 'The letter is short.', sfx: null },
    { choicesSpoken: 'Swipe up or tap to continue.' }
  );
  assert.equal(res.mode, 'file');
  assert.equal(res.voice, 'narrator');
  assert.deepEqual(audio.loadedKeys, ['story-ch1_letter']);
  // Captions appear immediately, before the recording starts.
  assert.equal(speech.mirrored.length, 1);
  assert.match(speech.mirrored[0], /The letter is short/);
  await tick(20);
  assert.equal(audio.played.length, 1);
  assert.equal(audio.played[0].key, 'story-ch1_letter');
  assert.equal(audio.played[0].volume, 0.8);
  // Choices wait for the line to end rather than talking over it.
  assert.equal(speech.said.length, 0);
  audio.handle.onended();
  assert.equal(speech.said.length, 1);
  assert.match(speech.said[0].text, /Swipe up or tap to continue/);
});

test('a failed recording still speaks in the character synthesis voice', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub({ buffer: null });
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({ heroName: 'Aarav' }),
  });
  const res = await player.speakNode(
    { id: 'ch1_sister', speaker: 'Divya, your sister', text: 'Are you going to do something?', sfx: null },
    { choicesSpoken: '' }
  );
  assert.equal(res.mode, 'synthesis');
  assert.equal(res.voice, 'divya');
  assert.equal(audio.played.length, 0);
  assert.equal(speech.said.length, 1);
  assert.doesNotMatch(speech.said[0].text, /Divya/, 'characters never announce their own names');
  assert.match(speech.said[0].text, /Are you going to do something/);
  assert.equal(speech.said[0].opts.pitch, CHARACTER_VOICES.divya.pitch);
  assert.equal(speech.said[0].opts.rate, CHARACTER_VOICES.divya.rate);
  assert.deepEqual(speech.said[0].opts.voice, CHARACTER_VOICES.divya.voiceHint);
});

test('an unrecorded node speaks in its character synthesis voice, never guidance', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub();
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({ heroName: 'Aarav' }),
  });
  const res = await player.speakNode(
    { id: 'ch6_tutorial', speaker: null, text: 'The driving lesson.', sfx: null },
    { choicesSpoken: '3 choices.' }
  );
  assert.equal(res.mode, 'synthesis');
  assert.equal(res.voice, 'narrator');
  assert.equal(audio.loadedKeys.length, 0);
  assert.equal(speech.said[0].opts.pitch, CHARACTER_VOICES.narrator.pitch);
  // The character line comes first, the choices follow it.
  assert.equal(speech.said.length, 2);
  assert.match(speech.said[0].text, /The driving lesson/);
  assert.match(speech.said[1].text, /3 choices/);
});

test('speak() voices interview and negotiation lines with the cast', () => {
  const speech = makeSpeechStub();
  const player = createStoryVoice({
    audio: makeAudioStub(),
    speech,
    getSettings: () => ({ storyVoices: true }),
    getStoryState: () => ({}),
  });
  const res = player.speak('Good morning. Please sit down.', { speaker: 'Ms. Farida Qureshi', priority: 4 });
  assert.equal(res.mode, 'synthesis');
  assert.equal(res.voice, 'qureshi');
  assert.equal(speech.said.length, 1);
  assert.doesNotMatch(speech.said[0].text, /Qureshi/, 'characters never announce their own names');
  assert.match(speech.said[0].text, /Good morning/);
  assert.equal(speech.said[0].opts.pitch, CHARACTER_VOICES.qureshi.pitch);
  assert.equal(speech.said[0].opts.priority, 4);
});

test('moving on stops the previous recording so characters never overlap', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub();
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({ heroName: 'Aarav' }),
  });
  await player.speakNode({ id: 'ch1_letter', speaker: null, text: 'First.', sfx: null }, {});
  await tick(20);
  assert.equal(audio.played.length, 1);
  const first = audio.handle;
  await player.speakNode({ id: 'ch1_night', speaker: null, text: 'Second.', sfx: null }, {});
  assert.equal(first.stopped, true, 'the first recording must stop when the node changes');
  await tick(20);
  assert.equal(audio.played.length, 2);
});

test('stop() cancels a recording that has not started yet', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub();
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({ heroName: 'Aarav' }),
  });
  // A scene effect means the voice waits 450 ms before starting.
  await player.speakNode({ id: 'ch1_letter', speaker: null, text: 'First.', sfx: 'door-open' }, {});
  player.stop();
  await tick(600);
  assert.equal(audio.played.length, 0, 'a stopped line must never start late');
  // One cut from the beat start, one from stop() itself.
  assert.equal(speech.stops, 2);
});

test('a follow line joins the beat instead of cutting it', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub();
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({ heroName: 'Aarav' }),
  });
  await player.speakNode({ id: 'ch1_letter', speaker: null, text: 'First.', sfx: null }, {});
  await tick(20);
  const handle = audio.handle;
  player.speak('Ms. Qureshi offers nine thousand rupees.', { speaker: 'Ms. Farida Qureshi', follow: true });
  assert.equal(handle.stopped, false, 'a follow line must not cut the recording');
  assert.equal(speech.said.length, 1);
  assert.equal(speech.said[0].opts.interrupt, false);
});

test('speak() plays a recording when fileKey names one, then voices the follow lines', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub();
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({}),
  });
  let done = 0;
  const res = player.speak('Good morning. Please sit down.', {
    speaker: 'Ms. Farida Qureshi',
    priority: 4,
    fileKey: 'story-interview-q_intro',
    followSpoken: '5 answers.',
    onDone: () => { done++; },
  });
  assert.equal(res.mode, 'file');
  assert.equal(res.voice, 'qureshi');
  await tick(20);
  assert.deepEqual(audio.loadedKeys, ['story-interview-q_intro']);
  assert.equal(audio.played.length, 1);
  // Nothing speaks over the recording.
  assert.equal(speech.said.length, 0);
  assert.equal(done, 0);
  audio.handle.onended();
  assert.equal(done, 1);
  assert.equal(speech.said.length, 1);
  assert.match(speech.said[0].text, /5 answers/);
  assert.equal(speech.said[0].opts.voice, undefined, 'follow lines stay guidance');
});

test('speak() falls back to the cast voice when its file is missing', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub({ buffer: null });
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({}),
  });
  let done = 0;
  const res = player.speak('Good morning. Please sit down.', {
    speaker: 'Ms. Farida Qureshi',
    fileKey: 'story-interview-q_intro',
    followSpoken: '5 answers.',
    onDone: () => { done++; },
  });
  assert.equal(res.mode, 'file');
  await tick(20);
  assert.equal(audio.played.length, 0);
  assert.equal(speech.said.length, 2);
  assert.doesNotMatch(speech.said[0].text, /Qureshi/, 'characters never announce their own names');
  assert.match(speech.said[0].text, /Good morning/);
  assert.equal(speech.said[0].opts.pitch, CHARACTER_VOICES.qureshi.pitch);
  assert.match(speech.said[1].text, /5 answers/);
  assert.equal(done, 1);
});

test('speak() without a file runs the chain immediately behind the cast line', () => {
  const speech = makeSpeechStub();
  const player = createStoryVoice({
    audio: makeAudioStub(),
    speech,
    getSettings: () => ({ storyVoices: true }),
    getStoryState: () => ({}),
  });
  const order = [];
  player.speak('Primer.', {
    speaker: null,
    followSpoken: 'Choices.',
    onDone: () => { order.push('done'); },
  });
  assert.deepEqual(order, ['done']);
  assert.equal(speech.said.length, 2);
  assert.match(speech.said[0].text, /Primer/);
  assert.match(speech.said[1].text, /Choices/);
});

test('character voices off still delivers follow lines and the chain', () => {
  const speech = makeSpeechStub();
  const player = createStoryVoice({
    audio: makeAudioStub(),
    speech,
    getSettings: () => ({ storyVoices: false }),
    getStoryState: () => ({}),
  });
  let done = 0;
  const res = player.speak('Primer.', {
    speaker: null,
    fileKey: 'story-interview-q_intro',
    followSpoken: 'Choices.',
    onDone: () => { done++; },
  });
  assert.equal(res.mode, 'guidance');
  assert.equal(speech.said.length, 2);
  assert.equal(done, 1);
});

test('a new beat cuts leftover speech so a recording never plays over the tap', async () => {
  // Double-tapping Continue used to stack the label over the narration: the
  // tap said "Continue", the press said "Continue", and the recording played
  // over both because the file path issued no speech to supersede them.
  const speech = makeSpeechStub();
  const audio = makeAudioStub();
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({ heroName: 'Aarav' }),
  });
  await player.speakNode({ id: 'ch1_letter', speaker: null, text: 'First.', sfx: null }, {});
  await tick(20);
  assert.equal(speech.stops, 1, 'the beat must cut leftover speech before the recording');
  assert.equal(audio.played.length, 1);
});

test('a one-off recording cuts leftover speech before it starts', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub();
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({}),
  });
  player.speak('Good morning. Please sit down.', { speaker: 'Ms. Farida Qureshi', fileKey: 'story-interview-q_intro' });
  await tick(20);
  assert.equal(speech.stops, 1);
  assert.equal(audio.played.length, 1);
});

test('a synthesis beat cuts leftover speech too', () => {
  const speech = makeSpeechStub();
  const player = createStoryVoice({
    audio: makeAudioStub({ buffer: null }),
    speech,
    getSettings: () => ({ storyVoices: true }),
    getStoryState: () => ({}),
  });
  player.speak('The man argued for forty minutes.', { speaker: 'Mithin' });
  assert.equal(speech.stops, 1);
  assert.equal(speech.said.length, 1);
});

test('a follow line never silences the beat it joins', () => {
  const speech = makeSpeechStub();
  const player = createStoryVoice({
    audio: makeAudioStub(),
    speech,
    getSettings: () => ({ storyVoices: true }),
    getStoryState: () => ({}),
  });
  player.speak('Nine thousand rupees.', { speaker: 'Ms. Farida Qureshi', follow: true });
  assert.equal(speech.stops, 0, 'a follow line joins the beat instead of cutting it');
  assert.equal(speech.said.length, 1);
});

test('skipped lines leave speech alone', async () => {
  const speech = makeSpeechStub();
  const player = createStoryVoice({
    audio: makeAudioStub(),
    speech,
    getSettings: () => ({ storyVoices: true }),
    getStoryState: () => ({}),
  });
  await player.speakNode(null, {});
  player.speak('', { speaker: null });
  assert.equal(speech.stops, 0);
});

test('characters never announce their own names aloud, but captions keep them', () => {
  const speech = makeSpeechStub();
  const player = createStoryVoice({
    audio: makeAudioStub(),
    speech,
    getSettings: () => ({ storyVoices: true }),
    getStoryState: () => ({}),
  });
  player.speak('You came back. Most of them do not.', { speaker: 'Ms. Farida Qureshi' });
  assert.equal(speech.said.length, 1);
  assert.doesNotMatch(speech.said[0].text, /Qureshi/);
  assert.match(speech.said[0].text, /You came back/);
  // Readers still see who is talking: the caption keeps the speaker name.
  assert.match(speech.mirrored.join(' '), /Ms. Farida Qureshi: You came back/);
});

// ------------------------------------------------- narrator/character beats

test('every split node rejoins its text exactly with cast-mapped voices', () => {
  assert.deepEqual(validateStoryBeats(), []);
  assert.equal(Object.keys(STORY_BEATS).length, 31);
  // Quoted lines inside another node's scene keep their own voice: Joseph
  // speaks his words even when the node belongs to Mithin or the narrator.
  assert.equal(speakerKey(STORY_BEATS.ch4_mithin_fair[1].speaker), 'joseph');
  assert.equal(speakerKey(STORY_BEATS.ch4_friends[2].speaker), 'joseph');
  assert.equal(speakerKey(STORY_BEATS.ch7_lost[1].speaker), 'joseph');
  assert.equal(speakerKey(STORY_BEATS.ch3_saturdays[1].speaker), 'qureshi');
});

test('beat clips follow the same baked-name and salary rules as node clips', () => {
  assert.equal(storyBeatKey('ch1_argument_choice', 1), null, 'narrator beats are never recorded');
  assert.equal(storyBeatKey('ch3_signed', 0), null, 'salary beats are never recorded');
  assert.equal(storyBeatKey('ch2_passed', 0), 'story-ch2_passed_b1');
  assert.equal(storyBeatKey('ch2_passed', 2), 'story-ch2_passed_b3');
  assert.equal(storyBeatKey('ch2_passed', 9), null);
  assert.equal(bakedBeatUsable('ch4_joseph_name', 0, { heroName: 'Aarav' }), true);
  assert.equal(bakedBeatUsable('ch4_joseph_name', 0, { heroName: 'Meera' }), false);
  assert.equal(bakedBeatUsable('ch4_joseph_name', 2, { heroName: 'Meera' }), true);
  assert.equal(bakedBeatUsable('ch1_argument_choice', 1, {}), false);
});

test('a split node plays narrator and character beats in order, then the choices', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub();
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({ heroName: 'Aarav' }),
    beatPauseSameMs: 5,
    beatPauseChangeMs: 5,
    beatEstimateMs: 5,
  });
  const res = await player.speakNode(
    { id: 'ch2_passed', speaker: 'Ms. Farida Qureshi', text: 'Right. She closes the folder. Wait here.', sfx: null },
    { choicesSpoken: 'Swipe up or tap to continue.' }
  );
  assert.equal(res.mode, 'beats');
  assert.equal(res.voice, 'qureshi');
  assert.equal(res.beats, 5);
  assert.deepEqual(audio.loadedKeys, ['story-ch2_passed_b1', 'story-ch2_passed_b3', 'story-ch2_passed_b5']);
  await tick(20);
  assert.equal(audio.played.length, 1);
  assert.equal(audio.played[0].key, 'story-ch2_passed_b1');
  audio.handle.onended();
  await tick(30);
  assert.match(speech.said[0].text, /She closes the folder/);
  assert.equal(speech.said[0].opts.pitch, CHARACTER_VOICES.narrator.pitch);
  await tick(30);
  assert.equal(audio.played.length, 2);
  assert.equal(audio.played[1].key, 'story-ch2_passed_b3');
  audio.handle.onended();
  await tick(30);
  assert.match(speech.said[1].text, /Then she almost smiles/);
  await tick(30);
  assert.equal(audio.played.length, 3);
  assert.equal(audio.played[2].key, 'story-ch2_passed_b5');
  audio.handle.onended();
  await tick(20);
  const last = speech.said[speech.said.length - 1];
  assert.match(last.text, /Swipe up or tap to continue/);
  assert.equal(last.opts.voice, undefined, 'choices stay guidance');
  assert.equal(speech.stops, 3, 'the beat start plus a tail-cut before each later file beat');
});

test('a split node with no usable files speaks every beat in its cast voice', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub({ buffer: null });
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({ heroName: 'Aarav', salary: 9000 }),
    beatPauseSameMs: 5,
    beatPauseChangeMs: 5,
    beatEstimateMs: 5,
  });
  const res = await player.speakNode(
    { id: 'ch3_signed', speaker: 'Ms. Farida Qureshi', text: 'Nine thousand a month. She pushes the form across.', sfx: null },
    { choicesSpoken: '' }
  );
  assert.equal(res.mode, 'beats');
  await tick(80);
  assert.equal(audio.played.length, 0);
  assert.deepEqual(audio.loadedKeys, ['story-ch3_signed_b3'], 'only the non-salary beat preloads');
  assert.equal(speech.said.length, 3);
  assert.equal(speech.said[0].opts.pitch, CHARACTER_VOICES.qureshi.pitch);
  assert.match(speech.said[0].text, /9000 a month/, 'placeholders resolve per beat');
  assert.equal(speech.said[1].opts.pitch, CHARACTER_VOICES.narrator.pitch);
  assert.equal(speech.said[2].opts.pitch, CHARACTER_VOICES.qureshi.pitch);
  assert.doesNotMatch(
    speech.said.map((s) => s.text).join(' '),
    /Qureshi/,
    'characters never announce their own names aloud'
  );
});

test('stop() cancels beats that have not played yet', async () => {
  const speech = makeSpeechStub();
  const audio = makeAudioStub();
  const player = createStoryVoice({
    audio,
    speech,
    getSettings: () => ({ storyVoices: true, speechVolume: 1 }),
    getStoryState: () => ({ heroName: 'Aarav' }),
    beatPauseSameMs: 40,
    beatPauseChangeMs: 40,
    beatEstimateMs: 40,
  });
  await player.speakNode({ id: 'ch4_keen', speaker: 'Joseph', text: 'Joseph finds you. Sit down and eat.', sfx: null }, {});
  await tick(20);
  assert.equal(speech.said.length, 1, 'only the opening narrator beat speaks');
  player.stop();
  await tick(150);
  assert.equal(audio.played.length, 0, 'a stopped chain must never start its file beats late');
  assert.equal(speech.said.length, 1);
});
