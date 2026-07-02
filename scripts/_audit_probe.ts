// READ-ONLY audit probe — NO writes. Delete after use.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// Mirror of lead-statuses.ts TERMINAL_STATUSES (CLOSED + LOST).
const CLOSED_OUTCOME_STATUSES = [
  "Booked With Us", "Booked with Us",
  "Sell Out", "Sell Off",
  "Leasing", "Rent Out",
  "Already Bought", "Already Booked",
  "Commercial Investment",
  "Purchased Elsewhere", "Booked Through Another Channel",
];
const LOST_STATUSES = [
  "Not Interested", "War Fear", "Funds Issue", "Not Able To Buy",
  "Broker", "Visited With Other Broker", "In Touch With Another Broker",
  "Other Location", "Other Requirement", "Low Budget", "Just Searching",
  "Drop The Plan", "Number Changed", "Invalid Number",
  "Never Respond Phone Calls", "Never Respond Phone calls",
  "Never Responding", "Pass Away",
  "Junk", "Blocked Me", "By Mistake Inquiry",
  "Other",
];
const TERMINAL_STATUSES = [...CLOSED_OUTCOME_STATUSES, ...LOST_STATUSES];

const PLACEHOLDER_PHONES = new Set(["9999999999", "0000000000", "1111111111", "1234567890", "1231231234", "0123456789"]);
function last10(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.slice(-10);
}

function ids(arr: { id: string }[], n = 5) { return arr.slice(0, n).map(x => x.id); }

async function main() {
  const out: Record<string, unknown> = {};

  // Baselines
  const totalActive = await prisma.lead.count({ where: { deletedAt: null } });
  const totalAll = await prisma.lead.count();
  out.baseline = { totalActive, totalAll };

  // 1. deletedAt=null AND market=null AND forwardedTeam not null
  const c1where = { deletedAt: null, market: null, forwardedTeam: { not: null } };
  const c1 = await prisma.lead.count({ where: c1where as any });
  const c1s = await prisma.lead.findMany({ where: c1where as any, select: { id: true, forwardedTeam: true, budgetCurrency: true }, take: 5 });
  out.check1 = { count: c1, samples: c1s };

  // 2. terminal status BUT followupDate not null
  const c2where = { deletedAt: null, currentStatus: { in: TERMINAL_STATUSES }, followupDate: { not: null } };
  const c2 = await prisma.lead.count({ where: c2where as any });
  const c2s = await prisma.lead.findMany({ where: c2where as any, select: { id: true, currentStatus: true, followupDate: true }, take: 5 });
  out.check2 = { count: c2, samples: c2s };

  // 3. duplicate active phones (normalize last-10, exclude placeholders/null)
  const activePhoned = await prisma.lead.findMany({
    where: { deletedAt: null, phone: { not: null } },
    select: { id: true, phone: true },
  });
  const groups = new Map<string, string[]>();
  for (const l of activePhoned) {
    const k = last10(l.phone);
    if (!k || PLACEHOLDER_PHONES.has(k)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(l.id);
  }
  const dupGroups = [...groups.entries()].filter(([, v]) => v.length > 1);
  dupGroups.sort((a, b) => b[1].length - a[1].length);
  const totalDupLeads = dupGroups.reduce((s, [, v]) => s + v.length, 0);
  out.check3 = {
    dupGroupCount: dupGroups.length,
    totalActiveLeadsInDupGroups: totalDupLeads,
    top5Groups: dupGroups.slice(0, 5).map(([k, v]) => ({ phoneLast10: k.slice(0, 3) + "***" + k.slice(-2), size: v.length, ids: v.slice(0, 5) })),
  };

  // 4. ownerId not null but assignedAt null
  const c4where = { deletedAt: null, ownerId: { not: null }, assignedAt: null };
  const c4 = await prisma.lead.count({ where: c4where as any });
  const c4s = await prisma.lead.findMany({ where: c4where as any, select: { id: true, ownerId: true, createdAt: true, leadOrigin: true }, take: 5 });
  out.check4 = { count: c4, samples: c4s };

  // 5. rejectedAt not null BUT ownerId not null
  const c5where = { rejectedAt: { not: null }, ownerId: { not: null } };
  const c5all = await prisma.lead.count({ where: c5where as any });
  const c5active = await prisma.lead.count({ where: { ...c5where, deletedAt: null } as any });
  const c5s = await prisma.lead.findMany({ where: { ...c5where, deletedAt: null } as any, select: { id: true, currentStatus: true, ownerId: true, previousOwnerId: true, rejectedAt: true }, take: 5 });
  out.check5 = { countAll: c5all, countActive: c5active, samplesActive: c5s };

  // 6. reEngage pair mismatch (one set, other null)
  const c6aWhere = { reEngageAt: { not: null }, reEngageOwnerId: null };
  const c6bWhere = { reEngageAt: null, reEngageOwnerId: { not: null } };
  const c6a = await prisma.lead.count({ where: c6aWhere as any });
  const c6b = await prisma.lead.count({ where: c6bWhere as any });
  const c6as = await prisma.lead.findMany({ where: c6aWhere as any, select: { id: true, reEngageAt: true }, take: 5 });
  const c6bs = await prisma.lead.findMany({ where: c6bWhere as any, select: { id: true, reEngageOwnerId: true }, take: 5 });
  const c6total = await prisma.lead.count({ where: { OR: [{ reEngageAt: { not: null } }, { reEngageOwnerId: { not: null } }] } });
  out.check6 = { atSetOwnerNull: { count: c6a, samples: c6as }, ownerSetAtNull: { count: c6b, samples: c6bs }, anyReEngageSet: c6total };

  // 7. chronic overdue: followupDate < 30 days ago, workable (non-terminal), ownerId not null, active
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const c7where = {
    deletedAt: null,
    ownerId: { not: null },
    followupDate: { lt: cutoff, not: null },
    NOT: { currentStatus: { in: TERMINAL_STATUSES } },
  };
  const c7 = await prisma.lead.count({ where: c7where as any });
  const c7s = await prisma.lead.findMany({ where: c7where as any, select: { id: true, currentStatus: true, followupDate: true, ownerId: true }, orderBy: { followupDate: "asc" }, take: 5 });
  out.check7 = { count: c7, cutoff: cutoff.toISOString(), samples: c7s };

  // 8. market/team mismatch: forwardedTeam Dubai but market India, or forwardedTeam India but market UAE
  const c8aWhere = { deletedAt: null, forwardedTeam: "Dubai", market: "India" };
  const c8bWhere = { deletedAt: null, forwardedTeam: "India", market: "UAE" };
  const c8a = await prisma.lead.count({ where: c8aWhere as any });
  const c8b = await prisma.lead.count({ where: c8bWhere as any });
  const c8as = await prisma.lead.findMany({ where: c8aWhere as any, select: { id: true, forwardedTeam: true, market: true, budgetCurrency: true }, take: 5 });
  const c8bs = await prisma.lead.findMany({ where: c8bWhere as any, select: { id: true, forwardedTeam: true, market: true, budgetCurrency: true }, take: 5 });
  // Also currency vs market mismatch
  const c8cWhere = { deletedAt: null, budgetCurrency: "INR", market: "UAE" };
  const c8dWhere = { deletedAt: null, budgetCurrency: "AED", market: "India" };
  const c8c = await prisma.lead.count({ where: c8cWhere as any });
  const c8d = await prisma.lead.count({ where: c8dWhere as any });
  out.check8 = {
    dubaiTeam_indiaMarket: { count: c8a, samples: c8as },
    indiaTeam_uaeMarket: { count: c8b, samples: c8bs },
    inrCurrency_uaeMarket: c8c,
    aedCurrency_indiaMarket: c8d,
  };

  // 9. CallLog startedAt null (schema has default now() + non-null, so should be 0)
  const clNullStarted = await prisma.callLog.count({ where: { startedAt: null } as any }).catch(() => -1);
  const clTotal = await prisma.callLog.count();
  // Activity: completed status but no completedAt; or COMPLETED w/ scheduledAt in future impossible? cheap check:
  const actCompletedNoTs = await prisma.activity.count({ where: { status: "COMPLETED", completedAt: null } as any }).catch(() => -1);
  const actTotal = await prisma.activity.count();
  const actNoShowButCompleted = await prisma.activity.count({ where: { isNoShow: true, status: "COMPLETED" } as any }).catch(() => -1);
  out.check9 = { callLogStartedAtNull: clNullStarted, callLogTotal: clTotal, activityCompletedNoCompletedAt: actCompletedNoTs, activityTotal: actTotal, activityNoShowButCompleted: actNoShowButCompleted };

  // 10. Users
  const activeAgents = await prisma.user.count({ where: { role: "AGENT", active: true } });
  const allAgents = await prisma.user.count({ where: { role: "AGENT" } });
  const agentHrOnly = await prisma.user.findMany({ where: { role: "AGENT", hrOnly: true }, select: { id: true, name: true, email: true, active: true } });
  const totalActiveUsers = await prisma.user.count({ where: { active: true } });
  // duplicate emails (email is @unique so should be 0, but check case-insensitive dups)
  const allUsers = await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, active: true } });
  const emailMap = new Map<string, string[]>();
  for (const u of allUsers) {
    const k = (u.email || "").trim().toLowerCase();
    if (!k) continue;
    if (!emailMap.has(k)) emailMap.set(k, []);
    emailMap.get(k)!.push(u.id);
  }
  const dupEmails = [...emailMap.entries()].filter(([, v]) => v.length > 1);
  out.check10 = {
    activeAgents, allAgents, totalActiveUsers,
    agentRoleButHrOnly: { count: agentHrOnly.length, samples: agentHrOnly },
    caseInsensitiveDupEmails: dupEmails.map(([e, v]) => ({ email: e, ids: v })),
  };

  console.log(JSON.stringify(out, null, 2));
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error("PROBE_ERROR", e); await prisma.$disconnect(); process.exit(1); });
