// Shared loading skeleton for list pages (header + filter chips + table rows). Each
// list route's loading.tsx renders this so a slow DB load shows a skeleton instead of a
// blank/frozen screen (App Router streams it as the Suspense fallback). Pure presentation.
export default function ListPageSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 bg-gray-200 dark:bg-slate-700 rounded animate-pulse" />
        <div className="h-9 w-28 bg-gray-100 dark:bg-slate-800 rounded animate-pulse" />
      </div>
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-7 w-20 bg-gray-100 dark:bg-slate-800 rounded-full animate-pulse" />
        ))}
      </div>
      <div className="card p-0 overflow-hidden">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-slate-800 animate-pulse">
            <div className="h-4 w-4 bg-gray-200 dark:bg-slate-700 rounded" />
            <div className="h-4 flex-1 bg-gray-100 dark:bg-slate-800 rounded" />
            <div className="h-4 w-24 bg-gray-100 dark:bg-slate-800 rounded hidden sm:block" />
            <div className="h-4 w-16 bg-gray-100 dark:bg-slate-800 rounded hidden md:block" />
            <div className="h-6 w-16 bg-gray-200 dark:bg-slate-700 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
