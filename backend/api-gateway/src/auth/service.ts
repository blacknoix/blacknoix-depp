import { issueAccessToken, type JwtConfig } from "./jwt/access-token";
import { TRANSITIONAL_HUMAN_OPERATOR_ROLES } from "./roles";
import type { SessionsRepository } from "../sessions/repository";
import type { FederatedIdentity, UsersRepository } from "../users/repository";

export interface IssuedTokens {
  accessToken: string;
  /** Opaque refresh token — returned once, never stored in plaintext. */
  refreshToken: string;
  tokenType: "Bearer";
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export type RefreshOutcome =
  | { ok: true; tokens: IssuedTokens }
  | { ok: false; reason: "invalid" | "replayed" | "session_revoked" };

export interface AuthService {
  /**
   * Completes login for an already-verified upstream identity: links/creates the
   * user, opens a session with an initial refresh token, and mints the access
   * token. It does NOT verify the upstream OIDC token — that is the caller's job
   * and is deferred to the OIDC callback slice.
   */
  completeOidcLogin(tenantId: string, identity: FederatedIdentity): Promise<IssuedTokens>;

  /**
   * Rotates a refresh token and mints a fresh access token. Replay, revocation,
   * and tenant isolation are enforced by the sessions repository; this method
   * only composes the outcome and issues the new access token.
   */
  refresh(tenantId: string, rawRefreshToken: string): Promise<RefreshOutcome>;
}

export interface AuthServiceDeps {
  users: UsersRepository;
  sessions: SessionsRepository;
  jwtConfig: JwtConfig;
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { users, sessions, jwtConfig } = deps;

  function issue(
    tenantId: string,
    userId: string,
    sessionId: string,
    refreshToken: string,
  ): IssuedTokens {
    // Transitional explicit operator claim (ADR-0011) until IdP / persisted
    // role mapping lands. Same roles on login and refresh so enforce mode
    // does not strand refreshed sessions. Agent tokens are issued elsewhere.
    const accessToken = issueAccessToken(jwtConfig, {
      tenantId,
      userId,
      sessionId,
      roles: TRANSITIONAL_HUMAN_OPERATOR_ROLES,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: jwtConfig.accessTtlSeconds,
    };
  }

  return {
    async completeOidcLogin(tenantId, identity) {
      const user = await users.findOrLinkByIdentity(tenantId, identity);
      const session = await sessions.createSession(tenantId, user.id);

      return issue(tenantId, user.id, session.sessionId, session.refreshToken);
    },

    async refresh(tenantId, rawRefreshToken) {
      const rotated = await sessions.rotateRefreshToken(tenantId, rawRefreshToken);

      if (!rotated.ok) {
        return { ok: false, reason: rotated.reason };
      }

      const userId = await sessions.getSessionUserId(tenantId, rotated.sessionId);

      // The rotation already proved the session is active, so this is defensive;
      // if the user cannot be resolved, fail closed rather than mint a token
      // without a subject.
      if (!userId) {
        return { ok: false, reason: "invalid" };
      }

      return {
        ok: true,
        tokens: issue(tenantId, userId, rotated.sessionId, rotated.refreshToken),
      };
    },
  };
}
