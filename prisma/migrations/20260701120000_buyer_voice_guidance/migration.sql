-- Buyer Manager Voice Guidance (additive, idempotent). 2 tables + FKs/indexes.
-- Buyer-view parity with the Lead voice channel (Channel ① Guidance). Mirrors
-- LeadVoiceMessage / VoiceMessageRead for the BuyerRecord model, reusing the
-- pre-existing "VoiceMessageKind" enum (created by 20260626000000_lead_voice_communication).
-- Safe to re-run (CREATE TABLE IF NOT EXISTS + guarded FKs).

-- Tables
CREATE TABLE IF NOT EXISTS "BuyerVoiceMessage" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
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
    CONSTRAINT "BuyerVoiceMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BuyerVoiceMessageRead" (
    "id" TEXT NOT NULL,
    "voiceMessageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "understoodAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuyerVoiceMessageRead_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "BuyerVoiceMessage_buyerId_kind_idx" ON "BuyerVoiceMessage"("buyerId", "kind");
CREATE UNIQUE INDEX IF NOT EXISTS "BuyerVoiceMessageRead_voiceMessageId_userId_key" ON "BuyerVoiceMessageRead"("voiceMessageId", "userId");

-- Foreign keys (guarded)
DO $$ BEGIN
  ALTER TABLE "BuyerVoiceMessage" ADD CONSTRAINT "BuyerVoiceMessage_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "BuyerRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "BuyerVoiceMessage" ADD CONSTRAINT "BuyerVoiceMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "BuyerVoiceMessageRead" ADD CONSTRAINT "BuyerVoiceMessageRead_voiceMessageId_fkey" FOREIGN KEY ("voiceMessageId") REFERENCES "BuyerVoiceMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
