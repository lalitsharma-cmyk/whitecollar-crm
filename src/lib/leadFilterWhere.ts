// Shared lead-filter translation — turns the LeadFilters panel's URL params into
// Prisma `where` conditions + an orderBy. PURE (no prisma import, no "server-only")
// so it can be imported by any server component. Mirrors the /leads page filter
// logic so /leads and /master-data filter IDENTICALLY (single source of truth —
// avoids the drift that previously broke filters when only one copy was updated).
//
// The caller owns role-gating: /leads gates owner/source for AGENTs before
// calling; /master-data is ADMIN-only so it passes everything straight through.
import type { Prisma, FundReadiness, InvestTimeline } from "@prisma/client";

type SP = Record<string, string | undefined>;

const split = (s?: string): string[] => (s ?? "").split(",").map((v) => v.trim()).filter(Boolean);
function parseDay(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function endOfDay(d: Date): Date {
  const e = new Date(d);
  e.setUTCHours(23, 59, 59, 999);
  return e;
}

/**
 * Translate the LeadFilters panel params into an array of AND-composed where
 * conditions. Returns [] when no filters are set.
 */
export function leadFilterWhere(sp: SP): Prisma.LeadWhereInput[] {
  const and: Prisma.LeadWhereInput[] = [];

  // Free-text search — name / phone / email / company.
  if (sp.q) {
    and.push({
      OR: [
        { name: { contains: sp.q, mode: "insensitive" } },
        { phone: { contains: sp.q } },
        { email: { contains: sp.q, mode: "insensitive" } },
        { company: { contains: sp.q, mode: "insensitive" } },
      ],
    });
  }

  // Status — legacy single ?status= + multi ?cstatus= (Excel/MIS statuses).
  if (sp.status) and.push({ currentStatus: sp.status });
  const cstatus = split(sp.cstatus);
  if (cstatus.length === 1) and.push({ currentStatus: { equals: cstatus[0], mode: "insensitive" } });
  else if (cstatus.length > 1) and.push({ currentStatus: { in: cstatus } });

  // Single-value enums.
  if (sp.potential) and.push({ potential: sp.potential as "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN" });
  if (sp.fundReady) and.push({ fundReadiness: sp.fundReady as FundReadiness });

  // Client type — multi.
  const ct = split(sp.clientType) as ("INVESTOR" | "END_USER" | "BOTH" | "UNCLEAR")[];
  if (ct.length === 1) and.push({ clientType: ct[0] });
  else if (ct.length > 1) and.push({ clientType: { in: ct } });

  // Timeline — multi.
  const wi = split(sp.whenInvest) as InvestTimeline[];
  if (wi.length === 1) and.push({ whenCanInvest: wi[0] });
  else if (wi.length > 1) and.push({ whenCanInvest: { in: wi } });

  if (sp.city) and.push({ city: { contains: sp.city, mode: "insensitive" } });
  if (sp.category) and.push({ categorization: { contains: sp.category, mode: "insensitive" } });
  if (sp.tag) and.push({ tags: { contains: sp.tag, mode: "insensitive" } });
  if (sp.team) and.push({ forwardedTeam: sp.team });

  // Source — verbatim sourceRaw, multi.
  const srcs = split(sp.source);
  if (srcs.length === 1) and.push({ sourceRaw: srcs[0] });
  else if (srcs.length > 1) and.push({ sourceRaw: { in: srcs } });

  // Property Type — Residential / Commercial / Mixed Use, multi.
  const ptypes = split(sp.propertyType);
  if (ptypes.length === 1) and.push({ propertyType: ptypes[0] });
  else if (ptypes.length > 1) and.push({ propertyType: { in: ptypes } });

  // Medium — contact channel (Call, WhatsApp, Email, or custom), multi.
  // For custom mediums, we need to check both medium="Other" AND mediumOther field.
  const meds = split(sp.medium);
  if (meds.length) {
    const or: Prisma.LeadWhereInput[] = [];
    for (const m of meds) {
      if (m === "Other") {
        or.push({ medium: "Other", mediumOther: { not: null } });
      } else {
        or.push({ medium: m });
      }
    }
    if (or.length === 1) and.push(or[0]);
    else if (or.length > 1) and.push({ OR: or });
  }

  // Owner — multi, with "unassigned" → ownerId null.
  const owners = split(sp.owner);
  if (owners.length) {
    const real = owners.filter((o) => o !== "unassigned");
    const or: Prisma.LeadWhereInput[] = [];
    if (real.length === 1) or.push({ ownerId: real[0] });
    else if (real.length > 1) or.push({ ownerId: { in: real } });
    if (owners.includes("unassigned")) or.push({ ownerId: null });
    if (or.length === 1) and.push(or[0]);
    else if (or.length > 1) and.push({ OR: or });
  }

  // Project — multi: match any selected project on discussed OR interested units.
  const projects = split(sp.project);
  if (projects.length) {
    and.push({
      OR: projects.flatMap((name) => [
        { discussed: { some: { project: { name: { equals: name } } } } },
        { interestedUnits: { some: { unit: { project: { name: { equals: name } } } } } },
      ]),
    });
  }

  // Budget range — raw numbers (budgetFrom/budgetTo).
  const bFrom = sp.budgetFrom ? parseFloat(sp.budgetFrom) : NaN;
  const bTo = sp.budgetTo ? parseFloat(sp.budgetTo) : NaN;
  const bWhere: { gte?: number; lte?: number } = {};
  if (!isNaN(bFrom)) bWhere.gte = bFrom;
  if (!isNaN(bTo)) bWhere.lte = bTo;
  if (Object.keys(bWhere).length) and.push({ budgetMin: bWhere });

  if (sp.hasMeeting === "1") and.push({ meetingDate: { not: null } });
  if (sp.hasSiteVisit === "1") and.push({ siteVisitDate: { not: null } });

  // Not picking calls — N days: a no-answer call in the window, none connected.
  const np = sp.notPicked ? parseInt(sp.notPicked) : 0;
  if (np && [2, 3, 5, 7, 14].includes(np)) {
    const since = new Date(Date.now() - np * 86_400_000);
    and.push({
      callLogs: {
        some: { outcome: { in: ["NOT_PICKED", "SWITCHED_OFF", "BUSY"] }, startedAt: { gte: since } },
        none: { outcome: { in: ["CONNECTED", "INTERESTED"] }, startedAt: { gte: since } },
      },
    });
  }

  // Follow-up date range.
  const fuFrom = parseDay(sp.followupFrom);
  const fuTo = parseDay(sp.followupTo);
  if (fuFrom || fuTo) {
    const r: { gte?: Date; lte?: Date } = {};
    if (fuFrom) r.gte = fuFrom;
    if (fuTo) r.lte = endOfDay(fuTo);
    and.push({ followupDate: r });
  }

  // Generic date range on a chosen field (created / last activity / follow-up).
  const dFrom = parseDay(sp.dateFrom);
  const dTo = parseDay(sp.dateTo);
  if (dFrom || dTo) {
    const field = sp.dateField === "createdAt" || sp.dateField === "lastTouchedAt" ? sp.dateField : "followupDate";
    const r: { gte?: Date; lte?: Date } = {};
    if (dFrom) r.gte = dFrom;
    if (dTo) r.lte = endOfDay(dTo);
    and.push({ [field]: r } as Prisma.LeadWhereInput);
  }

  return and;
}

/** orderBy for the ?sort= param (LeadFilters "Sort By"). Defaults newest-first. */
export function leadFilterOrderBy(sp: SP): Prisma.LeadOrderByWithRelationInput[] {
  switch (sp.sort) {
    case "created_asc": return [{ createdAt: "asc" }];
    case "touched_asc": return [{ lastTouchedAt: "asc" }];
    case "touched_desc": return [{ lastTouchedAt: "desc" }];
    case "name_asc": return [{ name: "asc" }];
    default: return [{ createdAt: "desc" }];
  }
}
