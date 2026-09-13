import express from 'express';
import { asyncHandler } from '../middleware.js';
import { toPublicUser } from '../../../domain/entities/user.js';

export function makeAuthRouter({ registerUser, loginUser, rotateApiKey, authRequired, cookies }) {
  const router = express.Router();

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

  router.post('/logout', (req, res) => {
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
