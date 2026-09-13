// Money math for Whey Lab. Everything is integer paise. No floats for stored money.
//
// GST: 5% restaurant service, split 2.5% CGST + 2.5% SGST, no ITC.
// Menu prices are GST-EXCLUSIVE (a listed 149 shake is the pre-tax base; GST is
// added on top, so the customer pays 149 + 5%).
//
// Strategy: treat the listed price as the taxable value, derive equal CGST/SGST
// components on top of it, and add them to reach the total.

const GST_RATE_BPS = 500; // 5.00%
const HALF_RATE = 0.025;  // 2.5% each for CGST and SGST

/**
 * Add GST on top of a taxable (pre-tax) paise amount.
 * @param {number} taxablePaise integer paise, GST-exclusive
 * @returns {{taxable_paise:number, cgst_paise:number, sgst_paise:number, tax_paise:number, total_paise:number}}
 */
export function splitExclusive(taxablePaise) {
  if (!Number.isInteger(taxablePaise) || taxablePaise < 0) {
    throw new Error('taxablePaise must be a non-negative integer');
  }
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

/**
 * Compute order totals from line items and an optional discount.
 * The discount is applied to the taxable (pre-tax) subtotal; GST is then added
 * on top of the discounted taxable value.
 * @param {{unit_price_paise:number, quantity:number}[]} lines
 * @param {number} discountPaise pre-tax discount (e.g. redeemed free shake value)
 */
export function computeOrderTotals(lines, discountPaise = 0) {
  const subtotal = lines.reduce((sum, l) => sum + l.unit_price_paise * l.quantity, 0);
  const discount = Math.min(Math.max(discountPaise, 0), subtotal);
  const netTaxable = subtotal - discount;
  const { taxable_paise, cgst_paise, sgst_paise, tax_paise, total_paise } = splitExclusive(netTaxable);
  return {
    subtotal_paise: subtotal,
    discount_paise: discount,
    taxable_paise,
    cgst_paise,
    sgst_paise,
    tax_paise,
    total_paise,
  };
}

export function paiseToRupees(paise) {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return sign + '₹' + (abs / 100).toFixed(2);
}

export { GST_RATE_BPS };
