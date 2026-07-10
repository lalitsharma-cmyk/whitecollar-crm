-- Master-Data Assign/Transfer (Lalit 2026-07-10).
-- Assigning a Master-Data record reactivates it under a fresh working status
-- (default "Not Contacted"). The status it held BEFORE that reset — typically the
-- Lost/Rejected one — is preserved here for the admin-only "Previous Status" audit
-- line. Additive + nullable: no backfill, no rewrite of a single existing row.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "previousStatus" TEXT;
