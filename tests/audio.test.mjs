/** Fixed independent mix: speech never attenuates recordings. Also checks
 * recorded engine pitch/crossfade, music loading and lifecycle silence. */

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

test('speech leaves every group at a fixed gain for a long utterance', async () => {
  const { audio, fake } = makeAudio(); await audio.unlock();
  const before = audio.levels;
  audio.duck();
  for (let elapsed = 0; elapsed < 20; elapsed++) {
    fake.advance(1); audio.tick();
    assert.deepEqual(audio.levels, before); assert.equal(audio.ducked, false);
  }
  audio.unduck(); audio.tick(); assert.deepEqual(audio.levels, before);
});

test('speech end has no recovery tail, rise, or timer', async () => {
  const { audio, fake } = makeAudio(); await audio.unlock();
  const before = fake.gains.slice(0,5).map(g => [g.gain.value,g.gain.ramps.length]);
  audio.duck(); audio.unduck(); fake.advance(20); audio.tick();
  assert.deepEqual(fake.gains.slice(0,5).map(g => [g.gain.value,g.gain.ramps.length]), before);
});

test('overlapping and hung speech cannot change any group level', async () => {
  const { audio } = makeAudio(); await audio.unlock(); const before = audio.levels;
  const clock = createFakeClock();
  try {
    audio.duck(); audio.duck(); audio.unduck(); clock.advance(30000); audio.tick();
    assert.deepEqual(audio.levels,before); assert.equal(audio.ducked,false);
  } finally { clock.release(); }
});

test('voice, engine, music and effects are never speech-ducked', async () => {
  const { audio } = makeAudio(); await audio.unlock(); const before=audio.levels;
  audio.duck(); assert.deepEqual(audio.levels,before);
  assert.equal(audio.levels.voice,1); assert.equal(audio.levels.sfx,0.85);
  assert.equal(audio.levels.music,0.5); assert.equal(audio.levels.engine,0.85);
});

test('manual volume changes reach their own gain nodes, independently and smoothly', async () => {
  const { audio, fake, state } = makeAudio(); await audio.unlock();
  const [,sfx,music,voice,engine] = fake.gains;
  state.musicVolume=0.2; audio.setVolumes();
  assert.equal(music.gain.value,0.2); assert.equal(sfx.gain.value,0.85);
  state.sfxVolume=0.7; audio.setVolumes();
  assert.equal(music.gain.value,0.2); assert.equal(sfx.gain.value,0.7); assert.equal(engine.gain.value,0.7);
  assert.equal(voice.gain.value,1);
  assert.ok(sfx.gain.ramps.at(-1).timeConstant>0);
  const before=fake.gains.map(g=>g.gain.ramps.length);
  audio.duck(); audio.unduck(); audio.tick();
  assert.deepEqual(fake.gains.map(g=>g.gain.ramps.length),before);
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

test('legacy duck compatibility multipliers are all unity', () => {
  assert.equal(DUCK_LEVELS.engine,1); assert.equal(DUCK_LEVELS.music,1); assert.equal(DUCK_LEVELS.sfx,1);
  assert.ok(DUCK_LEVELS.rampSeconds>0);
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

test('new audio defaults are effects/engine 70%, music 20%, never speech-triggered', async () => {
  const fake=createFakeAudioContext(); const audio=createAudio({AudioContext:fake.AudioContext});
  await audio.unlock(); assert.deepEqual(audio.levels,{voice:1,sfx:0.7,music:0.2,engine:0.7});
  audio.duck(); audio.unduck(); audio.tick();
  assert.deepEqual(audio.levels,{voice:1,sfx:0.7,music:0.2,engine:0.7});
});

test('horn is a recorded SFX loop, starts once, stops on release and restarts cleanly', async () => {
  const {audio,fake}=makeAudio(); await audio.unlock();
  audio.buffers.set('car-horn',fakeBuffer(3.2));
  assert.match(AUDIO_MANIFEST['car-horn'],/adventure\/car-horn\.mp3$/);
  const first=audio.horn.start(); assert.ok(first); assert.equal(fake.sources.at(-1).loop,true);
  assert.equal(audio.horn.start(),first); assert.equal(fake.sources.length,1);
  audio.horn.stop(); assert.equal(audio.horn.handle,null); assert.ok(fake.sources[0].stoppedAt!==null);
  assert.notEqual(audio.horn.start(),first); assert.equal(fake.sources.length,2);
  audio.stopAll(); assert.equal(audio.horn.handle,null); assert.equal(audio.horn.wanted,false);
  audio.setActive(false); assert.equal(audio.horn.start(),null);
  audio.setActive(true); assert.equal(audio.horn.handle,null,'foreground does not restart a horn');
});

test('late horn download cannot begin after release, Exit or background', async () => {
  const fake=createFakeAudioContext(); let complete;
  const fetch=()=>new Promise(resolve=>{complete=()=>resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});});
  const audio=createAudio({AudioContext:fake.AudioContext,fetch}); await audio.unlock();
  audio.horn.start(); const pending=audio.horn.pending; assert.ok(pending);
  audio.horn.stop(); complete(); await pending;
  assert.equal(audio.horn.handle,null); assert.equal(fake.sources.length,0);
});
