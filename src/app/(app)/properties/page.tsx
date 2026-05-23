import { prisma } from "@/lib/prisma";
import { UnitStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  const projects = await prisma.project.findMany({
    include: { units: true },
    orderBy: { createdAt: "asc" },
  });
  const totalUnits = projects.reduce((s, p) => s + p.units.length, 0);
  const available = projects.reduce((s, p) => s + p.units.filter(u => u.status === UnitStatus.AVAILABLE).length, 0);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Properties</h1>
          <p className="text-sm text-gray-500">{projects.length} projects · {totalUnits} units · {available} available</p>
        </div>
        <button className="btn btn-primary">+ New Project</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => {
          const avail = p.units.filter(u => u.status === UnitStatus.AVAILABLE).length;
          const fromPrice = p.units.length ? Math.min(...p.units.map(u => u.priceBase)) : 0;
          const configs = [...new Set(p.units.map(u => u.configuration))].join(" / ");
          return (
            <div key={p.id} className="card overflow-hidden">
              <div className={`h-32 bg-gradient-to-r ${p.heroColor ?? "from-slate-700 to-slate-400"} flex items-end p-3 text-white`}>
                <div>
                  <div className="text-xs opacity-80">{p.area ?? p.city}</div>
                  <div className="font-bold text-lg">{p.name}</div>
                </div>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="chip src">{p.status.replaceAll("_"," ")}</span>
                  {p.developer && <span className="chip src">{p.developer}</span>}
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                  <div><div className="text-xs text-gray-500">Units</div><div className="font-semibold">{p.units.length}</div></div>
                  <div><div className="text-xs text-gray-500">Available</div><div className="font-semibold">{avail}</div></div>
                  <div><div className="text-xs text-gray-500">From</div><div className="font-semibold">{fromPrice ? `₹${(fromPrice/1e7).toFixed(1)} Cr` : "—"}</div></div>
                </div>
                {configs && <div className="text-xs text-gray-500 mt-3">Configs: {configs}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
