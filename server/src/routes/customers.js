import { Router } from 'express';
import { getDb } from '../lib/db.js';
import { loyaltySettings, canRedeem } from '../lib/loyalty.js';
import {
  normalizeUsername,
  isValidUsername,
  usernameAvailable,
  suggestUsernames,
} from '../lib/username.js';

const router = Router();
const db = getDb();

const isPhone = (p) => typeof p === 'string' && /^\d{10}$/.test(p);

function shapeCustomer(row, db) {
  const s = loyaltySettings(db);
  if (!row) {
    return {
      known: false,
      first_name: null,
      username: null,
      points_balance: 0,
      can_redeem: false,
      redeem_threshold: s.redeemThreshold,
    };
  }
  return {
    known: true,
    first_name: row.first_name,
    username: row.username,
    points_balance: row.points_balance,
    can_redeem: canRedeem(row.points_balance, s.redeemThreshold),
    redeem_threshold: s.redeemThreshold,
    eligible_tiers: s.eligibleTiers,
  };
}

// Availability check while staff/customer is typing a handle.
router.get('/username/check/:username', (req, res) => {
  const username = normalizeUsername(req.params.username);
  if (!isValidUsername(username)) {
    return res.json({ available: false, reason: '3-20 characters: letters, numbers, . and _ only.' });
  }
  res.json({ available: usernameAvailable(db, username) });
});

// Instagram-style suggestions derived from the name just typed.
router.get('/username/suggest', (req, res) => {
  const name = String(req.query.name || '');
  res.json({ suggestions: suggestUsernames(db, name) });
});

// Lookup a single customer by phone (10 digits) or username. Returns ONLY that
// customer's first name and points — never any other customer's data (counter-
// visibility rule). An unknown identifier returns a "new customer" shape; the
// record is not created until the order completes.
router.get('/:identifier', (req, res) => {
  const { identifier } = req.params;
  let row;
  if (isPhone(identifier)) {
    row = db.prepare('SELECT * FROM customers WHERE phone = ?').get(identifier);
  } else {
    const username = normalizeUsername(identifier);
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Enter a 10-digit number or a valid username.' });
    }
    row = db.prepare('SELECT * FROM customers WHERE username = ? COLLATE NOCASE').get(username);
  }
  res.json(shapeCustomer(row, db));
});

// Register a new customer up front (number-first or username-first flow). No
// OTP. Upserts by phone so a re-registered number just keeps/sets the name;
// usernames are one-shot (username registration always creates a fresh row).
router.post('/', (req, res) => {
  const { phone, username: rawUsername, first_name } = req.body || {};
  const name = typeof first_name === 'string' ? first_name.trim() : '';

  if (!phone && !rawUsername) {
    return res.status(400).json({ error: 'Enter a mobile number or choose a username.' });
  }
  if (phone && !isPhone(phone)) {
    return res.status(400).json({ error: 'Enter a valid 10-digit number.' });
  }

  let username = null;
  if (rawUsername) {
    username = normalizeUsername(rawUsername);
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: '3-20 characters: letters, numbers, . and _ only.' });
    }
    if (!usernameAvailable(db, username)) {
      return res.status(409).json({ error: 'That username is taken.' });
    }
  }

  const now = new Date().toISOString();
  try {
    if (phone) {
      db.prepare(
        `INSERT INTO customers (phone, username, first_name, created_at, points_balance)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(phone) DO UPDATE SET
           first_name = COALESCE(NULLIF(excluded.first_name, ''), customers.first_name),
           username = COALESCE(customers.username, excluded.username)`
      ).run(phone, username, name || null, now);
      const row = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
      return res.status(201).json(shapeCustomer(row, db));
    }

    db.prepare(
      `INSERT INTO customers (username, first_name, created_at, points_balance)
       VALUES (?, ?, ?, 0)`
    ).run(username, name || null, now);
    const row = db.prepare('SELECT * FROM customers WHERE username = ? COLLATE NOCASE').get(username);
    return res.status(201).json(shapeCustomer(row, db));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That username or number is already registered.' });
    }
    throw err;
  }
});

export default router;
