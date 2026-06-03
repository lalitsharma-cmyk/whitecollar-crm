type Row = { name: string; calls: number };

export default function TeamScoreboardCard({ rows }: { rows: Row[] }) {
  const maxCalls = rows.length > 0 ? rows[0].calls : 0;

  const medalEmoji = (rank: number) => {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return null;
  };

  const rankColor = (rank: number): string => {
    if (rank === 1) return "#b7950b"; // gold
    if (rank === 2) return "#808b96"; // silver
    if (rank === 3) return "#a04000"; // bronze
    return "";
  };

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">📊 Today&apos;s Scoreboard</h3>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No calls logged today yet</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => {
            const rank = idx + 1;
            const medal = medalEmoji(rank);
            const color = rankColor(rank);
            const barWidth = maxCalls > 0 ? Math.round((row.calls / maxCalls) * 100) : 0;

            return (
              <div key={row.name} className="flex items-center gap-2">
                {/* Rank label */}
                <div
                  className="text-xs w-7 text-right flex-none font-semibold tabular-nums"
                  style={color ? { color } : { color: "#6b7280" }}
                >
                  #{rank}{medal ? ` ${medal}` : ""}
                </div>

                {/* Name + bar */}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm truncate${rank <= 3 ? " font-bold" : ""}`}
                    style={color ? { color } : undefined}
                  >
                    {row.name}
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${barWidth}%`,
                        backgroundColor: rank === 1 ? "#b7950b" : rank === 2 ? "#808b96" : rank === 3 ? "#a04000" : "#c9a24b",
                      }}
                    />
                  </div>
                </div>

                {/* Call count */}
                <div
                  className={`text-sm tabular-nums flex-none${rank <= 3 ? " font-bold" : ""}`}
                  style={color ? { color } : { color: "#374151" }}
                >
                  {row.calls}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">Calls logged today</p>
    </div>
  );
}
