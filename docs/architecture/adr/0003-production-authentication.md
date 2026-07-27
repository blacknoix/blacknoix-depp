# ADR-0003: Production Authentication Mechanism

- Status: Accepted
- Date: 2026-07-21
- Complements: ADR-0002 (authentication seam)

## Context
ADR-0002 established a seam where an `AuthStrategy` resolves a request into an
`AuthenticatedPrincipal`, and deliberately deferred the mechanism. The only
implemented mode is `dev-header`, which is unverified and banned in production,
so api-gateway currently cannot start with `NODE_ENV=production` at all.

DEPP is sold to organisations. Enterprise buyers run their own identity provider,
expect to control application access from it, and treat immediate offboarding as
a procurement requirement. A security vendor storing its customers' passwords is
liability without differentiating value.

ADR-0001 requires tenant scope on every tenant-owned query, so identity must
carry tenant. Persistence does not exist yet, which makes this the right moment
to decide: the identity schema should be designed once, not retrofitted.

## Decision

### 1. Human identity is federated. DEPP stores no human credentials.
Tenant users authenticate to their own organisation's IdP over OIDC. DEPP
platform administrators authenticate to DEPP's own IdP, also over OIDC. One
mechanism, different issuers.

There are no passwords, no reset flows, no MFA implementation, and no
credential-stuffing surface, because there is nothing to stuff. MFA and password
policy are the customer's IdP's responsibility, which is where their security
team already manages them.

### 2. OIDC now, SAML deferred.
OIDC covers Entra ID, Okta, Google Workspace, Auth0, and Ping. SAML is deferred
until a specific deal requires it; adding it is a new `AuthStrategy`, not a
redesign, which is what the ADR-0002 seam was for.

### 3. IdP configuration is per tenant.
Each tenant registers its own issuer. This introduces a tenant-owned
`tenant_idp_configs` entity holding: issuer URL, client ID, client secret
(encrypted at rest), discovery or JWKS URI, allowed email domains, claim mapping
(subject, email, roles claim), and an enabled flag.

**Tenant routing.** A login request must identify the tenant before the IdP is
known. The primary path is a tenant-specific entry point (for example
`/auth/login?tenant=<slug>`), with email-domain lookup as a convenience.
Domain mapping alone is rejected as the primary mechanism: it breaks when
organisations share a domain (contractors, acquisitions) and it leaks tenant
existence to probing.

### 4. DEPP issues its own tokens: short-lived access JWT plus server-side refresh.
DEPP does not forward IdP tokens to its own API. IdP tokens carry the IdP's
lifetime and claims, not DEPP's tenant and role model. After a successful OIDC
exchange, DEPP issues its own tokens, giving one uniform verification path and
decoupling session lifetime from the IdP.

- **Access token**: DEPP-signed JWT, 15 minute lifetime, verified statelessly.
  Carries tenant id, user id, roles, session id, issuer, expiry.
- **Refresh token**: opaque and random, stored hashed, tenant-scoped, one-time
  use with rotation, bound to a session record.
- **Revocation**: ending a session removes its refresh token, so the session dies
  at the next refresh. The worst-case exposure window is one access-token
  lifetime.

The 15 minute value is a starting point, not a fixed constant; it trades
revocation latency against refresh traffic and should be configurable.

### 5. Agents have a separate machine-identity path.
Agents cannot perform an interactive login, and their lifecycle is different:
enrol, run unattended for months, rotate, decommission. They get their own
strategy.

An authorised human issues a short-lived, tenant-scoped enrolment token. The
agent presents it once and receives a per-agent credential, stored hashed. For
ongoing requests the agent exchanges that credential for a short-lived access
token using the same verification path as human sessions — telemetry ingestion is
high volume, and a credential lookup per request would not hold up. Revocation
happens at exchange, matching the human model.

**Scope note:** "DEPP stores no credentials" applies to *human* identity. Agent
secrets are machine identity: no human chooses them, they are never reused across
services, and rotation is automated. They are stored hashed.

### 6. Roles come from IdP claims, with DEPP mappings as a compatibility layer.
The default source of roles is a configured claim in the IdP token, so tenant
administrators manage access where they already manage it.

Some IdPs cannot express application-specific roles cleanly. For those tenants,
DEPP persists tenant-scoped role assignments as a fallback.

**Precedence must be explicit per tenant, not implicit.** A tenant is configured
either for claim-sourced roles or for DEPP-assigned roles. Silently falling back
when a claim is missing would make effective permissions unexplainable, and
"why did this user have that access" is a question auditors ask.

ADR-0001's `roles` and `user_roles` remain, but `user_roles` becomes a
compatibility layer rather than the primary source of truth.

### 7. Break-glass is out-of-band. There is no fallback login path.
No emergency local account exists. If DEPP's own IdP becomes unavailable,
recovery is a documented out-of-band procedure: direct database access by a named
operator, under change control, with the action written to the audit trail
afterwards.

A permanent emergency login is a permanent attack surface maintained for a rare
event, and it is the first thing an attacker looks for. The accepted cost is that
recovery is slower and requires infrastructure access.

### 8. `dev-header` remains, development-only.
Developer laptops have no IdP. `dev-header` stays exactly as it is, including the
production ban. A mock-OIDC development mode was considered and rejected for now:
more machinery for the same outcome. Worth revisiting when the OIDC strategy is
implemented.

### 9. Federated identity resolves to a stable DEPP user record.
Every authenticated human maps to a row in the tenant-owned `users` table
(ADR-0001). The mapping key is the pair `(issuer, subject)` from the IdP token,
not email: email is mutable and can be reassigned, whereas the IdP `sub` is
stable for the life of the account. `users` stores that issuer and subject
alongside a DEPP-generated `user_id`; email and display name are cached for
presentation only and are never an identity key.

A user row is created or linked on the first successful OIDC exchange
(just-in-time provisioning), scoped to the tenant whose IdP authenticated the
request. `sessions`, `refresh_tokens`, and `user_roles` all reference the DEPP
`user_id`, so identity survives an email change or an IdP-side rename.

Rationale: without a stable internal identifier, sessions and role assignments
would be pinned to a mutable external attribute. A tenant administrator renaming
a user in their IdP could then silently orphan that user's sessions or, worse,
hand their access to whoever next received the old email.

## Effect on ADR-0002 and existing code
- `AuthStrategy.authenticate` must widen to permit a promise. OIDC verification
  requires fetching and caching JWKS. ADR-0002 named this as the expected trigger.
- `AUTH_MODES` gains an OIDC mode for humans and a strategy for agents.
  `UNVERIFIED_MODES` is unchanged: `dev-header` remains unverified.
- Once a verified mode exists, the production boot ban lifts. That is the single
  observable change to current behaviour.
- `AuthenticatedPrincipal` gains a session id, and `userId` / `roles` become
  populated rather than absent.

## New entities
Extending, not rewriting, ADR-0001's entity list.

Tenant-owned:
- `users` — extends ADR-0001's entry: holds the `(issuer, subject)` IdP linkage
  and a DEPP-generated `user_id`, with email and display name cached for
  presentation only. It is the identity anchor that sessions and roles reference.
- `tenant_idp_configs`
- `sessions`
- `refresh_tokens`
- agent credentials (either a new table or an extension of `agents` /
  `agent_enrollments`)

Platform-global:
- none required. DEPP's own IdP configuration may live in environment
  configuration rather than a table; decide at implementation.

## Consequences
- No password database, and offboarding in the tenant's IdP takes effect at the
  next token refresh. Both are strong answers in an enterprise security review.
- There is no self-service signup. Onboarding requires a working IdP, and tenant
  provisioning becomes an operator action.
- Revocation is not instantaneous. A compromised access token remains valid for
  up to its lifetime. Accepted deliberately; a denylist is deferred.
- If a tenant's IdP is down, that tenant's users cannot log in. This is standard
  for SSO-only products but belongs in customer-facing documentation, not just
  here.
- Client secrets and agent credentials require encryption at rest, so key
  management becomes a real infrastructure requirement rather than a later
  detail.
- The persistence slice now has a concrete identity schema to build against,
  which was the point of deciding this first.

## Deferred
- SAML federation.
- Immediate-revocation denylist for compromised sessions.
- MFA policy, delegated to the IdP.
- SCIM or directory sync for user provisioning.
- Key management and secret encryption approach — likely its own infrastructure ADR.
- `requireRole` and the full RBAC permission matrix.
- Rate limiting and abuse protection on authentication endpoints.
- Audit-log schema for authentication events.

## Notes
This ADR complements ADR-0002 rather than superseding it. The seam described
there — principal shape, strategy indirection, fail-closed mode resolution —
remains correct; this ADR supplies the mechanism that plugs into it.
