# DEPP — Decentralized Endpoint Protection Platform

## Project overview
DEPP is an enterprise cybersecurity platform focused on decentralized endpoint protection, telemetry ingestion, detection, correlation, alerting, auditability, and enterprise readiness.

## Primary goal
Build an enterprise-ready multi-tenant endpoint protection platform that can be sold to organizations.

## Founder context
This project is being built by a solo founder using Claude Pro / Claude Code and Cursor Pro+ as the main AI development system.

## Working model
- Claude Code is the planner, reviewer, architect, and gap finder.
- Cursor is the implementation engine for multi-file code changes, test/fix loops, and refactors.
- Prefer small, production-oriented slices over broad unfinished scaffolding.

## Current repo status
This repository is at day zero.

Current files/folders:
- CLAUDE.md
- backend/ (planned, may still be empty)
- frontend/ (planned, may still be empty)
- docs/ (planned, may still be empty)
- infra/ (planned, may still be empty)

These folders represent the intended project structure, not completed implementation.

## Initial stack assumptions
Until finalized, assume:
- Frontend: React + TypeScript
- Backend API: Node.js + TypeScript
- Database: PostgreSQL
- Cache/queue: Redis
- Infra: Docker
- Package manager: npm unless changed explicitly

If the actual stack changes, update this file immediately.

## Product direction
The platform should prioritize:
1. Auth and RBAC
2. Tenant isolation
3. Agent registration and identity
4. Telemetry ingestion
5. Alerting and triage
6. Policy engine
7. Observability
8. Enterprise readiness and documentation

Treat this as the current priority order unless explicitly changed.

## Current status
- Repository setup: in progress
- Product docs: not started
- Backend implementation: not started
- Frontend implementation: not started
- Infra setup: not started
- Enterprise hardening: not started

## Tenancy model
Target model: shared application with strict tenant scoping on every tenant-owned record using tenant_id.
No query for tenant-owned data should run without tenant scope.
No cross-tenant access is allowed unless explicitly designed and documented for platform-admin behavior.

## Engineering principles
- Security and tenant isolation come before speed.
- No shortcuts that weaken enterprise readiness.
- Prefer explicit types, validation, logging, and tests.
- Keep changes scoped and reviewable.
- Update docs when architecture or behavior changes.
- Avoid hardcoded secrets.
- Prefer maintainable code over clever code.

## Hard rules
- Never commit secrets or .env files.
- Never access tenant-owned data without explicit tenant scope.
- Never add auth-sensitive routes without authorization checks.
- Never log raw secrets, tokens, or sensitive telemetry.
- Never describe something as implemented unless it exists in the repo.

## Standard commands
These are placeholders until the real services exist:
- Install dependencies: TBD
- Start dev: TBD
- Typecheck: TBD
- Lint: TBD
- Test: TBD
- Build: TBD

If a service is added, update these commands immediately.

## How Claude should work in this repo
When asked to plan work:
1. Read this file first.
2. Read relevant files in docs/ and affected code areas.
3. Propose the smallest useful implementation slice.
4. Output:
   - objective
   - files likely affected
   - acceptance criteria
   - security / tenancy risks
   - tests required
   - docs to update
5. Do not start coding until asked.

When asked to review work:
- Prioritize security, tenant isolation, auth, data boundaries, error handling, and enterprise readiness.
- Be concrete and list the highest-risk issues first.

When asked to implement:
- Keep scope tight.
- Preserve existing patterns.
- Run relevant checks if available.
- Summarize what changed, what remains, and any risks.

## Notes
This file should stay concise and current. Add important project-specific decisions here as the repo evolves.
