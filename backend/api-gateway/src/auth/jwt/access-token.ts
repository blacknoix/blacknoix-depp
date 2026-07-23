import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * DEPP access-token issuing and verification (ADR-0003 §4).
 *
 * Synchronous by design: an HS256 signature is a local HMAC, so verification
 * needs no I/O and the auth strategy stays synchronous (ADR-0002). The algorithm
 * is hardcoded — the verifier never reads an attacker-supplied `alg`, which
 * removes the alg-confusion and `alg:none` attack classes outright.
 *
 * Claims are minimal and stable: tenant, user (subject), and session identity,
 * plus issuer/audience/iat/exp. No mutable presentation fields (email, name)
 * ever go in a token.
 */

export interface JwtConfig {
  /** HS256 signing secret. At least 32 bytes; enforced in jwt/config.ts. */
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTtlSeconds: number;
}

export interface AccessTokenClaims {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
}

export class AccessTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessTokenError";
  }
}

const ALG = "HS256";
const TYP = "JWT";

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signingSignature(secret: string, signingInput: string): string {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function issueAccessToken(
  config: JwtConfig,
  claims: AccessTokenClaims,
  issuedAt: number = nowSeconds(),
): string {
  const header = { alg: ALG, typ: TYP };
  const payload = {
    iss: config.issuer,
    aud: config.audience,
    sub: claims.userId,
    tid: claims.tenantId,
    sid: claims.sessionId,
    iat: issuedAt,
    exp: issuedAt + config.accessTtlSeconds,
  };

  const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;

  return `${signingInput}.${signingSignature(config.secret, signingInput)}`;
}

interface RawPayload {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  tid?: unknown;
  sid?: unknown;
  iat?: unknown;
  exp?: unknown;
}

function decodeJson(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

/**
 * Verifies a token and returns its claims, or throws AccessTokenError on any
 * failure — malformed, wrong algorithm, bad signature, wrong issuer/audience,
 * expired, or missing a required claim. Callers treat a throw as "no principal"
 * and fail closed.
 */
export function verifyAccessToken(
  config: JwtConfig,
  token: string,
  at: number = nowSeconds(),
): AccessTokenClaims {
  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new AccessTokenError("malformed token");
  }

  const [encodedHeader, encodedPayload, signature] = parts;

  let header: { alg?: unknown; typ?: unknown };
  try {
    header = decodeJson(encodedHeader) as { alg?: unknown; typ?: unknown };
  } catch {
    throw new AccessTokenError("malformed header");
  }

  // Hardcoded algorithm: reject anything but our own HS256/JWT before doing any
  // signature work.
  if (header.alg !== ALG || header.typ !== TYP) {
    throw new AccessTokenError("unexpected algorithm");
  }

  const expected = signingSignature(config.secret, `${encodedHeader}.${encodedPayload}`);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);

  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new AccessTokenError("bad signature");
  }

  let payload: RawPayload;
  try {
    payload = decodeJson(encodedPayload) as RawPayload;
  } catch {
    throw new AccessTokenError("malformed payload");
  }

  if (payload.iss !== config.issuer) {
    throw new AccessTokenError("wrong issuer");
  }

  if (payload.aud !== config.audience) {
    throw new AccessTokenError("wrong audience");
  }

  if (typeof payload.iat !== "number") {
    throw new AccessTokenError("missing iat");
  }

  if (typeof payload.exp !== "number" || at >= payload.exp) {
    throw new AccessTokenError("expired");
  }

  const { tid, sub, sid } = payload;

  if (
    typeof tid !== "string" ||
    typeof sub !== "string" ||
    typeof sid !== "string" ||
    tid === "" ||
    sub === "" ||
    sid === ""
  ) {
    throw new AccessTokenError("missing required claims");
  }

  return { tenantId: tid, userId: sub, sessionId: sid };
}
