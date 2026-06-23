import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { UnitStatus } from "@prisma/client";
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";
import { requireUser } from "@/lib/auth";
import { bestLeadsForProject } from "@/lib/leadsForProject";
import { leadScopeWhere } from "@/lib/leadScope";
import { formatLeadName } from "@/lib/leadName";
import { userCanAccessProjectCountry } from "@/lib/propertyScope";
import { fmtMoney } from "@/lib/money";
import UnitsCsvImport from "@/components/UnitsCsvImport";
import { formatTxnValue, inferBuyerCurrency, rollupForRecords } from "@/lib/buyerIntelligence";

export const dynamic = "force-dynamic";

export default async function PropertyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const canImportUnits = me.role === "ADMIN" || me.role === "MANAGER";

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      units: {
        include: {
          interestedBy: { include: { lead: true } },
        },
        orderBy: { code: "asc" },
      },
    },
  });
  if (!project) notFound();
  // Market guard — an AGENT must not open another market's project page, even by
  // direct URL. 404 (not 403) so the other market's inventory isn't even revealed
  // to exist. Admin/Manager see all markets.
  if (!userCanAccessProjectCountry(me, project.country)) notFound();

  // Scope both lead lists to the viewer (audit P2-1): an AGENT sees only their
  // OWN matching leads + own active discussions — not peers' client names,
  // budgets or owners. ADMIN → all, MANAGER → own + reports.
  const leadScope = await leadScopeWhere(me);
  const [matchingLeads, activeDiscussions] = await Promise.all([
    bestLeadsForProject(id, 10, leadScope),
    prisma.lead.findMany({
      where: {
        ...leadScope,
        discussed: { some: { projectId: id } },
        currentStatus: { notIn: SUPPRESSED_STATUSES },
      },
      include: { owner: true },
      orderBy: { lastTouchedAt: "desc" },
    }),
  ]);

  const isIndia = project.country === "India";
  const currency = isIndia ? "INR" : "AED";
  const availableCount = project.units.filter((u) => u.status === UnitStatus.AVAILABLE).length;
  const soldCount = project.units.filter((u) => u.status === UnitStatus.SOLD).length;

  // "Buyers of this project" — ADMIN ONLY (buyer data carries passport + financial
  // info). Match BuyerRecords on projectName (case-insensitive). Agents/managers
  // never see this section.
  const projectBuyers = me.role === "ADMIN"
    ? await prisma.buyerRecord.findMany({
        where: { projectName: { equals: project.name, mode: "insensitive" }, deletedAt: null },
        orderBy: { transactionDate: "desc" },
        take: 200,
      })
    : [];

  return (
    <>
      {/* Header card */}
      <div className="card overflow-hidden">
        <div
          className={`h-40 sm:h-48 bg-gradient-to-r ${project.heroColor ?? "from-slate-700 to-slate-400"} flex items-end p-5 text-white relative overflow-hidden`}
          style={
            project.imageUrl
              ? {
                  backgroundImage: `linear-gradient(180deg, rgba(11,26,51,.2) 0%, rgba(11,26,51,.85) 100%), url(${project.imageUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : undefined
          }
        >
          <div className="relative z-10">
            <div className="text-xs opacity-80">
              {project.area ?? project.city}
              {project.country ? ` · ${project.country}` : ""}
            </div>
            <h1 className="font-bold text-2xl sm:text-3xl">{project.name}</h1>
            {project.developer && (
              <div className="text-sm opacity-90 mt-1">by {project.developer}</div>
            )}
          </div>
        </div>
        <div className="p-4 flex flex-wrap gap-2 text-xs items-center justify-between">
          <div className="flex flex-wrap gap-2">
            <span className="chip src">{project.status.replaceAll("_", " ")}</span>
            {project.country && (
              <span className={`chip ${isIndia ? "src-csv" : "src-wa"}`}>
                {isIndia ? "India" : "Dubai"}
              </span>
            )}
            {project.city && <span className="chip src">{project.city}</span>}
          </div>
          <Link href="/properties" className="text-xs text-gray-500 hover:text-gray-800">
            ← Back to all
          </Link>
        </div>
      </div>

      {/* Section: Buyers of this project — ADMIN ONLY (passport + financial data) */}
      {me.role === "ADMIN" && projectBuyers.length > 0 && (() => {
        const totalInvested = rollupForRecords(projectBuyers).totalInvestmentValue;
        const invCcy = inferBuyerCurrency({ projectName: project.name, nationality: projectBuyers[0]?.nationality });
        return (
          <section className="card p-4 mt-4">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h2 className="font-semibold flex items-center gap-2">💳 Buyers of this project
                <span className="text-xs font-normal text-amber-600 dark:text-amber-400">admin-only</span></h2>
              <div className="text-xs text-gray-500 dark:text-slate-400">
                {projectBuyers.length} record{projectBuyers.length === 1 ? "" : "s"} · {formatTxnValue(totalInvested, invCcy)} total ·
                {" "}<a href={`/api/buyer-data/export?project=${encodeURIComponent(project.name)}`} className="text-blue-600 hover:underline">⬇ CSV</a>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b dark:border-slate-700">
                    <th className="py-2 pr-3">Buyer</th>
                    <th className="py-2 pr-3">Tower / Unit</th>
                    <th className="py-2 pr-3">Config</th>
                    <th className="py-2 pr-3 text-right">Value</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Nationality</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {projectBuyers.map((b) => {
                    const bCcy = inferBuyerCurrency({ projectName: b.projectName, nationality: b.nationality, source: b.source });
                    const tu = [b.tower, b.unitNumber].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
                    return (
                      <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                        <td className="py-2 pr-3"><Link href={`/buyer-data/${b.id}`} className="text-[#0b1a33] dark:text-blue-300 hover:underline font-medium">{b.clientName}</Link></td>
                        <td className="py-2 pr-3 text-gray-600 dark:text-slate-400 whitespace-nowrap">{tu || "—"}</td>
                        <td className="py-2 pr-3 text-gray-600 dark:text-slate-400">{b.configuration || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-800 dark:text-slate-200 whitespace-nowrap">{formatTxnValue(b.transactionValue, bCcy)}</td>
                        <td className="py-2 pr-3 text-gray-600 dark:text-slate-400 whitespace-nowrap">{b.transactionDate ? new Date(b.transactionDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
                        <td className="py-2 pr-3 text-gray-600 dark:text-slate-400">{b.nationality || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })()}

      {/* Bulk import — admin/manager only, sits just above the Inventory table */}
      {canImportUnits && <UnitsCsvImport projectId={id} />}

      {/* Section: Inventory */}
      <section className="card p-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Inventory</h2>
          <div className="text-xs text-gray-500">
            {project.units.length} units · {availableCount} available · {soldCount} sold
          </div>
        </div>
        {project.units.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">No units yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Config</th>
                  <th className="py-2 pr-3">Carpet (sqft)</th>
                  <th className="py-2 pr-3">Floor</th>
                  <th className="py-2 pr-3">View</th>
                  <th className="py-2 pr-3">Price</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {project.units.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs">{u.code}</td>
                    <td className="py-2 pr-3">{u.configuration}</td>
                    <td className="py-2 pr-3">{u.carpetArea ?? "—"}</td>
                    <td className="py-2 pr-3">{u.floor ?? "—"}</td>
                    <td className="py-2 pr-3">{u.view ?? "—"}</td>
                    <td className="py-2 pr-3">{fmtMoney(u.priceBase, currency)}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`chip ${
                          u.status === UnitStatus.AVAILABLE
                            ? "src-wa"
                            : u.status === UnitStatus.SOLD
                            ? "src-csv"
                            : "src"
                        } text-[10px]`}
                      >
                        {u.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section: Matching leads */}
      <section className="card p-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Matching leads</h2>
          <span className="text-xs text-gray-500">Top {matchingLeads.length}</span>
        </div>
        {matchingLeads.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">
            No matching pipeline leads right now.
          </div>
        ) : (
          <ul className="divide-y">
            {matchingLeads.map((m) => (
              <li key={m.leadId} className="py-2 flex items-center justify-between gap-2">
                <Link
                  href={`/leads/${m.leadId}`}
                  className="text-sm text-gray-800 hover:text-amber-700 truncate"
                >
                  {formatLeadName(m.leadName)}
                </Link>
                <div className="flex items-center gap-2 shrink-0 text-xs">
                  <span className="text-gray-600">{fmtMoney(m.budget, m.currency || currency)}</span>
                  {m.aiScore && (
                    <span
                      className={`chip ${
                        m.aiScore === "HOT"
                          ? "src-wa"
                          : m.aiScore === "WARM"
                          ? "src"
                          : "src-csv"
                      } text-[10px]`}
                    >
                      {m.aiScore}
                    </span>
                  )}
                  <span className="text-amber-700 font-medium">{m.score}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Section: Active discussions */}
      <section className="card p-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Active discussions</h2>
          <span className="text-xs text-gray-500">
            {activeDiscussions.length} lead{activeDiscussions.length === 1 ? "" : "s"}
          </span>
        </div>
        {activeDiscussions.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">
            Nobody is actively discussing this project.
          </div>
        ) : (
          <ul className="divide-y">
            {activeDiscussions.map((l) => (
              <li key={l.id} className="py-2 flex items-center justify-between gap-2">
                <Link
                  href={`/leads/${l.id}`}
                  className="text-sm text-gray-800 hover:text-amber-700 truncate"
                >
                  {formatLeadName(l.name)}
                </Link>
                <div className="flex items-center gap-2 shrink-0 text-xs">
                  <span className="chip src text-[10px]">{l.status.replaceAll("_", " ")}</span>
                  <span className="text-gray-500">{l.owner?.name ?? "Unassigned"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
