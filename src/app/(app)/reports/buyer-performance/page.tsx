import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { canAccessBuyerMarket, type BuyerMarket } from "@/lib/buyerScope";
import Link from "next/link";
import {
  buildBuyerReport,
  buildBuyerSummary,
  resolveDateRange,
  type BuyerReportScope,
} from "@/lib/buyerPerformance";
import BuyerPerformanceTable from "@/components/BuyerPerformanceTable";
import BuyerSummaryDashboard from "@/components/BuyerSummaryDashboard";
import BuyerRankings from "@/components/BuyerRankings";
import BuyerConversionFunnel, { aggregateBuyerFunnel } from "@/components/BuyerConversionFunnel";
import AgentPerfRangeSelector from "@/components/AgentPerfRangeSelector";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// /reports/buyer-performance — Buyer Data Performance report (Part 6).
// The parallel of /reports/agent-performance, for the Buyer Data worked pipeline.
//   ADMIN   → all agents, optional team filter (All | Dubai | India) + full pool summary.
//   MANAGER → agents on their own team only (team filter locked).
//   AGENT   → only their own row (no team filter, no peer rankings).
// All metrics respect the ?range=… time window (IST day boundaries).
// ─────────────────────────────────────────────────────────────────────────

export default async function BuyerPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  // Market-aware (both-markets rule): ?market=India|Dubai. Access is gated to that
  // market — a Dubai-team user can't open the India report and vice-versa (admins
  // see both). Same page, same metrics; only the market (+ currency/team) differs.
  const market: BuyerMarket = sp.market === "India" ? "India" : "Dubai";
  if (!canAccessBuyerMarket(me, market)) redirect("/reports");

  const range = resolveDateRange(sp.range, sp.from, sp.to);

  // scope.team drives the agent roster + every buyer query's market in the engine.
  const scope: BuyerReportScope = {
    role: me.role as BuyerReportScope["role"],
    meId: me.id,
    team: market,
  };

  const rows = await buildBuyerReport(range, scope);
  const overallFunnel = aggregateBuyerFunnel(rows);

  const isAgent = me.role === "AGENT";
  const isAdmin = me.role === "ADMIN";

  // Admin summary owner-scoping. ADMIN with no team filter → whole pool (null).
  // Otherwise restrict to the in-scope agents (a team-filtered admin / manager /
  // agent), so the summary slice matches the rows shown. The unassigned Admin
  // Pool is owner-less so it only appears in the unscoped (whole-pool) view —
  // that is correct: the pool is no single team's.
  // ADMIN → whole Dubai pool (null = market-scoped whole pool, incl. the
  // unassigned Admin Pool). Non-admin Dubai users → only their in-scope agents.
  const teamOwnerIds: string[] | null =
    isAdmin ? null : rows.map((r) => r.agentId);
  const summary = await buildBuyerSummary(teamOwnerIds, market);

  // Thread the active filters onto links (detail view + export) so they open in
  // the same window/scope.
  const qs = new URLSearchParams();
  qs.set("range", range.preset);
  if (range.preset === "custom") {
    if (sp.from) qs.set("from", sp.from);
    if (sp.to) qs.set("to", sp.to);
  }
  if (market === "India") qs.set("market", "India"); // keep the market on export + range links
  const query = `?${qs.toString()}`;
  const otherMarket: BuyerMarket = market === "India" ? "Dubai" : "India";

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">{market === "India" ? "🇮🇳 India" : "🇦🇪 Dubai"} Buyer Data Performance</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            {range.label}
            {market === "India" ? " · India market (₹)" : " · Dubai market"}
            {isAgent ? " · your performance" : ""}
          </p>
        </div>
        {/* Market toggle — admins can access both; a market-team user only sees their
            own (canAccessBuyerMarket redirects the other). Same report, other market. */}
        {canAccessBuyerMarket(me, otherMarket) && (
          <Link href={`/reports/buyer-performance${otherMarket === "India" ? "?market=India" : ""}`} className="btn btn-ghost text-xs self-start">
            Switch to {otherMarket} →
          </Link>
        )}
      </div>

      {/* Time window selector (shared component — keys off the current path) */}
      <AgentPerfRangeSelector current={range.preset} from={sp.from} to={sp.to} />

      {/* Export (CSV/Excel) — OWNER (Super Admin) only, matching the server gate; others see a note */}
      {me.isSuperAdmin ? (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500">Export:</span>
          <a href={`/api/reports/buyer-performance/export${query}&format=csv`} className="btn btn-ghost text-xs">⬇️ CSV</a>
          <a href={`/api/reports/buyer-performance/export${query}&format=xlsx`} className="btn btn-ghost text-xs">⬇️ Excel</a>
        </div>
      ) : (
        <div className="text-[11px] text-gray-500 italic">CSV/Excel export is restricted to the owner (Super Admin).</div>
      )}

      {/* Admin summary dashboard (pool health) */}
      <BuyerSummaryDashboard summary={summary} />

      {/* Per-agent metrics table */}
      <BuyerPerformanceTable rows={rows} query={query} />

      {/* Conversion funnel (overall / scope) */}
      <BuyerConversionFunnel
        stages={overallFunnel}
        title={isAgent ? "Your Dubai buyer conversion funnel" : "Dubai buyer conversion funnel"}
      />

      {/* Agent rankings — hidden for AGENT (single-row scope) */}
      {!isAgent && rows.length > 1 && <BuyerRankings rows={rows} />}

      <div className="card p-3 bg-blue-50 border-l-4 border-blue-400 text-[11px] text-blue-800 leading-relaxed">
        <strong>How to read this:</strong> The <strong>Assigned</strong> column counts by <strong>stint history</strong> (the agent who held the buyer when a
        stint opened in the period) — so a buyer reassigned later still counts for whoever worked it. <strong>Converted / Rejected / Returns /
        Contact / Attempts</strong> count the agent&apos;s actions from the buyer activity log. Rejected &amp; returned buyers are included in handled
        volume. Deleted / recycle-bin buyers are never counted. Every metric respects the period filter and reconciles 1:1 with the buyer
        records it links to (click any agent → any number → the exact records behind it).
      </div>
    </>
  );
}
