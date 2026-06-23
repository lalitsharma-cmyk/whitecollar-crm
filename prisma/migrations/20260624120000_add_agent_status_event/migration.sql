-- Agent field-movement status events (additive, safe to re-run).
-- Append-only event log: agents tap a phone button to log arrival / leaving /
-- going-or-back-from a meeting or site visit. Manager (Lalit) is notified per
-- event; duration is computed on the "Returned" tap. Distinct from Attendance
-- (1 row/day, round-robin) — this is many rows/day.

-- 1. Enum for the status kind. CREATE TYPE has no IF NOT EXISTS in PG, so guard it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentStatusKind') THEN
    CREATE TYPE "AgentStatusKind" AS ENUM (
      'HERE',
      'LEAVING_OFFICE',
      'GOING_MEETING',
      'RETURNED_MEETING',
      'GOING_SITE_VISIT',
      'RETURNED_SITE_VISIT'
    );
  END IF;
END$$;

-- 2. Add the new NotifKind enum value (idempotent).
ALTER TYPE "NotifKind" ADD VALUE IF NOT EXISTS 'AGENT_STATUS';

-- 3. The event table.
CREATE TABLE IF NOT EXISTS "AgentStatusEvent" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "status"        "AgentStatusKind" NOT NULL,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"       TIMESTAMP(3),
  "durationMin"   INTEGER,
  "pairedEventId" TEXT,
  "note"          TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentStatusEvent_pkey" PRIMARY KEY ("id")
);

-- 4. FK → User (cascade on user delete). Guarded so re-runs don't error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AgentStatusEvent_userId_fkey'
  ) THEN
    ALTER TABLE "AgentStatusEvent"
      ADD CONSTRAINT "AgentStatusEvent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- 5. Indexes.
CREATE INDEX IF NOT EXISTS "AgentStatusEvent_userId_createdAt_idx"
  ON "AgentStatusEvent" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentStatusEvent_userId_status_idx"
  ON "AgentStatusEvent" ("userId", "status");
CREATE INDEX IF NOT EXISTS "AgentStatusEvent_userId_status_endedAt_idx"
  ON "AgentStatusEvent" ("userId", "status", "endedAt");
