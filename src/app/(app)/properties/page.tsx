import { prisma } from "@/lib/prisma";
import { UnitStatus, ProjectStatus, Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { bestLeadsForProject, type SuggestedLead } from "@/lib/leadsForProject";
import { projectWhereForUser } from "@/lib/propertyScope";
import { leadScopeWhere } from "@/lib/leadScope";
import Link from "next/link";
import { formatLeadName } from "@/lib/leadName";
import { formatBudgetAmount } from "@/lib/budgetParse";

export const dynamic = "force-dynamic";

const COUNTRY_FOR_TEAM: Record<string, string[]> = {
  Dubai: ["UAE", "United Arab Emirates"],
  India: ["India"],
};

// Allowed sort keys for the ?sort= dropdown. Restricted set so a stray query
// string can't crash the page.
type SortKey = "name" | "inquiries" | "units";
const SORT_KEYS: SortKey[] = ["name", "inquiries", "units"];

// Status filter buckets — these are computed AFTER fetching (depends on unit
// aggregation), so we can't compose them into the Prisma where clause.
type StatusBucket = "all" | "available" | "sold_out" | "coming_soon";
const STATUS_BUCKETS: { key: StatusBucket; label: string }[] = [
  { key: "all", label: "All" },
  { key: "available", label: "Available units" },
  { key: "sold_out", label: "Sold out" },
  { key: "coming_soon", label: "Coming soon" },
];

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const isAdminOrManager = me.role === "ADMIN" || me.role === "MANAGER";

  // Team scoping: agents see only their team's projects (Dubai → UAE, India → India).
  // Admin/Manager default to their own team but can override via ?team=all.
  const view = sp.team ?? (isAdminOrManager ? me.team ?? "all" : me.team ?? "all");

  // ── Filter params ──
  const q = (sp.q ?? "").trim();
  const countryFilter = (sp.country ?? "").trim();
  const cityFilter = (sp.city ?? "").trim();
  const statusFilterRaw = (sp.status ?? "all").trim() as StatusBucket;
  const statusFilter: StatusBucket =
    STATUS_BUCKETS.some(b => b.key === statusFilterRaw) ? statusFilterRaw : "all";
  const sortRaw = (sp.sort ?? "name") as SortKey;
  const sort: SortKey = SORT_KEYS.includes(sortRaw) ? sortRaw : "name";

  // ── Compose Prisma where (team + q + country + city, all AND) ──
  const andClauses: Prisma.ProjectWhereInput[] = [];

  // Hard team-scope for AGENTS — Dubai team sees only UAE, India team sees
  // only India. Cannot be bypassed via ?team=all (the segmented control above
  // only renders for admin/manager, but a crafted URL would otherwise leak).
  // Admin / Manager / HQ / null-team agents → empty (no extra filter).
  const userScope = projectWhereForUser(me);
  if (Object.keys(userScope).length > 0) {
    andClauses.push(userScope);
  }

  if (view !== "all" && COUNTRY_FOR_TEAM[view]) {
    andClauses.push({ country: { in: COUNTRY_FOR_TEAM[view] } });
  }

  if (q) {
    andClauses.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { developer: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (countryFilter) {
    andClauses.push({ country: countryFilter });
  }

  if (cityFilter) {
    andClauses.push({ city: cityFilter });
  }

  const where: Prisma.ProjectWhereInput = andClauses.length ? { AND: andClauses } : {};

  // Sort: name/units handled in JS post-fetch (units needs aggregation;
  // inquiries needs the discussedBy count). We fetch with a stable createdAt
  // order then re-sort below.
  const projects = await prisma.project.findMany({
    where,
    include: {
      units: true,
      _count: { select: { discussedBy: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Compute status bucket per project. "Coming soon" = no units or all COMING_SOON
  // (note: there's no COMING_SOON UnitStatus enum value — project.status is the
  // signal, so we treat "no units yet" + ProjectStatus.OFF_PLAN as coming soon).
  const bucketOf = (p: typeof projects[number]): StatusBucket => {
    if (p.units.length === 0) return "coming_soon";
    const allSold = p.units.every(u => u.status === UnitStatus.SOLD);
    if (allSold) return "sold_out";
    const anyAvail = p.units.some(u => u.status === UnitStatus.AVAILABLE);
    if (anyAvail) return "available";
    if (p.status === ProjectStatus.OFF_PLAN) return "coming_soon";
    return "all";
  };

  // Build distinct country + city lists from the FULL (team-scoped, q-matched)
  // result set so the chip rows reflect what's actually filterable right now.
  // We use a Set on the in-memory results — cheap, and avoids a second round-trip.
  const distinctCountries = [...new Set(projects.map(p => p.country).filter(Boolean))].sort();
  const distinctCities = [...new Set(projects.map(p => p.city).filter(Boolean))].sort();

  // Apply status filter post-fetch.
  const filteredProjects = projects.filter(p => statusFilter === "all" || bucketOf(p) === statusFilter);

  // Apply sort.
  const sortedProjects = [...filteredProjects].sort((a, b) => {
    if (sort === "units") return b.units.length - a.units.length;
    if (sort === "inquiries") return b._count.discussedBy - a._count.discussedBy;
    return a.name.localeCompare(b.name);
  });

  const totalUnits = sortedProjects.reduce((s, p) => s + p.units.length, 0);
  const available = sortedProjects.reduce((s, p) => s + p.units.filter(u => u.status === UnitStatus.AVAILABLE).length, 0);

  // §9.8 — for each project, find pipeline leads worth pitching this to.
  // Done in parallel so we don't add round-trip latency per card.
  // Scope to the viewer (audit P2-1): an AGENT only matches their OWN leads, so
  // the expander never names a peer's client/budget. ADMIN → all, MANAGER → reports.
  const leadScope = await leadScopeWhere(me);
  const matchesByProject = new Map<string, SuggestedLead[]>(
    await Promise.all(
      sortedProjects.map(async (p): Promise<[string, SuggestedLead[]]> => [
        p.id,
        await bestLeadsForProject(p.id, 5, leadScope),
      ]),
    ),
  );

  // Canonical formatter (Dubai "2M AED" / India "21 Cr", empty→"—") — no bespoke divisors.
  const fmtBudget = (amount: number, currency: string, indiaTeam: boolean): string =>
    formatBudgetAmount(amount, (indiaTeam || currency === "INR") ? "INDIA" : "DUBAI");

  // ── Helpers to build chip hrefs that preserve unrelated filters ──
  // Each chip toggles ONE param while keeping team, q, sort, and other filters.
  const baseParams: Record<string, string> = {};
  if (sp.team) baseParams.team = sp.team;
  if (q) baseParams.q = q;
  if (sort !== "name") baseParams.sort = sort;
  if (countryFilter) baseParams.country = countryFilter;
  if (cityFilter) baseParams.city = cityFilter;
  if (statusFilter !== "all") baseParams.status = statusFilter;

  const hrefWith = (overrides: Record<string, string | null>): string => {
    const merged = { ...baseParams };
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null || v === "") delete merged[k];
      else merged[k] = v;
    }
    const qs = new URLSearchParams(merged).toString();
    return qs ? `/properties?${qs}` : "/properties";
  };

  // Hidden inputs to carry the existing non-q params through the search form
  // (so submitting search doesn't clobber active filters/sort/team view).
  const carryThroughParams: { name: string; value: string }[] = [];
  if (sp.team) carryThroughParams.push({ name: "team", value: sp.team });
  if (countryFilter) carryThroughParams.push({ name: "country", value: countryFilter });
  if (cityFilter) carryThroughParams.push({ name: "city", value: cityFilter });
  if (statusFilter !== "all") carryThroughParams.push({ name: "status", value: statusFilter });
  if (sort !== "name") carryThroughParams.push({ name: "sort", value: sort });

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Properties</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            {sortedProjects.length} projects · {totalUnits} units · {available} available
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

      {/* ── Search + filter bar ──────────────────────────────────────────
          Pure server-side: GET form for the text query, plain <Link> chips
          for the toggles. No client component needed. */}
      <div className="card p-3 sm:p-4 flex flex-col gap-3">
        {/* Search box + sort dropdown (one form, GET, action=/properties) */}
        <form action="/properties" method="get" className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search project, city, or developer…"
            className="input flex-1"
          />
          <select name="sort" defaultValue={sort} className="input sm:w-44">
            <option value="name">Sort: Name</option>
            <option value="inquiries">Sort: Most inquiries</option>
            <option value="units">Sort: Most units</option>
          </select>
          {carryThroughParams.map(p => (
            <input key={p.name} type="hidden" name={p.name} value={p.value} />
          ))}
          <button type="submit" className="btn btn-primary justify-center">Search</button>
          {(q || countryFilter || cityFilter || statusFilter !== "all" || sort !== "name") && (
            <Link href={`/properties${sp.team ? `?team=${sp.team}` : ""}`} className="btn justify-center">Clear</Link>
          )}
        </form>

        {/* Status chips */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500 mr-1">Status:</span>
          {STATUS_BUCKETS.map(b => {
            const active = statusFilter === b.key;
            return (
              <Link
                key={b.key}
                href={hrefWith({ status: b.key === "all" ? null : b.key })}
                className={`chip ${active ? "chip-new" : "src"} text-xs cursor-pointer`}
              >
                {b.label}
              </Link>
            );
          })}
        </div>

        {/* Country chips */}
        {distinctCountries.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-gray-500 mr-1">Country:</span>
            <Link
              href={hrefWith({ country: null })}
              className={`chip ${!countryFilter ? "chip-new" : "src"} text-xs cursor-pointer`}
            >
              All
            </Link>
            {distinctCountries.map(c => {
              const active = countryFilter === c;
              return (
                <Link
                  key={c}
                  href={hrefWith({ country: active ? null : c })}
                  className={`chip ${active ? "chip-new" : "src"} text-xs cursor-pointer`}
                >
                  {c}
                </Link>
              );
            })}
          </div>
        )}

        {/* City chips */}
        {distinctCities.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-gray-500 mr-1">City:</span>
            <Link
              href={hrefWith({ city: null })}
              className={`chip ${!cityFilter ? "chip-new" : "src"} text-xs cursor-pointer`}
            >
              All
            </Link>
            {distinctCities.map(c => {
              const active = cityFilter === c;
              return (
                <Link
                  key={c}
                  href={hrefWith({ city: active ? null : c })}
                  className={`chip ${active ? "chip-new" : "src"} text-xs cursor-pointer`}
                >
                  {c}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {sortedProjects.length === 0 && (
        <div className="card p-5 text-center">
          <div className="text-gray-500">No projects match these filters.</div>
          <Link href="/properties/new" className="btn btn-primary mt-3 inline-flex">+ Add the first project</Link>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedProjects.map((p) => {
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
                  <Link href={`/properties/${p.id}`} className="font-bold text-lg hover:underline">{p.name}</Link>
                </div>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="chip src">{p.status.replaceAll("_"," ")}</span>
                  {p.developer && <span className="chip src">{p.developer}</span>}
                  {p.country && <span className={`chip ${isIndia ? "src-csv" : "src-wa"}`}>{isIndia ? "India" : "Dubai"}</span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 text-sm">
                  <div><div className="text-xs text-gray-500">Units</div><div className="font-semibold">{p.units.length}</div></div>
                  <div><div className="text-xs text-gray-500">Available</div><div className="font-semibold">{avail}</div></div>
                  <div><div className="text-xs text-gray-500">From</div><div className="font-semibold">{fromPrice ? (isIndia ? `₹${(fromPrice/1e7).toFixed(1)} Cr` : `AED ${(fromPrice/1e6).toFixed(1)}M`) : "—"}</div></div>
                </div>
                {configs && <div className="text-xs text-gray-500 mt-3">Configs: {configs}</div>}
                {(() => {
                  const matches = matchesByProject.get(p.id) ?? [];
                  if (matches.length === 0) return null;
                  const top = matches[0];
                  return (
                    <details className="mt-3 group">
                      <summary className="cursor-pointer text-xs text-amber-700 hover:text-amber-900 list-none">
                        <span className="font-semibold">💎 {matches.length} matching lead{matches.length === 1 ? "" : "s"}</span>
                        <span className="text-gray-600"> — top: </span>
                        <Link
                          href={`/leads/${top.leadId}`}
                          className="underline hover:no-underline"
                        >
                          {formatLeadName(top.leadName)}
                        </Link>
                        <span className="text-gray-500"> ({fmtBudget(top.budget, top.currency, isIndia)})</span>
                        <span className="ml-1 text-gray-400 group-open:hidden">▸</span>
                        <span className="ml-1 text-gray-400 hidden group-open:inline">▾</span>
                      </summary>
                      <ul className="mt-2 space-y-1 text-xs">
                        {matches.map((m) => (
                          <li key={m.leadId} className="flex items-center justify-between gap-2">
                            <Link href={`/leads/${m.leadId}`} className="text-gray-800 hover:text-amber-700 truncate">
                              {formatLeadName(m.leadName)}
                            </Link>
                            <span className="flex items-center gap-2 shrink-0">
                              {m.aiScore && (
                                <span className={`chip ${m.aiScore === "HOT" ? "src-wa" : m.aiScore === "WARM" ? "src" : "src-csv"} text-[10px]`}>
                                  {m.aiScore}
                                </span>
                              )}
                              <span className="text-gray-500">{fmtBudget(m.budget, m.currency, isIndia)}</span>
                              <span className="text-gray-400">·</span>
                              <span className="text-amber-700 font-medium">{m.score}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
