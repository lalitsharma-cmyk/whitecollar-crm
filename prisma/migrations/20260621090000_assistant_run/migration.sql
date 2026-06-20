-- Admin AI Assistant run log (additive; reversible bulk-ops audit + undo state)
CREATE TABLE IF NOT EXISTS "AssistantRun" (
  "id"            TEXT NOT NULL,
  "command"       TEXT NOT NULL,
  "intent"        TEXT NOT NULL,
  "field"         TEXT,
  "parsed"        JSONB NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'PREVIEW',
  "affectedCount" INTEGER NOT NULL DEFAULT 0,
  "affectedIds"   JSONB,
  "beforeValues"  JSONB,
  "newValue"      TEXT,
  "error"         TEXT,
  "createdById"   TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedAt"    TIMESTAMP(3),
  "undoneAt"      TIMESTAMP(3),
  CONSTRAINT "AssistantRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AssistantRun_createdById_createdAt_idx" ON "AssistantRun"("createdById", "createdAt");
CREATE INDEX IF NOT EXISTS "AssistantRun_status_idx" ON "AssistantRun"("status");
DO $$ BEGIN
  ALTER TABLE "AssistantRun" ADD CONSTRAINT "AssistantRun_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
