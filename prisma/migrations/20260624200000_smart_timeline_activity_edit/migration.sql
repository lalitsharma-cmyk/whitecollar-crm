-- Smart Timeline edit support (additive, reversible).
--   1. Activity gains an optional free-text `outcome` and a per-entry `followupDate`.
--   2. New ActivityEdit append-only audit table — preserves the prior value of any
--      admin-edited timeline Activity (per changed field, old -> new + who + when).
-- All statements are IF NOT EXISTS / additive so re-running is safe and no existing
-- data is touched.

-- 1. Activity columns ---------------------------------------------------------
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "outcome" TEXT;
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "followupDate" TIMESTAMP(3);

-- 2. ActivityEdit audit table -------------------------------------------------
CREATE TABLE IF NOT EXISTS "ActivityEdit" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "editedById" TEXT,
    "editedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEdit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ActivityEdit_activityId_idx" ON "ActivityEdit"("activityId");
CREATE INDEX IF NOT EXISTS "ActivityEdit_leadId_createdAt_idx" ON "ActivityEdit"("leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "ActivityEdit_editedById_createdAt_idx" ON "ActivityEdit"("editedById", "createdAt");

-- Foreign keys — guarded so re-running does not error if they already exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ActivityEdit_activityId_fkey') THEN
    ALTER TABLE "ActivityEdit"
      ADD CONSTRAINT "ActivityEdit_activityId_fkey"
      FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ActivityEdit_editedById_fkey') THEN
    ALTER TABLE "ActivityEdit"
      ADD CONSTRAINT "ActivityEdit_editedById_fkey"
      FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
