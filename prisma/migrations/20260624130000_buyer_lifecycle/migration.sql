-- BUYER DATA LIFECYCLE (Part 5a) — turn the flat admin BuyerRecord repository into
-- a worked pipeline (Admin Pool → agent → CONVERT/REJECT), like a lightweight Leads.
-- Fully ADDITIVE + idempotent: new nullable columns (with safe defaults) on
-- BuyerRecord, two NEW tables (BuyerAssignment, BuyerActivity), plus indexes + FKs.
-- Re-runnable (IF NOT EXISTS / duplicate_object guards) so a hand-apply + a later
-- `prisma migrate deploy` both converge without error. No existing data is mutated.

-- ── BuyerRecord: lifecycle columns ───────────────────────────────────────────
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "ownerId"          TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "assignedAt"       TIMESTAMP(3);
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "poolStatus"       TEXT NOT NULL DEFAULT 'ADMIN_POOL';
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "attemptCount"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "remarks"          TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "convertedLeadId"  TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "convertedAt"      TIMESTAMP(3);
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "convertedById"    TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "rejectedAt"       TIMESTAMP(3);
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "rejectedById"     TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "rejectionReason"  TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "returnedToPoolAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "BuyerRecord_ownerId_idx"             ON "BuyerRecord"("ownerId");
CREATE INDEX IF NOT EXISTS "BuyerRecord_poolStatus_idx"         ON "BuyerRecord"("poolStatus");
CREATE INDEX IF NOT EXISTS "BuyerRecord_ownerId_poolStatus_idx" ON "BuyerRecord"("ownerId", "poolStatus");

-- BuyerRecord.owner → User (SetNull to match `User?`).
DO $$ BEGIN
  ALTER TABLE "BuyerRecord" ADD CONSTRAINT "BuyerRecord_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- BuyerRecord.convertedLead → Lead (SetNull — deleting the lead must not delete the buyer).
DO $$ BEGIN
  ALTER TABLE "BuyerRecord" ADD CONSTRAINT "BuyerRecord_convertedLeadId_fkey"
    FOREIGN KEY ("convertedLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── BuyerAssignment — agent-handling history (one row per stint) ──────────────
CREATE TABLE IF NOT EXISTS "BuyerAssignment" (
  "id"              TEXT NOT NULL,
  "buyerId"         TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "assignedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assignedById"    TEXT,
  "returnedAt"      TIMESTAMP(3),
  "returnReason"    TEXT,
  "attemptsInStint" INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuyerAssignment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BuyerAssignment_buyerId_idx" ON "BuyerAssignment"("buyerId");
CREATE INDEX IF NOT EXISTS "BuyerAssignment_userId_idx"  ON "BuyerAssignment"("userId");

DO $$ BEGIN
  ALTER TABLE "BuyerAssignment" ADD CONSTRAINT "BuyerAssignment_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "BuyerRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "BuyerAssignment" ADD CONSTRAINT "BuyerAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── BuyerActivity — buyer-scoped timeline / activity log ─────────────────────
CREATE TABLE IF NOT EXISTS "BuyerActivity" (
  "id"          TEXT NOT NULL,
  "buyerId"     TEXT NOT NULL,
  "userId"      TEXT,
  "type"        TEXT NOT NULL,
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuyerActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BuyerActivity_buyerId_idx"            ON "BuyerActivity"("buyerId");
CREATE INDEX IF NOT EXISTS "BuyerActivity_userId_idx"            ON "BuyerActivity"("userId");
CREATE INDEX IF NOT EXISTS "BuyerActivity_buyerId_createdAt_idx" ON "BuyerActivity"("buyerId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "BuyerActivity" ADD CONSTRAINT "BuyerActivity_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "BuyerRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "BuyerActivity" ADD CONSTRAINT "BuyerActivity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
