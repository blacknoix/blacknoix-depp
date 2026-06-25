import { Router, Response } from 'express';
import { login, logout, refresh } from '../services/authService';
import { authenticate } from '../middleware/authenticate';
import { authRateLimit } from '../middleware/authRateLimit';
import { validateLoginBody, validateRefreshBody } from '../lib/authValidation';
import { AuthenticatedRequest } from '../types/auth';

export const authRouter = Router();

/**
 * POST /auth/login
 * Body: { email: string, password: string }
 * Returns: { accessToken, refreshToken }
 */
authRouter.post('/login', authRateLimit, async (req, res: Response): Promise<void> => {
  const validated = validateLoginBody(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error, fields: validated.fields });
    return;
  }

  const tokens = await login(validated.value.email, validated.value.password);

  if (!tokens) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  res.json(tokens);
});

/**
 * POST /auth/refresh
 * Body: { refreshToken: string }
 * Returns: { accessToken, refreshToken }
 */
authRouter.post('/refresh', authRateLimit, async (req, res: Response): Promise<void> => {
  const validated = validateRefreshBody(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error, fields: validated.fields });
    return;
  }

  const tokens = await refresh(validated.value.refreshToken);

  if (!tokens) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  res.json(tokens);
});

/**
 * POST /auth/logout
 * Body: { refreshToken: string }
 * Revokes the current refresh session.
 */
authRouter.post('/logout', async (req, res: Response): Promise<void> => {
  const validated = validateRefreshBody(req.body);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error, fields: validated.fields });
    return;
  }

  const ok = await logout(validated.value.refreshToken);
  if (!ok) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  res.status(204).send();
});

/**
 * GET /auth/me
 * Protected: requires valid access token.
 * Returns the caller's identity from the token.
 */
authRouter.get('/me', authenticate, (req, res: Response): void => {
  const { userId, tenantId, role } = (req as AuthenticatedRequest).auth;
  res.json({ userId, tenantId, role });
});
