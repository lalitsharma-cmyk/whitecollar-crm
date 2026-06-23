-- BUYER DETAIL FIELDS + STICKY NOTE (Buyer Data → Lead-view layout unification)
-- Two additive, idempotent changes so the buyer detail page reaches full parity
-- with the Lead detail view:
--   1. New nullable BuyerRecord columns for the buyer/property/transaction fields
--      the unified detail surfaces & inline-edits (passportExpiry, ownerName,
--      country, size, actualSize, area, transactionType, role). Stored as columns
--      (not extraFields) so they are first-class, displayable, and inline-editable.
--      All nullable, no default, no existing data mutated.
--   2. A per-agent BuyerStickyNote table (mirrors StickyNote on Lead) so the
--      buyer-detail Quick Note widget is private-per-user-per-buyer at parity with
--      the Lead view.
-- Re-runnable (IF NOT EXISTS / duplicate_object guards) so a hand-apply and a later
-- `prisma migrate deploy` both converge without error.

-- ── 1. BuyerRecord: new detail columns ───────────────────────────────────────
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "passportExpiry"  TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "ownerName"       TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "country"         TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "size"            TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "actualSize"      TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "area"            TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "transactionType" TEXT;
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "role"            TEXT;

-- ── 2. BuyerStickyNote — per-agent private scratchpad on a buyer ──────────────
CREATE TABLE IF NOT EXISTS "BuyerStickyNote" (
  "id"        TEXT NOT NULL,
  "buyerId"   TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "body"      TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuyerStickyNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BuyerStickyNote_buyerId_userId_key" ON "BuyerStickyNote"("buyerId", "userId");
CREATE INDEX IF NOT EXISTS "BuyerStickyNote_userId_idx" ON "BuyerStickyNote"("userId");

-- FKs (cascade on delete — a deleted buyer or user takes its private notes with it).
DO $$ BEGIN
  ALTER TABLE "BuyerStickyNote" ADD CONSTRAINT "BuyerStickyNote_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "BuyerRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BuyerStickyNote" ADD CONSTRAINT "BuyerStickyNote_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
