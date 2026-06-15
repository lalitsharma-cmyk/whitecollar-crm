-- Website→HR real-time intake: application history + delivery/failure logs.
-- Fully additive (2 new tables + 1 defaulted column) → existing rows untouched.

-- Application history — one row per submission; re-applies append here.
CREATE TABLE "HRApplication" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "positionApplied" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "locationPreference" TEXT,
    "experience" TEXT,
    "resumeId" TEXT,
    "statusAtApply" "HRCandidateStatus" NOT NULL DEFAULT 'NEW',
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HRApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HRApplication_candidateId_submittedAt_idx" ON "HRApplication"("candidateId", "submittedAt");
CREATE INDEX "HRApplication_source_idx" ON "HRApplication"("source");
ALTER TABLE "HRApplication" ADD CONSTRAINT "HRApplication_candidateId_fkey"
    FOREIGN KEY ("candidateId") REFERENCES "HRCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Delivery + failed-submission log (every POST /api/intake/hr writes one row).
CREATE TABLE "HRIntakeLog" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "outcome" TEXT NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "candidateId" TEXT,
    "applicationId" TEXT,
    "error" TEXT,
    "payload" JSONB,
    "ip" TEXT,
    CONSTRAINT "HRIntakeLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HRIntakeLog_receivedAt_idx" ON "HRIntakeLog"("receivedAt");
CREATE INDEX "HRIntakeLog_outcome_idx" ON "HRIntakeLog"("outcome");

-- HR scope flag on intake keys (authorizes the HR endpoint, separate from Sales).
ALTER TABLE "IntakeKey" ADD COLUMN "hrScope" BOOLEAN NOT NULL DEFAULT false;
