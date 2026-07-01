-- Client demographics (additive, idempotent, reversible). Safe to re-run.
--
-- Purpose: expand cold-data / lead client profiles with designation (job title,
-- distinct from profession), nationality, and preferred location. These are the
-- 3 Client-Information fields Lalit listed for the Revival cold-data editable card
-- that had no Lead column yet.
--
-- NON-DESTRUCTIVE: only adds 3 nullable columns. No existing data is read, changed,
-- or deleted.

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "designation" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "nationality" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "preferredLocation" TEXT;
