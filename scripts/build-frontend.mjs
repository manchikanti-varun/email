// Vercel build step for the static frontend.
// Writes public/config.js from the BACKEND_URL environment variable so the
// deployed frontend knows where the Railway backend lives. No bundler needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const backendUrl = (process.env.BACKEND_URL || '').trim().replace(/\/$/, '');

const contents =
  `// AUTO-GENERATED at build time from the BACKEND_URL env var. Do not edit.\n` +
  `window.__API_BASE__ = ${JSON.stringify(backendUrl)};\n`;

const outPath = path.join(root, 'public', 'config.js');
fs.writeFileSync(outPath, contents);

console.log(`[build-frontend] wrote public/config.js with API base: ${backendUrl || '(empty — same-origin)'}`);
if (!backendUrl) {
  console.warn('[build-frontend] WARNING: BACKEND_URL is empty. Set it in Vercel to your Railway backend URL.');
}
