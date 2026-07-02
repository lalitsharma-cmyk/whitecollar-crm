import "server-only";
// AI Sales OS — L1 context builder (M1). Maps a live Lead + its computed state into
// the pure AiLeadContext the M0 analyzer reads. READ-ONLY: it only reads, never
// writes. Reuses the CRM's own canonical helpers (terminal statuses, the overdue
// boundary) so the AI never invents its own definitions — it reasons over the same
// truth the rest of the CRM does.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { prisma } from "@/lib/prisma";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";
import { overdueFollowupBoundary, istDayRange } from "@/lib/datetime";
import type { AiLeadContext } from "./analyze";

/** Build the read-only AI context for one lead, or null if it doesn't exist. */
export async function buildLeadContext(leadId: string): Promise<AiLeadContext | null> {
  const { start: todayStart } = istDayRange();
  const overdueBoundary = overdueFollowupBoundary();

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, name: true, currentStatus: true, followupDate: true, aiScore: true,
      ownerId: true, lastTouchedAt: true, rejectedAt: true, deletedAt: true,
      // a real client touch logged TODAY (IST) — a call started today counts.
      callLogs: { where: { startedAt: { gte: todayStart } }, select: { id: true }, take: 1 },
    },
  });
  if (!lead || lead.deletedAt) return null;

  const isTerminal =
    !!lead.rejectedAt ||
    (lead.currentStatus != null && (TERMINAL_STATUSES as readonly string[]).includes(lead.currentStatus));

  const followupOverdue = !isTerminal && lead.followupDate != null && lead.followupDate < overdueBoundary;
  const followupMissing = !isTerminal && lead.followupDate == null;
  const contactedToday = lead.callLogs.length > 0;
  const daysSinceLastTouch = lead.lastTouchedAt
    ? Math.floor((Date.now() - lead.lastTouchedAt.getTime()) / 86_400_000)
    : null;

  return {
    id: lead.id,
    name: lead.name,
    currentStatus: lead.currentStatus,
    isTerminal,
    followupOverdue,
    followupMissing,
    isHot: lead.aiScore === "HOT",
    contactedToday,
    ownerId: lead.ownerId,
    daysSinceLastTouch,
  };
}
