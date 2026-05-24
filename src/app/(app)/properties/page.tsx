import { prisma } from "@/lib/prisma";
import { UnitStatus, ProjectStatus, Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import Link from "next/link";

export const dynamic = "force-dynamic";

const COUNTRY_FOR_TEAM: Record<string, string[]> = {
  Dubai: ["UAE", "United Arab Emirates"],
  India: ["India"],
};

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const isAdminOrManager = me.role === "ADMIN" || me.role === "MANAGER";

  // Team scoping: agents see only their team's projects (Dubai → UAE, India → India).
  // Admin/Manager default to their own team but can override via ?team=all.
  const view = sp.team ?? (isAdminOrManager ? me.team ?? "all" : me.team ?? "all");
  const where: Prisma.ProjectWhereInput = {};
  if (view !== "all" && COUNTRY_FOR_TEAM[view]) {
    where.country = { in: COUNTRY_FOR_TEAM[view] };
  }

  const projects = await prisma.project.findMany({
    where,
    include: { units: true },
    orderBy: { createdAt: "asc" },
  });
  const totalUnits = projects.reduce((s, p) => s + p.units.length, 0);
  const available = projects.reduce((s, p) => s + p.units.filter(u => u.status === UnitStatus.AVAILABLE).length, 0);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Properties</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            {projects.length} projects · {totalUnits} units · {available} available
            {view !== "all" && <span className="ml-2 chip src text-[10px]">{view} team view</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isAdminOrManager && (
            <div className="seg">
              <Link href="/properties?team=Dubai" className={view === "Dubai" ? "on" : ""}>Dubai</Link>
              <Link href="/properties?team=India" className={view === "India" ? "on" : ""}>India</Link>
              <Link href="/properties?team=all" className={view === "all" ? "on" : ""}>All</Link>
            </div>
          )}
          <Link href="/properties/new" className="btn btn-primary self-start sm:self-auto justify-center">+ New Project</Link>
        </div>
      </div>

      {projects.length === 0 && (
        <div className="card p-8 text-center">
          <div className="text-gray-500">No projects in this view.</div>
          <Link href="/properties/new" className="btn btn-primary mt-3 inline-flex">+ Add the first project</Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((p) => {
          const avail = p.units.filter(u => u.status === UnitStatus.AVAILABLE).length;
          const fromPrice = p.units.length ? Math.min(...p.units.map(u => u.priceBase)) : 0;
          const isIndia = p.country === "India";
          const configs = [...new Set(p.units.map(u => u.configuration))].join(" / ");
          return (
            <div key={p.id} className="card overflow-hidden">
              <div
                className={`h-32 bg-gradient-to-r ${p.heroColor ?? "from-slate-700 to-slate-400"} flex items-end p-3 text-white relative overflow-hidden`}
                style={p.imageUrl ? { backgroundImage: `linear-gradient(180deg, rgba(11,26,51,.2) 0%, rgba(11,26,51,.85) 100%), url(${p.imageUrl})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
              >
                <div className="relative z-10">
                  <div className="text-xs opacity-80">{p.area ?? p.city}{p.country ? ` · ${p.country}` : ""}</div>
                  <div className="font-bold text-lg">{p.name}</div>
                </div>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="chip src">{p.status.replaceAll("_"," ")}</span>
                  {p.developer && <span className="chip src">{p.developer}</span>}
                  {p.country && <span className={`chip ${isIndia ? "src-csv" : "src-wa"}`}>{isIndia ? "India" : "Dubai"}</span>}
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                  <div><div className="text-xs text-gray-500">Units</div><div className="font-semibold">{p.units.length}</div></div>
                  <div><div className="text-xs text-gray-500">Available</div><div className="font-semibold">{avail}</div></div>
                  <div><div className="text-xs text-gray-500">From</div><div className="font-semibold">{fromPrice ? (isIndia ? `₹${(fromPrice/1e7).toFixed(1)} Cr` : `AED ${(fromPrice/1e6).toFixed(1)}M`) : "—"}</div></div>
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
