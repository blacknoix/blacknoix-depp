-- Extend agent identity model for enrollment window, token prefix, and audit fields.

-- Add expired status value
ALTER TYPE "agent_status" ADD VALUE IF NOT EXISTS 'expired';

-- New identity and lifecycle columns
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "tokenPrefix" TEXT;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "pendingExpiresAt" TIMESTAMP(3);
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "lastIpHash" TEXT;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "lastAgentVersion" TEXT;

-- Backfill displayName for existing rows
UPDATE "agents" SET "displayName" = "hostname" WHERE "displayName" IS NULL;

-- Backfill pendingExpiresAt for pending agents without expiry
UPDATE "agents"
SET "pendingExpiresAt" = "registeredAt" + INTERVAL '24 hours'
WHERE "pendingExpiresAt" IS NULL AND "status" = 'pending';

UPDATE "agents"
SET "pendingExpiresAt" = "registeredAt"
WHERE "pendingExpiresAt" IS NULL;

-- Backfill tokenPrefix placeholder for legacy rows (not reconstructable)
UPDATE "agents" SET "tokenPrefix" = 'legacy___' WHERE "tokenPrefix" IS NULL;

ALTER TABLE "agents" ALTER COLUMN "displayName" SET NOT NULL;
ALTER TABLE "agents" ALTER COLUMN "tokenPrefix" SET NOT NULL;
ALTER TABLE "agents" ALTER COLUMN "pendingExpiresAt" SET NOT NULL;

-- Unique token hash — one credential maps to exactly one agent
CREATE UNIQUE INDEX IF NOT EXISTS "agents_tokenHash_key" ON "agents"("tokenHash");

-- Telemetry query index
CREATE INDEX IF NOT EXISTS "agents_tenantId_lastSeenAt_idx" ON "agents"("tenantId", "lastSeenAt");
