import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { canAccessBuyerMarket } from "@/lib/buyerScope";
import Link from "next/link";
import {
  buildAgentReport,
  resolveDateRange,
  type ReportScope,
} from "@/lib/agentPerformance";
import { LEAD_SOURCE_MODULES, type SourceModule } from "@/lib/moduleSource";
import AgentPerformanceTable from "@/components/AgentPerformanceTable";
import AgentRankings from "@/components/AgentRankings";
import ConversionFunnel, { aggregateFunnel } from "@/components/ConversionFunnel";
import AgentPerfRangeSelector from "@/components/AgentPerfRangeSelector";
import ModuleFilter from "@/components/ModuleFilter";
import ReportViewToggle from "@/components/ReportViewToggle";
import BuyerPerformanceSection from "@/components/BuyerPerformanceSection";

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

  const isAgent = me.role === "AGENT";
  const isAdmin = me.role === "ADMIN";

  // ── Module filter (All | Leads | Master Data | Revival) — applies to the Lead
  // section only. Buyers have their own market split (handled in the Buyer section).
  const module: SourceModule | "all" =
    sp.module && (LEAD_SOURCE_MODULES as string[]).includes(sp.module)
      ? (sp.module as SourceModule)
      : "all";

  // ── Lead / Buyer / Combined view (PARALLEL sections). Default "lead". Buyer &
  // Combined require access to at least one buyer market (admin, or a market team).
  const canDubai = canAccessBuyerMarket(me, "Dubai");
  const canIndia = canAccessBuyerMarket(me, "India");
  const showBuyer = canDubai || canIndia;
  const view: "lead" | "buyer" | "combined" =
    showBuyer && (sp.view === "buyer" || sp.view === "combined") ? sp.view : "lead";
  const showLeadSection = view === "lead" || view === "combined";
  const showBuyerSection = showBuyer && (view === "buyer" || view === "combined");

  // Only build the (heavier) lead report when the lead section is visible.
  const rows = showLeadSection ? await buildAgentReport(range, scope) : [];
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
  if (module !== "all") qs.set("module", module);
  const query = `?${qs.toString()}`;

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

      {/* View toggle (Lead / Buyer / Combined) + Module filter (Lead section only) */}
      <div className="card p-3 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
        <ReportViewToggle current={view} showBuyer={showBuyer} />
        {showLeadSection && <ModuleFilter current={module} />}
      </div>

      {/* Export (CSV) — OWNER (Super Admin) only, matching the server gate; others see a note */}
      {me.isSuperAdmin ? (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500">Export:</span>
          <a href={`/api/reports/agent-performance/export${query}&format=csv`} className="btn btn-ghost text-xs">⬇️ CSV (leads)</a>
          <a href={`/api/reports/agent-performance/export${query}&format=xlsx`} className="btn btn-ghost text-xs">⬇️ Excel (leads)</a>
        </div>
      ) : (
        <div className="text-[11px] text-gray-500 italic">CSV/Excel export is restricted to the owner (Super Admin).</div>
      )}

      {/* ── LEAD SECTION (module-bifurcated) ─────────────────────────────── */}
      {showLeadSection && (
        <div className="flex flex-col gap-3">
          {view === "combined" && <h2 className="text-lg font-bold">🧲 Lead Performance</h2>}

          {/* Per-agent metrics table (module-aware) */}
          <AgentPerformanceTable rows={rows} query={query} module={module} />

          {/* Conversion funnel (overall / scope) */}
          <ConversionFunnel
            stages={overallFunnel}
            title={isAgent ? "Your conversion funnel" : `Conversion funnel — ${resolvedTeam ?? "all agents"}`}
          />

          {/* Manager rankings — hidden for AGENT (single-row scope) */}
          {!isAgent && rows.length > 1 && <AgentRankings rows={rows} />}
        </div>
      )}

      {/* ── BUYER SECTION (parallel — Dubai + India, buyer metrics only) ──── */}
      {showBuyerSection && (
        <div className="flex flex-col gap-6">
          {view === "combined" && (
            <div className="border-t border-gray-200 pt-2 text-[11px] uppercase tracking-widest text-gray-400 font-semibold">
              Buyer Data — parallel section (separate metrics, not merged with leads)
            </div>
          )}
          {canDubai && (
            <BuyerPerformanceSection
              market="Dubai"
              range={range}
              meId={me.id}
              role={me.role as ReportScope["role"]}
              isAdmin={isAdmin && !resolvedTeam}
            />
          )}
          {canIndia && (
            <BuyerPerformanceSection
              market="India"
              range={range}
              meId={me.id}
              role={me.role as ReportScope["role"]}
              isAdmin={isAdmin && !resolvedTeam}
            />
          )}
        </div>
      )}

      <div className="card p-3 bg-blue-50 border-l-4 border-blue-400 text-[11px] text-blue-800 leading-relaxed">
        <strong>How to read this:</strong> The report has two PARALLEL sections. <strong>Lead Performance</strong> bifurcates every
        lead metric across the three lead-origin modules — <strong>Leads · Master Data · Revival Engine</strong> — so every total =
        Leads + Master Data + Revival (expand any agent row, or use the Module filter). <strong>Buyer Data</strong> is a separate section
        with buyer-appropriate metrics (assigned / converted / returned / attempts), split Dubai vs India — never lead metrics like
        Fresh or Follow-up. Lead assignment counts by <strong>current owner</strong> (a reassigned lead follows its new owner, matching
        global search / the Leads list / export). Rejected leads are included in handled volume; deleted / recycle-bin records are never
        counted. Assignment is a current snapshot; Outcomes / Engagement / Meetings respect the period filter.
      </div>
    </>
  );
}
