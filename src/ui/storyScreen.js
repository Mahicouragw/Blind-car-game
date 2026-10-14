/**
 * Story screen: renders scene nodes, dialogue choices, the interview and the
 * salary negotiation.
 *
 * The interview and negotiation are driven by the pure scoring modules
 * (story/interview.js and story/negotiation.js). This file only presents them
 * and feeds the results back into story state, so the same rules apply whether
 * you are playing or running the tests.
 *
 * @module ui/storyScreen
 */

import { bus } from '../core/bus.js';
import { trackForChapter } from '../core/musicDirector.js';
import { makeButton, ZONE_ROLE } from './screens.js';
import {
  evaluateInterview,
  FOLLOW_UPS,
  INTERVIEW_QUESTIONS,
  interviewBranch,
  interviewSpokenResult,
} from '../story/interview.js';
import { createNegotiation, finalizeSalary, offerChoices, sayMoney, takeChoice } from '../story/negotiation.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {object} config
 * @param {object} config.gameState
 * @param {object} config.screens
 * @param {object} config.speech
 * @param {object} config.audio
 * @param {number} config.chapterId
 */
export function buildStoryScreen(config) {
  const { gameState, screens, speech, audio, chapterId } = config;
  const story = gameState.story;
  const root = el('section', 'screen screen-story');

  const chapterBar = el('div', 'story-chapter');
  chapterBar.setAttribute('data-zone', 'chapterBar');
  chapterBar.setAttribute('data-zone-role', ZONE_ROLE.READER);
  const chapterLabel = el('span', 'story-chapter-label');
  const chapterProgress = el('span', 'story-chapter-progress');
  chapterBar.append(chapterLabel, chapterProgress);
  root.appendChild(chapterBar);

  const scene = el('article', 'story-scene');
  scene.setAttribute('data-zone', 'storyScene');
  scene.setAttribute('data-zone-role', ZONE_ROLE.READER);
  const speakerEl = el('p', 'story-speaker');
  const textEl = el('p', 'story-text');
  const ambienceEl = el('p', 'story-ambience');
  scene.append(speakerEl, textEl, ambienceEl);
  root.appendChild(scene);

  const choicesWrap = el('div', 'story-choices');
  choicesWrap.setAttribute('role', 'list');
  choicesWrap.setAttribute('aria-label', 'Dialogue choices');
  root.appendChild(choicesWrap);

  // A way out, on every story screen.
  //
  // The story screen had NO back control at all: it offered only the scene's own
  // choices, so on a touch device a player who wanted to leave the story could
  // not, and nothing told them how. Escape worked on a keyboard and that was it.
  // This is always the last option, always announced, and leaving keeps progress.
  const leaveBtn = makeButton({
    label: 'Back to the menu',
    hint: 'Leaves the story where it is. Your place and progress are kept.',
    onActivate: () => {
      audio?.play('ui-back', { group: 'sfx', volume: 0.55 });
      speech?.say('Left the story. Your progress is saved. Back at the menu.', { priority: 3, essential: true, hardInterrupt: true });
      screens.back();
    },
  });
  function addLeaveButton() {
    if (storyButtons.includes(leaveBtn)) return;
    choicesWrap.appendChild(leaveBtn.element);
    storyButtons.push(leaveBtn);
  }

  const controls = el('div', 'story-controls');
  const repeatBtn = makeButton({
    label: 'Read this again',
    className: 'ui-button-small',
    onActivate: () => speakNode(),
  });
  const menuBtn = makeButton({
    label: 'Save and return to menu',
    className: 'ui-button-small',
    onActivate: () => {
      gameState.syncStory();
      speech?.say('Progress saved.', { priority: 3, essential: true });
      audio?.play('coins', { group: 'sfx', volume: 0.5 });
      screens.gotoMenu();
    },
  });
  controls.append(menuBtn.element, repeatBtn.element);
  root.appendChild(controls);

  let interviewState = null;
  let negotiationState = null;
  let nodeCount = 0;

  function speakNode() {
    const speaker = speakerEl.textContent;
    const text = textEl.textContent;
    const n = story.current();
    const choiceText = n?.choices?.length
      ? ` ${n.choices.length} choices. ${n.choices.map((c, i) => `${i + 1}: ${c.text}`).join('. ')}. Swipe up or down to move between choices, single tap to choose.`
      : ' Swipe up or tap to continue.';
    speech?.say(`${speaker ? `${speaker} says: ` : ''}${text}${choiceText}`, {
      priority: 3,
      cooldownMs: 0,
      interrupt: true,
      essential: true,
    });
  }

  function ambienceLine(kind) {
    return {
      city: 'Anandapur street: buses, a market, harbour cranes turning.',
      home: 'Inside the family home. A fan, a door, quiet.',
      office: 'An office. Paper, a fan, a door closing.',
      workshop: 'The workshop floor: an impact wrench, metal being set down, a radio.',
      circuit: 'The Vettaru circuit: one car far away, then the air changing as it passes.',
      pit: 'The paddock behind the pit lane, before the heat. A generator running.',
    }[kind] ?? '';
  }

  function render() {
    const node = story.current();
    nodeCount++;
    if (!node) {
      chapterLabel.textContent = `Chapter ${chapterId}`;
      chapterProgress.textContent = '';
      speakerEl.textContent = '';
      textEl.textContent = 'This chapter has reached its end.';
      ambienceEl.textContent = '';
      renderChoices([]);
      return;
    }
    chapterLabel.textContent = `Chapter ${node.chapter}${node.chapterTitle ? `. ${node.chapterTitle}` : ''}`;
    chapterProgress.textContent = `Scene ${nodeCount}.`;
    speakerEl.textContent = node.speaker ?? '';
    speakerEl.hidden = !node.speaker;
    textEl.textContent = node.text;
    ambienceEl.textContent = ambienceLine(node.ambience);
    ambienceEl.hidden = !ambienceLine(node.ambience);

    if (node.ambience) bus.emit('story:ambience', { ambience: node.ambience });
    if (node.sfx) audio?.play(node.sfx, { group: 'sfx', volume: 0.7 });
    if (node.music) audio?.play(node.music, { group: 'music', volume: 0.55 });

    switch (node.kind) {
      case 'interview':
        startInterview(node);
        return;
      case 'negotiation':
        startNegotiation(node);
        return;
      case 'tutorial':
        renderChoices([]);
        speech?.say(node.text, { priority: 4, essential: true, interrupt: true, hardInterrupt: true, cooldownMs: 0 });
        screens.openTutorial({ returnToStory: true });
        return;
      case 'race':
        renderChoices([]);
        speech?.say(node.text, { priority: 4, essential: true, interrupt: true, hardInterrupt: true, cooldownMs: 0 });
        screens.startRaceFromStory(chapterId);
        return;
      case 'chapter_end':
        renderChoices([]);
        completeChapter(node);
        return;
      case 'action':
        renderChoices([]);
        // Action nodes resolve immediately through their `next` function.
        story.advance();
        render();
        return;
      default:
        renderChoices(node.choices ?? []);
        speakNode();
        return;
    }
  }

  function renderChoices(choices) {
    choicesWrap.textContent = '';
    storyButtons.length = 0;
    if (!choices.length) {
      const next = makeButton({
        label: 'Continue',
        className: 'ui-button-primary',
        onActivate: () => {
          audio?.play('ui-click', { group: 'sfx', volume: 0.5 });
          story.advance();
          render();
        },
      });
      choicesWrap.appendChild(next.element);
      storyButtons.push(next);
      addLeaveButton();
      return;
    }
    choices.forEach((choice, i) => {
      const b = makeButton({
        label: `${i + 1}. ${choice.text}`,
        className: 'ui-button-choice',
        onActivate: () => {
          audio?.play('ui-select', { group: 'sfx', volume: 0.6 });
          speech?.queue?.clear?.();
          story.choose(i);
          render();
        },
      });
      b.element.setAttribute('role', 'listitem');
      b.element.setAttribute('data-announce', `Choice ${i + 1} of ${choices.length}. ${choice.text}`);
      choicesWrap.appendChild(b.element);
      storyButtons.push(b);
    });
    addLeaveButton();
  }

  const storyButtons = [];

  function completeChapter(node) {
    story.completeChapter(chapterId);
    gameState.syncStory();
    audio?.play('voice-mission-complete', { group: 'voice', volume: 0.9 });
    audio?.play('music-achievement', { group: 'music', volume: 0.6 });
    speech?.say(`${node.text} Progress saved.`, { priority: 4, essential: true, interrupt: true, cooldownMs: 0 });
    const items = [
      makeButton({
        label: 'Return to menu',
        className: 'ui-button-primary',
        onActivate: () => screens.gotoMenu(),
      }),
    ];
    const nextChapter = chapterId + 1;
    if (gameState.story.chapterAvailable(nextChapter)) {
      items.unshift(
        makeButton({
          label: `Start chapter ${nextChapter}`,
          className: 'ui-button-primary',
          onActivate: () => screens.openStory(nextChapter),
        })
      );
    }
    renderChoices([]);
    choicesWrap.textContent = '';
    storyButtons.length = 0;
    for (const b of items) {
      choicesWrap.appendChild(b.element);
      storyButtons.push(b);
    }
  }

  // ------------------------------------------------------------- interview
  function startInterview(node) {
    const followUps = node.interviewMode === 'followups';
    const questions = followUps ? FOLLOW_UPS : INTERVIEW_QUESTIONS;
    interviewState = { questions, answers: [], index: 0, followUps, result: null };
    // Tapping on must REPLACE the beat, not queue behind it.
    //
    // Two things were wrong. Every passage was priority 4, and priority 4 can
    // never interrupt priority 4, so tapping four times read out all four
    // passages in a row while the player looked at the fourth. And with no key
    // there was nothing to replace, so the backlog only grew. The key makes the
    // newest beat supersede the queued one; hardInterrupt cuts the one already
    // being spoken.
    speech?.say(node.text, {
      priority: 4,
      essential: true,
      interrupt: true,
      hardInterrupt: true,
      key: 'storyBeat',
      cooldownMs: 0,
    });
    renderInterviewQuestion();
  }

  function renderInterviewQuestion() {
    const st = interviewState;
    if (st.index >= st.questions.length) {
      finishInterview();
      return;
    }
    const q = st.questions[st.index];
    speakerEl.textContent = q.speaker ?? 'Ms. Farida Qureshi';
    speakerEl.hidden = false;
    textEl.textContent = q.asked;
    ambienceEl.textContent = q.prep ? `Preparation note: ${q.prep}` : '';
    ambienceEl.hidden = !q.prep;
    chapterProgress.textContent = `Question ${st.index + 1} of ${st.questions.length}.`;

    choicesWrap.textContent = '';
    storyButtons.length = 0;
    q.options.forEach((opt, i) => {
      const b = makeButton({
        label: `${i + 1}. ${opt.text}`,
        className: 'ui-button-choice',
        onActivate: () => {
          audio?.play('ui-select', { group: 'sfx', volume: 0.6 });
          st.answers.push({ questionId: q.id, optionId: opt.id });
          // Immediate feedback explaining WHY the answer landed as it did.
          speech?.say(opt.feedback, { priority: 4, essential: true, cooldownMs: 0, interrupt: true });
          audio?.play(opt.score >= 3 ? 'voice-correct' : opt.score >= 1 ? 'ui-tick' : 'voice-wrong', {
            group: opt.score >= 1 ? 'sfx' : 'voice',
            volume: 0.7,
          });
          st.index++;
          setTimeout(() => renderInterviewQuestion(), 260);
        },
      });
      b.element.setAttribute('data-announce', `Answer ${i + 1} of ${q.options.length}. ${opt.text}`);
      choicesWrap.appendChild(b.element);
      storyButtons.push(b);
    });

    speech?.say(`${q.asked} ${q.options.length} answers. ${q.options.map((o, i) => `${i + 1}: ${o.text}`).join('. ')}`, {
      priority: 4,
      essential: true,
      cooldownMs: 0,
      interrupt: true,
    });
  }

  function finishInterview() {
    const st = interviewState;
    const result = evaluateInterview(st.answers, { includeFollowUps: st.followUps });
    // Follow-ups refine the original result rather than replacing it.
    const merged = st.followUps && gameState.save.interviewResult ? mergeInterviewResults(gameState.save.interviewResult, result) : result;
    st.result = merged;
    gameState.story.setState({ interviewResult: merged });
    gameState.syncStory();

    speakerEl.textContent = 'Ms. Farida Qureshi';
    speakerEl.hidden = false;
    textEl.textContent = merged.summary;
    ambienceEl.textContent = '';
    ambienceEl.hidden = true;

    const branch = interviewBranch(merged);
    speech?.say(`${interviewSpokenResult(merged)} Your result is ${merged.band}.`, {
      priority: 4,
      essential: true,
      interrupt: true,
      cooldownMs: 0,
    });
    audio?.play(merged.passed ? 'voice-congratulations' : 'voice-wrong', { group: 'voice', volume: 0.8 });

    choicesWrap.textContent = '';
    storyButtons.length = 0;
    const feedbackBtn = makeButton({
      label: 'Hear why each answer scored the way it did',
      onActivate: () =>
        speech?.say(
          merged.feedbackLines.map((f, i) => `${i + 1}. Score ${f.score} out of 3. ${f.feedback}`).join(' '),
          { priority: 3, essential: true, cooldownMs: 0, interrupt: true }
        ),
    });
    const continueBtn = makeButton({
      label: 'Continue',
      className: 'ui-button-primary',
      onActivate: () => {
        story.goto(branchNodeFor(branch, st.followUps));
        render();
      },
    });
    choicesWrap.append(feedbackBtn.element, continueBtn.element);
    storyButtons.push(feedbackBtn, continueBtn);
  }

  function branchNodeFor(branch, followUps) {
    if (branch === 'hired') return followUps ? 'ch2_followups_result' : 'ch2_passed';
    if (branch === 'follow_ups') return 'ch2_followups';
    return 'ch2_failed';
  }

  function mergeInterviewResults(original, followUp) {
    const total = original.total + followUp.total;
    const max = original.max + followUp.max;
    const ratio = max ? total / max : 0;
    const band = ratio >= 0.78 ? 'pass' : ratio >= 0.5 ? 'mixed' : 'fail';
    return {
      ...followUp,
      total,
      max,
      ratio: Number(ratio.toFixed(3)),
      band,
      passed: band === 'pass',
      perQuestion: [...(original.perQuestion ?? []), ...(followUp.perQuestion ?? [])],
      feedbackLines: [...(original.feedbackLines ?? []), ...(followUp.feedbackLines ?? [])],
      summary: `Including the follow-up questions you scored ${total} out of ${max}. ${
        band === 'pass' ? 'That is a pass.' : band === 'mixed' ? 'That is still not a clear pass.' : 'That is below what she can hire on.'
      }`,
      followUpsTaken: true,
    };
  }

  // ------------------------------------------------------------ negotiation
  function startNegotiation(node) {
    const save = gameState.save;
    negotiationState = createNegotiation({
      interviewResult: save.interviewResult ?? { band: 'mixed', ratio: 0.5 },
      storyState: {
        interview_pass: save.interviewResult?.band === 'pass',
        interview_mixed: save.interviewResult?.band === 'mixed',
        interview_fail: save.interviewResult?.band === 'fail',
        workshop_saturday: !!save.flags?.workshop_saturday,
        joseph_recommendation: !!save.flags?.josephKnowsName,
        mithin_recommendation: !!save.flags?.mithinRespectsYou,
        family_pressure: !!save.flags?.promisedDivya,
        late_arrival: !!save.flags?.arrivedLate,
        other_offer: !!save.flags?.teaStallJob,
      },
    });
    speakerEl.textContent = 'Ms. Farida Qureshi';
    speakerEl.hidden = false;
    textEl.textContent = `${node.text} ${negotiationState.openingSpoken}`;
    ambienceEl.textContent = negotiationState.leverageSpoken;
    ambienceEl.hidden = false;
    speech?.say(`${node.text} ${negotiationState.openingSpoken} ${negotiationState.leverageSpoken}`, {
      priority: 4,
      essential: true,
      interrupt: true,
      cooldownMs: 0,
    });
    renderNegotiationChoices();
  }

  function renderNegotiationChoices() {
    const nego = negotiationState;
    chapterProgress.textContent = `Round ${Math.min(nego.round + 1, 3)} of 3. Current offer ${sayMoney(nego.current)}.`;
    choicesWrap.textContent = '';
    storyButtons.length = 0;

    if (nego.finished) {
      finishNegotiation();
      return;
    }
    for (const choice of offerChoices(nego)) {
      const b = makeButton({
        label: choice.label,
        className: choice.id === 'accept' ? 'ui-button-primary ui-button-choice' : 'ui-button-choice',
        onActivate: () => {
          audio?.play('ui-select', { group: 'sfx', volume: 0.6 });
          const res = takeChoice(negotiationState, choice.id);
          negotiationState = res.nego;
          textEl.textContent = res.response.text;
          ambienceEl.textContent = `Round ${Math.min(negotiationState.round, 3)} of 3.`;
          speech?.say(res.response.spoken, { priority: 4, essential: true, interrupt: true, cooldownMs: 0 });
          renderNegotiationChoices();
        },
      });
      b.element.setAttribute('data-announce', choice.spoken);
      choicesWrap.appendChild(b.element);
      storyButtons.push(b);
    }
    const explain = makeButton({
      label: 'Explain my position again',
      className: 'ui-button-small',
      onActivate: () =>
        speech?.say(
          `${negotiationState.openingRationale} ${negotiationState.leverageSpoken} The most she can reach is influenced by your interview and by what you have already done in this story.`,
          { priority: 3, essential: true, cooldownMs: 0 }
        ),
    });
    choicesWrap.appendChild(explain.element);
    storyButtons.push(explain);
  }

  function finishNegotiation() {
    const nego = negotiationState;
    const final = finalizeSalary(nego, { workshop_saturday: !!gameState.save.flags?.workshop_saturday });
    gameState.story.setState(final.storyEffects);
    gameState.syncStory();
    speakerEl.textContent = 'Ms. Farida Qureshi';
    speakerEl.hidden = false;
    textEl.textContent = final.spoken;
    ambienceEl.textContent = '';
    ambienceEl.hidden = true;
    audio?.play(final.salary ? 'coins' : 'ui-error', { group: 'sfx', volume: 0.75 });
    speech?.say(`${final.spoken} ${final.salary ? `Your salary is recorded as ${final.salary} rupees a month, and later chapters will use the same figure.` : 'No salary was agreed, so the story takes the workshop route.'}`, {
      priority: 4,
      essential: true,
      interrupt: true,
      cooldownMs: 0,
    });
    choicesWrap.textContent = '';
    storyButtons.length = 0;
    const cont = makeButton({
      label: 'Continue',
      className: 'ui-button-primary',
      onActivate: () => {
        story.goto('ch3_salary');
        render();
      },
    });
    choicesWrap.appendChild(cont.element);
    storyButtons.push(cont);
  }

  // ------------------------------------------------------------------ start
  const entry = story.chapterEntry(chapterId);
  if (!entry) {
    textEl.textContent = 'This chapter is declared but not playable yet. Nothing here can be started, and that is deliberate: there are no buttons that pretend to work.';
    speakerEl.hidden = true;
    ambienceEl.hidden = true;
    renderChoices([]);
  } else {
    story.goto(entry);
    render();
  }

  // Every chapter mounts the same `story` screen, so the screen id alone cannot
  // pick the music. The chapter does: the family and the rent notice, the
  // pressure of the interview and the negotiation, the workshop floor, the
  // invitation, and the race itself each get their own bed.
  bus.emit('scene:music', { scene: `story-${chapterId}`, track: trackForChapter(chapterId) });

  return {
    id: 'story',
    title: `Chapter ${chapterId}`,
    summary: gameState.story.current()?.chapterTitle ?? '',
    element: root,
    focusItems: storyButtons,
    get focusButtons() {
      return storyButtons;
    },
    speakNode,
    destroy() {
      root.remove();
    },
  };
}
