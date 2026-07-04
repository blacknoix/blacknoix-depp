-- Correlation v2: persisted malware-indicator outbreak incidents (deterministic id, idempotent upsert).

CREATE TABLE "correlated_incidents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "indicator" TEXT NOT NULL,
    "agentIds" TEXT[],
    "alertIds" TEXT[],
    "agentCount" INTEGER NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correlated_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "correlated_incidents_tenantId_type_idx" ON "correlated_incidents"("tenantId", "type");

ALTER TABLE "correlated_incidents" ADD CONSTRAINT "correlated_incidents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
