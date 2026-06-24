import {
  validateLoginBody,
  validateRefreshBody,
} from '../lib/authValidation';

describe('validateLoginBody', () => {
  it('accepts a valid email and password', () => {
    const result = validateLoginBody({
      email: '  User@Example.COM ',
      password: 'correct-password',
    });

    expect(result).toEqual({
      ok: true,
      value: { email: 'user@example.com', password: 'correct-password' },
    });
  });

  it('rejects missing email', () => {
    const result = validateLoginBody({ password: 'pw' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields).toContain('email');
    }
  });

  it('rejects missing password', () => {
    const result = validateLoginBody({ email: 'user@example.com' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields).toContain('password');
    }
  });

  it('rejects invalid email format', () => {
    const result = validateLoginBody({ email: 'not-an-email', password: 'pw' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields).toContain('email');
    }
  });

  it('rejects empty email after trim', () => {
    const result = validateLoginBody({ email: '   ', password: 'pw' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields).toContain('email');
    }
  });

  it('rejects password over max length', () => {
    const result = validateLoginBody({
      email: 'user@example.com',
      password: 'x'.repeat(129),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields).toContain('password');
    }
  });
});

describe('validateRefreshBody', () => {
  it('accepts a non-empty refresh token', () => {
    const result = validateRefreshBody({ refreshToken: ' valid-token ' });
    expect(result).toEqual({ ok: true, value: { refreshToken: 'valid-token' } });
  });

  it('rejects missing refreshToken', () => {
    const result = validateRefreshBody({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields).toContain('refreshToken');
    }
  });

  it('rejects empty refreshToken after trim', () => {
    const result = validateRefreshBody({ refreshToken: '   ' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields).toContain('refreshToken');
    }
  });
});
