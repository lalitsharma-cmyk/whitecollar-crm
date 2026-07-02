"use client";

// Revival Engine — small weekly leaderboard for cold-to-warm conversions.
//
// Shows the top 5 agents who revived the most dormant leads this week.
// "Revived" = Lead.isColdCall was true AND Lead.status is now CONTACTED+
// AND Lead.updatedAt is within the current week. The actual aggregation
// happens in cold-calls/page.tsx — this component just renders.
//
// Kept intentionally small (no avatars, no chart) — it sits in the
// right-hand column next to the cold-data list and must NOT compete
// visually with the data the agent is working on.

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
    <div className="card p-2.5 sm:p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-base">🏆</span>
          <h2 className="text-sm sm:text-base font-bold">Revival Leaders</h2>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-gray-500">
          This week
        </span>
      </div>

      {top5.length === 0 ? (
        <div className="text-xs text-gray-500 py-4 text-center">
          No revivals yet this week. Be the first 💎
        </div>
      ) : (
        <ol className="space-y-1">
          {top5.map((row, i) => {
            const medal = MEDALS[i] ?? "";
            const isTop = i < 3;
            return (
              <li
                key={row.ownerId}
                className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs ${
                  row.isMe
                    ? "bg-amber-50 border border-amber-200"
                    : isTop
                      ? "bg-gray-50"
                      : ""
                }`}
              >
                <span className="w-6 text-center font-bold text-gray-500 tabular-nums">
                  {medal || `#${i + 1}`}
                </span>
                <span className="flex-1 min-w-0 truncate font-medium">
                  {row.name}
                  {row.isMe && (
                    <span className="ml-1 text-[10px] text-amber-700 font-semibold">
                      (you)
                    </span>
                  )}
                </span>
                <span className="font-bold tabular-nums">{row.count}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-2 text-[10px] text-gray-500 leading-snug">
        Cold leads revived to active conversations
      </div>
    </div>
  );
}
