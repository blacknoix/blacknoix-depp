import type { Request } from "express";

import {
  AccessTokenError,
  type JwtConfig,
  verifyAccessToken,
} from "../jwt/access-token";
import type { AuthStrategy, AuthenticatedPrincipal } from "../principal";

/**
 * Verified auth strategy: the principal comes only from a DEPP-signed access
 * token, never from request headers.
 *
 * A missing, malformed, expired, wrong-issuer, wrong-audience, or bad-signature
 * token yields no principal, so the request fails closed at requireTenant. Only
 * an AccessTokenError is swallowed into "no principal"; anything unexpected is
 * re-thrown so it cannot be silently treated as unauthenticated.
 */
export function createJwtStrategy(config: JwtConfig): AuthStrategy {
  return {
    name: "jwt",

    authenticate(req: Request): AuthenticatedPrincipal | undefined {
      const header = req.get("authorization");
      if (!header) {
        return undefined;
      }

      const [scheme, token] = header.split(" ");
      if (scheme?.toLowerCase() !== "bearer" || !token) {
        return undefined;
      }

      try {
        const claims = verifyAccessToken(config, token.trim());

        return {
          tenantId: claims.tenantId,
          userId: claims.userId,
          sessionId: claims.sessionId,
        };
      } catch (err) {
        if (err instanceof AccessTokenError) {
          return undefined;
        }

        throw err;
      }
    },
  };
}
