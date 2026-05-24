export default function LeadDetailLoading() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="card p-5 animate-pulse">
          <div className="h-6 w-1/3 bg-gray-200 rounded" />
          <div className="h-3 w-1/2 bg-gray-100 rounded mt-2" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded" />)}
          </div>
        </div>
        <div className="card p-5 h-32 animate-pulse" />
        <div className="card p-5 h-40 animate-pulse" />
      </div>
      <div className="space-y-4">
        <div className="card p-5 h-32 animate-pulse" />
        <div className="card p-5 h-48 animate-pulse" />
      </div>
    </div>
  );
}
