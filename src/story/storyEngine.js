/**
 * Story engine: walks the scene graph, applies state effects, and resolves text.
 *
 * Pure. It never touches the DOM; `ui/storyScreen.js` renders whatever
 * `current()` returns and calls `choose()` / `advance()`.
 *
 * Text may contain `{placeholders}` which are substituted from story state, so
 * the hero's chosen name flows through every chapter without duplicating
 * strings.
 *
 * @module story/storyEngine
 */

import { STORY_NODES, CHAPTERS } from './storyData.js';

export const NODE_KIND = {
  SCENE: 'scene',
  DIALOGUE: 'dialogue',
  ACTION: 'action',
  INTERVIEW: 'interview',
  NEGOTIATION: 'negotiation',
  TUTORIAL: 'tutorial',
  RACE: 'race',
  CHAPTER_END: 'chapter_end',
};

export const DEFAULT_STORY_STATE = {
  heroName: 'Aarav',
  chapter: 1,
  chaptersCompleted: [],
  flags: {},
  interviewResult: null,
  salary: null,
  employed: false,
  jobRoute: null,
  relationships: { joseph: 0, mithin: 0, mother: 0, father: 0, divya: 0, rehan: 0, leela: 0, kabir: 0 },
  tutorialComplete: false,
  controlsUnderstood: false,
  raceResult: null,
  visitedNodes: [],
};

/** Substitute {placeholders} from state. Unknown keys are left alone. */
export function resolveText(text, state) {
  if (typeof text === 'function') text = text(state);
  if (typeof text !== 'string') return '';
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    if (key === 'hero') return state.heroName || DEFAULT_STORY_STATE.heroName;
    if (key === 'salary') return state.salary ? String(state.salary) : 'no salary yet';
    if (key === 'mother') return 'Sudha';
    if (key === 'father') return 'Ramesh';
    if (key === 'sister') return 'Divya';
    if (key in state) return String(state[key]);
    if (state.flags && key in state.flags) return String(state.flags[key]);
    return match;
  });
}

/** Apply an effects object to story state, returning a NEW state. */
export function applyEffects(state, effects) {
  if (!effects || typeof effects !== 'object') return state;
  const next = { ...state, flags: { ...state.flags }, relationships: { ...state.relationships } };
  for (const [key, value] of Object.entries(effects)) {
    if (key === 'relationships') {
      for (const [who, delta] of Object.entries(value)) {
        next.relationships[who] = (next.relationships[who] ?? 0) + delta;
      }
      continue;
    }
    if (key === 'flags') {
      Object.assign(next.flags, value);
      continue;
    }
    if (typeof value === 'function') {
      next[key] = value(next);
      continue;
    }
    next[key] = value;
  }
  return next;
}

/**
 * @param {object} [config]
 * @param {object} [config.state]    restored story state (validated by save.js)
 * @param {(e:object)=>void} [config.emit]
 */
export function createStoryEngine(config = {}) {
  let state = { ...DEFAULT_STORY_STATE, ...(config.state ?? {}) };
  state.flags = { ...DEFAULT_STORY_STATE.flags, ...(state.flags ?? {}) };
  state.relationships = { ...DEFAULT_STORY_STATE.relationships, ...(state.relationships ?? {}) };

  let currentId = null;
  let history = [];
  const emit = config.emit ?? (() => {});

  function node(id) {
    return STORY_NODES[id] ?? null;
  }

  function visibleChoices(n) {
    if (!n?.choices) return [];
    return n.choices.filter((c) => {
      if (!c.requires) return true;
      try {
        return !!c.requires(state);
      } catch {
        return false;
      }
    });
  }

  function describe(n) {
    if (!n) return null;
    const choices = visibleChoices(n);
    return {
      id: n.id,
      chapter: n.chapter,
      kind: n.kind ?? NODE_KIND.SCENE,
      speaker: n.speaker ? resolveText(n.speaker, state) : null,
      text: resolveText(n.text, state),
      ambience: n.ambience ?? null,
      sfx: n.sfx ?? null,
      music: n.music ?? null,
      choices: choices.map((c, i) => ({
        id: c.id ?? `c${i}`,
        index: i,
        text: resolveText(c.text, state),
        spoken: c.spoken ? resolveText(c.spoken, state) : resolveText(c.text, state),
        requiresInterview: c.requiresInterview ?? false,
      })),
      next: n.next ?? null,
      isChapterEnd: n.kind === NODE_KIND.CHAPTER_END,
      chapterTitle: chapterById(n.chapter)?.title ?? null,
      notPlayable: !!n.notPlayable,
    };
  }

  const api = {
    get state() {
      return state;
    },
    get currentId() {
      return currentId;
    },
    get history() {
      return [...history];
    },
    setState(patch) {
      state = applyEffects(state, patch);
    },
    setHeroName(name) {
      const clean = sanitizeName(name);
      if (clean) state = { ...state, heroName: clean };
      return state.heroName;
    },

    /** Jump to a node, recording the visit. */
    goto(id) {
      const n = node(id);
      if (!n) {
        emit({ type: 'story:error', message: `Unknown story node ${id}.` });
        return null;
      }
      if (currentId && currentId !== id) history.push(currentId);
      currentId = id;
      state = applyEffects(state, n.effects);
      if (!state.visitedNodes.includes(id)) state = { ...state, visitedNodes: [...state.visitedNodes, id] };
      emit({ type: 'story:node', id, chapter: n.chapter, kind: n.kind ?? 'scene' });
      return describe(n);
    },

    current() {
      return describe(node(currentId));
    },

    /**
     * Take a choice by index (indexes are over VISIBLE choices, matching what
     * was spoken to the player).
     */
    choose(index) {
      const n = node(currentId);
      const choices = visibleChoices(n);
      const choice = choices[index];
      if (!choice) {
        emit({ type: 'story:error', message: 'That choice is not available.' });
        return null;
      }
      state = applyEffects(state, choice.effects);
      emit({ type: 'story:choice', nodeId: currentId, choiceId: choice.id ?? `c${index}` });

      // A choice can hand control to a subsystem instead of another node.
      if (choice.action) {
        emit({ type: 'story:action', action: choice.action, payload: choice.payload ?? {} });
        if (choice.next) return api.goto(choice.next);
        return api.current();
      }
      const target = typeof choice.next === 'function' ? choice.next(state) : choice.next;
      if (!target) return api.current();
      return api.goto(target);
    },

    /** Advance a node with no choices. */
    advance() {
      const n = node(currentId);
      if (!n) return null;
      if (visibleChoices(n).length > 0) return api.current();
      const target = typeof n.next === 'function' ? n.next(state) : n.next;
      if (!target) {
        emit({ type: 'story:end', chapter: n.chapter });
        return null;
      }
      return api.goto(target);
    },

    /** Where a chapter starts. */
    chapterEntry(chapterId) {
      const ch = chapterById(chapterId);
      return ch?.entry ?? null;
    },

    /** Can this chapter be played right now? */
    chapterAvailable(chapterId) {
      const ch = chapterById(chapterId);
      if (!ch) return false;
      if (!ch.playable) return false;
      if (!ch.requires) return true;
      return ch.requires.every((id) => state.chaptersCompleted.includes(id) || (chaptersById[id]?.optional ?? false));
    },

    completeChapter(chapterId, extra = {}) {
      const id = chapterId ?? node(currentId)?.chapter;
      const list = state.chaptersCompleted.includes(id) ? state.chaptersCompleted : [...state.chaptersCompleted, id];
      state = applyEffects({ ...state, chaptersCompleted: list }, extra);
      emit({ type: 'story:chapterComplete', chapter: id });
      return state;
    },

    /** Full spoken recap of the story so far, for the review screen. */
    recap() {
      const lines = [];
      lines.push(`Your name is ${state.heroName}.`);
      for (const ch of CHAPTERS) {
        if (state.chaptersCompleted.includes(ch.id)) lines.push(`Chapter ${ch.id}, ${ch.title}: completed.`);
        else if (ch.playable && api.chapterAvailable(ch.id)) lines.push(`Chapter ${ch.id}, ${ch.title}: available to play.`);
        else if (!ch.playable) lines.push(`Chapter ${ch.id}, ${ch.title}: not yet playable.`);
      }
      if (state.salary) lines.push(`You earn ${state.salary} rupees a month at Kalpesh Motors.`);
      if (state.controlsUnderstood) lines.push('You have learned the driving controls.');
      if (state.raceResult) lines.push(`Your best race result: finished ${state.raceResult.position}.`);
      return lines.join(' ');
    },
  };

  return api;
}

export function chapterById(id) {
  return CHAPTERS.find((c) => c.id === id) ?? null;
}
export const chaptersById = Object.fromEntries(CHAPTERS.map((c) => [c.id, c]));

/**
 * Names go into speech, the save file and the DOM, so they are constrained.
 * Letters, spaces, apostrophes and hyphens only, 1-24 characters.
 */
export function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .replace(/[<>{}[\]`$"\\]/g, '')
    .replace(/[^\p{L}\p{M}'\- ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return cleaned;
}
