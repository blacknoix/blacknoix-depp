# ADR-0001: Tenancy and Data Model

- Status: Accepted
- Date: 2026-07-20

## Context
DEPP is a multi-tenant enterprise security platform.
Tenant isolation is a top-priority security requirement and must remain enforceable even if application code contains mistakes.
The system is at day zero, so this ADR defines the baseline tenancy model that future services, schemas, queries, and migrations must follow.

## Decision
DEPP will use a shared-schema multi-tenant PostgreSQL model.

Tenant-owned tables must include a `tenant_id` column.
Tenant isolation will be enforced primarily with PostgreSQL Row-Level Security (RLS).
Application services must also apply explicit tenant scoping in code as a second layer of defense.

The application will set a tenant runtime context in PostgreSQL for each request/session:
- `app.current_tenant` = current tenant UUID

RLS policies on tenant-owned tables must restrict reads and writes to rows whose `tenant_id` matches:
- `current_setting('app.current_tenant')::uuid`

Platform-global tables may omit `tenant_id` if they are truly global and do not contain tenant-owned data.

Cross-tenant access is forbidden by default.
Any platform-admin cross-tenant capability must be explicitly designed, justified, and audited.

## Enforcement model
Primary control:
- PostgreSQL RLS on every tenant-owned table.

Secondary controls:
- Request context must resolve authenticated user and tenant before data access.
- Repository/service-layer methods must require tenant context for tenant-owned data.
- Tests must include negative cases proving tenant A cannot access tenant B data.

This project will not rely on ORM/global filters alone as the only isolation mechanism.

## Core entities
Platform-global:
- tenants
- platform_admins (if added later)
- system_feature_flags (optional)

Tenant-owned:
- users
- roles
- user_roles
- agents
- agent_enrollments
- telemetry_events
- alerts
- policies
- policy_versions
- audit_logs
- response_actions

## Entity relationship baseline
- A tenant has many users.
- A tenant has many roles.
- Users can have one or more roles within a tenant.
- A tenant has many agents/endpoints.
- Agents produce telemetry events.
- Telemetry events may produce alerts.
- Policies belong to a tenant and target tenant-owned agents/groups.
- Audit logs record tenant-scoped security and administrative actions.

## Consequences
Benefits:
- Stronger tenant isolation at the database layer.
- Better enterprise security posture for audits and reviews.
- Lower chance of accidental cross-tenant leakage from application bugs.

Costs:
- RLS adds implementation and testing complexity.
- Application code must consistently set tenant context before queries.
- Some ORM patterns may need adaptation to work cleanly with RLS.

## Notes
High-volume telemetry may later move to a partitioned or analytics-oriented store, but tenant isolation rules still apply.
If architecture changes materially, create a new ADR rather than silently changing this file.
