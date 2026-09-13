import { Router } from 'express';
import { getDb, allConfig, setConfig } from '../lib/db.js';
import { listBrands, getBrand, adjustStock, lowStockBrands, listAmountOptions } from '../lib/protein.js';

const router = Router();
const db = getDb();

// All back-office data lives here. This router is mounted at /api/admin and the
// admin UI is a separate route never linked from the billing screen.

// Day summary: revenue, order count, takings by payment method for a given date
// (defaults to today, local ISO date yyyy-mm-dd).
router.get('/summary', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const like = `${date}%`;
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total_paise),0) AS revenue_paise,
              COALESCE(SUM(discount_paise),0) AS discount_paise,
              COALESCE(SUM(tax_paise),0) AS tax_paise
       FROM orders WHERE created_at LIKE ?`
    )
    .get(like);
  const byMethod = db
    .prepare(
      `SELECT payment_method, COUNT(*) AS orders, COALESCE(SUM(total_paise),0) AS revenue_paise
       FROM orders WHERE created_at LIKE ? GROUP BY payment_method`
    )
    .all(like);
  // Surfaced here too (not just the Stock tab) so a low brand is seen the
  // moment admin opens the back office, before it actually runs out.
  const lowStock = lowStockBrands(db).map((b) => ({ id: b.id, name: b.name, stock_mg: b.stock_mg }));
  res.json({ date, ...totals, by_method: byMethod, low_stock: lowStock });
});

// Order history (most recent first), lightweight list.
router.get('/orders', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = db
    .prepare(
      `SELECT o.id, o.order_number, o.created_at, c.phone AS customer_phone,
              c.username AS customer_username, o.total_paise,
              o.payment_method, o.points_earned, o.points_redeemed
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       ORDER BY o.order_number DESC LIMIT ?`
    )
    .all(limit);
  res.json({ orders: rows });
});

router.get('/customers', (_req, res) => {
  const rows = db
    .prepare('SELECT id, phone, username, first_name, points_balance, created_at FROM customers ORDER BY created_at DESC')
    .all();
  res.json({ customers: rows });
});

// One customer's order history, most recent first, with line items so staff
// can see exactly what each past order contained (not just the total).
router.get('/customers/:id/orders', (req, res) => {
  const id = Number(req.params.id);
  const customer = db
    .prepare('SELECT id, phone, username, first_name, points_balance, created_at FROM customers WHERE id = ?')
    .get(id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  const orders = db
    .prepare(
      `SELECT id, order_number, created_at, subtotal_paise, discount_paise, tax_paise,
              total_paise, payment_method, points_earned, points_redeemed
       FROM orders WHERE customer_id = ? ORDER BY order_number DESC`
    )
    .all(id);

  const itemsByOrder = db.prepare(
    'SELECT order_id, name_snapshot, unit_price_paise_snapshot, quantity FROM order_items WHERE order_id = ?'
  );
  const withItems = orders.map((o) => ({ ...o, items: itemsByOrder.all(o.id) }));

  res.json({ customer, orders: withItems });
});

router.get('/menu', (_req, res) => {
  const rows = db.prepare('SELECT * FROM menu_items ORDER BY sort_order').all();
  res.json({ items: rows.map((r) => ({ ...r, is_available: !!r.is_available })) });
});

// Edit a menu item: price, availability, name, tier, sort order.
router.put('/menu/:id', (req, res) => {
  const { name, tier, price_paise, sort_order, is_available } = req.body || {};
  const existing = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  if (price_paise != null && (!Number.isInteger(price_paise) || price_paise < 0)) {
    return res.status(400).json({ error: 'Price must be a whole number of paise.' });
  }
  db.prepare(
    `UPDATE menu_items SET name = ?, tier = ?, price_paise = ?, sort_order = ?, is_available = ?
     WHERE id = ?`
  ).run(
    name ?? existing.name,
    tier ?? existing.tier,
    price_paise === undefined ? existing.price_paise : price_paise,
    sort_order ?? existing.sort_order,
    is_available === undefined ? existing.is_available : is_available ? 1 : 0,
    req.params.id
  );
  const updated = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  res.json({ ...updated, is_available: !!updated.is_available });
});

router.get('/config', (_req, res) => {
  res.json({ config: allConfig(db) });
});

router.put('/config', (req, res) => {
  const updates = req.body || {};
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(updates)) setConfig(db, k, v);
  });
  tx();
  res.json({ config: allConfig(db) });
});

// Protein brand stock, for the admin Stock tab.
router.get('/stock', (_req, res) => {
  const brands = listBrands(db).map((b) => ({ ...b, low_stock: b.stock_mg < b.low_stock_threshold_mg }));
  res.json({ brands, amount_options: listAmountOptions(db) });
});

// Create a new protein brand.
router.post('/stock', (req, res) => {
  const { id, name, protein_type, low_stock_threshold_grams, sort_order } = req.body || {};
  if (!id || !name || !['whey', 'yeast', 'plant'].includes(protein_type)) {
    return res.status(400).json({ error: 'id, name and a valid protein_type (whey/yeast/plant) are required.' });
  }
  if (getBrand(db, id)) return res.status(409).json({ error: 'A brand with that id already exists.' });
  db.prepare(
    `INSERT INTO protein_brands (id, name, protein_type, stock_mg, low_stock_threshold_mg, is_active, sort_order)
     VALUES (?, ?, ?, 0, ?, 1, ?)`
  ).run(id, name, protein_type, Math.round((low_stock_threshold_grams ?? 200) * 1000), sort_order ?? 0);
  res.status(201).json(getBrand(db, id));
});

// Edit a brand's name, threshold, active flag, or sort order (not stock —
// use /restock for that, so every stock change is logged in the ledger).
router.put('/stock/:id', (req, res) => {
  const existing = getBrand(db, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Brand not found.' });
  const { name, low_stock_threshold_grams, is_active, sort_order } = req.body || {};
  db.prepare(
    `UPDATE protein_brands SET name = ?, low_stock_threshold_mg = ?, is_active = ?, sort_order = ? WHERE id = ?`
  ).run(
    name ?? existing.name,
    low_stock_threshold_grams != null ? Math.round(low_stock_threshold_grams * 1000) : existing.low_stock_threshold_mg,
    is_active === undefined ? (existing.is_active ? 1 : 0) : is_active ? 1 : 0,
    sort_order ?? existing.sort_order,
    req.params.id
  );
  res.json(getBrand(db, req.params.id));
});

// Restock: add (or, with a negative value, correct downward) grams of powder.
// Always ledgered, never a direct stock_mg write, so history stays honest.
router.post('/stock/:id/restock', (req, res) => {
  const existing = getBrand(db, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Brand not found.' });
  const grams = Number(req.body?.grams);
  if (!Number.isFinite(grams) || grams === 0) {
    return res.status(400).json({ error: 'Enter a non-zero number of grams.' });
  }
  const stock_mg = adjustStock(db, req.params.id, Math.round(grams * 1000), 'restock', new Date().toISOString());
  res.json({ ...getBrand(db, req.params.id), stock_mg });
});

// Edit a protein amount tier's price (dummy pricing until real prices are set).
router.put('/protein-options/:grams', (req, res) => {
  const grams = Number(req.params.grams);
  const existing = db.prepare('SELECT * FROM protein_amount_options WHERE grams = ?').get(grams);
  if (!existing) return res.status(404).json({ error: 'Amount tier not found.' });
  const { price_paise } = req.body || {};
  if (price_paise != null && (!Number.isInteger(price_paise) || price_paise < 0)) {
    return res.status(400).json({ error: 'Price must be a whole number of paise.' });
  }
  db.prepare('UPDATE protein_amount_options SET price_paise = ? WHERE grams = ?').run(
    price_paise ?? existing.price_paise,
    grams
  );
  res.json(db.prepare('SELECT * FROM protein_amount_options WHERE grams = ?').get(grams));
});

// Recompute a customer's cached points balance from the ledger (source of truth).
router.post('/customers/:id/recompute', (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare('SELECT id FROM customers WHERE id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Customer not found.' });
  const bal = db
    .prepare('SELECT COALESCE(SUM(delta),0) AS b FROM loyalty_ledger WHERE customer_id = ?')
    .get(id).b;
  db.prepare('UPDATE customers SET points_balance = ? WHERE id = ?').run(bal, id);
  res.json({ id, points_balance: bal });
});

export default router;
