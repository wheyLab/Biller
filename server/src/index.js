import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { getDb, dbPath } from './lib/db.js';
import menu from './routes/menu.js';
import customers from './routes/customers.js';
import orders from './routes/orders.js';
import admin from './routes/admin.js';
import protein from './routes/protein.js';
import game from './routes/game.js';

// A kiosk server should stay up. Without these, an uncaught error anywhere
// (a stray socket error, a rejected promise with no .catch) crashes the whole
// process silently — which is what's been intermittently stopping the app.
// Log it and keep running instead of dying with no visible cause.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server kept running):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (server kept running):', reason);
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1'; // never bind to 0.0.0.0 — single laptop, no LAN clients
// Dedicated var name (not the generic PORT) so nothing else on the machine —
// another dev tool, a launcher, a shell profile — can ever redirect this by
// accident. This app only ever runs on one fixed local port.
const PORT = Number(process.env.WHEYLAB_SERVER_PORT) || 4173;

getDb(); // open + migrate up front so failures surface at boot

const app = express();
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/menu', menu);
app.use('/api/customers', customers);
app.use('/api/orders', orders);
app.use('/api/admin', admin);
app.use('/api/protein', protein);
app.use('/api/game', game);

// Serve the built client (single static bundle). In dev, Vite serves the client
// separately and proxies /api here.
const clientDist = join(__dirname, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback so /admin (typed by hand, never linked) resolves.
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(clientDist, 'index.html')));
}

// Plain JSON errors only, never a stack trace or file path. Body-parser failures
// (malformed or oversized JSON) happen before any route's own try/catch.
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
  console.error('unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(PORT, HOST, () => {
  console.log(`Whey Lab billing on http://${HOST}:${PORT}`);
  console.log(`DB: ${dbPath()}`);
});
