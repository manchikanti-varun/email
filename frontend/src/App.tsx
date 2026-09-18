// Facade: the application root now lives in app/App.tsx (thin route→page mapper).
// Kept here so main.tsx's `import { App } from './App'` continues to work.
export { App } from './app/App';
