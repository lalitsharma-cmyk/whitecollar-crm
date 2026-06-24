import Link from "next/link";
import {
  buildAgentReport,
  summarizeReport,
  resolveDateRange,
  RANGE_OPTIONS,
  type ReportScope,
  type AgentMetrics,
  type DrillKey,
} from "@/lib/agentPerformance";
import DashboardAssignmentControls from "@/components/DashboardAssignmentControls";
import DashboardLiveRefresh from "@/components/DashboardLiveRefresh";

// ─────────────────────────────────────────────────────────────────────────
// DASHBOARD — Live Lead Assignment & Status widget (ADMIN / MANAGER only).
//
// REUSE: this is a thin VIEW over the existing agent-performance engine. It
// calls buildAgentReport(range, scope) — the same assignment-history-based,
// IST-windowed, deletedAt-excluded builder the /reports/agent-performance page
// uses — then renders the per-agent CURRENT-status breakdown (curFresh …
// curOther, freshAssigned, rejected, assignedActive) that was ADDED to
// AgentMetrics. Every number deep-links into the SAME drill route
// (/reports/agent-performance/[agentId]/drill?metric=…) whose where-clause is
// drilldownWhere(metric, agentId, range) — so count == records, 1:1.
//
// Namespaced URL params (dwRange / dwFrom / dwTo / dwTeam) keep this widget's
// filters independent of the dashboard's own ?team/?from/?to.
// ─────────────────────────────────────────────────────────────────────────

function num(n: number): string {
  return n.toLocaleString("en-IN");
}
function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

// Column definitions: header label + the AgentMetrics field + the drill key.
// Order matches the spec: Fresh Received | Current Fresh | Contacted |
// Qualified | Meeting | Site Visit | Negotiation | Booked/Won | Lost |
// Rejected | Active.
const COLS: Array<{ label: string; field: keyof AgentMetrics; drill: DrillKey; tone?: string; title?: string }> = [
  { label: "Fresh Recv.", field: "freshAssigned", drill: "freshAssigned", title: "Assigned in this window while still Fresh (fresh-at-assignment)" },
  { label: "Cur. Fresh", field: "curFresh", drill: "curFresh", title: "Assigned-in-window leads whose status is currently Fresh" },
  { label: "Contacted", field: "curContacted", drill: "curContacted", title: "Currently in active follow-up (Follow Up / Postponed)" },
  { label: "Qualified", field: "curQualified", drill: "curQualified", title: "Engaged & advanced (Long Term Follow Up)" },
  { label: "Meeting", field: "curMeeting", drill: "curMeeting", tone: "text-teal-700", title: "Currently at a meeting stage (Meeting / Office / Zoom / Expo)" },
  { label: "Site Visit", field: "curSiteVisit", drill: "curSiteVisit", tone: "text-cyan-700", title: "Currently at a site-visit stage (Site Visit Schedule / Visit Dubai)" },
  { label: "Negotiation", field: "curNegotiation", drill: "curNegotiation", title: "In discussion (Details / Mail Sent)" },
  { label: "Booked/Won", field: "curBooked", drill: "curBooked", tone: "text-emerald-700 font-semibold", title: "Booked With Us" },
  { label: "Lost", field: "curLost", drill: "curLost", tone: "text-rose-600", title: "Currently a Lost status" },
  { label: "Rejected", field: "rejected", drill: "rejected", tone: "text-rose-700", title: "Rejected in this window (by rejection date)" },
  { label: "Active", field: "assignedActive", drill: "assignedActive", tone: "font-semibold", title: "Assigned-in-window and currently still workable" },
];

function Cell({
  value,
  agentId,
  drill,
  query,
  tone,
}: {
  value: number;
  agentId: string;
  drill: DrillKey;
  query: string;
  tone?: string;
}) {
  const cls = `text-center ${tone ?? ""}`;
  if (value === 0) {
    return <td className={`${cls} text-gray-300`}>0</td>;
  }
  return (
    <td className={cls}>
      <Link
        href={`/reports/agent-performance/${agentId}/drill${query}&metric=${drill}`}
        className="hover:underline hover:text-blue-700"
      >
        {num(value)}
      </Link>
    </td>
  );
}

function SummaryCard({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <div className={`card p-3 border-l-4 ${accent}`}>
      <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold leading-tight">{label}</div>
      <div className="text-xl font-extrabold mt-1 dark:text-white">{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default async function DashboardAssignmentWidget({
  role,
  meId,
  lockedTeam,
  sp,
}: {
  role: "ADMIN" | "MANAGER";
  meId: string;
  /** MANAGER → their own team (locked); ADMIN → null (free choice). */
  lockedTeam: "India" | "Dubai" | null;
  sp: Record<string, string | undefined>;
}) {
  // Resolve the widget's OWN namespaced range params (dwRange/dwFrom/dwTo).
  const range = resolveDateRange(sp.dwRange, sp.dwFrom, sp.dwTo);

  // Team scope: MANAGER forced to own team; ADMIN reads ?dwTeam=.
  const team: "" | "India" | "Dubai" =
    lockedTeam ?? (sp.dwTeam === "India" || sp.dwTeam === "Dubai" ? sp.dwTeam : "");
  const scope: ReportScope = { role, meId, team: team || null };

  const rows = await buildAgentReport(range, scope);
  const summary = summarizeReport(rows);

  // Thread the active filters onto drill links so the drill opens in the SAME
  // window (the drill route reads ?range/?from/?to — NOT the dw* names).
  const qs = new URLSearchParams();
  qs.set("range", range.preset);
  if (range.preset === "custom") {
    if (sp.dwFrom) qs.set("from", sp.dwFrom);
    if (sp.dwTo) qs.set("to", sp.dwTo);
  }
  const query = `?${qs.toString()}`;

  // Export links (CSV / Excel) — ADMIN only (route is requireRole("ADMIN")).
  const exportQs = new URLSearchParams();
  exportQs.set("range", range.preset);
  if (range.preset === "custom") {
    if (sp.dwFrom) exportQs.set("from", sp.dwFrom);
    if (sp.dwTo) exportQs.set("to", sp.dwTo);
  }
  if (team) exportQs.set("team", team);
  const exportQuery = `?${exportQs.toString()}`;

  // Totals row across the grid.
  const totals = COLS.reduce<Record<string, number>>((acc, c) => {
    acc[c.field as string] = rows.reduce((s, m) => s + (m[c.field] as number), 0);
    return acc;
  }, {});
  const totalAssigned = rows.reduce((s, m) => s + m.totalAssigned, 0);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range.preset)?.label ?? range.label;

  return (
    <div id="assignment-widget" className="card p-3 lg:p-5 scroll-mt-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div>
          <div className="font-display text-base sm:text-lg font-bold text-[#0b1a33] dark:text-white">
            📊 Live Lead Assignment &amp; Status
          </div>
          <div className="text-[11px] text-gray-500">
            By assignment date · {rangeLabel}
            {team ? ` · ${team} team` : role === "ADMIN" ? " · all teams" : ""}
          </div>
        </div>
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <DashboardLiveRefresh intervalMs={60_000} />
          {role === "ADMIN" && (
            <div className="flex items-center gap-1.5">
              <a href={`/api/reports/agent-performance/export${exportQuery}&format=csv`} className="btn btn-ghost text-[11px]">⬇️ CSV</a>
              <a href={`/api/reports/agent-performance/export${exportQuery}&format=xlsx`} className="btn btn-ghost text-[11px]">⬇️ Excel</a>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-3">
        <DashboardAssignmentControls
          current={range.preset}
          from={sp.dwFrom}
          to={sp.dwTo}
          team={team}
          canChooseTeam={role === "ADMIN"}
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
        <SummaryCard label="Assigned" value={num(summary.totalAssigned)} accent="border-blue-500" sub="in window" />
        <SummaryCard label="Active" value={num(summary.totalActive)} accent="border-amber-500" sub="still workable" />
        <SummaryCard label="Rejected" value={num(summary.totalRejected)} accent="border-rose-500" sub="in window" />
        <SummaryCard label="Booked/Won" value={num(summary.totalBooked)} accent="border-emerald-500" sub="converted" />
        <SummaryCard label="Conversion" value={pct(summary.conversionRatePct)} accent="border-emerald-500" sub="booked ÷ assigned" />
        <SummaryCard label="Rejection" value={pct(summary.rejectionRatePct)} accent="border-rose-500" sub="rejected ÷ assigned" />
        <SummaryCard label="Meeting Rate" value={pct(summary.meetingRatePct)} accent="border-teal-500" sub="at meeting ÷ assigned" />
        <SummaryCard label="Site Visit Rate" value={pct(summary.siteVisitRatePct)} accent="border-cyan-500" sub="at SV ÷ assigned" />
      </div>

      {/* Per-agent grid (horizontal scroll on small screens) */}
      {rows.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-6">No agents in scope for this period.</div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="tbl w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-[11px]">
                <th className="sticky left-0 bg-white dark:bg-slate-800 z-10 text-left">Agent</th>
                <th className="text-center" title="Total leads assigned to this agent in the window (by assignment history)">Assigned</th>
                {COLS.map((c) => (
                  <th key={c.label} className="text-center" title={c.title}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.agentId}>
                  <td className="sticky left-0 bg-white dark:bg-slate-800 z-10 font-semibold whitespace-nowrap">
                    <Link href={`/reports/agent-performance/${m.agentId}${query}${team ? `&team=${team}` : ""}`} className="text-blue-600 hover:underline">
                      {m.agentName}
                    </Link>
                    {m.team && <span className="ml-1 text-[10px] text-gray-400">{m.team}</span>}
                  </td>
                  <Cell value={m.totalAssigned} agentId={m.agentId} drill="totalAssigned" query={query} tone="font-bold text-blue-700" />
                  {COLS.map((c) => (
                    <Cell key={c.label} value={m[c.field] as number} agentId={m.agentId} drill={c.drill} query={query} tone={c.tone} />
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 font-bold bg-gray-50/60 dark:bg-slate-700/40">
                <td className="sticky left-0 bg-gray-50 dark:bg-slate-700 z-10">Total</td>
                <td className="text-center text-blue-700">{num(totalAssigned)}</td>
                {COLS.map((c) => (
                  <td key={c.label} className={`text-center ${c.tone ?? ""}`}>{num(totals[c.field as string] ?? 0)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="text-[10px] text-gray-500 mt-3 leading-relaxed">
        <strong>Attribution:</strong> a lead counts for the agent who <strong>held it when it was assigned in the window</strong> (assignment history) — a lead created
        earlier but assigned in-window still counts here. <strong>Fresh Recv.</strong> = fresh-at-assignment; the rest are the <strong>current</strong> status of those
        assigned leads (each lead in exactly one column → columns sum to Assigned, minus terminal). <strong>Rejected</strong> is by rejection date in the window. Every
        number is clickable and reconciles 1:1 with its lead list. Deleted / recycle-bin leads are excluded. Auto-refreshes while this tab is open.
      </div>
    </div>
  );
}
