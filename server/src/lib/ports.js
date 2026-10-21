import ports from '../../../ports.json' with { type: 'json' };

// Every Biller port lives in ports.json at the repo root. An instance is chosen
// by name, never by number, so a stray PORT in some shell can't move the app.
export const INSTANCE = process.env.WHEYLAB_INSTANCE || 'live';

export function serverPort() {
  const port = ports[INSTANCE]?.server;
  if (!port) throw new Error(`Unknown WHEYLAB_INSTANCE "${INSTANCE}" (see ports.json)`);
  return port;
}

export const PUSHUP_BOARD_URL = `http://127.0.0.1:${ports.pushupBoard}/`;
