import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";

// "Previous History Found" — aggregate every prior enquiry from the SAME customer
// (matched by mobile OR email) across ALL sections: Leads, Revival, Master Data,
// and Closed/Archived. DELETED / Recycle-Bin records (deletedAt) are EXCLUDED —
// a recycle-bin record is a recoverable backup, NOT business history, so it must
// never participate in duplicate detection / Previous History Found.

function last10(s?: string | null): string {
  return (s ?? "").replace(/\D/g, "").slice(-10);
}

export type CustomerSection = "Leads" | "Revival" | "Master Data" | "Closed/Archived";

export interface CustomerEnquiry {
  id: string;
  name: string;
  createdAt: string;        // ISO
  section: CustomerSection;
  status: string | null;
  source: string;
  owner: string;
  projects: string[];
  notes: number;
  calls: number;
  activities: number;
  deleted: boolean;
  // Verbatim recent conversation remarks from THIS prior enquiry (newest first).
  remarks: { date: string; text: string; author: string }[];
}

export interface CustomerHistory {
  totalEnquiries: number;   // total matching records (incl. the current one)
  priorCount: number;       // records OTHER than the current lead
  records: CustomerEnquiry[];
  projects: string[];       // distinct project names across all enquiries
  owners: string[];         // distinct owners across all enquiries
}

// Deleted leads are excluded from the query, so "Closed/Archived" now means a
// real CLOSED/LOST terminal status — never "soft-deleted".
function sectionOf(leadOrigin: string | null, currentStatus: string | null): CustomerSection {
  if (currentStatus && TERMINAL_STATUSES.includes(currentStatus)) return "Closed/Archived";
  if (leadOrigin === "REVIVAL" || leadOrigin === "COLD") return "Revival";
  if (leadOrigin === "MASTER_DATA" || leadOrigin === "PORTFOLIO" || leadOrigin === "SYSTEM") return "Master Data";
  return "Leads";
}

/**
 * Returns the customer's full enquiry history, or null when there is no PRIOR
 * record (i.e. only the current lead, or nothing to match on).
 * Pass excludeId = the current lead so "prior" excludes it.
 */
export async function getCustomerHistory(
  phone?: string | null,
  email?: string | null,
  excludeId?: string,
  // Optional confidentiality scope. When passed (from a role-scoped caller via
  // leadScopeWhere), it ALREADY contains deletedAt:null plus the owner/team
  // restriction, so an Agent/Manager never sees other agents'/teams' prior
  // enquiries. When omitted, fall back to the deletedAt:null-only default so
  // existing admin/unscoped callers are unchanged.
  scope?: Prisma.LeadWhereInput,
): Promise<CustomerHistory | null> {
  const p = last10(phone);
  const e = (email ?? "").trim().toLowerCase();
  const OR: Array<Record<string, unknown>> = [];
  if (p.length >= 7) OR.push({ phone: { endsWith: p } }, { altPhone: { endsWith: p } });
  if (e) OR.push({ email: { equals: e, mode: "insensitive" } });
  if (OR.length === 0) return null;

  const leads = await prisma.lead.findMany({
    // deletedAt: null → recycle-bin records NEVER participate in Previous History
    // Found / duplicate detection. Only live records (Active / Revival / Master
    // Data / non-deleted Closed) are returned. When a confidentiality `scope` is
    // supplied it stands in for the deletedAt:null default AND adds the
    // owner/team restriction; otherwise we keep the deletedAt:null-only default.
    where: { AND: [scope ?? { deletedAt: null }, { OR }] },
    select: {
      id: true, name: true, createdAt: true, currentStatus: true, leadOrigin: true,
      source: true, deletedAt: true,
      owner: { select: { name: true } },
      interestedUnits: { select: { unit: { select: { project: { select: { name: true } } } } } },
      discussed: { select: { project: { select: { name: true } } } },
      notes: { select: { body: true, createdAt: true, user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 4 },
      _count: { select: { notes: true, callLogs: true, activities: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  if (leads.length === 0) return null;
  const prior = excludeId ? leads.filter((l) => l.id !== excludeId) : leads;
  if (prior.length === 0) return null; // no PRIOR history — nothing to show

  const records: CustomerEnquiry[] = leads.map((l) => {
    const projects = Array.from(new Set([
      ...l.interestedUnits.map((u) => u.unit?.project?.name).filter(Boolean) as string[],
      ...l.discussed.map((d) => d.project?.name).filter(Boolean) as string[],
    ]));
    return {
      id: l.id,
      name: l.name,
      createdAt: l.createdAt.toISOString(),
      section: sectionOf(l.leadOrigin, l.currentStatus),
      status: l.currentStatus,
      source: l.source,
      owner: l.owner?.name ?? "Unassigned",
      projects,
      notes: l._count.notes,
      calls: l._count.callLogs,
      activities: l._count.activities,
      deleted: !!l.deletedAt,
      remarks: l.notes.map((n) => ({
        date: n.createdAt.toISOString(),
        text: n.body,
        author: n.user?.name ?? "—",
      })),
    };
  });

  return {
    totalEnquiries: leads.length,
    priorCount: prior.length,
    records,
    projects: Array.from(new Set(records.flatMap((r) => r.projects))),
    owners: Array.from(new Set(records.map((r) => r.owner))),
  };
}
