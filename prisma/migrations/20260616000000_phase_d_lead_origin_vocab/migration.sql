-- Phase D: leadOrigin vocabulary cutover. Each lead belongs to exactly ONE section:
--   ACTIVE → ACTIVE_LEAD (Leads),  COLD → REVIVAL (Revival Engine),
--   PORTFOLIO/SYSTEM → MASTER_DATA (repository-only).
-- The code is deployed FIRST and accepts BOTH the old and new values, so this data
-- update runs with no breakage window. Reversible: a (id → old leadOrigin) backup is
-- written by scripts/phase-d-backup.ts before this runs; rollback re-applies it.
ALTER TABLE "Lead" ALTER COLUMN "leadOrigin" SET DEFAULT 'ACTIVE_LEAD';
UPDATE "Lead" SET "leadOrigin" = 'ACTIVE_LEAD' WHERE "leadOrigin" = 'ACTIVE';
UPDATE "Lead" SET "leadOrigin" = 'REVIVAL'     WHERE "leadOrigin" = 'COLD';
UPDATE "Lead" SET "leadOrigin" = 'MASTER_DATA' WHERE "leadOrigin" IN ('PORTFOLIO', 'SYSTEM');
