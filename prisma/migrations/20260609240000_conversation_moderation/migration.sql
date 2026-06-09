-- Conversation moderation (Lalit-only): per-remark visibility overlay + audit log.

-- 1. Permission flag — explicit grant, NOT tied to the ADMIN role.
ALTER TABLE "User" ADD COLUMN "canControlConversations" BOOLEAN NOT NULL DEFAULT false;

-- 2. RemarkVisibility — overlay controlling who sees a parsed remark.
--    Never edits the original Lead.remarks text (Super-Admin backup retained).
CREATE TABLE "RemarkVisibility" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "remarkKey" TEXT NOT NULL,
    "deletedFromView" BOOLEAN NOT NULL DEFAULT false,
    "hiddenFromAll" BOOLEAN NOT NULL DEFAULT false,
    "hiddenFromUserIds" TEXT,
    "reason" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RemarkVisibility_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RemarkVisibility_leadId_remarkKey_key" ON "RemarkVisibility"("leadId", "remarkKey");
CREATE INDEX "RemarkVisibility_leadId_idx" ON "RemarkVisibility"("leadId");

-- 3. RemarkAuditLog — append-only forensic trail of every moderation action.
CREATE TABLE "RemarkAuditLog" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "remarkKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "targetUserId" TEXT,
    "targetName" TEXT,
    "oldState" TEXT,
    "newState" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RemarkAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RemarkAuditLog_leadId_remarkKey_idx" ON "RemarkAuditLog"("leadId", "remarkKey");
CREATE INDEX "RemarkAuditLog_leadId_idx" ON "RemarkAuditLog"("leadId");
CREATE INDEX "RemarkAuditLog_createdAt_idx" ON "RemarkAuditLog"("createdAt");
