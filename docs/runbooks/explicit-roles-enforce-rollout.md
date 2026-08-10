# Explicit-roles enforce rollout

Operational checklist for switching `AUTH_EXPLICIT_ROLES_MODE` from `compat` to
`enforce` (ADR-0011).

This runbook does **not** authorize Helm chart changes, Platform image
scan/provenance, deployment-posture cutover, heartbeat cutover, Legal work, or
any infrastructure-owned deployment action. It only covers api-gateway
authorization-mode readiness for human JWT role claims.

## Background

| Mode | Behavior |
|---|---|
| `compat` (default when unset) | Missing/empty/unsupported-only human roles remain temporary operator-equivalent on role-gated helpers; rate-limited `implicit_operator_compat` warnings. |
| `enforce` | Missing/empty/unsupported-only human roles are denied on protected human routes. Explicit `operator` / `auditor` only. |

Invalid `AUTH_EXPLICIT_ROLES_MODE` values fail closed at startup. Do **not**
infer the mode from `NODE_ENV`.

**JWT `roles` claim (human access tokens):** JSON array of strings; supported
values `operator` and `auditor`; normalized (trim, lower-case, dedupe, drop
unknown). See ADR-0011 § “JWT roles claim contract”.

**Transitional minting:** `AuthService` login/refresh currently mint
`roles: ["operator"]`. That is a bridge until authoritative issuer mapping
lands. Agent JWTs omit human `roles`.

**Dev-only:** `dev-header` `x-roles` is not a production auth source.

## Before switching

1. Confirm the issuer path that will run in the target environment emits a
   validated `roles` claim for every intended human principal:
   - either transitional AuthService minting (`["operator"]`), or
   - an approved future IdP/issuer mapping (not implemented in this repo).
2. Confirm approved values are only `operator` and/or `auditor`.
3. Confirm login and refresh preserve/reissue intended roles (see
   `tests/auth/service-roles.test.ts`).
4. Run enforce-readiness validation from `backend/api-gateway/`:
   ```bash
   npm run test:unit -- --test-name-pattern "enforce-mode readiness"
   ```
   Or run the full unit suite: `npm run test:unit`.
5. Confirm local/test/proof tooling uses explicit roles (heartbeat proof already
   mints `roles: ["operator"]`; prefer `x-roles: operator|auditor` in new
   `dev-header` tests).
6. Review bounded `implicit_operator_compat` warning volume and disposition any
   remaining legacy callers that omit roles.
7. Confirm no protected human production workflow depends on missing role
   claims under compat elevation.

## Switching

1. Set in the deployment environment:
   ```text
   AUTH_EXPLICIT_ROLES_MODE=enforce
   ```
2. Restart/redeploy api-gateway through the established operational process for
   that environment (owner: whoever operates the service — **not** implied by
   this runbook).
3. Do not use `NODE_ENV` as a substitute for the explicit setting.
4. Confirm startup rejects invalid mode values (same fail-closed pattern as
   `AUTH_MODE`).

## After switching

1. Monitor authorization denials and auth failures using existing safe
   observability (structured logs; never log JWTs, bearer tokens, or raw
   secrets). Watch for unexpected `AUDIT_REJECTED`, `AGENTS_REJECTED`,
   `TELEMETRY_QUERY_REJECTED`, `FINDINGS_REJECTED`, `TENANT_SELF_REJECTED`.
2. Verify core flows:
   - operator: audit, agents, telemetry query, findings, tenants/me
   - auditor: audit + tenants/me only
   - agent: token exchange, telemetry ingest, threat-event submit as applicable
3. **Rollback (temporary incident mitigation only):**
   - set `AUTH_EXPLICIT_ROLES_MODE=compat`
   - restart/redeploy via the same operational process
   - document the missing or incorrect issuer role mapping
   - remediate mapping before retrying `enforce`

## Transitional minting exit criteria

Do **not** remove AuthService `roles: ["operator"]` minting until **all** of
the following are true:

1. An authoritative issuer/IdP mapping exists and is approved by the
   appropriate identity/Platform owner.
2. Login and refresh receive or derive approved explicit roles from that source
   (not hardcoded transitional minting).
3. Operator and auditor role mappings are documented and tested.
4. Enforce-readiness validation passes using issuer-mapped role claims (not
   only transitional minting).
5. Production/controlled environments have operated in `enforce` without
   depending on compat elevation for an agreed observation period.
6. `implicit_operator_compat` warnings are absent or explicitly dispositioned.
7. Rollback and incident procedures (this runbook) remain documented.
8. Security review confirms no human privilege relies on role absence or
   default elevation.

This slice defines exit criteria only; transitional minting remains in place.

## Related

- ADR-0011 — staged explicit-role migration and JWT roles claim contract
- ADR-0010 — auditor least-privilege audit read
- ADR-0003 — production authentication direction
- `backend/api-gateway/tests/auth/enforce-readiness.test.ts`
