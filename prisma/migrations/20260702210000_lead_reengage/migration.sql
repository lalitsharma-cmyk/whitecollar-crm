-- Future Re-engage on Reject (Lalit 2026-07-02). Additive, idempotent, reversible.
-- reEngageAt = future date to reactivate; reEngageOwnerId = agent to reassign back to.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "reEngageAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "reEngageOwnerId" TEXT;
CREATE INDEX IF NOT EXISTS "Lead_reEngageAt_idx" ON "Lead"("reEngageAt");
