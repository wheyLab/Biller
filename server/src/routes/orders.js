import { Router } from 'express';
import { getDb, nextOrderNumber, allConfig } from '../lib/db.js';
import { computeOrderTotals, splitExclusive } from '../lib/money.js';
import { loyaltySettings, pointsEarned, canRedeem, isRedeemable } from '../lib/loyalty.js';
import { normalizeUsername, isValidUsername } from '../lib/username.js';
import {
  getBrand,
  getAmountOption,
  getBrandPrice,
  getAddon,
  getMilkOption,
  deductForOrder,
  defaultSelection,
  proteinModeForTier,
} from '../lib/protein.js';

const router = Router();
const db = getDb();

const isPhone = (p) => /^\d{10}$/.test(p);
const PAYMENTS = new Set(['cash', 'upi', 'card']);
const MAX_QTY_PER_ITEM = 99; // a fat-finger / bad-request guard, far above any real order
const MAX_ADDONS_PER_LINE = 10; // a bad-request guard; the real menu only has 4

// Create an order. Everything below runs in a single transaction so a crash
// mid-order leaves earlier completed orders intact and burns no order number.
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const { items, payment_method, phone, username: rawUsername, first_name, redeem, ten_percent_off, manual_discount_paise } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Add at least one item.' });
    }
    if (!PAYMENTS.has(payment_method)) {
      return res.status(400).json({ error: 'Choose a payment method.' });
    }
    if (manual_discount_paise != null && (!Number.isInteger(manual_discount_paise) || manual_discount_paise < 0)) {
      return res.status(400).json({ error: 'Invalid discount.' });
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
      if (qty > MAX_QTY_PER_ITEM) {
        return res.status(400).json({ error: `Quantity too large (max ${MAX_QTY_PER_ITEM} per item).` });
      }
      const mi = getItem.get(li.menu_item_id);
      if (!mi || !mi.is_available || mi.price_paise == null) {
        return res.status(400).json({ error: 'That item is not available.' });
      }

      // Protein choice depends on the item's tier — see PROTEIN_MODE_BY_TIER.
      // 'brand': Originals & Lab Blend, customer picks brand + amount, priced
      //   from the per-brand board (MuscleBlaze 20g = the listed price, ₹0 add-on).
      // 'amount': Signature — amount only, flat per-gram surcharge, no brand
      //   pick; stock is still drawn from the default brand under the hood.
      // 'none': everything else — fixed recipe, no protein line at all.
      const mode = proteinModeForTier(mi.tier);
      let proteinBrandId = null;
      let proteinGrams = null;
      let proteinPowderMg = 0;
      let proteinAddonPaise = 0;
      let nameSuffix = '';

      if (mode === 'brand') {
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
        const addon = getBrandPrice(db, brandId, grams);
        if (addon == null) {
          return res.status(400).json({ error: 'That brand and amount combination is not priced.' });
        }
        proteinBrandId = brand.id;
        proteinGrams = grams;
        proteinPowderMg = amountOption.powder_mg;
        proteinAddonPaise = addon;
        nameSuffix += ` — ${brand.name} ${grams}g`;
      } else if (mode === 'amount') {
        const grams = li.protein_grams != null ? Number(li.protein_grams) : def.grams;
        const amountOption = getAmountOption(db, grams);
        if (!amountOption) {
          return res.status(400).json({ error: 'Choose a valid protein amount.' });
        }
        proteinBrandId = def.brandId; // no customer-facing brand choice on Signature
        proteinGrams = grams;
        proteinPowderMg = amountOption.powder_mg;
        proteinAddonPaise = amountOption.signature_addon_price_paise;
        nameSuffix += ` — ${grams}g protein`;
      }
      // mode === 'none': proteinBrandId stays null, no addon, no stock drawn.

      // Add-ons: any combination of the flat-price checkboxes, except
      // creatine isn't offered on the Bulk tier.
      const addonIds = Array.isArray(li.addon_ids) ? li.addon_ids : [];
      if (addonIds.length > MAX_ADDONS_PER_LINE) {
        return res.status(400).json({ error: 'Too many add-ons.' });
      }
      const addons = [];
      for (const id of addonIds) {
        const a = getAddon(db, id);
        if (!a || !a.is_active) return res.status(400).json({ error: 'Choose a valid add-on.' });
        if (a.id === 'creatine' && mi.tier === 'Bulk') {
          return res.status(400).json({ error: 'Creatine is not available on the Bulk series.' });
        }
        addons.push(a);
      }
      const addonsPaise = addons.reduce((s, a) => s + a.price_paise, 0);
      if (addons.length) nameSuffix += ` + ${addons.map((a) => a.name).join(', ')}`;

      // Milk: single choice, not offered on Clear Protein (no milk in that
      // recipe). An unspecified choice elsewhere defaults to Regular (₹0),
      // same "always resolved" philosophy as the protein default.
      let milk = null;
      if (mi.tier !== 'Clear Protein') {
        const milkId = li.milk_id || def.milkId;
        milk = getMilkOption(db, milkId);
        if (!milk || !milk.is_active) {
          return res.status(400).json({ error: 'Choose a valid milk option.' });
        }
        if (milk.price_paise > 0) nameSuffix += ` (${milk.name})`;
      }

      lines.push({
        menu_item_id: mi.id,
        name_snapshot: `${mi.name}${nameSuffix}`,
        unit_price_paise: mi.price_paise + proteinAddonPaise + addonsPaise + (milk?.price_paise || 0),
        tier: mi.tier,
        quantity: qty,
        protein_brand_id: proteinBrandId,
        protein_grams: proteinGrams,
        protein_powder_mg: proteinPowderMg,
        protein_addon_price_paise: proteinAddonPaise,
        addons,
        milk,
      });
    }

    const s = loyaltySettings(db);
    const subtotalPaise = lines.reduce((sum, l) => sum + l.unit_price_paise * l.quantity, 0);

    // Resolve redemption (optional). One free shake of an eligible tier.
    let discountPaise = 0;
    let pointsRedeemed = 0;
    // Flat/percentage discounts stack with redemption; computeOrderTotals()
    // below clamps the combined total so it can never take the order negative.
    if (manual_discount_paise) discountPaise += manual_discount_paise;
    if (ten_percent_off) discountPaise += Math.round(subtotalPaise * 0.1);
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
      discountPaise += target.unit_price_paise; // one free unit, on top of any other discount
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
           protein_brand_id, protein_grams, protein_powder_mg_snapshot, protein_addon_price_paise_snapshot,
           milk_option_id, milk_name_snapshot, milk_price_paise_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insAddon = db.prepare(
        `INSERT INTO order_item_addons (order_item_id, addon_id, name_snapshot, price_paise_snapshot)
         VALUES (?, ?, ?, ?)`
      );
      for (const l of lines) {
        const orderItemId = insItem.run(
          orderId, l.menu_item_id, l.name_snapshot, l.unit_price_paise, l.quantity,
          l.protein_brand_id, l.protein_grams, l.protein_powder_mg, l.protein_addon_price_paise,
          l.milk?.id ?? null, l.milk?.name ?? null, l.milk?.price_paise ?? 0
        ).lastInsertRowid;
        for (const a of l.addons) {
          insAddon.run(orderItemId, a.id, a.name, a.price_paise);
        }
        // 'none'-mode items (Clear Protein, Bulk, Caffenizer) have no brand and draw no stock.
        if (l.protein_brand_id) {
          deductForOrder(db, l.protein_brand_id, l.protein_powder_mg * l.quantity, orderId, now);
        }
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
