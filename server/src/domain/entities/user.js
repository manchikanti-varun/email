// User entity helpers. Keeps the public representation (what leaves the API)
// in one place so it never accidentally leaks secrets like the password hash
// or the API key hash.

export function toPublicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    credits: u.credits,
    plan: u.plan,
    apiKeyPrefix: u.api_key_prefix || null,
    createdAt: u.created_at,
  };
}
