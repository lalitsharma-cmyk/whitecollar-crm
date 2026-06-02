// Route-level loading skeleton for /reports
// Mirrors the reports page layout: decision strip + chart grid + heatmap.
// Server Component — no "use client" needed.
export default function ReportsLoading() {
  return (
    <div className="space-y-4">
      {/* Page header */}
      <div>
        <div className="h-7 w-36 bg-gray-200 rounded animate-pulse" />
        <div className="h-4 w-72 bg-gray-100 rounded animate-pulse mt-2" />
      </div>

      {/* §9.11 Decision strip — 3 executive cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { accent: "#16a34a" }, // forecast — emerald
          { accent: "#e11d48" }, // funnel leak — rose
          { accent: "#d97706" }, // stalled — amber
        ].map(({ accent }, i) => (
          <div
            key={i}
            className="card p-4 animate-pulse"
            style={{ borderLeft: `4px solid ${accent}` }}
          >
            <div className="h-3 w-32 bg-gray-200 rounded mb-2" />
            <div className="h-8 w-40 bg-gray-200 rounded mb-2" />
            <div className="h-3 w-48 bg-gray-100 rounded" />
          </div>
        ))}
      </div>

      {/* Charts row 1 — source bar + agent bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card p-4 animate-pulse">
            <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
            <div className="h-40 bg-gray-100 rounded" />
          </div>
        ))}
      </div>

      {/* Charts row 2 — funnel + connect rate */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card p-4 animate-pulse">
            <div className="h-4 w-28 bg-gray-200 rounded mb-4" />
            <div className="h-40 bg-gray-100 rounded" />
          </div>
        ))}
      </div>

      {/* Heatmap placeholder */}
      <div className="card p-4 animate-pulse">
        <div className="h-4 w-48 bg-gray-200 rounded mb-4" />
        {/* 7-row grid mimicking the day × hour heatmap */}
        <div className="space-y-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex gap-1">
              <div className="h-6 w-8 bg-gray-200 rounded flex-shrink-0" />
              <div className="flex-1 h-6 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
