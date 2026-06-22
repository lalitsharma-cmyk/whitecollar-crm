import Link from "next/link";
import type { AgentMetrics } from "@/lib/agentPerformance";
import { connectRate, conversionRate, followupCompliance } from "@/lib/agentPerformance";

// ─────────────────────────────────────────────────────────────────────────
// Per-agent metrics table. One row per agent, grouped column bands. Wide, so
// it scrolls horizontally on small screens (min-w forces the scroll). The
// agent name links to the detailed drill-down view. Server component — pure
// render of the AgentMetrics[] the engine produced.
// Query string (range/team) is threaded onto each agent link so the detail
// view opens in the same window.
// ─────────────────────────────────────────────────────────────────────────

function num(n: number): string {
  return n.toLocaleString("en-IN");
}

export default function AgentPerformanceTable({
  rows,
  query,
}: {
  rows: AgentMetrics[];
  query: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="card p-6 text-center text-gray-500 text-sm">
        No agents in scope for this period.
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="tbl min-w-[1400px] text-sm">
        <thead>
          <tr className="text-[11px]">
            <th className="sticky left-0 bg-white z-10">Agent</th>
            <th>Team</th>
            {/* Assignment band */}
            <th className="text-center bg-blue-50/60" title="By assignment history in the period">Assigned</th>
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
              <tr key={m.agentId}>
                <td className="sticky left-0 bg-white z-10 font-semibold whitespace-nowrap">
                  <Link href={`/reports/agent-performance/${m.agentId}${query}`} className="text-blue-600 hover:underline">
                    {m.agentName}
                  </Link>
                </td>
                <td className="text-gray-600 whitespace-nowrap">{m.team ?? "—"}</td>
                {/* Assignment */}
                <td className="text-center font-bold">{num(m.totalAssigned)}</td>
                <td className="text-center">{num(m.freshAssigned)}</td>
                <td className="text-center">{num(m.websiteAssigned)}</td>
                <td className="text-center">{num(m.eventAssigned)}</td>
                <td className="text-center">{num(m.revivalAssigned)}</td>
                <td className="text-center text-gray-400">{num(m.buyerAssigned)}</td>
                {/* Outcomes */}
                <td className="text-center text-rose-700">{num(m.rejected)}</td>
                <td className="text-center font-semibold text-emerald-700">{num(m.closedWon)}</td>
                <td className="text-center text-rose-600">{num(m.lost)}</td>
                <td className="text-center">{num(m.stillActive)}</td>
                <td className="text-center text-amber-700">{num(m.awaitingFollowup)}</td>
                <td className="text-center text-amber-600">{num(m.noFollowup)}</td>
                {/* Engagement */}
                <td className="text-center font-semibold">{num(m.callsLogged)}</td>
                <td className="text-center text-emerald-700">{num(m.connectedCalls)}</td>
                <td className="text-center text-gray-500">{num(m.notPickedCalls)}</td>
                <td className="text-center">{num(m.whatsappConversations)}</td>
                <td className="text-center">{num(m.notesAdded)}</td>
                <td className="text-center text-gray-500">{num(m.voiceNotesAdded)}</td>
                {/* Meetings */}
                <td className="text-center">{num(m.meetingsScheduled)}</td>
                <td className="text-center text-emerald-700">{num(m.meetingsCompleted)}</td>
                <td className="text-center">{num(m.officeMeetings)}</td>
                <td className="text-center">{num(m.virtualMeetings)}</td>
                {/* Site visits */}
                <td className="text-center">{num(m.siteVisitsScheduled)}</td>
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
            );
          })}
        </tbody>
      </table>
      <div className="text-[10px] text-gray-500 p-3 leading-relaxed">
        <strong>Assigned</strong> bands count by <strong>assignment history</strong> in the selected period (the agent who held the lead when it was assigned) — not just the current owner.
        <strong> Outcomes / Funnel</strong> reflect the agent&apos;s current book. <strong>Engagement / Meetings / Site visits</strong> count actions in the period.
        Deleted &amp; recycle-bin leads are excluded everywhere. Click an agent for the full drill-down. Buyer = 0 (module not yet live).
      </div>
    </div>
  );
}
