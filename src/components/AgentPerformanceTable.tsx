import Link from "next/link";
import { Fragment } from "react";
import type { AgentMetrics, ModuleSplit } from "@/lib/agentPerformance";
import { connectRate, conversionRate, followupCompliance, MODULE_SPLIT_METRICS } from "@/lib/agentPerformance";
import { LEAD_SOURCE_MODULES, type SourceModule } from "@/lib/moduleSource";

// ─────────────────────────────────────────────────────────────────────────
// Per-agent metrics table. One row per agent, grouped column bands. Wide, so
// it scrolls horizontally on small screens (min-w forces the scroll). The
// agent name links to the detailed drill-down view. Server component — pure
// render of the AgentMetrics[] the engine produced.
//
// MODULE BIFURCATION (Lalit 2026-07-06): every lead-derived metric is split
// across the 3 lead-origin modules (Leads · Master Data · Revival Engine).
//   • module="all"  → totals shown, with an EXPANDABLE breakdown row per agent
//     (Total = Leads N · Master Data N · Revival N) for the bifurcated metrics.
//   • module=<one>  → the bifurcated columns show THAT module's number only
//     (non-bifurcated columns — Website/Event/Conn./meetings-done etc. — are
//     origin-agnostic and always show their full value).
// ─────────────────────────────────────────────────────────────────────────

function num(n: number): string {
  return n.toLocaleString("en-IN");
}

// The bifurcated metric keys (shared with the engine's split). Used to decide
// which cell shows a module-filtered value + which appear in the breakdown.
const SPLIT_KEYS = new Set<string>(MODULE_SPLIT_METRICS as string[]);

/** Value for a bifurcated metric under the active module filter: the whole
 *  total for "all", else the selected module's slice. Non-split metrics ignore
 *  the filter (caller passes the raw value). */
function mv(m: AgentMetrics, key: keyof ModuleSplit & keyof AgentMetrics, module: SourceModule | "all"): number {
  if (module === "all") return m[key] as number;
  return m.moduleSplit[key][module];
}

// Human labels for the breakdown chips (bifurcated metrics only, in table order).
const BREAKDOWN_METRICS: Array<{ key: keyof ModuleSplit & keyof AgentMetrics; label: string }> = [
  { key: "totalAssigned", label: "Assigned" },
  { key: "freshAssigned", label: "Fresh" },
  { key: "stillActive", label: "Active" },
  { key: "closedWon", label: "Closed/Won" },
  { key: "lost", label: "Lost" },
  { key: "rejected", label: "Rejected" },
  { key: "curBooked", label: "Booked" },
  { key: "callsLogged", label: "Calls" },
  { key: "whatsappConversations", label: "WhatsApp" },
  { key: "notesAdded", label: "Notes" },
  { key: "meetingsScheduled", label: "Meet Sched" },
  { key: "siteVisitsScheduled", label: "SV Sched" },
];

const MODULE_ACCENT: Record<SourceModule, string> = {
  "Leads": "text-blue-700",
  "Master Data": "text-indigo-700",
  "Revival Engine": "text-amber-700",
  "Dubai Buyer Data": "text-gray-500",
  "India Buyer Data": "text-gray-500",
};

/** Expandable per-agent module breakdown (module="all" only). Pure HTML
 *  <details> — no client JS. Shows Total = Leads · Master Data · Revival for
 *  each bifurcated metric so every headline number is traceable to its parts. */
function ModuleBreakdown({ m, colSpan }: { m: AgentMetrics; colSpan: number }) {
  return (
    <tr className="bg-gray-50/60">
      <td colSpan={colSpan} className="px-3 py-0">
        <details className="group">
          <summary className="cursor-pointer text-[11px] text-gray-500 py-1.5 select-none hover:text-gray-700">
            <span className="group-open:hidden">▸ Module breakdown (Leads · Master Data · Revival)</span>
            <span className="hidden group-open:inline">▾ Module breakdown</span>
          </summary>
          <div className="pb-2 pt-1 overflow-x-auto">
            <table className="text-[11px] min-w-[520px]">
              <thead>
                <tr className="text-gray-400">
                  <th className="text-left font-medium pr-4 pb-1">Metric</th>
                  {LEAD_SOURCE_MODULES.map((mod) => (
                    <th key={mod} className={`text-right font-semibold px-3 pb-1 ${MODULE_ACCENT[mod]}`}>{mod}</th>
                  ))}
                  <th className="text-right font-semibold px-3 pb-1 text-gray-600">Total</th>
                </tr>
              </thead>
              <tbody>
                {BREAKDOWN_METRICS.map(({ key, label }) => {
                  const total = m[key] as number;
                  if (total === 0) return null; // hide all-zero metrics to keep it tight
                  return (
                    <tr key={key} className="border-t border-gray-100">
                      <td className="text-left text-gray-600 pr-4 py-0.5">{label}</td>
                      {LEAD_SOURCE_MODULES.map((mod) => (
                        <td key={mod} className={`text-right px-3 tabular-nums ${m.moduleSplit[key][mod] ? MODULE_ACCENT[mod] : "text-gray-300"}`}>
                          {num(m.moduleSplit[key][mod])}
                        </td>
                      ))}
                      <td className="text-right px-3 tabular-nums font-semibold text-gray-700">{num(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      </td>
    </tr>
  );
}

export default function AgentPerformanceTable({
  rows,
  query,
  module = "all",
}: {
  rows: AgentMetrics[];
  query: string;
  /** Active module filter — "all" shows totals + expandable breakdown. */
  module?: SourceModule | "all";
}) {
  if (rows.length === 0) {
    return (
      <div className="card p-5 text-center text-gray-500 text-sm">
        No agents in scope for this period.
      </div>
    );
  }

  // Bifurcated column header suffix so it's obvious a filter is applied.
  const modTag = module === "all" ? "" : ` · ${module}`;
  // colSpan of the full row (for the breakdown row) — keep in sync with the <th> count.
  const COLSPAN = 30;

  return (
    <div className="card overflow-x-auto">
      {module !== "all" && (
        <div className="px-3 pt-3 text-[11px] text-gray-600">
          Showing the <strong>{module}</strong> module slice for lead-derived columns (Assigned · Fresh · Active · Closed/Won · Lost · Rejected · Calls · WhatsApp · Notes · Meet/SV Sched).
          Website / Event / Revival-origin / connect / completed columns are origin-agnostic and show full values.
        </div>
      )}
      <table className="tbl min-w-[1400px] text-sm">
        <thead>
          <tr className="text-[11px]">
            <th className="sticky left-0 bg-white z-10">Agent</th>
            <th>Team</th>
            {/* Assignment band */}
            <th className="text-center bg-blue-50/60" title="By current owner — a reassigned lead immediately follows its new owner">Assigned{modTag && <span className="text-gray-400">{modTag}</span>}</th>
            <th className="text-center bg-blue-50/60">Fresh</th>
            <th className="text-center bg-blue-50/60">Website</th>
            <th className="text-center bg-blue-50/60">Event</th>
            <th className="text-center bg-blue-50/60">Revival</th>
            <th className="text-center bg-blue-50/60" title="Buyer module not yet live">Buyer</th>
            {/* Outcomes band */}
            <th className="text-center bg-rose-50/60">Rejected</th>
            <th className="text-center bg-emerald-50/60">Closed/Won</th>
            <th className="text-center bg-rose-50/60">Lost</th>
            <th className="text-center bg-amber-50/60">Active</th>
            <th className="text-center bg-amber-50/60" title="Follow-up due today or overdue">Due FU</th>
            <th className="text-center bg-amber-50/60" title="Active leads with no follow-up set">No FU</th>
            {/* Engagement band */}
            <th className="text-center bg-violet-50/60">Calls</th>
            <th className="text-center bg-violet-50/60">Conn.</th>
            <th className="text-center bg-violet-50/60">Not Picked</th>
            <th className="text-center bg-violet-50/60">WhatsApp</th>
            <th className="text-center bg-violet-50/60">Notes</th>
            <th className="text-center bg-violet-50/60">Voice</th>
            {/* Meetings band */}
            <th className="text-center bg-teal-50/60">Meet Sched</th>
            <th className="text-center bg-teal-50/60">Meet Done</th>
            <th className="text-center bg-teal-50/60">Office</th>
            <th className="text-center bg-teal-50/60">Virtual</th>
            {/* Site visits band */}
            <th className="text-center bg-cyan-50/60">SV Sched</th>
            <th className="text-center bg-cyan-50/60">SV Done</th>
            <th className="text-center bg-cyan-50/60">SV Canc.</th>
            {/* Derived */}
            <th className="text-center bg-gray-50">Conn %</th>
            <th className="text-center bg-gray-50">Conv %</th>
            <th className="text-center bg-gray-50" title="Share of active book not overdue on follow-up">FU Compl %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const cr = connectRate(m);
            const cv = conversionRate(m);
            const fc = followupCompliance(m);
            return (
              <Fragment key={m.agentId}>
                <tr>
                  <td className="sticky left-0 bg-white z-10 font-semibold whitespace-nowrap">
                    <Link href={`/reports/agent-performance/${m.agentId}${query}`} className="text-blue-600 hover:underline">
                      {m.agentName}
                    </Link>
                  </td>
                  <td className="text-gray-600 whitespace-nowrap">{m.team ?? "—"}</td>
                  {/* Assignment (Assigned + Fresh are bifurcated) */}
                  <td className="text-center font-bold">{num(mv(m, "totalAssigned", module))}</td>
                  <td className="text-center">{num(mv(m, "freshAssigned", module))}</td>
                  <td className="text-center">{num(m.websiteAssigned)}</td>
                  <td className="text-center">{num(m.eventAssigned)}</td>
                  <td className="text-center">{num(m.revivalAssigned)}</td>
                  <td className="text-center text-gray-400">{num(m.buyerAssigned)}</td>
                  {/* Outcomes (Rejected/Closed/Lost/Active bifurcated) */}
                  <td className="text-center text-rose-700">{num(mv(m, "rejected", module))}</td>
                  <td className="text-center font-semibold text-emerald-700">{num(mv(m, "closedWon", module))}</td>
                  <td className="text-center text-rose-600">{num(mv(m, "lost", module))}</td>
                  <td className="text-center">{num(mv(m, "stillActive", module))}</td>
                  <td className="text-center text-amber-700">{num(m.awaitingFollowup)}</td>
                  <td className="text-center text-amber-600">{num(m.noFollowup)}</td>
                  {/* Engagement (Calls/WhatsApp/Notes bifurcated) */}
                  <td className="text-center font-semibold">{num(mv(m, "callsLogged", module))}</td>
                  <td className="text-center text-emerald-700">{num(m.connectedCalls)}</td>
                  <td className="text-center text-gray-500">{num(m.notPickedCalls)}</td>
                  <td className="text-center">{num(mv(m, "whatsappConversations", module))}</td>
                  <td className="text-center">{num(mv(m, "notesAdded", module))}</td>
                  <td className="text-center text-gray-500">{num(m.voiceNotesAdded)}</td>
                  {/* Meetings (Meet Sched bifurcated) */}
                  <td className="text-center">{num(mv(m, "meetingsScheduled", module))}</td>
                  <td className="text-center text-emerald-700">{num(m.meetingsCompleted)}</td>
                  <td className="text-center">{num(m.officeMeetings)}</td>
                  <td className="text-center">{num(m.virtualMeetings)}</td>
                  {/* Site visits (SV Sched bifurcated) */}
                  <td className="text-center">{num(mv(m, "siteVisitsScheduled", module))}</td>
                  <td className="text-center text-emerald-700">{num(m.siteVisitsCompleted)}</td>
                  <td className="text-center text-gray-500">{num(m.siteVisitsCancelled)}</td>
                  {/* Derived */}
                  <td className={`text-center font-semibold ${cr >= 40 ? "text-emerald-700" : cr >= 20 ? "text-amber-700" : "text-gray-500"}`}>
                    {cr.toFixed(0)}%
                  </td>
                  <td className={`text-center font-semibold ${cv >= 5 ? "text-emerald-700" : cv > 0 ? "text-amber-700" : "text-gray-400"}`}>
                    {cv.toFixed(1)}%
                  </td>
                  <td className={`text-center font-semibold ${fc >= 80 ? "text-emerald-700" : fc >= 50 ? "text-amber-700" : "text-rose-700"}`}>
                    {fc.toFixed(0)}%
                  </td>
                </tr>
                {module === "all" && <ModuleBreakdown m={m} colSpan={COLSPAN} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="text-[10px] text-gray-500 p-3 leading-relaxed">
        <strong>Assigned</strong> bands count by the lead&apos;s <strong>current owner</strong> — a reassigned lead immediately follows its new owner (so it matches global search, the Leads list, and export).
        <strong> Outcomes / Funnel</strong> reflect the agent&apos;s current book. <strong>Engagement / Meetings / Site visits</strong> count actions in the period.
        Lead-derived metrics split into <strong>Leads · Master Data · Revival Engine</strong> (expand any agent row, or use the Module filter). Every total = Leads + Master Data + Revival.
        Deleted &amp; recycle-bin leads are excluded everywhere. Click an agent for the full drill-down. Buyer = 0 (see the Buyer Data section for buyer metrics).
      </div>
    </div>
  );
}
