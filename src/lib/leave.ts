import "server-only";
// ────────────────────────────────────────────────────────────────────────────
// General agent leave-cover (#16 — Lalit, 2026-07-02) — IO wrapper.
//
// When an agent is marked "on leave", NO new lead auto-assigns to them: the
// resolved auto-assignee is redirected to a cover. Purely ADDITIVE + REVERSIBLE —
// it only changes behavior when the resolved auto-target is on leave; otherwise a
// strict passthrough to resolveTeamAutoAssignee (the fixed team rule). EXISTING
// leads are never reassigned — this governs NEW-lead auto-assignment only.
//
// The pure decision + parsing live in leaveCover.ts (unit-tested); this file adds
// the DB/setting IO. STORAGE: the `agentsOnLeave` Setting = a JSON array of
// { userId, until } where `until` is an INCLUSIVE IST day "YYYY-MM-DD"; entries
// auto-expire after that day (compared to the IST date AT RUNTIME on the server),
// so "on leave today" self-clears. Reversible: clear the setting / drop an entry.
// ────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { resolveTeamAutoAssignee } from "@/lib/teamAutoAssign";
import { resolveManagerUserId } from "@/lib/agentStatus";
import { istDateKey } from "@/lib/datetime";
import { normalizeTeam, type Team } from "@/lib/teamRouting";
import { parseLeaveEntries, entriesInEffect, pickCoverAssignee, type LeaveEntry } from "@/lib/leaveCover";

export const AGENTS_ON_LEAVE_KEY = "agentsOnLeave";
export type { LeaveEntry };

/** Entries still IN EFFECT for `now` (IST): until >= today (inclusive). */
export async function getOnLeaveEntries(now: Date = new Date()): Promise<LeaveEntry[]> {
  const raw = await getSetting(AGENTS_ON_LEAVE_KEY);
  return entriesInEffect(parseLeaveEntries(raw), istDateKey(now));
}

/** Set of userIds currently on leave (IST-today aware). */
export async function getOnLeaveAgentIds(now: Date = new Date()): Promise<Set<string>> {
  return new Set((await getOnLeaveEntries(now)).map((e) => e.userId));
}

/**
 * The agent a NEW lead for `team` should auto-assign to, honoring leave-cover.
 * Passthrough to resolveTeamAutoAssignee when the target is NOT on leave (no
 * behavior change on the common path). `onLeaveOverride` lets tests inject the
 * on-leave set deterministically; production omits it (reads the setting).
 */
export async function resolveActiveAssignee(
  team: Team | string | null | undefined,
  now: Date = new Date(),
  onLeaveOverride?: Set<string>,
): Promise<string | null> {
  const target = resolveTeamAutoAssignee(team, now);
  if (!target) return null;

  const onLeave = onLeaveOverride ?? (await getOnLeaveAgentIds(now));
  if (!onLeave.has(target)) return target; // ── common path: strict passthrough ──

  // Target is on leave → gather same-team candidates + the manager, then decide.
  const t: Team | null = normalizeTeam(team);
  const teammates = t
    ? (await prisma.user.findMany({
        where: { active: true, hrOnly: false, team: t, role: { in: ["AGENT", "MANAGER"] } },
        select: { id: true },
        orderBy: { name: "asc" },
      })).map((u) => u.id)
    : [];
  const managerId = await resolveManagerUserId();
  return pickCoverAssignee(target, onLeave, teammates, managerId);
}
