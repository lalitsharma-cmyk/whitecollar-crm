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
import MasterDataImportControls from "@/components/MasterDataImportControls";
import HelpDot from "@/components/HelpDot";
import { canImportData } from "@/lib/exportPerms";
import LeadFilters from "@/components/LeadFilters";
import { leadFilterWhere } from "@/lib/leadFilterWhere";
import { COLD_ORIGINS } from "@/lib/leadScope";
import { effectiveSource } from "@/lib/sourceLabel";
import { PROPERTY_TYPES } from "@/lib/propertyType";
import { getAvailableMediums } from "@/lib/mediumManager";
import { displayBudget } from "@/lib/budgetParse";
import { cleanNeedSnapshot, lastMeaningfulRemark } from "@/lib/needSnapshot";

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

// The Source column label is resolved per-row by effectiveSource() (verbatim
// sourceRaw wins, e.g. "Townscript"; enum label as legacy fallback) — the SAME
// value the client-side Source column filter reads (valueOf → sourceLabel), so
// display == filter. The raw enum is still carried on the row (`source`) for the
// isWebsiteSource/isEventSource family tests (section ordering + Website/Event
// presets), which must key off the enum, not the free-text label.
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
  // Cold/revival leads live in the Revival Engine, never Master Data. Guard on BOTH
  // isColdCall AND leadOrigin (parity with /leads) so a REVIVAL-origin lead that isn't
  // flagged isColdCall can't leak in — migration-proof origin segregation (audit 2026-06-28).
  const coldFilter: Prisma.LeadWhereInput = { isColdCall: false, leadOrigin: { notIn: COLD_ORIGINS } };

  // Cross-cutting filters (same engine as /leads).
  const baseAnd: Prisma.LeadWhereInput[] = [...leadFilterWhere(sp)];
  if (sp.batch) baseAnd.push({ importBatchId: sp.batch });
  const whereFor = (c: Cat): Prisma.LeadWhereInput => ({ ...coldFilter, AND: [...baseAnd, catWhere(c)] });
  const where = whereFor(cat);

  // ── Category-tab counts + operations counters — FILTER-AWARE (M3 fix) ────────
  // Each category count applies the SAME baseAnd (leadFilterWhere(sp) + ?batch) the
  // table query uses, so the tab badge == the rows the table shows under any filter.
  // Previously these called the no-arg leadCounts helpers, which ignored the active
  // filters → header (217) ≠ table. The queue counters (unassigned agent / awaiting
  // team) likewise honor the current filter set.
  const queueUnassignedWhere: Prisma.LeadWhereInput = { ...coldFilter, AND: [...baseAnd, { deletedAt: null, ownerId: null, rejectedAt: null, OR: WORKABLE_OR }] };
  const queueAwaitingWhere: Prisma.LeadWhereInput = { ...coldFilter, AND: [...baseAnd, { deletedAt: null, forwardedTeam: null, rejectedAt: null, OR: WORKABLE_OR }] };
  const [cAll, cWorkable, cClosed, cLost, cDeleted, cArchived, unassignedAgent, awaitingTeam] = await Promise.all([
    prisma.lead.count({ where: whereFor("all") }),
    prisma.lead.count({ where: whereFor("workable") }),
    prisma.lead.count({ where: whereFor("closed") }),
    prisma.lead.count({ where: whereFor("lost") }),
    prisma.lead.count({ where: whereFor("deleted") }),
    prisma.lead.count({ where: whereFor("archived") }),
    prisma.lead.count({ where: queueUnassignedWhere }),
    prisma.lead.count({ where: queueAwaitingWhere }),
  ]);
  const catCount: Record<Cat, number> = { all: cAll, workable: cWorkable, closed: cClosed, lost: cLost, deleted: cDeleted, archived: cArchived };

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

  // Previous Owner names — Lead.previousOwnerId is a scalar String? with NO
  // `previousOwner` relation (so it can't be `include`d). When a lead goes Lost/
  // Rejected the CRM unassigns it and stashes the last working agent here; resolve
  // those ids → names with ONE lookup. NOT the `agents` list above — that's active,
  // non-HR users only, and a previous owner may now be inactive (e.g. a departed agent).
  const prevIds = Array.from(new Set(leads.map((l) => l.previousOwnerId).filter((v): v is string => !!v)));
  const prevUsers = prevIds.length ? await prisma.user.findMany({ where: { id: { in: prevIds } }, select: { id: true, name: true } }) : [];
  const prevMap = new Map(prevUsers.map((u) => [u.id, u.name]));

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
  const [srcRows, tagRows, projectRows, mediumOptions] = await Promise.all([
    prisma.lead.findMany({ where: { sourceRaw: { not: null } }, select: { sourceRaw: true }, distinct: ["sourceRaw"], orderBy: { sourceRaw: "asc" } }),
    prisma.lead.findMany({ where: { tags: { not: null } }, select: { tags: true }, distinct: ["tags"], orderBy: { tags: "asc" } }),
    // Project Master for the inline "Property Enquired" picker. Admin sees ALL
    // markets (Master Data is admin-only). Active-first so live projects rank up,
    // but inactive/manual ad-hoc names are still searchable.
    prisma.project.findMany({ select: { id: true, name: true, city: true, country: true }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    // Medium filter options — standard channels + custom mediums + "Other".
    getAvailableMediums(),
  ]);
  const filterSources = srcRows.map((r) => r.sourceRaw!).filter(Boolean);
  const filterTags = tagRows.map((r) => r.tags!).filter(Boolean).slice(0, 50);
  const projectOptions = projectRows.map((p) => ({ id: p.id, name: p.name, city: p.city ?? "", country: p.country ?? "" }));

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
    : b === "Lost" ? "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800"
    : b === "Archived" ? "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700"
    : "bg-slate-200 text-slate-600 border-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600";

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
      // Previous Owner — last working agent, stashed on unassign at Lost/Reject.
      // Read-only historical field (no relation → resolved via prevMap above).
      previousOwner: l.previousOwnerId ? (prevMap.get(l.previousOwnerId) ?? "") : "",
      previousOwnerId: l.previousOwnerId ?? null,
      team: l.forwardedTeam ?? "—",
      project: l.sourceDetail ?? "—",
      propertyType: l.propertyType ?? "",
      source: l.source,
      // DISPLAY (and the Source column filter, which reads this same value via
      // valueOf → sourceLabel) use effectiveSource: verbatim sourceRaw wins (e.g.
      // "Townscript"), enum label only for legacy rows with no sourceRaw. Was
      // sourceLabel(l.source) — the enum label — so a Townscript lead stored as
      // source=OTHER showed "Other" while filterable as "Townscript". The raw enum
      // is still carried on `source` above for the isWebsite/isEventSource family
      // tests (section ordering + Website/Event presets).
      sourceLabel: effectiveSource(l.sourceRaw, l.source),
      sourceRaw: l.sourceRaw ?? "",
      medium: (l as any).medium ?? "",
      mediumOther: (l as any).mediumOther ?? null,
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
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold">Master Data</h1>
            {process.env.NEXT_PUBLIC_SANDBOX === "1" && <HelpDot topic="master-data" />}
          </div>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            Operations console · <span className="font-semibold">{catCount[cat]}</span> in view ·
            {" "}<Link href={keep({ view: "Unassigned Leads", cat: "" })} className={`hover:underline ${unassignedAgent ? "text-amber-600 font-semibold" : "text-gray-500 dark:text-slate-400"}`} title="Show ready-to-assign leads (excludes rejected)">{unassignedAgent} unassigned</Link> ·
            {" "}<Link href={keep({ view: "Awaiting Classification", cat: "" })} className={`hover:underline ${awaitingTeam ? "text-amber-600 font-semibold" : "text-gray-500 dark:text-slate-400"}`} title="Show leads awaiting team classification">{awaitingTeam} awaiting team</Link>
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Owner-only Import (Super Admin) — matches the /api/intake/csv server gate.
              Mounts the shared Import-Mapping-Approval wizard for Master Data. */}
          {canImportData(me) && <MasterDataImportControls />}
          {/* Export lives in the table toolbar ("⬇ Export view") so it can POST the
              EXACT filtered id-set (builtin view + column filters), not just URL params. */}
        </div>
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
        mediums={mediumOptions}
        propertyTypes={PROPERTY_TYPES}
      />

      {/* ── Excel-style operations grid ────────────────────────────────────── */}
      <MasterDataRecordsTable rows={rows} agents={agents} projects={projectOptions} isSuperAdmin={!!me.isSuperAdmin} viewerId={me.id} />
    </>
  );
}
