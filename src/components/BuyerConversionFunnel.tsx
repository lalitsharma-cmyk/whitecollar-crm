import type { BuyerAgentMetrics } from "@/lib/buyerPerformance";

// ─────────────────────────────────────────────────────────────────────────
// Buyer conversion funnel — Assigned → Contacted → Engaged → Converted. Each bar
// shows the absolute count and the conversion % relative to the FIRST stage
// (Assigned). Width is proportional to the stage count vs. the top of the funnel,
// so the drop-off is visible. Unlike the lead funnel, these stages are strict
// subsets (each computed by intersecting with the worked set) so they always
// decrease monotonically.
//
// Works for one agent (detail view) or an aggregate of all scoped agents (overall
// view) — the caller sums the funnel fields into a single row via aggregateBuyerFunnel().
// ─────────────────────────────────────────────────────────────────────────

export interface BuyerFunnelStages {
  assigned: number;
  contacted: number;
  engaged: number;
  converted: number;
}

/** Sum the funnel fields across many agents into one funnel (overall view). */
export function aggregateBuyerFunnel(rows: BuyerAgentMetrics[]): BuyerFunnelStages {
  return rows.reduce<BuyerFunnelStages>(
    (acc, m) => ({
      assigned: acc.assigned + m.funnelAssigned,
      contacted: acc.contacted + m.funnelContacted,
      engaged: acc.engaged + m.funnelEngaged,
      converted: acc.converted + m.funnelConverted,
    }),
    { assigned: 0, contacted: 0, engaged: 0, converted: 0 },
  );
}

/** Extract a single agent's funnel. */
export function buyerAgentFunnel(m: BuyerAgentMetrics): BuyerFunnelStages {
  return {
    assigned: m.funnelAssigned,
    contacted: m.funnelContacted,
    engaged: m.funnelEngaged,
    converted: m.funnelConverted,
  };
}

const STAGES: Array<{ key: keyof BuyerFunnelStages; label: string; color: string }> = [
  { key: "assigned", label: "Assigned", color: "bg-indigo-500" },
  { key: "contacted", label: "Contacted", color: "bg-sky-500" },
  { key: "engaged", label: "Engaged", color: "bg-teal-500" },
  { key: "converted", label: "Converted To Lead", color: "bg-emerald-600" },
];

export default function BuyerConversionFunnel({
  stages,
  title = "Buyer conversion funnel",
}: {
  stages: BuyerFunnelStages;
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
              <div className="w-28 sm:w-36 text-[11px] sm:text-xs text-gray-600 shrink-0 text-right">
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
        % = share of <strong>Assigned</strong> buyers reaching each stage, within the period.
        Contacted = ≥1 contact activity · Engaged = ≥1 call or WhatsApp · Converted = became a lead.
      </div>
    </div>
  );
}
