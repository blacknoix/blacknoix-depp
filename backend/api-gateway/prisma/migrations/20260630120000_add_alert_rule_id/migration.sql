-- Track which correlation rule produced each alert (nullable for legacy rows).

ALTER TABLE "alerts" ADD COLUMN "ruleId" TEXT;

