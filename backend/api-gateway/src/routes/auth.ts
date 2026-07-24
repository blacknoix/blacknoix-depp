import { type NextFunction, type Request, type Response, Router } from "express";

import type { OidcLoginService } from "../auth/oidc/login";
import type { AuthService } from "../auth/service";
import type { AgentsService } from "../agents/service";
import { logLifecycle } from "../lib/log";
import { AppError } from "../middleware/error-handler";

export interface AuthRouterOptions {
  /**
   * When absent, the auth routes fail closed (503). index.ts wires this only
   * when a database and JWT configuration are both present.
   */
  authService?: AuthService;

  /**
   * Agent credential → access-token exchange. When absent, that route fails
   * closed (503).
   */
  agentsService?: AgentsService;

  /**
   * Upstream OIDC callback verification. When absent, the callback route fails
   * closed (503). The tenant is fixed by configuration — never taken from the
   * request — because a single provider authenticates a single DEPP tenant in
   * this slice.
   */
  oidc?: {
    loginService: OidcLoginService;
  };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readString(body: unknown, key: string): string {
  if (typeof body !== "object" || body === null) {
    return "";
  }

  const value = (body as Record<string, unknown>)[key];

  return typeof value === "string" ? value : "";
}

export function createAuthRouter(options: AuthRouterOptions = {}): Router {
  const router = Router();

  /**
   * POST /v1/auth/refresh — rotate a refresh token, return a new access token.
   *
   * Every rejection returns the same generic 401 so the endpoint cannot be used
   * to distinguish an unknown token from a replayed one from a revoked session;
   * the specific reason is logged server-side, where a replay is a signal worth
   * watching. The tenant id scopes the RLS lookup and is not a secret — the
   * refresh token is the credential.
   */
  router.post("/refresh", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!options.authService) {
        throw new AppError("AUTH_UNAVAILABLE", 503, "Authentication is not available");
      }

      const tenantId = readString(req.body, "tenantId").trim();
      const refreshToken = readString(req.body, "refreshToken");

      if (!UUID.test(tenantId) || refreshToken === "") {
        return rejectRefresh(req, res);
      }

      const outcome = await options.authService.refresh(tenantId, refreshToken);

      if (!outcome.ok) {
        logLifecycle("warn", "refresh_rejected", {
          requestId: req.requestId,
          reason: outcome.reason,
        });

        return rejectRefresh(req, res);
      }

      res.status(200).json({ ok: true, data: outcome.tokens, requestId: req.requestId });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /v1/auth/agent/token — exchange an agent credential for a short-lived
   * access JWT (ADR-0003 §5). Not behind requireTenant: the credential is the
   * proof; tenantId scopes the RLS lookup (same pattern as refresh).
   *
   * Every rejection is the same generic 401 so this is not an oracle for
   * agent existence or revocation state.
   */
  router.post(
    "/agent/token",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!options.agentsService) {
          throw new AppError(
            "AUTH_UNAVAILABLE",
            503,
            "Authentication is not available",
          );
        }

        const tenantId = readString(req.body, "tenantId").trim();
        const agentId = readString(req.body, "agentId").trim().toLowerCase();
        const credential = readString(req.body, "credential");

        if (!UUID.test(tenantId) || !UUID.test(agentId) || credential === "") {
          return rejectAgentToken(req, res);
        }

        const outcome = await options.agentsService.exchangeForAccessToken(
          tenantId,
          agentId,
          credential,
        );

        if (!outcome.ok) {
          logLifecycle("warn", "agent_token_rejected", {
            requestId: req.requestId,
            reason: outcome.reason,
          });
          return rejectAgentToken(req, res);
        }

        res.status(200).json({
          ok: true,
          data: outcome.tokens,
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /v1/auth/oidc/start — begins login.
   *
   * Creates the server-side initiation record (state, nonce, PKCE) and redirects
   * to the provider authorization endpoint. The tenant is fixed by configuration.
   */
  router.get(
    "/oidc/start",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!options.oidc) {
          throw new AppError("AUTH_UNAVAILABLE", 503, "Authentication is not available");
        }

        const { redirectUrl } = await options.oidc.loginService.start();
        res.redirect(302, redirectUrl);
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * GET /v1/auth/oidc/callback — the provider's redirect target.
   *
   * completeOidcLogin is reached only after the login service has matched the
   * returned `state` to a live, unconsumed initiation record and the ID token
   * has passed jose verification bound to that record's PKCE verifier and nonce.
   * The tenant comes from the record (config-owned), never the request. Every
   * failure returns the same generic 401.
   */
  router.get(
    "/oidc/callback",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!options.oidc || !options.authService) {
          throw new AppError("AUTH_UNAVAILABLE", 503, "Authentication is not available");
        }

        const code = typeof req.query.code === "string" ? req.query.code : "";
        const state = typeof req.query.state === "string" ? req.query.state : "";
        if (code === "" || state === "") {
          return rejectOidc(req, res);
        }

        let completed;
        try {
          completed = await options.oidc.loginService.complete({ state, code });
        } catch (err) {
          // Any binding or verification failure: no identity crosses the
          // boundary and completeOidcLogin is never reached.
          logLifecycle("warn", "oidc_callback_rejected", {
            requestId: req.requestId,
            errorName: err instanceof Error ? err.name : "UnknownError",
          });
          return rejectOidc(req, res);
        }

        const tokens = await options.authService.completeOidcLogin(
          completed.tenantId,
          completed.identity,
        );

        res.status(200).json({ ok: true, data: tokens, requestId: req.requestId });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

function rejectOidc(req: Request, res: Response): void {
  res.status(401).json({
    ok: false,
    error: { code: "OIDC_CALLBACK_FAILED", message: "Sign-in could not be completed" },
    requestId: req.requestId,
  });
}

function rejectRefresh(req: Request, res: Response): void {
  res.status(401).json({
    ok: false,
    error: { code: "REFRESH_REJECTED", message: "Refresh token is invalid or expired" },
    requestId: req.requestId,
  });
}

function rejectAgentToken(req: Request, res: Response): void {
  res.status(401).json({
    ok: false,
    error: {
      code: "AGENT_TOKEN_REJECTED",
      message: "Agent credential is invalid or revoked",
    },
    requestId: req.requestId,
  });
}
