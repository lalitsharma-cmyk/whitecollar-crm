-- HR ATS — resume content hash for cross-candidate duplicate detection.
-- Additive, idempotent. Hand-applied to Neon per docs/MIGRATION-LEDGER.md.
ALTER TABLE "HRResume" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
CREATE INDEX IF NOT EXISTS "HRResume_contentHash_idx" ON "HRResume"("contentHash");
