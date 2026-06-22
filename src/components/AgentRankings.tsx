import type { AgentMetrics } from "@/lib/agentPerformance";

// ─────────────────────────────────────────────────────────────────────────
// Manager dashboard — six ranking mini-tables. Each ranks the scoped agents
// by one headline metric so a manager sees the leaders/laggards at a glance:
//   Most Leads Assigned · Most Meetings · Most Site Visits · Most Closures ·
//   Lowest Follow-up Compliance (most overdue) · Highest Rejection Count.
// Pure server render. "Lowest compliance" sorts ASC on the overdue/due count
// (more overdue = worse = top of that list).
// ─────────────────────────────────────────────────────────────────────────

interface RankSpec {
  title: string;
  emoji: string;
  /** value to display + rank by */
  get: (m: AgentMetrics) => number;
  /** when true, higher value is WORSE (rejection / overdue) → red accent */
  invertBad?: boolean;
  unit?: string;
}

const SPECS: RankSpec[] = [
  { title: "Most Leads Assigned", emoji: "📥", get: (m) => m.totalAssigned },
  { title: "Most Meetings", emoji: "🤝", get: (m) => m.meetingsScheduled + m.meetingsCompleted },
  { title: "Most Site Visits", emoji: "🏠", get: (m) => m.siteVisitsScheduled },
  { title: "Most Closures", emoji: "🏆", get: (m) => m.closedWon },
  { title: "Highest Overdue Follow-ups", emoji: "⏰", get: (m) => m.awaitingFollowup, invertBad: true },
  { title: "Highest Rejection Count", emoji: "🚫", get: (m) => m.rejected, invertBad: true },
];

const MEDAL = ["🥇", "🥈", "🥉"];

function RankCard({ spec, rows }: { spec: RankSpec; rows: AgentMetrics[] }) {
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

export default function AgentRankings({ rows }: { rows: AgentMetrics[] }) {
  return (
    <div>
      <h2 className="text-base sm:text-lg font-bold mb-2">Manager dashboard — rankings</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SPECS.map((s) => (
          <RankCard key={s.title} spec={s} rows={rows} />
        ))}
      </div>
    </div>
  );
}
