-- Index for tenant-scoped alert queries filtered by correlation rule.

CREATE INDEX "alerts_tenantId_ruleId_idx" ON "alerts"("tenantId", "ruleId");

