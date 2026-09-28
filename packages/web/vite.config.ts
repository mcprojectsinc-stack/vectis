import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard talks to the control plane at /api, proxied to the server in dev.
// VITE_BASE controls the public base path: '/' for a root/subdomain deploy,
// '/vectis/' for a subfolder deploy. Dev keeps '/' so the proxy below works.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
