-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "company" TEXT,
    "city" TEXT,
    "country" TEXT,
    "address" TEXT,
    "source" TEXT NOT NULL DEFAULT 'WEBSITE',
    "sourceDetail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "currentStatus" TEXT,
    "budgetMin" REAL,
    "budgetMax" REAL,
    "budgetCurrency" TEXT NOT NULL DEFAULT 'AED',
    "configuration" TEXT,
    "notesShort" TEXT,
    "remarks" TEXT,
    "tags" TEXT,
    "categorization" TEXT,
    "language" TEXT,
    "whoIsClient" TEXT,
    "whenCanInvest" TEXT,
    "potential" TEXT,
    "fundReadiness" TEXT,
    "moodStatus" TEXT,
    "detailShared" TEXT,
    "photoUrls" TEXT,
    "meetingDate" DATETIME,
    "siteVisitDate" DATETIME,
    "followupDate" DATETIME,
    "todoNext" TEXT,
    "aiScore" TEXT,
    "aiScoreValue" INTEGER,
    "aiSummary" TEXT,
    "aiNextAction" TEXT,
    "aiUpdatedAt" DATETIME,
    "ownerId" TEXT,
    "forwardedTeam" TEXT,
    "fingerprint" TEXT,
    "lastTouchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Lead" ("aiNextAction", "aiScore", "aiScoreValue", "aiSummary", "aiUpdatedAt", "budgetMax", "budgetMin", "city", "configuration", "country", "createdAt", "email", "fingerprint", "id", "language", "lastTouchedAt", "name", "notesShort", "ownerId", "phone", "source", "sourceDetail", "status", "tags", "updatedAt") SELECT "aiNextAction", "aiScore", "aiScoreValue", "aiSummary", "aiUpdatedAt", "budgetMax", "budgetMin", "city", "configuration", "country", "createdAt", "email", "fingerprint", "id", "language", "lastTouchedAt", "name", "notesShort", "ownerId", "phone", "source", "sourceDetail", "status", "tags", "updatedAt" FROM "Lead";
DROP TABLE "Lead";
ALTER TABLE "new_Lead" RENAME TO "Lead";
CREATE UNIQUE INDEX "Lead_fingerprint_key" ON "Lead"("fingerprint");
CREATE INDEX "Lead_status_idx" ON "Lead"("status");
CREATE INDEX "Lead_source_idx" ON "Lead"("source");
CREATE INDEX "Lead_ownerId_idx" ON "Lead"("ownerId");
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
