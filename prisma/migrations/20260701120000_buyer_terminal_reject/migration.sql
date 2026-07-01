-- Additive Buyer terminal-reject audit fields.
-- rejectCategory = the reject bucket; aiEligibleForRevival = reject-time eligibility
-- for the AI Reactivation Engine. Both NULLABLE + ADDITIVE — no existing row is
-- modified (all default NULL), no existing column touched. Idempotent. Reversible.
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "rejectCategory" TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "aiEligibleForRevival" BOOLEAN;

-- ROLLBACK:
--   ALTER TABLE "BuyerRecord" DROP COLUMN IF EXISTS "aiEligibleForRevival";
--   ALTER TABLE "BuyerRecord" DROP COLUMN IF EXISTS "rejectCategory";
