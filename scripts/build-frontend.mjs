// Pre-build step for the static frontend.
// Writes frontend/public/config.js from the BACKEND_URL environment variable so
// the deployed frontend knows where the Railway backend lives. Vite then copies
// this file into the final public/ output during `vite build`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const backendUrl = (process.env.BACKEND_URL || '').trim().replace(/\/$/, '');

const contents =
  `// AUTO-GENERATED at build time from the BACKEND_URL env var. Do not edit.\n` +
  `window.__API_BASE__ = ${JSON.stringify(backendUrl)};\n`;

// Written into the Vite source public dir so the build copies it through to
// the final public/ output. (Vite empties public/ on build.)
const outPath = path.join(root, 'frontend', 'public', 'config.js');
fs.writeFileSync(outPath, contents);

console.log(`[build-frontend] wrote public/config.js with API base: ${backendUrl || '(empty — same-origin)'}`);
if (!backendUrl) {
  console.warn('[build-frontend] WARNING: BACKEND_URL is empty. Set it in Vercel to your Railway backend URL.');
}
