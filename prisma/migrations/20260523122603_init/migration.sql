-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'AGENT');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WEBSITE', 'WHATSAPP', 'CSV_IMPORT', 'EVENT', 'REFERRAL', 'INBOUND_CALL', 'FACEBOOK_ADS', 'GOOGLE_ADS', 'PORTAL_99ACRES', 'PORTAL_MAGICBRICKS', 'PORTAL_HOUSING', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'SITE_VISIT', 'NEGOTIATION', 'BOOKING_DONE', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "AIScore" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "Potential" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FundReadiness" AS ENUM ('CASH_READY', 'BANK_APPROVED', 'FINANCING_NEEDED', 'NOT_DISCUSSED');

-- CreateEnum
CREATE TYPE "MoodStatus" AS ENUM ('EXCITED', 'INTERESTED', 'NEUTRAL', 'HESITANT', 'COLD', 'CONFUSED', 'ANGRY');

-- CreateEnum
CREATE TYPE "InvestTimeline" AS ENUM ('IMMEDIATE', 'THIRTY_DAYS', 'THREE_MONTHS', 'SIX_PLUS_MONTHS', 'WINDOW_SHOPPING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('OFF_PLAN', 'UNDER_CONSTRUCTION', 'READY', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'HOLD', 'BOOKED', 'SOLD');

-- CreateEnum
CREATE TYPE "LeadInterestType" AS ENUM ('PRIMARY', 'COMPARE', 'RULED_OUT');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CALL', 'WHATSAPP', 'EMAIL', 'SITE_VISIT', 'MEETING', 'TASK', 'NOTE', 'STATUS_CHANGE', 'ASSIGNMENT', 'LEAD_CREATED', 'BROCHURE_SENT');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('PLANNED', 'DONE', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('CONNECTED', 'NOT_PICKED', 'CALLBACK', 'WRONG_NUMBER', 'BUSY', 'SWITCHED_OFF', 'INTERESTED', 'NOT_INTERESTED');

-- CreateEnum
CREATE TYPE "WAMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'AGENT',
    "team" TEXT,
    "phone" TEXT,
    "avatarColor" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "company" TEXT,
    "city" TEXT,
    "country" TEXT,
    "address" TEXT,
    "source" "LeadSource" NOT NULL DEFAULT 'WEBSITE',
    "sourceDetail" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "currentStatus" TEXT,
    "budgetMin" DOUBLE PRECISION,
    "budgetMax" DOUBLE PRECISION,
    "budgetCurrency" TEXT NOT NULL DEFAULT 'AED',
    "configuration" TEXT,
    "notesShort" TEXT,
    "remarks" TEXT,
    "tags" TEXT,
    "categorization" TEXT,
    "language" TEXT,
    "whoIsClient" TEXT,
    "whenCanInvest" "InvestTimeline",
    "potential" "Potential",
    "fundReadiness" "FundReadiness",
    "moodStatus" "MoodStatus",
    "detailShared" TEXT,
    "photoUrls" TEXT,
    "meetingDate" TIMESTAMP(3),
    "siteVisitDate" TIMESTAMP(3),
    "followupDate" TIMESTAMP(3),
    "todoNext" TEXT,
    "aiScore" "AIScore",
    "aiScoreValue" INTEGER,
    "aiSummary" TEXT,
    "aiNextAction" TEXT,
    "aiUpdatedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "forwardedTeam" TEXT,
    "fingerprint" TEXT,
    "lastTouchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "developer" TEXT,
    "city" TEXT NOT NULL,
    "area" TEXT,
    "country" TEXT NOT NULL DEFAULT 'UAE',
    "status" "ProjectStatus" NOT NULL DEFAULT 'OFF_PLAN',
    "handoverDate" TIMESTAMP(3),
    "description" TEXT,
    "brochureUrl" TEXT,
    "heroColor" TEXT,
    "rera" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "configuration" TEXT NOT NULL,
    "carpetArea" DOUBLE PRECISION,
    "builtUpArea" DOUBLE PRECISION,
    "floor" INTEGER,
    "view" TEXT,
    "priceBase" DOUBLE PRECISION NOT NULL,
    "priceFinal" DOUBLE PRECISION,
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadProperty" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "type" "LeadInterestType" NOT NULL DEFAULT 'PRIMARY',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "ActivityType" NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'PLANNED',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "userId" TEXT NOT NULL,
    "direction" "CallDirection" NOT NULL DEFAULT 'OUTBOUND',
    "phoneNumber" TEXT NOT NULL,
    "durationSec" INTEGER,
    "outcome" "CallOutcome" NOT NULL,
    "notes" TEXT,
    "ivrProvider" TEXT,
    "ivrCallId" TEXT,
    "recordingUrl" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "direction" "WAMessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "templateId" TEXT,
    "providerMsgId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeKey" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsed" TIMESTAMP(3),

    CONSTRAINT "IntakeKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_fingerprint_key" ON "Lead"("fingerprint");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_source_idx" ON "Lead"("source");

-- CreateIndex
CREATE INDEX "Lead_ownerId_idx" ON "Lead"("ownerId");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Project_city_idx" ON "Project"("city");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Unit_status_idx" ON "Unit"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_projectId_code_key" ON "Unit"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LeadProperty_leadId_unitId_key" ON "LeadProperty"("leadId", "unitId");

-- CreateIndex
CREATE INDEX "Activity_leadId_idx" ON "Activity"("leadId");

-- CreateIndex
CREATE INDEX "Activity_scheduledAt_idx" ON "Activity"("scheduledAt");

-- CreateIndex
CREATE INDEX "Activity_status_idx" ON "Activity"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CallLog_ivrCallId_key" ON "CallLog"("ivrCallId");

-- CreateIndex
CREATE INDEX "CallLog_leadId_idx" ON "CallLog"("leadId");

-- CreateIndex
CREATE INDEX "CallLog_userId_idx" ON "CallLog"("userId");

-- CreateIndex
CREATE INDEX "CallLog_startedAt_idx" ON "CallLog"("startedAt");

-- CreateIndex
CREATE INDEX "Note_leadId_idx" ON "Note"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_providerMsgId_key" ON "WhatsAppMessage"("providerMsgId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_phoneNumber_idx" ON "WhatsAppMessage"("phoneNumber");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_leadId_idx" ON "WhatsAppMessage"("leadId");

-- CreateIndex
CREATE INDEX "Assignment_leadId_idx" ON "Assignment"("leadId");

-- CreateIndex
CREATE INDEX "Assignment_userId_idx" ON "Assignment"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeKey_key_key" ON "IntakeKey"("key");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadProperty" ADD CONSTRAINT "LeadProperty_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadProperty" ADD CONSTRAINT "LeadProperty_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
