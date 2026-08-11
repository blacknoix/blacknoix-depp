# Staging enforce + alert evidence — capture template

**Instructions:** Copy this file to an operator-controlled evidence store.
Fill placeholders only. **Do not** commit filled copies containing real
identifiers, tokens, or secrets to git.

Related procedure: [../staging-enforce-alert-evidence.md](../staging-enforce-alert-evidence.md)

---

## Run metadata

| Field | Value |
|---|---|
| Run ID | `[RUN_ID]` |
| Environment | `[ENVIRONMENT]` |
| Recorder | `[RECORDER_ROLE_OR_HANDLE]` |
| Date (UTC) | `[DATE_UTC]` |
| api-gateway revision / image ref | `[REDACTED_REVISION_OR_DIGEST]` |
| Evidence class | Staging evidence (not code CI; not production) |

## Approvals

| Gate | Approver placeholder | Result |
|---|---|---|
| Security / product review of plan | `[APPROVER_SECURITY]` | `[APPROVAL_RESULT]` |
| Identity / IdP owner ready | `[APPROVER_IDENTITY]` | `[APPROVAL_RESULT]` |
| Platform / deployment owner ready | `[APPROVER_PLATFORM]` | `[APPROVAL_RESULT]` |
| Database / operator owner ready | `[APPROVER_DATABASE]` | `[APPROVAL_RESULT]` |
| Rollback authority named | `[ROLLBACK_AUTHORITY]` | `[APPROVAL_RESULT]` |

## Environment assertions (no secrets)

| Assertion | Expected | Observed | Result |
|---|---|---|---|
| `AUTH_MODE` | `jwt` | `[OBSERVED_AUTH_MODE]` | `[ASSERTION_RESULT]` |
| `AUTH_EXPLICIT_ROLES_MODE` | `enforce` | `[OBSERVED_EXPLICIT_ROLES_MODE]` | `[ASSERTION_RESULT]` |
| JWT signing material present | configured, not dumped | `[PRESENT_OR_MISSING]` | `[ASSERTION_RESULT]` |
| Issuer / audience match | match issued tokens | `[MATCH_OR_MISMATCH]` | `[ASSERTION_RESULT]` |
| Process serving under enforce | healthy | `[HEALTH_OBSERVATION]` | `[ASSERTION_RESULT]` |

## Principals (redacted)

| Principal | Placeholder | Notes |
|---|---|---|
| Tenant A | `[REDACTED_TENANT_A]` | Isolated non-production |
| Tenant B | `[REDACTED_TENANT_B]` | Isolated non-production |
| Operator subject (A) | `[REDACTED_OPERATOR_SUBJECT]` | `roles: ["operator"]` |
| Auditor subject (A) | `[REDACTED_AUDITOR_SUBJECT]` | `roles: ["auditor"]` |
| Role-less human subject (A) | `[REDACTED_ROLELESS_SUBJECT]` | Missing/empty/unsupported-only under enforce |
| Agent (A) | `[REDACTED_AGENT_A]` | Agent access JWT via exchange |
| Operator subject (B) | `[REDACTED_OPERATOR_B_SUBJECT]` | Cross-tenant negative |

## Matrix results

| ID | Command / request reference | HTTP status | Error code (if any) | Assertion result | Artifact reference |
|---|---|---|---|---|---|
| M1 operator `GET /v1/alerts` | `[COMMAND_OR_REQUEST_REFERENCE]` | `[HTTP_STATUS]` | `[ERROR_CODE_OR_NONE]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| M2 auditor `GET /v1/alerts` | `[COMMAND_OR_REQUEST_REFERENCE]` | `[HTTP_STATUS]` | `[ERROR_CODE_OR_NONE]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| M3 auditor denied operator-only | `[COMMAND_OR_REQUEST_REFERENCE]` | `[HTTP_STATUS]` | `[ERROR_CODE_OR_NONE]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| M4 role-less denied alert read | `[COMMAND_OR_REQUEST_REFERENCE]` | `[HTTP_STATUS]` | `[ERROR_CODE_OR_NONE]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| M5 agent ingest `auth_failure` | `[COMMAND_OR_REQUEST_REFERENCE]` | `[HTTP_STATUS]` | `[ERROR_CODE_OR_NONE]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| M6 agent denied alert read | `[COMMAND_OR_REQUEST_REFERENCE]` | `[HTTP_STATUS]` | `[ERROR_CODE_OR_NONE]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| M7 tenant B cannot see A alert | `[COMMAND_OR_REQUEST_REFERENCE]` | `[HTTP_STATUS]` | `[ERROR_CODE_OR_NONE]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |

## Five-`auth_failure` alert scenario

| Check | Expected | Observed | Result | Artifact |
|---|---|---|---|---|
| Five ingest in one bucket | five `201` | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| Exactly one alert | count `1`, rule `rule.auth_failure_burst.v1` | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| Evidence summary | count `5`, window + event IDs, no payload dump | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| Sixth event same bucket | still one alert | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| Cross-tenant isolation | empty / `ALERTS_NOT_FOUND` | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |

Alert id placeholder (if needed for follow-up): `[REDACTED_ALERT_ID]`

## Append-only audit (DB / operator only)

| Check | Expected | Observed | Result | Artifact |
|---|---|---|---|---|
| One `alert_created` for tenant A | count `1` | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| Invisible to tenant B | not visible | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| App-role UPDATE fails | permission failure | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| App-role DELETE fails | permission failure | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |

## Invalid-mode startup abort

| Check | Expected | Observed | Result | Artifact |
|---|---|---|---|---|
| `AUTH_MODE=jwt` + unset mode | startup abort | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| `AUTH_MODE=jwt` + invalid mode | startup abort | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| Restore `enforce` | healthy start | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |

## Rollback rehearsal (`enforce` → `compat` → restore)

| Step | Expected | Observed | Result | Artifact |
|---|---|---|---|---|
| Set `compat` + restart | process starts | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| Note: compat is rollback only | acknowledged | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |
| Restore `enforce` + restart | process starts under enforce | `[OBSERVED]` | `[ASSERTION_RESULT]` | `[ARTIFACT_REFERENCE]` |

## Redaction attestation

| Statement | Confirmed |
|---|---|
| No tokens/secrets pasted into this file | `[YES_OR_NO]` |
| No real tenant/agent/user identifiers beyond placeholders | `[YES_OR_NO]` |
| Logs stored only in approved redacted location | `[ARTIFACT_REFERENCE]` |
| Filled template will not be committed to git with real data | `[YES_OR_NO]` |

## Overall result

| Field | Value |
|---|---|
| Overall | `[PASS_OR_FAIL_OR_WAIVED]` |
| Waivers (if any) | `[WAIVER_REASON_AND_APPROVER]` |
| Production cutover authorized by this run? | **No** — staging evidence only |
