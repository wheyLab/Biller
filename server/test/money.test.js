import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { splitExclusive, computeOrderTotals } from '../src/lib/money.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(__dirname, '../data/menu.seed.json'), 'utf8'));

test('taxable + cgst + sgst == total for every seeded price', () => {
  const prices = seed.items
    .map((i) => i.price_paise)
    .filter((p) => Number.isInteger(p) && p > 0);
  assert.ok(prices.length > 0, 'expected at least one priced item');
  for (const p of prices) {
    const r = splitExclusive(p);
    assert.equal(r.taxable_paise + r.cgst_paise + r.sgst_paise, r.total_paise, `mismatch at ${p}`);
    assert.equal(r.cgst_paise, r.sgst_paise, `cgst != sgst at ${p}`);
    assert.equal(r.taxable_paise, p, `taxable should equal the listed price at ${p}`);
  }
});

test('known value: 14900 exclusive adds 373 + 373 to reach 15646', () => {
  const r = splitExclusive(14900);
  assert.deepEqual(r, {
    taxable_paise: 14900,
    cgst_paise: 373,
    sgst_paise: 373,
    tax_paise: 746,
    total_paise: 15646,
  });
});

test('exhaustive: parts always sum to total for 0..30000 paise', () => {
  for (let p = 0; p <= 30000; p++) {
    const r = splitExclusive(p);
    assert.equal(r.taxable_paise + r.cgst_paise + r.sgst_paise, r.total_paise);
    assert.equal(r.cgst_paise, r.sgst_paise);
  }
});

test('order totals apply discount before tax, tax added on top', () => {
  const lines = [
    { unit_price_paise: 14900, quantity: 2 },
    { unit_price_paise: 17900, quantity: 1 },
  ];
  const t = computeOrderTotals(lines, 14900); // one free Daily shake redeemed
  assert.equal(t.subtotal_paise, 47700);
  assert.equal(t.discount_paise, 14900);
  assert.equal(t.taxable_paise, 32800);
  assert.equal(t.tax_paise, 1640);
  assert.equal(t.total_paise, 34440);
  assert.equal(t.taxable_paise + t.cgst_paise + t.sgst_paise, t.total_paise);
});

test('discount cannot exceed subtotal', () => {
  const t = computeOrderTotals([{ unit_price_paise: 11900, quantity: 1 }], 99999);
  assert.equal(t.discount_paise, 11900);
  assert.equal(t.taxable_paise, 0);
  assert.equal(t.total_paise, 0);
});
