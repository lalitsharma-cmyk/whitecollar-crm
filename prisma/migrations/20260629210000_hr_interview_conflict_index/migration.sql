-- HR interview conflict-detection perf index. Additive, idempotent.
-- Hand-applied to Neon per docs/MIGRATION-LEDGER.md, then `migrate resolve --applied`.
CREATE INDEX IF NOT EXISTS "HRInterview_interviewerId_scheduledAt_idx" ON "HRInterview"("interviewerId", "scheduledAt");
