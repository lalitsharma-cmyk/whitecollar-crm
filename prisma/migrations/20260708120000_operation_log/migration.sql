-- OperationLog — reversible structural operations (transfer / edit-field / convert /
-- assignment, single + bulk, across all 5 modules). PURELY ADDITIVE + IDEMPOTENT.
-- Safe on live prod: ONE new table + indexes + a FK to User. No existing row is touched.

CREATE TABLE IF NOT EXISTS "OperationLog" (
  "id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "field" TEXT,
  "summary" TEXT,
  "status" TEXT NOT NULL DEFAULT 'EXECUTED',
  "affectedCount" INTEGER NOT NULL DEFAULT 0,
  "affectedIds" JSONB NOT NULL,
  "beforeState" JSONB NOT NULL,
  "afterState" JSONB,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt" TIMESTAMP(3),
  "undoneById" TEXT,
  CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OperationLog_createdById_createdAt_idx" ON "OperationLog"("createdById", "createdAt");
CREATE INDEX IF NOT EXISTS "OperationLog_status_operation_idx" ON "OperationLog"("status", "operation");
CREATE INDEX IF NOT EXISTS "OperationLog_entityType_createdAt_idx" ON "OperationLog"("entityType", "createdAt");
CREATE INDEX IF NOT EXISTS "OperationLog_createdAt_idx" ON "OperationLog"("createdAt");

DO $$ BEGIN
  ALTER TABLE "OperationLog"
    ADD CONSTRAINT "OperationLog_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
