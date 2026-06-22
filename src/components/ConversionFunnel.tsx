import type { AgentMetrics } from "@/lib/agentPerformance";

// ─────────────────────────────────────────────────────────────────────────
// Conversion funnel — Assigned → Qualified → Meetings → Site Visits →
// Negotiations → Bookings/Closures. Each bar shows the absolute count and the
// conversion % relative to the FIRST stage (Assigned). Width is proportional to
// the stage count vs. the top of the funnel, so the drop-off is visible.
//
// Works for one agent (detail view) or an aggregate of all scoped agents
// (overall view) — the caller sums the AgentMetrics funnel fields into a single
// row via aggregateFunnel().
// ─────────────────────────────────────────────────────────────────────────

export interface FunnelStages {
  assigned: number;
  qualified: number;
  meetings: number;
  siteVisits: number;
  negotiations: number;
  bookings: number;
}

/** Sum the funnel fields across many agents into one funnel (overall view). */
export function aggregateFunnel(rows: AgentMetrics[]): FunnelStages {
  return rows.reduce<FunnelStages>(
    (acc, m) => ({
      assigned: acc.assigned + m.funnelAssigned,
      qualified: acc.qualified + m.funnelQualified,
      meetings: acc.meetings + m.funnelMeetings,
      siteVisits: acc.siteVisits + m.funnelSiteVisits,
      negotiations: acc.negotiations + m.funnelNegotiations,
      bookings: acc.bookings + m.funnelBookings,
    }),
    { assigned: 0, qualified: 0, meetings: 0, siteVisits: 0, negotiations: 0, bookings: 0 },
  );
}

/** Extract a single agent's funnel. */
export function agentFunnel(m: AgentMetrics): FunnelStages {
  return {
    assigned: m.funnelAssigned,
    qualified: m.funnelQualified,
    meetings: m.funnelMeetings,
    siteVisits: m.funnelSiteVisits,
    negotiations: m.funnelNegotiations,
    bookings: m.funnelBookings,
  };
}

const STAGES: Array<{ key: keyof FunnelStages; label: string; color: string }> = [
  { key: "assigned", label: "Assigned", color: "bg-indigo-500" },
  { key: "qualified", label: "Qualified", color: "bg-sky-500" },
  { key: "meetings", label: "Meetings", color: "bg-teal-500" },
  { key: "siteVisits", label: "Site Visits", color: "bg-cyan-500" },
  { key: "negotiations", label: "Negotiations", color: "bg-amber-500" },
  { key: "bookings", label: "Bookings / Closures", color: "bg-emerald-600" },
];

export default function ConversionFunnel({
  stages,
  title = "Conversion funnel",
}: {
  stages: FunnelStages;
  title?: string;
}) {
  const top = Math.max(stages.assigned, 1);
  return (
    <div className="card p-4">
      <div className="font-bold text-sm mb-3">{title}</div>
      <div className="space-y-2">
        {STAGES.map((s) => {
          const v = stages[s.key];
          const widthPct = Math.max(2, Math.round((v / top) * 100));
          const convPct = stages.assigned > 0 ? (v / stages.assigned) * 100 : 0;
          return (
            <div key={s.key} className="flex items-center gap-2">
              <div className="w-28 sm:w-32 text-[11px] sm:text-xs text-gray-600 shrink-0 text-right">
                {s.label}
              </div>
              <div className="flex-1 bg-gray-100 rounded h-6 relative overflow-hidden">
                <div
                  className={`${s.color} h-full rounded flex items-center justify-end pr-2 transition-all`}
                  style={{ width: `${widthPct}%` }}
                >
                  <span className="text-[11px] font-bold text-white">{v.toLocaleString("en-IN")}</span>
                </div>
              </div>
              <div className="w-12 text-[11px] text-gray-500 shrink-0 text-right tabular-nums">
                {convPct.toFixed(0)}%
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-gray-500 mt-3">
        % = share of <strong>Assigned</strong> reaching each stage (status-based, current book). Stages overlap by status, so they need not strictly decrease.
      </div>
    </div>
  );
}
