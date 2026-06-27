import { logAuthEvent, hashClientIp } from '../lib/authAudit';

describe('authAudit', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('logs JSON with AUTH_EVENT prefix', () => {
    logAuthEvent({
      action: 'login',
      outcome: 'success',
      userId: 'user-1',
      tenantId: 'tenant-1',
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const line = consoleSpy.mock.calls[0][0] as string;
    expect(line.startsWith('AUTH_EVENT ')).toBe(true);

    const payload = JSON.parse(line.slice('AUTH_EVENT '.length));
    expect(payload.action).toBe('login');
    expect(payload.outcome).toBe('success');
    expect(payload.userId).toBe('user-1');
    expect(payload.timestamp).toBeDefined();
  });

  it('never logs raw JWT strings', () => {
    logAuthEvent({
      action: 'refresh_failed',
      outcome: 'failure',
      reason: 'invalid_token',
      // @ts-expect-error intentional misuse guard test
      refreshToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.sig',
    });

    const line = consoleSpy.mock.calls[0][0] as string;
    expect(line).not.toMatch(/eyJhbGci/);
    const payload = JSON.parse(line.slice('AUTH_EVENT '.length));
    expect(payload.refreshToken).toBeUndefined();
  });

  it('never logs passwords', () => {
    logAuthEvent({
      action: 'login_failed',
      outcome: 'failure',
      reason: 'invalid_credentials',
      // @ts-expect-error intentional misuse guard test
      password: 'super-secret-password',
    });

    const line = consoleSpy.mock.calls[0][0] as string;
    expect(line).not.toContain('super-secret-password');
    const payload = JSON.parse(line.slice('AUTH_EVENT '.length));
    expect(payload.password).toBeUndefined();
  });

  it('strips sensitive field names from fields array', () => {
    logAuthEvent({
      action: 'request_validation_failed',
      outcome: 'failure',
      httpStatus: 400,
      fields: ['email', 'password', 'refreshToken'],
    });

    const line = consoleSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(line.slice('AUTH_EVENT '.length));
    expect(payload.fields).toEqual(['email']);
  });

  it('hashClientIp returns a stable truncated hash', () => {
    const req = {
      ip: '203.0.113.42',
      socket: { remoteAddress: '203.0.113.42' },
    } as Pick<import('express').Request, 'ip' | 'socket'>;
    const hash1 = hashClientIp(req);
    const hash2 = hashClientIp(req);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16);
    expect(hash1).not.toBe('203.0.113.42');
  });
});
