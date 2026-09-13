# Whey Lab Billing App — Context Handoff

Single-screen counter billing app for **Whey Lab**, a protein-shake kiosk in
Tavarekere, Madiwala, Bengaluru. Runs offline on one laptop behind the counter,
bound to `127.0.0.1`. The laptop mirrors to an LED screen the customer reads, so
**every data/UI decision assumes the customer sees the screen.** No cloud, no
hosting, no auth on the billing screen.

Status: **scaffolded and working.** `npm run dev` runs; money tests pass 5/5;
order/GST/loyalty/admin flows smoke-tested.

## Stack
- Server: Node.js + Express (ESM), single process, `better-sqlite3` (WAL), bound
  to `127.0.0.1:4173`.
- Client: React 19 + Vite 6 + Tailwind v4. Fonts bundled via `@fontsource`
  (Anton / Inter / JetBrains Mono) — no CDN, works offline.
- State: one small store (`useSyncExternalStore`) for the ticket; component state
  for the rest. No Redux.
- Monorepo: `server/` + `client/`, root scripts orchestrate via `npm --prefix`
  and `concurrently`.

## Run
```bash
npm install      # root + server + client (postinstall)
npm run seed     # load menu + config into the DB
npm run dev      # server :4173, client :5173 (open http://127.0.0.1:5173)
# prod single bundle: npm run build && npm start  -> http://127.0.0.1:4173
```
Admin (never linked, type it): http://127.0.0.1:5173/admin
DEV MUST open :5173, NOT :4173 (4173 = API + built bundle only).

## Layout
```
wheylab-biller/
  package.json                 root scripts (dev/build/seed/test/export-db)
  README.md  CONTEXT.md
  server/
    src/index.js               Express; serves client/dist in prod; SPA fallback for /admin
    src/lib/money.js           GST math, integer paise (see below)
    src/lib/db.js              SQLite open/migrate, config get/set, nextOrderNumber
    src/lib/loyalty.js         earn/redeem rules read from app_config
    src/routes/menu.js         GET /api/menu
    src/routes/customers.js    GET /api/customers/:phone (privacy-limited)
    src/routes/orders.js       POST /api/orders (atomic), GET /api/orders/:id/bill
    src/routes/admin.js        summary/orders/customers/menu/config
    src/seed.js  src/export-db.js  schema.sql
    data/menu.seed.json        source of truth for menu + config (NOT hardcoded)
    test/money.test.js
  client/
    src/App.tsx                path-based: /admin -> AdminApp else BillingApp
    src/api.ts  src/money.ts    (money.ts mirrors server split for live display)
    src/store/ticket.ts        the one small store
    src/components/            BillingApp, MenuGrid, TicketRail, BillModal, AdminApp, Wordmark
```

## Money & GST (critical)
- All money is **integer paise**. Never floats anywhere.
- Menu prices are **GST-inclusive**. 5% GST = 2.5% CGST + 2.5% SGST, shown
  separately. `splitInclusive(total)`:
  `taxable = round(total/1.05)`, `cgst = sgst = round(taxable*0.025)`,
  then `taxable = total - cgst - sgst` so `taxable + cgst + sgst == total`
  exactly, always, and cgst == sgst. Verified exhaustively 0..30000 paise.
- Loyalty discount applies to the taxable/net BEFORE tax is derived:
  `computeOrderTotals(lines, discountPaise)` discounts the inclusive net, then
  re-derives tax from it.
- Bills carry: invoice no., GSTIN, name/address, datetime, line items+qty,
  taxable value, CGST, SGST, total.

## Data model (5 tables + config/counters)
- `menu_items(id 'WL-01', name, tier, price_paise, sort_order, is_available)`
- `customers(phone PK 10-digit, first_name, created_at, points_balance)` — balance is a CACHED sum of the ledger.
- `orders(id, order_number seq/gapless, created_at, customer_phone, subtotal_paise, discount_paise, tax_paise, total_paise, payment_method cash|upi|card, points_earned, points_redeemed)`
- `order_items(id, order_id, menu_item_id, name_snapshot, unit_price_paise_snapshot, quantity)` — name+price SNAPSHOTTED at sale time.
- `loyalty_ledger(id, phone, order_id, delta signed, reason, created_at)` — SOURCE OF TRUTH; balance is recomputable.
- `app_config(key,value)` loyalty/GST/business tunables. `counters(name,value)` gapless order number.
- Order creation = ONE transaction: orders + N order_items + ledger rows + balance update. Crash mid-order loses only the in-progress order; earlier orders intact; no order number burned.
- DB lives OUTSIDE the repo at `~/.wheylab/wheylab.sqlite` (override `WHEYLAB_DB`).

## API
- `GET  /api/menu` -> all items (sold-out included, for strike-through)
- `GET  /api/customers/:phone` -> {known, first_name, points_balance, can_redeem, redeem_threshold, eligible_tiers}. Returns ONLY that one customer.
- `POST /api/orders` body {items:[{menu_item_id,quantity}], payment_method, phone?, first_name?, redeem?:{menu_item_id}}
- `GET  /api/orders/:id/bill` -> full invoice with GST split re-derived from stored total
- `GET  /api/admin/summary?date=`, `/orders`, `/customers`, `GET/PUT /menu/:id`, `GET/PUT /config`

## Counter-visibility rules enforced
- No revenue/order-count/takings on the billing screen (only in /admin).
- Lookup exposes only the one customer's first name + points; phone masked to last 4 after entry.
- No visible discount button; loyalty auto-applies; manual override is an
  undocumented keyboard shortcut (Ctrl+Shift+D).
- Errors are plain sentences — no SQL/paths/stack traces to the customer.

## Brand
- red `#E8341C`, ink `#0D0D0D`, cream `#F3EDE4`. Display font Anton (item
  names/prices/wordmark), body Inter, numerics JetBrains Mono. Bold poster look,
  cream load-bearing, motion only on action, no gym-bro imagery.

## Decisions taken (spec's recommended defaults — OWNER MUST CONFIRM)
Stored as `app_config` rows so they change without code edits:
- Prices **GST-inclusive**.
- Loyalty: 1 pt/₹10, redeem 150 pts for one free Daily-tier-or-below shake, 1
  redemption/order, no percentage discounts.
- Thermal printing: **not built** (bills digital). Spec build-order step 8 pending a printer purchase.

## Menu status (NOT finalised — spec section 8)
16 slots WL-01..WL-16, tiers Caffeinated ₹119 / Originals ₹129 / Daily ₹149 /
Signature ₹179 / Clear Whey (unset). Only **6 are available** (confirmed names).
Undeveloped / price-conflicting items (Classic Chocolate, Berry Blast ₹199
conflict, PB&Banana, Cold Brew, Mocha, Mango&Papaya dup, 2× Clear Whey, 2 open
slots) are seeded **unavailable with no invented price**. Items with a confirmed
name but unconfirmed tier are flagged `assumed_tier` in `menu.seed.json`.

## Open decisions still blocking go-live
- [ ] Confirm GST-inclusive (assumed).
- [ ] Confirm loyalty rate / threshold / eligible tiers (defaults set).
- [ ] Final 16-item menu: names, codes, tiers, prices.
- [ ] Thermal printer? (currently digital only).
- [ ] Set real `business.gstin` in config (placeholder now).

## Nightly backup
`npm run export-db -- /path/on/usb/wheylab-YYYY-MM-DD.sqlite` (SQLite online backup, safe while running).
