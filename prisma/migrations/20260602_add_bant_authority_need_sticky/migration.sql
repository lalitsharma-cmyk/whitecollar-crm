-- BANT depth + per-agent sticky notes
-- Adds Authority (A) + Need (N) columns to Lead so the BANT card can render
-- real per-letter fields. B remains backed by budgetMin/Max/Currency +
-- fundReadiness, T by whenCanInvest. Also creates StickyNote — a private
-- per-agent scratchpad pinned to a lead (unique on leadId + userId).

-- CreateEnum
CREATE TYPE "AuthorityLevel" AS ENUM ('DECISION_MAKER', 'INFLUENCER', 'GATEKEEPER', 'UNKNOWN');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "authorityLevel" "AuthorityLevel";
ALTER TABLE "Lead" ADD COLUMN "needSummary" TEXT;

-- CreateTable
CREATE TABLE "StickyNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StickyNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StickyNote_leadId_userId_key" ON "StickyNote"("leadId", "userId");

-- CreateIndex
CREATE INDEX "StickyNote_userId_idx" ON "StickyNote"("userId");

-- AddForeignKey
ALTER TABLE "StickyNote" ADD CONSTRAINT "StickyNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StickyNote" ADD CONSTRAINT "StickyNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
