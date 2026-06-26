-- Lead Voice Communication (additive, idempotent). 3 tables + 1 enum + FKs/indexes.
-- Channel ① Manager Voice Guidance + Channel ② Escalation Thread share LeadVoiceMessage.
-- Deliberately EXCLUDES the unrelated pre-existing Lead.medium/mediumOther type drift.
-- Safe to re-run (guarded enum + IF NOT EXISTS).

-- Enum
DO $$ BEGIN
  CREATE TYPE "VoiceMessageKind" AS ENUM ('GUIDANCE', 'ESCALATION', 'ESCALATION_REPLY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Tables
CREATE TABLE IF NOT EXISTS "LeadEscalation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeadEscalation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeadVoiceMessage" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
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
    CONSTRAINT "LeadVoiceMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VoiceMessageRead" (
    "id" TEXT NOT NULL,
    "voiceMessageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "understoodAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoiceMessageRead_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "LeadVoiceMessage_leadId_kind_idx" ON "LeadVoiceMessage"("leadId", "kind");
CREATE INDEX IF NOT EXISTS "LeadVoiceMessage_escalationId_idx" ON "LeadVoiceMessage"("escalationId");
CREATE INDEX IF NOT EXISTS "LeadEscalation_leadId_idx" ON "LeadEscalation"("leadId");
CREATE INDEX IF NOT EXISTS "LeadEscalation_status_idx" ON "LeadEscalation"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "VoiceMessageRead_voiceMessageId_userId_key" ON "VoiceMessageRead"("voiceMessageId", "userId");

-- Foreign keys (guarded)
DO $$ BEGIN
  ALTER TABLE "LeadVoiceMessage" ADD CONSTRAINT "LeadVoiceMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "LeadVoiceMessage" ADD CONSTRAINT "LeadVoiceMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "LeadVoiceMessage" ADD CONSTRAINT "LeadVoiceMessage_escalationId_fkey" FOREIGN KEY ("escalationId") REFERENCES "LeadEscalation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "LeadEscalation" ADD CONSTRAINT "LeadEscalation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "LeadEscalation" ADD CONSTRAINT "LeadEscalation_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "VoiceMessageRead" ADD CONSTRAINT "VoiceMessageRead_voiceMessageId_fkey" FOREIGN KEY ("voiceMessageId") REFERENCES "LeadVoiceMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
