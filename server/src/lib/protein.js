// Protein brand stock. The ledger (protein_stock_ledger) is the source of
// truth, exactly like loyalty_ledger for points; stock_mg on protein_brands
// is a cache recomputed from it. Mirrors lib/loyalty.js and lib/db.js's
// counters pattern.
import { getConfig } from './db.js';

// Per the shop's "Blend Your Protein" board: brand choice is offered on
// Originals, Lab Blend and Caffenizer (so coffee drinkers can pick yeast or
// plant protein). Signature gets a protein amount but no brand pick (a flat
// per-gram surcharge instead — protein_amount_options.signature_addon_price_paise).
// Every other tier (Clear Protein, Bulk) has no protein picker at all — its
// price and recipe are fixed as listed.
export const PROTEIN_MODE_BY_TIER = { Originals: 'brand', 'Lab Blend': 'brand', Caffenizer: 'brand', Signature: 'amount' };
export function proteinModeForTier(tier) {
  return PROTEIN_MODE_BY_TIER[tier] || 'none';
}

export function listBrands(db, { activeOnly = false } = {}) {
  const sql = activeOnly
    ? 'SELECT * FROM protein_brands WHERE is_active = 1 ORDER BY sort_order, id'
    : 'SELECT * FROM protein_brands ORDER BY sort_order, id';
  return db.prepare(sql).all().map((r) => ({ ...r, is_active: !!r.is_active }));
}

export function getBrand(db, id) {
  const row = db.prepare('SELECT * FROM protein_brands WHERE id = ?').get(id);
  return row ? { ...row, is_active: !!row.is_active } : null;
}

export function listAmountOptions(db) {
  return db.prepare('SELECT grams, powder_mg, signature_addon_price_paise FROM protein_amount_options ORDER BY grams').all();
}

export function getAmountOption(db, grams) {
  return db.prepare('SELECT grams, powder_mg, signature_addon_price_paise FROM protein_amount_options WHERE grams = ?').get(grams) || null;
}

// The full brand x grams matrix (used by the order screen to price every
// combination, and by admin to edit it).
export function listBrandPrices(db) {
  return db.prepare('SELECT brand_id, grams, price_paise FROM protein_brand_prices ORDER BY brand_id, grams').all();
}

export function getBrandPrice(db, brandId, grams) {
  const row = db.prepare('SELECT price_paise FROM protein_brand_prices WHERE brand_id = ? AND grams = ?').get(brandId, grams);
  return row ? row.price_paise : null;
}

export function setBrandPrice(db, brandId, grams, pricePaise) {
  db.prepare(
    `INSERT INTO protein_brand_prices (brand_id, grams, price_paise) VALUES (?, ?, ?)
     ON CONFLICT(brand_id, grams) DO UPDATE SET price_paise = excluded.price_paise`
  ).run(brandId, grams, pricePaise);
}

export function listAddons(db, { activeOnly = false } = {}) {
  const sql = activeOnly
    ? 'SELECT * FROM addon_options WHERE is_active = 1 ORDER BY sort_order, id'
    : 'SELECT * FROM addon_options ORDER BY sort_order, id';
  return db.prepare(sql).all().map((r) => ({ ...r, is_active: !!r.is_active }));
}

export function getAddon(db, id) {
  const row = db.prepare('SELECT * FROM addon_options WHERE id = ?').get(id);
  return row ? { ...row, is_active: !!row.is_active } : null;
}

export function listMilkOptions(db, { activeOnly = false } = {}) {
  const sql = activeOnly
    ? 'SELECT * FROM milk_options WHERE is_active = 1 ORDER BY sort_order, id'
    : 'SELECT * FROM milk_options ORDER BY sort_order, id';
  return db.prepare(sql).all().map((r) => ({ ...r, is_active: !!r.is_active }));
}

export function getMilkOption(db, id) {
  const row = db.prepare('SELECT * FROM milk_options WHERE id = ?').get(id);
  return row ? { ...row, is_active: !!row.is_active } : null;
}

export function defaultSelection(db) {
  return {
    brandId: getConfig(db, 'protein.default_brand_id', 'muscleblaze'),
    grams: Number(getConfig(db, 'protein.default_grams', 20)),
    milkId: getConfig(db, 'protein.default_milk_id', 'regular'),
  };
}

function recompute(db, brandId) {
  const bal = db
    .prepare('SELECT COALESCE(SUM(delta_mg),0) AS b FROM protein_stock_ledger WHERE brand_id = ?')
    .get(brandId).b;
  db.prepare('UPDATE protein_brands SET stock_mg = ? WHERE id = ?').run(bal, brandId);
  return bal;
}

// Deduct powder for a completed order line. Call inside the same transaction
// as the order insert so a crash can't consume stock without a saved order.
export function deductForOrder(db, brandId, mg, orderId, now) {
  db.prepare(
    'INSERT INTO protein_stock_ledger (brand_id, order_id, delta_mg, reason, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(brandId, orderId, -mg, 'order', now);
  return recompute(db, brandId);
}

// Admin restock (positive) or manual correction (any sign).
export function adjustStock(db, brandId, deltaMg, reason, now) {
  db.prepare(
    'INSERT INTO protein_stock_ledger (brand_id, order_id, delta_mg, reason, created_at) VALUES (?, NULL, ?, ?, ?)'
  ).run(brandId, deltaMg, reason, now);
  return recompute(db, brandId);
}

export function recomputeStock(db, brandId) {
  return recompute(db, brandId);
}

export function lowStockBrands(db) {
  return db
    .prepare(
      `SELECT * FROM protein_brands
       WHERE is_active = 1 AND stock_mg < low_stock_threshold_mg
       ORDER BY (stock_mg * 1.0 / NULLIF(low_stock_threshold_mg, 0)) ASC`
    )
    .all();
}
