-- Customer Intelligence System — pre-assignment history & matching
-- Purely additive: 3 new tables + 1 new enum. No existing tables changed.
-- Run BEFORE round-robin assignment, SLA timers, and WhatsApp automation.

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('STRONG', 'MEDIUM', 'WEAK', 'NONE');

-- CreateTable: master customer profile (one per real-world person)
CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryPhone" TEXT,
    "secondaryPhone" TEXT,
    "whatsappPhone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "company" TEXT,
    "isInvestor" BOOLEAN,
    "totalProperties" INTEGER NOT NULL DEFAULT 0,
    "totalTxValueAed" INTEGER NOT NULL DEFAULT 0,
    "previousProjects" TEXT NOT NULL DEFAULT '[]',
    "previousAgents" TEXT NOT NULL DEFAULT '[]',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInteractedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable: one per Lead — stores the pre-assignment intelligence check result
CREATE TABLE "IntelligenceMatch" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "profileId" TEXT,
    "matchType" "MatchType" NOT NULL DEFAULT 'NONE',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "matchedBy" TEXT NOT NULL DEFAULT '[]',
    "historyJson" TEXT NOT NULL DEFAULT '[]',
    "previousAgentName" TEXT,
    "previousStatus" TEXT,
    "lastContactAt" TIMESTAMP(3),
    "totalRecordsFound" INTEGER NOT NULL DEFAULT 0,
    "totalPropertiesFound" INTEGER NOT NULL DEFAULT 0,
    "projectMatch" TEXT,
    "projectNote" TEXT,
    "aiSummary" TEXT,
    "suggestedApproach" TEXT,
    "aiCheckedAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntelligenceMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable: imported property buyer / investor records
CREATE TABLE "PropertyPortfolio" (
    "id" TEXT NOT NULL,
    "profileId" TEXT,
    "date" TIMESTAMP(3),
    "project" TEXT NOT NULL,
    "tower" TEXT,
    "unit" TEXT,
    "bedrooms" TEXT,
    "transactionValueAed" INTEGER,
    "actualSizeSqft" INTEGER,
    "ownerName" TEXT NOT NULL,
    "primaryPhone" TEXT,
    "secondaryPhone" TEXT,
    "agentName" TEXT,
    "status" TEXT,
    "followUpDate" TIMESTAMP(3),
    "remarks" TEXT,
    "importSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PropertyPortfolio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerProfile_primaryPhone_idx" ON "CustomerProfile"("primaryPhone");
CREATE INDEX "CustomerProfile_email_idx" ON "CustomerProfile"("email");
CREATE INDEX "CustomerProfile_name_idx" ON "CustomerProfile"("name");
CREATE UNIQUE INDEX "IntelligenceMatch_leadId_key" ON "IntelligenceMatch"("leadId");
CREATE INDEX "IntelligenceMatch_profileId_idx" ON "IntelligenceMatch"("profileId");
CREATE INDEX "PropertyPortfolio_primaryPhone_idx" ON "PropertyPortfolio"("primaryPhone");
CREATE INDEX "PropertyPortfolio_ownerName_idx" ON "PropertyPortfolio"("ownerName");
CREATE INDEX "PropertyPortfolio_project_idx" ON "PropertyPortfolio"("project");

-- AddForeignKey
ALTER TABLE "IntelligenceMatch" ADD CONSTRAINT "IntelligenceMatch_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PropertyPortfolio" ADD CONSTRAINT "PropertyPortfolio_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
