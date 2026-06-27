import { Request, Response, NextFunction } from 'express';
import {
  createAuthRateLimiter,
  resetAuthRateLimitBuckets,
} from '../middleware/authRateLimit';
import { logAuthEvent } from '../lib/authAudit';

jest.mock('../lib/authAudit', () => ({
  logAuthEvent: jest.fn(),
  hashClientIp: jest.fn(),
}));

const mockedLogAuthEvent = logAuthEvent as jest.MockedFunction<typeof logAuthEvent>;

function runRateLimiter(
  limiter: ReturnType<typeof createAuthRateLimiter>,
  ip = '127.0.0.1'
) {
  const req = { ip, socket: { remoteAddress: ip } } as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    setHeader: jest.fn(),
  };
  const next = jest.fn();
  limiter(req, res as unknown as Response, next as NextFunction);
  return { res, next };
}

describe('authRateLimit', () => {
  beforeEach(() => resetAuthRateLimitBuckets());

  it('allows requests up to the configured max', () => {
    const limiter = createAuthRateLimiter(60_000, 2);

    runRateLimiter(limiter);
    const second = runRateLimiter(limiter);

    expect(second.next).toHaveBeenCalled();
    expect(second.res.status).not.toHaveBeenCalled();
  });

  it('returns 429 when the limit is exceeded', () => {
    const limiter = createAuthRateLimiter(60_000, 1);

    runRateLimiter(limiter);
    const blocked = runRateLimiter(limiter);

    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    expect(blocked.res.json).toHaveBeenCalledWith({ error: 'Too many requests' });
    expect(blocked.res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(mockedLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'request_rate_limited', httpStatus: 429 })
    );
  });
});
