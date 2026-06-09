-- Import History: per-batch tracking + soft-delete/rollback for bulk lead imports.

-- 1. ImportBatch — one row per CSV/Excel import (admin Import History screen).
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "sheetName" TEXT,
    "importType" TEXT,
    "team" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "importedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImportBatch_importedById_idx" ON "ImportBatch"("importedById");
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");

-- 2. Lead: import provenance + soft-delete columns (all nullable — safe on live data).
ALTER TABLE "Lead" ADD COLUMN "importBatchId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "deletedById" TEXT;
CREATE INDEX "Lead_importBatchId_idx" ON "Lead"("importBatchId");
CREATE INDEX "Lead_deletedAt_idx" ON "Lead"("deletedAt");

-- 3. Foreign keys (SET NULL on delete — never cascade-destroy lead/import history).
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
