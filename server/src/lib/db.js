import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// DB lives OUTSIDE the repo so it is never committed and survives a re-clone.
// Override with WHEYLAB_DB for a custom location (e.g. a mounted drive).
export function dbPath() {
  if (process.env.WHEYLAB_DB) return process.env.WHEYLAB_DB;
  const dir = join(homedir(), '.wheylab');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'wheylab.sqlite');
}

// CREATE TABLE IF NOT EXISTS never retrofits new columns onto a table that
// already exists from an earlier version of the schema. This adds one if
// it's missing, so existing databases pick up schema changes without a
// destructive re-seed.
function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

let _db;
export function getDb() {
  if (_db) return _db;
  const db = new Database(dbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  const schema = readFileSync(join(__dirname, '../schema.sql'), 'utf8');
  db.exec(schema);

  ensureColumn(db, 'order_items', 'protein_brand_id', 'protein_brand_id TEXT REFERENCES protein_brands(id)');
  ensureColumn(db, 'order_items', 'protein_grams', 'protein_grams INTEGER');
  ensureColumn(db, 'order_items', 'protein_powder_mg_snapshot', 'protein_powder_mg_snapshot INTEGER');
  ensureColumn(
    db,
    'order_items',
    'protein_addon_price_paise_snapshot',
    'protein_addon_price_paise_snapshot INTEGER NOT NULL DEFAULT 0'
  );

  // Ensure the order-number counter row exists exactly once.
  db.prepare("INSERT OR IGNORE INTO counters(name, value) VALUES ('order_number', 0)").run();
  _db = db;
  return db;
}

export function getConfig(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function getConfigInt(db, key, fallback = 0) {
  const v = getConfig(db, key, null);
  return v === null ? fallback : parseInt(v, 10);
}

export function setConfig(db, key, value) {
  db.prepare(
    'INSERT INTO app_config(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export function allConfig(db) {
  const rows = db.prepare('SELECT key, value FROM app_config ORDER BY key').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// Reserve the next gapless order number. Must be called inside a transaction
// together with the order insert so a crash cannot burn a number.
export function nextOrderNumber(db) {
  db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'order_number'").run();
  return db.prepare("SELECT value FROM counters WHERE name = 'order_number'").get().value;
}
