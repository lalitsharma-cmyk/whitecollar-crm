-- AI Trial Mode + usage tracking (AI kill-switch / trial spec — Lalit, 2026-06-03)
--
-- Purely additive: one enum + three new tables. No changes to existing tables.
-- Lets us pilot AI on a small admin-selected sample before the full ~25k-lead
-- run, and capture real token cost. AiUsageLog rows are written ONLY when an
-- actual provider API request is sent (never on page load / cached read).

-- CreateEnum
CREATE TYPE "AiTrialStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'STOPPED', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "AiTrialRun" (
    "id" TEXT NOT NULL,
    "status" "AiTrialStatus" NOT NULL DEFAULT 'DRAFT',
    "sampleSize" INTEGER NOT NULL,
    "team" TEXT,
    "source" TEXT,
    "features" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "totalLeads" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estCostMicroUsd" INTEGER,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "totalMs" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "qualityNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTrialRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTrialItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "ms" INTEGER,
    "output" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTrialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "feature" TEXT,
    "leadId" TEXT,
    "trialRunId" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "ms" INTEGER,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiTrialRun_status_idx" ON "AiTrialRun"("status");
CREATE INDEX "AiTrialRun_createdAt_idx" ON "AiTrialRun"("createdAt");
CREATE INDEX "AiTrialItem_runId_idx" ON "AiTrialItem"("runId");
CREATE INDEX "AiTrialItem_leadId_idx" ON "AiTrialItem"("leadId");
CREATE INDEX "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");
CREATE INDEX "AiUsageLog_feature_idx" ON "AiUsageLog"("feature");

-- AddForeignKey
ALTER TABLE "AiTrialItem" ADD CONSTRAINT "AiTrialItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AiTrialRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
