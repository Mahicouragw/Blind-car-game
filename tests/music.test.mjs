/**
 * The music director: which bed plays in which scene, and when it stays quiet.
 *
 * Screens do not choose their own music, they announce themselves on the bus, so
 * the whole mapping is data and can be tested without a browser or an audio
 * device. The stub audio object records what was asked for, which is enough to
 * prove the decisions - actual playback is covered in tests/audio.test.mjs
 * against a fake Web Audio graph.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_MANIFEST } from '../src/core/audio.js';
import { createBus } from '../src/core/bus.js';
import {
  createMusicDirector,
  DEFAULT_TRACK,
  SCREEN_TRACKS,
  TRACK_FOR_CHAPTER,
  trackForChapter,
  trackForScreen,
} from '../src/core/musicDirector.js';

/** Records every request instead of playing anything. */
function stubAudio() {
  const calls = [];
  return {
    calls,
    music: {
      current: null,
      handle: null,
      async play(track) {
        calls.push({ op: 'play', track });
        this.current = track;
        this.handle = { track };
        return true;
      },
      stop(fade) {
        calls.push({ op: 'stop', fade });
        this.current = null;
        this.handle = null;
      },
    },
  };
}

function makeDirector(settings = {}) {
  const events = createBus();
  const audio = stubAudio();
  const state = { music: true, musicVolume: 0.5, ...settings };
  const director = createMusicDirector({ audio, events, getSettings: () => state });
  return { director, events, audio, state };
}

const played = (audio) => audio.calls.filter((c) => c.op === 'play').map((c) => c.track);

// ---------------------------------------------------------------- the mapping

test('every chapter maps to a real music track', () => {
  for (const [chapter, track] of Object.entries(TRACK_FOR_CHAPTER)) {
    assert.ok(AUDIO_MANIFEST[track], `chapter ${chapter} maps to "${track}", which is not in the manifest`);
  }
  for (let chapter = 1; chapter <= 7; chapter += 1) {
    assert.ok(AUDIO_MANIFEST[trackForChapter(chapter)], `chapter ${chapter} has no playable bed`);
  }
});

test('the chapter beds match what the chapters are about', () => {
  // Chapter 1 is the family and the rent notice; 2 and 3 are the interview and
  // the negotiation, which are pressure scenes; 4 is the workshop in the city;
  // 5 and 6 are warm rather than tense; 7 is the race.
  assert.equal(trackForChapter(1), 'music-story-family');
  assert.equal(trackForChapter(2), 'music-story-tension');
  assert.equal(trackForChapter(3), 'music-story-tension');
  assert.equal(trackForChapter(4), 'music-story-city');
  assert.equal(trackForChapter(7), 'music-race');
});

test('chapters that are not playable yet still get a bed, not a crash', () => {
  // Chapters 8-10 are declared but not implemented. They are disabled in the
  // menu, but the mapping must not throw or return undefined if reached.
  for (const chapter of [8, 9, 10]) {
    const track = trackForChapter(chapter);
    assert.ok(track, `chapter ${chapter} should fall back to a bed`);
    assert.ok(AUDIO_MANIFEST[track], `the fallback for chapter ${chapter} must be a real track`);
  }
  assert.ok(AUDIO_MANIFEST[trackForChapter('nonsense')], 'a non-numeric chapter must fall back too');
  assert.ok(AUDIO_MANIFEST[trackForChapter(undefined)]);
});

test('settings and audio screens are deliberately silent', () => {
  // These screens read values aloud and audition sound effects, so a music bed
  // would sit under exactly what the player is trying to hear.
  assert.equal(trackForScreen('settings'), null);
  assert.equal(trackForScreen('audio'), null);
});

test('every mapped screen track is a real manifest entry', () => {
  for (const [screen, track] of Object.entries(SCREEN_TRACKS)) {
    if (track === null) continue;
    assert.ok(AUDIO_MANIFEST[track], `screen "${screen}" maps to "${track}", which is not in the manifest`);
  }
  assert.ok(AUDIO_MANIFEST[DEFAULT_TRACK], 'the default track must exist');
});

test('unknown screens fall back to the menu theme rather than silence', () => {
  // Tutorial step screens (accelerate, brake, steer, uturn...) are mounted like
  // any other screen and are not listed individually.
  for (const screen of ['accelerate', 'brake', 'steer', 'uturn', 'something-new', null, undefined]) {
    const track = trackForScreen(screen);
    assert.ok(track, `screen ${String(screen)} should get a bed`);
    assert.ok(AUDIO_MANIFEST[track], `the fallback for ${String(screen)} must be real`);
  }
  assert.equal(trackForScreen('results'), 'music-results');
});

// ------------------------------------------------------------- the director

test('mounting a screen starts the track for that screen', () => {
  const { director, events, audio } = makeDirector();
  events.emit('screen:mounted', { id: 'menu', title: 'Main menu' });
  assert.deepEqual(played(audio), ['music-theme-menu']);
  assert.equal(director.scene, 'menu');

  events.emit('screen:mounted', { id: 'results', title: 'Results' });
  assert.deepEqual(played(audio), ['music-theme-menu', 'music-results']);
});

test('mounting a silent screen stops the music', () => {
  const { events, audio } = makeDirector();
  events.emit('screen:mounted', { id: 'menu' });
  events.emit('screen:mounted', { id: 'settings' });
  assert.ok(audio.calls.some((c) => c.op === 'stop'), 'settings should stop the bed');
  assert.equal(played(audio).length, 1, 'and should not start a new one');
});

test('a story chapter overrides the generic story bed', () => {
  const { events, audio } = makeDirector();
  // The real order: the story screen emits its chapter bed while it builds, then
  // the screen manager emits screen:mounted for the same screen.
  events.emit('scene:music', { scene: 'story-2', track: trackForChapter(2) });
  events.emit('screen:mounted', { id: 'story', title: 'Chapter 2' });
  assert.deepEqual(played(audio), ['music-story-tension'], 'the chapter bed must survive the mount event');
});

test('scene:music can request silence', () => {
  const { events, audio } = makeDirector();
  events.emit('screen:mounted', { id: 'menu' });
  events.emit('scene:music', { track: null });
  assert.ok(audio.calls.some((c) => c.op === 'stop'));
  assert.equal(audio.music.current, null);
});

test('switching music off in settings stops it immediately', () => {
  const { events, audio, state } = makeDirector();
  events.emit('screen:mounted', { id: 'menu' });
  state.music = false;
  events.emit('settings:applied', { key: 'music', settings: state });
  assert.equal(audio.music.current, null, 'the bed must stop, not merely get quieter');
});

test('switching music back on restores the current scene', () => {
  const { events, audio, state } = makeDirector();
  events.emit('screen:mounted', { id: 'menu' });
  state.music = false;
  events.emit('settings:applied', { key: 'music', settings: state });
  state.music = true;
  events.emit('settings:applied', { key: 'music', settings: state });
  assert.equal(audio.music.current, 'music-theme-menu', 'the menu bed should come back without a screen change');
});

test('unrelated setting changes do not restart the music', () => {
  const { events, audio } = makeDirector();
  events.emit('screen:mounted', { id: 'menu' });
  events.emit('settings:applied', { key: 'speechRate' });
  events.emit('settings:applied', { key: 'warningDistance' });
  assert.deepEqual(played(audio), ['music-theme-menu'], 'only music settings should touch the bed');
});

test('the race bed can be driven directly, since the race is not a bus screen', () => {
  const { director, audio } = makeDirector();
  director.playTrack('music-race');
  assert.deepEqual(played(audio), ['music-race']);
  assert.equal(director.track, 'music-race');
});

test('destroying the director unsubscribes and stops the music', () => {
  const { director, events, audio } = makeDirector();
  events.emit('screen:mounted', { id: 'menu' });
  director.destroy();
  assert.equal(audio.music.current, null, 'destroying should stop the bed');
  const before = audio.calls.length;
  events.emit('screen:mounted', { id: 'results' });
  assert.equal(audio.calls.length, before, 'a destroyed director must not react to further events');
});

test('a director with no audio object does not throw', () => {
  // The race screen and the story screen are mounted in the jsdom suite where
  // Web Audio does not exist; the director must degrade silently.
  const events = createBus();
  const director = createMusicDirector({ audio: null, events });
  assert.doesNotThrow(() => events.emit('screen:mounted', { id: 'menu' }));
  assert.doesNotThrow(() => director.playTrack('music-race'));
  assert.equal(director.track, 'music-race', 'the intent is still recorded even with no audio');
});

test('Exit is deliberate silence, never the fallback menu music', () => {
  assert.equal(trackForScreen('exit'), null);
  const { director, events, audio } = makeDirector();
  events.emit('screen:mounted', { id: 'menu' });
  const count = played(audio).length;
  director.stop(); events.emit('screen:mounted', { id: 'exit' });
  assert.equal(played(audio).length, count);
  assert.equal(director.track, null);
  director.suspend(); director.resume();
  assert.equal(played(audio).length, count, 'foregrounding Exit must stay silent');
});

test('background music stays stopped across screen/settings events until resume', () => {
  const { director, events, audio } = makeDirector();
  events.emit('screen:mounted', { id: 'menu' });
  director.suspend(); const count = played(audio).length;
  events.emit('screen:mounted', { id: 'results' });
  events.emit('settings:applied', { key: 'music' });
  assert.equal(played(audio).length, count);
  director.resume(); assert.equal(played(audio).at(-1), 'music-results');
});

test('an ambience download completing after silence cannot restart its loop', async () => {
  const events = createBus(); const started = [];
  let finish;
  const audio = {
    music: { play() {}, stop() {} },
    ensureLoaded: () => new Promise(resolve => { finish = resolve; }),
    stopLoops() {}, loop(name) { started.push(name); return {}; },
  };
  const director = createMusicDirector({ audio, events });
  events.emit('scene:music', { track: 'music-story-city' });
  assert.ok(finish, 'the scene requested ambience');
  director.suspend(); finish(); await Promise.resolve();
  assert.deepEqual(started, [], 'a late file must not defeat silence');
});

test('forest plays music AND a real bird recording, and Exit stops the bird bed', async () => {
  const events = createBus(); const started = [], stopped = [], tracks = [];
  const audio = {
    music: { play: async name => tracks.push(name), stop() {} },
    ensureLoaded: async () => true,
    loop(name) { started.push(name); return { stop() {} }; },
    stopLoops(names) { stopped.push(names); },
  };
  const director = createMusicDirector({ events, audio });
  events.emit('screen:mounted', { id:'forest' }); await Promise.resolve();
  assert.deepEqual(tracks, ['music-story-family']); assert.deepEqual(started, ['forest-birds']);
  events.emit('screen:mounted', { id:'exit' }); await Promise.resolve();
  assert.equal(director.track,null); assert.ok(stopped.some(names => names.includes('forest-birds')));
});

test('forest birds respect SFX off while music can keep playing', async () => {
  const events = createBus(); const loops = [];
  const director = createMusicDirector({ events, getSettings:()=>({sfx:false,music:true}), audio:{
    music:{play(){},stop(){}}, stopLoops(){}, loop(name){loops.push(name);}, ensureLoaded:async()=>true,
  }});
  events.emit('screen:mounted',{id:'forest'}); await Promise.resolve();
  assert.equal(director.track,'music-story-family'); assert.deepEqual(loops,[]);
});
