-- HR ATS Phase 1 — additive only. Idempotent (safe to re-run). Hand-applied to
-- Neon per docs/MIGRATION-LEDGER.md, then `prisma migrate resolve --applied`.

-- Activity types for voice + escalation + resume in the conversation timeline.
ALTER TYPE "HRActivityType" ADD VALUE IF NOT EXISTS 'RESUME_UPLOADED';
ALTER TYPE "HRActivityType" ADD VALUE IF NOT EXISTS 'VOICE_NOTE';
ALTER TYPE "HRActivityType" ADD VALUE IF NOT EXISTS 'VOICE_GUIDANCE';
ALTER TYPE "HRActivityType" ADD VALUE IF NOT EXISTS 'ESCALATION_RAISED';
ALTER TYPE "HRActivityType" ADD VALUE IF NOT EXISTS 'ESCALATION_REPLIED';
ALTER TYPE "HRActivityType" ADD VALUE IF NOT EXISTS 'ESCALATION_RESOLVED';

-- HRCandidate: soft-delete + salary currency.
ALTER TABLE "HRCandidate" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "HRCandidate" ADD COLUMN IF NOT EXISTS "salaryCurrency" TEXT;
CREATE INDEX IF NOT EXISTS "HRCandidate_deletedAt_idx" ON "HRCandidate"("deletedAt");

-- HRInterview: post-interview recommendation.
ALTER TABLE "HRInterview" ADD COLUMN IF NOT EXISTS "recommendation" TEXT;

-- Escalation thread container.
CREATE TABLE IF NOT EXISTS "HREscalation" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "raisedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HREscalation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HREscalation_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "HRCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "HREscalation_candidateId_idx" ON "HREscalation"("candidateId");
CREATE INDEX IF NOT EXISTS "HREscalation_status_idx" ON "HREscalation"("status");

-- Candidate-scoped voice (guidance + escalation messages).
CREATE TABLE IF NOT EXISTS "HRVoiceMessage" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "kind" "VoiceMessageKind" NOT NULL,
  "createdById" TEXT NOT NULL,
  "audioData" BYTEA NOT NULL,
  "mimeType" TEXT NOT NULL DEFAULT 'audio/webm',
  "durationSec" INTEGER,
  "transcript" TEXT,
  "transcriptLang" TEXT,
  "textNote" TEXT,
  "title" TEXT,
  "escalationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HRVoiceMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HRVoiceMessage_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "HRCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "HRVoiceMessage_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "HREscalation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "HRVoiceMessage_candidateId_kind_idx" ON "HRVoiceMessage"("candidateId","kind");
CREATE INDEX IF NOT EXISTS "HRVoiceMessage_escalationId_idx" ON "HRVoiceMessage"("escalationId");

-- Per-user listened/understood tracking.
CREATE TABLE IF NOT EXISTS "HRVoiceMessageRead" (
  "id" TEXT NOT NULL,
  "voiceMessageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "understoodAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HRVoiceMessageRead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HRVoiceMessageRead_voiceMessageId_fkey" FOREIGN KEY ("voiceMessageId") REFERENCES "HRVoiceMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "HRVoiceMessageRead_voiceMessageId_userId_key" ON "HRVoiceMessageRead"("voiceMessageId","userId");

-- Saved candidate-list views.
CREATE TABLE IF NOT EXISTS "HRSavedFilter" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "isShared" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HRSavedFilter_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "HRSavedFilter_userId_idx" ON "HRSavedFilter"("userId");
