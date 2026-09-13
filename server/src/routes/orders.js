import { Router } from 'express';
import { getDb, nextOrderNumber, allConfig } from '../lib/db.js';
import { computeOrderTotals, splitExclusive } from '../lib/money.js';
import { loyaltySettings, pointsEarned, canRedeem, isRedeemable } from '../lib/loyalty.js';
import { normalizeUsername, isValidUsername } from '../lib/username.js';
import { getBrand, getAmountOption, deductForOrder, defaultSelection } from '../lib/protein.js';

const router = Router();
const db = getDb();

const isPhone = (p) => /^\d{10}$/.test(p);
const PAYMENTS = new Set(['cash', 'upi', 'card']);

// Create an order. Everything below runs in a single transaction so a crash
// mid-order leaves earlier completed orders intact and burns no order number.
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const { items, payment_method, phone, username: rawUsername, first_name, redeem } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Add at least one item.' });
    }
    if (!PAYMENTS.has(payment_method)) {
      return res.status(400).json({ error: 'Choose a payment method.' });
    }
    if (phone != null && !isPhone(phone)) {
      return res.status(400).json({ error: 'Enter a 10-digit number.' });
    }
    let username = null;
    if (rawUsername != null) {
      username = normalizeUsername(rawUsername);
      if (!isValidUsername(username)) {
        return res.status(400).json({ error: 'Invalid username.' });
      }
    }

    // Snapshot menu items now; historical bills must not move when prices change.
    const getItem = db.prepare('SELECT * FROM menu_items WHERE id = ?');
    const def = defaultSelection(db);
    const lines = [];
    for (const li of items) {
      const qty = Number(li.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Invalid quantity.' });
      }
      const mi = getItem.get(li.menu_item_id);
      if (!mi || !mi.is_available || mi.price_paise == null) {
        return res.status(400).json({ error: 'That item is not available.' });
      }

      // Protein choice: an unspecified brand/amount falls back to the
      // configured default rather than skipping the add-on — every smoothie
      // gets a protein selection one way or another.
      const brandId = li.protein_brand_id || def.brandId;
      const grams = li.protein_grams != null ? Number(li.protein_grams) : def.grams;
      const brand = getBrand(db, brandId);
      if (!brand || !brand.is_active) {
        return res.status(400).json({ error: 'Choose a valid protein brand.' });
      }
      const amountOption = getAmountOption(db, grams);
      if (!amountOption) {
        return res.status(400).json({ error: 'Choose a valid protein amount.' });
      }

      lines.push({
        menu_item_id: mi.id,
        name_snapshot: `${mi.name} — ${brand.name} ${grams}g`,
        unit_price_paise: mi.price_paise + amountOption.price_paise,
        tier: mi.tier,
        quantity: qty,
        protein_brand_id: brand.id,
        protein_grams: grams,
        protein_powder_mg: amountOption.powder_mg,
        protein_addon_price_paise: amountOption.price_paise,
      });
    }

    const s = loyaltySettings(db);

    // Resolve redemption (optional). One free shake of an eligible tier.
    let discountPaise = 0;
    let pointsRedeemed = 0;
    let customer = null;
    if (phone) {
      customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
    } else if (username) {
      customer = db.prepare('SELECT * FROM customers WHERE username = ? COLLATE NOCASE').get(username);
    }
    if (redeem && redeem.menu_item_id) {
      if (!customer || !canRedeem(customer.points_balance, s.redeemThreshold)) {
        return res.status(400).json({ error: 'Not enough points to redeem.' });
      }
      const target = lines.find((l) => l.menu_item_id === redeem.menu_item_id);
      if (!target) {
        return res.status(400).json({ error: 'Redeemed item is not in the order.' });
      }
      if (!isRedeemable(target.tier, s.eligibleTiers)) {
        return res.status(400).json({ error: 'That item is not eligible for redemption.' });
      }
      discountPaise = target.unit_price_paise; // one free unit
      pointsRedeemed = s.redeemThreshold;
    }

    const totals = computeOrderTotals(
      lines.map((l) => ({ unit_price_paise: l.unit_price_paise, quantity: l.quantity })),
      discountPaise
    );
    const earned = pointsEarned(totals.total_paise, s.earnPaisePerPoint);
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      const orderNumber = nextOrderNumber(db);

      // Upsert customer only at completion (never on lookup).
      let customerId = customer ? customer.id : null;
      if (!customerId && phone) {
        db.prepare(
          `INSERT INTO customers (phone, first_name, created_at, points_balance)
           VALUES (?, ?, ?, 0)
           ON CONFLICT(phone) DO UPDATE SET
             first_name = COALESCE(customers.first_name, excluded.first_name)`
        ).run(phone, first_name || null, now);
        customerId = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone).id;
      } else if (!customerId && username) {
        db.prepare(
          `INSERT INTO customers (username, first_name, created_at, points_balance)
           VALUES (?, ?, ?, 0)`
        ).run(username, first_name || null, now);
        customerId = db.prepare('SELECT id FROM customers WHERE username = ? COLLATE NOCASE').get(username).id;
      }

      const orderId = db
        .prepare(
          `INSERT INTO orders
            (order_number, created_at, customer_id, subtotal_paise, discount_paise,
             tax_paise, total_paise, payment_method, points_earned, points_redeemed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          orderNumber, now, customerId, totals.subtotal_paise, totals.discount_paise,
          totals.tax_paise, totals.total_paise, payment_method, earned, pointsRedeemed
        ).lastInsertRowid;

      const insItem = db.prepare(
        `INSERT INTO order_items
          (order_id, menu_item_id, name_snapshot, unit_price_paise_snapshot, quantity,
           protein_brand_id, protein_grams, protein_powder_mg_snapshot, protein_addon_price_paise_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const l of lines) {
        insItem.run(
          orderId, l.menu_item_id, l.name_snapshot, l.unit_price_paise, l.quantity,
          l.protein_brand_id, l.protein_grams, l.protein_powder_mg, l.protein_addon_price_paise
        );
        deductForOrder(db, l.protein_brand_id, l.protein_powder_mg * l.quantity, orderId, now);
      }

      // Loyalty ledger is the source of truth; balance cache is derived from it.
      if (customerId) {
        const insLedger = db.prepare(
          `INSERT INTO loyalty_ledger (customer_id, order_id, delta, reason, created_at)
           VALUES (?, ?, ?, ?, ?)`
        );
        if (pointsRedeemed > 0) insLedger.run(customerId, orderId, -pointsRedeemed, 'redeem', now);
        if (earned > 0) insLedger.run(customerId, orderId, earned, 'earn', now);
        const bal = db
          .prepare('SELECT COALESCE(SUM(delta),0) AS b FROM loyalty_ledger WHERE customer_id = ?')
          .get(customerId).b;
        db.prepare('UPDATE customers SET points_balance = ? WHERE id = ?').run(bal, customerId);
      }

      return { orderId, orderNumber };
    });

    const { orderId, orderNumber } = tx();
    res.status(201).json({ id: orderId, order_number: orderNumber, ...totals, points_earned: earned, points_redeemed: pointsRedeemed });
  } catch (err) {
    // Plain sentence only. Never expose SQL, paths, or stack traces on the counter.
    console.error('order create failed:', err);
    res.status(500).json({ error: 'Could not save the order. Try again.' });
  }
});

// Digital bill for a completed order. GST is re-derived from the stored
// pre-tax taxable value so it always reconciles.
router.get('/:id/bill', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const split = splitExclusive(order.subtotal_paise - order.discount_paise);
  const cfg = allConfig(db);
  res.json({
    order_number: order.order_number,
    created_at: order.created_at,
    business: {
      name: cfg['business.name'],
      address: cfg['business.address'],
      gstin: cfg['business.gstin'],
    },
    items: items.map((i) => ({
      name: i.name_snapshot,
      quantity: i.quantity,
      unit_price_paise: i.unit_price_paise_snapshot,
      line_total_paise: i.unit_price_paise_snapshot * i.quantity,
    })),
    subtotal_paise: order.subtotal_paise,
    discount_paise: order.discount_paise,
    taxable_paise: split.taxable_paise,
    cgst_paise: split.cgst_paise,
    sgst_paise: split.sgst_paise,
    total_paise: order.total_paise,
    payment_method: order.payment_method,
    points_earned: order.points_earned,
    points_redeemed: order.points_redeemed,
  });
});

export default router;
