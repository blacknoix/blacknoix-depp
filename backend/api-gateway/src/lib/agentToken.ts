import crypto from 'crypto';
import { Request } from 'express';

export const AGENT_TOKEN_PREFIX = 'depp_agt_';
export const AGENT_TOKEN_PREFIX_LENGTH = 17;

const BEARER_PREFIX = 'Bearer ';

/**
 * Parse agent enrollment token from Authorization header.
 * Format: Authorization: Bearer depp_agt_<64-hex-chars>
 */
export function parseAgentBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const rawToken = authHeader.slice(BEARER_PREFIX.length).trim();
  if (!isValidAgentTokenFormat(rawToken)) {
    return null;
  }

  return rawToken;
}

export function isValidAgentTokenFormat(rawToken: string): boolean {
  if (!rawToken.startsWith(AGENT_TOKEN_PREFIX)) {
    return false;
  }
  const secretPart = rawToken.slice(AGENT_TOKEN_PREFIX.length);
  return secretPart.length === 64 && /^[0-9a-f]{64}$/i.test(secretPart);
}

export function generateRawAgentToken(): string {
  return AGENT_TOKEN_PREFIX + crypto.randomBytes(32).toString('hex');
}

export function tokenPrefixFromRaw(rawToken: string): string {
  return rawToken.slice(0, AGENT_TOKEN_PREFIX_LENGTH);
}
