// The three counter offers: the spin-the-wheel game (for customers who bring
// a flyer), the pushup challenge, and the story challenge (a confirmed
// Instagram story banks 10% off the customer's next visit). The server picks
// the wheel slice (so it can't be re-rolled from the screen) and computes
// every reward when the order is saved; client/src/game.ts mirrors this math
// for the live ticket only.
// All money is integer paise.

export const GAME_RULES = {
  originalsMinSpendPaise: 55500, // spend ₹555 (excluding the free one) → one Originals smoothie free
  // The ₹555 combo slice only comes up for bills in this band (inclusive). Any
  // other bill — including anything above ₹555 — never lands on it.
  comboBillMinPaise: 25000,
  comboBillMaxPaise: 55499,
  proteinQuizOffPaise: 3000,
  bottleFlipOffPaise: 3000,
  reactionOffPaise: 2000,
  weightGuessPercent: 20,
  // Offers (not on the wheel)
  pushupMaxDiscountPaise: 10000, // ₹1 per pushup on a Signature shake, capped at ₹100
  storyNextVisitPercent: 10, // banked by a story today, used on a later day
};

// Order = slices on the wheel, clockwise from the top. Keep in sync with client/src/game.ts.
export const CHALLENGE_KEYS = [
  'originals555',
  'proteinQuiz',
  'stopwatch',
  'plank',
  'bottleFlip',
  'reaction',
  'weightGuess',
];

// Slices the wheel may land on for a bill of this size (cart total before
// discounts, at the moment of the spin). The wheel still shows every slice.
export function wheelPool(billPaise) {
  const comboOn = billPaise >= GAME_RULES.comboBillMinPaise && billPaise <= GAME_RULES.comboBillMaxPaise;
  return comboOn ? CHALLENGE_KEYS : CHALLENGE_KEYS.filter((k) => k !== 'originals555');
}

const fail = (error) => ({ discount_paise: 0, note: '', error });
const subtotalOf = (lines) => lines.reduce((s, l) => s + l.unit_price_paise * l.quantity, 0);
const unitPricesIn = (lines, tier) => lines.filter((l) => l.tier === tier).map((l) => l.unit_price_paise);

/**
 * @param {string} key one of CHALLENGE_KEYS
 * @param {{tier:string|null, unit_price_paise:number, quantity:number, addon_prices_paise:number[]}[]} lines
 * @returns {{discount_paise:number, note:string, error:string|null}}
 */
export function computeReward(key, lines) {
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
      // Not a price change: staff add an extra 5g scoop to the drink.
      note = 'Wheel: +5g extra protein FREE';
      break;
    case 'plank': {
      const addonPrices = lines.flatMap((l) => l.addon_prices_paise);
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
    default:
      return fail('Unknown wheel challenge.');
  }

  return { discount_paise: Math.min(discount, subtotal), note, error: null };
}

/**
 * The pushup challenge, which staff can apply to any order.
 * @param {{pushups?:number}} offers
 * @returns {{discount_paise:number, notes:{kind:string, note:string, discount_paise:number}[], error:string|null}}
 */
export function computeOffers(offers, lines) {
  const notes = [];
  if (offers?.pushups != null) {
    const n = Number(offers.pushups);
    if (!Number.isInteger(n) || n <= 0 || n > 999) return { discount_paise: 0, notes: [], error: 'Enter the number of pushups.' };
    const prices = unitPricesIn(lines, 'Signature');
    if (!prices.length) return { discount_paise: 0, notes: [], error: 'Pushups need a Signature shake in the order.' };
    const d = Math.min(n * 100, GAME_RULES.pushupMaxDiscountPaise, Math.max(...prices));
    notes.push({ kind: 'pushups', note: `Pushup challenge: ${n} pushups`, discount_paise: d });
  }
  return { discount_paise: notes.reduce((s, n) => s + n.discount_paise, 0), notes, error: null };
}

// The customer's banked story reward, if any (at most one is unused at a time).
// It can only be used on a later day than the one it was earned on.
export function pendingStoryCredit(db, customerId) {
  if (!customerId) return null;
  const row = db
    .prepare('SELECT * FROM story_credits WHERE customer_id = ? AND used_order_id IS NULL ORDER BY id LIMIT 1')
    .get(customerId);
  return row ? { ...row, usable_today: row.earned_day < istDay() } : null;
}

// One spin per customer per IST day. Customers are identified by phone or username.
export function customerKey(phone, username) {
  if (phone) return `p:${phone}`;
  if (username) return `u:${username.toLowerCase()}`;
  return null;
}

export function istDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}
