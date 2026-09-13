import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev server stays on localhost and proxies the API to the Express process.
// No external hosts, so it works with the network adapter disabled.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4173',
    },
  },
});
