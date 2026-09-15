import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { AuthProvider } from './auth';
import { Toaster } from './components/Toaster';

const container = document.getElementById('app');
if (!container) throw new Error('#app root element not found');

createRoot(container).render(
  <StrictMode>
    <AuthProvider>
      <App />
      <Toaster />
    </AuthProvider>
  </StrictMode>,
);
