// Seed menu_items/app_config from data/menu.seed.json and protein brands/
// amount options from data/protein.seed.json.
// Idempotent: upserts rows so re-running updates prices/availability without
// touching orders, customers, or accumulated protein stock.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getDb, setConfig, dbPath } from './lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(__dirname, '../data/menu.seed.json'), 'utf8'));
const proteinSeed = JSON.parse(readFileSync(join(__dirname, '../data/protein.seed.json'), 'utf8'));
const db = getDb();

const upsertItem = db.prepare(`
  INSERT INTO menu_items (id, name, tier, price_paise, sort_order, is_available)
  VALUES (@id, @name, @tier, @price_paise, @sort_order, @is_available)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    tier = excluded.tier,
    price_paise = excluded.price_paise,
    sort_order = excluded.sort_order,
    is_available = excluded.is_available
`);

// Note: stock_mg is deliberately NOT in the UPDATE clause — a re-seed must
// never reset accumulated stock. It's only set on first insert.
const upsertBrand = db.prepare(`
  INSERT INTO protein_brands (id, name, protein_type, stock_mg, low_stock_threshold_mg, is_active, sort_order)
  VALUES (@id, @name, @protein_type, @initial_stock_mg, @low_stock_threshold_mg, 1, @sort_order)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    protein_type = excluded.protein_type,
    low_stock_threshold_mg = excluded.low_stock_threshold_mg,
    sort_order = excluded.sort_order
`);

const upsertAmountOption = db.prepare(`
  INSERT INTO protein_amount_options (grams, powder_mg, price_paise)
  VALUES (@grams, @powder_mg, @price_paise)
  ON CONFLICT(grams) DO UPDATE SET
    powder_mg = excluded.powder_mg,
    price_paise = excluded.price_paise
`);

const run = db.transaction(() => {
  for (const it of seed.items) {
    upsertItem.run({
      id: it.id,
      name: it.name,
      tier: it.tier ?? null,
      price_paise: it.price_paise ?? null,
      sort_order: it.sort_order ?? 0,
      is_available: it.is_available ? 1 : 0,
    });
  }
  for (const [key, value] of Object.entries(seed.config || {})) {
    setConfig(db, key, value);
  }

  for (const b of proteinSeed.brands) {
    upsertBrand.run(b);
  }
  // Log each brand's initial stock in the ledger too, but only on first
  // creation (a brand with zero ledger rows has never been seeded before).
  const ledgerCount = db.prepare('SELECT COUNT(*) AS n FROM protein_stock_ledger WHERE brand_id = ?');
  const insertInitialLedger = db.prepare(
    `INSERT INTO protein_stock_ledger (brand_id, order_id, delta_mg, reason, created_at)
     VALUES (?, NULL, ?, 'restock', ?)`
  );
  const now = new Date().toISOString();
  for (const b of proteinSeed.brands) {
    if (ledgerCount.get(b.id).n === 0 && b.initial_stock_mg > 0) {
      insertInitialLedger.run(b.id, b.initial_stock_mg, now);
    }
  }

  for (const o of proteinSeed.amount_options) {
    upsertAmountOption.run(o);
  }
  if (proteinSeed.default_brand_id) setConfig(db, 'protein.default_brand_id', proteinSeed.default_brand_id);
  if (proteinSeed.default_grams) setConfig(db, 'protein.default_grams', proteinSeed.default_grams);
});
run();

const count = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
const avail = db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE is_available = 1').get().n;
const brandCount = db.prepare('SELECT COUNT(*) AS n FROM protein_brands').get().n;
console.log(`Seeded ${count} menu items (${avail} available) and ${brandCount} protein brands into ${dbPath()}`);
