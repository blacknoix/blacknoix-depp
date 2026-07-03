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
  | 'agent_revoked'
  | 'alert_list'
  | 'alert_read'
  | 'alert_access_denied'
  | 'alert_updated'
  | 'alert_created'
  | 'agent_isolated'
  | 'agent_restored'
  | 'agent_isolation_access_denied';

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
  alertId?: string;
  jti?: string;
  previousJti?: string;
  role?: string;
  requiredRole?: string;
  reason?: string;
  fields?: string[];
  clientIpHash?: string;
  meta?: Record<string, unknown>;
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

function sanitizeMetaValue(value: unknown): unknown {
  if (typeof value === 'string' && containsSensitiveValue(value)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeMetaValue(item))
      .filter((item) => item !== undefined);
  }
  if (value !== null && typeof value === 'object') {
    const nested: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_NAMES.has(key)) {
        continue;
      }
      const cleaned = sanitizeMetaValue(nestedValue);
      if (cleaned !== undefined) {
        nested[key] = cleaned;
      }
    }
    return nested;
  }
  return value;
}

function sanitizeEvent(event: AuthAuditEvent): AuthAuditEvent {
  const clean: Record<string, unknown> = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };

  for (const key of Object.keys(clean)) {
    if (key === 'meta') {
      continue;
    }
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

  if (event.meta) {
    clean.meta = sanitizeMetaValue(event.meta);
  }

  return clean as unknown as AuthAuditEvent;
}

/** Emit a structured auth audit record to stdout (JSON, prefixed). */
export function logAuthEvent(event: AuthAuditEvent): void {
  const payload = sanitizeEvent(event);
  console.log(`${LOG_PREFIX} ${JSON.stringify(payload)}`);
}
