import { type NextFunction, type Request, type Response, Router } from "express";

import type { AgentsService } from "../agents/service";
import { logLifecycle } from "../lib/log";
import { AppError } from "../middleware/error-handler";
import { requirePrincipal } from "../middleware/tenant-context";
import type { DeviceIdentityService } from "../threat-events/device-identity";

export interface AgentsRouterOptions {
  /**
   * When absent, agent registration/revoke fail closed (503). Wired only when
   * a database and JWT config are both present (credential exchange needs JWT).
   */
  agentsService?: AgentsService;

  /** Device identity bind/revoke. Omitted → those routes fail closed (503). */
  deviceIdentities?: DeviceIdentityService;
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

/**
 * Tenant-scoped agent enrollment (register + revoke), operator inventory,
 * and Windows-first device identity bind/revoke.
 *
 * Who may call enrollment: any authenticated tenant principal (human JWT /
 * dev-header). RBAC on enrollment is deferred. Agent machine identity is
 * established by the returned credential, not by this route's caller type.
 *
 * Device identity bind: agent principal only; path agentId must match.
 * Device identity revoke: operator principal only.
 *
 * Inventory (GET /) is operator-only — agent principals are rejected.
 */
export function createAgentsRouter(options: AgentsRouterOptions = {}): Router {
  const router = Router();

  /**
   * GET /v1/agents — operator agent inventory (liveness + open findings).
   * Agent principals rejected. Enrollment UX / remote actions deferred.
   */
  router.get("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const principal = requirePrincipal(req);

      if (principal.agentId) {
        throw new AppError(
          "AGENTS_REJECTED",
          403,
          "Agent inventory requires an operator principal",
        );
      }

      if (!options.agentsService) {
        throw new AppError(
          "AGENTS_UNAVAILABLE",
          503,
          "Agent inventory is not available",
        );
      }

      const queryKeys = Object.keys(req.query);
      if (queryKeys.length > 0) {
        throw new AppError(
          "AGENT_INVALID",
          400,
          "agent inventory does not accept query parameters",
        );
      }

      const agents = await options.agentsService.listInventory(
        principal.tenantId,
      );

      res.status(200).json({
        ok: true,
        data: {
          agents: agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            createdAt: agent.createdAt.toISOString(),
            lastHeartbeatAt: agent.lastHeartbeatAt
              ? agent.lastHeartbeatAt.toISOString()
              : null,
            openFindingsCount: agent.openFindingsCount,
            heartbeatFreshness: agent.heartbeatFreshness,
          })),
        },
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /v1/agents — register an agent and mint its long-lived credential.
   * The plaintext credential is returned once and never stored.
   */
  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const principal = requirePrincipal(req);

      if (!options.agentsService) {
        throw new AppError(
          "AGENTS_UNAVAILABLE",
          503,
          "Agent enrollment is not available",
        );
      }

      const name = readString(req.body, "name").trim();
      if (name.length === 0 || name.length > 128) {
        throw new AppError(
          "AGENT_INVALID",
          400,
          "name must be 1..128 characters",
        );
      }

      const registered = await options.agentsService.register(
        principal.tenantId,
        name,
      );

      res.status(201).json({
        ok: true,
        data: {
          agentId: registered.agentId,
          name: registered.name,
          credential: registered.credential,
        },
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /v1/agents/:agentId/device-identity — agent self-binds Ed25519 pubkey.
   */
  router.post(
    "/:agentId/device-identity",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);

        if (!principal.agentId) {
          throw new AppError(
            "AGENT_AUTH_REQUIRED",
            401,
            "Agent authentication is required",
          );
        }

        if (!options.deviceIdentities) {
          throw new AppError(
            "DEVICE_IDENTITY_UNAVAILABLE",
            503,
            "Device identity binding is not available",
          );
        }

        const agentId = String(req.params.agentId ?? "").trim().toLowerCase();
        if (!UUID.test(agentId)) {
          throw new AppError("AGENT_INVALID", 400, "agentId must be a UUID");
        }

        if (agentId !== principal.agentId.toLowerCase()) {
          throw new AppError(
            "DEVICE_IDENTITY_REJECTED",
            403,
            "Agent may only bind its own device identity",
          );
        }

        const publicKeyEd25519 = readString(req.body, "publicKeyEd25519").trim();
        if (publicKeyEd25519.length === 0) {
          throw new AppError(
            "DEVICE_IDENTITY_INVALID",
            400,
            "publicKeyEd25519 is required",
          );
        }

        const bodyKeys = Object.keys(
          typeof req.body === "object" && req.body !== null
            ? (req.body as Record<string, unknown>)
            : {},
        );
        if (bodyKeys.some((k) => k !== "publicKeyEd25519")) {
          throw new AppError(
            "DEVICE_IDENTITY_INVALID",
            400,
            "only publicKeyEd25519 is accepted",
          );
        }

        const outcome = await options.deviceIdentities.bindForAgent(
          principal.tenantId,
          principal.agentId,
          publicKeyEd25519,
        );

        if (!outcome.ok) {
          if (outcome.reason === "malformed_key") {
            throw new AppError(
              "DEVICE_IDENTITY_INVALID",
              400,
              outcome.message,
            );
          }
          if (outcome.reason === "revoked") {
            throw new AppError(
              "DEVICE_IDENTITY_REVOKED",
              400,
              "Device identity is revoked",
            );
          }
          throw new AppError(
            "DEVICE_IDENTITY_REJECTED",
            400,
            "Device identity cannot be bound",
          );
        }

        const status = outcome.status === "created" ? 201 : 200;
        res.status(status).json({
          ok: true,
          data: {
            deviceIdentityId: outcome.identity.id,
            agentId: outcome.identity.agentId,
            status: outcome.identity.status,
            publicKeyEd25519: outcome.identity.publicKeyEd25519,
            createdAt: outcome.identity.createdAt.toISOString(),
          },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /v1/agents/:agentId/device-identity/revoke — operator revoke.
   */
  router.post(
    "/:agentId/device-identity/revoke",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);

        if (principal.agentId) {
          throw new AppError(
            "AGENTS_REJECTED",
            403,
            "Device identity revoke requires an operator principal",
          );
        }

        if (!options.deviceIdentities) {
          throw new AppError(
            "DEVICE_IDENTITY_UNAVAILABLE",
            503,
            "Device identity binding is not available",
          );
        }

        const agentId = String(req.params.agentId ?? "").trim().toLowerCase();
        if (!UUID.test(agentId)) {
          throw new AppError("AGENT_INVALID", 400, "agentId must be a UUID");
        }

        const outcome = await options.deviceIdentities.revokeForAgent(
          principal.tenantId,
          agentId,
        );

        if (!outcome.ok) {
          logLifecycle("warn", "device_identity_revoke_miss", {
            requestId: req.requestId,
            tenantId: principal.tenantId,
          });
          throw new AppError(
            "DEVICE_IDENTITY_REVOKE_REJECTED",
            400,
            "Device identity cannot be revoked",
          );
        }

        res.status(200).json({
          ok: true,
          data: {
            agentId,
            deviceIdentityId: outcome.identity.id,
            revoked: true,
          },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  /**
   * POST /v1/agents/:agentId/credentials/revoke — revoke the active credential.
   * Existing agent access JWTs remain valid until expiry (denylist deferred).
   */
  router.post(
    "/:agentId/credentials/revoke",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const principal = requirePrincipal(req);

        if (!options.agentsService) {
          throw new AppError(
            "AGENTS_UNAVAILABLE",
            503,
            "Agent enrollment is not available",
          );
        }

        const agentId = String(req.params.agentId ?? "").trim().toLowerCase();
        if (!UUID.test(agentId)) {
          throw new AppError("AGENT_INVALID", 400, "agentId must be a UUID");
        }

        const revoked = await options.agentsService.revokeCredential(
          principal.tenantId,
          agentId,
        );

        if (!revoked) {
          logLifecycle("warn", "agent_revoke_miss", {
            requestId: req.requestId,
            tenantId: principal.tenantId,
          });
          // Non-oracular: unknown agent / already revoked / other tenant.
          throw new AppError(
            "AGENT_REVOKE_REJECTED",
            400,
            "Credential cannot be revoked",
          );
        }

        res.status(200).json({
          ok: true,
          data: { agentId, revoked: true },
          requestId: req.requestId,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
