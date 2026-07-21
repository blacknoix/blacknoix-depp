# ADR-0002: Authentication Seam

- Status: Accepted
- Date: 2026-07-21
- Complemented by: ADR-0003 (production authentication mechanism)

## Context
api-gateway resolved tenant identity by reading the `x-tenant-id` header directly
in middleware, and route handlers depended on that header having been parsed.
The header is client-supplied and entirely unverified: any caller can claim any
tenant.

ADR-0001 requires that no query for tenant-owned data runs without tenant scope,
and names `users`, `roles`, and `user_roles` as tenant-owned entities. Satisfying
that requires an authenticated caller, not a header.

Real authentication needs a user store, and Postgres does not exist in this
repository yet. Building token verification, login, or credential handling now
would be untestable against real identities and would be rewritten once
persistence lands.

What was needed instead was a boundary: a place where authentication can be
substituted later without touching routes, plus a guarantee that the unverified
development path cannot reach production in the meantime.

## Decision
Introduce an authentication seam between the transport layer and business logic.

**1. `AuthenticatedPrincipal` is the single source of caller identity.**

Shape: `{ tenantId, userId?, roles? }`. Field names follow the ADR-0001 entities
rather than being invented here.

`userId` and `roles` are optional because the only strategy available today
cannot establish either — a bare header proves nothing about which user sent it.
Making them required would force placeholder values, encoding a falsehood in the
type system. A verified strategy must populate them.

**2. `AuthStrategy` is a single synchronous method: `authenticate(req)` returning
a principal or `undefined`.**

Returning `undefined` rather than throwing keeps two questions separate: *is
there a credential* (the strategy's concern) and *is one required here* (the
guard's concern). That separation is what allows `/` and `/health` to remain
public while `/v1/*` is tenant-scoped, without either rule being duplicated.

The method is synchronous because the only implemented strategy reads a header.
A strategy requiring I/O — JWKS fetch, token introspection, a database lookup —
will need the return type widened to permit a promise, and an `await` in
`middleware/authenticate.ts`. This is a deliberate deferral: adding asynchronous
plumbing with no asynchronous consumer would be speculative.

**3. Credential parsing lives in the strategy, never in middleware or routes.**

How a caller proves their identity is the authentication layer's concern. Route
handlers read `req.principal` and have no knowledge of headers, tokens, or
schemes. Replacing the strategy therefore touches one file rather than every
route.

**4. `AUTH_MODE` selects the strategy, and unrecognised values are rejected.**

Startup fails on any mode not explicitly implemented. A typo must never fall back
to a default, because the failure mode of a silent fallback is running with
weaker authentication than intended while appearing healthy.

**5. Unverified modes cannot run in production.**

`resolveAuthMode` throws when `NODE_ENV=production` and the selected mode
performs no verification. The guard exists because developer discipline is not a
control: without it, nothing prevents the stand-in reaching a production
deployment, and the failure would be silent rather than loud.

## Consequences

**The service cannot start with `NODE_ENV=production`.** `dev-header` is the only
implemented mode and is banned there, so there is currently no configuration in
which this service runs in production. This is intentional and fail-closed: no
production-safe authentication exists yet, and refusing to boot is the honest
outcome. The constraint lifts when the mode chosen in ADR-0003 is implemented.

In development the header remains entirely unverified. This ADR relocates and
gates the weakness; it does not remove it. DEPP must not handle real tenant data
until a verified mode exists.

`req.tenantId` no longer exists. `req.principal?.tenantId` is the only source of
tenant identity, including in structured logs and error reporting.

Adding a strategy means implementing `AuthStrategy` and registering it in
`AUTH_MODES` and `STRATEGIES`. No route, guard, or logging changes are required.

`AUTH_MODE` becomes a configuration axis every environment must set correctly.
The fail-closed guard is what keeps that from being a footgun; without it this
change would be net-negative.

Externally observable behaviour is unchanged: the same tenant-id validation
rules, the same `400 TENANT_REQUIRED` response, and the same public routes.

## Deferred to ADR-0003
This ADR deliberately does not choose an authentication mechanism. The following
are out of scope here and must be decided in ADR-0003:

- Token format and verification — signed JWT versus opaque token with
  introspection.
- Session model, expiry, and revocation.
- Credential storage — whether DEPP stores credentials at all.
- Identity federation (OIDC / SAML). Enterprise buyers commonly require SSO, and
  the answer materially changes the data model.
- Agent and API-key authentication for endpoint enrolment (product priority 3),
  which may warrant a separate strategy from human users.
- `requireRole` and RBAC enforcement, which are blocked until a verified strategy
  can supply roles.

Sequencing: ADR-0003 should be decided **before** the persistence slice. Designing
`users` and credential tables without knowing whether DEPP stores credentials or
federates identity would guarantee rework.

## Notes
ADR-0003 selects the production authentication mechanism. It **complements** this
ADR rather than superseding it: the seam described here — the principal shape,
strategy indirection, and fail-closed mode resolution — remains the design that a
verified mode plugs into. Only the statement that `dev-header` is the only
implemented mode, and the production boot ban that follows from it, expire once
that mode exists.
