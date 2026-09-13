// Client-side mirror of the server GST math for live ticket display only.
// The server remains the source of truth when the order is committed.
// Menu prices are GST-EXCLUSIVE: tax is added on top of the listed price.
const HALF_RATE = 0.025;

export function splitExclusive(taxablePaise: number) {
  const cgst = Math.round(taxablePaise * HALF_RATE);
  const sgst = cgst;
  return {
    taxable_paise: taxablePaise,
    cgst_paise: cgst,
    sgst_paise: sgst,
    tax_paise: cgst + sgst,
    total_paise: taxablePaise + cgst + sgst,
  };
}

export function orderTotals(subtotal: number, discount = 0) {
  const d = Math.min(Math.max(discount, 0), subtotal);
  const net = subtotal - d;
  const s = splitExclusive(net);
  return { subtotal_paise: subtotal, discount_paise: d, ...s };
}
