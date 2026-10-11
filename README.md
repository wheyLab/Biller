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

## Counter (kiosk) mode

Double-click `start-kiosk.cmd`. It rebuilds the app, starts the server if it
isn't running, and opens Chrome (or Edge) in fullscreen kiosk mode: no address
bar, tabs or window frame, so it looks like an app, not a web page. Exit with
Alt+F4; the server keeps running in a minimised "Whey Lab server" window. Put a
shortcut to the file in `shell:startup` to launch it when the laptop boots.

The menu is drawn on a fixed 1920-wide canvas and scaled to whatever screen it
runs on, so it looks the same everywhere and never reflows when the cart opens.

## Data & backup

- The SQLite file lives **outside the repo** at `~/.wheylab/wheylab.sqlite`
  (override with `WHEYLAB_DB`). WAL mode.
- Nightly USB backup: `npm run export-db -- /path/on/usb/wheylab-YYYY-MM-DD.sqlite`
- `npm run backup` snapshots the DB into `~/OneDrive/WheyLab Backups/`, so it's
  backed up off this PC without ever putting customer data into git.
- **Double-click `backup-snapshot.cmd`** whenever you want a backup you'll
  push to git yourself (no schedule — run it as often or as rarely as you
  like). Each run adds a new file to `backups/`, never overwrites one, named
  `wheylab_<since>_to_<today>.sqlite` so the date range since your last
  snapshot is right there in the filename. Review it, then:
  `git add backups/ && git commit -m "Backup snapshot" && git push`.
  These files contain real customer data (phone numbers, names) — only push
  them if you're sure about where this repo lives and who can see it.
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

## Menu

The 15-item menu (6 categories) is transcribed from the printed menu into
`server/data/menu.seed.json`. `npm run seed` makes the DB match that file exactly:
it upserts these items and removes any menu item not in the file. Past orders are
unaffected (they snapshot item name and price).

## Layout

```
server/   Express + better-sqlite3 API (127.0.0.1)
  src/lib/{db,money,loyalty}.js   src/routes/*   data/menu.seed.json   test/
client/   React + Vite + Tailwind v4, fonts bundled via @fontsource (offline)
  src/components/*   src/store/ticket.ts
```
