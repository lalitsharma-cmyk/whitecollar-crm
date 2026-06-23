import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { prisma } from "@/lib/prisma";
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

  const range = resolveDateRange(sp.range, sp.from, sp.to);

  // Team scope: ADMIN free choice; MANAGER locked to own team; AGENT n/a.
  const resolvedTeam: "India" | "Dubai" | null = (() => {
    if (me.role === "MANAGER") return (normalizeTeam(me.team) as "India" | "Dubai" | null) ?? null;
    if (me.role === "ADMIN") {
      if (sp.team === "India" || sp.team === "Dubai") return sp.team;
      return null;
    }
    return null;
  })();

  const scope: BuyerReportScope = {
    role: me.role as BuyerReportScope["role"],
    meId: me.id,
    team: resolvedTeam,
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
  const teamOwnerIds: string[] | null =
    isAdmin && !resolvedTeam ? null : rows.map((r) => r.agentId);
  const summary = await buildBuyerSummary(teamOwnerIds);

  // Thread the active filters onto links (detail view + export) so they open in
  // the same window/scope.
  const qs = new URLSearchParams();
  qs.set("range", range.preset);
  if (range.preset === "custom") {
    if (sp.from) qs.set("from", sp.from);
    if (sp.to) qs.set("to", sp.to);
  }
  if (resolvedTeam) qs.set("team", resolvedTeam);
  const query = `?${qs.toString()}`;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">🤝 Buyer Data Performance</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            {range.label}
            {resolvedTeam ? ` · ${resolvedTeam} team` : me.role === "ADMIN" ? " · all teams" : ""}
            {isAgent ? " · your performance" : ""}
          </p>
        </div>

        {/* Team filter — ADMIN interactive, MANAGER locked, AGENT hidden */}
        {!isAgent && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {me.role === "MANAGER" ? (
              <div className="seg opacity-60 cursor-not-allowed" title="Locked to your team">
                <span className="pointer-events-none on">{resolvedTeam ?? "Your team"}</span>
              </div>
            ) : (
              <div className="seg">
                <Link href={`/reports/buyer-performance?range=${range.preset}&team=Dubai`} className={resolvedTeam === "Dubai" ? "on" : ""}>🇦🇪 Dubai</Link>
                <Link href={`/reports/buyer-performance?range=${range.preset}&team=India`} className={resolvedTeam === "India" ? "on" : ""}>🇮🇳 India</Link>
                <Link href={`/reports/buyer-performance?range=${range.preset}`} className={!resolvedTeam ? "on" : ""}>All</Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Time window selector (shared component — keys off the current path) */}
      <AgentPerfRangeSelector current={range.preset} from={sp.from} to={sp.to} />

      {/* Export (CSV/Excel) — admin gets a watermarked extract; others see a note */}
      {isAdmin ? (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500">Export:</span>
          <a href={`/api/reports/buyer-performance/export${query}&format=csv`} className="btn btn-ghost text-xs">⬇️ CSV</a>
          <a href={`/api/reports/buyer-performance/export${query}&format=xlsx`} className="btn btn-ghost text-xs">⬇️ Excel</a>
        </div>
      ) : (
        <div className="text-[11px] text-gray-500 italic">CSV/Excel export is Admin-only.</div>
      )}

      {/* Admin summary dashboard (pool health) */}
      <BuyerSummaryDashboard summary={summary} />

      {/* Per-agent metrics table */}
      <BuyerPerformanceTable rows={rows} query={query} />

      {/* Conversion funnel (overall / scope) */}
      <BuyerConversionFunnel
        stages={overallFunnel}
        title={isAgent ? "Your buyer conversion funnel" : `Buyer conversion funnel — ${resolvedTeam ?? "all agents"}`}
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
