import type { JWTVerifyGetKey } from "jose";

import type { OidcConfig } from "./config";
import { discoverOidc } from "./discovery";
import { createOidcLoginService, type OidcLoginService } from "./login";
import type { OidcInitiationStore } from "./store";
import {
  createOidcVerifier,
  OidcVerificationError,
  type OidcVerifier,
} from "./verifier";

/**
 * Production wiring for the OIDC login service: discovery + remote JWKS +
 * PKCE-bound token exchange. This is network glue over jose and the pure login
 * service (both unit-tested with local keys and stubs); it is exercised
 * end-to-end against a real provider, not unit-tested.
 *
 * Discovery is lazy and memoised: it runs on the first start/callback rather
 * than at startup, so the service does not fail to boot merely because the
 * provider is briefly unreachable. If trust cannot be established, the request
 * fails closed.
 */

type FetchLike = typeof globalThis.fetch;

interface Discovered {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  keySet: JWTVerifyGetKey;
}

export function createRemoteOidcLoginService(
  config: OidcConfig,
  store: OidcInitiationStore,
  fetchImpl: FetchLike = globalThis.fetch,
): OidcLoginService {
  let discovered: Promise<Discovered> | undefined;

  function ensureDiscovered(): Promise<Discovered> {
    discovered ??= (async () => {
      const endpoints = await discoverOidc(config.issuer, fetchImpl);
      const { createRemoteJWKSet } = await import("jose");
      return {
        authorizationEndpoint: endpoints.authorizationEndpoint,
        tokenEndpoint: endpoints.tokenEndpoint,
        keySet: createRemoteJWKSet(new URL(endpoints.jwksUri)),
      };
    })();
    return discovered;
  }

  const verifier: OidcVerifier = {
    async verifyCallback(params) {
      const { tokenEndpoint, keySet } = await ensureDiscovered();

      const exchangeCode = async (code: string, codeVerifier: string): Promise<string> => {
        const body = new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code_verifier: codeVerifier,
        });

        const res = await fetchImpl(tokenEndpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        });

        if (!res.ok) {
          throw new OidcVerificationError(`token exchange failed: HTTP ${res.status}`);
        }

        const json = (await res.json()) as { id_token?: unknown };
        if (typeof json.id_token !== "string") {
          throw new OidcVerificationError("token response did not include an id_token.");
        }

        return json.id_token;
      };

      return createOidcVerifier(config, { exchangeCode, keySet }).verifyCallback(params);
    },
  };

  return createOidcLoginService({
    config,
    store,
    verifier,
    authorizationEndpoint: async () => (await ensureDiscovered()).authorizationEndpoint,
  });
}
