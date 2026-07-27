/**
 * Minimal OIDC discovery: fetch the provider metadata document and extract the
 * endpoints needed to verify ID tokens.
 *
 * The discovered `issuer` must equal the configured issuer. This is a trust
 * check, not a formality: a rogue or misdirected metadata document could
 * otherwise point the verifier at attacker-controlled keys.
 */

export interface OidcEndpoints {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
}

type FetchLike = typeof globalThis.fetch;

export async function discoverOidc(
  issuer: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<OidcEndpoints> {
  const base = issuer.replace(/\/$/, "");
  const url = `${base}/.well-known/openid-configuration`;

  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  }

  const doc = (await res.json()) as {
    issuer?: unknown;
    authorization_endpoint?: unknown;
    token_endpoint?: unknown;
    jwks_uri?: unknown;
  };

  if (doc.issuer !== issuer) {
    throw new Error(
      `OIDC discovery issuer mismatch: configured "${issuer}", document "${String(doc.issuer)}".`,
    );
  }

  if (
    typeof doc.authorization_endpoint !== "string" ||
    typeof doc.token_endpoint !== "string" ||
    typeof doc.jwks_uri !== "string"
  ) {
    throw new Error(
      "OIDC discovery document is missing authorization_endpoint, token_endpoint, or jwks_uri.",
    );
  }

  return {
    issuer: doc.issuer,
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwksUri: doc.jwks_uri,
  };
}
