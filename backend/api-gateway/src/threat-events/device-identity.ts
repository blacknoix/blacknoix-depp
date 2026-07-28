import { logLifecycle } from "../lib/log";
import type { DeviceIdentityRepository, DeviceIdentityRow } from "./device-identity-repository";
import { parseEd25519PublicKeyBase64Url } from "./signature";

export type BindDeviceIdentityOutcome =
  | { ok: true; status: "created" | "idempotent"; identity: DeviceIdentityRow }
  | {
      ok: false;
      reason:
        | "malformed_key"
        | "revoked"
        | "conflict"
        | "agent_mismatch";
      message: string;
    };

export type RevokeDeviceIdentityOutcome =
  | { ok: true; identity: DeviceIdentityRow }
  | { ok: false; reason: "not_found" };

export interface DeviceIdentityService {
  /**
   * Agent self-bind: attach an Ed25519 public key to the caller's agent.
   * Creates status=active. Same key is idempotent; different key conflicts.
   * Revoked identities cannot be rebound in this slice.
   */
  bindForAgent(
    tenantId: string,
    agentId: string,
    publicKeyEd25519: string,
  ): Promise<BindDeviceIdentityOutcome>;

  /** Operator revoke of the agent's device identity. */
  revokeForAgent(
    tenantId: string,
    agentId: string,
    at?: Date,
  ): Promise<RevokeDeviceIdentityOutcome>;
}

export interface DeviceIdentityServiceDeps {
  deviceIdentities: DeviceIdentityRepository;
  now?: () => Date;
}

export function createDeviceIdentityService(
  deps: DeviceIdentityServiceDeps,
): DeviceIdentityService {
  const { deviceIdentities } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async bindForAgent(tenantId, agentId, publicKeyEd25519) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("bindForAgent requires a non-empty tenantId");
      }
      if (typeof agentId !== "string" || agentId.trim() === "") {
        throw new Error("bindForAgent requires a non-empty agentId");
      }

      const parsed = parseEd25519PublicKeyBase64Url(publicKeyEd25519);
      if (!parsed.ok) {
        return {
          ok: false,
          reason: "malformed_key",
          message: parsed.message,
        };
      }

      const normalizedKey = parsed.raw.toString("base64url");
      const existing = await deviceIdentities.findByAgentId(tenantId, agentId);

      if (existing) {
        if (existing.status === "revoked") {
          return {
            ok: false,
            reason: "revoked",
            message: "device identity is revoked",
          };
        }
        if (existing.publicKeyEd25519 === normalizedKey) {
          return { ok: true, status: "idempotent", identity: existing };
        }
        return {
          ok: false,
          reason: "conflict",
          message: "agent already has a different device identity",
        };
      }

      try {
        const identity = await deviceIdentities.insert(tenantId, {
          agentId,
          publicKeyEd25519: normalizedKey,
          status: "active",
        });
        logLifecycle("info", "device_identity_bound", {
          tenantId,
          agentId,
          deviceIdentityId: identity.id,
        });
        return { ok: true, status: "created", identity };
      } catch (err) {
        // Unique (tenant, public_key) or missing agent FK → fail closed.
        logLifecycle("warn", "device_identity_bind_rejected", {
          tenantId,
          agentId,
          errorName: err instanceof Error ? err.name : "unknown",
        });
        return {
          ok: false,
          reason: "conflict",
          message: "device identity cannot be bound",
        };
      }
    },

    async revokeForAgent(tenantId, agentId, at = now()) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("revokeForAgent requires a non-empty tenantId");
      }
      if (typeof agentId !== "string" || agentId.trim() === "") {
        throw new Error("revokeForAgent requires a non-empty agentId");
      }

      const identity = await deviceIdentities.revoke(tenantId, agentId, at);
      if (!identity) {
        return { ok: false, reason: "not_found" };
      }
      logLifecycle("info", "device_identity_revoked", {
        tenantId,
        agentId,
        deviceIdentityId: identity.id,
      });
      return { ok: true, identity };
    },
  };
}
