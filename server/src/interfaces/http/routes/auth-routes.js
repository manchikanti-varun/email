import express from 'express';
import { asyncHandler } from '../middleware.js';
import { toPublicUser } from '../../../domain/entities/user.js';

export function makeAuthRouter({ registerUser, loginUser, rotateApiKey, authRequired, cookies, tokenService, revokedTokens }) {
  const router = express.Router();

  // Extract the presented Bearer/cookie token (if any) without requiring auth,
  // so logout can revoke the caller's own token even when it's about to expire.
  function presentedToken(req) {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    return bearer || req.cookies?.token || null;
  }

  router.post('/register', asyncHandler((req, res) => {
    const { email, password, name } = req.body || {};
    const result = registerUser.execute({ email, password, name });
    cookies.setAuthCookie(res, result.token);
    res.json(result); // { token, user, apiKey }
  }));

  router.post('/login', asyncHandler((req, res) => {
    const { email, password } = req.body || {};
    const result = loginUser.execute({ email, password });
    cookies.setAuthCookie(res, result.token);
    res.json(result); // { token, user }
  }));

  // Logout revokes the caller's current token (by jti) so it can no longer
  // authenticate, then clears the cookie. Other sessions/tokens are untouched.
  // Always returns ok, even if no valid token was presented (idempotent).
  router.post('/logout', (req, res) => {
    try {
      const token = presentedToken(req);
      if (token && tokenService?.verifyDetailed && revokedTokens) {
        const detail = tokenService.verifyDetailed(token);
        if (detail && detail.jti) {
          const expiresAtIso = detail.exp
            ? new Date(detail.exp * 1000).toISOString()
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          revokedTokens.revoke(detail.jti, expiresAtIso, detail.userId);
        }
      }
    } catch { /* revocation is best-effort at logout; still clear the cookie */ }
    cookies.clearAuthCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', authRequired, (req, res) => {
    res.json({ user: toPublicUser(req.user) });
  });

  router.post('/api-key/rotate', authRequired, (req, res) => {
    res.json(rotateApiKey.execute(req.user.id));
  });

  return router;
}
