-- HR: preserve the exact Excel status + link candidates to their import batch.
ALTER TABLE "HRCandidate" ADD COLUMN "originalStatus" TEXT;
ALTER TABLE "HRCandidate" ADD COLUMN "importBatchId" TEXT;
CREATE INDEX "HRCandidate_importBatchId_idx" ON "HRCandidate"("importBatchId");

ALTER TABLE "HRImport" ADD COLUMN "errors" TEXT;

ALTER TABLE "HRCandidate" ADD CONSTRAINT "HRCandidate_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "HRImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
