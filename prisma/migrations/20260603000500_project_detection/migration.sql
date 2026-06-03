-- Auto-detection: source tracking on LeadProject
ALTER TABLE "LeadProject" ADD COLUMN IF NOT EXISTS "autoDetected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeadProject" ADD COLUMN IF NOT EXISTS "sourceType" TEXT;
ALTER TABLE "LeadProject" ADD COLUMN IF NOT EXISTS "sourceDate" TIMESTAMP(3);
ALTER TABLE "LeadProject" ADD COLUMN IF NOT EXISTS "sourceText" TEXT;

-- Unmatched project mentions — for admin to resolve
CREATE TABLE IF NOT EXISTS "UnmatchedMention" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "mentionText" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceDate" TIMESTAMP(3),
    "sourceText" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedProjectId" TEXT,
    "resolvedIgnored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UnmatchedMention_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "UnmatchedMention_leadId_idx" ON "UnmatchedMention"("leadId");
CREATE INDEX IF NOT EXISTS "UnmatchedMention_resolved_idx" ON "UnmatchedMention"("resolved");

-- Free-text property interest notes
CREATE TABLE IF NOT EXISTS "LeadInterestNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "noteText" TEXT NOT NULL,
    "autoDetected" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT,
    "sourceDate" TIMESTAMP(3),
    "matchedUnitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadInterestNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LeadInterestNote_leadId_idx" ON "LeadInterestNote"("leadId");
