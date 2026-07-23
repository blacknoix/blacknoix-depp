import { type NextFunction, type Request, type Response, Router } from "express";

import type { AuthService } from "../auth/service";
import { logLifecycle } from "../lib/log";
import { AppError } from "../middleware/error-handler";

export interface AuthRouterOptions {
  /**
   * When absent, the auth routes fail closed (503). index.ts wires this only
   * when a database and JWT configuration are both present.
   */
  authService?: AuthService;
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

  return router;
}

function rejectRefresh(req: Request, res: Response): void {
  res.status(401).json({
    ok: false,
    error: { code: "REFRESH_REJECTED", message: "Refresh token is invalid or expired" },
    requestId: req.requestId,
  });
}
