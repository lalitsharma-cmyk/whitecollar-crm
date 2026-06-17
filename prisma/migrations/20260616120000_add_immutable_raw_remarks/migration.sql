-- Immutable "Raw Remark" audit columns (source of truth). Additive + nullable:
-- the running app does not reference these until the matching code deploys, so
-- this migration is invisible to production until then. TEXT = unlimited (no cap).
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "rawRemarks" TEXT;
ALTER TABLE "HRCandidate" ADD COLUMN IF NOT EXISTS "rawRemarks" TEXT;

-- Backfill from the existing remarks, which the audit proved are already stored
-- verbatim (Postgres text, no truncation). Copy only — nothing is modified.
UPDATE "Lead"        SET "rawRemarks" = "remarks" WHERE "remarks" IS NOT NULL AND "rawRemarks" IS NULL;
UPDATE "HRCandidate" SET "rawRemarks" = "remarks" WHERE "remarks" IS NOT NULL AND "rawRemarks" IS NULL;
