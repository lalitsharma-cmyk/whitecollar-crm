-- Property Type (Residential / Commercial) — additive, nullable. Auto-filled from
-- the matched project's category / configuration; agent+admin editable; backfilled.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "propertyType" TEXT;
