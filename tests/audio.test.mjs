/**
 * The audio mix: ducking behaviour and the engine's response to speed and load.
 *
 * This suite exists because of a specific, user-visible failure. Game TalkBack
 * was inaudible while driving: `duck()` timed the duck at 420 ms, which is
 * shorter than almost every announcement, so the engine returned to full volume
 * mid-sentence and masked the guidance. Corner warnings and collision callouts
 * were queued, spoken, and effectively unheard. The duck is now latched for the
 * duration of the utterance, and the first test below is the regression guard.
 *
 * It also covers the brief's requirement that engine audio is speed dependent:
 * a recorded loop pitched up with rpm and crossfaded from a low layer to a high
 * layer, getting louder under load. No synthesis anywhere - only playback rate
 * and gain on recorded samples.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, DUCK_LEVELS } from '../src/core/audio.js';
import { createFakeAudioContext, createFakeClock, fakeBuffer } from './helpers/audio.mjs';

function makeAudio(settings = {}) {
  const fake = createFakeAudioContext();
  const state = {
    sfx: true,
    sfxVolume: 0.85,
    music: true,
    musicVolume: 0.5,
    talkback: true,
    ...settings,
  };
  const audio = createAudio({ getSettings: () => state, AudioContext: fake.AudioContext });
  return { audio, fake, state };
}

/** An audio object with the engine loops loaded and running. */
async function makeRunningEngine(settings = {}) {
  const { audio, fake, state } = makeAudio(settings);
  await audio.unlock();
  audio.buffers.set('engine-loop', fakeBuffer('engine-loop'));
  audio.buffers.set('engine-loop-alt', fakeBuffer('engine-loop-alt'));
  const ok = audio.engine.start();
  return { audio, fake, state, ok };
}

// ------------------------------------------------------------------- ducking

test('the duck is held for the whole utterance, not 420ms (regression)', async () => {
  const { audio, fake } = makeAudio();
  await audio.unlock();
  const unduckedEngine = audio.levels.engine;
  const duckedEngine = unduckedEngine * DUCK_LEVELS.engine;
  const clock = createFakeClock();
  try {
    audio.duck();
    assert.equal(audio.ducked, true, 'ducking should latch immediately');
    assert.ok(audio.levels.engine <= duckedEngine + 1e-9, 'the engine should drop as soon as speech starts');

    // A typical corner announcement runs two to four seconds. Under the old
    // timing the engine was back at full volume by 420ms, masking the rest of
    // it - so step well past that and assert the mix never comes back up.
    for (let elapsed = 500; elapsed <= 8000; elapsed += 500) {
      clock.advance(500);
      fake.advance(0.1);
      audio.tick();
      assert.equal(audio.ducked, true, `still speaking at ${elapsed}ms: the duck must not have released`);
      assert.ok(
        audio.levels.engine <= duckedEngine + 1e-9,
        `engine must stay ducked at ${elapsed}ms, got ${audio.levels.engine} (unducked ${unduckedEngine})`,
      );
    }
  } finally {
    clock.release();
  }
});

test('the duck releases a short tail after the utterance settles', async () => {
  const { audio } = makeAudio();
  await audio.unlock();
  const clock = createFakeClock();
  try {
    audio.duck();
    audio.unduck();
    audio.tick();
    assert.equal(audio.ducked, true, 'the tail should keep the mix down briefly so it does not jump back');

    clock.advance(DUCK_LEVELS.recoveryMs + 50);
    audio.tick();
    assert.equal(audio.ducked, false, 'the duck should be gone once the tail has elapsed');
  } finally {
    clock.release();
  }
});

test('a hung utterance cannot leave the game permanently quiet', async () => {
  const { audio } = makeAudio();
  await audio.unlock();
  const clock = createFakeClock();
  try {
    audio.duck();
    clock.advance(DUCK_LEVELS.holdMs + 1000);
    audio.tick();
    assert.equal(audio.ducked, false, 'the safety net must release a duck that was never unducked');
    assert.ok(DUCK_LEVELS.holdMs > 12000, 'the net must outlast the speech module own 12s timer');
  } finally {
    clock.release();
  }
});

test('voice is never ducked, and engine/music/effects are', async () => {
  const { audio } = makeAudio();
  await audio.unlock();
  const before = audio.levels;
  audio.duck();
  const during = audio.levels;

  assert.equal(during.voice, 1, 'the accessibility surface must never be attenuated');
  assert.ok(during.engine < before.engine * 0.5, `engine should duck hard, ${before.engine} -> ${during.engine}`);
  assert.ok(during.music < before.music * 0.5, `music should duck hard, ${before.music} -> ${during.music}`);
  assert.ok(during.sfx < before.sfx, 'effects should duck');
  // A collision sound is information, not atmosphere, so it ducks less than the engine.
  assert.ok(during.sfx > during.engine, 'impact effects should stay more audible than the engine');
});

test('ducked levels actually reach the gain nodes, as ramps not jumps', async () => {
  const { audio, fake } = makeAudio();
  await audio.unlock();
  // Creation order in ensureContext: master, sfx, music, voice, engine.
  const [master, sfx, music, voice, engine] = fake.gains;
  assert.ok(master && sfx && music && voice && engine, 'the four group gains should exist');

  const unduckedEngine = engine.gain.value;
  audio.duck();
  const duckedEngine = engine.gain.value;

  assert.ok(duckedEngine < unduckedEngine, `engine gain should drop, ${unduckedEngine} -> ${duckedEngine}`);
  assert.equal(voice.gain.value, 1, 'the voice group should be untouched');
  assert.ok(
    engine.gain.ramps.length > 0,
    'the change should go through setTargetAtTime so ducking does not click',
  );
});

test('turning sound effects off silences the engine too', async () => {
  const { audio, state } = makeAudio();
  await audio.unlock();
  state.sfx = false;
  audio.setVolumes();
  assert.equal(audio.levels.engine, 0, 'the engine lives on the sfx bus, so muting sfx must mute it');
  assert.equal(audio.levels.voice, 1, 'speech must survive a muted effects bus');
});

// ------------------------------------------------------- engine response

test('engine pitch rises with rpm, from idle to redline', async () => {
  const { audio, fake, ok } = await makeRunningEngine();
  assert.equal(ok, true, 'both recorded engine layers should start');

  const low = fake.sources[0];
  const high = fake.sources[1];
  assert.ok(low && high, 'two buffer sources should be running');

  audio.engine.update({ rpm: 900, idleRpm: 900, redlineRpm: 7000, throttle: 0.2, load: 0.2 });
  const idleRate = low.playbackRate.value;

  audio.engine.update({ rpm: 7000, idleRpm: 900, redlineRpm: 7000, throttle: 1, load: 1 });
  const redlineRate = low.playbackRate.value;

  assert.ok(redlineRate > idleRate * 2, `pitch should more than double, ${idleRate} -> ${redlineRate}`);
  assert.ok(redlineRate <= 4, 'playback rate must stay inside the range Web Audio allows');
  // The high layer tracks slightly above the low one so the two do not phase.
  assert.ok(high.playbackRate.value > redlineRate, 'the high layer should sit just above the low one');
});

test('engine crossfades from the low layer to the high layer with rpm', async () => {
  const { audio, fake } = await makeRunningEngine();
  const lowGain = fake.gains[5];
  const highGain = fake.gains[6];

  audio.engine.update({ rpm: 900, idleRpm: 900, redlineRpm: 7000, throttle: 0.3, load: 0.3 });
  const idleShare = highGain.gain.value / Math.max(1e-6, highGain.gain.value + lowGain.gain.value);

  audio.engine.update({ rpm: 6500, idleRpm: 900, redlineRpm: 7000, throttle: 1, load: 1 });
  const highShare = highGain.gain.value / Math.max(1e-6, highGain.gain.value + lowGain.gain.value);

  assert.ok(idleShare < 0.15, `at idle the high layer should be nearly silent, got ${idleShare}`);
  assert.ok(highShare > 0.6, `near redline the high layer should dominate, got ${highShare}`);
});

test('engine gets louder under throttle at the same rpm', async () => {
  const { audio, fake } = await makeRunningEngine();
  const lowGain = fake.gains[5];
  const highGain = fake.gains[6];
  const total = () => lowGain.gain.value + highGain.gain.value;

  audio.engine.update({ rpm: 4000, idleRpm: 900, redlineRpm: 7000, throttle: 0, load: 0 });
  const coasting = total();

  audio.engine.update({ rpm: 4000, idleRpm: 900, redlineRpm: 7000, throttle: 1, load: 1 });
  const onThrottle = total();

  assert.ok(onThrottle > coasting * 1.8, `accelerating should be clearly louder, ${coasting} -> ${onThrottle}`);
});

test('engine update is a no-op before the loops are started', () => {
  const { audio } = makeAudio();
  assert.equal(audio.engine.update({ rpm: 3000 }), false, 'with no context there is nothing to drive');
});

test('stopping the engine fades both layers rather than cutting them', async () => {
  const { audio, fake } = await makeRunningEngine();
  audio.engine.update({ rpm: 5000, idleRpm: 900, redlineRpm: 7000, throttle: 1, load: 1 });
  audio.engine.stop();

  for (const src of [fake.sources[0], fake.sources[1]]) {
    assert.ok(src.stoppedAt !== null, 'the source should be scheduled to stop');
    assert.ok(src.stoppedAt > 0, 'the stop should be scheduled in the future, allowing a fade');
  }
  assert.equal(audio.engine.handleLow, null, 'handles should be cleared so a restart does not stack loops');
  assert.equal(audio.engine.handleHigh, null);
});

test('duck levels are sane for an audio-first game', () => {
  assert.ok(DUCK_LEVELS.engine < 0.35, 'the engine must drop far enough for speech to be intelligible');
  assert.ok(DUCK_LEVELS.music < DUCK_LEVELS.engine, 'music should sit under the engine while speaking');
  assert.ok(DUCK_LEVELS.holdMs > DUCK_LEVELS.recoveryMs, 'the safety net must outlast the release tail');
  assert.ok(DUCK_LEVELS.rampSeconds > 0, 'gain changes should be smoothed');
});
