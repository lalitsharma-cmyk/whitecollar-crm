-- DUBAI BUYER DATA — market segregation field (additive, idempotent, reversible).
--
-- The Buyer Data module becomes "Dubai Buyer Data": only Dubai/UAE buyers live
-- here. `market` is the seam that keeps it market-scoped — every read in the
-- module pins market = 'Dubai', assignment is limited to Dubai-team users +
-- admins, and visibility is Dubai-team + admin only. A FUTURE Gurgaon/India
-- module will be SEPARATE (its own market value, pages, and assignment rules).
--
-- Existing buyers are ALL Dubai today, so the column defaults to 'Dubai' and the
-- backfill sets every pre-existing row to 'Dubai' explicitly (the DEFAULT only
-- covers rows inserted after this runs; the UPDATE covers the rows already there).
--
-- Fully additive: one NOT NULL column with a default (no row rewrite needed —
-- Postgres fills the default), an index, no existing data destroyed. Re-runnable
-- (IF NOT EXISTS) so a hand-apply and a later `prisma migrate deploy` converge.

ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "market" TEXT NOT NULL DEFAULT 'Dubai';

-- Backfill: every existing buyer is a Dubai buyer. (NULL can't occur given the
-- NOT NULL default, but the explicit UPDATE documents intent + is idempotent.)
UPDATE "BuyerRecord" SET "market" = 'Dubai' WHERE "market" IS NULL OR "market" = '';

CREATE INDEX IF NOT EXISTS "BuyerRecord_market_idx" ON "BuyerRecord"("market");
