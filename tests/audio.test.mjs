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
import {
  AUDIO_MANIFEST,
  createAudio,
  DUCK_LEVELS,
  eagerAudioNames,
  LAZY_AUDIO,
  MUSIC_CREDITS,
  musicAttributionLines,
} from '../src/core/audio.js';
import { createFakeAudioContext, createFakeClock, createFakeFetch, fakeBuffer } from './helpers/audio.mjs';

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

// ------------------------------------------------------- full-length music

/** An audio object wired to a recording fetch, for the lazy-loading tests. */
async function makeFetchingAudio(settings = {}, fetchOpts = {}) {
  const fake = createFakeAudioContext();
  const fetchImpl = createFakeFetch(fetchOpts);
  const state = { sfx: true, sfxVolume: 0.85, music: true, musicVolume: 0.5, ...settings };
  const audio = createAudio({
    getSettings: () => state,
    AudioContext: fake.AudioContext,
    fetch: fetchImpl,
  });
  await audio.unlock();
  return { audio, fake, state, fetchImpl };
}

test('every lazy track is a real manifest entry, and none is loaded eagerly', () => {
  assert.ok(LAZY_AUDIO.size >= 6, 'the full-length beds should be marked lazy');
  for (const name of LAZY_AUDIO) {
    assert.ok(AUDIO_MANIFEST[name], `${name} is lazy but missing from the manifest`);
    // Lazy means "long recording, load on demand": the full-length music beds
    // and the long field-recorded scene beds (rain, wipers, ambience).
    assert.match(AUDIO_MANIFEST[name], /music\/|scene\/|adventure\//, `${name} should point at a bed folder`);
  }
  const eager = eagerAudioNames();
  for (const name of eager) assert.ok(!LAZY_AUDIO.has(name), `${name} is both eager and lazy`);
  assert.equal(eager.length + LAZY_AUDIO.size, Object.keys(AUDIO_MANIFEST).length);
});

test('boot loading never fetches the music beds', async () => {
  const { audio, fetchImpl } = await makeFetchingAudio();
  await audio.loadAll();
  const music = fetchImpl.requested.filter((url) => url.includes('/music/') && url.endsWith('.mp3'));
  assert.deepEqual(music, [], `boot must not download megabytes of music: ${music.join(', ')}`);
  assert.ok(fetchImpl.requested.length > 60, 'the eager set should still have been fetched');
});

test('a music bed is fetched only when it is first played', async () => {
  const { audio, fake, fetchImpl } = await makeFetchingAudio();
  assert.equal(audio.music.playing, false);

  const ok = await audio.music.play('music-race');
  assert.equal(ok, true, 'the track should start');
  assert.equal(audio.music.current, 'music-race');
  assert.equal(audio.music.playing, true);
  assert.ok(
    fetchImpl.requested.includes(AUDIO_MANIFEST['music-race']),
    `the bed should be fetched on demand: ${fetchImpl.requested.join(', ')}`,
  );
  assert.ok(fake.decoded.length > 0, 'the bed should be decoded');
  // It runs on the music bus, so the settings volume and the speech duck apply.
  const musicGain = fake.gains[2];
  assert.ok(musicGain, 'the music group gain should exist');
});

test('repeating the same track does not restart or re-download it', async () => {
  const { audio, fetchImpl } = await makeFetchingAudio();
  await audio.music.play('music-theme-menu');
  const downloads = fetchImpl.requested.length;
  assert.equal(await audio.music.play('music-theme-menu'), true);
  assert.equal(fetchImpl.requested.length, downloads, 'the track is already loaded and playing');
});

test('switching music off stops the bed instead of playing it quietly', async () => {
  const { audio, state, fetchImpl } = await makeFetchingAudio({ music: false });
  const ok = await audio.music.play('music-race');
  assert.equal(ok, false, 'music that is switched off must not start');
  assert.equal(audio.music.playing, false);
  assert.deepEqual(fetchImpl.requested, [], 'and it must not be downloaded either');
});

test('a track that fails to load is reported, and does not break anything', async () => {
  const url = AUDIO_MANIFEST['music-race'];
  const { audio } = await makeFetchingAudio({}, { failFor: [url] });
  const ok = await audio.music.play('music-race');
  assert.equal(ok, false);
  assert.equal(audio.music.playing, false);
  const names = audio.failedAssets.map((f) => f.name);
  assert.ok(names.includes('music-race'), 'the failure should be recorded for the audio status screen');
});

test('a scene change during a slow download wins over the older request', async () => {
  // The player moves between scenes faster than a 5 MB bed can arrive on a
  // phone. The stale track must not start late over the top of the newer one.
  const fake = createFakeAudioContext();
  const state = { sfx: true, sfxVolume: 0.85, music: true, musicVolume: 0.5 };
  let releaseSlow;
  const gate = new Promise((r) => {
    releaseSlow = r;
  });
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    if (String(url).endsWith('theme-menu.mp3')) await gate;
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(64) };
  };
  const audio = createAudio({ getSettings: () => state, AudioContext: fake.AudioContext, fetch: fetchImpl });
  await audio.unlock();

  const slow = audio.music.play('music-theme-menu');
  const fast = await audio.music.play('music-race');
  assert.equal(fast, true, 'the newer scene should start');
  releaseSlow();
  const slowResult = await slow;

  assert.equal(slowResult, false, 'the superseded request must report that it did not start');
  assert.equal(audio.music.current, 'music-race', 'the newer track must still be the one playing');
});

test('stopping music clears the track so a later scene can start fresh', async () => {
  const { audio } = await makeFetchingAudio();
  await audio.music.play('music-story-city');
  audio.music.stop();
  assert.equal(audio.music.playing, false);
  assert.equal(audio.music.current, null);
  assert.equal(await audio.music.play('music-story-city'), true, 'it should be playable again');
});

// ------------------------------------------------- licence and attribution

test('every music bed has recorded licence evidence', () => {
  assert.ok(MUSIC_CREDITS.length >= 6, 'each full-length bed should be documented');
  for (const credit of MUSIC_CREDITS) {
    assert.ok(AUDIO_MANIFEST[credit.key], `${credit.key} is credited but not in the manifest`);
    assert.ok(credit.title && credit.title.length > 1, `${credit.key} needs an original title`);
    assert.ok(credit.artist && credit.artist.length > 1, `${credit.key} needs an artist`);
    assert.ok(credit.licence && credit.licence.length > 1, `${credit.key} needs a licence`);
    assert.ok(/^https:\/\//.test(credit.url ?? ''), `${credit.key} needs a source URL`);
    assert.equal(typeof credit.attributionRequired, 'boolean', `${credit.key} must state whether attribution is required`);
  }
  // Every lazy music bed must be covered, so a new track cannot ship undocumented.
  for (const name of LAZY_AUDIO) {
    assert.ok(MUSIC_CREDITS.some((c) => c.key === name), `${name} ships without licence evidence`);
  }
});

test('CC BY tracks produce the attribution the licence requires', () => {
  const required = MUSIC_CREDITS.filter((c) => c.attributionRequired);
  assert.ok(required.length >= 2, 'the CC BY tracks should be flagged as requiring attribution');
  const lines = musicAttributionLines();
  assert.ok(lines.length >= 2, 'attribution must not be empty');
  for (const credit of required) {
    const line = lines.find((l) => l.includes(credit.artist));
    assert.ok(line, `${credit.artist} needs an attribution line`);
    assert.ok(line.includes(credit.url), `${credit.artist}'s line needs the source URL`);
    assert.ok(/Attribution/i.test(line), `${credit.artist}'s line needs to name the licence`);
  }
});

test('public domain tracks are credited but not listed as obligations', () => {
  const pd = MUSIC_CREDITS.filter((c) => !c.attributionRequired);
  assert.ok(pd.length >= 1, 'the FreePD tracks should be marked as not requiring attribution');
  const lines = musicAttributionLines().join(' ');
  for (const credit of pd) {
    assert.ok(!lines.includes(credit.artist), `${credit.artist} is public domain and should not appear as an obligation`);
  }
});

test('the in-game credits screen carries the attribution, not just the docs', async () => {
  // CC BY attribution has to be met somewhere a player can actually reach. The
  // screen builds its lines from the same source of truth as these tests.
  const { readFileSync } = await import('node:fs');
  const screen = readFileSync(new URL('../src/ui/menuScreens.js', import.meta.url), 'utf8');
  assert.match(screen, /musicAttributionLines\(\)/, 'the credits screen must render the attribution lines');
  assert.ok(
    !/licensed Creative Commons Zero 1\.0, recorded by Kenney Vleugels/.test(screen) ||
      /music is licensed separately/.test(screen),
    'the screen must not claim the music is CC0 Kenney - three tracks are CC BY 4.0',
  );
});

test('road speed lifts the engine note even at constant rpm', async () => {
  // A tall gear at 100 kph and a short gear at 100 kph should not sound
  // identical, and holding the throttle open should feel like going faster.
  const { audio, fake } = await makeRunningEngine();
  const low = fake.sources[0];
  const fixed = { rpm: 4000, idleRpm: 900, redlineRpm: 7000, throttle: 1, load: 1 };

  audio.engine.update({ ...fixed, speedNorm: 0 });
  const crawling = low.playbackRate.value;

  audio.engine.update({ ...fixed, speedNorm: 1 });
  const atSpeed = low.playbackRate.value;

  assert.ok(atSpeed > crawling, `speed should raise the note, ${crawling} -> ${atSpeed}`);
  assert.ok(atSpeed <= 4, 'and must stay inside the range Web Audio allows');
});

test('the engine range is wide enough to hear acceleration', async () => {
  const { audio, fake } = await makeRunningEngine();
  const low = fake.sources[0];
  audio.engine.update({ rpm: 900, idleRpm: 900, redlineRpm: 7000, throttle: 0, load: 0, speedNorm: 0 });
  const idle = low.playbackRate.value;
  audio.engine.update({ rpm: 7000, idleRpm: 900, redlineRpm: 7000, throttle: 1, load: 1, speedNorm: 1 });
  const redline = low.playbackRate.value;
  // Under about a 2x range the pitch change is hard to hear through a phone
  // speaker, which is the whole point for a player who cannot see the revs.
  assert.ok(redline / idle > 2.5, `idle ${idle.toFixed(2)} to redline ${redline.toFixed(2)} should be a wide, audible change`);
});

test('stopAll stops recorded loops AND one-shots, including delayed sounds', async () => {
  const { audio, fake } = makeAudio(); await audio.unlock();
  for (const key of ['ui-click', 'engine-loop', 'engine-loop-alt', 'music-race']) audio.buffers.set(key, fakeBuffer());
  audio.play('ui-click', { delay: 5 }); audio.engine.start();
  audio.loop('music-race', { group: 'music' });
  assert.ok(fake.sources.length >= 4);
  audio.setActive(false);
  for (const src of fake.sources) assert.notEqual(src.stoppedAt, null, 'every active recording must stop');
  assert.equal(audio.engine.handleLow, null);
  assert.equal(audio.play('ui-click'), false); assert.equal(audio.loop('engine-loop'), null);
  audio.setActive(true); assert.equal(audio.play('ui-click'), true);
});
