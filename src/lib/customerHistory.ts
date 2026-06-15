import { prisma } from "@/lib/prisma";

// "Previous History Found" — aggregate every prior enquiry from the SAME customer
// (matched by mobile OR email) across ALL sections: Leads, Revival, Master Data,
// and Closed/Archived (soft-deleted). One customer can enquire many times; this
// surfaces the full history so a re-enquiry is never a blind duplicate.

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
}

export interface CustomerHistory {
  totalEnquiries: number;   // total matching records (incl. the current one)
  priorCount: number;       // records OTHER than the current lead
  records: CustomerEnquiry[];
  projects: string[];       // distinct project names across all enquiries
  owners: string[];         // distinct owners across all enquiries
}

function sectionOf(leadOrigin: string | null, deletedAt: Date | null): CustomerSection {
  if (deletedAt) return "Closed/Archived";
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
): Promise<CustomerHistory | null> {
  const p = last10(phone);
  const e = (email ?? "").trim().toLowerCase();
  const OR: Array<Record<string, unknown>> = [];
  if (p.length >= 7) OR.push({ phone: { endsWith: p } }, { altPhone: { endsWith: p } });
  if (e) OR.push({ email: { equals: e, mode: "insensitive" } });
  if (OR.length === 0) return null;

  const leads = await prisma.lead.findMany({
    where: { OR },
    select: {
      id: true, name: true, createdAt: true, currentStatus: true, leadOrigin: true,
      source: true, deletedAt: true,
      owner: { select: { name: true } },
      interestedUnits: { select: { unit: { select: { project: { select: { name: true } } } } } },
      discussed: { select: { project: { select: { name: true } } } },
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
      section: sectionOf(l.leadOrigin, l.deletedAt),
      status: l.currentStatus,
      source: l.source,
      owner: l.owner?.name ?? "Unassigned",
      projects,
      notes: l._count.notes,
      calls: l._count.callLogs,
      activities: l._count.activities,
      deleted: !!l.deletedAt,
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
