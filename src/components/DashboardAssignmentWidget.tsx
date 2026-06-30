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
//
// COHORT RULE: every column here is a count OF THE ASSIGNED-IN-WINDOW COHORT
// (each lead held by this agent via an assignment dated in the window), bucketed
// by its CURRENT state. So all the cur* columns + Rejected sum cleanly against
// "Assigned" and every rate built from them is ≤100%. The "Rejected" column is
// the SAME-COHORT `curRejected` (assigned-in-window AND currently rejected) — NOT
// the owner-scoped "all rejections dated in the window" count, which is a
// different population and could exceed the cohort. Each `title` is the exact
// calculation, surfaced as a hover tooltip on the header.
const COLS: Array<{ label: string; field: keyof AgentMetrics; drill: DrillKey; tone?: string; title?: string }> = [
  { label: "Fresh Recv.", field: "freshAssigned", drill: "freshAssigned", title: "Fresh Received = leads assigned to this agent in this period that were still Fresh at the moment of assignment (fresh-at-assignment). Subset of Assigned." },
  { label: "Cur. Fresh", field: "curFresh", drill: "curFresh", title: "Current Fresh = leads currently assigned to this agent whose status is CURRENTLY Fresh / not-yet-contacted. Subset of Assigned." },
  { label: "Contacted", field: "curContacted", drill: "curContacted", title: "Contacted = currently-assigned leads CURRENTLY in active follow-up (Follow Up / Postponed). Subset of Assigned." },
  { label: "Qualified", field: "curQualified", drill: "curQualified", title: "Qualified = currently-assigned leads CURRENTLY engaged & advanced (Long Term Follow Up). Subset of Assigned." },
  { label: "Meeting", field: "curMeeting", drill: "curMeeting", tone: "text-teal-700", title: "Meeting = currently-assigned leads CURRENTLY at a meeting stage (Meeting / Office Visit / Zoom / Expo). Subset of Assigned." },
  { label: "Site Visit", field: "curSiteVisit", drill: "curSiteVisit", tone: "text-cyan-700", title: "Site Visit = currently-assigned leads CURRENTLY at a site-visit stage (Site Visit Schedule / Visit Dubai). Subset of Assigned." },
  { label: "Negotiation", field: "curNegotiation", drill: "curNegotiation", title: "Negotiation = currently-assigned leads CURRENTLY in discussion (Details Shared / Mail Sent). Subset of Assigned." },
  { label: "Booked/Won", field: "curBooked", drill: "curBooked", tone: "text-emerald-700 font-semibold", title: "Booked/Won = currently-assigned leads CURRENTLY Booked With Us. Numerator of Conversion Rate. Subset of Assigned." },
  { label: "Lost", field: "curLost", drill: "curLost", tone: "text-rose-600", title: "Lost = currently-assigned leads CURRENTLY in a Lost status. Subset of Assigned." },
  { label: "Rejected", field: "curRejected", drill: "curRejected", tone: "text-rose-700", title: "Rejected = leads currently assigned to this agent that are NOW rejected (same cohort). Numerator of Rejection Rate. Always ≤ Assigned (a lead is counted once)." },
  { label: "Active", field: "assignedActive", drill: "assignedActive", tone: "font-semibold", title: "Active = currently-assigned leads that are CURRENTLY still workable (not won / lost / rejected). Subset of Assigned." },
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

function SummaryCard({ label, value, accent, sub, title }: { label: string; value: string; accent: string; sub?: string; title?: string }) {
  return (
    // `title` puts the exact calculation on hover over the WHOLE card; the little
    // ⓘ glyph signals "hover me for the formula" so the help is discoverable.
    <div className={`card p-3 border-l-4 ${accent} relative group`} title={title}>
      <div className="flex items-center gap-1">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold leading-tight">{label}</div>
        {title && (
          <span
            className="text-[9px] text-gray-300 group-hover:text-gray-500 cursor-help select-none"
            aria-label={title}
            title={title}
          >
            ⓘ
          </span>
        )}
      </div>
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
            By current owner (live) · {rangeLabel}
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

      {/* Summary cards — every rate is COHORT-based (numerator ⊆ the assigned-in-
          window cohort, denominator = that cohort) so each is mathematically
          0–100%. Hover any card (or its ⓘ) for the exact formula. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
        <SummaryCard label="Assigned" value={num(summary.totalAssigned)} accent="border-blue-500" sub="current owner"
          title="Assigned = leads CURRENTLY assigned to these agents (current owner — a reassigned lead immediately moves to its new owner and stops counting for the old one). The cohort: denominator of every rate below." />
        <SummaryCard label="Active" value={num(summary.totalActive)} accent="border-amber-500" sub="still workable"
          title="Active = of the leads currently assigned to this agent, how many are CURRENTLY still workable (not won / lost / rejected). Count of the cohort." />
        <SummaryCard label="Rejected" value={num(summary.totalRejectedCohort)} accent="border-rose-500" sub="of assigned cohort"
          title="Rejected = of the leads currently assigned to this agent, how many are NOW rejected. Same-cohort count — the Rejection-Rate numerator (always ≤ Assigned)." />
        <SummaryCard label="Booked/Won" value={num(summary.totalBooked)} accent="border-emerald-500" sub="of assigned cohort"
          title="Booked/Won = of the leads currently assigned to this agent, how many are CURRENTLY Booked With Us. Same-cohort count — the Conversion-Rate numerator." />
        <SummaryCard label="Conversion" value={pct(summary.conversionRatePct)} accent="border-emerald-500" sub="booked ÷ assigned"
          title="Conversion Rate = leads currently assigned to this agent that are now Booked/Won ÷ leads currently assigned to this agent. Same cohort → 0–100%." />
        <SummaryCard label="Rejection" value={pct(summary.rejectionRatePct)} accent="border-rose-500" sub="rejected ÷ assigned"
          title="Rejection Rate = leads currently assigned to this agent that are now Rejected ÷ leads currently assigned to this agent. Same cohort → 0–100% (fixes the old cross-population >100% bug)." />
        <SummaryCard label="Meeting Rate" value={pct(summary.meetingRatePct)} accent="border-teal-500" sub="at meeting ÷ assigned"
          title="Meeting Rate = leads currently assigned to this agent now at a meeting stage ÷ leads currently assigned to this agent. Same cohort → 0–100%." />
        <SummaryCard label="Site Visit Rate" value={pct(summary.siteVisitRatePct)} accent="border-cyan-500" sub="at SV ÷ assigned"
          title="Site Visit Rate = leads currently assigned to this agent now at a site-visit stage ÷ leads currently assigned to this agent. Same cohort → 0–100%." />
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
                <th className="text-center" title="Leads currently assigned to this agent (current owner — reassigned leads follow the new owner)">Assigned</th>
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
        <strong>Cohort:</strong> every column &amp; rate is built from the SAME population — the leads <strong>currently assigned to the agent</strong> (current
        owner — a reassigned lead immediately moves to its new owner and stops counting for the old one). <strong>Fresh Recv.</strong> = fresh-at-assignment; the status
        columns are the <strong>current</strong> state of those owned leads (each lead in exactly one column → they sum to Assigned). <strong>Rejected</strong> here =
        currently-assigned leads that are <em>now</em> rejected (same cohort), so every rate (Conversion / Rejection / Meeting / Site-Visit = that column ÷ Assigned) is
        always <strong>0–100%</strong>. Hover any header or summary card for its exact formula. Every number is clickable and reconciles 1:1 with its lead list. Deleted /
        recycle-bin leads are excluded. Auto-refreshes while this tab is open.
      </div>
    </div>
  );
}
