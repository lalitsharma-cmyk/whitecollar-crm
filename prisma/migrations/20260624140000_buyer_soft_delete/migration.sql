-- BUYER DATA SOFT-DELETE (Part 5b) — add a recycle-bin `deletedAt` to BuyerRecord
-- so an admin bulk-delete is REVERSIBLE (matches the Lead recycle-bin policy and
-- the "additive / reversible / never hard-lose data" standing rule). Fully
-- ADDITIVE + idempotent: one nullable timestamp column + a partial-friendly index.
-- Every buyer read filters `deletedAt: null`; a soft-deleted buyer disappears from
-- the list / pool / rollups / dedup but the row (and its history) is retained and
-- can be restored. Re-runnable (IF NOT EXISTS).

ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

CREATE INDEX IF NOT EXISTS "BuyerRecord_deletedAt_idx" ON "BuyerRecord"("deletedAt");
