/**
 * Settings state and the speech scheduler.
 *
 * Covers the requirement that announcements are prioritised, never spam, respect
 * an adjustable warning distance and frequency, and that turning Game TalkBack
 * off stops game speech without ever silencing the settings screen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAR_PACE,
  coerceSettings,
  RACE_LENGTH,
  raceLapsFor,
  cycleSetting,
  defaultSettings,
  NAV_FREQUENCY,
  paceScale,
  setSetting,
  settingFocusSentence,
  SETTINGS_SCHEMA,
  speakableNumber,
  stepSetting,
  WARNING_DISTANCE,
} from '../src/a11y/settings.js';
import { createSpeechQueue, DEFAULT_COOLDOWN, SPEECH_PRIORITY } from '../src/a11y/speechQueue.js';
import { splitForSpeech } from '../src/a11y/speech.js';

// ------------------------------------------------------------- settings state

test('every schema key has a default, a label and an announce function', () => {
  const defaults = defaultSettings();
  for (const [key, def] of Object.entries(SETTINGS_SCHEMA)) {
    assert.ok(key in defaults, `${key} has no default`);
    assert.equal(typeof def.label, 'string', `${key} has no label`);
    assert.equal(typeof def.announce, 'function', `${key} cannot be announced`);
    assert.equal(typeof def.announce(defaults[key]), 'string', `${key} announce returned a non-string`);
  }
  assert.ok(Object.keys(SETTINGS_SCHEMA).length >= 18, 'the required settings are all present');
});

test('the required settings are all present by name', () => {
  const required = [
    'talkback',
    'speechVolume',
    'speechRate',
    'music',
    'musicVolume',
    'sfx',
    'sfxVolume',
    'navFrequency',
    'warningDistance',
    'speakSpeedLaps',
  ];
  for (const key of required) assert.ok(SETTINGS_SCHEMA[key], `missing setting ${key}`);
});

test('coerceSettings rejects garbage and reports what it rejected', () => {
  const { settings, rejected } = coerceSettings({
    talkback: 'yes please',
    speechVolume: 47,
    speechRate: 'fast',
    navFrequency: 'telepathic',
    warningDistance: 'yesterday',
    textScale: -3,
    heroName: '<script>alert(1)</script>',
    notASetting: 1,
  });
  assert.equal(typeof settings.talkback, 'boolean', 'boolean coerced');
  assert.ok(settings.speechVolume <= 1 && settings.speechVolume >= 0, 'volume clamped into range');
  assert.ok(SETTINGS_SCHEMA.speechRate.min <= settings.speechRate, 'rate clamped');
  assert.ok(NAV_FREQUENCY.some((f) => f.id === settings.navFrequency), 'frequency fell back to a real option');
  assert.ok(WARNING_DISTANCE.some((w) => w.id === settings.warningDistance), 'distance fell back to a real option');
  assert.ok(settings.textScale >= SETTINGS_SCHEMA.textScale.min, 'text scale clamped');
  assert.ok(!settings.heroName.includes('<'), 'markup stripped from the hero name');
  assert.ok(!('notASetting' in settings), 'unknown keys are dropped');
  assert.ok(rejected.length > 0, 'the caller is told what was rejected');
});

test('coerceSettings accepts a valid payload unchanged', () => {
  const good = { ...defaultSettings(), speechVolume: 0.6, navFrequency: 'detailed' };
  const { settings, rejected } = coerceSettings(good);
  assert.equal(settings.speechVolume, 0.6);
  assert.equal(settings.navFrequency, 'detailed');
  assert.deepEqual(rejected, []);
});

test('setSetting reports name, old value, new value and whether it changed', () => {
  const start = defaultSettings();
  const res = setSetting(start, 'speechVolume', 0.5);
  assert.ok(res.changed);
  assert.equal(res.label, SETTINGS_SCHEMA.speechVolume.label);
  assert.equal(res.settings.speechVolume, 0.5);
  assert.match(res.announcement, /Speech volume/);
  assert.match(res.announcement, /changed to 50 percent/);

  const same = setSetting(res.settings, 'speechVolume', 0.5);
  assert.equal(same.changed, false);
  assert.match(same.announcement, /No change/);

  assert.equal(setSetting(start, 'notARealSetting', 1), null, 'unknown keys are refused');
});

test('stepSetting and cycleSetting move values in the right direction', () => {
  const start = defaultSettings();
  const up = stepSetting(start, 'speechRate', 1);
  assert.ok(up.settings.speechRate > start.speechRate);
  const down = stepSetting(up.settings, 'speechRate', -1);
  assert.ok(Math.abs(down.settings.speechRate - start.speechRate) < 1e-9);

  // Clamped at both ends rather than wrapping.
  let s = start;
  for (let i = 0; i < 60; i++) s = stepSetting(s, 'speechVolume', 1).settings;
  assert.equal(s.speechVolume, SETTINGS_SCHEMA.speechVolume.max);
  for (let i = 0; i < 60; i++) s = stepSetting(s, 'speechVolume', -1).settings;
  assert.equal(s.speechVolume, SETTINGS_SCHEMA.speechVolume.min);

  const freq = cycleSetting(start, 'navFrequency', 1);
  assert.notEqual(freq.settings.navFrequency, start.navFrequency);
  const back = cycleSetting(freq.settings, 'navFrequency', -1);
  assert.equal(back.settings.navFrequency, start.navFrequency);
  const toggled = cycleSetting(start, 'talkback', 1);
  assert.equal(toggled.settings.talkback, !start.talkback);
});

test('settingFocusSentence names the setting and its value', () => {
  const s = defaultSettings();
  const line = settingFocusSentence('warningDistance', s.warningDistance);
  assert.match(line, /Corner warning distance/);
  assert.match(line, /metres|Normal|Early|Late/i);
  assert.equal(settingFocusSentence('nope', 1), '');
});

test('speakableNumber renders digits as words for speech', () => {
  assert.equal(speakableNumber(120), 'one hundred twenty');
  assert.equal(speakableNumber(1.4, 1), 'one point four');
  assert.equal(speakableNumber(0), 'zero');
});

test('warning distances are ordered and frequencies scale announcement volume', () => {
  const metres = WARNING_DISTANCE.map((w) => w.metres);
  assert.deepEqual(metres, [...metres].sort((a, b) => a - b), 'warning distances increase');
  const factors = NAV_FREQUENCY.map((f) => f.factor);
  assert.deepEqual(factors, [...factors].sort((a, b) => b - a), 'less frequent means a larger cooldown factor');
});

// ------------------------------------------------------------- speech queue

function queue(overrides = {}) {
  let t = 0;
  const q = createSpeechQueue({ now: () => t, ...overrides });
  return { q, tick: (ms) => (t += ms), at: () => t };
}

test('higher priority is spoken first regardless of arrival order', () => {
  const { q } = queue();
  q.offer({ text: 'flavour line', priority: SPEECH_PRIORITY.LOW });
  q.offer({ text: 'corner warning', priority: SPEECH_PRIORITY.HIGH });
  q.offer({ text: 'lap complete', priority: SPEECH_PRIORITY.NORMAL });
  assert.equal(q.take().text, 'corner warning');
  q.finish();
  assert.equal(q.take().text, 'lap complete');
  q.finish();
  assert.equal(q.take().text, 'flavour line');
});

test('equal priority is spoken oldest first', () => {
  const { q } = queue();
  q.offer({ text: 'first', priority: 2 });
  q.offer({ text: 'second', priority: 2 });
  assert.equal(q.take().text, 'first');
});

test('nothing is taken while something is being spoken', () => {
  const { q } = queue();
  q.offer({ text: 'a' });
  q.offer({ text: 'b' });
  assert.equal(q.take().text, 'a');
  assert.equal(q.take(), null, 'the queue is busy');
  q.finish();
  assert.equal(q.take().text, 'b');
});

test('the same keyed message cannot nag inside its cooldown', () => {
  const { q, tick } = queue();
  assert.equal(q.offer({ text: 'Turn three ahead', key: 'corner.t3', priority: 3, cooldownMs: 1400 }).accepted, true);
  q.take();
  q.finish();
  assert.equal(q.offer({ text: 'Turn three ahead', key: 'corner.t3', priority: 3, cooldownMs: 1400 }).accepted, false);
  tick(1399);
  assert.equal(q.offer({ text: 'Turn three ahead', key: 'corner.t3', priority: 3, cooldownMs: 1400 }).accepted, false);
  tick(2);
  assert.equal(q.offer({ text: 'Turn three ahead', key: 'corner.t3', priority: 3, cooldownMs: 1400 }).accepted, true);
});

test('unkeyed messages are not deduplicated', () => {
  const { q } = queue();
  assert.equal(q.offer({ text: 'a' }).accepted, true);
  assert.equal(q.offer({ text: 'a' }).accepted, true, 'identical text without a key is allowed');
});

test('critical warnings have no default cooldown', () => {
  assert.equal(DEFAULT_COOLDOWN[SPEECH_PRIORITY.CRITICAL], 0);
  const { q } = queue();
  for (let i = 0; i < 5; i++) {
    assert.equal(q.offer({ text: `off track ${i}`, key: `x${i}`, priority: SPEECH_PRIORITY.CRITICAL }).accepted, true);
  }
});

test('the announcement frequency setting scales every cooldown', () => {
  const { q } = queue();
  q.setFrequencyFactor(2); // "less often"
  q.offer({ text: 'a', key: 'k', priority: 3 });
  q.take();
  q.finish();
  assert.equal(q.offer({ text: 'a', key: 'k', priority: 3 }).accepted, false);
  q.setFrequencyFactor(1);
  // The cooldown was computed at factor 2 when first spoken; it must still hold.
  assert.equal(q.offer({ text: 'a', key: 'k', priority: 3 }).accepted, false);
});

test('turning Game TalkBack off drops game speech but keeps essential speech', () => {
  const { q } = queue();
  q.offer({ text: 'corner ahead', priority: 3 });
  q.offer({ text: 'Speech volume. 80 percent.', essential: true, priority: 3 });
  q.setEnabled(false);
  assert.equal(q.pendingCount, 1, 'only the essential line survives');
  assert.equal(q.take().essential, true);
  q.finish();
  assert.equal(q.offer({ text: 'you are in second place', priority: 3 }).accepted, false, 'game speech is refused');
  assert.equal(q.offer({ text: 'Game TalkBack is off.', essential: true }).accepted, true, 'essential speech still works');
  q.setEnabled(true);
  assert.equal(q.offer({ text: 'you are in second place', priority: 3 }).accepted, true, 'game speech returns');
});

test('a critical warning preempts lower priority speech', () => {
  const { q } = queue();
  q.offer({ text: 'you are in third place', priority: SPEECH_PRIORITY.NORMAL });
  q.take();
  q.offer({ text: 'Hairpin approaching. Brake.', priority: SPEECH_PRIORITY.CRITICAL, interrupt: true });
  assert.equal(q.shouldInterrupt(), true, 'the adapter is told to cancel');
  q.finish();
  assert.equal(q.take().text, 'Hairpin approaching. Brake.');
});

test('an equal or lower priority warning never interrupts', () => {
  const { q } = queue();
  q.offer({ text: 'corner ahead', priority: SPEECH_PRIORITY.HIGH, interrupt: true });
  q.take();
  q.offer({ text: 'another corner', priority: SPEECH_PRIORITY.HIGH, interrupt: true });
  assert.equal(q.shouldInterrupt(), false);
  q.offer({ text: 'flavour', priority: SPEECH_PRIORITY.LOW, interrupt: true });
  assert.equal(q.shouldInterrupt(), false);
});

test('a bounded queue drops the least important item, never the more important one', () => {
  const { q } = queue({ maxPending: 2 });
  q.offer({ text: 'flavour', priority: 0 });
  q.offer({ text: 'lap', priority: 2 });
  const res = q.offer({ text: 'hairpin', priority: 4 });
  assert.equal(res.accepted, true);
  assert.equal(res.dropped.text, 'flavour', 'the least important queued line was dropped');
  assert.equal(q.offer({ text: 'noise', priority: 0 }).accepted, false, 'a weaker arrival is refused instead');
});

test('concise mode substitutes the short wording', () => {
  const { q } = queue();
  q.setConcise(true);
  q.offer({ text: 'Approaching a right-hand corner, Turn one, Marina Right.', concise: 'Right corner.' });
  assert.equal(q.take().text, 'Right corner.');
});

test('empty text is refused', () => {
  const { q } = queue();
  assert.equal(q.offer({ text: '' }).accepted, false);
  assert.equal(q.offer({ text: '   ' }).accepted, false);
  assert.equal(q.offer(null).accepted, false);
});

// --------------------------------------------------------- speech chunking

test('long passages are split at sentence boundaries and reassemble exactly', () => {
  const text =
    'Welcome to the circuit. Hold to accelerate and release to coast. Tap twice to brake. Drag to steer, and the steering is gradual. Draw a circle for a U-turn where the track allows it. Three quick taps never start a race.';
  const chunks = splitForSpeech(text, 90);
  assert.ok(chunks.length > 1, 'it was split');
  assert.ok(chunks.every((c) => c.length <= 90), 'no chunk exceeds the limit');
  assert.equal(chunks.join(' '), text, 'nothing is lost or reordered');
});

test('short text is not split', () => {
  assert.deepEqual(splitForSpeech('Brake now.'), ['Brake now.']);
  assert.deepEqual(splitForSpeech(''), []);
});

test('an unbroken run of text is hard-split rather than truncated', () => {
  const text = 'x'.repeat(700);
  const chunks = splitForSpeech(text, 240);
  assert.ok(chunks.length >= 3);
  assert.equal(chunks.join('').length, 700, 'every character survives');
});

// ------------------------------------------------------------------ car pace

test('Car pace defaults to normal', () => {
  assert.equal(defaultSettings().carPace, 'normal');
  assert.equal(SETTINGS_SCHEMA.carPace.type, 'enum');
  assert.equal(SETTINGS_SCHEMA.carPace.label, 'Car pace');
});

test('Car pace offers slower, normal and faster, in that order', () => {
  assert.deepEqual(CAR_PACE.map((p) => p.id), ['slow', 'normal', 'fast']);
  const scales = CAR_PACE.map((p) => p.scale);
  assert.ok(scales[0] < scales[1] && scales[1] < scales[2], `scales must ascend: ${scales}`);
  assert.equal(scales[1], 1, 'normal must be unscaled');
  for (const pace of CAR_PACE) {
    assert.ok(pace.label && pace.label.length > 1, `${pace.id} needs a spoken label`);
    assert.ok(pace.describe && pace.describe.length > 10, `${pace.id} needs a description of what it does`);
  }
});

test('an unrecognised pace falls back to normal rather than breaking physics', () => {
  for (const bad of ['turbo', '', null, undefined, 0.5, NaN, {}]) {
    assert.equal(paceScale(bad), 1, `paceScale(${JSON.stringify(bad) ?? String(bad)}) should be 1`);
  }
  // A corrupted or hand-edited save must not reach the physics as a nonsense
  // multiplier: the value is rejected on load and the default stands.
  const bad = coerceSettings({ carPace: 'turbo' });
  assert.equal(bad.settings.carPace, 'normal');
  assert.ok(bad.rejected.includes('carPace'), 'the rejected value should be reported, not silently accepted');
  assert.equal(coerceSettings({ carPace: 'slow' }).settings.carPace, 'slow');
});

test('Car pace cycles through all three and wraps', () => {
  let s = defaultSettings();
  assert.equal(s.carPace, 'normal');

  const res = setSetting(s, 'carPace', 'slow');
  assert.equal(res.settings.carPace, 'slow');
  assert.match(res.announcement, /Slower/, 'changing the pace must announce the new value');
  s = res.settings;

  for (const expected of ['normal', 'fast', 'slow', 'normal']) {
    const next = cycleSetting(s, 'carPace', 1);
    assert.equal(next.settings.carPace, expected, 'cycling forward must wrap at the end');
    s = next.settings;
  }
  // The forward loop ends on 'normal', so backwards is 'slow', then wraps to
  // 'fast' - the same wrap in the other direction.
  const back = cycleSetting(s, 'carPace', -1);
  assert.equal(back.settings.carPace, 'slow', 'cycling backwards from normal');
  const wrapped = cycleSetting(back.settings, 'carPace', -1);
  assert.equal(wrapped.settings.carPace, 'fast', 'cycling backwards past the start must wrap');
});

test('Car pace is announced by name, and explains itself', () => {
  const sentence = settingFocusSentence('carPace', 'slow');
  assert.match(sentence, /Car pace/i, 'the announcement must name the setting');
  assert.match(sentence, /Slower/i, 'and its new value');
  assert.ok(SETTINGS_SCHEMA.carPace.help.length > 40, 'the setting needs an explanation of what it changes');
  assert.match(SETTINGS_SCHEMA.carPace.help, /opponents/i, 'it must say the opponents are scaled too, or players will read it as a handicap');
});

test('paceScale and CAR_PACE agree', () => {
  for (const pace of CAR_PACE) assert.equal(paceScale(pace.id), pace.scale);
});

// --------------------------------------------------------------- race length

test('Race length defaults to what each race was designed for', () => {
  assert.equal(defaultSettings().raceLength, 'default');
  assert.equal(SETTINGS_SCHEMA.raceLength.label, 'Race length');
  assert.equal(raceLapsFor({ laps: 2 }, 'default'), 2);
  assert.equal(raceLapsFor({ laps: 3 }, 'default'), 3);
  assert.equal(raceLapsFor({ laps: 4 }, 'default'), 4);
});

test('a chosen length overrides the level, including practice', () => {
  assert.deepEqual(['one', 'two', 'three', 'five'].map((id) => raceLapsFor({ laps: 4 }, id)), [1, 2, 3, 5]);
  // Practice is 99 laps by design; picking a length should still shorten it,
  // otherwise the setting silently does nothing in the one place a player is
  // most likely to want it.
  assert.equal(raceLapsFor({ laps: 99 }, 'five'), 5);
});

test('race length is clamped and falls back safely', () => {
  for (const bad of ['nope', '', null, undefined, 12, {}]) {
    assert.equal(raceLapsFor({ laps: 3 }, bad), 3, `${String(bad)} should fall back to the designed distance`);
  }
  assert.ok(raceLapsFor({ laps: 0 }, 'default') >= 1, 'a zero-lap level must not produce a race that ends instantly');
  assert.ok(raceLapsFor(null, 'default') >= 1, 'a missing level must not crash');
  assert.ok(raceLapsFor({ laps: 3 }, 'one') >= 1);
});

test('every race length option is speakable and documented', () => {
  assert.equal(RACE_LENGTH[0].id, 'default');
  for (const option of RACE_LENGTH) {
    assert.ok(option.label && option.label.length > 1, `${option.id} needs a spoken label`);
    assert.ok(option.describe && option.describe.length > 5, `${option.id} needs a description`);
    assert.ok(option.laps === null || (Number.isInteger(option.laps) && option.laps >= 1), `${option.id} needs a positive lap count or null`);
  }
  assert.equal(new Set(RACE_LENGTH.map((o) => o.id)).size, RACE_LENGTH.length, 'ids must be unique or cycling skips one');
});

test('an unrecognised saved race length is rejected, not trusted', () => {
  const res = coerceSettings({ raceLength: 'ninety' });
  assert.equal(res.settings.raceLength, 'default');
  assert.ok(res.rejected.includes('raceLength'));
  assert.equal(coerceSettings({ raceLength: 'five' }).settings.raceLength, 'five');
});

test('race length cycles and announces the new distance', () => {
  let s = defaultSettings();
  const seen = [s.raceLength];
  for (let i = 0; i < RACE_LENGTH.length; i += 1) {
    const res = cycleSetting(s, 'raceLength', 1);
    assert.ok(res.announcement && res.announcement.length > 0, 'changing the length must be announced');
    s = res.settings;
    seen.push(s.raceLength);
  }
  assert.equal(seen[seen.length - 1], seen[0], 'cycling must wrap back to the start');
  assert.equal(new Set(seen.slice(0, -1)).size, RACE_LENGTH.length, 'and must visit every option');
});
