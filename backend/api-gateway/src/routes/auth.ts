import { Router, Request, Response } from 'express';
import { login, refresh } from '../services/authService';
import { authenticate } from '../middleware/authenticate';
import { AuthenticatedRequest } from '../types/auth';

export const authRouter = Router();

/**
 * POST /auth/login
 * Body: { email: string, password: string }
 * Returns: { accessToken, refreshToken }
 */
authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  const tokens = await login(email.toLowerCase().trim(), password);

  if (!tokens) {
    // Deliberately vague — no enumeration
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
authRouter.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body as { refreshToken?: string };

  if (typeof refreshToken !== 'string') {
    res.status(400).json({ error: 'refreshToken is required' });
    return;
  }

  const tokens = await refresh(refreshToken);

  if (!tokens) {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  res.json(tokens);
});

/**
 * GET /auth/me
 * Protected: requires valid access token.
 * Returns the caller's identity from the token.
 */
authRouter.get('/me', authenticate, (req: Request, res: Response): void => {
  const { userId, tenantId, role } = (req as AuthenticatedRequest).auth;
  res.json({ userId, tenantId, role });
});
