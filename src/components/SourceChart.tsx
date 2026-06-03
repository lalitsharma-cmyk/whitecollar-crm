// Pure server component — no "use client" needed; renders CSS-only horizontal
// bar chart for lead counts grouped by source.

interface Props {
  data: Array<{
    source: string;
    _count: { _all?: number | null; [key: string]: unknown };
  }>;
}

export default function SourceChart({ data }: Props) {
  if (!data || data.length === 0) {
    return (
      <div>
        <div className="font-semibold text-sm mb-3">📊 Leads by Source</div>
        <div className="py-6 text-center text-sm text-gray-400 italic">
          No source data yet
        </div>
      </div>
    );
  }

  const rows = data.map((r) => ({
    source: r.source,
    count: typeof r._count._all === "number" ? r._count._all : 0,
  }));

  const maxCount = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div>
      <div className="font-semibold text-sm mb-3">📊 Leads by Source</div>
      <div className="space-y-1.5">
        {rows.map((row, i) => {
          const label = row.source || "Unknown";
          const count = row.count;
          // Bar fill as a percentage of the max, floored at 2% so even 1-count
          // sources render a visible sliver.
          const widthPct = Math.max(2, Math.round((count / maxCount) * 100));

          return (
            <div key={`${row.source}_${i}`} className="flex items-center gap-2 text-xs">
              {/* Source label — fixed 120 px, right-aligned, truncated */}
              <span
                className="shrink-0 text-right text-gray-600 font-medium truncate"
                style={{ width: "120px" }}
                title={label}
              >
                {label}
              </span>

              {/* Bar track */}
              <div className="flex-1 bg-gray-100 rounded-sm overflow-hidden h-6">
                <div
                  className="h-full rounded-sm bg-blue-400 transition-all duration-300"
                  style={{ width: `${widthPct}%` }}
                />
              </div>

              {/* Count on the right — always visible */}
              <span className="shrink-0 w-10 text-right font-semibold text-gray-700">
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
