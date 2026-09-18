// Flat ESLint config for the React + TypeScript frontend (frontend/src).
// The Node/Express backend is intentionally out of scope here.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    // Only lint the frontend source; ignore generated + backend + deps.
    ignores: ['public/**', 'node_modules/**', 'server/**', 'scripts/**', 'data/**'],
  },
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // These modules intentionally co-locate a hook/utility with their provider
    // component (useAuth beside AuthProvider, toast() beside Toaster). The
    // Fast-Refresh-only warning does not apply to how they're used.
    files: [
      'frontend/src/auth.tsx',
      'frontend/src/app/providers/AuthProvider.tsx',
      'frontend/src/components/Toaster.tsx',
      'frontend/src/components/ui/Toast.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
);
