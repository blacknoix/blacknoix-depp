-- Structured auth telemetry for lateral-movement correlation (nullable until agents emit auth.* events).

ALTER TABLE "telemetry_events" ADD COLUMN "authAccount" TEXT;
ALTER TABLE "telemetry_events" ADD COLUMN "authHost" TEXT;
ALTER TABLE "telemetry_events" ADD COLUMN "authGrantedTo" TEXT;
ALTER TABLE "telemetry_events" ADD COLUMN "authSourceHost" TEXT;

CREATE INDEX "telemetry_events_tenantId_authAccount_idx" ON "telemetry_events"("tenantId", "authAccount");
CREATE INDEX "telemetry_events_tenantId_eventType_occurredAt_idx" ON "telemetry_events"("tenantId", "eventType", "occurredAt");
