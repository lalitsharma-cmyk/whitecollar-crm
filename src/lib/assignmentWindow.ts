// Time-window-aware lead assignment.
//
// Office hours (IST):
//   10:00–19:00  → Round-robin to PRESENT/LATE agents of the lead's team
//   19:00–22:00  → Direct to Lalit Sharma (admin) — he handles evening leads
//   22:00–10:00  → No assignment (returns null). Caller should:
//                    1. Queue lead for admin's 15-min morning window
//                    2. Trigger auto-WhatsApp from company number
//
// Falls back to any present admin if Lalit isn't found / not present.
// Falls back to all active agents if NO agent on the team is present today.

import { prisma } from "@/lib/prisma";
import { hourIST, presentAgentIdsToday } from "@/lib/attendance";
import { pickRoundRobinAgent } from "@/lib/assignment";

export type Window =
  | { kind: "OFFICE_RR"; reason: "office-hours round-robin" }
  | { kind: "EVENING_LALIT"; reason: "after-hours → escalate to Lalit" }
  | { kind: "OVERNIGHT_QUEUE"; reason: "overnight → queue for morning + auto-WA" };

export function currentWindow(now: Date = new Date()): Window {
  const h = hourIST(now);
  if (h >= 10 && h < 19) return { kind: "OFFICE_RR", reason: "office-hours round-robin" };
  if (h >= 19 && h < 22) return { kind: "EVENING_LALIT", reason: "after-hours → escalate to Lalit" };
  return { kind: "OVERNIGHT_QUEUE", reason: "overnight → queue for morning + auto-WA" };
}

export interface AssignResult {
  userId: string | null;
  window: Window;
  fallbackReason?: string;
}

/**
 * Chooses the right owner for a NEW lead based on time-of-day + team
 * + who's present. Returns userId or null.
 */
export async function chooseOwnerForNewLead(team?: string | null, now: Date = new Date()): Promise<AssignResult> {
  const w = currentWindow(now);

  if (w.kind === "OFFICE_RR") {
    // Round-robin from agents who marked present in this team
    const presentIds = await presentAgentIdsToday(team ?? undefined);
    if (presentIds.length > 0) {
      // Reuse the existing pickRoundRobinAgent but constrained to present agents.
      // Strategy: pick the present agent with the fewest open leads (lightest load).
      const agents = await prisma.user.findMany({
        where: { id: { in: presentIds }, active: true, role: { in: ["AGENT", "MANAGER"] } },
        include: { _count: { select: { ownedLeads: { where: { status: { notIn: ["WON", "LOST"] } } } } } },
      });
      if (agents.length > 0) {
        agents.sort((a, b) => a._count.ownedLeads - b._count.ownedLeads);
        return { userId: agents[0].id, window: w };
      }
    }
    // Fallback: nobody present → fall through to the legacy RR (any active agent)
    const fallback = await pickRoundRobinAgent({ team: team ?? undefined });
    return { userId: fallback?.id ?? null, window: w, fallbackReason: "no agents marked present today" };
  }

  if (w.kind === "EVENING_LALIT") {
    // Find Lalit by email (most reliable). Fall back to any admin.
    const lalit = await prisma.user.findFirst({
      where: { email: { contains: "lalit", mode: "insensitive" }, role: "ADMIN", active: true },
    });
    if (lalit) return { userId: lalit.id, window: w };
    const anyAdmin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true } });
    return { userId: anyAdmin?.id ?? null, window: w, fallbackReason: "Lalit not found, used first active admin" };
  }

  // OVERNIGHT_QUEUE — explicit "do not assign yet"
  return { userId: null, window: w };
}
