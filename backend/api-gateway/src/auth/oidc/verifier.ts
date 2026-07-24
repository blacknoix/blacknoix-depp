import type { JWTPayload, JWTVerifyGetKey } from "jose";

import type { FederatedIdentity } from "../../users/repository";
import type { OidcConfig } from "./config";

/**
 * Verifies an upstream OIDC authorization-code callback and returns a verified
 * federated identity — the only shape allowed to reach the auth service.
 *
 * The signature check is delegated to jose (the JOSE reference implementation);
 * this module owns the composition and the fail-closed claim mapping. jose is
 * loaded by dynamic import because it is ESM-only and this package is CommonJS;
 * this path is async anyway (network token exchange + JWKS), so it costs
 * nothing and keeps the synchronous AuthStrategy untouched.
 *
 * The algorithm allowlist is fixed to RS256: an ID token is only accepted if it
 * is signed with the expected asymmetric algorithm against the provider's JWKS.
 * jose additionally enforces exact issuer and audience and rejects expired
 * tokens; "none" and other algorithms never pass.
 */

export class OidcVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcVerificationError";
  }
}

export interface OidcCallbackParams {
  code: string;
  /** The PKCE verifier stored at initiation; sent in the code exchange. */
  codeVerifier: string;
  /** The nonce stored at initiation; must equal the ID token's nonce claim. */
  nonce: string;
}

export interface OidcVerifier {
  verifyCallback(params: OidcCallbackParams): Promise<FederatedIdentity>;
}

export interface OidcVerifierDeps {
  /** Exchanges an authorization code (with its PKCE verifier) for the ID token. */
  exchangeCode: (code: string, codeVerifier: string) => Promise<string>;
  /** jose key resolver: a remote JWKS in production, a local one in tests. */
  keySet: JWTVerifyGetKey;
}

let josePromise: Promise<typeof import("jose")> | undefined;
function jose(): Promise<typeof import("jose")> {
  josePromise ??= import("jose");
  return josePromise;
}

const ALLOWED_ALGORITHMS = ["RS256"];

function toFederatedIdentity(payload: JWTPayload): FederatedIdentity {
  const issuer = typeof payload.iss === "string" ? payload.iss : "";
  const subject = typeof payload.sub === "string" ? payload.sub : "";

  if (!issuer || !subject) {
    throw new OidcVerificationError("ID token is missing a required iss or sub claim.");
  }

  // Email is a presentation field and is only trusted when the provider asserts
  // it is verified. An unverified or absent email is simply omitted.
  const emailVerified = payload.email_verified === true;
  const email =
    emailVerified && typeof payload.email === "string" ? payload.email : undefined;

  const displayName = typeof payload.name === "string" ? payload.name : undefined;

  return { issuer, subject, email, displayName };
}

export function createOidcVerifier(
  config: OidcConfig,
  deps: OidcVerifierDeps,
): OidcVerifier {
  return {
    async verifyCallback({ code, codeVerifier, nonce }) {
      const idToken = await deps.exchangeCode(code, codeVerifier);

      const { jwtVerify } = await jose();

      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(idToken, deps.keySet, {
          issuer: config.issuer,
          audience: config.clientId,
          algorithms: ALLOWED_ALGORITHMS,
        }));
      } catch (err) {
        throw new OidcVerificationError(
          `ID token verification failed: ${(err as Error).message}`,
        );
      }

      // Nonce binding: the ID token must carry the nonce minted at initiation.
      // jose validated the signature/issuer/audience/expiry; this ties the token
      // to *this* login and blocks replay of an otherwise-valid token.
      if (typeof payload.nonce !== "string" || payload.nonce !== nonce) {
        throw new OidcVerificationError("ID token nonce does not match initiation.");
      }

      return toFederatedIdentity(payload);
    },
  };
}
