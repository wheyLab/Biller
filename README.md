# Whey Lab — Counter Billing

Single-screen billing app for the Whey Lab kiosk. Runs offline on one laptop,
bound to `127.0.0.1`, with the customer reading the same (mirrored) screen.

## Run

```bash
npm install          # installs root + server + client
npm run seed         # load the menu + config into the SQLite DB
npm run dev          # server on :4173, client (Vite) on :5173 with /api proxy
```

Open http://127.0.0.1:5173 and fullscreen it. Back office is at
http://127.0.0.1:5173/admin (type it — never linked from the billing screen).

For a single static bundle served by Express only:

```bash
npm run build && npm start   # http://127.0.0.1:4173
```

## Data & backup

- The SQLite file lives **outside the repo** at `~/.wheylab/wheylab.sqlite`
  (override with `WHEYLAB_DB`). WAL mode.
- Nightly USB backup: `npm run export-db -- /path/on/usb/wheylab-YYYY-MM-DD.sqlite`
- Menu and prices are **seeded from `server/data/menu.seed.json`**, not code.
  Edit that file (or use the admin Menu tab) and re-run `npm run seed`.

## Money & GST

- All money is **integer paise**. No floats anywhere.
- Menu prices are **GST-inclusive**. Tax (5% = 2.5% CGST + 2.5% SGST) is backed
  out of the inclusive total; rounding lands on the taxable value so
  `taxable + cgst + sgst == total` exactly. Verified by `npm test`.
- Loyalty discounts apply to the taxable value before tax is derived.

## Decisions taken (spec sections 7, 9 — confirm with owner)

These were implemented as the spec's recommended defaults and stored as
**config rows in the DB** (admin → Config), so they change without a code edit:

- Prices **GST-inclusive**.
- Loyalty: **1 pt / ₹10**, redeem **150 pts** for one free shake of **Daily tier
  or below**, **1 redemption per order**, no percentage discounts.
- Thermal printing: **not built** (bills are digital). Section 13 step 8 pending
  a printer purchase.

## Menu status (spec section 8 — not finalised)

6 confirmed items are available; undeveloped / price-conflicting items are seeded
**unavailable with no invented price**. Items with a confirmed name but an
unconfirmed tier are flagged `assumed_tier` in the seed file. The owner finalises
`menu.seed.json` before go-live.

## Layout

```
server/   Express + better-sqlite3 API (127.0.0.1)
  src/lib/{db,money,loyalty}.js   src/routes/*   data/menu.seed.json   test/
client/   React + Vite + Tailwind v4, fonts bundled via @fontsource (offline)
  src/components/*   src/store/ticket.ts
```
