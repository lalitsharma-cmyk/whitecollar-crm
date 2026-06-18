-- Project Master "Status" (Active/Inactive) for the lead auto-classifier.
-- Additive, non-locking (constant default → metadata-only in PG11+).
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
