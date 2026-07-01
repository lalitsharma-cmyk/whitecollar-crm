-- Actor-vs-Owner attribution (additive, idempotent, reversible). Safe to re-run.
--
-- Purpose: the timeline must record WHO PERFORMED each action (the actor), never
-- the lead owner (Lalit, 2026-07-01). Two schema changes:
--   1. WhatsAppMessage gains a nullable actor (who SENT an outbound message).
--   2. CallLog.userId becomes NULLABLE so an unmatched inbound telephony call can
--      be left UNASSIGNED ("Unknown Agent") instead of being falsely stamped with
--      the lead owner or an admin.
--
-- NON-DESTRUCTIVE: only adds a column/index/FK and relaxes a NOT NULL constraint.
-- No existing data is read, changed, or deleted by this migration.

-- 1. WhatsAppMessage.actorUserId (nullable) + index + FK → User (SET NULL on delete)
ALTER TABLE "WhatsAppMessage" ADD COLUMN IF NOT EXISTS "actorUserId" TEXT;

CREATE INDEX IF NOT EXISTS "WhatsAppMessage_actorUserId_idx" ON "WhatsAppMessage"("actorUserId");

DO $$ BEGIN
  ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. CallLog.userId → NULLABLE (idempotent: DROP NOT NULL is a no-op if already nullable)
ALTER TABLE "CallLog" ALTER COLUMN "userId" DROP NOT NULL;
