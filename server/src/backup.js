// Snapshot the live DB into the machine's OneDrive folder, so it's backed up
// off this PC without ever putting customer data (phone numbers, names) into
// the git repo. Uses the SQLite online backup API, so it's safe to run while
// the app is up. Usage: node src/backup.js
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dbPath } from './lib/db.js';

// process.env.OneDrive is set by the OneDrive client itself when it's
// running; falling back to the default install location covers the rare
// case this runs before OneDrive has set env vars for the session.
const oneDriveRoot = process.env.OneDrive || join(homedir(), 'OneDrive');
const backupsDir = join(oneDriveRoot, 'WheyLab Backups');
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
