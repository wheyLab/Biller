import { Router } from 'express';
import { getDb } from '../lib/db.js';
import { listBrands, listAmountOptions, defaultSelection } from '../lib/protein.js';

const router = Router();
const db = getDb();

// What the order screen needs to offer the brand/amount picker. Deliberately
// doesn't expose exact stock numbers here (that's back-office-only) — just
// enough to render options and know which are currently choosable.
router.get('/', (_req, res) => {
  const brands = listBrands(db, { activeOnly: true }).map((b) => ({
    id: b.id,
    name: b.name,
    protein_type: b.protein_type,
    in_stock: b.stock_mg > 0,
  }));
  res.json({
    brands,
    amount_options: listAmountOptions(db),
    default: defaultSelection(db),
  });
});

export default router;
