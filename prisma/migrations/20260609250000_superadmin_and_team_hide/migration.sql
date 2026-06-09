-- Super Admin tier (permanent purge) + per-team conversation hiding.

-- 1. Super Admin flag — only this tier may permanently purge data (Import Trash).
ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- 2. Per-team remark hiding (e.g. hide a remark from the whole Dubai team).
ALTER TABLE "RemarkVisibility" ADD COLUMN "hiddenFromTeams" TEXT;
