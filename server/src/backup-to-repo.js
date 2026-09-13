// Snapshot the live DB into the repo's backups/ folder for `git push` backup.
// Uses the SQLite online backup API, so it's safe to run while the app is up.
// Usage: node src/backup-to-repo.js
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbPath } from './lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backupsDir = join(__dirname, '../../backups');
mkdirSync(backupsDir, { recursive: true });

const date = new Date().toISOString().slice(0, 10);
const dest = join(backupsDir, `wheylab-${date}.sqlite`);

const src = new Database(dbPath(), { readonly: true });
try {
  await src.backup(dest);
  console.log(`Backed up ${dbPath()} -> ${dest}`);
} finally {
  src.close();
}
