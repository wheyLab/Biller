import { Router } from 'express';
import { getDb } from '../lib/db.js';

const router = Router();
const db = getDb();

function mapItem(r) {
  return {
    id: r.id,
    name: r.name,
    tier: r.tier,
    price_paise: r.price_paise,
    sort_order: r.sort_order,
    is_available: !!r.is_available,
  };
}

// Billing screen menu: every item (so sold-out items can render with a
// strike-through), ordered by tier then sort_order.
router.get('/', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM menu_items ORDER BY sort_order')
    .all()
    .map(mapItem);
  res.json({ items: rows });
});

export default router;
