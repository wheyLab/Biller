# Whey Lab — ports and endpoints

Every app runs on **one fixed port**. No env var or launcher can change a port.
If a port is already taken, the server stops with a clear message; it never
moves to a different port. Biller ports live in [`ports.json`](ports.json).
The pushup and web ports are hard-coded in their own configs, which point back
to this file.

## Port map

| Port | App | What it is | Started by |
|------|-----|------------|------------|
| **4173** | Biller (live) | API + built billing app + admin. **The kiosk.** | `start-kiosk.cmd`, `npm start` |
| **5173** | Biller (live, dev) | Vite dev client, proxies `/api` to 4173 | `npm run dev`, `run-dev.cmd` |
| **4174** | Biller (test) | Test API, its own DB (`%LOCALAPPDATA%\WheyLabTest`) | `start-test.cmd` |
| **5174** | Biller (test, dev) | Test dev client, proxies `/api` to 4174 | `start-test.cmd` |
| 4175 | Biller (selftest) | Throwaway server used by `npm test` only | `npm test` |
| 4176 | Biller (selftest-legacy) | Second throwaway server, migration test only | `npm test` |
| **4180** | Pushup challenge | API + built leaderboard + staff page | `pushup-challenge\start-kiosk.cmd`, Biller `start-kiosk.cmd` |
| **5180** | Pushup challenge (dev) | Vite dev client, proxies `/api` and `/photos` to 4180 | `npm run dev` in `pushup-challenge` |
| **5190** | Website (`web`) | Vite dev server for the marketing site | `run-dev.cmd` in `web` |

To run Biller as the test instance, set `WHEYLAB_INSTANCE=test` (that's what
`start-test.cmd` does). It's an instance *name*, not a port number.

## Pages (open in a browser)

| URL | Page |
|-----|------|
| http://127.0.0.1:4173 | Billing screen (customer-facing; screensaver after 60 s idle) |
| http://127.0.0.1:4173/admin | **Back office: your database** (summary, orders, customers, menu, stock, config) |
| http://127.0.0.1:5173 · http://127.0.0.1:5173/admin | Same two pages from the dev server (only while `npm run dev` runs) |
| http://127.0.0.1:5174 · http://127.0.0.1:5174/admin | Test instance billing and admin |
| http://127.0.0.1:4180 | Pushup leaderboard (also shown inside the Biller screensaver) |
| http://127.0.0.1:4180/staff | Pushup staff page: enter scores |
| http://localhost:5190 · http://localhost:5190/menu | Website home and menu |

The kiosk window has no address bar. To reach `/admin`, close it (Alt+F4) or
use a normal browser window.

## Biller API: `http://127.0.0.1:4173`

The dev client (5173) proxies `/api/*` here; the test instance uses 4174.

### Health
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | `{ ok: true }` when the server is up |

### Menu and protein
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/menu` | All menu items (sold-out included), by tier then sort order |
| GET | `/api/protein` | Protein brands, amounts, prices, and which are choosable (no stock numbers) |

### Customers
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/customers/username/check/:username` | Is this handle available? |
| GET | `/api/customers/username/suggest` | Handle suggestions from a typed name |
| GET | `/api/customers/search` | Staff search; short candidate list |
| GET | `/api/customers/:identifier` | Look up by phone or username: first name and points only |
| POST | `/api/customers` | Register a customer (upsert by phone) |

### Orders
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/orders` | Create an order (one transaction: order, items, loyalty, stock) |
| GET | `/api/orders/:id/bill` | Digital GST bill for a completed order |

### Spin-wheel game
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/game/spin` | Spin for a customer (same slice if spun again the same day) |
| GET | `/api/game/story-credit` | Does the customer have a banked story reward? |

### Screensaver
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/screensaver` | Idle seconds, pushup board URL (fixed 4180), media playlist |
| GET | `/api/screensaver/media/:file` | One offer image or reel from `Documents\Whey Lab Screensaver` |

### Admin (back office)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/summary` | Day summary (`?date=yyyy-mm-dd`, default today) |
| GET | `/api/admin/orders` | Order history, newest first |
| GET | `/api/admin/customers` | Customer list |
| GET | `/api/admin/customers/:id/orders` | One customer's orders with line items |
| POST | `/api/admin/customers/:id/recompute` | Rebuild cached points from the ledger |
| GET | `/api/admin/menu` | Menu for editing |
| PUT | `/api/admin/menu/:id` | Edit price, availability, name, tier, sort order |
| GET | `/api/admin/config` | Business, GST and loyalty settings |
| PUT | `/api/admin/config` | Update settings |
| GET | `/api/admin/stock` | Protein brand stock and the brand × grams price matrix |
| POST | `/api/admin/stock` | Add a protein brand |
| PUT | `/api/admin/stock/:id` | Edit a brand (name, threshold, active, order) |
| POST | `/api/admin/stock/:id/restock` | Add or correct powder stock (ledgered) |
| PUT | `/api/admin/protein-options/:grams` | Edit a Signature-tier protein surcharge |
| PUT | `/api/admin/protein-brand-prices/:brandId/:grams` | Edit one price-matrix cell |
| GET | `/api/admin/addons` | Add-ons list |
| PUT | `/api/admin/addons/:id` | Edit an add-on price |
| GET | `/api/admin/milk-options` | Milk options list |
| PUT | `/api/admin/milk-options/:id` | Edit a milk option price |

Any other non-`/api` path returns the billing app (that's how `/admin` loads).

## Pushup challenge API: `http://127.0.0.1:4180`

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/events` | Live updates stream (server-sent events) for the board |
| GET | `/api/board` | Leaderboard data |
| GET | `/api/athletes` | Search by name, phone or Instagram (includes Biller customers) |
| GET | `/api/athletes/:phone` | One athlete |
| PUT | `/api/athletes/:phone` | Create or update an athlete (incl. photo) |
| POST | `/api/attempts` | Record an attempt |
| GET | `/api/attempts/recent` | Recent attempts |
| POST | `/api/attempts/:id/void` | Void a mistyped attempt (kept for tracing) |
| GET | `/photos/*` | Athlete photos |

Any other path returns the board app (`/staff` loads the staff page).
