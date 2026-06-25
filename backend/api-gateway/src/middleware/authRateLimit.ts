import { Request, Response, NextFunction, RequestHandler } from 'express';
import { env } from '../config/env';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * In-memory sliding-window rate limiter for auth POST endpoints.
 * Keyed by client IP to slow brute-force and credential-stuffing attempts.
 */
export function createAuthRateLimiter(windowMs: number, max: number): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    next();
  };
}

/** Default limiter for /auth/login and /auth/refresh. */
export const authRateLimit = createAuthRateLimiter(
  env.authRateLimit.windowMs,
  env.authRateLimit.max
);

/** Reset buckets — test helper only. */
export function resetAuthRateLimitBuckets(): void {
  buckets.clear();
}
