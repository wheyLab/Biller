---
name: changelog
description: Update CHANGELOG.md for the Whey Lab Biller — what changed in each PR, PR status (open/merged/live), and the daily log of live-kiosk work. Use at the end of each working day, after opening or merging a PR, after a kiosk restart/deploy, or after any direct fix to the live database. Triggers - "update the changelog", "log today", "what changed in PR", "track the PRs".
---

# Changelog: keep CHANGELOG.md current

`CHANGELOG.md` at the repo root is the one place the owner reads to see what
changed, in which PR, and what was done on the live kiosk. Keep it accurate
and plain-English. The reader runs the shop, not the code.

## When to run

- End of every working day when anything changed (code, data or kiosk).
- Right after a PR is opened, merged or deployed (status columns).
- Right after any direct live-database fix (deleted bill, points correction,
  stock adjustment) or a kiosk restart/deploy.

## Steps

1. **Read `CHANGELOG.md`** to see the last daily-log date and every PR's status.

2. **Gather what changed since then.** Don't rely on memory.
   - `git fetch origin` then `git log --all --since=<last log date> --format='%h %ad %s%n%b' --date=short`
   - `git log --merges --format='%h %ad %s' --date=short origin/main` for newly merged PRs ("Merge pull request #N …").
   - `git status --short` for work not committed yet (list it as *uncommitted* in the daily log, not under a PR).
   - The conversation/session itself, for live-kiosk work that leaves no commit: database fixes, restarts, scheduled-task changes, files moved.
   - If the GitHub CLI is available, `gh pr list --state all --limit 20` for PR numbers, titles and states. If it isn't, use the merge commits; an unopened PR stays "#N (pending)" with its branch name.

3. **Update the PR table** (top of the file), newest PR first:
   - Status: 🟡 Open → ✅ Merged when the merge commit appears on `origin/main`. Add 🚀 Live with the date once the kiosk runs that code. The kiosk runs whatever `D:\repos\Biller` had when `start-kiosk.cmd` last ran, which can be before merge.
   - When a pending PR gets its real number, replace "#N (pending)" everywhere and link it: `[#N](https://github.com/wheyLab/Biller/pull/N)`.

4. **Update or add the PR section** (`## PR #N — Title`):
   - Group by feature with `###` headings. One bullet per change a person at the counter or the owner would notice.
   - Say what it does at the counter, on the bill, in admin or in the reports. Not file names, unless the change *is* a file or setting (e.g. `ports.json`).
   - Include database migrations and anything that touches the weekly Excel export. Those are the risky ones.
   - End with a short **Tests** line (count passing, what's new).

5. **Add today's daily-log entry** under `## Daily log`, newest first, as `### YYYY-MM-DD`:
   - Kiosk restarts/deploys (which PR's code, and the backup file name).
   - Direct data fixes: bill number, what was reversed, the backup file name.
   - Moves of files/folders and scheduled-task changes.
   - Anything left *pending*, marked "*Pending:*", so tomorrow starts with it.
   - Skip days with nothing to log. Never invent entries.

6. **Privacy:** no customer phone numbers or full names. Use the bill number and amounts. Influencer handles are fine (they're public and the point of the coupon).

7. **Commit it** on the current feature branch (or a `docs/changelog-YYYY-MM-DD` branch if on `main`):
   `git add CHANGELOG.md && git commit -m "Changelog: <date>"`. Push only if the user asks or the branch already has an open PR they asked to keep updated.

## Style

- Dates as `YYYY-MM-DD`. Money as ₹ with paise (₹282.46). Ports as plain numbers.
- Short bullets, past tense in the daily log, present tense in PR sections.
- Keep older entries as they are. Fix one only if it was factually wrong, and say so in today's log.
