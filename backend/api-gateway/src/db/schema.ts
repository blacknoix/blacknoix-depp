import type { ColumnType, Generated } from "kysely";

/**
 * Kysely schema types for api-gateway.
 *
 * This interface must be kept in step with the migrations in ./migrations,
 * which are the source of truth for the real database shape. A future codegen or
 * drift check should enforce that; for now it is maintained by hand (ADR-0004).
 */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

/**
 * Platform-global tenant registry. No RLS: ADR-0001 permits truly global tables
 * to omit tenant scoping. Visibility of the registry itself is a later concern.
 */
export interface TenantsTable {
  id: Generated<string>;
  slug: string;
  name: string;
  created_at: Generated<Timestamp>;
}

/**
 * Tenant-owned. Stable agent identity (ADR-0001). `name` is mutable metadata
 * only; identity is `id` within `tenant_id`. Credentials live in
 * agent_credentials — never on this row.
 */
export interface AgentsTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  created_at: Generated<Timestamp>;
}

/**
 * Tenant-owned. Hashed long-lived agent credential (ADR-0003 §5). Plaintext is
 * returned once at enrollment and never stored. revoked_at null means usable
 * for access-token exchange.
 */
export interface AgentCredentialsTable {
  id: Generated<string>;
  tenant_id: string;
  agent_id: string;
  credential_hash: string;
  created_at: Generated<Timestamp>;
  revoked_at: NullableTimestamp;
}

/**
 * Tenant-owned. One row per authenticated human (ADR-0003 §9). Identity is
 * keyed by (tenant_id, issuer, subject); email and display_name are cached
 * presentation fields, never identity keys. `id` is the stable anchor that
 * sessions, refresh tokens, and role grants reference.
 */
export interface UsersTable {
  id: Generated<string>;
  tenant_id: string;
  issuer: string;
  subject: string;
  email: string | null;
  display_name: string | null;
  created_at: Generated<Timestamp>;
}

/**
 * Tenant-owned. One row per authenticated session, anchored to a users row
 * (ADR-0003 §4). revoked_at null means active; setting it blocks future refresh.
 */
export interface SessionsTable {
  id: Generated<string>;
  tenant_id: string;
  user_id: string;
  created_at: Generated<Timestamp>;
  revoked_at: NullableTimestamp;
}

/**
 * Tenant-owned. Opaque, one-time-use refresh tokens bound to a session. Only the
 * SHA-256 hash is stored; consumed_at null means usable.
 */
export interface RefreshTokensTable {
  id: Generated<string>;
  tenant_id: string;
  session_id: string;
  token_hash: string;
  created_at: Generated<Timestamp>;
  consumed_at: NullableTimestamp;
}

/**
 * Platform-global (no RLS): OIDC login-initiation records, keyed by an
 * unguessable single-use state. See migrations/005_oidc_initiations.ts.
 */
export interface OidcInitiationsTable {
  state: string;
  nonce: string;
  code_verifier: string;
  tenant_id: string;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
}

/**
 * Tenant-owned append-only telemetry (ADR-0001). Isolation via RLS +
 * withTenantTransaction. payload is opaque JSON constrained at the contract
 * layer; no mutable presentation fields live here.
 */
export interface TelemetryEventsTable {
  id: Generated<string>;
  tenant_id: string;
  agent_id: string;
  schema_version: number;
  event_type: string;
  occurred_at: Timestamp;
  ingested_at: Generated<Timestamp>;
  payload: Record<string, unknown>;
}

/**
 * Tenant-owned correlation output (ADR-0001 alerts, minimal).
 * Mutable operator fields: status, ownership, current operator note.
 */
export interface CorrelationFindingsTable {
  id: Generated<string>;
  tenant_id: string;
  agent_id: string;
  rule_id: string;
  title: string;
  severity: string;
  evidence: Record<string, unknown>;
  window_start: Timestamp;
  window_end: Timestamp;
  window_bucket: Timestamp;
  created_at: Generated<Timestamp>;
  status: string;
  status_changed_at: NullableTimestamp;
  status_changed_by_user_id: string | null;
  owner_user_id: string | null;
  owner_changed_at: NullableTimestamp;
  owner_changed_by_user_id: string | null;
  operator_note: string | null;
  operator_note_updated_at: NullableTimestamp;
  operator_note_updated_by_user_id: string | null;
  /** ADR-0005: bridge_correlation | agent_signed | legacy_unspecified */
  detection_source: string;
}

/**
 * Tenant-owned time-bounded snooze for a correlation rule. Soft-cleared via
 * cleared_at; evaluation skips new findings while active.
 */
export interface FindingSuppressionsTable {
  id: Generated<string>;
  tenant_id: string;
  rule_id: string;
  starts_at: Timestamp;
  ends_at: Timestamp;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
  cleared_at: NullableTimestamp;
  cleared_by_user_id: string | null;
}

/**
 * Tenant-owned shared Findings filter view. Operator product only.
 * Filter columns are nullable; findingId is never stored.
 */
export interface FindingSharedViewsTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  status: string | null;
  rule_id: string | null;
  agent_id: string | null;
  created_at: Generated<Timestamp>;
  created_by_user_id: string | null;
}

/**
 * Tenant-owned Ed25519 device identity bound to an agent (TRD bridge).
 * NODEENROLL cert issuance deferred; active status required for THREATEVENT.
 */
export interface DeviceIdentitiesTable {
  id: Generated<string>;
  tenant_id: string;
  agent_id: string;
  public_key_ed25519: string;
  device_cert_pem: string | null;
  status: string;
  created_at: Generated<Timestamp>;
  revoked_at: NullableTimestamp;
}

/**
 * Tenant-owned signed THREATEVENT persistence (TRD bridge).
 * Findings materialize only after finality_state becomes finalized.
 * detection_source scopes path dedup (bridge vs agent_signed) per window.
 */
export interface ThreatEventsTable {
  id: Generated<string>;
  tenant_id: string;
  agent_id: string;
  device_identity_id: string;
  detection_rule_id: string;
  title: string;
  severity: string;
  evidence: Record<string, unknown>;
  window_start: Timestamp;
  window_end: Timestamp;
  window_bucket: Timestamp;
  occurred_at: Timestamp;
  signature: string;
  signed_at: Timestamp;
  finality_state: string;
  finality_reason: string | null;
  finalized_at: NullableTimestamp;
  finding_id: string | null;
  created_at: Generated<Timestamp>;
  /** ADR-0005: bridge_correlation | agent_signed | legacy_unspecified */
  detection_source: string;
}

export interface Database {
  tenants: TenantsTable;
  agents: AgentsTable;
  agent_credentials: AgentCredentialsTable;
  users: UsersTable;
  sessions: SessionsTable;
  refresh_tokens: RefreshTokensTable;
  oidc_initiations: OidcInitiationsTable;
  telemetry_events: TelemetryEventsTable;
  correlation_findings: CorrelationFindingsTable;
  finding_suppressions: FindingSuppressionsTable;
  finding_shared_views: FindingSharedViewsTable;
  device_identities: DeviceIdentitiesTable;
  threat_events: ThreatEventsTable;
}
