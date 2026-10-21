import { Router } from 'express';
import { randomInt } from 'node:crypto';
import { getDb } from '../lib/db.js';
import { CHALLENGE_KEYS, wheelPool, customerKey, istDay, pendingStoryCredit } from '../lib/game.js';
import { normalizeUsername, isValidUsername } from '../lib/username.js';

const router = Router();
const db = getDb();

const isPhone = (p) => typeof p === 'string' && /^\d{10}$/.test(p);

// Spin the wheel for a customer. Spinning again the same day returns the same
// slice, so the result can't be re-rolled by spinning twice. bill_paise (the
// cart total before discounts) decides which slices are in play; see wheelPool.
router.post('/spin', (req, res) => {
  const { phone, username: rawUsername, bill_paise: billPaise } = req.body || {};
  if (!Number.isInteger(billPaise) || billPaise < 0) {
    return res.status(400).json({ error: 'Add items to the order before spinning.' });
  }
  if (phone != null && !isPhone(phone)) {
    return res.status(400).json({ error: 'Enter a 10-digit number.' });
  }
  let username = null;
  if (!phone && rawUsername != null) {
    username = normalizeUsername(rawUsername);
    if (!isValidUsername(username)) return res.status(400).json({ error: 'Invalid username.' });
  }
  const key = customerKey(phone, username);
  if (!key) return res.status(400).json({ error: 'Add the customer’s number or username to spin.' });

  const day = istDay();
  let spin = db.prepare('SELECT * FROM game_spins WHERE customer_key = ? AND spin_day = ?').get(key, day);
  const alreadySpun = !!spin;
  const pool = wheelPool(billPaise);
  if (!spin) {
    const challengeKey = pool[randomInt(pool.length)];
    const id = db
      .prepare(
        'INSERT INTO game_spins (customer_key, spin_day, challenge_key, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(key, day, challengeKey, new Date().toISOString()).lastInsertRowid;
    spin = db.prepare('SELECT * FROM game_spins WHERE id = ?').get(id);
  } else if (!CHALLENGE_KEYS.includes(spin.challenge_key) && spin.order_id == null) {
    // That game was taken off the wheel since this spin; give an unused spin a new slice.
    const challengeKey = pool[randomInt(pool.length)];
    db.prepare('UPDATE game_spins SET challenge_key = ? WHERE id = ?').run(challengeKey, spin.id);
    spin = { ...spin, challenge_key: challengeKey };
  }
  res.json({
    spin_id: spin.id,
    challenge_key: spin.challenge_key,
    slice_index: CHALLENGE_KEYS.indexOf(spin.challenge_key),
    already_spun: alreadySpun,
    already_used: spin.order_id != null,
  });
});

// Does this customer have a banked story reward? Only for the pay screen; it
// returns nothing about the customer beyond that.
router.get('/story-credit', (req, res) => {
  const phone = typeof req.query.phone === 'string' ? req.query.phone : null;
  const username = typeof req.query.username === 'string' ? normalizeUsername(req.query.username) : null;
  let customer = null;
  if (phone && isPhone(phone)) customer = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);
  else if (username && isValidUsername(username)) {
    customer = db.prepare('SELECT id FROM customers WHERE username = ? COLLATE NOCASE').get(username);
  }
  const credit = pendingStoryCredit(db, customer?.id);
  res.json({
    pending: !!credit,
    usable_today: !!credit?.usable_today,
    earned_day: credit?.earned_day ?? null,
  });
});

export default router;
