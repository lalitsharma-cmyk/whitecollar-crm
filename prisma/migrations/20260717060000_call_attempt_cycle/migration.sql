-- Owner-specific call-attempt cycle (Lalit 2026-07-17): Ghosting (Normal Leads,
-- threshold 10) + Revival auto-return (threshold 5) + attempt display everywhere.
-- Additive + idempotent; safe on live data (defaults backfill 0/1, NULLs elsewhere).
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "attemptCount"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "connectedCount"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lastAttemptAt"    TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "lastAttemptById"  TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "ghostingAt"       TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "revivalCycle"     INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "returnedToPoolAt" TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_lastAttemptById_fkey"
    FOREIGN KEY ("lastAttemptById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Lead_ghostingAt_idx"       ON "Lead"("ghostingAt");
CREATE INDEX IF NOT EXISTS "Lead_returnedToPoolAt_idx" ON "Lead"("returnedToPoolAt");
