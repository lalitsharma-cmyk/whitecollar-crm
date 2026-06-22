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
} from "@/lib/lead-statuses";
import MasterDataRecordsTable, { type MDRow } from "@/components/MasterDataRecordsTable";
import LeadFilters from "@/components/LeadFilters";
import { leadFilterWhere } from "@/lib/leadFilterWhere";
import { displayBudget } from "@/lib/budgetParse";
import { cleanNeedSnapshot, lastMeaningfulRemark } from "@/lib/needSnapshot";
import { countMasterDataCategories, countAssignmentQueues } from "@/lib/leadCounts";

// ── Master Data V3 — Admin/Super-Admin OPERATIONS CONSOLE (not a dashboard) ──
// Excel-style ops sheet for assignment + routing. Reporting (By Team/Agent/Status/
// Source, Monthly Trend) lives in /reports. Master Data = the sales-lead operations
// grid: filter, sort, inline-edit, bulk-assign. Cold-call leads stay in Revival.
export const dynamic = "force-dynamic";

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
    default:         return { deletedAt: null };
  }
}

const SOURCE_LABEL: Record<string, string> = {
  WEBSITE: "Website", WHATSAPP: "WhatsApp", CSV_IMPORT: "Import", EVENT: "Event",
  REFERRAL: "Referral", INBOUND_CALL: "Inbound Call", FACEBOOK_ADS: "Facebook",
  GOOGLE_ADS: "Google", PORTAL_99ACRES: "99acres", PORTAL_MAGICBRICKS: "MagicBricks",
  PORTAL_HOUSING: "Housing", OTHER: "Other",
};
const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtTime = (d: Date | null) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }) : "—";

export default async function MasterDataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  // Admin / super-admin only — the full company database + edit power.
  if (me.role !== "ADMIN") redirect("/dashboard");
  const sp = await searchParams;

  const cat: Cat = (["all", "workable", "closed", "lost", "deleted", "archived"] as const).includes(sp.cat as Cat)
    ? (sp.cat as Cat)
    : "all";

  // Master Data = SALES leads only. Cold-call leads live in the Revival Engine
  // (the lead-type toggle was removed — Master Data is the sales ops console).
  const coldFilter: Prisma.LeadWhereInput = { isColdCall: false };

  // Cross-cutting filters (same engine as /leads).
  const baseAnd: Prisma.LeadWhereInput[] = [...leadFilterWhere(sp)];
  if (sp.batch) baseAnd.push({ importBatchId: sp.batch });
  const whereFor = (c: Cat): Prisma.LeadWhereInput => ({ ...coldFilter, AND: [...baseAnd, catWhere(c)] });
  const where = whereFor(cat);

  // Category-tab counts + operations counters (unassigned agent / awaiting team).
  // Using unified leadCounts module for consistency across the CRM.
  const categories = await countMasterDataCategories();
  const { unassigned: unassignedAgent, awaitingTeam } = await countAssignmentQueues();
  const catCount: Record<Cat, number> = { all: categories.all, workable: categories.workable, closed: categories.closed, lost: categories.lost, deleted: categories.deleted, archived: categories.archived };

  // Load the FULL category set (no server pagination) — the table sorts /
  // filters / paginates client-side, Excel-style. Capped for safety.
  const [agents, leads] = await Promise.all([
    prisma.user.findMany({ where: { active: true, hrOnly: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.lead.findMany({
      where,
      include: { owner: { select: { name: true } }, importBatch: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
      take: 3000,
    }),
  ]);
  const statuses = Array.from(new Set([...INDIA_STATUSES, ...DUBAI_STATUSES]));

  // Latest conversation remark per lead — READ-ONLY (DISTINCT ON leadId, newest
  // first). Powers the Quick-Preview drawer's "Last Remark" without opening the
  // full lead. Falls back to lead.remarks. No writes, no migration.
  const leadIds = leads.map((l) => l.id);
  const recentActs = leadIds.length
    ? await prisma.activity.findMany({
        where: { leadId: { in: leadIds }, description: { not: null } },
        distinct: ["leadId"],
        orderBy: [{ leadId: "asc" }, { createdAt: "desc" }],
        select: { leadId: true, description: true },
      })
    : [];
  const lastRemarkBy: Record<string, string> = {};
  for (const a of recentActs) if (a.description) lastRemarkBy[a.leadId] = a.description;

  // Filter-panel option lists.
  const [srcRows, tagRows] = await Promise.all([
    prisma.lead.findMany({ where: { sourceRaw: { not: null } }, select: { sourceRaw: true }, distinct: ["sourceRaw"], orderBy: { sourceRaw: "asc" } }),
    prisma.lead.findMany({ where: { tags: { not: null } }, select: { tags: true }, distinct: ["tags"], orderBy: { tags: "asc" } }),
  ]);
  const filterSources = srcRows.map((r) => r.sourceRaw!).filter(Boolean);
  const filterTags = tagRows.map((r) => r.tags!).filter(Boolean).slice(0, 50);

  const keep = (next: Partial<Record<string, string>>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v != null && v !== "" && k !== "page" && k !== "cat" && !(k in next)) p.set(k, String(v));
    }
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    const qs = p.toString();
    return `/master-data${qs ? `?${qs}` : ""}`;
  };
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

  const exportHref = (() => {
    const p = new URLSearchParams({ type: "leads", master: "1", cat });
    for (const k of ["team", "owner", "source", "q"]) if (sp[k]) p.set(k, String(sp[k]));
    return `/api/reports/export?${p.toString()}`;
  })();

  const rows: MDRow[] = leads.map((l) => {
    const bucket = bucketOf(l) ?? "—";
    return {
      id: l.id,
      name: l.name,
      href: `/master-data/${l.id}?back=${encodeURIComponent(backToHere)}`,
      createdDate: fmtDate(l.createdAt),
      createdTime: fmtTime(l.createdAt),
      createdAtMs: l.createdAt ? new Date(l.createdAt).getTime() : 0,
      budget: displayBudget(l),
      statusLabel: l.currentStatus ?? null,
      statusClass: l.currentStatus ? statusColor(l.currentStatus) : "",
      bucket,
      bucketClass: bucketChip(bucket),
      owner: l.owner?.name ?? "Unassigned",
      ownerId: l.ownerId ?? null,
      team: l.forwardedTeam ?? "—",
      project: l.sourceDetail ?? "—",
      propertyType: l.propertyType ?? "",
      sourceLabel: SOURCE_LABEL[l.source] ?? l.source,
      sourceRaw: l.sourceRaw ?? "",
      leadOrigin: l.leadOrigin,
      // Read-only preview fields (Message column + Quick-Preview drawer).
      phone: l.phone ?? "",
      email: l.email ?? "",
      // Clean one-line summaries only — never the raw remark blob. The full
      // verbatim text stays in Conversation History / Raw History on the lead.
      message: cleanNeedSnapshot(l.notesShort) ?? "",
      lastRemark: (lastRemarkBy[l.id] ?? lastMeaningfulRemark(l.remarks ?? l.notesShort) ?? "").toString().slice(0, 600),
      followupDate: l.followupDate ? fmtDate(l.followupDate) : "",
    };
  });

  return (
    <>
      {/* ── Lean ops header — assignment counters, no charts ──────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Master Data</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            Operations console · <span className="font-semibold">{catCount[cat]}</span> in view ·
            {" "}<span className={unassignedAgent ? "text-amber-600 font-semibold" : ""}>{unassignedAgent} unassigned</span> ·
            {" "}<span className={awaitingTeam ? "text-amber-600 font-semibold" : ""}>{awaitingTeam} awaiting team</span>
          </p>
        </div>
        <a href={exportHref} className="btn btn-ghost self-start sm:self-auto" title="Export this exact view to CSV">⬇ Export CSV</a>
      </div>

      {/* ── Category tabs (operational buckets) ─────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {CATS.map((c) => {
          const active = cat === c.key;
          return (
            <Link key={c.key} href={keep({ cat: c.key === "all" ? "" : c.key })} title={c.hint}
              className={`px-3.5 py-2 rounded-lg text-sm font-semibold border inline-flex items-center gap-2 transition-colors ${
                active ? "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-blue-700 dark:border-blue-700"
                : "bg-white dark:bg-slate-700 border-[#e5e7eb] dark:border-slate-600 text-gray-700 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-600"}`}>
              {c.label}
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${active ? "bg-white/20" : "bg-gray-100 dark:bg-slate-600"}`}>{catCount[c.key]}</span>
            </Link>
          );
        })}
      </div>

      {/* ── Filters (same panel as Leads) ──────────────────────────────────── */}
      <LeadFilters
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        sources={filterSources}
        statuses={statuses}
        showSource
        distinctTags={filterTags}
      />

      {/* ── Excel-style operations grid ────────────────────────────────────── */}
      <MasterDataRecordsTable rows={rows} agents={agents} isSuperAdmin={!!me.isSuperAdmin} viewerId={me.id} />
    </>
  );
}
