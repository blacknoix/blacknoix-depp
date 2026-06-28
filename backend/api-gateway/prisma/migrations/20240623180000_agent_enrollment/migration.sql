-- AlterTable: track enrolling user on agent records
ALTER TABLE "agents" ADD COLUMN "enrolledByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_enrolledByUserId_fkey" FOREIGN KEY ("enrolledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "agents_tenantId_status_idx" ON "agents"("tenantId", "status");
