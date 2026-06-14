-- CreateTable
CREATE TABLE "LeadFieldHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,

    CONSTRAINT "LeadFieldHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadFieldHistory_leadId_changedAt_idx" ON "LeadFieldHistory"("leadId", "changedAt");

-- CreateIndex
CREATE INDEX "LeadFieldHistory_changedById_changedAt_idx" ON "LeadFieldHistory"("changedById", "changedAt");

-- CreateIndex
CREATE INDEX "LeadFieldHistory_field_changedAt_idx" ON "LeadFieldHistory"("field", "changedAt");

-- AddForeignKey
ALTER TABLE "LeadFieldHistory" ADD CONSTRAINT "LeadFieldHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFieldHistory" ADD CONSTRAINT "LeadFieldHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
