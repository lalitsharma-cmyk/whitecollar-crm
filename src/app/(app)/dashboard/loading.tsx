export default function DashboardLoading() {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <div className="h-7 w-64 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mt-2" />
        </div>
      </div>
      <div>
        <div className="text-xs font-bold tracking-widest text-gray-500 mb-2">TODAY AT A GLANCE</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2 lg:gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card p-3 lg:p-4 animate-pulse">
              <div className="h-8 w-12 bg-gray-200 rounded" />
              <div className="h-2 w-16 bg-gray-100 rounded mt-2" />
              <div className="h-3 w-20 bg-gray-100 rounded mt-1" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-3 animate-pulse h-24" />
        ))}
      </div>
    </>
  );
}
