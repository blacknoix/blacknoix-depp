-- Queryable malware/IOC indicator for correlation (nullable for legacy and burst alerts).

ALTER TABLE "alerts" ADD COLUMN "indicator" TEXT;

CREATE INDEX "alerts_tenantId_indicator_idx" ON "alerts"("tenantId", "indicator");
