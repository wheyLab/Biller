// End-to-end API tests. Each run seeds a throwaway SQLite file, starts the real
// server on a free port against it, and drives it over HTTP — so it exercises
// the actual routes, SQL, transactions and seed, and never touches real data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import Database from 'better-sqlite3';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
let dir, dbFile, port, proc, base;

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

async function startServer(file) {
  const env = { ...process.env, WHEYLAB_DB: file, WHEYLAB_SERVER_PORT: String(port) };
  execFileSync(process.execPath, ['src/seed.js'], { cwd: serverDir, env, stdio: 'pipe' });
  proc = spawn(process.execPath, ['src/index.js'], { cwd: serverDir, env, stdio: 'pipe' });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wl-test-'));
  dbFile = join(dir, 'test.sqlite');
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  await startServer(dbFile);
});

after(() => {
  proc?.kill();
  setTimeout(() => rmSync(dir, { recursive: true, force: true }), 300);
});

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}
const get = (p) => api('GET', p);
const post = (p, b) => api('POST', p, b);
const put = (p, b) => api('PUT', p, b);
const order = (items, extra = {}) => post('/api/orders', { items, payment_method: 'cash', ...extra });
const stockOf = async (id) => (await get('/api/admin/stock')).body.brands.find((b) => b.id === id).stock_mg;
const roundHalfUp = Math.round;

// ---------------------------------------------------------------- menu
test('menu: 15 items across the 6 poster categories, all with prices and card details', async () => {
  const { status, body } = await get('/api/menu');
  assert.equal(status, 200);
  assert.equal(body.items.length, 15);
  assert.deepEqual(
    [...new Set(body.items.map((i) => i.tier))].sort(),
    ['Bulk', 'Caffenizer', 'Clear Protein', 'Lab Blend', 'Originals', 'Signature']
  );
  for (const i of body.items) {
    assert.ok(i.price_paise > 0 && i.is_available, i.name);
    assert.ok(i.code && i.macros && i.image, `${i.name} missing card details`);
  }
});

// ------------------------------------------------------------ customers
test('customers: phone register, lookup, and duplicate-safe upsert', async () => {
  assert.equal((await get('/api/customers/9111111111')).body.known, false);
  const c = await post('/api/customers', { phone: '9111111111', first_name: 'Asha' });
  assert.equal(c.status, 201);
  assert.equal(c.body.first_name, 'Asha');
  assert.equal((await get('/api/customers/9111111111')).body.known, true);
  const again = await post('/api/customers', { phone: '9111111111', first_name: 'Someone Else' });
  assert.equal(again.status, 201);
  assert.equal(again.body.first_name, 'Someone Else'); // upsert sets the name; the UI stops this before it gets here
  const db = new Database(dbFile, { readonly: true });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM customers WHERE phone='9111111111'").get().n, 1);
  db.close();
});

test('customers: validation rejects bad input', async () => {
  assert.equal((await post('/api/customers', { first_name: 'x' })).status, 400); // neither phone nor username
  assert.equal((await post('/api/customers', { phone: '12345' })).status, 400);
  assert.equal((await post('/api/customers', { phone: '98765abcde' })).status, 400);
  assert.equal((await post('/api/customers', { username: 'ab' })).status, 400); // too short
  assert.equal((await post('/api/customers', { username: 'has space' })).status, 400);
  assert.equal((await post('/api/customers', { username: '.lead' })).status, 400);
  assert.equal((await post('/api/customers', { username: 'dou..ble' })).status, 400);
  assert.equal((await post('/api/customers', { username: '9876543210' })).status, 400); // ambiguous with a phone
  assert.equal((await get('/api/customers/ab')).status, 400);
});

test('usernames: unique case-insensitively, availability + suggestions', async () => {
  assert.equal((await get('/api/customers/username/check/foo.bar')).body.available, true);
  const c = await post('/api/customers', { username: 'Foo.Bar', first_name: 'Foo' });
  assert.equal(c.status, 201);
  assert.equal(c.body.username, 'foo.bar'); // normalised
  assert.equal((await get('/api/customers/username/check/FOO.BAR')).body.available, false);
  assert.equal((await post('/api/customers', { username: 'foo.BAR' })).status, 409);
  assert.equal((await get('/api/customers/Foo.Bar')).body.known, true); // lookup is case-insensitive
  const bad = (await get('/api/customers/username/check/a')).body;
  assert.equal(bad.available, false);
  assert.ok(bad.reason);

  const s = (await get('/api/customers/username/suggest?name=Foo%20Bar')).body.suggestions;
  assert.ok(s.length >= 3 && s.length <= 4);
  for (const u of s) {
    assert.match(u, /^[a-z0-9._]{3,20}$/);
    assert.equal((await get(`/api/customers/username/check/${u}`)).body.available, true, `${u} should be free`);
  }
  assert.equal(new Set(s).size, s.length);
  const empty = (await get('/api/customers/username/suggest?name=')).body.suggestions;
  assert.ok(empty.length >= 1); // falls back to a generic base
});

test('customers: SQL-injection style input is treated as data', async () => {
  assert.equal((await get(`/api/customers/${encodeURIComponent("1' OR '1'='1")}`)).status, 400);
  assert.equal((await post('/api/customers', { username: "x'); DROP TABLE customers;--" })).status, 400);
  const r = await post('/api/customers', { phone: '9222222222', first_name: "Robert'); DROP TABLE customers;--" });
  assert.equal(r.status, 201);
  assert.ok((await get('/api/admin/customers')).body.customers.length >= 3); // table still there
});

// --------------------------------------------------------------- orders
test('orders: input validation', async () => {
  assert.equal((await post('/api/orders', { items: [], payment_method: 'cash' })).status, 400);
  assert.equal((await post('/api/orders', { payment_method: 'cash' })).status, 400);
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1 }], { payment_method: 'bitcoin' })).status, 400);
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 0 }])).status, 400);
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: -2 }])).status, 400);
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1.5 }])).status, 400);
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 100 }])).status, 400); // over the per-item cap
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1e15 }])).status, 400);
  assert.equal((await order([{ menu_item_id: 'NOPE', quantity: 1 }])).status, 400);
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1 }], { phone: '123' })).status, 400);
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1 }], { username: 'a b' })).status, 400);
});

test('orders: walk-in totals, GST split, default protein, stock deduction', async () => {
  const before = await stockOf('muscleblaze');
  const r = await order([{ menu_item_id: 'WL-17', quantity: 1 }]); // Classic Vanilla ₹99
  assert.equal(r.status, 201);
  assert.equal(r.body.order_number, 1);
  const cgst = roundHalfUp(9900 * 0.025);
  assert.equal(r.body.subtotal_paise, 9900);
  assert.equal(r.body.cgst_paise, cgst);
  assert.equal(r.body.sgst_paise, cgst);
  assert.equal(r.body.total_paise, 9900 + 2 * cgst);
  assert.equal(r.body.points_earned, Math.floor(r.body.total_paise / 1000));
  assert.equal(before - (await stockOf('muscleblaze')), 15000); // default = MuscleBlaze 20g = 15g powder
});

test('orders: explicit protein brand/amount changes price (per the brand board) and deducts that brand by quantity', async () => {
  const gnc = await stockOf('gnc');
  const mb = await stockOf('muscleblaze');
  // WL-17 (Classic Vanilla) is an Originals item: brand-choice mode.
  const r = await order([{ menu_item_id: 'WL-17', quantity: 2, protein_brand_id: 'gnc', protein_grams: 30 }]);
  assert.equal(r.status, 201);
  assert.equal(r.body.subtotal_paise, 2 * (9900 + 11000)); // GNC 30g = +₹110 per unit, per the board
  assert.equal(gnc - (await stockOf('gnc')), 2 * 22500);
  assert.equal(mb, await stockOf('muscleblaze')); // other brands untouched
  const bill = (await get(`/api/orders/${r.body.id}/bill`)).body;
  assert.equal(bill.items[0].name, 'Classic Vanilla — GNC 30g');
  assert.equal(bill.items[0].quantity, 2);
});

test('orders: every amount tier deducts its own powder weight, same across brands', async () => {
  const expected = { 20: 15000, 25: 18750, 30: 22500, 40: 30000 };
  for (const [g, mg] of Object.entries(expected)) {
    const before = await stockOf('on');
    assert.equal((await order([{ menu_item_id: 'WL-18', quantity: 1, protein_brand_id: 'on', protein_grams: Number(g) }])).status, 201);
    assert.equal(before - (await stockOf('on')), mg, `${g}g`);
  }
});

test('protein modes: brand choice on Originals/Lab Blend, amount-only on Signature, none elsewhere', async () => {
  // Signature: amount only, flat board price, no brand in the name, stock still drawn (from the default brand).
  const mb = await stockOf('muscleblaze');
  const sig = await order([{ menu_item_id: 'WL-21', quantity: 1, protein_grams: 30 }]); // Farmers Carry
  assert.equal(sig.status, 201);
  assert.equal(sig.body.subtotal_paise, 24900 + 7000); // Signature 30g flat surcharge, not any brand's price
  assert.equal(mb - (await stockOf('muscleblaze')), 22500);
  assert.equal((await get(`/api/orders/${sig.body.id}/bill`)).body.items[0].name, 'Farmers Carry — 30g protein');
  // a brand sent for a Signature item is simply ignored, not an error
  const sigWithBrand = await order([{ menu_item_id: 'WL-21', quantity: 1, protein_brand_id: 'gnc', protein_grams: 20 }]);
  assert.equal(sigWithBrand.status, 201);
  assert.equal(sigWithBrand.body.subtotal_paise, 24900); // 20g Signature surcharge is ₹0

  // 'none' tiers (Clear Protein, Bulk, Caffenizer): no protein line, no stock drawn, whatever's sent is ignored.
  for (const id of ['WL-19', 'WL-24', 'WL-26']) {
    const before = { mb: await stockOf('muscleblaze'), gnc: await stockOf('gnc') };
    const r = await order([{ menu_item_id: id, quantity: 1, protein_brand_id: 'gnc', protein_grams: 40 }]);
    assert.equal(r.status, 201, id);
    const bill = (await get(`/api/orders/${r.body.id}/bill`)).body;
    assert.ok(!/protein|MuscleBlaze|GNC|ON \(|Super You|Origin/.test(bill.items[0].name), `${id}: ${bill.items[0].name}`);
    assert.equal(await stockOf('muscleblaze'), before.mb, id);
    assert.equal(await stockOf('gnc'), before.gnc, id);
  }
});

test('add-ons: stack freely except creatine on Bulk; milk is single-choice, off on Clear Protein', async () => {
  const withAddons = await order([
    { menu_item_id: 'WL-17', quantity: 1, addon_ids: ['chia', 'seedmix', 'coffeeshot'], milk_id: 'almond' },
  ]);
  assert.equal(withAddons.status, 201);
  assert.equal(withAddons.body.subtotal_paise, 9900 + 2000 + 2000 + 3000 + 6000);
  const bill = (await get(`/api/orders/${withAddons.body.id}/bill`)).body;
  assert.equal(bill.items[0].name, 'Classic Vanilla — MuscleBlaze 20g + Chia seeds, Seed Mix, Coffee Shot (Almond Milk)');

  assert.equal((await order([{ menu_item_id: 'WL-24', quantity: 1, addon_ids: ['creatine'] }])).status, 400); // Bulker Sr is Bulk tier
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1, addon_ids: ['creatine'] }])).status, 201); // fine elsewhere
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1, addon_ids: ['nope'] }])).status, 400);
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1, milk_id: 'nope' }])).status, 400);

  // Clear Protein: milk is ignored, no charge, no name suffix, even if sent.
  const clear = await order([{ menu_item_id: 'WL-19', quantity: 1, milk_id: 'oat' }]);
  assert.equal(clear.status, 201);
  assert.equal(clear.body.subtotal_paise, 19900);
  assert.equal((await get(`/api/orders/${clear.body.id}/bill`)).body.items[0].name, 'Juicy Lychee');

  // default milk (Regular, ₹0) applies when nothing is chosen, on a tier that allows milk.
  const def = await order([{ menu_item_id: 'WL-17', quantity: 1 }]);
  assert.equal(def.body.subtotal_paise, 9900);
});

test('orders: bad protein choice is rejected and burns no order number or stock', async () => {
  const stock = await stockOf('muscleblaze');
  const okBefore = await order([{ menu_item_id: 'WL-17', quantity: 1 }]);
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1, protein_brand_id: 'nope', protein_grams: 20 }])).status, 400);
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1, protein_grams: 35 }])).status, 400);
  // second line invalid: the whole order must fail, including the first (valid) line
  assert.equal(
    (await order([{ menu_item_id: 'WL-17', quantity: 1 }, { menu_item_id: 'WL-18', quantity: 1, protein_brand_id: 'nope' }])).status,
    400
  );
  assert.equal(stock - 15000, await stockOf('muscleblaze')); // only the one good order consumed stock
  const okAfter = await order([{ menu_item_id: 'WL-17', quantity: 1 }]);
  assert.equal(okAfter.body.order_number, okBefore.body.order_number + 1); // gapless
});

test('orders: an inactive brand cannot be chosen; reactivating restores it', async () => {
  assert.equal((await put('/api/admin/stock/origin', { is_active: false })).status, 200);
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1, protein_brand_id: 'origin', protein_grams: 20 }])).status, 400);
  assert.ok(!(await get('/api/protein')).body.brands.some((b) => b.id === 'origin'));
  await put('/api/admin/stock/origin', { is_active: true });
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1, protein_brand_id: 'origin', protein_grams: 20 }])).status, 201);
});

test('orders: an item marked unavailable cannot be sold', async () => {
  assert.equal((await put('/api/admin/menu/WL-20', { is_available: false })).status, 200);
  assert.equal((await order([{ menu_item_id: 'WL-20', quantity: 1 }])).status, 400);
  await put('/api/admin/menu/WL-20', { is_available: true });
  assert.equal((await order([{ menu_item_id: 'WL-20', quantity: 1 }])).status, 201);
});

test('orders: customers earn points by phone and by username; ledger matches balance', async () => {
  const p = await order([{ menu_item_id: 'WL-24', quantity: 1 }], { phone: '9333333333', first_name: 'Ravi' });
  assert.equal(p.status, 201);
  assert.equal(p.body.points_earned, Math.floor(p.body.total_paise / 1000));
  assert.equal((await get('/api/customers/9333333333')).body.points_balance, p.body.points_earned);

  await post('/api/customers', { username: 'shakefan', first_name: 'Sam' });
  const u = await order([{ menu_item_id: 'WL-24', quantity: 1 }], { username: 'ShakeFan' });
  assert.equal(u.status, 201);
  assert.equal((await get('/api/customers/shakefan')).body.points_balance, u.body.points_earned);
  assert.equal((await get('/api/customers/9333333333')).body.points_balance, p.body.points_earned); // not mixed up
});

test('loyalty: redeem needs enough points, an eligible tier, and the item in the order', async () => {
  const phone = '9444444444';
  // no points yet
  await post('/api/customers', { phone, first_name: 'Meera' });
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1 }], { phone, redeem: { menu_item_id: 'WL-17' } })).status, 400);
  // unknown customer can't redeem either
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1 }], { redeem: { menu_item_id: 'WL-17' } })).status, 400);

  for (let i = 0; i < 4; i++) await order([{ menu_item_id: 'WL-24', quantity: 1 }], { phone }); // 4 x ₹418.95 = 164 pts
  const bal = (await get(`/api/customers/${phone}`)).body;
  assert.equal(bal.points_balance, 164);
  assert.equal(bal.can_redeem, true);

  const items = [{ menu_item_id: 'WL-17', quantity: 1 }, { menu_item_id: 'WL-21', quantity: 1 }];
  // Signature tier isn't eligible; item must be in the order
  assert.equal((await order(items, { phone, redeem: { menu_item_id: 'WL-21' } })).status, 400);
  assert.equal((await order(items, { phone, redeem: { menu_item_id: 'WL-30' } })).status, 400);

  const r = await order(items, { phone, redeem: { menu_item_id: 'WL-17' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.points_redeemed, 150);
  assert.equal(r.body.discount_paise, 9900); // one free Classic Vanilla
  assert.equal(r.body.subtotal_paise, 9900 + 24900);
  const net = 24900;
  assert.equal(r.body.total_paise, net + 2 * roundHalfUp(net * 0.025));
  assert.equal((await get(`/api/customers/${phone}`)).body.points_balance, 164 - 150 + r.body.points_earned);
});

test('bill: reconciles GST and 404s for unknown orders', async () => {
  const r = await order([{ menu_item_id: 'WL-22', quantity: 3 }, { menu_item_id: 'WL-26', quantity: 1 }]);
  const b = (await get(`/api/orders/${r.body.id}/bill`)).body;
  assert.equal(b.taxable_paise + b.cgst_paise + b.sgst_paise, b.total_paise);
  assert.equal(b.cgst_paise, b.sgst_paise);
  assert.equal(b.items.reduce((s, i) => s + i.line_total_paise, 0), b.subtotal_paise - 0);
  assert.equal(b.business.name, 'Whey Lab');
  assert.equal((await get('/api/orders/999999/bill')).status, 404);
});

test('payment methods: cash, upi and card are all accepted', async () => {
  for (const m of ['cash', 'upi', 'card']) {
    assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1 }], { payment_method: m })).status, 201, m);
  }
});

// --------------------------------------------------------------- discounts
test('discounts: 10% off and a manual discount are actually applied to the saved order, and stack with redemption', async () => {
  const line = [{ menu_item_id: 'WL-17', quantity: 1 }]; // Classic Vanilla, ₹99

  const ten = await order(line, { ten_percent_off: true });
  assert.equal(ten.status, 201);
  assert.equal(ten.body.discount_paise, 990); // 10% of 9900
  assert.equal(ten.body.subtotal_paise, 9900);
  const netTen = 9900 - 990;
  assert.equal(ten.body.total_paise, netTen + 2 * roundHalfUp(netTen * 0.025));
  const billTen = (await get(`/api/orders/${ten.body.id}/bill`)).body;
  assert.equal(billTen.total_paise, ten.body.total_paise); // reflected on the printed receipt

  const manual = await order(line, { manual_discount_paise: 2000 });
  assert.equal(manual.status, 201);
  assert.equal(manual.body.discount_paise, 2000);
  const netManual = 9900 - 2000;
  assert.equal(manual.body.total_paise, netManual + 2 * roundHalfUp(netManual * 0.025));

  const both = await order(line, { ten_percent_off: true, manual_discount_paise: 1000 });
  assert.equal(both.body.discount_paise, 990 + 1000); // both apply together

  // stacks with a loyalty redemption too
  const phone = '9666666666';
  await post('/api/customers', { phone, first_name: 'Discounty' });
  for (let i = 0; i < 4; i++) await order([{ menu_item_id: 'WL-24', quantity: 1 }], { phone }); // -> 164 pts
  const items = [{ menu_item_id: 'WL-17', quantity: 1 }, { menu_item_id: 'WL-21', quantity: 1 }];
  const stacked = await order(items, { phone, redeem: { menu_item_id: 'WL-17' }, ten_percent_off: true });
  assert.equal(stacked.status, 201);
  const stackedSubtotal = 9900 + 24900;
  assert.equal(stacked.body.discount_paise, 9900 + Math.round(stackedSubtotal * 0.1)); // free item + 10% of the whole subtotal
  assert.equal(stacked.body.points_redeemed, 150);

  // a huge discount is clamped, never a negative total
  const wiped = await order(line, { manual_discount_paise: 999999 });
  assert.equal(wiped.body.discount_paise, 9900);
  assert.equal(wiped.body.total_paise, 0);
});

test('discounts: manual_discount_paise validation', async () => {
  const line = [{ menu_item_id: 'WL-17', quantity: 1 }];
  assert.equal((await order(line, { manual_discount_paise: -100 })).status, 400);
  assert.equal((await order(line, { manual_discount_paise: 10.5 })).status, 400);
  assert.equal((await order(line, { manual_discount_paise: 'a lot' })).status, 400);
  assert.equal((await order(line, {})).status, 201); // absent is fine (no discount)
});

// ---------------------------------------------------------------- admin
test('admin: summary, orders list, customers and per-customer history', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const s = (await get(`/api/admin/summary?date=${today}`)).body;
  const list = (await get('/api/admin/orders')).body.orders;
  assert.equal(s.orders, list.length);
  assert.equal(s.revenue_paise, list.reduce((n, o) => n + o.total_paise, 0));
  assert.equal(s.by_method.reduce((n, m) => n + m.orders, 0), s.orders);
  assert.deepEqual(list.map((o) => o.order_number), [...list.map((o) => o.order_number)].sort((a, b) => b - a)); // newest first

  const customers = (await get('/api/admin/customers')).body.customers;
  const meera = customers.find((c) => c.phone === '9444444444');
  const hist = (await get(`/api/admin/customers/${meera.id}/orders`)).body;
  assert.equal(hist.customer.first_name, 'Meera');
  assert.equal(hist.orders.length, 5); // 4 bulker orders + the redemption order
  assert.ok(hist.orders.every((o) => o.items.length >= 1));
  const other = customers.find((c) => c.phone === '9333333333');
  const otherHist = (await get(`/api/admin/customers/${other.id}/orders`)).body;
  assert.ok(otherHist.orders.every((o) => !hist.orders.some((h) => h.id === o.id))); // histories don't leak
  assert.equal((await get('/api/admin/customers/999999/orders')).status, 404);
});

test('admin: menu price/availability edits validate input', async () => {
  const before = (await get('/api/admin/menu')).body.items.find((i) => i.id === 'WL-18');
  assert.equal((await put('/api/admin/menu/WL-18', { price_paise: -5 })).status, 400);
  assert.equal((await put('/api/admin/menu/WL-18', { price_paise: 10.5 })).status, 400);
  assert.equal((await put('/api/admin/menu/NOPE', { price_paise: 100 })).status, 404);
  assert.equal((await put('/api/admin/menu/WL-18', { price_paise: 10900 })).body.price_paise, 10900);
  const r = await order([{ menu_item_id: 'WL-18', quantity: 1 }]);
  assert.equal(r.body.subtotal_paise, 10900); // new price is used
  await put('/api/admin/menu/WL-18', { price_paise: before.price_paise });
});

test('admin: config read/update', async () => {
  const c = (await get('/api/admin/config')).body.config;
  assert.equal(c['business.name'], 'Whey Lab');
  const u = await put('/api/admin/config', { 'business.name': 'Whey Lab Test' });
  assert.equal(u.body.config['business.name'], 'Whey Lab Test');
  await put('/api/admin/config', { 'business.name': 'Whey Lab' });
});

test('stock: restock, correction, validation, low-stock alert and new brands', async () => {
  const before = await stockOf('superyou');
  assert.equal((await post('/api/admin/stock/superyou/restock', { grams: 250 })).body.stock_mg, before + 250000);
  assert.equal((await post('/api/admin/stock/superyou/restock', { grams: -50 })).body.stock_mg, before + 200000);
  assert.equal((await post('/api/admin/stock/superyou/restock', { grams: 0 })).status, 400);
  assert.equal((await post('/api/admin/stock/superyou/restock', { grams: 'abc' })).status, 400);
  assert.equal((await post('/api/admin/stock/nope/restock', { grams: 10 })).status, 404);

  const today = new Date().toISOString().slice(0, 10);
  assert.ok(!(await get(`/api/admin/summary?date=${today}`)).body.low_stock.some((b) => b.id === 'superyou'));
  await put('/api/admin/stock/superyou', { low_stock_threshold_grams: 999999 }); // threshold above stock
  const alert = (await get(`/api/admin/summary?date=${today}`)).body.low_stock;
  assert.ok(alert.some((b) => b.id === 'superyou'));
  assert.equal((await get('/api/admin/stock')).body.brands.find((b) => b.id === 'superyou').low_stock, true);
  await put('/api/admin/stock/superyou', { low_stock_threshold_grams: 200 });

  // stock is allowed to reach zero/negative: selling is never blocked (alert-only policy)
  await put('/api/admin/stock/superyou', { low_stock_threshold_grams: 1 });
  const drain = await stockOf('superyou');
  await post('/api/admin/stock/superyou/restock', { grams: -(drain / 1000) + 5 }); // leave 5g
  const oversell = await order([{ menu_item_id: 'WL-17', quantity: 1, protein_brand_id: 'superyou', protein_grams: 40 }]);
  assert.equal(oversell.status, 201);
  assert.ok((await stockOf('superyou')) < 0);

  const nb = await post('/api/admin/stock', { id: 'levels', name: 'Levels', protein_type: 'whey' });
  assert.equal(nb.status, 201);
  assert.equal(nb.body.stock_mg, 0);
  assert.equal((await post('/api/admin/stock', { id: 'levels', name: 'X', protein_type: 'whey' })).status, 409);
  assert.equal((await post('/api/admin/stock', { id: 'bad', name: 'X', protein_type: 'soy' })).status, 400);
  assert.equal((await post('/api/admin/stock', { name: 'no id', protein_type: 'whey' })).status, 400);
  assert.ok((await get('/api/protein')).body.brands.some((b) => b.id === 'levels'));
  assert.equal((await get('/api/protein')).body.brands.find((b) => b.id === 'levels').in_stock, false);
});

test('protein pricing: Signature flat-tier and per-brand board prices are both editable and flow into new orders', async () => {
  // Signature's flat per-gram surcharge (no brand choice on this tier).
  assert.equal((await put('/api/admin/protein-options/40', { signature_addon_price_paise: -1 })).status, 400);
  assert.equal((await put('/api/admin/protein-options/45', { signature_addon_price_paise: 100 })).status, 404);
  assert.equal(
    (await put('/api/admin/protein-options/40', { signature_addon_price_paise: 15000 })).body.signature_addon_price_paise,
    15000
  );
  const sig = await order([{ menu_item_id: 'WL-21', quantity: 1, protein_grams: 40 }]); // Farmers Carry, Signature
  assert.equal(sig.body.subtotal_paise, 24900 + 15000);
  await put('/api/admin/protein-options/40', { signature_addon_price_paise: 12500 }); // restore

  // One cell of the per-brand board (Originals/Lab Blend).
  assert.equal((await put('/api/admin/protein-brand-prices/gnc/40', { price_paise: -1 })).status, 400);
  assert.equal((await put('/api/admin/protein-brand-prices/nope/20', { price_paise: 100 })).status, 404);
  assert.equal((await put('/api/admin/protein-brand-prices/gnc/45', { price_paise: 100 })).status, 404);
  assert.equal((await put('/api/admin/protein-brand-prices/gnc/40', { price_paise: 20000 })).body.price_paise, 20000);
  const brand = await order([{ menu_item_id: 'WL-17', quantity: 1, protein_brand_id: 'gnc', protein_grams: 40 }]); // Classic Vanilla, Originals
  assert.equal(brand.body.subtotal_paise, 9900 + 20000);
  await put('/api/admin/protein-brand-prices/gnc/40', { price_paise: 17000 }); // restore
});

test('add-ons and milk options: price edits are visible on /api/protein and can be deactivated', async () => {
  assert.equal((await put('/api/admin/addons/chia', { price_paise: 2500 })).body.price_paise, 2500);
  assert.equal((await get('/api/protein')).body.addons.find((a) => a.id === 'chia').price_paise, 2500);
  assert.equal((await put('/api/admin/addons/chia', { is_active: false })).body.is_active, false);
  assert.ok(!(await get('/api/protein')).body.addons.some((a) => a.id === 'chia')); // hidden once inactive
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1, addon_ids: ['chia'] }])).status, 400); // and unselectable
  await put('/api/admin/addons/chia', { price_paise: 2000, is_active: true }); // restore
  assert.equal((await put('/api/admin/addons/nope', { price_paise: 100 })).status, 404);

  assert.equal((await put('/api/admin/milk-options/oat', { price_paise: 7000 })).body.price_paise, 7000);
  const r = await order([{ menu_item_id: 'WL-17', quantity: 1, milk_id: 'oat' }]);
  assert.equal(r.body.subtotal_paise, 9900 + 7000);
  await put('/api/admin/milk-options/oat', { price_paise: 6000 }); // restore
});

// ------------------------------------------------------------ invariants
test('invariants: ledgers reconcile with cached balances, order numbers are gapless, totals add up', async () => {
  const db = new Database(dbFile, { readonly: true });
  for (const b of db.prepare('SELECT id, stock_mg FROM protein_brands').all()) {
    const sum = db.prepare('SELECT COALESCE(SUM(delta_mg),0) s FROM protein_stock_ledger WHERE brand_id=?').get(b.id).s;
    assert.equal(b.stock_mg, sum, `stock ledger for ${b.id}`);
  }
  for (const c of db.prepare('SELECT id, points_balance FROM customers').all()) {
    const sum = db.prepare('SELECT COALESCE(SUM(delta),0) s FROM loyalty_ledger WHERE customer_id=?').get(c.id).s;
    assert.equal(c.points_balance, sum, `points ledger for customer ${c.id}`);
  }
  const nums = db.prepare('SELECT order_number n FROM orders ORDER BY order_number').all().map((r) => r.n);
  assert.deepEqual(nums, nums.map((_, i) => i + 1));
  for (const o of db.prepare('SELECT * FROM orders').all()) {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
    assert.equal(items.reduce((s, i) => s + i.unit_price_paise_snapshot * i.quantity, 0), o.subtotal_paise, `order ${o.order_number} subtotal`);
    assert.equal(o.subtotal_paise - o.discount_paise + o.tax_paise, o.total_paise, `order ${o.order_number} total`);
    for (const i of items) {
      // 'none'-tier items (Clear Protein, Bulk, Caffenizer) legitimately have
      // no protein line at all; everything else must have one.
      if (i.protein_brand_id) {
        assert.ok(i.protein_grams && i.protein_powder_mg_snapshot > 0, `order item ${i.id}`);
      } else {
        assert.ok(!i.protein_grams && !i.protein_powder_mg_snapshot, `order item ${i.id} should have no protein line`);
      }
    }
  }
  // every order-driven stock movement is backed by an order line
  const deducted = db.prepare("SELECT COALESCE(-SUM(delta_mg),0) s FROM protein_stock_ledger WHERE reason='order'").get().s;
  const lines = db.prepare('SELECT COALESCE(SUM(protein_powder_mg_snapshot*quantity),0) s FROM order_items').get().s;
  assert.equal(deducted, lines);
  db.close();
});

// ------------------------------------------------------------------ seed
test('seed: re-running keeps stock and customers, and removes menu items no longer in the file', async () => {
  const db = new Database(dbFile);
  db.prepare("INSERT INTO menu_items (id,name,tier,price_paise,sort_order,is_available) VALUES ('WL-OLD','Old Placeholder','Originals',100,99,1)").run();
  const stockBefore = await stockOf('gnc');
  const customersBefore = db.prepare('SELECT COUNT(*) n FROM customers').get().n;
  execFileSync(process.execPath, ['src/seed.js'], {
    cwd: serverDir,
    env: { ...process.env, WHEYLAB_DB: dbFile },
    stdio: 'pipe',
  });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM menu_items WHERE id='WL-OLD'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM menu_items').get().n, 15);
  assert.equal(await stockOf('gnc'), stockBefore);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customers').get().n, customersBefore);
  db.close();
});

// ------------------------------------------------------------ hardening
test('errors: malformed / oversized requests get plain JSON, never a stack trace or file path', async () => {
  const bad = await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  assert.equal(bad.status, 400);
  assert.match(bad.headers.get('content-type'), /json/);
  const txt = await bad.text();
  assert.ok(!/node_modules|\.js|SyntaxError|at /.test(txt), txt);

  const big = await fetch(`${base}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x: 'a'.repeat(200000) }),
  });
  assert.equal(big.status, 413);
  assert.match(big.headers.get('content-type'), /json/);

  // a body that isn't JSON at all is a clean 400, not a crash
  const plain = await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello' });
  assert.equal(plain.status, 400);
  assert.equal((await get('/api/health')).status, 200); // server still up
});

test('orders: the largest allowed quantity (99) is accepted', async () => {
  const r = await order([{ menu_item_id: 'WL-17', quantity: 99 }]);
  assert.equal(r.status, 201);
  assert.equal(r.body.subtotal_paise, 99 * 9900);
});

// ------------------------------------------------------------- migration
// The database as it was before protein stock and the menu-card fields existed
// (username-era schema). Starting the server against it must upgrade it in place.
const LEGACY_SCHEMA = `
CREATE TABLE menu_items (id TEXT PRIMARY KEY, name TEXT NOT NULL, tier TEXT, price_paise INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0, is_available INTEGER NOT NULL DEFAULT 0);
CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, username TEXT UNIQUE COLLATE NOCASE,
  first_name TEXT, created_at TEXT NOT NULL, points_balance INTEGER NOT NULL DEFAULT 0,
  CHECK (phone IS NOT NULL OR username IS NOT NULL));
CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_number INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id), subtotal_paise INTEGER NOT NULL, discount_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL, total_paise INTEGER NOT NULL, payment_method TEXT NOT NULL, points_earned INTEGER NOT NULL DEFAULT 0,
  points_redeemed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
  menu_item_id TEXT NOT NULL, name_snapshot TEXT NOT NULL, unit_price_paise_snapshot INTEGER NOT NULL, quantity INTEGER NOT NULL);
CREATE TABLE loyalty_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_id INTEGER REFERENCES orders(id), delta INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO customers (phone, first_name, created_at, points_balance) VALUES ('9555555555','Legacy','2026-09-01T00:00:00Z',15);
INSERT INTO orders (order_number, created_at, customer_id, subtotal_paise, tax_paise, total_paise, payment_method, points_earned)
  VALUES (1,'2026-09-01T00:00:00Z',1,14900,746,15646,'cash',15);
INSERT INTO order_items (order_id, menu_item_id, name_snapshot, unit_price_paise_snapshot, quantity) VALUES (1,'WL-01','Old Shake',14900,1);
INSERT INTO loyalty_ledger (customer_id, order_id, delta, reason, created_at) VALUES (1,1,15,'earn','2026-09-01T00:00:00Z');
INSERT INTO counters VALUES ('order_number', 1);
`;

test('migration: a database from before protein stock / menu-card fields upgrades in place without losing data', async () => {
  const file = join(dir, 'legacy.sqlite');
  const seedDb = new Database(file);
  seedDb.exec(LEGACY_SCHEMA);
  seedDb.close();

  const port2 = await freePort();
  const env = { ...process.env, WHEYLAB_DB: file, WHEYLAB_SERVER_PORT: String(port2) };
  execFileSync(process.execPath, ['src/seed.js'], { cwd: serverDir, env, stdio: 'pipe' });
  const p2 = spawn(process.execPath, ['src/index.js'], { cwd: serverDir, env, stdio: 'pipe' });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try { up = (await fetch(`http://127.0.0.1:${port2}/api/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    assert.ok(up, 'server starts on the old database');
    const res = await fetch(`http://127.0.0.1:${port2}/api/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ menu_item_id: 'WL-17', quantity: 1 }], payment_method: 'cash', phone: '9555555555' }),
    });
    assert.equal(res.status, 201);
    const db = new Database(file, { readonly: true });
    const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    assert.ok(['protein_brand_id', 'protein_grams', 'protein_powder_mg_snapshot', 'protein_addon_price_paise_snapshot'].every((c) => cols('order_items').includes(c)));
    assert.ok(['code', 'badge', 'macros', 'image'].every((c) => cols('menu_items').includes(c)));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 2); // old order kept, new one added
    assert.equal(db.prepare("SELECT name_snapshot FROM order_items WHERE order_id=1").get().name_snapshot, 'Old Shake');
    assert.equal(db.prepare("SELECT order_number FROM orders ORDER BY id DESC LIMIT 1").get().order_number, 2); // counter continued
    const c = db.prepare("SELECT points_balance FROM customers WHERE phone='9555555555'").get();
    assert.equal(c.points_balance, 15 + Math.floor(10396 / 1000));
    db.close();
  } finally {
    p2.kill();
  }
});

// ------------------------------------------------------- spin the wheel
// Spins as a customer, then forces the slice so each reward can be tested.
async function spinAs(phone, challengeKey) {
  const r = await post('/api/game/spin', { phone });
  assert.equal(r.status, 200);
  const db = new Database(dbFile);
  db.prepare('UPDATE game_spins SET challenge_key = ? WHERE id = ?').run(challengeKey, r.body.spin_id);
  db.close();
  return r.body.spin_id;
}

test('wheel: needs a customer, and re-spinning the same day returns the same slice', async () => {
  assert.equal((await post('/api/game/spin', {})).status, 400);
  assert.equal((await post('/api/game/spin', { phone: '123' })).status, 400);
  const a = await post('/api/game/spin', { phone: '9300000001' });
  assert.equal(a.status, 200);
  assert.equal(a.body.already_spun, false);
  assert.ok(a.body.slice_index >= 0 && a.body.slice_index < 7);
  const b = await post('/api/game/spin', { phone: '9300000001' });
  assert.equal(b.body.already_spun, true);
  assert.equal(b.body.spin_id, a.body.spin_id);
  assert.equal(b.body.challenge_key, a.body.challenge_key);
  const u = await post('/api/game/spin', { username: 'Wheel.Fan' });
  assert.equal(u.status, 200);
});

test('wheel: a flat reward applies once, only for the customer who spun', async () => {
  const spin = await spinAs('9300000002', 'bottleFlip');
  const items = [{ menu_item_id: 'WL-21', quantity: 1 }];
  assert.equal((await order(items, { phone: '9300000003', game: { spin_id: spin } })).status, 400);
  const r = await order(items, { phone: '9300000002', game: { spin_id: spin } });
  assert.equal(r.status, 201);
  assert.equal(r.body.discount_paise, 3000);
  assert.equal(r.body.taxable_paise, 24900 - 3000);
  assert.deepEqual(r.body.reward_notes, ['Wheel: bottle flip']);
  assert.deepEqual((await get(`/api/orders/${r.body.id}/bill`)).body.reward_notes, ['Wheel: bottle flip']);
  const again = await order(items, { phone: '9300000002', game: { spin_id: spin } });
  assert.equal(again.status, 400);
});

test('offers: pushups need a Signature and cap at ₹100, and show on the bill', async () => {
  assert.equal((await order([{ menu_item_id: 'WL-17', quantity: 1 }], { offers: { pushups: 20 } })).status, 400);
  assert.equal((await order([{ menu_item_id: 'WL-21', quantity: 1 }], { offers: { pushups: 0 } })).status, 400);
  const capped = await order([{ menu_item_id: 'WL-21', quantity: 1 }], { offers: { pushups: 250 } });
  assert.equal(capped.status, 201);
  assert.equal(capped.body.discount_paise, 10000);
  const p = await order([{ menu_item_id: 'WL-21', quantity: 1 }], { offers: { pushups: 42 } });
  assert.equal(p.status, 201);
  assert.equal(p.body.discount_paise, 4200);
  assert.deepEqual((await get(`/api/orders/${p.body.id}/bill`)).body.reward_notes, ['Pushup challenge: 42 pushups']);
});

test('story: a confirmed story banks 10% off the next visit, usable only on a later day, once', async () => {
  const phone = '9300000020';
  const items = [{ menu_item_id: 'WL-21', quantity: 1 }];
  assert.equal((await order(items, { story_tag: true })).status, 400); // walk-in: nobody to bank it for
  const first = await order(items, { phone, story_tag: true });
  assert.equal(first.status, 201);
  assert.equal(first.body.discount_paise, 0); // nothing off today
  assert.deepEqual(first.body.reward_notes, ['Story tag confirmed: 10% off next visit']);
  let c = (await get(`/api/game/story-credit?phone=${phone}`)).body;
  assert.deepEqual(c, { pending: true, usable_today: false, earned_day: c.earned_day });
  assert.equal((await order(items, { phone, use_story_credit: true })).status, 400); // same day
  const again = await order(items, { phone, story_tag: true }); // no stacking
  assert.deepEqual(again.body.reward_notes, ['Story tag confirmed (reward already waiting)']);

  // Pretend the reward was earned yesterday.
  const db = new Database(dbFile);
  db.prepare("UPDATE story_credits SET earned_day = '2000-01-01' WHERE used_order_id IS NULL").run();
  db.close();
  assert.equal((await get(`/api/game/story-credit?phone=${phone}`)).body.usable_today, true);
  const next = await order(items, { phone, use_story_credit: true, story_tag: true });
  assert.equal(next.status, 201);
  assert.equal(next.body.discount_paise, Math.round(24900 * 0.1));
  assert.deepEqual(next.body.reward_notes, ['Story reward: 10% off', 'Story tag confirmed: 10% off next visit']);
  c = (await get(`/api/game/story-credit?phone=${phone}`)).body;
  assert.equal(c.pending, true); // the new one from this visit
  assert.equal(c.usable_today, false);
  assert.equal((await order(items, { phone, use_story_credit: true })).status, 400); // old one is spent
});

test('wheel: weight guess is 20% off, reaction ₹20, quiz ₹30; offers stack with the wheel', async () => {
  const w = await spinAs('9300000007', 'weightGuess');
  const r = await order([{ menu_item_id: 'WL-21', quantity: 2 }], { phone: '9300000007', game: { spin_id: w }, offers: { pushups: 30 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.discount_paise, Math.round(49800 * 0.2) + 3000);
  assert.deepEqual(r.body.reward_notes, ['Wheel: weight guess 20% off', 'Pushup challenge: 30 pushups']);
  const re = await spinAs('9300000008', 'reaction');
  assert.equal((await order([{ menu_item_id: 'WL-21', quantity: 1 }], { phone: '9300000008', game: { spin_id: re } })).body.discount_paise, 2000);
  const q = await spinAs('9300000009', 'proteinQuiz');
  assert.equal((await order([{ menu_item_id: 'WL-21', quantity: 1 }], { phone: '9300000009', game: { spin_id: q } })).body.discount_paise, 3000);
});

test('wheel: an unused spin on a game since removed from the wheel gets a new slice', async () => {
  const id = await spinAs('9300000010', 'grip');
  const again = await post('/api/game/spin', { phone: '9300000010' });
  assert.equal(again.body.spin_id, id);
  assert.notEqual(again.body.challenge_key, 'grip');
  assert.ok(again.body.slice_index >= 0);
});

test('wheel: plank makes the dearest add-on free; ₹555 combo frees the cheapest Originals', async () => {
  const plank = await spinAs('9300000005', 'plank');
  assert.equal((await order([{ menu_item_id: 'WL-21', quantity: 1 }], { phone: '9300000005', game: { spin_id: plank } })).status, 400);
  const p = await order(
    [{ menu_item_id: 'WL-21', quantity: 1, addon_ids: ['chia', 'coffeeshot'] }],
    { phone: '9300000005', game: { spin_id: plank } }
  );
  assert.equal(p.status, 201);
  assert.equal(p.body.discount_paise, 3000);

  const combo = await spinAs('9300000006', 'originals555');
  assert.equal(
    (await order([{ menu_item_id: 'WL-17', quantity: 1 }, { menu_item_id: 'WL-21', quantity: 1 }], { phone: '9300000006', game: { spin_id: combo } })).status,
    400
  );
  const c = await order(
    [{ menu_item_id: 'WL-17', quantity: 1 }, { menu_item_id: 'WL-24', quantity: 1 }, { menu_item_id: 'WL-25', quantity: 1 }],
    { phone: '9300000006', game: { spin_id: combo } }
  );
  assert.equal(c.status, 201);
  assert.equal(c.body.discount_paise, 9900);
});
