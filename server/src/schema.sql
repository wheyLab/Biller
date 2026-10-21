-- Whey Lab billing schema. All money is stored in paise as integers. Never floats.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS menu_items (
  id           TEXT PRIMARY KEY,          -- e.g. WL-01
  name         TEXT NOT NULL,
  tier         TEXT,                       -- Originals | Clear Protein | Signature | Bulk | Caffenizer | Lab Blend
  price_paise  INTEGER,                    -- nullable while a price is unresolved
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 0, -- boolean 0/1
  code         TEXT,                       -- periodic-table style symbol on the menu card, e.g. 'Cv'
  badge        INTEGER,                    -- small number on the card: kcal (caffeine mg for Caffenizer)
  macros       TEXT,                       -- display line, e.g. '340 kcal · 3.6g fat · 23.4g PRO'
  image        TEXT                        -- photo path under the client's public/, e.g. '/menu/WL-17.webp'
);

CREATE TABLE IF NOT EXISTS customers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  phone          TEXT UNIQUE,              -- 10 digits, optional
  username       TEXT UNIQUE COLLATE NOCASE, -- Instagram-style handle, optional
  first_name     TEXT,
  created_at     TEXT NOT NULL,
  points_balance INTEGER NOT NULL DEFAULT 0, -- cached sum of loyalty_ledger.delta
  CHECK (phone IS NOT NULL OR username IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number    INTEGER NOT NULL UNIQUE, -- sequential, gapless, never resets
  created_at      TEXT NOT NULL,
  customer_id     INTEGER REFERENCES customers(id),
  subtotal_paise  INTEGER NOT NULL,
  discount_paise  INTEGER NOT NULL DEFAULT 0,
  tax_paise       INTEGER NOT NULL,        -- cgst + sgst
  total_paise     INTEGER NOT NULL,
  -- 'complimentary' = nothing to pay (influencer coupon made every drink free).
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('cash','upi','card','complimentary')),
  points_earned   INTEGER NOT NULL DEFAULT 0,
  points_redeemed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_items (
  id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id                            INTEGER NOT NULL REFERENCES orders(id),
  menu_item_id                        TEXT NOT NULL,
  name_snapshot                       TEXT NOT NULL,
  unit_price_paise_snapshot           INTEGER NOT NULL, -- item + protein + add-ons + milk, all in
  quantity                            INTEGER NOT NULL CHECK (quantity > 0),
  protein_brand_id                    TEXT REFERENCES protein_brands(id), -- null: this tier has no protein choice
  protein_grams                       INTEGER,           -- 20 | 25 | 30 | 40 (marketed protein grams)
  protein_powder_mg_snapshot          INTEGER,           -- actual powder deducted from stock, in mg
  protein_addon_price_paise_snapshot  INTEGER NOT NULL DEFAULT 0,
  milk_option_id                      TEXT REFERENCES milk_options(id),
  milk_name_snapshot                  TEXT,
  milk_price_paise_snapshot           INTEGER NOT NULL DEFAULT 0
);

-- Chia seeds, seed mix, coffee shot, creatine — flat-price checkboxes, any
-- combination, available on every item except where excluded in code
-- (creatine isn't offered on the Bulk tier).
CREATE TABLE IF NOT EXISTS addon_options (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price_paise INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

-- One order_items row can have several add-ons; this is the join, with a
-- snapshot so a later price change doesn't alter a past receipt.
CREATE TABLE IF NOT EXISTS order_item_addons (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id         INTEGER NOT NULL REFERENCES order_items(id),
  addon_id              TEXT NOT NULL REFERENCES addon_options(id),
  name_snapshot         TEXT NOT NULL,
  price_paise_snapshot  INTEGER NOT NULL
);

-- Regular / oat / almond — single-select, not offered on Clear Protein (no
-- milk in that recipe at all).
CREATE TABLE IF NOT EXISTS milk_options (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  price_paise INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1
);

-- Protein brands staff stock and choose from at checkout. stock_mg is a cache
-- of SUM(protein_stock_ledger.delta_mg); the ledger is the source of truth.
CREATE TABLE IF NOT EXISTS protein_brands (
  id                        TEXT PRIMARY KEY,     -- e.g. 'muscleblaze'
  name                      TEXT NOT NULL,
  protein_type              TEXT NOT NULL CHECK (protein_type IN ('whey','yeast','plant')),
  stock_mg                  INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold_mg    INTEGER NOT NULL DEFAULT 200000, -- 200g default
  is_active                 INTEGER NOT NULL DEFAULT 1,
  sort_order                INTEGER NOT NULL DEFAULT 0
);

-- The 20/25/30/40g protein tiers a customer can pick. powder_mg is how much
-- powder that tier actually consumes (protein powder isn't 100% protein by
-- weight) — the same across brands, per the shop's own conversion.
-- signature_addon_price_paise is the flat per-gram surcharge for the
-- Signature tier, which doesn't offer a brand choice (see protein_brand_prices
-- for the Originals/Lab Blend per-brand schedule). price_paise is unused —
-- kept only so an old row shape doesn't need a destructive migration.
CREATE TABLE IF NOT EXISTS protein_amount_options (
  grams                       INTEGER PRIMARY KEY,   -- marketed protein grams: 20 | 25 | 30 | 40
  powder_mg                   INTEGER NOT NULL,
  price_paise                 INTEGER NOT NULL DEFAULT 0, -- deprecated, unused
  signature_addon_price_paise INTEGER NOT NULL DEFAULT 0
);

-- Per-brand, per-gram add-on price (Originals & Lab Blend tiers only — the
-- shop's "Blend Your Protein" board). MuscleBlaze at 20g is the baseline
-- (₹0): it's already the menu-listed price of every drink.
CREATE TABLE IF NOT EXISTS protein_brand_prices (
  brand_id     TEXT NOT NULL REFERENCES protein_brands(id),
  grams        INTEGER NOT NULL REFERENCES protein_amount_options(grams),
  price_paise  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (brand_id, grams)
);

-- Append-only stock movement log (order deductions, restocks, manual
-- adjustments) — mirrors loyalty_ledger. stock_mg on protein_brands is a
-- cache recomputed from this.
CREATE TABLE IF NOT EXISTS protein_stock_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id    TEXT NOT NULL REFERENCES protein_brands(id),
  order_id    INTEGER REFERENCES orders(id),
  delta_mg    INTEGER NOT NULL,      -- negative = consumed, positive = restocked
  reason      TEXT NOT NULL,        -- 'order' | 'restock' | 'adjust'
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_id    INTEGER REFERENCES orders(id),
  delta       INTEGER NOT NULL,             -- signed
  reason      TEXT NOT NULL,               -- 'earn' | 'redeem' | 'adjust'
  created_at  TEXT NOT NULL
);

-- Tunable configuration lives in the DB, not in code.
CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Monotonic counter for gapless order numbers, survives restarts.
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Spin-the-wheel counter game: one spin per customer per IST day. The slice
-- is picked server-side; order_id is set when the reward is used on an order.
CREATE TABLE IF NOT EXISTS game_spins (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_key   TEXT NOT NULL,             -- 'p:<phone>' or 'u:<username>'
  spin_day       TEXT NOT NULL,             -- YYYY-MM-DD in IST
  challenge_key  TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  order_id       INTEGER REFERENCES orders(id),
  reward_note    TEXT,
  discount_paise INTEGER NOT NULL DEFAULT 0,
  UNIQUE (customer_key, spin_day)
);

CREATE INDEX IF NOT EXISTS idx_game_spins_order ON game_spins(order_id);

-- Always-on challenge offers applied to an order (pushups, Instagram story tag),
-- kept so the bill can say why it was discounted.
CREATE TABLE IF NOT EXISTS order_offers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL REFERENCES orders(id),
  kind           TEXT NOT NULL,             -- 'pushups' | 'story_tag' | 'story_reward' | 'influencer'
  note           TEXT NOT NULL,
  discount_paise INTEGER NOT NULL,
  ref            TEXT                       -- influencer: their Instagram handle
);

CREATE INDEX IF NOT EXISTS idx_order_offers_order ON order_offers(order_id);

-- Story challenge: a confirmed Instagram story banks one reward (10% off) for
-- the customer's NEXT visit on a later IST day. One unused reward at a time.
CREATE TABLE IF NOT EXISTS story_credits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  earned_order_id INTEGER NOT NULL REFERENCES orders(id),
  earned_day      TEXT NOT NULL,            -- YYYY-MM-DD in IST
  created_at      TEXT NOT NULL,
  used_order_id   INTEGER REFERENCES orders(id),
  used_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_story_credits_customer ON story_credits(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_ledger_customer ON loyalty_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
