import "server-only";
import { prisma } from "@/lib/prisma";
import { Role, type LeadSource } from "@prisma/client";
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";

/**
 * Round-robin assignment: pick the active AGENT (or MANAGER) with the
 * fewest currently-owned, non-suppressed leads. Tie-break by oldest
 * assignment timestamp so everyone takes turns.
 */
export async function pickRoundRobinAgent(opts?: { team?: string; source?: LeadSource }) {
  const candidates = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: [Role.AGENT, Role.MANAGER] },
      ...(opts?.team ? { team: opts.team } : {}),
    },
    include: {
      _count: {
        select: {
          ownedLeads: { where: { currentStatus: { notIn: SUPPRESSED_STATUSES } } },
        },
      },
      assignments: { orderBy: { assignedAt: "desc" }, take: 1 },
    },
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const d = a._count.ownedLeads - b._count.ownedLeads;
    if (d !== 0) return d;
    const at = a.assignments[0]?.assignedAt?.getTime() ?? 0;
    const bt = b.assignments[0]?.assignedAt?.getTime() ?? 0;
    return at - bt; // older assignment = next up
  });
  return candidates[0];
}

export function fingerprintFor(phone?: string | null, email?: string | null) {
  const p = (phone ?? "").replace(/\D/g, "");
  const e = (email ?? "").toLowerCase().trim();
  if (!p && !e) return null;
  return `${p}|${e}`;
}
