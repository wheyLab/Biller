import { Router } from 'express';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { homedir } from 'node:os';
// The pushup leaderboard is its own app/server (fixed port, ports.json); the screensaver embeds it.
import { PUSHUP_BOARD_URL } from '../lib/ports.js';

// Idle-screen playlist. Staff drop offer images and Instagram reels into one
// folder; whatever is in it plays, sorted by file name (prefix "01-", "02-"
// to set the order). Re-read on every request, so adding or removing a file
// takes effect on the next loop with no restart.
const router = Router();

export const MEDIA_DIR = process.env.SCREENSAVER_DIR || join(homedir(), 'Documents', 'Whey Lab Screensaver');
const IDLE_SECONDS = Number(process.env.SCREENSAVER_IDLE_SECONDS) || 60;

const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO = new Set(['.mp4', '.webm', '.m4v', '.mov']);

try { mkdirSync(MEDIA_DIR, { recursive: true }); } catch { /* reported as empty below */ }

router.get('/', (_req, res) => {
  let media = [];
  if (existsSync(MEDIA_DIR)) {
    media = readdirSync(MEDIA_DIR, { withFileTypes: true })
      .filter((f) => f.isFile() && !f.name.startsWith('.') && !f.name.startsWith('~'))
      .map((f) => {
        const ext = extname(f.name).toLowerCase();
        const type = IMAGE.has(ext) ? 'image' : VIDEO.has(ext) ? 'video' : null;
        return type && { type, name: f.name, url: `/api/screensaver/media/${encodeURIComponent(f.name)}` };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  res.json({ idle_seconds: IDLE_SECONDS, pushup_board_url: PUSHUP_BOARD_URL, media });
});

// Only plain file names inside MEDIA_DIR; basename() strips any path parts.
router.get('/media/:file', (req, res) => {
  const name = basename(req.params.file);
  const path = join(MEDIA_DIR, name);
  if (!existsSync(path)) return res.status(404).end();
  res.sendFile(path, { maxAge: '1h' });
});

export default router;
