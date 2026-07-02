"use client";

// Revival Engine — compact weekly leaderboard for cold-to-warm conversions.
//
// Top agents who revived the most dormant leads this week (aggregation in
// cold-calls/page.tsx). Rendered as a SINGLE thin horizontal strip (name + count
// medals inline) so it never competes with the data the agent is working on —
// ~40-50% of the old vertical-list height (Lalit 2026-07-02).

export interface LeaderboardRow {
  ownerId: string;
  name: string;
  count: number;
  isMe?: boolean;
}

interface Props {
  top5: LeaderboardRow[];
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function RevivalLeaderboard({ top5 }: Props) {
  return (
    <div className="card p-2 sm:p-2.5">
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs">
        <span className="flex items-center gap-1.5 font-bold flex-none">
          <span className="text-sm">🏆</span>Revival Leaders
          <span className="text-[10px] font-normal uppercase tracking-wide text-gray-400">this week</span>
        </span>
        {top5.length === 0 ? (
          <span className="text-gray-500">No revivals yet this week. Be the first 💎</span>
        ) : (
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {top5.map((row, i) => (
              <span
                key={row.ownerId}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
                  row.isMe ? "bg-amber-50 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-800" : ""
                }`}
              >
                <span className="text-gray-500 tabular-nums">{MEDALS[i] ?? `#${i + 1}`}</span>
                <span className="font-medium truncate max-w-[100px]">
                  {row.name}
                  {row.isMe && <span className="ml-0.5 text-[10px] text-amber-700 font-semibold">(you)</span>}
                </span>
                <span className="font-bold tabular-nums">{row.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
