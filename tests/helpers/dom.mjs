/**
 * jsdom harness for the browser-facing modules.
 *
 * The game has no build step and no runtime dependencies, but its UI is real
 * DOM. This harness boots it in jsdom so the screens, the gesture wiring and the
 * story flow can be verified by `npm test` instead of being assumed to work.
 *
 * WebGL is deliberately NOT available here. Anything that constructs a renderer
 * (the race screen, the car preview) is out of scope for these tests and is
 * listed as browser-verified-only in docs/TESTING.md.
 */

import { JSDOM } from 'jsdom';
import { performance as nodePerformance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');

/**
 * @param {object} [opts]
 * @param {boolean} [opts.speech]  install a fake speechSynthesis
 * @param {boolean} [opts.audio]   install a fake AudioContext
 */
export function createDom(opts = {}) {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // jsdom has no layout, so give every element a plausible box. The gesture
  // recognizer and the zone map both work in CSS pixels.
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const idx = Number(this.dataset?.testIndex ?? 0);
    return { x: 0, y: idx * 60, left: 0, top: idx * 60, right: 360, bottom: idx * 60 + 56, width: 360, height: 56 };
  };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 360, configurable: true });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 640, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 360, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 640, writable: true, configurable: true });

  window.matchMedia =
    window.matchMedia ??
    ((query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.focus = function () {
    window.document.activeElement?.removeAttribute?.('data-was-focused');
    window.document.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
  };
  window.navigator.vibrate = () => true;

  // Canvas 2D is used by the minimap and by texture generation.
  window.HTMLCanvasElement.prototype.getContext = function (kind) {
    if (kind === '2d') return create2dStub();
    return null; // WebGL is genuinely unavailable in these tests
  };

  if (opts.speech) {
    const spoken = [];
    window.speechSynthesis = {
      spoken,
      getVoices: () => [
        { name: 'Test Voice', lang: 'en-GB', voiceURI: 'test-voice' },
        { name: 'Second Voice', lang: 'en-US', voiceURI: 'second-voice' },
      ],
      speak(u) {
        spoken.push(u.text);
        // Settle synchronously. A real utterance ends later, but tests assert
        // immediately after an action, and a deferred onend would leave the
        // speech queue permanently mid-utterance.
        try {
          u.onend?.();
        } catch {
          /* ignore */
        }
      },
      cancel() {
        spoken.push('[cancel]');
      },
      addEventListener() {},
      removeEventListener() {},
    };
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.onend = null;
        this.onerror = null;
      }
    };
  }

  if (opts.audio) {
    const played = [];
    function param(value = 0) {
      return { value, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {} };
    }
    window.AudioContext = class {
      constructor() {
        this.state = 'running';
        this.currentTime = 0;
        this.destination = {};
      }
      createGain() {
        return { gain: param(1), connect: (n) => n };
      }
      createBufferSource() {
        return {
          buffer: null,
          loop: false,
          playbackRate: param(1),
          connect: (n) => n,
          start() {},
          stop() {},
        };
      }
      decodeAudioData() {
        return Promise.resolve({ duration: 1, length: 44100 });
      }
      resume() {
        this.state = 'running';
        return Promise.resolve();
      }
      get played() {
        return played;
      }
    };
  }

  // Install the globals the modules read at call time. Several of these
  // (navigator, performance) are accessor-only on the Node global object, so
  // they have to be redefined rather than assigned.
  const install = (name, value) => {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  };
  install('window', window);
  install('document', window.document);
  install('navigator', window.navigator);
  install('HTMLElement', window.HTMLElement);
  install('localStorage', window.localStorage);
  // jsdom's PerformanceImpl itself calls Node's global performance. Installing
  // window.performance here recurses forever on the first real pointer sample.
  install('performance', nodePerformance);
  install('requestAnimationFrame', window.requestAnimationFrame);
  install('cancelAnimationFrame', window.cancelAnimationFrame);
  install('getComputedStyle', window.getComputedStyle.bind(window));
  install('SpeechSynthesisUtterance', window.SpeechSynthesisUtterance);
  if (opts.speech) install('speechSynthesis', window.speechSynthesis);
  if (opts.audio) install('AudioContext', window.AudioContext);
  const installed = ['window', 'document', 'navigator', 'HTMLElement', 'localStorage', 'speechSynthesis', 'AudioContext', 'SpeechSynthesisUtterance'];

  return {
    dom,
    window,
    document: window.document,
    /** Reset module state between tests: the bus is a singleton. */
    async freshModules() {
      const stamp = `?t=${Math.random().toString(36).slice(2)}`;
      const bus = await import(`../../src/core/bus.js${stamp}`);
      return bus;
    },
    dispose() {
      window.vettaru?.destroy?.();
      dom.window.close();
      for (const k of installed) {
        try {
          delete globalThis[k];
        } catch {
          Object.defineProperty(globalThis, k, { value: undefined, writable: true, configurable: true });
        }
      }
    },
  };
}

function create2dStub() {
  const noop = () => {};
  return {
    canvas: null,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    lineJoin: '',
    lineCap: '',
    globalAlpha: 1,
    fillRect: noop,
    clearRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setTransform: noop,
    fillText: noop,
    measureText: () => ({ width: 10 }),
    roundRect: noop,
    rect: noop,
    drawImage: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
  };
}
