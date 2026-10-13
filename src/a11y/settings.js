/**
 * Accessible settings model - pure data, validated on the way in and out.
 *
 * Nothing here touches the DOM or localStorage, so the same code validates a
 * save file in Node tests and in the browser. Every setting knows how to
 * describe itself in words, because a blind player changing a slider must hear
 * the name, the value before, and the value after.
 *
 * @module a11y/settings
 */

/** Navigation announcement density. */
export const NAV_FREQUENCY = [
  { id: 'minimal', label: 'Minimal', factor: 1.75, describe: 'only essential corner and safety warnings' },
  { id: 'balanced', label: 'Balanced', factor: 1.0, describe: 'corners, positions and lap updates' },
  { id: 'detailed', label: 'Detailed', factor: 0.7, describe: 'corners, positions, lap, speed and opponents' },
];

/** How far ahead corners are announced. */
export const WARNING_DISTANCE = [
  { id: 'short', label: 'Short', metres: 70, describe: 'about seventy metres' },
  { id: 'normal', label: 'Normal', metres: 120, describe: 'about one hundred and twenty metres' },
  { id: 'long', label: 'Long', metres: 190, describe: 'about one hundred and ninety metres' },
];

/**
 * Car pace: how fast the player's car goes, and how quickly it gets there.
 *
 * The opponents are scaled by the same factor, deliberately. Slowing only the
 * player would make "slower" mean "harder to win", which is the opposite of what
 * an accessibility setting is for; the point is more time to react to a corner
 * warning that is being spoken, not a handicap. `describe` is what the settings
 * screen says aloud so the player knows what changed without having to see it.
 */
export const CAR_PACE = [
  { id: 'slow', label: 'Slower', scale: 0.8, describe: 'a calmer pace, with more time to react to each warning' },
  { id: 'normal', label: 'Normal', scale: 1, describe: 'the pace the car was designed for' },
  { id: 'fast', label: 'Faster', scale: 1.18, describe: 'a higher top speed and quicker acceleration' },
];

/**
 * Race length: how many laps a race runs.
 *
 * `laps: null` means "whatever this race was designed for", which keeps the
 * campaign's own pacing intact. The fixed options override it, including for
 * practice, so a player who wants a short session or a longer one can have it
 * without the game pretending the level said something it did not.
 */
export const RACE_LENGTH = [
  { id: 'default', label: 'Race default', laps: null, describe: 'the distance each race was designed for' },
  { id: 'one', label: 'One lap', laps: 1, describe: 'a single lap of the circuit' },
  { id: 'two', label: 'Two laps', laps: 2, describe: 'two laps' },
  { id: 'three', label: 'Three laps', laps: 3, describe: 'three laps' },
  { id: 'five', label: 'Five laps', laps: 5, describe: 'five laps, a full race distance' },
];

/**
 * The lap count a race should actually run.
 *
 * Clamped to at least one lap: a zero-lap race would finish the instant it
 * started, and a negative one never would.
 */
export function raceLapsFor(level, id) {
  const found = RACE_LENGTH.find((r) => r.id === id);
  const override = found && Number.isFinite(found.laps) && found.laps > 0 ? found.laps : null;
  const designed = Number.isFinite(level?.laps) && level.laps > 0 ? level.laps : 2;
  return Math.max(1, Math.min(99, override ?? designed));
}

/** The multiplier for a pace id; unknown or missing values fall back to normal. */
export function paceScale(id) {
  const found = CAR_PACE.find((p) => p.id === id);
  return found && Number.isFinite(found.scale) && found.scale > 0 ? found.scale : 1;
}

const ON_OFF = [
  { id: true, label: 'On' },
  { id: false, label: 'Off' },
];

/**
 * The schema. `announce` produces the spoken value; `describe` produces the
 * sentence spoken when the setting receives focus.
 */
export const SETTINGS_SCHEMA = {
  talkback: {
    type: 'boolean',
    default: true,
    label: 'Game TalkBack',
    options: ON_OFF,
    help: 'The built-in spoken guidance system. It works without your phone screen reader being switched on.',
    announce: (v) => (v ? 'On' : 'Off'),
  },
  speechVolume: {
    type: 'range',
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    label: 'Speech volume',
    announce: (v) => `${Math.round(v * 100)} percent`,
  },
  speechRate: {
    type: 'range',
    min: 0.6,
    max: 1.8,
    step: 0.1,
    default: 1,
    label: 'Speech rate',
    announce: (v) => speakableNumber(v, 1),
  },
  speechPitch: {
    type: 'range',
    min: 0.6,
    max: 1.6,
    step: 0.1,
    default: 1,
    label: 'Speech pitch',
    announce: (v) => speakableNumber(v, 1),
  },
  speechVoice: {
    type: 'string',
    default: '',
    maxLength: 120,
    label: 'Speech voice',
    help: 'Choose from the voices installed on this device.',
    announce: (v) => v || 'Device default',
  },
  conciseSpeech: {
    type: 'boolean',
    default: false,
    label: 'Concise speech',
    options: ON_OFF,
    help: 'Shortens navigation sentences to their essentials.',
    announce: (v) => (v ? 'On' : 'Off'),
  },
  music: { type: 'boolean', default: true, label: 'Music', options: ON_OFF, announce: (v) => (v ? 'On' : 'Off') },
  musicVolume: {
    type: 'range',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.5,
    label: 'Music volume',
    announce: (v) => `${Math.round(v * 100)} percent`,
  },
  sfx: {
    type: 'boolean',
    default: true,
    label: 'Sound effects',
    options: ON_OFF,
    announce: (v) => (v ? 'On' : 'Off'),
  },
  sfxVolume: {
    type: 'range',
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.85,
    label: 'Sound effects volume',
    announce: (v) => `${Math.round(v * 100)} percent`,
  },
  navFrequency: {
    type: 'enum',
    default: 'balanced',
    label: 'Navigation announcements',
    options: NAV_FREQUENCY,
    announce: (v) => NAV_FREQUENCY.find((f) => f.id === v)?.label ?? v,
  },
  warningDistance: {
    type: 'enum',
    default: 'normal',
    label: 'Corner warning distance',
    options: WARNING_DISTANCE,
    announce: (v) => WARNING_DISTANCE.find((f) => f.id === v)?.label ?? v,
  },
  carPace: {
    type: 'enum',
    default: 'normal',
    label: 'Car pace',
    options: CAR_PACE,
    help: 'How fast your car goes and how quickly it gets there. Slower gives you more time to react to a corner warning. It scales your opponents by the same amount, so it changes the pace of the race, not how hard it is to win.',
    announce: (v) => CAR_PACE.find((f) => f.id === v)?.label ?? v,
  },
  raceLength: {
    type: 'enum',
    default: 'default',
    label: 'Race length',
    options: RACE_LENGTH,
    help: 'How many laps a race runs. Race default keeps the distance each race was designed for. The race start announcement always says the true number of laps, whichever you choose.',
    announce: (v) => RACE_LENGTH.find((f) => f.id === v)?.label ?? v,
  },
  speakSpeedLaps: {
    type: 'boolean',
    default: true,
    label: 'Spoken speed and lap updates',
    options: ON_OFF,
    announce: (v) => (v ? 'On' : 'Off'),
  },
  speakPosition: {
    type: 'boolean',
    default: true,
    label: 'Spoken race position',
    options: ON_OFF,
    announce: (v) => (v ? 'On' : 'Off'),
  },
  speakOpponents: {
    type: 'boolean',
    default: true,
    label: 'Spoken opponent warnings',
    options: ON_OFF,
    announce: (v) => (v ? 'On' : 'Off'),
  },
  haptics: { type: 'boolean', default: true, label: 'Vibration feedback', options: ON_OFF, announce: (v) => (v ? 'On' : 'Off') },
  controlSide: {
    type: 'enum',
    default: 'right',
    label: 'Accelerate and brake pads',
    options: [
      { id: 'right', label: 'Right hand' },
      { id: 'left', label: 'Left hand' },
    ],
    announce: (v) => (v === 'left' ? 'Left hand' : 'Right hand'),
  },
  cameraShake: { type: 'boolean', default: true, label: 'Camera shake', options: ON_OFF, announce: (v) => (v ? 'On' : 'Off') },
  textScale: {
    type: 'range',
    min: 0.9,
    max: 1.6,
    step: 0.1,
    default: 1,
    label: 'Text size',
    announce: (v) => `${Math.round(v * 100)} percent`,
  },
  heroName: {
    type: 'string',
    default: 'Aarav',
    maxLength: 24,
    label: 'Hero name',
    help: 'The name other characters call you in the story.',
    announce: (v) => v || 'Aarav',
  },
};

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Integer 0-999 in words. Deliberately small: settings never need more. */
export function intToWords(n) {
  const v = Math.abs(Math.round(n));
  if (v < 20) return ONES[v];
  if (v < 100) return TENS[Math.floor(v / 10)] + (v % 10 ? ` ${ONES[v % 10]}` : '');
  if (v < 1000) {
    const rest = v % 100;
    return `${ONES[Math.floor(v / 100)]} hundred${rest ? ` ${intToWords(rest)}` : ''}`;
  }
  return String(v);
}

/**
 * A number rendered the way it should be SPOKEN, so "1.2" is never read as
 * "one point two thousand" or as a date by an over-eager synthesiser.
 */
export function speakableNumber(value, decimals = 0) {
  if (!Number.isFinite(value)) return 'unknown';
  const fixed = value.toFixed(decimals);
  const [intPart, fracPart] = fixed.split('.');
  const sign = value < 0 ? 'minus ' : '';
  const words = intToWords(Number(intPart));
  if (!fracPart) return `${sign}${words}`;
  const digits = fracPart
    .split('')
    .map((d) => ONES[Number(d)])
    .join(' ');
  return `${sign}${words} point ${digits}`;
}

/** Settings with every default applied. */
export function defaultSettings() {
  const out = {};
  for (const [key, def] of Object.entries(SETTINGS_SCHEMA)) out[key] = def.default;
  return out;
}

function clampStep(value, min, max, step) {
  if (!Number.isFinite(value)) return min;
  const snapped = Math.round((value - min) / step) * step + min;
  const clamped = Math.min(max, Math.max(min, snapped));
  // Kill binary floating point dust (0.30000000000000004).
  const decimals = String(step).split('.')[1]?.length ?? 0;
  return Number(clamped.toFixed(Math.max(decimals, 2)));
}

/**
 * Validate and coerce an untrusted settings object.
 *
 * This is the security boundary for saved data: anything read back from
 * localStorage goes through here, so a tampered or corrupted save can never
 * inject a script, an out-of-range value, or an unknown key.
 *
 * @param {unknown} raw
 * @returns {{settings: object, rejected: string[]}}
 */
export function coerceSettings(raw) {
  const settings = defaultSettings();
  const rejected = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { settings, rejected: ['settings payload was not an object'] };
  }
  for (const [key, def] of Object.entries(SETTINGS_SCHEMA)) {
    if (!(key in raw)) continue;
    const value = raw[key];
    switch (def.type) {
      case 'boolean':
        if (typeof value === 'boolean') settings[key] = value;
        else rejected.push(key);
        break;
      case 'range':
        if (typeof value === 'number' && Number.isFinite(value)) {
          settings[key] = clampStep(value, def.min, def.max, def.step);
        } else rejected.push(key);
        break;
      case 'enum':
        if (def.options.some((o) => o.id === value)) settings[key] = value;
        else rejected.push(key);
        break;
      case 'string': {
        if (typeof value !== 'string') {
          rejected.push(key);
          break;
        }
        // Strip control characters and markup; keep letters, spaces and a few
        // punctuation marks. Names are shown in dialogue and spoken aloud.
        const cleaned = value
          // eslint-disable-next-line no-control-regex
          .replace(/[<>[\]{}\\/`$]/g, '')
          .replace(/[\u0000-\u001f\u007f]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, def.maxLength ?? 48);
        settings[key] = cleaned || def.default;
        if (cleaned !== value) rejected.push(`${key} (sanitised)`);
        break;
      }
      default:
        rejected.push(key);
    }
  }
  return { settings, rejected };
}

/**
 * Apply a change and produce the sentence to speak.
 * @returns {{settings:object, changed:boolean, announcement:string, key:string, label:string, valueText:string}|null}
 */
export function setSetting(current, key, value) {
  const def = SETTINGS_SCHEMA[key];
  if (!def) return null;
  const before = current[key];
  const { settings } = coerceSettings({ ...current, [key]: value });
  const after = settings[key];
  const changed = !Object.is(before, after);
  const valueText = def.announce(after);
  const beforeText = def.announce(before);
  return {
    settings,
    changed,
    key,
    label: def.label,
    valueText,
    beforeText,
    announcement: changed ? `${def.label}. ${beforeText} changed to ${valueText}.` : `${def.label}. ${valueText}. No change.`,
  };
}

/** Focus sentence for a setting row: name, current value, what it does. */
export function settingFocusSentence(key, value) {
  const def = SETTINGS_SCHEMA[key];
  if (!def) return '';
  const parts = [`${def.label}. ${def.announce(value)}.`];
  if (def.help) parts.push(def.help);
  else if (def.type === 'enum') {
    const opt = def.options.find((o) => o.id === value);
    if (opt?.describe) parts.push(opt.describe);
  } else if (def.type === 'boolean') parts.push('Double tap or press Enter to switch it.');
  else if (def.type === 'range') parts.push('Use the increase and decrease buttons, or the arrow keys.');
  return parts.join(' ');
}

/** Nudge a range setting by one step. */
export function stepSetting(current, key, direction) {
  const def = SETTINGS_SCHEMA[key];
  if (!def || def.type !== 'range') return null;
  const next = current[key] + def.step * (direction > 0 ? 1 : -1);
  return setSetting(current, key, next);
}

/** Cycle an enum or boolean setting. */
export function cycleSetting(current, key, direction = 1) {
  const def = SETTINGS_SCHEMA[key];
  if (!def) return null;
  if (def.type === 'boolean') return setSetting(current, key, !current[key]);
  if (def.type === 'enum') {
    const ids = def.options.map((o) => o.id);
    const i = ids.indexOf(current[key]);
    const next = ids[(i + direction + ids.length) % ids.length];
    return setSetting(current, key, next);
  }
  return null;
}

export { clampStep };
