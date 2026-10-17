// The three counter offers: the spin-the-wheel game (flyer customers), the
// pushup challenge and the story challenge. Wheel slices plus a client-side
// mirror of the server's reward math (server/src/lib/game.js) for the live
// ticket only. The server picks the slice and is the source of truth for
// every discount.
// Keep CHALLENGES in the same order as CHALLENGE_KEYS on the server.

export const GAME_RULES = {
  originalsMinSpendPaise: 55500,
  proteinQuizOffPaise: 3000,
  bottleFlipOffPaise: 3000,
  reactionOffPaise: 2000,
  weightGuessPercent: 20,
  pushupMaxDiscountPaise: 10000,
  storyNextVisitPercent: 10, // banked by a story today, used on a later day
  // Played on screen
  stopwatchTarget: 5,
  stopwatchTolerance: 0.1, // 4.90s – 5.10s wins
  quizCards: 5,
  quizToWin: 3,
  quizToleranceG: 2, // a guess within ±2g counts as right
  reactionTries: 3,
  reactionMaxAvgMs: 350,
  weightToleranceG: 10,
};

export type ChallengeKey =
  | 'originals555'
  | 'proteinQuiz'
  | 'stopwatch'
  | 'plank'
  | 'bottleFlip'
  | 'reaction'
  | 'weightGuess';

export interface Challenge {
  key: ChallengeKey;
  wheelLabel: string;
  title: string;
  howToPlay: string;
  reward: string;
  color: string;
  // Played on screen: the app decides win/lose instead of staff.
  onScreen?: boolean;
}

const RED = '#E8341C';
const INK = '#0D0D0D';
const CREAM = '#F3EDE4';
const POSTER = '#BF1E2D';

export const CHALLENGES: Challenge[] = [
  {
    key: 'originals555',
    wheelLabel: '₹555 COMBO',
    title: 'ORIGINALS ON THE HOUSE',
    howToPlay: 'Spend ₹555 or more and one Originals smoothie is free. Add it to the order.',
    reward: 'Free Originals smoothie',
    color: RED,
  },
  {
    key: 'proteinQuiz',
    wheelLabel: 'PROTEIN QUIZ',
    title: 'GUESS THE PROTEIN',
    howToPlay: `5 foods. Guess the protein in each, then staff flip the card. Within ±${GAME_RULES.quizToleranceG}g is right. Get 3 right to win.`,
    reward: '₹30 off',
    color: INK,
    onScreen: true,
  },
  {
    key: 'stopwatch',
    wheelLabel: '5-SEC STOP',
    title: 'STOP AT EXACTLY 5.00',
    howToPlay: 'Tap to start, tap to stop. The timer hides after 1 second. Stop between 4.90 and 5.10. One try.',
    reward: '+5g extra protein free',
    color: CREAM,
    onScreen: true,
  },
  {
    key: 'plank',
    wheelLabel: 'PLANK 2:00',
    title: '2-MINUTE PLANK',
    howToPlay: 'Hold a plank for 2 full minutes. Knees off the floor, back straight.',
    reward: 'One add-on free (add it to a drink)',
    color: POSTER,
  },
  {
    key: 'bottleFlip',
    wheelLabel: 'BOTTLE FLIP',
    title: 'SHAKER BOTTLE FLIP',
    howToPlay: 'Flip the Whey Lab shaker so it lands standing up. 3 tries.',
    reward: '₹30 off',
    color: RED,
  },
  {
    key: 'reaction',
    wheelLabel: 'REACTION',
    title: 'REACTION TEST',
    howToPlay: `Wait for the box to turn red, then tap as fast as you can. ${GAME_RULES.reactionTries} tries — average under ${(GAME_RULES.reactionMaxAvgMs / 1000).toFixed(2)}s wins. Tap too early and that try restarts.`,
    reward: '₹20 off',
    color: INK,
    onScreen: true,
  },
  {
    key: 'weightGuess',
    wheelLabel: 'WEIGHT GUESS',
    title: 'GUESS THE WEIGHT',
    howToPlay: `Hold the item we hand you and guess its weight in grams. Within ±${GAME_RULES.weightToleranceG}g wins.`,
    reward: '20% off the bill',
    color: CREAM,
    onScreen: true,
  },
];

export interface GameLine {
  tier: string | null;
  unitPaise: number;
  quantity: number;
  addonPricesPaise: number[];
}

export interface GameReward {
  discountPaise: number;
  note: string;
  error: string | null;
}

const subtotalOf = (lines: GameLine[]) => lines.reduce((s, l) => s + l.unitPaise * l.quantity, 0);
const unitPricesIn = (lines: GameLine[], tier: string) => lines.filter((l) => l.tier === tier).map((l) => l.unitPaise);
const fail = (error: string): GameReward => ({ discountPaise: 0, note: '', error });

export function computeReward(key: ChallengeKey, lines: GameLine[]): GameReward {
  const subtotal = subtotalOf(lines);
  let discount = 0;
  let note = '';

  switch (key) {
    case 'originals555': {
      const prices = unitPricesIn(lines, 'Originals');
      if (!prices.length) return fail('Add an Originals smoothie to the order.');
      const free = Math.min(...prices);
      const rest = subtotal - free;
      if (rest < GAME_RULES.originalsMinSpendPaise) {
        return fail(`Spend ₹${((GAME_RULES.originalsMinSpendPaise - rest) / 100).toFixed(0)} more to unlock the free Originals.`);
      }
      discount = free;
      note = 'Wheel: free Originals smoothie';
      break;
    }
    case 'proteinQuiz':
      discount = GAME_RULES.proteinQuizOffPaise;
      note = 'Wheel: protein quiz';
      break;
    case 'stopwatch':
      note = 'Wheel: +5g extra protein FREE';
      break;
    case 'plank': {
      const addonPrices = lines.flatMap((l) => l.addonPricesPaise);
      if (!addonPrices.length) return fail('Add the free add-on to a drink first.');
      discount = Math.max(...addonPrices);
      note = 'Wheel: 2-min plank, free add-on';
      break;
    }
    case 'bottleFlip':
      discount = GAME_RULES.bottleFlipOffPaise;
      note = 'Wheel: bottle flip';
      break;
    case 'reaction':
      discount = GAME_RULES.reactionOffPaise;
      note = 'Wheel: reaction test';
      break;
    case 'weightGuess':
      discount = Math.round((subtotal * GAME_RULES.weightGuessPercent) / 100);
      note = `Wheel: weight guess ${GAME_RULES.weightGuessPercent}% off`;
      break;
  }

  return { discountPaise: Math.min(discount, subtotal), note, error: null };
}

export interface Offers {
  pushups?: number;
}

export interface OffersResult {
  discountPaise: number;
  notes: string[];
  error: string | null;
}

export function computeOffers(offers: Offers, lines: GameLine[]): OffersResult {
  let discount = 0;
  const notes: string[] = [];
  if (offers.pushups != null) {
    const n = offers.pushups;
    if (!Number.isInteger(n) || n <= 0) return { discountPaise: 0, notes: [], error: 'Enter the number of pushups.' };
    const prices = unitPricesIn(lines, 'Signature');
    if (!prices.length) return { discountPaise: 0, notes: [], error: 'Pushups need a Signature shake in the order.' };
    discount += Math.min(n * 100, GAME_RULES.pushupMaxDiscountPaise, Math.max(...prices));
    notes.push(`Pushup challenge: ${n} pushups`);
  }
  return { discountPaise: discount, notes, error: null };
}
