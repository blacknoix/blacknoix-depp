# Explicit-roles enforce rollout

Operational checklist for switching `AUTH_EXPLICIT_ROLES_MODE` from `compat` to
`enforce` (ADR-0011).

This runbook does **not** authorize Helm chart changes, Platform image
scan/provenance, deployment-posture cutover, heartbeat cutover, Legal work, or
any infrastructure-owned deployment action. It only covers api-gateway
authorization-mode readiness for human JWT role claims on routes included in
the explicit-roles foundation.

## Background

| Mode | Behavior |
|---|---|
| `compat` | Missing/empty/unsupported-only human roles remain temporary operator-equivalent on role-gated helpers; rate-limited `implicit_operator_compat` warnings. Transitional — not enforce-equivalent. |
| `enforce` | Missing/empty/unsupported-only human roles are denied on protected human routes wired in this foundation (findings, tenants/me). |

**Startup:** `config/env.ts` parses `AUTH_EXPLICIT_ROLES_MODE` via
`applyExplicitRolesModeFromEnv` before the server accepts requests. Invalid
values fail closed at startup.

**Verified JWT:** when `AUTH_MODE=jwt`, the mode **must** be set explicitly
(`compat` or `enforce`). Unset fails startup. Do **not** infer the mode from
`NODE_ENV`.

**JWT `roles` claim (human access tokens):** JSON array; supported values
`operator` and `auditor`; normalized via `normalizeDeppRoles`.

**Transitional minting:** `AuthService` login/refresh currently mint
`roles: ["operator"]`. Bridge only — not authoritative IdP mapping. Agent JWTs
omit human `roles`.

**Dev-only:** `dev-header` `x-roles` is not a production auth source and does
not make enforce permissive for JWT principals.

**Deferred on this foundation (do not treat as enforce-covered):** durable
audit-log HTTP (`GET /v1/audit/logs`). Auditor-capable human surface today:
`GET /v1/tenants/me`.

**Wired operator-only (humans):** agent inventory, human enroll, credential
revoke, device-identity revoke, telemetry GET/query.

**Wired agent-only:** telemetry ingest/batch, device-identity bind, threat-event
submit.

## Before switching

1. Confirm the issuer path emits a validated `roles` claim for every intended
   human principal (transitional AuthService minting or future IdP mapping).
2. Confirm approved values are only `operator` and/or `auditor`.
3. Confirm login and refresh preserve/reissue intended roles
   (`tests/auth/service-roles.test.ts`).
4. From `backend/api-gateway/`:
   ```bash
   npm run test:unit -- --test-name-pattern "startup-driven AUTH_EXPLICIT_ROLES_MODE|enforce-mode readiness"
   ```
   Or full unit suite: `npm run test:unit`.
5. Prefer explicit roles in local tooling (`x-roles` for `dev-header` only).
6. Confirm no protected human production workflow depends on missing role
   claims under compat elevation for **wired** routes (findings, tenants/me).

## Switching

1. Set in the deployment environment:
   ```text
   AUTH_EXPLICIT_ROLES_MODE=enforce
   ```
2. If `AUTH_MODE=jwt`, ensure the variable is present (required at startup).
3. Restart/redeploy api-gateway through the established operational process for
   that environment (owner: whoever operates the service — **not** implied by
   this runbook).
4. Do not use `NODE_ENV` as a substitute for the explicit setting.
5. Confirm startup rejects invalid mode values.

## After switching

1. Monitor authorization denials using safe observability (never log JWTs or
   secrets). Watch for unexpected `FINDINGS_REJECTED`, `TENANT_SELF_REJECTED`,
   `AGENT_AUTH_REQUIRED`.
2. Verify core wired flows:
   - operator: findings, tenants/me, agents inventory/enroll, telemetry query
   - auditor: tenants/me only (not findings, agents management, or telemetry query)
   - agent: telemetry ingest/batch, device bind, threat-event submit as applicable
     (independent of human roles); agent self-scoped telemetry query only
3. **Rollback (temporary incident mitigation only):**
   - set `AUTH_EXPLICIT_ROLES_MODE=compat`
   - restart/redeploy via the same operational process
   - remediate issuer mapping before retrying `enforce`

## Transitional minting exit criteria

Do **not** remove AuthService `roles: ["operator"]` minting until **all** of
the following are true:

1. An authoritative issuer/IdP mapping exists and is approved by the
   appropriate identity/Platform owner.
2. Login and refresh receive or derive approved explicit roles from that source.
3. Operator and auditor role mappings are documented and tested.
4. Enforce-readiness validation passes using issuer-mapped role claims.
5. Controlled environments have operated in `enforce` without depending on
   compat elevation for an agreed observation period.
6. `implicit_operator_compat` warnings are absent or explicitly dispositioned.
7. Rollback procedures (this runbook) remain documented.
8. Security review confirms no human privilege relies on role absence.

This slice defines exit criteria only; transitional minting remains in place.

## Related

- ADR-0011 — staged explicit-role migration
- ADR-0010 — auditor role (audit HTTP deferred on this foundation)
- ADR-0003 — production authentication direction
- `backend/api-gateway/tests/auth/startup-explicit-roles.test.ts`
- `backend/api-gateway/tests/auth/enforce-readiness.test.ts`
