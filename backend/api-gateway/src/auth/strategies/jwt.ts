import type { Request } from "express";

import {
  AccessTokenError,
  type JwtConfig,
  verifyAccessToken,
} from "../jwt/access-token";
import {
  type AuthStrategy,
  type AuthenticatedPrincipal,
  InvalidCredentialError,
} from "../principal";

/**
 * Verified auth strategy: the principal comes only from a DEPP-signed access
 * token, never from request headers.
 *
 * Supports human session tokens (tid/sub/sid) and agent machine tokens
 * (tid/aid).
 *
 * Two distinct outcomes, deliberately not merged:
 *   - no Authorization header, or a non-Bearer / empty-token header: no
 *     credential was offered, so no principal (undefined). Route guards treat
 *     this as unauthenticated.
 *   - a Bearer token that fails verifyAccessToken: a credential WAS offered and
 *     is bad. Throws InvalidCredentialError so the request is rejected 401
 *     rather than silently downgraded to anonymous.
 *
 * The boundary between the two is drawn at the scheme, and is deliberate:
 *
 *   no Authorization header        -> no credential (undefined)
 *   non-Bearer scheme (Basic, ...) -> no credential this strategy can consume
 *   `Bearer` with a blank token    -> presented, malformed -> InvalidCredentialError
 *   `Bearer <token>` that fails    -> presented, invalid   -> InvalidCredentialError
 *
 * A blank Bearer token counts as presented rather than absent. The caller
 * clearly attempted bearer authentication, so answering 400 TENANT_REQUIRED
 * would tell them to add a tenant header when their actual problem is an empty
 * credential. RFC 6750 arguably classes an empty credential as invalid_request
 * (400) rather than invalid_token (401); 401 is chosen because both deny the
 * request identically and only 401 names the real fault.
 */
export function createJwtStrategy(config: JwtConfig): AuthStrategy {
  return {
    name: "jwt",

    authenticate(req: Request): AuthenticatedPrincipal | undefined {
      const header = req.get("authorization");
      if (!header) {
        return undefined;
      }

      const [scheme, ...rest] = header.split(" ");
      if (scheme?.toLowerCase() !== "bearer") {
        return undefined;
      }

      // Rejoined rather than taking rest[0]: a credential containing a space is
      // malformed, and passing the whole thing to the verifier fails closed as
      // an invalid token instead of silently authenticating on a prefix.
      const token = rest.join(" ").trim();
      if (token === "") {
        throw new InvalidCredentialError();
      }

      try {
        const claims = verifyAccessToken(config, token);

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
        // A presented-but-unverifiable token is an authentication failure, not
        // an absent credential. AccessTokenError already covers every rejection
        // path in verifyAccessToken: malformed structure, alg/typ mismatch
        // (including alg:none), bad signature, wrong issuer or audience,
        // expired, and missing required claims.
        //
        // The underlying message is dropped on purpose — it describes which
        // check failed and must not become an oracle for token forgery.
        if (err instanceof AccessTokenError) {
          throw new InvalidCredentialError();
        }

        throw err;
      }
    },
  };
}
