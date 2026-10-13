/**
 * Chapter 2 interview scoring.
 *
 * The brief asks for explicit scoring with three outcomes - pass, mixed
 * (follow-up questions), fail (retry or an alternative branch) - and for
 * feedback that explains WHY an answer worked. So every option carries its own
 * score and its own explanation, and the evaluation reports per-question detail
 * rather than just a number.
 *
 * Pure data + pure functions: no DOM, no story engine, fully unit tested.
 *
 * @module story/interview
 */

export const INTERVIEW_BANDS = {
  PASS: 'pass',
  MIXED: 'mixed',
  FAIL: 'fail',
};

/** Fraction of the maximum score needed for each band. */
export const BAND_THRESHOLDS = { pass: 0.78, mixed: 0.5 };

/**
 * @typedef {object} InterviewOption
 * @property {string} id
 * @property {string} text      what the candidate says
 * @property {number} score     0..3
 * @property {string} feedback  why this answer landed the way it did
 * @property {string} [label]   'strong' | 'mixed' | 'weak'
 */

/**
 * The interview at Kalpesh Motors, conducted by Ms. Farida Qureshi.
 * Each question has one strong answer, one acceptable answer and one weak
 * answer, so the scoring is fair and learnable rather than a guessing game.
 */
export const INTERVIEW_QUESTIONS = [
  {
    id: 'q_intro',
    asked: 'Good morning. Please sit down. Tell me briefly about yourself and why you are here.',
    speaker: 'Ms. Farida Qureshi',
    prep: 'Keep it short: who you are, what you can do, why this job.',
    options: [
      {
        id: 'a',
        score: 3,
        label: 'strong',
        text: 'My name is Aarav. I grew up in Anandapur, I am reliable with time, and I want to build a career here rather than just fill a seat. I learn quickly and I would rather ask a question twice than make a mistake once.',
        feedback:
          'This worked because you named yourself, gave two things an employer can actually check, and admitted how you handle not knowing. Interviewers score honesty about learning higher than confidence about everything.',
      },
      {
        id: 'b',
        score: 1,
        label: 'mixed',
        text: 'I am Aarav. I need this job. My family is depending on me, so I will do anything you ask.',
        feedback:
          'This was honest but it put all the weight on your need rather than on what you offer. Desperation is understandable, yet an interviewer has to justify hiring you to someone else, and "they need it" is not a reason they can write down.',
      },
      {
        id: 'c',
        score: 0,
        label: 'weak',
        text: 'Honestly, I have no idea. I just saw the sign outside and walked in.',
        feedback:
          'This closed the conversation down. You gave her nothing to build on and no reason to keep going. Even a nervous candidate can say one true thing about why they are in the room.',
      },
    ],
  },
  {
    id: 'q_reliability',
    asked: 'This work starts early and customers are waiting. How do you make sure you are not late?',
    speaker: 'Ms. Farida Qureshi',
    prep: 'Give a concrete system, not a promise.',
    options: [
      {
        id: 'a',
        score: 3,
        label: 'strong',
        text: 'I set two alarms and I walk the route the evening before so I know how long it really takes. If something goes wrong on the way I call ahead immediately instead of hoping I can still make it.',
        feedback:
          'Strong because it is a system with a failure plan. Anyone can promise to be on time; describing what you do when the plan breaks is what makes a manager believe you.',
      },
      {
        id: 'b',
        score: 2,
        label: 'mixed',
        text: 'I am always on time. I have never been late for anything in my life.',
        feedback:
          'A clear claim, but an unverifiable one, and "never late for anything" is easy to doubt. It scored because it was confident and relevant, not because it was convincing.',
      },
      {
        id: 'c',
        score: 0,
        label: 'weak',
        text: 'Traffic in Anandapur is impossible, so it depends on the roads really.',
        feedback:
          'This moved the responsibility onto the traffic. Employers hear that as "I will be late and it will not be my fault." If the roads are genuinely a risk, the strong answer is to say how you plan around them.',
      },
    ],
  },
  {
    id: 'q_mistake',
    asked: 'Tell me about a time you made a mistake. What happened?',
    speaker: 'Ms. Farida Qureshi',
    prep: 'Real mistake, real consequence, real change afterwards.',
    options: [
      {
        id: 'a',
        score: 3,
        label: 'strong',
        text: 'I once told a neighbour I would deliver something on a day I had already promised my father I would help at home. I tried to do both and did neither properly. Now I check before I agree, and I say no out loud if I cannot.',
        feedback:
          'This worked because the mistake was yours, the consequence was real, and you finished with the specific habit you changed. That last part is what separates an apology from a lesson.',
      },
      {
        id: 'b',
        score: 1,
        label: 'mixed',
        text: 'I cannot think of a mistake I have made. I am quite careful.',
        feedback:
          'This is the answer interviewers hear most and trust least. Either you have not made one, which is unlikely, or you are not willing to talk about it, which tells her something about how you will behave when things go wrong at work.',
      },
      {
        id: 'c',
        score: 0,
        label: 'weak',
        text: 'My sister once blamed me for something and everyone believed her, so really it was her mistake.',
        feedback:
          'You used the question to blame someone else. Even if the story is true, she asked about YOUR mistake, and answering with someone else\'s fault suggests you will bring conflicts to the workshop floor.',
      },
    ],
  },
  {
    id: 'q_teamwork',
    asked: 'You will work alongside people who have been here for years. How will you fit in?',
    speaker: 'Ms. Farida Qureshi',
    prep: 'Show respect for experience and a willingness to be useful first.',
    options: [
      {
        id: 'a',
        score: 3,
        label: 'strong',
        text: 'I will learn their names on the first day and ask how they like things done before I suggest changing anything. I would rather be useful early than impressive early.',
        feedback:
          'Strong because it puts the existing team first and it names a behaviour she can picture. "Useful before impressive" is exactly what a supervisor wants from a new starter.',
      },
      {
        id: 'b',
        score: 2,
        label: 'mixed',
        text: 'I get on with everyone. I am easy to work with.',
        feedback:
          'Pleasant and probably true, but it describes a feeling rather than an action. It scored because it was positive and on topic.',
      },
      {
        id: 'c',
        score: 0,
        label: 'weak',
        text: 'I will keep to myself and do my work. I do not need friends at a job.',
        feedback:
          'This is a real cost to a small team. Workshop work depends on people telling each other things, and a new starter who refuses contact makes everyone else slower and less safe.',
      },
    ],
  },
  {
    id: 'q_why_us',
    asked: 'Last question. Why Kalpesh Motors, and what do you want from us in a year?',
    speaker: 'Ms. Farida Qureshi',
    prep: 'Connect their business to your own plan. Be specific.',
    options: [
      {
        id: 'a',
        score: 3,
        label: 'strong',
        text: 'Kalpesh Motors services the fleet that runs the port, so the work is steady and the standards have to be high. In a year I want to be trusted with a vehicle on my own and to have learned the electrical side properly.',
        feedback:
          'This worked because you showed you know what the company actually does, and your one-year goal is something she can measure. Specificity is the difference between a plan and a wish.',
      },
      {
        id: 'b',
        score: 1,
        label: 'mixed',
        text: 'It is a good company and I want a stable salary for my family.',
        feedback:
          'True, and she will not punish honesty about money, but it only describes what you take. Nothing in it tells her what you will give, and every other candidate said some version of this.',
      },
      {
        id: 'c',
        score: 0,
        label: 'weak',
        text: 'I do not know much about it. I just want any job at the moment.',
        feedback:
          'By the last question you had a chance to show interest and you showed none. "Any job" tells an employer you will leave for the first better offer, which is expensive for them.',
      },
    ],
  },
];

export const FOLLOW_UPS = [
  {
    id: 'fu_pressure',
    asked: 'You mentioned you would call ahead if you were running late. Who exactly would you call, and what would you say?',
    speaker: 'Ms. Farida Qureshi',
    options: [
      {
        id: 'a',
        score: 3,
        label: 'strong',
        text: 'My supervisor first, by phone, not by message. I would say how late I expect to be and whether the first job of the day needs covering, so they can plan instead of waiting.',
        feedback:
          'You answered the exact question and added the part that matters to the person receiving the call. Naming a phone call rather than a message shows you understand urgency.',
      },
      {
        id: 'b',
        score: 1,
        label: 'mixed',
        text: 'I would call whoever answers and explain the situation.',
        feedback:
          'Better than nothing, but vague. She asked who and what, and answering only "whoever answers" suggests you have not actually thought the situation through.',
      },
      {
        id: 'c',
        score: 0,
        label: 'weak',
        text: 'I would probably just hurry and not call, so nobody notices.',
        feedback:
          'This directly contradicted the system you described earlier, and concealing a delay is worse than the delay. Consistency under a follow-up is the whole point of the question.',
      },
    ],
  },
  {
    id: 'fu_conflict',
    asked: 'Suppose an experienced colleague tells you to do a job in a way you are sure is unsafe. What do you do?',
    speaker: 'Ms. Farida Qureshi',
    options: [
      {
        id: 'a',
        score: 3,
        label: 'strong',
        text: 'I would stop the job and ask them to show me why it is safe, and if I am still not convinced I would take it to the supervisor. I would rather be annoying than injured.',
        feedback:
          'Correct. You did not overrule a senior colleague on your own authority, but you also did not comply with something unsafe. Escalating is the behaviour a workshop manager is trained to look for.',
      },
      {
        id: 'b',
        score: 1,
        label: 'mixed',
        text: 'I would do it their way because they have more experience than me.',
        feedback:
          'Respect for experience is good, but experience does not make a method safe. Deferring completely means an unsafe practice keeps going, and you were the only person who noticed.',
      },
      {
        id: 'c',
        score: 0,
        label: 'weak',
        text: 'I would refuse and tell them they are doing it wrong in front of the others.',
        feedback:
          'The safety instinct was right but the method was destructive. Publicly contradicting a senior colleague turns a fixable problem into a feud, and the team stops telling each other things.',
      },
    ],
  },
];

/** Score one answer against one question. */
export function scoreAnswer(question, optionId) {
  const option = question?.options?.find((o) => o.id === optionId);
  if (!option) {
    return { score: 0, max: 3, label: 'weak', feedback: 'No answer was recorded for that question.', optionId: null };
  }
  return {
    score: option.score,
    max: 3,
    label: option.label ?? (option.score >= 3 ? 'strong' : option.score >= 2 ? 'mixed' : 'weak'),
    feedback: option.feedback,
    optionId: option.id,
    questionId: question.id,
  };
}

/**
 * Evaluate a completed interview.
 * @param {Array<{questionId:string, optionId:string}>} answers
 * @param {object} [opts]
 * @param {boolean} [opts.includeFollowUps]
 */
export function evaluateInterview(answers, opts = {}) {
  const questions = [...INTERVIEW_QUESTIONS];
  if (opts.includeFollowUps) questions.push(...FOLLOW_UPS);

  const perQuestion = [];
  let total = 0;
  let max = 0;
  for (const q of questions) {
    const given = answers.find((a) => a.questionId === q.id);
    const result = scoreAnswer(q, given?.optionId ?? null);
    result.questionId = q.id;
    result.asked = q.asked;
    result.spoken = q.options?.find((o) => o.id === given?.optionId)?.text ?? null;
    perQuestion.push(result);
    total += result.score;
    max += result.max;
  }

  const ratio = max > 0 ? total / max : 0;
  let band;
  if (ratio >= BAND_THRESHOLDS.pass) band = INTERVIEW_BANDS.PASS;
  else if (ratio >= BAND_THRESHOLDS.mixed) band = INTERVIEW_BANDS.MIXED;
  else band = INTERVIEW_BANDS.FAIL;

  // A mixed interview earns follow-up questions rather than an outright result.
  const needsFollowUps = band === INTERVIEW_BANDS.MIXED && !opts.includeFollowUps;

  const strongest = perQuestion.reduce((best, r) => (r.score > (best?.score ?? -1) ? r : best), null);
  const weakest = perQuestion.reduce((best, r) => (r.score < (best?.score ?? 99) ? r : best), null);

  return {
    total,
    max,
    ratio: Number(ratio.toFixed(3)),
    band,
    needsFollowUps,
    passed: band === INTERVIEW_BANDS.PASS,
    perQuestion,
    summary: bandSummary(band, total, max),
    strongestQuestionId: strongest?.questionId ?? null,
    weakestQuestionId: weakest?.questionId ?? null,
    feedbackLines: perQuestion.map((r) => ({ questionId: r.questionId, score: r.score, feedback: r.feedback })),
  };
}

export function bandSummary(band, total, max) {
  switch (band) {
    case INTERVIEW_BANDS.PASS:
      return `You scored ${total} out of ${max}. That is a pass. Ms. Qureshi is satisfied and moves to talking about pay.`;
    case INTERVIEW_BANDS.MIXED:
      return `You scored ${total} out of ${max}. That is not a clear pass, so she asks follow-up questions before deciding.`;
    case INTERVIEW_BANDS.FAIL:
      return `You scored ${total} out of ${max}. That is below what she can hire on. You may try the interview again, or take a different route into the job.`;
    default:
      return `You scored ${total} out of ${max}.`;
  }
}

/** Which branch the story takes after the interview. */
export function interviewBranch(result) {
  if (result.band === INTERVIEW_BANDS.PASS) return 'hired';
  if (result.band === INTERVIEW_BANDS.MIXED) return 'follow_ups';
  return 'retry_or_alternative';
}

/** The alternative route offered after a failed interview. */
export const ALTERNATIVE_ROUTE = {
  id: 'workshop_help',
  title: 'Helping out at the workshop',
  text:
    'Ms. Qureshi did not offer you the job today. But she said the workshop floor is short-handed on Saturdays, and if you turn up and work one Saturday properly, she will read your application again on Monday. It is a slower route in, and it is a real one.',
  effects: { jobRoute: 'workshop_saturday', hired: false, interviewAttemptsUsed: 1 },
};

export function interviewSpokenResult(result) {
  const lines = [result.summary];
  const weakest = result.perQuestion.find((r) => r.questionId === result.weakestQuestionId);
  if (weakest) lines.push(`Your weakest answer was: ${weakest.feedback}`);
  return lines.join(' ');
}
