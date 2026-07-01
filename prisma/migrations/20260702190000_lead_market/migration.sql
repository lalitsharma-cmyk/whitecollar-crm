-- Lead.market (India | UAE) — DISTINCT from Team (forwardedTeam). Additive,
-- idempotent, non-destructive. Permanent market-segregation rule (Lalit 2026-07-02).
-- No existing data read/changed; backfilled separately (deterministic, reversible).
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "market" TEXT;
CREATE INDEX IF NOT EXISTS "Lead_market_idx" ON "Lead"("market");
