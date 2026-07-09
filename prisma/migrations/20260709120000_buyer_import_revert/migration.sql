-- BuyerImportBatch revert tracking — status / deletedAt / deletedById / deleteReason
-- (mirrors the Leads ImportBatch soft-delete → restore → purge model, for Buyer imports).
-- PURELY ADDITIVE + IDEMPOTENT. Safe on live prod: 4 columns on one table (a NOT NULL
-- column with a DEFAULT backfills existing rows) + one index. No data touched.

ALTER TABLE "BuyerImportBatch" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "BuyerImportBatch" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "BuyerImportBatch" ADD COLUMN IF NOT EXISTS "deletedById" TEXT;
ALTER TABLE "BuyerImportBatch" ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;

CREATE INDEX IF NOT EXISTS "BuyerImportBatch_status_idx" ON "BuyerImportBatch"("status");
