/**
 * Configuration for one upstream OIDC provider used for human login.
 *
 * A single provider maps to a single DEPP tenant in this slice (ADR-0003's
 * per-tenant tenant_idp_configs is the deferred multi-tenant form). The tenant a
 * login belongs to therefore comes from configuration, never from the browser.
 *
 * resolveOidcConfig is pure and fails closed: if the provider is enabled
 * (OIDC_ISSUER present) but any required value is missing or invalid, it throws
 * at startup rather than mounting a route that cannot verify.
 */

export interface OidcConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  /** The DEPP tenant this provider authenticates. Must be a UUID. */
  readonly tenantId: string;
  /** OIDC scope; must include "openid". */
  readonly scope: string;
  /** Login-initiation record lifetime in seconds. */
  readonly initiationTtlSeconds: number;
}

const DEFAULT_SCOPE = "openid email profile";
const DEFAULT_INITIATION_TTL_SECONDS = 300;
const MIN_INITIATION_TTL_SECONDS = 30;
const MAX_INITIATION_TTL_SECONDS = 900;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`OIDC is enabled but ${name} is missing.`);
  }
  return trimmed;
}

/**
 * Returns the provider config, or undefined when OIDC is not enabled
 * (OIDC_ISSUER unset). Throws when it is enabled but misconfigured.
 */
export function resolveOidcConfig(
  env: Record<string, string | undefined>,
): OidcConfig | undefined {
  const rawIssuer = env.OIDC_ISSUER?.trim();
  if (!rawIssuer) {
    return undefined;
  }

  let issuerUrl: URL;
  try {
    issuerUrl = new URL(rawIssuer);
  } catch {
    throw new Error("OIDC_ISSUER must be a valid URL.");
  }
  if (issuerUrl.protocol !== "https:") {
    throw new Error("OIDC_ISSUER must be an https URL.");
  }

  const clientId = requireValue(env.OIDC_CLIENT_ID, "OIDC_CLIENT_ID");
  // Required: the authorization-code flow uses a confidential client.
  const clientSecret = requireValue(env.OIDC_CLIENT_SECRET, "OIDC_CLIENT_SECRET");

  const redirectUri = requireValue(env.OIDC_REDIRECT_URI, "OIDC_REDIRECT_URI");
  try {
    new URL(redirectUri);
  } catch {
    throw new Error("OIDC_REDIRECT_URI must be a valid URL.");
  }

  const tenantId = requireValue(env.OIDC_TENANT_ID, "OIDC_TENANT_ID");
  if (!UUID.test(tenantId)) {
    throw new Error("OIDC_TENANT_ID must be a UUID.");
  }

  const scope = env.OIDC_SCOPE?.trim() || DEFAULT_SCOPE;
  if (!scope.split(/\s+/).includes("openid")) {
    throw new Error('OIDC_SCOPE must include "openid".');
  }

  let initiationTtlSeconds = DEFAULT_INITIATION_TTL_SECONDS;
  const rawTtl = env.OIDC_INITIATION_TTL_SECONDS;
  if (rawTtl !== undefined && rawTtl.trim() !== "") {
    initiationTtlSeconds = Number(rawTtl);
    if (
      !Number.isInteger(initiationTtlSeconds) ||
      initiationTtlSeconds < MIN_INITIATION_TTL_SECONDS ||
      initiationTtlSeconds > MAX_INITIATION_TTL_SECONDS
    ) {
      throw new Error(
        `OIDC_INITIATION_TTL_SECONDS must be an integer between ${MIN_INITIATION_TTL_SECONDS} and ${MAX_INITIATION_TTL_SECONDS}.`,
      );
    }
  }

  return {
    issuer: rawIssuer,
    clientId,
    clientSecret,
    redirectUri,
    tenantId,
    scope,
    initiationTtlSeconds,
  };
}
