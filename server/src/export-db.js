// One-command DB export for the nightly USB backup.
// Usage: npm run export-db -- /media/usb/wheylab-2026-09-06.sqlite
// Uses SQLite's online backup API so it is safe while the app is running.
import Database from 'better-sqlite3';
import { dbPath } from './lib/db.js';

const dest = process.argv[2];
if (!dest) {
  console.error('Usage: npm run export-db -- <destination-path.sqlite>');
  process.exit(1);
}

const src = new Database(dbPath(), { readonly: true });
try {
  await src.backup(dest);
  console.log(`Exported ${dbPath()} -> ${dest}`);
} catch (err) {
  console.error('Export failed:', err.message);
  process.exit(1);
} finally {
  src.close();
}
