// Route-group loading boundary for src/app/(app)/
// Shown by Next.js Suspense while any page in this group streams in.
// Server Component — no "use client" needed.
export default function AppLoading() {
  return (
    <div className="space-y-4">
      {/* Page title placeholder */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-48 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-64 bg-gray-100 rounded animate-pulse mt-2" />
        </div>
        <div className="h-9 w-28 bg-gray-200 rounded animate-pulse" />
      </div>

      {/* KPI / summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 animate-pulse">
            <div className="h-8 w-14 bg-gray-200 rounded mb-2" />
            <div className="h-3 w-20 bg-gray-100 rounded" />
          </div>
        ))}
      </div>

      {/* Filter / toolbar bar */}
      <div className="card p-3 animate-pulse">
        <div className="flex gap-3">
          <div className="h-8 w-28 bg-gray-200 rounded-full" />
          <div className="h-8 w-28 bg-gray-200 rounded-full" />
          <div className="h-8 w-28 bg-gray-200 rounded-full" />
        </div>
      </div>

      {/* Content rows */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card p-4 animate-pulse flex items-center gap-4">
            <div className="h-8 w-8 rounded-full bg-gray-200 flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 bg-gray-200 rounded" />
              <div className="h-3 w-2/3 bg-gray-100 rounded" />
            </div>
            <div className="h-6 w-16 bg-gray-100 rounded-full flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
