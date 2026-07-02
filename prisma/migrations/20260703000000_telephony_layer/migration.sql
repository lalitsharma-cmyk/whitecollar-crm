-- Telephony layer (AS Phone / provider-agnostic). PURELY ADDITIVE + IDEMPOTENT.
-- Safe on live prod: 2 nullable columns on CallLog + 2 new tables. No data touched.

-- CallLog: cross-module buyer linking + multi-account tag
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "buyerId" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "ivrAccountId" TEXT;

CREATE INDEX IF NOT EXISTS "CallLog_buyerId_idx" ON "CallLog"("buyerId");

DO $$ BEGIN
  ALTER TABLE "CallLog"
    ADD CONSTRAINT "CallLog_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "BuyerRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CallEvent: verbatim inbound webhook audit
CREATE TABLE IF NOT EXISTS "CallEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerCallId" TEXT,
  "direction" TEXT,
  "eventType" TEXT,
  "accountId" TEXT,
  "rawPayload" JSONB NOT NULL,
  "processed" BOOLEAN NOT NULL DEFAULT false,
  "callLogId" TEXT,
  "error" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CallEvent_provider_providerCallId_idx" ON "CallEvent"("provider","providerCallId");
CREATE INDEX IF NOT EXISTS "CallEvent_processed_idx" ON "CallEvent"("processed");
CREATE INDEX IF NOT EXISTS "CallEvent_receivedAt_idx" ON "CallEvent"("receivedAt");

-- CallSyncTask: durable telephony retry queue
CREATE TABLE IF NOT EXISTS "CallSyncTask" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "refId" TEXT,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 6,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallSyncTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CallSyncTask_status_nextAttemptAt_idx" ON "CallSyncTask"("status","nextAttemptAt");
CREATE INDEX IF NOT EXISTS "CallSyncTask_kind_idx" ON "CallSyncTask"("kind");
CREATE INDEX IF NOT EXISTS "CallSyncTask_provider_refId_idx" ON "CallSyncTask"("provider","refId");
