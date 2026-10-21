import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import ports from '../ports.json';

// Vite loads this file under Node, but the client has no @types/node; declare
// just the bit we read. Ports are fixed in ../ports.json — the only choice is
// WHEYLAB_INSTANCE (live | test), the same name the server reads, so the client
// and its API always move together (see start-test.cmd).
declare const process: { env: Record<string, string | undefined> };

const instance = (process.env.WHEYLAB_INSTANCE || 'live') as 'live' | 'test';
const { server, client } = ports[instance];

// Dev server stays on localhost and proxies the API to the Express process.
// No external hosts, so it works with the network adapter disabled.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    host: '127.0.0.1',
    port: client,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${server}`,
    },
  },
});
