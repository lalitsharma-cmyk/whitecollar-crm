-- Buyer field-level change history (additive, idempotent). 1 table + FKs/indexes.
-- Buyer-view parity with LeadFieldHistory. Records every inline-edit to a
-- BuyerRecord (old→new + who + when + source), rendered by the shared
-- ChangeHistoryCard on the buyer detail. Safe to re-run.

CREATE TABLE IF NOT EXISTS "BuyerFieldHistory" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    CONSTRAINT "BuyerFieldHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BuyerFieldHistory_buyerId_changedAt_idx" ON "BuyerFieldHistory"("buyerId", "changedAt");
CREATE INDEX IF NOT EXISTS "BuyerFieldHistory_changedById_changedAt_idx" ON "BuyerFieldHistory"("changedById", "changedAt");
CREATE INDEX IF NOT EXISTS "BuyerFieldHistory_field_changedAt_idx" ON "BuyerFieldHistory"("field", "changedAt");

DO $$ BEGIN
  ALTER TABLE "BuyerFieldHistory" ADD CONSTRAINT "BuyerFieldHistory_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "BuyerRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "BuyerFieldHistory" ADD CONSTRAINT "BuyerFieldHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
