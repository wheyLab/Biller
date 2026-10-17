import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Vite loads this file under Node, but the client has no @types/node; declare
// just the bit we read (a launcher may assign the dev port via PORT, and the
// API port via WHEYLAB_SERVER_PORT — same var name the server itself reads,
// so one override moves both sides together; see start-test.cmd).
declare const process: { env: Record<string, string | undefined> };

// Dev server stays on localhost and proxies the API to the Express process.
// No external hosts, so it works with the network adapter disabled.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${Number(process.env.WHEYLAB_SERVER_PORT) || 4173}`,
    },
  },
});
