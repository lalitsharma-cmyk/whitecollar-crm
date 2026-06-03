interface WeeklyMetric {
  label: string;
  thisWeek: number;
  lastWeek: number;
}

interface Props {
  metrics: WeeklyMetric[];
}

export default function WeeklySummaryCard({ metrics }: Props) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">📊 This Week</h3>
        <span className="text-[10px] text-gray-400">vs last week</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {metrics.map((m) => {
          const delta = m.thisWeek - m.lastWeek;
          const isUp = delta > 0;
          const isDown = delta < 0;
          return (
            <div key={m.label} className="flex flex-col gap-0.5">
              <div className="text-[11px] text-gray-500 dark:text-slate-400 uppercase tracking-wide leading-tight">
                {m.label}
              </div>
              <div className="text-2xl font-extrabold dark:text-white tabular-nums">
                {m.thisWeek}
              </div>
              <div
                className={`text-[11px] font-semibold tabular-nums ${
                  isUp
                    ? "text-emerald-600"
                    : isDown
                    ? "text-red-500"
                    : "text-gray-400"
                }`}
              >
                {isUp && `↑ ${delta} vs last week`}
                {isDown && `↓ ${Math.abs(delta)} vs last week`}
                {!isUp && !isDown && `— same as last week`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
