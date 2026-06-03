-- Lead Routing Architecture — routing provenance + team index (Lalit, 2026-06-03)
--
-- Purely additive. Adds three nullable text columns capturing HOW/WHY a lead
-- was routed to its team, plus an index on forwardedTeam (the canonical team
-- marker) to keep per-team scoping/reporting queries fast. The Lead table is
-- empty at apply time, so there is no backfill and zero risk.
--
-- forwardedTeam stays NULLABLE on purpose: NULL = "not yet classified", which
-- the mandatory routing gate (src/lib/teamRouting.ts) treats as "suppress ALL
-- automation until a team is assigned".

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "routingMethod" TEXT;
ALTER TABLE "Lead" ADD COLUMN "routingSource" TEXT;
ALTER TABLE "Lead" ADD COLUMN "routingReason" TEXT;

-- CreateIndex
CREATE INDEX "Lead_forwardedTeam_idx" ON "Lead"("forwardedTeam");
