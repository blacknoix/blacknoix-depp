import {
  issueAgentAccessToken,
  type IssuedAgentTokens,
  type JwtConfig,
} from "../auth/jwt/access-token";
import type { AgentInventoryRow } from "./inventory";
import type { AgentsRepository } from "./repository";

export interface AgentsService {
  register(
    tenantId: string,
    name: string,
  ): Promise<{ agentId: string; name: string; credential: string }>;

  /**
   * Exchanges a long-lived agent credential for a short-lived access JWT.
   * Failures are non-oracular at the HTTP layer (same 401).
   */
  exchangeForAccessToken(
    tenantId: string,
    agentId: string,
    credential: string,
  ): Promise<
    | { ok: true; tokens: IssuedAgentTokens }
    | { ok: false; reason: "invalid" | "revoked" }
  >;

  revokeCredential(tenantId: string, agentId: string): Promise<boolean>;

  /** Operator inventory for the Agents console. */
  listInventory(
    tenantId: string,
    options?: { limit?: number },
  ): Promise<AgentInventoryRow[]>;
}

export interface AgentsServiceDeps {
  agents: AgentsRepository;
  /** Required for credential → access-token exchange; inventory does not need it. */
  jwtConfig?: JwtConfig;
}

export function createAgentsService(deps: AgentsServiceDeps): AgentsService {
  const { agents, jwtConfig } = deps;

  return {
    async register(tenantId, name) {
      return agents.register(tenantId, name);
    },

    async exchangeForAccessToken(tenantId, agentId, credential) {
      if (!jwtConfig) {
        return { ok: false, reason: "invalid" };
      }

      const outcome = await agents.exchangeCredential(
        tenantId,
        agentId,
        credential,
      );

      if (!outcome.ok) {
        return outcome;
      }

      const accessToken = issueAgentAccessToken(jwtConfig, {
        tenantId,
        agentId: outcome.agentId,
      });

      return {
        ok: true,
        tokens: {
          accessToken,
          tokenType: "Bearer",
          expiresIn: jwtConfig.accessTtlSeconds,
        },
      };
    },

    async revokeCredential(tenantId, agentId) {
      return agents.revokeActiveCredential(tenantId, agentId);
    },

    async listInventory(tenantId, options = {}) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("listInventory requires a non-empty tenantId");
      }
      return agents.listInventory(tenantId, options);
    },
  };
}
