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
 * Supports human session tokens (tid/sub/sid) and agent machine tokens
 * (tid/aid). A missing or invalid token yields no principal.
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

        if (claims.kind === "agent") {
          return {
            tenantId: claims.tenantId,
            agentId: claims.agentId,
          };
        }

        return {
          tenantId: claims.tenantId,
          userId: claims.userId,
          sessionId: claims.sessionId,
          ...(claims.roles ? { roles: claims.roles } : {}),
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
