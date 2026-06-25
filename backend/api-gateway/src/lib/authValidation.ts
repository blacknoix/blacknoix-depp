const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MAX_LENGTH = 128;
const REFRESH_TOKEN_MAX_LENGTH = 4096;

// Practical RFC 5322 subset — rejects obvious garbage without being overly strict.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LoginInput {
  email: string;
  password: string;
}

export interface RefreshInput {
  refreshToken: string;
}

type ValidationFailure = { ok: false; error: string; fields: string[] };
type ValidationSuccess<T> = { ok: true; value: T };

export function validateLoginBody(
  body: unknown
): ValidationSuccess<LoginInput> | ValidationFailure {
  const data = body as Record<string, unknown>;
  const fields: string[] = [];

  if (typeof data.email !== 'string') {
    fields.push('email');
  }
  if (typeof data.password !== 'string') {
    fields.push('password');
  }

  if (fields.length > 0) {
    return { ok: false, error: 'Validation failed', fields };
  }

  const email = (data.email as string).trim().toLowerCase();
  const password = data.password as string;

  if (!email) {
    fields.push('email');
  } else if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    fields.push('email');
  }

  if (!password) {
    fields.push('password');
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    fields.push('password');
  }

  if (fields.length > 0) {
    return { ok: false, error: 'Validation failed', fields };
  }

  return { ok: true, value: { email, password } };
}

export function validateRefreshBody(
  body: unknown
): ValidationSuccess<RefreshInput> | ValidationFailure {
  const data = body as Record<string, unknown>;
  const fields: string[] = [];

  if (typeof data.refreshToken !== 'string') {
    return { ok: false, error: 'Validation failed', fields: ['refreshToken'] };
  }

  const refreshToken = data.refreshToken.trim();

  if (!refreshToken) {
    fields.push('refreshToken');
  } else if (refreshToken.length > REFRESH_TOKEN_MAX_LENGTH) {
    fields.push('refreshToken');
  }

  if (fields.length > 0) {
    return { ok: false, error: 'Validation failed', fields };
  }

  return { ok: true, value: { refreshToken } };
}
