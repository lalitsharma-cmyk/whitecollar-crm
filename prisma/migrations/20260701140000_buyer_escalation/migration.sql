-- Buyer Escalation thread (additive, idempotent). 1 table + escalationId FK/index
-- on BuyerVoiceMessage. Buyer-view parity with LeadEscalation (Channel ②). The
-- audio lives on BuyerVoiceMessage (kind ESCALATION / ESCALATION_REPLY), created by
-- 20260701120000_buyer_voice_guidance. Safe to re-run.

CREATE TABLE IF NOT EXISTS "BuyerEscalation" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuyerEscalation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BuyerEscalation_buyerId_idx" ON "BuyerEscalation"("buyerId");
CREATE INDEX IF NOT EXISTS "BuyerEscalation_status_idx" ON "BuyerEscalation"("status");
CREATE INDEX IF NOT EXISTS "BuyerVoiceMessage_escalationId_idx" ON "BuyerVoiceMessage"("escalationId");

DO $$ BEGIN
  ALTER TABLE "BuyerEscalation" ADD CONSTRAINT "BuyerEscalation_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "BuyerRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "BuyerEscalation" ADD CONSTRAINT "BuyerEscalation_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "BuyerVoiceMessage" ADD CONSTRAINT "BuyerVoiceMessage_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "BuyerEscalation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
