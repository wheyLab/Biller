-- Whey Lab billing schema. All money is stored in paise as integers. Never floats.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS menu_items (
  id           TEXT PRIMARY KEY,          -- e.g. WL-01
  name         TEXT NOT NULL,
  tier         TEXT,                       -- Caffeinated | Originals | Daily | Signature | Clear Whey
  price_paise  INTEGER,                    -- nullable while a price is unresolved
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 0  -- boolean 0/1
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
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('cash','upi','card')),
  points_earned   INTEGER NOT NULL DEFAULT 0,
  points_redeemed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_items (
  id                                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id                            INTEGER NOT NULL REFERENCES orders(id),
  menu_item_id                        TEXT NOT NULL,
  name_snapshot                       TEXT NOT NULL,
  unit_price_paise_snapshot           INTEGER NOT NULL, -- includes the protein add-on price
  quantity                            INTEGER NOT NULL CHECK (quantity > 0),
  protein_brand_id                    TEXT REFERENCES protein_brands(id),
  protein_grams                       INTEGER,           -- 20 | 30 | 40 | 50 (marketed protein grams)
  protein_powder_mg_snapshot          INTEGER,           -- actual powder deducted from stock, in mg
  protein_addon_price_paise_snapshot  INTEGER NOT NULL DEFAULT 0
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

-- The 20/30/40/50g protein tiers a customer can pick. powder_mg is how much
-- powder that tier actually consumes (protein powder isn't 100% protein by
-- weight); price is a placeholder until real pricing is decided.
CREATE TABLE IF NOT EXISTS protein_amount_options (
  grams        INTEGER PRIMARY KEY,   -- marketed protein grams: 20 | 30 | 40 | 50
  powder_mg    INTEGER NOT NULL,
  price_paise  INTEGER NOT NULL DEFAULT 0
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

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_ledger_customer ON loyalty_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
