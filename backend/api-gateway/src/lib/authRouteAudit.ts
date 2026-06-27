import { Request } from 'express';
import { hashClientIp, logAuthEvent } from './authAudit';

type DeniedStatus = 400 | 401 | 429;

export function logAuthRouteDenied(
  req: Request,
  status: DeniedStatus,
  reason: string,
  fields?: string[]
): void {
  const action =
    status === 400
      ? 'request_validation_failed'
      : status === 429
        ? 'request_rate_limited'
        : 'request_unauthorized';

  logAuthEvent({
    action,
    outcome: 'failure',
    httpStatus: status,
    route: req.path,
    method: req.method,
    reason,
    fields,
    clientIpHash: hashClientIp(req),
  });
}
