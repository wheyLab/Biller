import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { getDb, dbPath } from './lib/db.js';
import { serverPort, INSTANCE } from './lib/ports.js';
import menu from './routes/menu.js';
import customers from './routes/customers.js';
import orders from './routes/orders.js';
import admin from './routes/admin.js';
import protein from './routes/protein.js';
import game from './routes/game.js';
import screensaver from './routes/screensaver.js';

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
// Ports are fixed in ports.json; nothing can pass a port number in. The only
// choice is WHEYLAB_INSTANCE (live | test | selftest | selftest-legacy), which
// picks one of those fixed entries.
const PORT = serverPort();

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
app.use('/api/screensaver', screensaver);

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

const server = app.listen(PORT, HOST, () => {
  console.log(`Whey Lab billing (${INSTANCE}) on http://${HOST}:${PORT}`);
  console.log(`DB: ${dbPath()}`);
});
// The port is fixed, so a clash means another copy is already running. Exit
// loudly instead of lingering (the uncaughtException guard would otherwise
// keep a server alive that never listens).
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use: another ${INSTANCE} server is running. Not starting a second one.`);
    process.exit(1);
  }
  throw err;
});
