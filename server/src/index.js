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

// Serve the built client (single static bundle). In dev, Vite serves the client
// separately and proxies /api here.
const clientDist = join(__dirname, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback so /admin (typed by hand, never linked) resolves.
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(clientDist, 'index.html')));
}

app.listen(PORT, HOST, () => {
  console.log(`Whey Lab billing on http://${HOST}:${PORT}`);
  console.log(`DB: ${dbPath()}`);
});
