import Link from "next/link";
import type { BuyerAgentMetrics } from "@/lib/buyerPerformance";
import { avgAttempts, buyerConversionRate, totalReturned } from "@/lib/buyerPerformance";

// ─────────────────────────────────────────────────────────────────────────
// Per-agent BUYER metrics table. One row per agent, grouped column bands. Wide,
// so it scrolls horizontally on small screens (min-w forces the scroll). The
// agent name links to the detailed drill-down view. Server component — pure
// render of the BuyerAgentMetrics[] the engine produced. The query string
// (range/team) is threaded onto each agent link so the detail view opens in the
// same window. Mirrors AgentPerformanceTable for consistency.
// ─────────────────────────────────────────────────────────────────────────

function num(n: number): string {
  return n.toLocaleString("en-IN");
}

export default function BuyerPerformanceTable({
  rows,
  query,
}: {
  rows: BuyerAgentMetrics[];
  query: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="card p-5 text-center text-gray-500 text-sm">
        No agents in scope for this period.
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="tbl min-w-[1200px] text-sm">
        <thead>
          <tr className="text-[11px]">
            <th className="sticky left-0 bg-white z-10">Agent</th>
            <th>Team</th>
            {/* Assignment band */}
            <th className="text-center bg-blue-50/60" title="Buyer records assigned in the period (by stint history)">Assigned</th>
            {/* Outcomes band */}
            <th className="text-center bg-emerald-50/60" title="Buyers converted to leads (in period)">Converted</th>
            <th className="text-center bg-rose-50/60" title="Buyers rejected by the agent (in period)">Rejected</th>
            <th className="text-center bg-amber-50/60" title="Auto-returned to pool after 5 attempts">Auto Ret.</th>
            <th className="text-center bg-amber-50/60" title="Manually returned to the Admin Pool">Man. Ret.</th>
            {/* Contact activity band */}
            <th className="text-center bg-violet-50/60">Calls</th>
            <th className="text-center bg-violet-50/60">WhatsApp</th>
            <th className="text-center bg-violet-50/60">Notes</th>
            <th className="text-center bg-violet-50/60">Voice</th>
            {/* Attempts band */}
            <th className="text-center bg-cyan-50/60" title="Total contact attempts (No Answer / Not Picked / WA No Response)">Attempts</th>
            <th className="text-center bg-cyan-50/60" title="Average attempts per buyer worked">Avg/Buyer</th>
            {/* Funnel band */}
            <th className="text-center bg-teal-50/60" title="Assigned buyers contacted ≥1 time">Contacted</th>
            <th className="text-center bg-teal-50/60" title="Assigned buyers with ≥1 call or WhatsApp">Engaged</th>
            {/* Derived */}
            <th className="text-center bg-gray-50" title="Converted ÷ assigned">Conv %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const cv = buyerConversionRate(m);
            return (
              <tr key={m.agentId}>
                <td className="sticky left-0 bg-white z-10 font-semibold whitespace-nowrap">
                  <Link href={`/reports/buyer-performance/${m.agentId}${query}`} className="text-blue-600 hover:underline">
                    {m.agentName}
                  </Link>
                </td>
                <td className="text-gray-600 whitespace-nowrap">{m.team ?? "—"}</td>
                {/* Assignment */}
                <td className="text-center font-bold">{num(m.buyersAssigned)}</td>
                {/* Outcomes */}
                <td className="text-center font-semibold text-emerald-700">{num(m.converted)}</td>
                <td className="text-center text-rose-700">{num(m.rejected)}</td>
                <td className="text-center text-amber-700">{num(m.autoReturned)}</td>
                <td className="text-center text-amber-600">{num(m.manualReturned)}</td>
                {/* Contact activity */}
                <td className="text-center font-semibold">{num(m.callsLogged)}</td>
                <td className="text-center">{num(m.whatsappInteractions)}</td>
                <td className="text-center">{num(m.notesAdded)}</td>
                <td className="text-center text-gray-500">{num(m.voiceNotesAdded)}</td>
                {/* Attempts */}
                <td className="text-center">{num(m.totalAttempts)}</td>
                <td className="text-center text-gray-600 tabular-nums">{avgAttempts(m).toFixed(1)}</td>
                {/* Funnel */}
                <td className="text-center">{num(m.funnelContacted)}</td>
                <td className="text-center">{num(m.funnelEngaged)}</td>
                {/* Derived */}
                <td className={`text-center font-semibold ${cv >= 10 ? "text-emerald-700" : cv > 0 ? "text-amber-700" : "text-gray-400"}`}>
                  {cv.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="text-[10px] text-gray-500 p-3 leading-relaxed">
        <strong>Assigned</strong> counts by <strong>stint history</strong> in the selected period (the agent who held the buyer when a stint opened) — not just the current owner.
        <strong> Converted / Rejected / Returns / Contact / Attempts</strong> count the agent&apos;s actions in the period (from the buyer activity log).
        Rejected &amp; returned buyers still count toward handled volume. Deleted / recycle-bin buyers are excluded everywhere.
        Click an agent for the full drill-down — every number traces to its underlying buyer records.
        Total returned = {num(rows.reduce((s, m) => s + totalReturned(m), 0))} this period.
      </div>
    </div>
  );
}
