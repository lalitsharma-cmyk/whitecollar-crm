-- Lead hot-path indexes (perf batch 2026-07-16). AUTHORED ONLY — apply after
-- the in-flight backfills finish (do not run while they hold write traffic).
--
-- Idempotent: CREATE INDEX IF NOT EXISTS throughout. Two of the three
-- (followupDate, lastTouchedAt) were already created on prod by
-- scripts/migrate-lead-indexes.ts (CONCURRENTLY, 2026-06-22) under these exact
-- Prisma-convention names, so they no-op here; only the forwardedTeam +
-- currentStatus composite is new.
--
-- Deliberately NOT CONCURRENTLY: `prisma db execute` wraps this file in a
-- transaction, where CREATE INDEX CONCURRENTLY errors out. A plain CREATE
-- INDEX takes a brief lock that is fine at this table size (~6k rows).

CREATE INDEX IF NOT EXISTS "Lead_followupDate_idx" ON "Lead"("followupDate");

CREATE INDEX IF NOT EXISTS "Lead_lastTouchedAt_idx" ON "Lead"("lastTouchedAt");

CREATE INDEX IF NOT EXISTS "Lead_forwardedTeam_currentStatus_idx" ON "Lead"("forwardedTeam", "currentStatus");
