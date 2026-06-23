-- BUYER DATA MODULE — transaction & property records (ADMIN-only; passport + financial data).
-- Additive: three NEW tables, no existing table/column is touched. Idempotent (IF NOT EXISTS).
-- buyerKey = normalized (name/phone) hash for repeat-buyer rollup; rollup is COMPUTED at read time.

-- ── BuyerRecord ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BuyerRecord" (
  "id"               TEXT NOT NULL,
  "clientName"       TEXT NOT NULL,
  "coBuyerNames"     TEXT,
  "phones"           TEXT,
  "emails"           TEXT,
  "passport"         TEXT,
  "nationality"      TEXT,
  "projectName"      TEXT,
  "tower"            TEXT,
  "unitNumber"       TEXT,
  "propertyType"     TEXT,
  "configuration"    TEXT,
  "transactionValue" DOUBLE PRECISION,
  "pricePerSqFt"     DOUBLE PRECISION,
  "transactionDate"  TIMESTAMP(3),
  "transactionId"    TEXT,
  "agentName"        TEXT,
  "source"           TEXT,
  "sourceFile"       TEXT,
  "extraFields"      JSONB,
  "buyerKey"         TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  "importBatchId"    TEXT,
  CONSTRAINT "BuyerRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BuyerRecord_buyerKey_idx"      ON "BuyerRecord"("buyerKey");
CREATE INDEX IF NOT EXISTS "BuyerRecord_projectName_idx"   ON "BuyerRecord"("projectName");
CREATE INDEX IF NOT EXISTS "BuyerRecord_transactionDate_idx" ON "BuyerRecord"("transactionDate");
CREATE INDEX IF NOT EXISTS "BuyerRecord_createdAt_idx"     ON "BuyerRecord"("createdAt");
CREATE INDEX IF NOT EXISTS "BuyerRecord_importBatchId_idx" ON "BuyerRecord"("importBatchId");

-- ── BuyerImportBatch ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BuyerImportBatch" (
  "id"           TEXT NOT NULL,
  "source"       TEXT NOT NULL,
  "sourceRef"    TEXT,
  "recordCount"  INTEGER NOT NULL DEFAULT 0,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount"   INTEGER NOT NULL DEFAULT 0,
  "importedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "importedById" TEXT,
  "rawPayload"   JSONB,
  CONSTRAINT "BuyerImportBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BuyerImportBatch_importedAt_idx" ON "BuyerImportBatch"("importedAt");

-- Optional relation BuyerImportBatch.importedBy → User (ON DELETE SET NULL to match `User?`).
DO $$ BEGIN
  ALTER TABLE "BuyerImportBatch" ADD CONSTRAINT "BuyerImportBatch_importedById_fkey"
    FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── BuyerImportLog ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BuyerImportLog" (
  "id"        TEXT NOT NULL,
  "batchId"   TEXT NOT NULL,
  "rowNum"    INTEGER NOT NULL,
  "error"     TEXT NOT NULL,
  "rawRow"    JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuyerImportLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BuyerImportLog_batchId_idx" ON "BuyerImportLog"("batchId");
