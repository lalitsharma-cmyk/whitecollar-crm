-- Device-security: trusted-device binding + DB-backed sessions.
-- Additive + idempotent. Safe on prod (no data touched).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionEpoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deviceLimitExtra" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "Device" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'desktop',
  "browser" TEXT,
  "os" TEXT,
  "firstIp" TEXT,
  "lastIp" TEXT,
  "lastCity" TEXT,
  "lastCountry" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Device_userId_deviceId_key" ON "Device"("userId", "deviceId");
CREATE INDEX IF NOT EXISTS "Device_userId_idx" ON "Device"("userId");
CREATE INDEX IF NOT EXISTS "Device_status_idx" ON "Device"("status");

CREATE TABLE IF NOT EXISTS "UserSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceRef" TEXT,
  "ip" TEXT,
  "city" TEXT,
  "country" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedReason" TEXT,
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "UserSession_userId_idx" ON "UserSession"("userId");
CREATE INDEX IF NOT EXISTS "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");
CREATE INDEX IF NOT EXISTS "UserSession_revokedAt_idx" ON "UserSession"("revokedAt");

DO $$ BEGIN
  ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Device" ADD CONSTRAINT "Device_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_deviceRef_fkey" FOREIGN KEY ("deviceRef") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
