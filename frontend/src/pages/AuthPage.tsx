// Auth page (login / signup). Thin: composes the auth feature container.
// Rendered by App when there is no authenticated user.
import { AuthContainer } from '../features/auth/components/AuthContainer';

export function AuthPage() {
  return <AuthContainer />;
}
