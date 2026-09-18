// Auth screen composition: hero + login/signup form. Extracted from AuthView.
import { AuthHero } from './AuthHero';
import { AuthForm } from './AuthForm';

export function AuthContainer() {
  return (
    <div className="landing">
      <AuthHero />
      <AuthForm />
    </div>
  );
}
