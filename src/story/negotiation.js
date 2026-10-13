/**
 * Chapter 3 salary negotiation.
 *
 * The brief requires the negotiation to depend on the actual offer, the actual
 * interview performance and the recorded story state - and for the accepted
 * salary to be stored and reused later. So this module is a small deterministic
 * state machine: nothing random, everything derived from inputs the player can
 * see, and every employer response explains the reasoning out loud.
 *
 * @module story/negotiation
 */

import { INTERVIEW_BANDS } from './interview.js';

export const CURRENCY = 'rupees';
export const MAX_ROUNDS = 3;

/** Market band for an entry workshop role in Anandapur, per month. */
export const MARKET = { floor: 7500, typical: 9500, good: 11500, ceiling: 15000 };

/**
 * Leverage sources recorded in story state. Each adds to how far the employer
 * will actually go, and each has a spoken reason so the player understands why
 * their position is stronger or weaker.
 */
export const LEVERAGE_SOURCES = {
  interview_pass: { value: 0.22, reason: 'You passed the interview cleanly, so they already decided they want you.' },
  interview_mixed: { value: 0.06, reason: 'You passed only after follow-up questions, so they are less certain about you.' },
  interview_fail: { value: -0.08, reason: 'They only reconsidered you after a second attempt, and they know it.' },
  workshop_saturday: { value: 0.18, reason: 'You already worked a Saturday on the floor, so they know what you are like.' },
  joseph_recommendation: { value: 0.12, reason: 'Joseph put your name forward internally. That costs him something, so it counts.' },
  mithin_recommendation: { value: 0.1, reason: 'Mithin vouched for you to the supervisor.' },
  family_pressure: { value: -0.14, reason: 'They can tell you need this quickly, and that weakens your position.' },
  other_offer: { value: 0.2, reason: 'You have another offer in hand. That is the strongest position anyone can negotiate from.' },
  late_arrival: { value: -0.1, reason: 'You arrived late to this meeting, which they have not forgotten.' },
};

/**
 * Build the employer's opening offer and their hidden walk-away ceiling.
 *
 * @param {object} input
 * @param {{band:string, ratio:number}} input.interviewResult
 * @param {object} input.storyState
 */
export function openingOffer({ interviewResult, storyState = {} }) {
  const band = interviewResult?.band ?? INTERVIEW_BANDS.MIXED;
  const ratio = Number.isFinite(interviewResult?.ratio) ? interviewResult.ratio : 0.5;

  const bandBase =
    band === INTERVIEW_BANDS.PASS ? MARKET.typical : band === INTERVIEW_BANDS.MIXED ? MARKET.floor + 900 : MARKET.floor;

  // Interview score fine-tunes within the band, but never above the market.
  const scoreAdjust = Math.round((ratio - 0.6) * 2600);
  let offer = bandBase + scoreAdjust;

  // Leverage moves what they are ultimately willing to pay, not usually the
  // opening number - employers open low regardless. Only a competing offer
  // forces the opening up.
  const leverage = totalLeverage(storyState);
  if (storyState.other_offer) offer += 700;

  offer = roundTo50(clamp(offer, MARKET.floor, MARKET.typical + 1200));
  const ceiling = roundTo50(clamp(offer + 1400 + leverage.value * 22000, offer, MARKET.ceiling));

  return {
    offer,
    ceiling,
    leverage,
    band,
    rationale: offerRationale(band, ratio, storyState),
    spoken: `Ms. Qureshi offers ${sayMoney(offer)} per month to start. ${offerRationale(band, ratio, storyState)}`,
  };
}

export function totalLeverage(storyState = {}) {
  const active = [];
  let value = 0;
  for (const [key, def] of Object.entries(LEVERAGE_SOURCES)) {
    if (storyState[key]) {
      active.push({ key, ...def });
      value += def.value;
    }
  }
  return {
    value: Math.round(Math.max(-0.4, Math.min(0.6, value)) * 100) / 100,
    active,
    spoken: active.length
      ? `Your position: ${active.map((a) => a.reason).join(' ')}`
      : 'You have no particular leverage in this conversation.',
  };
}

function offerRationale(band, ratio, storyState) {
  if (band === INTERVIEW_BANDS.PASS && ratio >= 0.9) {
    return 'She said your interview answers were the clearest she has heard this month, so the opening figure is at the top of the band.';
  }
  if (band === INTERVIEW_BANDS.PASS) {
    return 'She said you passed solidly and she is starting you at the standard rate for the role.';
  }
  if (band === INTERVIEW_BANDS.MIXED) {
    return storyState.workshop_saturday
      ? 'She is still cautious after the follow-up questions, but your Saturday work means she is offering rather than refusing.'
      : 'She is cautious after the follow-up questions, so the opening figure is at the bottom of the band.';
  }
  return storyState.workshop_saturday
    ? 'She only reconsidered you because you turned up on a Saturday and did the work. The offer reflects that hesitation.'
    : 'She is hiring you reluctantly, and the number shows it.';
}

/**
 * The choices available in the current round.
 * @param {object} nego
 */
export function offerChoices(nego) {
  const gap = nego.ceiling - nego.current;
  const askModest = roundTo50(nego.current + Math.max(300, Math.min(1200, gap * 0.45)));
  const askBold = roundTo50(nego.current + Math.max(600, Math.min(2600, gap * 0.95)));
  const lastRound = nego.round >= MAX_ROUNDS;

  const choices = [];
  if (!lastRound) {
    choices.push({
      id: 'ask_modest',
      ask: askModest,
      label: `Ask for ${sayMoney(askModest)}`,
      spoken: `Ask for ${sayMoney(askModest)} per month. A modest increase, low risk.`,
      risk: 0,
    });
    choices.push({
      id: 'ask_bold',
      ask: askBold,
      label: `Ask for ${sayMoney(askBold)}`,
      spoken: `Ask for ${sayMoney(askBold)} per month. A bold increase, and it may cost you goodwill.`,
      risk: 1,
    });
  }
  choices.push({
    id: 'ask_non_salary',
    label: 'Ask about hours and training instead',
    spoken: 'Ask about working hours, training and travel costs instead of the number.',
    risk: 0,
  });
  choices.push({
    id: 'accept',
    label: `Accept ${sayMoney(nego.current)}`,
    spoken: `Accept ${sayMoney(nego.current)} per month and finish the conversation.`,
    risk: 0,
  });
  if (nego.round >= 2) {
    choices.push({
      id: 'walk_away',
      label: 'Leave without accepting',
      spoken: 'Leave without accepting. You lose this offer, but you can come back another way.',
      risk: 2,
    });
  }
  return choices;
}

/**
 * Resolve one player choice. Returns the updated negotiation, the employer's
 * spoken response, and whether the conversation has ended.
 */
export function takeChoice(nego, choiceId) {
  const choice = offerChoices(nego).find((c) => c.id === choiceId);
  if (!choice) {
    return { nego, response: { spoken: 'That was not one of the options.', text: 'That was not one of the options.' }, finished: false, invalid: true };
  }
  const next = { ...nego, history: [...nego.history] };

  if (choiceId === 'accept') {
    next.accepted = next.current;
    next.finished = true;
    next.outcome = 'accepted';
    return {
      nego: next,
      finished: true,
      response: {
        spoken: `You accept ${sayMoney(next.current)} per month. Ms. Qureshi writes it on the form and asks you to sign. Your salary is recorded as ${sayMoney(next.current)}.`,
        text: `Accepted: ${sayMoney(next.current)} per month.`,
      },
    };
  }

  if (choiceId === 'walk_away') {
    next.finished = true;
    next.outcome = 'walked_away';
    next.accepted = null;
    return {
      nego: next,
      finished: true,
      response: {
        spoken:
          'You stand up and leave. Ms. Qureshi does not stop you. The offer is gone, but you still have the workshop Saturday route, and you can come back when your position is stronger.',
        text: 'You left without accepting. The offer is withdrawn.',
      },
    };
  }

  if (choiceId === 'ask_non_salary') {
    next.round += 1;
    next.goodwill += 1; // asking about conditions reads as serious, not greedy
    next.nonSalaryAsked = true;
    const gain = roundTo50(Math.min(450, Math.max(150, (next.ceiling - next.current) * 0.16)));
    next.current += gain;
    next.history.push({ round: next.round, choiceId, result: next.current });
    return {
      nego: next,
      finished: next.round >= MAX_ROUNDS,
      response: {
        spoken: `She says the shift starts at seven, you get one paid training day a month, and the workshop covers bus fare. Then she adds ${sayMoney(gain)} to the figure without being asked, because you asked about the work rather than the money. The offer is now ${sayMoney(next.current)}.`,
        text: `She improved the offer to ${sayMoney(next.current)} and explained the hours and training.`,
      },
    };
  }

  // --- a direct ask for more money ---
  next.round += 1;
  const ask = choice.ask;
  next.history.push({ round: next.round, choiceId, ask });

  if (ask <= next.ceiling) {
    // Inside what they can pay. Bold asks still cost a little goodwill.
    const conceded = choiceId === 'ask_bold' ? Math.min(ask, next.ceiling) : ask;
    next.current = roundTo50(conceded);
    if (choiceId === 'ask_bold') next.goodwill -= 1;
    return {
      nego: next,
      finished: next.round >= MAX_ROUNDS,
      response: {
        spoken:
          choiceId === 'ask_bold'
            ? `She pauses a long moment, then says she can do ${sayMoney(next.current)}, but she wants you to know she is stretching for you. The offer is now ${sayMoney(next.current)}.`
            : `She says she can meet that. The offer is now ${sayMoney(next.current)}.`,
        text: `Offer improved to ${sayMoney(next.current)}.`,
      },
    };
  }

  // --- above the ceiling ---
  if (choiceId === 'ask_bold' && next.goodwill <= 0) {
    // Pushed too hard with nothing banked. The offer comes back down.
    const withdrawn = roundTo50(Math.max(MARKET.floor, next.current - 400));
    next.current = withdrawn;
    next.goodwill -= 1;
    next.reduced = true;
    return {
      nego: next,
      finished: next.round >= MAX_ROUNDS,
      response: {
        spoken: `She puts the pen down. She says the figure you asked for is not what this role is worth in Anandapur, and after a pause she moves the offer down to ${sayMoney(withdrawn)}. You can still accept it, but you have less room than you had.`,
        text: `You pushed too hard. The offer dropped to ${sayMoney(withdrawn)}.`,
      },
    };
  }

  // Above the ceiling but reasonable: they counter at the ceiling.
  next.current = next.ceiling;
  next.goodwill -= choiceId === 'ask_bold' ? 1 : 0;
  next.atCeiling = true;
  return {
    nego: next,
    finished: next.round >= MAX_ROUNDS,
    response: {
      spoken: `She says she cannot reach that number. The most she can authorise for this role is ${sayMoney(next.ceiling)}, and that is her final figure.`,
      text: `She countered with her maximum: ${sayMoney(next.ceiling)}.`,
    },
  };
}

/**
 * Start a negotiation.
 * @returns {object} negotiation state
 */
export function createNegotiation({ interviewResult, storyState = {} }) {
  const opening = openingOffer({ interviewResult, storyState });
  return {
    round: 0,
    opening: opening.offer,
    current: opening.offer,
    ceiling: opening.ceiling,
    leverage: opening.leverage,
    goodwill: storyState.workshop_saturday ? 2 : 1,
    band: opening.band,
    interviewRatio: interviewResult?.ratio ?? 0.5,
    history: [],
    finished: false,
    outcome: null,
    accepted: null,
    nonSalaryAsked: false,
    atCeiling: false,
    reduced: false,
    openingRationale: opening.rationale,
    openingSpoken: opening.spoken,
    leverageSpoken: opening.leverage.spoken,
  };
}

/**
 * The value recorded in the save file and reused by later chapters.
 * Never null in a completed chapter: if the player walked away, the story
 * routes them to the alternative branch instead of leaving a hole.
 */
export function finalizeSalary(nego, storyState = {}) {
  if (nego.outcome === 'accepted' && nego.accepted) {
    return {
      salary: nego.accepted,
      status: 'accepted',
      spoken: `Your recorded salary is ${sayMoney(nego.accepted)} per month.`,
      storyEffects: { salary: nego.accepted, employed: true, jobRoute: 'interview', negotiationRounds: nego.round },
    };
  }
  if (nego.outcome === 'walked_away') {
    return {
      salary: null,
      status: 'walked_away',
      spoken: 'No salary was agreed. You will need the workshop route instead.',
      storyEffects: { salary: null, employed: false, jobRoute: 'workshop_saturday', negotiationWalkedAway: true },
    };
  }
  // Rounds ran out: the last figure on the table stands as a take-it-or-leave-it.
  const fallback = storyState.workshop_saturday ? nego.current : Math.max(MARKET.floor, nego.current);
  return {
    salary: fallback,
    status: 'ran_out',
    spoken: `You ran out of room to negotiate. The figure on the table is ${sayMoney(fallback)}, and she asks you to decide today.`,
    storyEffects: { salary: fallback, employed: true, jobRoute: 'interview', negotiationRounds: nego.round, negotiationRanOut: true },
  };
}

// ---------------------------------------------------------------- helpers

export function roundTo50(n) {
  return Math.round(n / 50) * 50;
}
export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/** Spoken money: "nine thousand five hundred rupees", not "9,500". */
export function sayMoney(amount) {
  if (!Number.isFinite(amount)) return 'no salary';
  const n = Math.round(amount);
  if (n < 1000) return `${n} ${CURRENCY}`;
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const words = [];
  const UNITS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function under1000(v) {
    const parts = [];
    const h = Math.floor(v / 100);
    if (h) parts.push(`${UNITS[h]} hundred`);
    const r = v % 100;
    if (r) {
      if (r < 20) parts.push(UNITS[r]);
      else parts.push(`${TENS[Math.floor(r / 10)]}${r % 10 ? '-' + UNITS[r % 10] : ''}`);
    }
    return parts.join(' ');
  }
  words.push(`${under1000(thousands)} thousand`);
  if (rest) words.push(under1000(rest));
  return `${words.join(' ')} ${CURRENCY}`;
}
