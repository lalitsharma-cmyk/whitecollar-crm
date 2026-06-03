-- AI Extraction table: per-lead structured extraction runs
CREATE TABLE "AiExtraction" (
  "id"           TEXT    NOT NULL,
  "leadId"       TEXT    NOT NULL,
  "resultJson"   TEXT    NOT NULL,
  "triggeredBy"  TEXT    NOT NULL DEFAULT 'manual',
  "provider"     TEXT,
  "model"        TEXT,
  "inputTokens"  INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiExtraction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiExtraction_leadId_createdAt_idx" ON "AiExtraction"("leadId", "createdAt");
