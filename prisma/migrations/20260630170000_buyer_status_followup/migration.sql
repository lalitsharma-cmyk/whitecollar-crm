-- Additive Buyer Data migration (BuyerRecord) — businessStatus + followupDate.
--
-- WHY: BuyerRecord had only `poolStatus` (ADMIN_POOL/ASSIGNED/CONVERTED/REJECTED)
-- — there was NO home for the real imported buyer Status (so the Buyer view showed
-- the *pool* as the status → "Admin Pool"; requirement R4) and NO follow-up date
-- column (so buyer follow-up could not behave like a lead's; requirement R5, and
-- the imported follow-up value was stranded as raw text → the "46-199" garbage).
--
-- SAFETY: both columns are NULLABLE and ADDITIVE — no existing column or row is
-- modified, no data is rewritten. Postgres ADD COLUMN ... NULL is metadata-only
-- (instant, no table rewrite, no long lock). Idempotent (IF NOT EXISTS). Proven on
-- the real prod schema via a rolled-back transaction before applying.

ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "businessStatus" TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "followupDate" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "BuyerRecord_followupDate_idx" ON "BuyerRecord"("followupDate");

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK (fully reversible — additive columns, no loss of existing data):
--   DROP INDEX IF EXISTS "BuyerRecord_followupDate_idx";
--   ALTER TABLE "BuyerRecord" DROP COLUMN IF EXISTS "followupDate";
--   ALTER TABLE "BuyerRecord" DROP COLUMN IF EXISTS "businessStatus";
-- ───────────────────────────────────────────────────────────────────────────
