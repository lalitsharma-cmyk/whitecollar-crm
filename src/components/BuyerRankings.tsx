import type { BuyerAgentMetrics } from "@/lib/buyerPerformance";
import { totalReturned } from "@/lib/buyerPerformance";

// ─────────────────────────────────────────────────────────────────────────
// Buyer ranking mini-tables (the spec's five). Each ranks the scoped agents by
// one headline metric so a manager sees leaders/laggards at a glance:
//   Highest Buyer Conversions · Highest Assignment Handling (Buyers Worked) ·
//   Highest Rejection Count · Highest Return Count · Most Contact Attempts.
// Pure server render. invertBad ⇒ higher is worse (rejection / return) → red.
// Mirrors AgentRankings.
// ─────────────────────────────────────────────────────────────────────────

interface RankSpec {
  title: string;
  emoji: string;
  unitLabel: string;
  get: (m: BuyerAgentMetrics) => number;
  invertBad?: boolean;
}

const SPECS: RankSpec[] = [
  { title: "Highest Buyer Conversions", emoji: "🏆", unitLabel: "Converted", get: (m) => m.converted },
  { title: "Highest Assignment Handling", emoji: "📥", unitLabel: "Buyers Worked", get: (m) => m.buyersAssigned },
  { title: "Highest Rejection Count", emoji: "🚫", unitLabel: "Rejected", get: (m) => m.rejected, invertBad: true },
  { title: "Highest Return Count", emoji: "↩️", unitLabel: "Returned", get: (m) => totalReturned(m), invertBad: true },
  { title: "Most Contact Attempts", emoji: "📞", unitLabel: "Attempts", get: (m) => m.totalAttempts },
];

const MEDAL = ["🥇", "🥈", "🥉"];

function RankCard({ spec, rows }: { spec: RankSpec; rows: BuyerAgentMetrics[] }) {
  const ranked = [...rows]
    .map((m) => ({ name: m.agentName, team: m.team, v: spec.get(m) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 8);
  const allZero = ranked.every((r) => r.v === 0);
  return (
    <div className="card p-4">
      <div className="font-bold text-sm mb-2 flex items-center gap-1.5">
        <span>{spec.emoji}</span>
        <span>{spec.title}</span>
      </div>
      {allZero ? (
        <div className="text-xs text-gray-400 py-3 text-center">No data in this period</div>
      ) : (
        <ol className="space-y-1">
          {ranked.map((r, i) => (
            <li key={r.name} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="w-5 text-center text-xs shrink-0">{MEDAL[i] ?? i + 1}</span>
                <span className="truncate font-medium">{r.name}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{r.team ?? ""}</span>
              </span>
              <span className={`font-bold tabular-nums ${spec.invertBad ? (r.v > 0 ? "text-rose-700" : "text-gray-400") : "text-emerald-700"}`}>
                {r.v.toLocaleString("en-IN")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function BuyerRankings({ rows }: { rows: BuyerAgentMetrics[] }) {
  return (
    <div>
      <h2 className="text-base sm:text-lg font-bold mb-2">Agent rankings — buyer pipeline</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SPECS.map((s) => (
          <RankCard key={s.title} spec={s} rows={rows} />
        ))}
      </div>
    </div>
  );
}
