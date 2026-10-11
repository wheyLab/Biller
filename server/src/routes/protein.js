import { Router } from 'express';
import { getDb } from '../lib/db.js';
import {
  listBrands,
  listAmountOptions,
  listBrandPrices,
  listAddons,
  listMilkOptions,
  defaultSelection,
  PROTEIN_MODE_BY_TIER,
} from '../lib/protein.js';

const router = Router();
const db = getDb();

// Everything the order screen needs to render the protein/add-on/milk
// picker for any item, priced correctly for its tier. Deliberately doesn't
// expose exact stock numbers here (that's back-office-only) — just enough
// to render options and know which are currently choosable.
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
    brand_prices: listBrandPrices(db),
    addons: listAddons(db, { activeOnly: true }),
    milk_options: listMilkOptions(db, { activeOnly: true }),
    mode_by_tier: PROTEIN_MODE_BY_TIER, // e.g. { Originals: 'brand', 'Lab Blend': 'brand', Signature: 'amount' }
    default: defaultSelection(db),
  });
});

export default router;
