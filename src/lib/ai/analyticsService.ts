import "server-only";
// AI Sales OS — Coach/Analyst/BI IO wrapper (M5), READ-ONLY. Loads live WORKABLE leads
// and computes each digest flag with the CRM's OWN canonical helpers (terminal statuses,
// overdue boundary, IST day, resolveMarket) so the digest matches what the rest of the
// CRM shows — then runs the pure analytics core. Never writes.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { prisma } from "@/lib/prisma";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";
import { overdueFollowupBoundary, istDayRange } from "@/lib/datetime";
import { resolveMarket } from "@/lib/market";
import { buildDailyDigest, type DigestLead, type DailyDigest, type DigestMarket } from "./analytics";

const STALL_DAYS = 7;
const asMkt = (m: string | null): DigestMarket | null => (m === "India" || m === "UAE" ? m : null);

/** Read-only team daily digest (pipeline health + coaching nudges + top risks).
 *  Optionally scoped to one market. Loads only workable leads (terminal excluded at
 *  the DB level), so `isTerminal` is false by construction. */
export async function buildTeamDigest(opts: { market?: DigestMarket; limit?: number } = {}): Promise<DailyDigest> {
  const { start: todayStart } = istDayRange();
  const overdueBoundary = overdueFollowupBoundary();
  const staleBefore = new Date(todayStart.getTime() - STALL_DAYS * 86_400_000);

  const leads = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      rejectedAt: null,
      currentStatus: { notIn: TERMINAL_STATUSES },
      ...(opts.market
        ? { OR: [{ market: opts.market }, { forwardedTeam: opts.market === "India" ? "India" : "Dubai" }] }
        : {}),
    },
    select: {
      id: true, market: true, forwardedTeam: true, budgetCurrency: true,
      ownerId: true, aiScore: true, followupDate: true, lastTouchedAt: true, createdAt: true,
      owner: { select: { name: true } },
      callLogs: { where: { startedAt: { gte: todayStart } }, select: { id: true }, take: 1 },
    },
    take: opts.limit ?? 5000,
  });

  const digestLeads: DigestLead[] = leads.map((l) => {
    const contactedToday = l.callLogs.length > 0;
    return {
      id: l.id,
      market: asMkt(resolveMarket(l)),
      ownerId: l.ownerId,
      ownerName: l.owner?.name ?? null,
      isTerminal: false, // pre-filtered at the query
      followupOverdue: l.followupDate != null && l.followupDate < overdueBoundary,
      hotUncontacted: l.aiScore === "HOT" && !contactedToday,
      stalled: l.lastTouchedAt != null && l.lastTouchedAt < staleBefore,
      freshToday: l.createdAt >= todayStart,
    };
  });

  return buildDailyDigest(digestLeads);
}
