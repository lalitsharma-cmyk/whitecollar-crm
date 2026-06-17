import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import {
  statusColor,
  leadCategory,
  CLOSED_OUTCOME_STATUSES,
  LOST_STATUSES,
  TERMINAL_STATUSES,
  INDIA_STATUSES,
  DUBAI_STATUSES,
  EXCEL_STATUSES,
} from "@/lib/lead-statuses";
import MasterDataRecordsTable, { type MDRow } from "@/components/MasterDataRecordsTable";
import { sourceBreakdown } from "@/lib/sourceLabel";
import LeadFilters from "@/components/LeadFilters";
import { leadFilterWhere, leadFilterOrderBy } from "@/lib/leadFilterWhere";

// ── Master Data — the COMPLETE lead database (Admin / Lalit only) ───────────
// The normal /leads view shows only WORKABLE leads. This is the full picture:
// every record across every lifecycle state, with reporting. Lalit's rule —
//   "Master Data = complete database, including rejected/lost/closed/deleted."
//
// Categories partition the whole DB (per the active cold-lead filter):
//   workable → active + actionable        (the working pipeline)
//   closed   → active + closed outcome    (booked / sold / leased)
//   lost     → active + lost/rejected     (Broker, War Fear, …)
//   deleted  → individually soft-deleted  (admin delete — recycle bin)
//   archived → from a rolled-back import  (importBatch.status = DELETED)
//   all      → everything above
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// Workable = NOT terminal, but SQL NOT IN drops NULLs — OR null/blank back in so
// fresh/unclassified leads count as workable (same rule as the Leads view).
const WORKABLE_OR: Prisma.LeadWhereInput[] = [
  { currentStatus: null },
  { currentStatus: "" },
  { currentStatus: { notIn: TERMINAL_STATUSES } },
];

type Cat = "all" | "workable" | "closed" | "lost" | "deleted" | "archived";
const CATS: { key: Cat; label: string; hint: string }[] = [
  { key: "all",      label: "All",              hint: "Every record" },
  { key: "workable", label: "Active / Workable", hint: "Actionable pipeline" },
  { key: "closed",   label: "Closed Outcomes",  hint: "Booked / sold / leased" },
  { key: "lost",     label: "Lost / Rejected",  hint: "Non-actionable" },
  { key: "deleted",  label: "Deleted",          hint: "Individually deleted (restorable)" },
  { key: "archived", label: "Archived",         hint: "From a rolled-back import (restorable)" },
];

// Soft-deleted via a rolled-back import batch → Archived; any other soft-delete
// (individual admin delete) → Deleted.
const ARCHIVED_WHERE: Prisma.LeadWhereInput = { deletedAt: { not: null }, importBatch: { is: { status: "DELETED" } } };
const DELETED_WHERE: Prisma.LeadWhereInput = {
  deletedAt: { not: null },
  OR: [{ importBatchId: null }, { importBatch: { is: { status: { not: "DELETED" } } } }],
};

function catWhere(cat: Cat): Prisma.LeadWhereInput {
  switch (cat) {
    case "workable": return { deletedAt: null, OR: WORKABLE_OR };
    case "closed":   return { deletedAt: null, currentStatus: { in: CLOSED_OUTCOME_STATUSES } };
    case "lost":     return { deletedAt: null, currentStatus: { in: LOST_STATUSES } };
    case "deleted":  return DELETED_WHERE;
    case "archived": return ARCHIVED_WHERE;
    default:         return {};
  }
}

const SOURCE_LABEL: Record<string, string> = {
  WEBSITE: "Website", WHATSAPP: "WhatsApp", CSV_IMPORT: "Import", EVENT: "Event",
  REFERRAL: "Referral", INBOUND_CALL: "Inbound Call", FACEBOOK_ADS: "Facebook",
  GOOGLE_ADS: "Google", PORTAL_99ACRES: "99acres", PORTAL_MAGICBRICKS: "MagicBricks",
  PORTAL_HOUSING: "Housing", OTHER: "Other",
};
const fmtDate = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

type TrendRow = { month: string; created: number; closed: number; lost: number; deleted: number };

export default async function MasterDataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  // Admin / super-admin only — this is the full company database.
  if (me.role !== "ADMIN") redirect("/dashboard");
  const sp = await searchParams;

  const cat: Cat = (["all", "workable", "closed", "lost", "deleted", "archived"] as const).includes(sp.cat as Cat)
    ? (sp.cat as Cat)
    : "all";
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);

  // Lead-type filter: sales leads (default) / include cold / cold only.
  const cold = sp.cold === "all" || sp.cold === "only" ? sp.cold : "no";
  const coldFilter: Prisma.LeadWhereInput =
    cold === "only" ? { isColdCall: true } : cold === "all" ? {} : { isColdCall: false };

  // ── Cross-cutting filters (AND with the category) — SAME engine as /leads ──
  // leadFilterWhere translates the full LeadFilters panel (search, status, source,
  // owner, budget, timeline, client type, city, category, dates, etc.) so Master
  // Data filters identically to the Leads view.
  const baseAnd: Prisma.LeadWhereInput[] = [...leadFilterWhere(sp)];
  if (sp.batch) baseAnd.push({ importBatchId: sp.batch });  // "View batch" from Import History
  const whereFor = (c: Cat): Prisma.LeadWhereInput => ({ ...coldFilter, AND: [...baseAnd, catWhere(c)] });
  const where = whereFor(cat);

  // ── Counts for the category tabs (respect the cross-cutting filters) ────
  const [cAll, cWork, cClosed, cLost, cDeleted, cArchived, total] = await Promise.all([
    prisma.lead.count({ where: whereFor("all") }),
    prisma.lead.count({ where: whereFor("workable") }),
    prisma.lead.count({ where: whereFor("closed") }),
    prisma.lead.count({ where: whereFor("lost") }),
    prisma.lead.count({ where: whereFor("deleted") }),
    prisma.lead.count({ where: whereFor("archived") }),
    prisma.lead.count({ where }),
  ]);
  const catCount: Record<Cat, number> = { all: cAll, workable: cWork, closed: cClosed, lost: cLost, deleted: cDeleted, archived: cArchived };

  // ── Reporting breakdowns over the CURRENT view + monthly trend (overall) ─
  const [byTeamRows, byOwnerRows, byStatusRows, bySourceRaw, agents, leads, trendRows] = await Promise.all([
    prisma.lead.groupBy({ by: ["forwardedTeam"], where, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["ownerId"], where, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["currentStatus"], where, _count: { _all: true } }),
    prisma.lead.findMany({ where, select: { source: true, sourceRaw: true } }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, team: true } }),
    prisma.lead.findMany({
      where,
      include: { owner: { select: { name: true } }, importBatch: { select: { fileName: true, status: true } } },
      orderBy: leadFilterOrderBy(sp),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    // Historical cohort: leads CREATED each month + their CURRENT outcome.
    prisma.$queryRaw<TrendRow[]>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
             COUNT(*)::int AS created,
             COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "currentStatus" IN (${Prisma.join(CLOSED_OUTCOME_STATUSES)}))::int AS closed,
             COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "currentStatus" IN (${Prisma.join(LOST_STATUSES)}))::int AS lost,
             COUNT(*) FILTER (WHERE "deletedAt" IS NOT NULL)::int AS deleted
      FROM "Lead"
      WHERE "isColdCall" = false
      GROUP BY 1 ORDER BY 1 DESC LIMIT 6`,
  ]);
  const agentName = Object.fromEntries(agents.map((a) => [a.id, a.name]));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const byOwner = byOwnerRows
    .map((r) => ({ label: r.ownerId ? (agentName[r.ownerId] ?? "—") : "Unassigned", count: r._count._all }))
    .sort((a, b) => b.count - a.count);
  const byStatus = byStatusRows
    .filter((r) => r.currentStatus)
    .map((r) => ({ label: r.currentStatus as string, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
  // sourceBreakdown already groups by effective source (verbatim sourceRaw,
  // enum-label fallback) and returns { source, n } sorted by count desc.
  const bySource = sourceBreakdown(bySourceRaw)
    .map((r) => ({ label: r.source, count: r.n }));
  const byTeam = byTeamRows
    .map((r) => ({ label: r.forwardedTeam ?? "Unclassified", count: r._count._all }))
    .sort((a, b) => b.count - a.count);

  // Preserve the cross-cutting filters when switching category tabs.
  const keep = (next: Partial<Record<string, string>>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v != null && v !== "" && k !== "page" && k !== "cat" && !(k in next)) p.set(k, String(v));
    }
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const qs = p.toString();
    return `/master-data${qs ? `?${qs}` : ""}`;
  };

  // Back target for the detail page = this exact Master Data view (all current
  // filters + category + page preserved), so its Back button returns here.
  const backToHere = (() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v) p.set(k, String(v));
    const qs = p.toString();
    return `/master-data${qs ? `?${qs}` : ""}`;
  })();

  const bucketOf = (l: { deletedAt: Date | null; currentStatus: string | null; importBatch: { status: string } | null }) =>
    l.deletedAt
      ? (l.importBatch?.status === "DELETED" ? "Archived" : "Deleted")
      : ({ WORKABLE: "Workable", CLOSED: "Closed", LOST: "Lost" }[leadCategory(l.currentStatus)]);
  const bucketChip = (b: string) =>
    b === "Workable" ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : b === "Closed" ? "bg-green-100 text-green-800 border-green-200"
    : b === "Lost" ? "bg-rose-100 text-rose-700 border-rose-200"
    : b === "Archived" ? "bg-amber-100 text-amber-700 border-amber-200"
    : "bg-slate-200 text-slate-600 border-slate-300";

  // Export href — master mode hits the full DB (all owners), scoped to category.
  const exportHref = (() => {
    const p = new URLSearchParams({ type: "leads", master: "1", cat });
    if (cold !== "no") p.set("cold", cold);
    for (const k of ["team", "owner", "source", "q"]) if (sp[k]) p.set(k, String(sp[k]));
    return `/api/reports/export?${p.toString()}`;
  })();

  // Bulk-action support: Sales-side agents (hrOnly excluded → HR/Sales isolation)
  // for the Assign picker, and the India+Dubai workable status sets for Set Status.
  const assignAgents = await prisma.user.findMany({
    where: { active: true, hrOnly: false },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const statuses = Array.from(new Set([...INDIA_STATUSES, ...DUBAI_STATUSES]));

  // Filter-panel option lists (same UX as /leads): distinct verbatim sources + tags.
  const [srcRows, tagRows] = await Promise.all([
    prisma.lead.findMany({ where: { sourceRaw: { not: null } }, select: { sourceRaw: true }, distinct: ["sourceRaw"], orderBy: { sourceRaw: "asc" } }),
    prisma.lead.findMany({ where: { tags: { not: null } }, select: { tags: true }, distinct: ["tags"], orderBy: { tags: "asc" } }),
  ]);
  const filterSources = srcRows.map((r) => r.sourceRaw!).filter(Boolean);
  const filterTags = tagRows.map((r) => r.tags!).filter(Boolean).slice(0, 50);
  const displayRows: MDRow[] = leads.map((l) => {
    const bucket = bucketOf(l) ?? "—";
    return {
      id: l.id,
      name: l.name,
      href: `/master-data/${l.id}?back=${encodeURIComponent(backToHere)}`,
      statusLabel: l.currentStatus ?? null,
      statusClass: l.currentStatus ? statusColor(l.currentStatus) : "",
      bucket,
      bucketClass: bucketChip(bucket),
      owner: l.owner?.name ?? "Unassigned",
      team: l.forwardedTeam ?? "—",
      sourceLabel: SOURCE_LABEL[l.source] ?? l.source,
      createdLabel: fmtDate(l.createdAt),
      importFile: l.importBatch?.fileName ?? "—",
    };
  });

  return (
    <>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Master Data</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            Complete lead database — every state. <span className="font-semibold">{cAll}</span> records ·
            {" "}{cWork} workable · {cClosed} closed · {cLost} lost · {cDeleted} deleted · {cArchived} archived
          </p>
        </div>
        <a href={exportHref} className="btn btn-ghost self-start sm:self-auto" title="Export this exact view to CSV">⬇ Export CSV</a>
      </div>

      {/* ── Category tabs ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {CATS.map((c) => {
          const active = cat === c.key;
          return (
            <Link
              key={c.key}
              href={keep({ cat: c.key === "all" ? "" : c.key })}
              title={c.hint}
              className={`px-3.5 py-2 rounded-lg text-sm font-semibold border inline-flex items-center gap-2 transition-colors ${
                active
                  ? "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-blue-700 dark:border-blue-700"
                  : "bg-white dark:bg-slate-700 border-[#e5e7eb] dark:border-slate-600 text-gray-700 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-600"
              }`}
            >
              {c.label}
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${active ? "bg-white/20" : "bg-gray-100 dark:bg-slate-600"}`}>
                {catCount[c.key]}
              </span>
            </Link>
          );
        })}
      </div>

      {/* ── Filters — SAME panel + UX as the Leads view (status, source, owner,
          budget, timeline, client type, city, category, dates, sort, …) ──── */}
      <LeadFilters
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        sources={filterSources}
        statuses={statuses}
        showSource
        distinctTags={filterTags}
      />

      {/* Lead-type toggle (Master-Data-specific) — cold-call leads live in Revival */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-gray-400 dark:text-slate-500">Lead type:</span>
        {(([["no", "Sales leads"], ["all", "+ Cold calls"], ["only", "Cold only"]]) as [string, string][]).map(([v, label]) => {
          const active = cold === v;
          return (
            <Link key={v} href={keep({ cat: cat === "all" ? "" : cat, cold: v === "no" ? "" : v })}
              title="Cold-call leads live in the Revival Engine"
              className={`px-2.5 py-1 rounded-full border font-medium transition-colors ${active
                ? "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-blue-700 dark:border-blue-700"
                : "bg-white dark:bg-slate-700 border-[#e5e7eb] dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-600"}`}>
              {label}
            </Link>
          );
        })}
      </div>

      {/* ── Reporting breakdowns ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Breakdown title="By Team" rows={byTeam} />
        <Breakdown title="By Agent" rows={byOwner} />
        <Breakdown title={cat === "lost" ? "By Reject Reason" : "By Status"} rows={byStatus} colorByStatus />
        <Breakdown title="By Source" rows={bySource} />
      </div>

      {/* ── Historical trend (cohort by created-month, overall) ──────────── */}
      {trendRows.length > 0 && (
        <div className="card p-4">
          <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 mb-3 uppercase tracking-wide">
            Monthly Trend <span className="font-normal normal-case">— leads created per month and where they are now (all sales leads)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-[#e5e7eb] dark:border-slate-600">
                  <th className="px-2 py-1.5 font-semibold">Month</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Created</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Workable</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Closed</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Lost</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Deleted</th>
                </tr>
              </thead>
              <tbody>
                {trendRows.map((r) => {
                  const workable = Math.max(0, r.created - r.closed - r.lost - r.deleted);
                  return (
                    <tr key={r.month} className="border-b border-[#f1f5f9] dark:border-slate-700">
                      <td className="px-2 py-1.5 font-medium tabular-nums">{r.month}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{r.created}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{workable}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-green-700 dark:text-green-400">{r.closed}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-rose-700 dark:text-rose-400">{r.lost}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{r.deleted}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Records table (selectable + bulk actions) ──────────────────────── */}
      <MasterDataRecordsTable rows={displayRows} agents={assignAgents} statuses={statuses} isSuperAdmin={!!me.isSuperAdmin} />

      {/* ── Pagination ──────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500 dark:text-slate-400">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            {page > 1 && <Link href={keep({ cat: cat === "all" ? "" : cat, page: String(page - 1) })} className="btn btn-ghost">← Prev</Link>}
            <span className="px-3 py-2 text-gray-500">Page {page} of {totalPages}</span>
            {page < totalPages && <Link href={keep({ cat: cat === "all" ? "" : cat, page: String(page + 1) })} className="btn btn-ghost">Next →</Link>}
          </div>
        </div>
      )}
    </>
  );
}

// Compact "by X" reporting card.
function Breakdown({ title, rows, colorByStatus = false }: { title: string; rows: { label: string; count: number }[]; colorByStatus?: boolean }) {
  const top = rows.slice(0, 8);
  const max = Math.max(1, ...top.map((r) => r.count));
  return (
    <div className="card p-3">
      <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 mb-2 uppercase tracking-wide">{title}</div>
      {top.length === 0 && <div className="text-xs text-gray-400">No data</div>}
      <div className="space-y-1.5">
        {top.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            {colorByStatus
              ? <span className={`px-1.5 py-0.5 rounded-full ${statusColor(r.label)} truncate max-w-[120px]`}>{r.label}</span>
              : <span className="text-gray-700 dark:text-slate-300 truncate max-w-[120px]">{r.label}</span>}
            <div className="flex-1 h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-[#0b1a33] dark:bg-blue-500 rounded-full" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
            <span className="tabular-nums font-semibold text-gray-700 dark:text-slate-300 w-8 text-right">{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
