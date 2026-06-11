-- Fingerprint dedupe must apply ONLY to active leads.
--
-- The original global UNIQUE index (Lead_fingerprint_key) meant a soft-deleted
-- lead still "owned" its phone||email fingerprint. So after an admin deleted a
-- batch and re-imported the same file, every row matched a deleted lead and was
-- wrongly deduped (Created: 1 / Deduped: 97), and a genuine re-create would have
-- violated the unique constraint.
--
-- Replace the global unique with a PARTIAL unique index that only covers rows
-- WHERE "deletedAt" IS NULL. Active leads stay protected from true duplicates;
-- soft-deleted leads keep their fingerprint (for audit) but no longer block or
-- dedupe a re-import.
DROP INDEX IF EXISTS "Lead_fingerprint_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Lead_fingerprint_active_key"
  ON "Lead" ("fingerprint")
  WHERE "deletedAt" IS NULL;
