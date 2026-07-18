// =====================================================
// GAMIFICATION — server-only DB-touching helpers
// =====================================================
// All functions here read/write `User.xp / dailyStreak / followupStreak /
// coldCallStreak / lastStreakDay / badges`. Pure constants + the level-lookup
// helper live in `./gamification.ts` so they can also be used from client
// components (XPBar, XPToast).
//
// USAGE — see src/app/api/leads/[id]/log-call/route.ts for the canonical
// fire-and-forget pattern: never block a save on gamification.
//
//   await awardXp(me.id, "CALL_LOGGED").catch(() => {});

import "server-only";
import { prisma } from "@/lib/prisma";
import { excludePendingCallsWhere } from "@/lib/ghosting";
import {
  XP_VALUES,
  XP_LABELS,
  levelForXp,
  parseBadgeIds,
  type XpReason,
  type AwardResult,
  type StreakKind,
  type BadgeId,
} from "@/lib/gamification";

// Re-export client-safe pieces so server code can import everything from
// this one module if it prefers.
export {
  XP_VALUES,
  XP_LABELS,
  LEVELS,
  BADGES,
  levelForXp,
  parseBadgeIds,
  badgesFromIds,
} from "@/lib/gamification";
export type { XpReason, AwardResult, StreakKind, Level, LevelInfo, Badge, BadgeId } from "@/lib/gamification";

// ── IST day key ─────────────────────────────────────────────────────
// Streaks tick at IST midnight (the team is in Dubai/India). Vercel
// runs in UTC; using local "new Date().toDateString()" would roll
// over at the wrong moment. Format matches Prisma's `lastStreakDay`.
const IST = "Asia/Kolkata";
function istDayKey(date: Date = new Date()): string {
  // en-CA gives ISO-style "YYYY-MM-DD" by default — easiest sortable form.
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: IST,
  }).format(date);
}

/** "YYYY-MM-DD" → Date at IST midnight (UTC instant of that moment). */
function istDayKeyToDate(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const ms = Date.parse(`${key}T00:00:00+05:30`);
  return isNaN(ms) ? null : new Date(ms);
}

/** Days between two IST day keys (positive integer). */
function istDayDiff(fromKey: string, toKey: string): number {
  const a = istDayKeyToDate(fromKey);
  const b = istDayKeyToDate(toKey);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// ── Award XP ────────────────────────────────────────────────────────
/**
 * Award XP for an action. Caller should fire-and-forget — never await this
 * in the hot path of a user-facing save. Failures are swallowed silently
 * (gamification must never break a real CRM action).
 */
export async function awardXp(userId: string, reason: XpReason): Promise<AwardResult | null> {
  const amount = XP_VALUES[reason];
  if (!amount) return null;
  try {
    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { xp: true },
    });
    if (!before) return null;
    const oldXp = before.xp ?? 0;
    const newXp = oldXp + amount;
    const oldLevel = levelForXp(oldXp).level.name;
    const newLevel = levelForXp(newXp).level.name;
    await prisma.user.update({
      where: { id: userId },
      data: { xp: { increment: amount } },
    });
    // Badge check is fire-and-forget too — never blocks the XP write.
    checkAndAwardBadges(userId).catch(() => {});
    return {
      newXp,
      oldLevel,
      newLevel,
      leveledUp: oldLevel !== newLevel,
      awarded: amount,
      reason,
      label: XP_LABELS[reason],
    };
  } catch {
    return null;
  }
}

// ── Streaks ─────────────────────────────────────────────────────────
const STREAK_FIELDS: Record<StreakKind, "dailyStreak" | "followupStreak" | "coldCallStreak"> = {
  daily: "dailyStreak",
  followup: "followupStreak",
  coldCall: "coldCallStreak",
};

/**
 * Bump a streak. IST-day-aware:
 *   • same day  → no-op (streak already counted today)
 *   • 1 day gap → increment
 *   • >1 day    → reset to 1
 *   • never bumped → set to 1
 *
 * Updates `lastStreakDay` on the SAME write so the day-key is shared across
 * streak kinds — meaning the user's "active day" is a single calendar concept,
 * not one per streak. This is what Lalit asked for: "consistency beast" is a
 * login streak, not three separate ones.
 */
export async function bumpStreak(userId: string, kind: StreakKind): Promise<number | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { dailyStreak: true, followupStreak: true, coldCallStreak: true, lastStreakDay: true },
    });
    if (!user) return null;
    const today = istDayKey();
    const field = STREAK_FIELDS[kind];
    const current = (user[field] as number) ?? 0;

    let next: number;
    if (!user.lastStreakDay) {
      next = 1;
    } else if (user.lastStreakDay === today) {
      // Already counted today for SOME streak — but this specific streak may
      // not have ticked yet (e.g. daily login already bumped, now logging
      // the first follow-up of the day). Keep the current value if >0, else 1.
      next = current > 0 ? current : 1;
    } else {
      const gap = istDayDiff(user.lastStreakDay, today);
      if (gap === 1) next = current + 1;
      else if (gap <= 0) next = current > 0 ? current : 1;  // clock skew safety
      else next = 1;                                         // missed ≥1 day
    }
    await prisma.user.update({
      where: { id: userId },
      data: { [field]: next, lastStreakDay: today },
    });
    return next;
  } catch {
    return null;
  }
}

// ── Badges ──────────────────────────────────────────────────────────
/**
 * Scan the user's activity and award any badges they newly qualify for.
 * Idempotent — already-earned badges are skipped via parseBadgeIds().
 * Runs after every awardXp() (fire-and-forget). Queries are kept cheap
 * via count(); none of them aggregate large windows so this is fine
 * to invoke per-call-log.
 */
export async function checkAndAwardBadges(userId: string): Promise<BadgeId[]> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { badges: true, followupStreak: true, dailyStreak: true },
    });
    if (!user) return [];
    const have = new Set(parseBadgeIds(user.badges));
    const newly: BadgeId[] = [];

    // Helper: only run the query if the badge isn't already earned.
    const need = (id: BadgeId) => !have.has(id);

    // Cold Hunter — 50+ cold calls logged. We count CallLogs where the lead
    // is/was a cold prospect. Cold flag flips when promoted, so we look at
    // the activity log (COLD_TO_LEAD) + raw cold-call CallLogs as a proxy.
    if (need("cold_hunter")) {
      const cold = await prisma.callLog.count({
        where: { ...excludePendingCallsWhere(), userId, lead: { isColdCall: true, deletedAt: null } },
      });
      if (cold >= 50) newly.push("cold_hunter");
    }

    // Revival King — 10 cold-to-lead promotions by this user.
    if (need("revival_king")) {
      const promotions = await prisma.activity.count({
        where: { userId, type: "COLD_TO_LEAD", lead: { deletedAt: null } },
      });
      if (promotions >= 10) newly.push("revival_king");
    }

    // Calling Machine — 100 calls in a single IST day (look at today + the
    // last 7 days; if any single day clears 100, award).
    if (need("calling_machine")) {
      const since = new Date(Date.now() - 8 * 86_400_000);
      const rows = await prisma.callLog.findMany({
        where: { ...excludePendingCallsWhere(), userId, startedAt: { gte: since } },
        select: { startedAt: true },
      });
      const perDay = new Map<string, number>();
      for (const r of rows) {
        const k = istDayKey(r.startedAt);
        perDay.set(k, (perDay.get(k) ?? 0) + 1);
      }
      const peak = Math.max(0, ...perDay.values());
      if (peak >= 100) newly.push("calling_machine");
    }

    // Follow-Up Master — 10-day follow-up streak.
    if (need("followup_master") && (user.followupStreak ?? 0) >= 10) {
      newly.push("followup_master");
    }

    // Site Visit Specialist — 5 SITE_VISIT activities completed.
    if (need("site_visit_specialist")) {
      const visits = await prisma.activity.count({
        where: { userId, type: "SITE_VISIT", status: "DONE" },
      });
      if (visits >= 5) newly.push("site_visit_specialist");
    }

    // Meeting Maker — 20 office/virtual meetings created (planned or done).
    if (need("meeting_maker")) {
      const meetings = await prisma.activity.count({
        where: { userId, type: { in: ["OFFICE_MEETING", "VIRTUAL_MEETING"] } },
      });
      if (meetings >= 20) newly.push("meeting_maker");
    }

    // Consistency Beast — 30-day login streak.
    if (need("consistency_beast") && (user.dailyStreak ?? 0) >= 30) {
      newly.push("consistency_beast");
    }

    // Note: "fastest_responder" + "monthly_closer" require external signals
    // (response-time tracking / month-over-month rankings) — they're awarded
    // by dedicated jobs, not by this per-action check.

    if (newly.length === 0) return [];
    const merged = [...have, ...newly];
    await prisma.user.update({
      where: { id: userId },
      data: { badges: merged.join(",") },
    });
    return newly;
  } catch {
    return [];
  }
}
