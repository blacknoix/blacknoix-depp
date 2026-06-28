import { createHash } from 'crypto';
import { Request } from 'express';

export type AuthAuditOutcome = 'success' | 'failure' | 'denied';

export type AuthAuditAction =
  | 'login'
  | 'login_failed'
  | 'refresh'
  | 'refresh_failed'
  | 'logout'
  | 'logout_failed'
  | 'refresh_reuse_detected'
  | 'session_revoked'
  | 'session_revoked_all'
  | 'request_validation_failed'
  | 'request_unauthorized'
  | 'request_rate_limited'
  | 'access_denied_invalid_token'
  | 'access_denied_missing_tenant_context'
  | 'access_denied_insufficient_role'
  | 'agent_enrollment'
  | 'agent_enrollment_failed'
  | 'agent_auth_success'
  | 'agent_auth_failed'
  | 'agent_activated'
  | 'agent_expired'
  | 'agent_revoked';

export interface AuthAuditEvent {
  timestamp?: string;
  action: AuthAuditAction;
  outcome: AuthAuditOutcome;
  httpStatus?: number;
  route?: string;
  method?: string;
  userId?: string;
  tenantId?: string;
  agentId?: string;
  jti?: string;
  previousJti?: string;
  role?: string;
  requiredRole?: string;
  reason?: string;
  fields?: string[];
  clientIpHash?: string;
}

const LOG_PREFIX = 'AUTH_EVENT';

const SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'refreshToken',
  'accessToken',
  'token',
  'authorization',
  'agentToken',
  'agentSecret',
  'agentCredential',
  'enrollmentToken',
]);

/** SHA-256 prefix of client IP — never log raw IPs. */
export function hashClientIp(req: Pick<Request, 'ip' | 'socket'>): string | undefined {
  const ip = req.ip ?? req.socket?.remoteAddress;
  if (!ip) {
    return undefined;
  }
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

/** Full SHA-256 of client IP + optional salt — stored on agent records. */
export function hashAgentClientIp(req: Pick<Request, 'ip' | 'socket'>, salt = ''): string | undefined {
  const ip = req.ip ?? req.socket?.remoteAddress;
  if (!ip) {
    return undefined;
  }
  return createHash('sha256').update(ip + salt).digest('hex');
}

function containsSensitiveValue(value: string): boolean {
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)) {
    return true;
  }
  return /password|refreshToken|accessToken|Bearer\s+eyJ|depp_agt_[0-9a-f]+/i.test(value);
}

function sanitizeEvent(event: AuthAuditEvent): AuthAuditEvent {
  const clean: Record<string, unknown> = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };

  for (const key of Object.keys(clean)) {
    if (SENSITIVE_FIELD_NAMES.has(key)) {
      delete clean[key];
      continue;
    }
    const value = clean[key];
    if (typeof value === 'string' && containsSensitiveValue(value)) {
      delete clean[key];
    }
  }

  if (Array.isArray(clean.fields)) {
    clean.fields = (clean.fields as string[]).filter((f) => !SENSITIVE_FIELD_NAMES.has(f));
  }

  return clean as unknown as AuthAuditEvent;
}

/** Emit a structured auth audit record to stdout (JSON, prefixed). */
export function logAuthEvent(event: AuthAuditEvent): void {
  const payload = sanitizeEvent(event);
  console.log(`${LOG_PREFIX} ${JSON.stringify(payload)}`);
}
