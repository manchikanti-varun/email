// Thin entrypoint. The application is wired and started by the clean-architecture
// composition root in src/main.js. Kept here so package.json "main"/"start"
// (server/index.js) and existing deploy configs continue to work unchanged.
import { start } from './src/main.js';

start();
