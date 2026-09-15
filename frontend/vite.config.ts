import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The React app is the new source of truth for the frontend.
// It builds into ../public so the existing Express static server
// (config.ROOT/public) and Vercel (outputDirectory: public) both keep working
// with no server changes. Static runtime config (config.js, favicon, etc.)
// lives in frontend/public and is copied through verbatim.
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, '..', 'public'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    // During local dev, proxy API + auth cookies to the Node backend.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
