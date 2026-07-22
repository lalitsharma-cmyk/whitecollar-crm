-- Employee lifecycle / offboarding status (Lalit 2026-07-23). Additive only.
-- EmploymentStatus is the HR/employment state; the existing `active` boolean stays
-- the operational access flag (login + routing enforcement already key off it).
DO $$ BEGIN
  CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE','ON_LEAVE','TEMPORARILY_DISABLED','SUSPENDED','LEFT_ORGANIZATION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastWorkingDate" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "offboardedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "offboardReason" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "offboardNote" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "offboardedById" TEXT;
