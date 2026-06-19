-- State/Province field + manual-lock flag for location re-enrichment. Additive.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "locationManual" BOOLEAN NOT NULL DEFAULT false;
