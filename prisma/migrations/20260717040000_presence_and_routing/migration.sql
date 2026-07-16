-- ADMIN PRESENCE + LEAD-ROUTING SCHEDULER (Lalit 2026-07-17). Additive + idempotent:
-- three brand-new tables, zero existing rows touched. Status/expiry are derived at
-- read/assignment time — deliberately NO cron dependency (crons intentionally paused).

CREATE TABLE IF NOT EXISTS "PresenceSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionKey" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "device" TEXT, "browser" TEXT, "os" TEXT,
  "isPwa" BOOLEAN NOT NULL DEFAULT false,
  "lastRoute" TEXT, "lastModule" TEXT,
  "activityCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PresenceSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PresenceSession_sessionKey_key" ON "PresenceSession"("sessionKey");
CREATE INDEX IF NOT EXISTS "PresenceSession_userId_lastHeartbeatAt_idx" ON "PresenceSession"("userId", "lastHeartbeatAt");
CREATE INDEX IF NOT EXISTS "PresenceSession_lastHeartbeatAt_idx" ON "PresenceSession"("lastHeartbeatAt");
DO $$ BEGIN
  ALTER TABLE "PresenceSession" ADD CONSTRAINT "PresenceSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RoutingRule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "scope" JSONB NOT NULL,
  "recipients" JSONB NOT NULL,
  "strategy" TEXT NOT NULL DEFAULT 'round_robin',
  "rrCursor" INTEGER NOT NULL DEFAULT 0,
  "assignedCount" INTEGER NOT NULL DEFAULT 0,
  "disabledAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RoutingRule_active_startsAt_idx" ON "RoutingRule"("active", "startsAt");
DO $$ BEGIN
  ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "RoutingRuleVersion" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "changedById" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoutingRuleVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RoutingRuleVersion_ruleId_changedAt_idx" ON "RoutingRuleVersion"("ruleId", "changedAt");
DO $$ BEGIN
  ALTER TABLE "RoutingRuleVersion" ADD CONSTRAINT "RoutingRuleVersion_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "RoutingRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
