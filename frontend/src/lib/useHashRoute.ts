import { useEffect, useState, useCallback } from 'react';

export interface Route {
  route: string;
  param: string | null;
}

function parse(): Route {
  const parts = (location.hash.replace(/^#\//, '') || 'dashboard').split('/');
  return { route: parts[0] || 'dashboard', param: parts[1] || null };
}

// Minimal hash router preserving the original URL scheme (#/lists/:id,
// #/agent/:id, etc.) so existing deep links and in-app anchors keep working.
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    if (!location.hash) location.hash = '#/dashboard';
    else onChange();
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(hash: string): void {
  location.hash = hash;
}

export function useNavigate() {
  return useCallback((hash: string) => {
    location.hash = hash;
  }, []);
}
