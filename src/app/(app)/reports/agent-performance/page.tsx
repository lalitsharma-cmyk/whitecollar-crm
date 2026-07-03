import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import Link from "next/link";
import {
  buildAgentReport,
  resolveDateRange,
  type ReportScope,
} from "@/lib/agentPerformance";
import AgentPerformanceTable from "@/components/AgentPerformanceTable";
import AgentRankings from "@/components/AgentRankings";
import ConversionFunnel, { aggregateFunnel } from "@/components/ConversionFunnel";
import AgentPerfRangeSelector from "@/components/AgentPerfRangeSelector";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// /reports/agent-performance — Agent Lead Performance report.
//   ADMIN   → all agents, optional team filter (All | Dubai | India).
//   MANAGER → agents on their own team only (team filter locked).
//   AGENT   → only their own row (no team filter, no rankings drill of peers).
// All metrics respect the ?range=… time window (IST day boundaries).
// ─────────────────────────────────────────────────────────────────────────

export default async function AgentPerformancePage({
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

  const scope: ReportScope = {
    role: me.role as ReportScope["role"],
    meId: me.id,
    team: resolvedTeam,
  };

  const rows = await buildAgentReport(range, scope);
  const overallFunnel = aggregateFunnel(rows);

  // Thread the active filters onto links (detail view + export) so they open
  // in the same window/scope.
  const qs = new URLSearchParams();
  qs.set("range", range.preset);
  if (range.preset === "custom") {
    if (sp.from) qs.set("from", sp.from);
    if (sp.to) qs.set("to", sp.to);
  }
  if (resolvedTeam) qs.set("team", resolvedTeam);
  const query = `?${qs.toString()}`;

  const isAgent = me.role === "AGENT";
  const isAdmin = me.role === "ADMIN";

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">📈 Agent Lead Performance</h1>
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
                <Link href={`/reports/agent-performance?range=${range.preset}&team=Dubai`} className={resolvedTeam === "Dubai" ? "on" : ""}>🇦🇪 Dubai</Link>
                <Link href={`/reports/agent-performance?range=${range.preset}&team=India`} className={resolvedTeam === "India" ? "on" : ""}>🇮🇳 India</Link>
                <Link href={`/reports/agent-performance?range=${range.preset}`} className={!resolvedTeam ? "on" : ""}>All</Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Time window selector */}
      <AgentPerfRangeSelector current={range.preset} from={sp.from} to={sp.to} />

      {/* Export (CSV) — OWNER (Super Admin) only, matching the server gate; others see a note */}
      {me.isSuperAdmin ? (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500">Export:</span>
          <a href={`/api/reports/agent-performance/export${query}&format=csv`} className="btn btn-ghost text-xs">⬇️ CSV</a>
          <a href={`/api/reports/agent-performance/export${query}&format=xlsx`} className="btn btn-ghost text-xs">⬇️ Excel</a>
        </div>
      ) : (
        <div className="text-[11px] text-gray-500 italic">CSV/Excel export is restricted to the owner (Super Admin).</div>
      )}

      {/* Per-agent metrics table */}
      <AgentPerformanceTable rows={rows} query={query} />

      {/* Conversion funnel (overall / scope) */}
      <ConversionFunnel
        stages={overallFunnel}
        title={isAgent ? "Your conversion funnel" : `Conversion funnel — ${resolvedTeam ?? "all agents"}`}
      />

      {/* Manager rankings — hidden for AGENT (single-row scope) */}
      {!isAgent && rows.length > 1 && <AgentRankings rows={rows} />}

      <div className="card p-3 bg-blue-50 border-l-4 border-blue-400 text-[11px] text-blue-800 leading-relaxed">
        <strong>How to read this:</strong> Assignment metrics count by the lead&apos;s <strong>current owner</strong> — a lead
        reassigned from one agent to another immediately follows the new owner, so &quot;Total Assigned&quot; matches global search,
        the Leads list, the lead detail page, and export. (A lead the agent owned that is now rejected-and-unassigned is still
        attributed to them.) Rejected leads are included in handled volume. Deleted / recycle-bin leads are never counted. The
        Assignment group is a current snapshot (not period-filtered); Outcomes / Engagement / Meetings respect the period filter.
        Counts reconcile 1:1 with the lead lists they link to. Revenue / brokerage / booking-value tracking can be layered on later
        without changing this report.
      </div>
    </>
  );
}
