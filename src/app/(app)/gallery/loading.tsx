// Grid skeleton for the Gallery / Resource Library (card grid, not a table).
export default function GalleryLoading() {
  return (
    <div className="space-y-3">
      <div className="h-7 w-48 bg-gray-200 dark:bg-slate-700 rounded animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card p-0 h-40 bg-gray-100 dark:bg-slate-800 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
