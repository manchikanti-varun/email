// Facade: the AuthProvider implementation now lives in
// app/providers/AuthProvider.tsx. Kept here so existing imports (`./auth`,
// `../auth`) continue to work unchanged during the shell migration.
export { AuthProvider, useAuth, SIGNUP_API_KEY_STORAGE } from './app/providers/AuthProvider';
