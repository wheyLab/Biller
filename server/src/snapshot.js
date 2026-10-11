// Creates a dated-range SQLite snapshot in the repo's backups/ folder, meant
// to be run by hand whenever you want (not nightly) — like start-kiosk.cmd,
// just double-click backup-snapshot.cmd — and then reviewed and pushed to
// git yourself. Each run makes a NEW file, never overwrites one, named with
// the date range it covers since your last snapshot, so the file list in
// git tells its own story of when backups were taken.
//
// Uses the same safe SQLite online-backup API as backup.js, so it's fine to
// run with the app open too, even though the normal habit is to run this
// while the app is closed.
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbPath } from './lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backupsDir = join(__dirname, '../../backups');
mkdirSync(backupsDir, { recursive: true });

const today = new Date().toISOString().slice(0, 10);

// Find the end date of the most recent snapshot already in backups/, so the
// new file's name reads as "everything new since then". Understands both
// this script's own `wheylab_<start>_to_<end>.sqlite` naming and the older
// single-date `wheylab-<date>.sqlite` files from before it existed.
function previousSnapshotEnd() {
  const files = readdirSync(backupsDir);
  const ranged = files
    .map((f) => f.match(/^wheylab_(?:first|\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})\.sqlite$/))
    .filter((m) => m)
    .map((m) => m[1]);
  if (ranged.length) return ranged.sort().at(-1);

  const single = files
    .map((f) => f.match(/^wheylab-(\d{4}-\d{2}-\d{2})\.sqlite$/))
    .filter((m) => m)
    .map((m) => m[1]);
  if (single.length) return single.sort().at(-1);

  return null;
}

const start = previousSnapshotEnd() ?? 'first';
const dest = join(backupsDir, `wheylab_${start}_to_${today}.sqlite`);

const src = new Database(dbPath(), { readonly: true });
try {
  await src.backup(dest);
  console.log(`Backed up ${dbPath()}`);
  console.log(`  -> ${dest}`);
  console.log('');
  console.log('Review it, then push it yourself:');
  console.log('  git add backups/ && git commit -m "Backup snapshot" && git push');
} finally {
  src.close();
}
