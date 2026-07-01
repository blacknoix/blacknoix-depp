-- Platform-side isolation intent (orthogonal to Agent.status lifecycle).
ALTER TABLE "agents" ADD COLUMN "isolatedAt" TIMESTAMP(3);

CREATE INDEX "agents_tenantId_isolatedAt_idx" ON "agents"("tenantId", "isolatedAt");
