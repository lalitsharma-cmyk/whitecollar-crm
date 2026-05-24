export default function LeadsLoading() {
  return (
    <>
      <div className="flex items-center justify-between">
        <div className="h-7 w-32 bg-gray-200 rounded animate-pulse" />
      </div>
      <div className="card p-3 animate-pulse h-12" />
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="card p-3 animate-pulse">
            <div className="h-4 w-1/2 bg-gray-200 rounded" />
            <div className="h-3 w-3/4 bg-gray-100 rounded mt-2" />
          </div>
        ))}
      </div>
    </>
  );
}
