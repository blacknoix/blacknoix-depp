import type { OidcConfig } from "./config";
import { generateNonce, generatePkce, generateState } from "./pkce";
import type { OidcInitiationStore } from "./store";
import type { OidcVerifier } from "./verifier";
import type { FederatedIdentity } from "../../users/repository";

/**
 * Orchestrates OIDC login integrity: it creates the initiation record on
 * `start` and, on `complete`, refuses any callback that does not match a live,
 * unconsumed record and whose exchange + ID token are not bound to that
 * record's PKCE verifier and nonce.
 *
 * jose (via the injected verifier) remains the sole cryptographic authority for
 * the ID token; this service adds the binding around it. The tenant is taken
 * from configuration and carried in the record — never from the request.
 */

export class OidcInitiationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcInitiationError";
  }
}

export interface CompletedLogin {
  tenantId: string;
  identity: FederatedIdentity;
}

export interface OidcLoginService {
  /** Creates and stores an initiation record; returns the provider redirect URL. */
  start(): Promise<{ redirectUrl: string }>;
  /** Verifies state + PKCE + nonce and returns the verified identity + tenant. */
  complete(params: { state: string; code: string }): Promise<CompletedLogin>;
}

export interface OidcLoginServiceDeps {
  config: OidcConfig;
  store: OidcInitiationStore;
  verifier: OidcVerifier;
  authorizationEndpoint: () => Promise<string>;
  /** Overridable for deterministic tests. */
  now?: () => number;
  generate?: {
    state: () => string;
    nonce: () => string;
    pkce: () => { verifier: string; challenge: string };
  };
}

export function createOidcLoginService(deps: OidcLoginServiceDeps): OidcLoginService {
  const { config, store, verifier } = deps;
  const now = deps.now ?? (() => Date.now());
  const gen = deps.generate ?? {
    state: generateState,
    nonce: generateNonce,
    pkce: generatePkce,
  };

  return {
    async start() {
      const issuedAt = now();
      const state = gen.state();
      const nonce = gen.nonce();
      const { verifier: codeVerifier, challenge } = gen.pkce();

      await store.put({
        state,
        nonce,
        codeVerifier,
        tenantId: config.tenantId,
        createdAt: issuedAt,
        expiresAt: issuedAt + config.initiationTtlSeconds * 1000,
      });

      const url = new URL(await deps.authorizationEndpoint());
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.redirectUri);
      url.searchParams.set("scope", config.scope);
      url.searchParams.set("state", state);
      url.searchParams.set("nonce", nonce);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");

      return { redirectUrl: url.toString() };
    },

    async complete({ state, code }) {
      // Consume first: single-use, and removing the record before the exchange
      // means a failed callback cannot be retried with the same state.
      const record = await store.consume(state, now());
      if (!record) {
        throw new OidcInitiationError(
          "No live initiation record for the supplied state.",
        );
      }

      // Binds the exchange to the stored PKCE verifier and the ID token to the
      // stored nonce; either mismatch throws inside the verifier.
      const identity = await verifier.verifyCallback({
        code,
        codeVerifier: record.codeVerifier,
        nonce: record.nonce,
      });

      return { tenantId: record.tenantId, identity };
    },
  };
}
