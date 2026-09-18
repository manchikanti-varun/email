// Facade: the app shell now lives in layouts/AppLayout.tsx (split into Sidebar,
// Header and VerificationBanner). Kept here, exported under the original name
// `Shell`, so any existing import (`../components/Shell`) keeps working.
export { AppLayout as Shell } from '../layouts/AppLayout';
