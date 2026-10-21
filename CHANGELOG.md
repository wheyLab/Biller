# Whey Lab Biller — Changelog

Every change to the billing app, grouped by pull request, plus a daily log of
what happened on the live kiosk (deploys, data fixes, restarts) that never
shows up in code. Updated day to day with the `changelog` skill
(`.claude/skills/changelog/SKILL.md`).

**Status key:** 🟡 Open (PR not merged yet) · ✅ Merged · 🚀 Live on the kiosk

| PR | Title | Branch | Status | Opened | Merged | Live |
|----|-------|--------|--------|--------|--------|------|
| #3 (pending) | Influencer coupon, Caffenizer protein brands, wheel combo range, fixed ports | `feature/influencer-coupon-fixed-ports` | 🟡 Open · 🚀 Live | 2026-10-21 | — | 2026-10-21 |
| [#2](https://github.com/wheyLab/Biller/pull/2) | Loyalty cap, customer search, test instance | `feature/spin-wheel-game` | ✅ Merged · 🚀 Live | 2026-10-17 | 2026-10-17 | 2026-10-17 |
| [#1](https://github.com/wheyLab/Biller/pull/1) | Counter offers: spin the wheel, pushup and story challenges | `feature/spin-wheel-game` | ✅ Merged · 🚀 Live | 2026-10-17 | 2026-10-17 | 2026-10-17 |

---

## PR #3 (pending) — Influencer coupon, Caffenizer protein brands, wheel combo range, fixed ports

Branch `feature/influencer-coupon-fixed-ports` → `main` · 3 commits · live on the kiosk since 2026-10-21 (before merge).

### Influencer coupon
- New **Influencer coupon** box on the pay screen. Staff pick which drinks are free (whole drink: protein, add-ons and milk included) and enter the influencer's Instagram handle.
- The handle prints on the bill and shows in admin (Orders tab and customer history).
- Fully free orders are paid as the new **Complimentary** payment type. Partly free orders are paid by Cash/UPI/Card as normal.
- Database: one-time migration widens `orders.payment_method` to allow `complimentary`. `order_offers` gains a `ref` column for the handle.
- Weekly Excel export (`D:\repos\reports\_weekly_export`) labels these orders "Complimentary". Without this the export would have crashed.

### Caffenizer protein brands
- Vanilla Latte and Midnight Mocha get the brand + grams picker: Super You (yeast), Origin (plant), and the whey brands. 20, 25, 30 or 40 g.
- Priced from the brand board (default MuscleBlaze 20 g stays ₹169). Powder is now drawn from stock for these drinks.

### Spin wheel
- The ₹555 COMBO slice can only come up for bills of **₹250–554.99** (cart total before discounts, at the moment of the spin). Every other bill gets one of the other six games.
- The prize itself is unchanged: top up to ₹555 to get a free Originals.

### Fixed ports
- Every port is fixed in `ports.json`. Env vars can't move them; an instance is picked by name (`WHEYLAB_INSTANCE=live|test`).
- Live 4173 (kiosk + admin) · dev 5173 · test 4174/5174 · pushup board 4180 · website 5190 (moved off 5173).
- A port already in use now stops the server with a clear message instead of leaving a dead process.
- New `ENDPOINTS.md` lists every port, page and API route.
- `run-dev.cmd` (Biller and web) no longer points at the old `D:\wheylab` folders.

### UPI
- Each order gets its own UPI QR with the exact amount pre-filled (AU Bank merchant ID), replacing the two static QR images.

### Idle screensaver
- After 60 s idle on the menu with an empty cart, the customer screen loops the pushup leaderboard, offer images and reels from `Documents\Whey Lab Screensaver`. Any tap returns to the menu.
- `start-kiosk.cmd` also starts the pushup-challenge app.
- Committed on `main` on 2026-10-17 but never pushed, so it ships in this PR.

### Tests
- 48/48 API tests pass. New tests cover the coupon, the payment migration, the wheel range and Caffenizer brands.

---

## PR #2 — Loyalty cap, customer search, test instance

Merged 2026-10-17.

- **Loyalty:** at most 20 points per order. 100 points = ₹99 off any drink (never more than the dearest drink in the order). Replaces the old 150-point free shake.
- **Checkout search:** "Who's this order for?" gets a live name/number search to pick an existing customer, with "add as new" below.
- **Fix:** text copied from the search box into First name / Mobile now clears when the search is cleared.
- **Test instance:** `start-test.cmd` runs a separate copy with its own database and ports (4174/5174).

---

## PR #1 — Counter offers: spin the wheel, pushup and story challenges

Merged 2026-10-17.

- **Flyer spin the wheel:** 7 games (₹555 combo, protein quiz, 5-second stop, plank, bottle flip, reaction test, weight guess). The server picks the slice; one spin per customer per day.
- **Pushup challenge:** ₹1 off per pushup on a Signature shake (max ₹100).
- **Story challenge:** a confirmed Instagram story banks 10% off the customer's next visit.
- The pay screen and the bill list every discount separately.

---

## Before PRs

- 2026-09-13 — Initial commit.
- 2026-10-11 — Version 1.0: billing screen, GST bills, loyalty, admin, protein stock.

---

## Daily log

Newest first. Live-kiosk work (deploys, data fixes, restarts) and anything else that isn't a code change. No customer phone numbers here.

### 2026-10-21
- Kiosk restarted on the PR #3 code after a full database backup (`backups/before-complimentary-migration-…`). Migration applied: 105 orders, 149 items, 100 loyalty rows unchanged, integrity OK.
- Weekly report export moved from `Desktop\whey lab\reports` to `D:\repos\reports`. The scheduled task was repointed and a test run passed. *Pending:* delete the old Desktop folder once Excel is closed.
- Branch `feature/influencer-coupon-fixed-ports` pushed; PR #3 to be opened on GitHub.
- Changes made: influencer coupon, Caffenizer protein brands, wheel combo range ₹250–554.99.

### 2026-10-20
- `D:\repos\Biller` made the only working repo (older copies on the Desktop and in `D:\wheylab` are stale).
- Duplicate bill **#75** (5 Oct, ₹282.46 cash) deleted from the live database. Its 28 loyalty points were reversed and 15 g MuscleBlaze returned to stock. Backup: `backups/before-remove-order-75-…`. Bill numbers now skip 75.
- Fixed ports and `ENDPOINTS.md` added.
