import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In development, /api is proxied to the local backend so cookies are first-party,
// exactly like the Vercel rewrite in production (see vercel.json).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
  test: { environment: 'node' },
});
