// =====================================================
// QUALITY SCORE — composite 0-100 per-agent performance signal
// =====================================================
// Source of truth: docs/SPEC-quality-score.md (Agent L). This file is the
// concrete implementation of that spec.
//
// Three of the four axes are "objective" — derived from CallLog, Activity,
// Lead. The fourth (Wellbeing) blends Attendance + DailyMood + streak data
// and is PRIVATE — only the agent themselves or admins see it broken out.
// Managers see the composite total but NOT the wellbeing sub-score (per
// spec §4 — "do not show axis-D to anyone except the agent themselves").
//
// Weights from spec §2:
//   Activity 30%, Funnel 35%, Behavioural 25%, Wellbeing 10%.
// When `excludeWellbeing: true` (manager view of a report), the 10pt wellbeing
// weight is REDISTRIBUTED pro-rata across the other 3 axes so the total still
// scales to 100. Wellbeing field in the breakdown returns null in that case.
//
// Each sub-metric is normalised to 0-100. Where the spec calls for P10/P90
// team-wide normalisation we use simpler clamp-to-target ratios — Lalit's
// team is 5-15 agents, percentile bands are noisy at that scale. The bands
// can be revisited once the team passes ~30 agents.

import "server-only";
import { prisma } from "@/lib/prisma";
import {
  AttendanceStatus,
  ActivityStatus,
  ActivityType,
  AIScore,
  BantStatus,
  CallOutcome,
  Mood,
} from "@prisma/client";
import { BOOKED_STATUSES, ACTIVE_PURSUIT_STATUSES } from "@/lib/lead-statuses";

// ────────────────────────────────────────────────────────────────────
// PUBLIC TYPES
// ────────────────────────────────────────────────────────────────────

export type QualityWindow = "today" | "week" | "month";
export type QualityAxis = "activity" | "funnel" | "behavioural" | "wellbeing";

export interface QualityBreakdown {
  /** 0-100 — execution quality (connect rate, call volume vs target, follow-up completion). */
  activity: number;
  /** 0-100 — funnel quality (BANT qualification, conversion to WON, deal value). */
  funnel: number;
  /** 0-100 — behavioural quality (follow-up adherence, no-shows, hot-lead SLA). */
  behavioural: number;
  /**
   * 0-100 — wellbeing (attendance, mood trend, streak). NULL when the caller
   * passed `excludeWellbeing: true` (manager view — privacy line per spec).
   */
  wellbeing: number | null;
  /** Weighted total 0-100. */
  total: number;
  /** Optional rank among all eligible agents in the same window (1 = best). */
  rank?: number;
}

// ────────────────────────────────────────────────────────────────────
// WEIGHTS
// ────────────────────────────────────────────────────────────────────

const WEIGHTS = {
  activity: 30,
  funnel: 35,
  behavioural: 25,
  wellbeing: 10,
} as const;

// When wellbeing is excluded, redistribute its 10pt pro-rata to the other 3.
// 30 : 35 : 25 → each gets 10 × (its_weight / 90).
const WEIGHTS_NO_WELLBEING = {
  activity: WEIGHTS.activity + (10 * WEIGHTS.activity) / 90,
  funnel: WEIGHTS.funnel + (10 * WEIGHTS.funnel) / 90,
  behavioural: WEIGHTS.behavioural + (10 * WEIGHTS.behavioural) / 90,
};

// ────────────────────────────────────────────────────────────────────
// WINDOW → DATE RANGE
// ────────────────────────────────────────────────────────────────────

function windowStart(w: QualityWindow): Date {
  const now = new Date();
  if (w === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (w === "week") {
    // Rolling 7 days — matches spec §3 "Rolling 7 days" lens.
    return new Date(now.getTime() - 7 * 24 * 3600_000);
  }
  // month — calendar-month-to-date (matches dashboard "this month" tiles).
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Number of calendar days the window covers (used for per-day normalisation). */
function windowDays(w: QualityWindow): number {
  if (w === "today") return 1;
  if (w === "week") return 7;
  const now = new Date();
  // days elapsed in the current calendar month including today
  return Math.max(1, now.getDate());
}

// ────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const pct = (num: number, den: number) => (den <= 0 ? 0 : clamp((num / den) * 100));
/** Average a list of numbers (ignoring NaN / null). Returns 0 on empty. */
function meanOf(xs: Array<number | null | undefined>): number {
  const filtered = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (filtered.length === 0) return 0;
  let s = 0;
  for (const x of filtered) s += x;
  return s / filtered.length;
}

/** Mood enum mapped to 1-5 for trend averaging (spec axis D). */
const MOOD_TO_SCORE: Record<Mood, number> = {
  FRUSTRATING: 1,
  NOT_GREAT: 2,
  MIXED: 3,
  LOOKS_GOOD: 4,
  AWESOME: 5,
};

// ────────────────────────────────────────────────────────────────────
// AXIS COMPUTATIONS
// ────────────────────────────────────────────────────────────────────

/**
 * Activity axis — how well did they execute calls.
 * Composite of:
 *   • connect_rate       — connects / total calls, normalised to dailyConnectTarget/dailyCallTarget
 *                          benchmark (≥ target = 100; 0 = 0). Aligned to mission board 10/30 = 33%.
 *   • calls_vs_target    — avg-per-day actual vs User.dailyCallTarget (0-100, capped)
 *   • followup_completion — Activity DONE / (DONE + OVERDUE + PLANNED-past) for type=CALL/TASK
 */
async function computeActivity(
  userId: string,
  start: Date,
  days: number,
  dailyCallTarget: number,
  dailyConnectTarget: number,
): Promise<number> {
  const now = new Date();

  const [totalCalls, connectedCalls, followupGroups] = await Promise.all([
    prisma.callLog.count({ where: { userId, startedAt: { gte: start } } }),
    prisma.callLog.count({
      where: {
        userId,
        startedAt: { gte: start },
        outcome: { in: [CallOutcome.CONNECTED, CallOutcome.INTERESTED] },
      },
    }),
    prisma.activity.groupBy({
      by: ["status"],
      where: {
        userId,
        type: { in: [ActivityType.TASK, ActivityType.CALL] },
        scheduledAt: { gte: start, lte: now },
      },
      _count: { _all: true },
    }),
  ]);

  // Connect rate — normalised against the daily connect/call target ratio (e.g. 10/30 = 33%).
  // Hitting or exceeding the target rate scores 100; zero calls = zero.
  const connectRateTarget = dailyCallTarget > 0 ? dailyConnectTarget / dailyCallTarget : 1 / 3;
  const rawConnectRatio = totalCalls > 0 ? connectedCalls / totalCalls : 0;
  const connectRate = clamp((rawConnectRatio / connectRateTarget) * 100);

  // Calls vs target — avg calls/day as a % of personal daily target.
  // Cap at 100 so "calling machines" don't drag others down via comparison.
  const callsPerDay = totalCalls / Math.max(1, days);
  const callsVsTarget = clamp((callsPerDay / Math.max(1, dailyCallTarget)) * 100);

  // Follow-up completion — kept commitments / (kept + missed + overdue).
  // For the "today" window we expect very few rows; treat empty as 100
  // (no commitments to break) rather than 0 to avoid penalising new agents.
  let done = 0,
    other = 0;
  for (const g of followupGroups) {
    if (g.status === ActivityStatus.DONE) done += g._count._all;
    else if (g.status === ActivityStatus.OVERDUE) other += g._count._all;
    else if (g.status === ActivityStatus.PLANNED) other += g._count._all; // past-PLANNED = missed
    // CANCELLED is excluded — those weren't real commitments
  }
  const denom = done + other;
  const followupCompletion = denom === 0 ? 100 : pct(done, denom);

  return Math.round(meanOf([connectRate, callsVsTarget, followupCompletion]));
}

/**
 * Funnel axis — are their leads converting?
 * Composite of:
 *   • bant_qualification_rate — QUALIFIES / total BANT-set (0-100)
 *   • won_vs_pipeline         — WON / (WON + active in-pipeline) (0-100)
 *   • avg_deal_value_norm     — avg budgetMin of WON in window, normalised to a
 *                                "good deal" benchmark (AED 2.5M / INR 5Cr)
 */
async function computeFunnel(userId: string, start: Date): Promise<number> {
  const [bantQualifies, bantTotal, wonInWindow, activePipeline, wonDealsForAvg] = await Promise.all([
    prisma.lead.count({
      where: { ownerId: userId, bantStatus: BantStatus.QUALIFIES, updatedAt: { gte: start } },
    }),
    prisma.lead.count({
      where: {
        ownerId: userId,
        bantStatus: { not: BantStatus.UNDER_REVIEW },
        updatedAt: { gte: start },
      },
    }),
    // WON in window — currentStatus ∈ BOOKED_STATUSES (the canonical win set; the
    // dead `status` WON enum never advances, so this previously counted 0 for
    // everyone and pinned won_vs_pipeline to 0).
    prisma.lead.count({
      where: { ownerId: userId, currentStatus: { in: BOOKED_STATUSES }, updatedAt: { gte: start } },
    }),
    // Active pipeline (snapshot, pre-booking) — currentStatus ∈ ACTIVE_PURSUIT_STATUSES,
    // the canonical "still being worked" set (replaces the dead status enum list).
    prisma.lead.count({
      where: { ownerId: userId, currentStatus: { in: ACTIVE_PURSUIT_STATUSES } },
    }),
    prisma.lead.findMany({
      where: { ownerId: userId, currentStatus: { in: BOOKED_STATUSES }, updatedAt: { gte: start } },
      select: { budgetMin: true, budgetCurrency: true },
    }),
  ]);

  const bantQualRate = bantTotal === 0 ? 50 : pct(bantQualifies, bantTotal); // neutral if no BANT yet
  const wonVsPipeline = wonInWindow + activePipeline === 0 ? 0 : pct(wonInWindow, wonInWindow + activePipeline);

  // Avg deal value — normalise each currency to its "good" benchmark, then
  // average. AED 2.5M and INR 5Cr are roughly equivalent buying-power
  // benchmarks for the Dubai / India teams respectively. Cap each at 100.
  const AED_BENCHMARK = 2_500_000;
  const INR_BENCHMARK = 50_000_000;
  let avgDealNorm = 0;
  if (wonDealsForAvg.length > 0) {
    const norms = wonDealsForAvg
      .filter((d) => typeof d.budgetMin === "number" && d.budgetMin! > 0)
      .map((d) => {
        const benchmark = d.budgetCurrency === "INR" ? INR_BENCHMARK : AED_BENCHMARK;
        return clamp((d.budgetMin! / benchmark) * 100);
      });
    avgDealNorm = norms.length === 0 ? 0 : meanOf(norms);
  }

  return Math.round(meanOf([bantQualRate, wonVsPipeline, avgDealNorm]));
}

/**
 * Behavioural axis — do they do what they say they'll do?
 * Composite of:
 *   • followup_adherence  — completed planned activities on/before due time
 *   • no_show_inverse     — 100 - (no_shows / total visits) × 100
 *   • response_time_sla   — % of new HOT leads where first call was ≤ 30 min after createdAt
 */
async function computeBehavioural(userId: string, start: Date): Promise<number> {
  const now = new Date();

  // 1. Follow-up adherence — Activity rows of type SITE_VISIT/OFFICE_MEETING/
  //    VIRTUAL_MEETING/HOME_VISIT scheduled in window. Adherent = DONE.
  const visitTypes = [
    ActivityType.SITE_VISIT,
    ActivityType.OFFICE_MEETING,
    ActivityType.VIRTUAL_MEETING,
    ActivityType.HOME_VISIT,
    ActivityType.EXPO_MEETING,
  ];
  const [visitGroups, totalVisits, noShows, hotLeads] = await Promise.all([
    prisma.activity.groupBy({
      by: ["status"],
      where: {
        userId,
        type: { in: visitTypes },
        scheduledAt: { gte: start, lte: now },
      },
      _count: { _all: true },
    }),
    prisma.activity.count({
      where: { userId, type: { in: visitTypes }, scheduledAt: { gte: start, lte: now } },
    }),
    prisma.activity.count({
      where: {
        userId,
        type: { in: visitTypes },
        scheduledAt: { gte: start, lte: now },
        isNoShow: true,
      },
    }),
    prisma.lead.findMany({
      where: { ownerId: userId, aiScore: AIScore.HOT, createdAt: { gte: start } },
      select: { id: true, createdAt: true },
    }),
  ]);

  // Adherence — kept / (kept + missed). PLANNED in the past = missed.
  let kept = 0,
    missed = 0;
  for (const g of visitGroups) {
    if (g.status === ActivityStatus.DONE) kept += g._count._all;
    else if (g.status === ActivityStatus.OVERDUE || g.status === ActivityStatus.PLANNED)
      missed += g._count._all;
  }
  const adherence = kept + missed === 0 ? 100 : pct(kept, kept + missed);

  const noShowInverse = totalVisits === 0 ? 100 : clamp(100 - (noShows / totalVisits) * 100);

  // Response time SLA — % of hot leads where first call happened within 30
  // min of lead creation. Skipped (neutral 50) if there are no hot leads.
  let slaScore = 50;
  if (hotLeads.length > 0) {
    const leadIds = hotLeads.map((l) => l.id);
    const firstCalls = await prisma.callLog.groupBy({
      by: ["leadId"],
      where: { leadId: { in: leadIds }, userId },
      _min: { startedAt: true },
    });
    const firstCallByLead = new Map(firstCalls.map((r) => [r.leadId, r._min.startedAt] as const));
    let within = 0;
    for (const l of hotLeads) {
      const firstCall = firstCallByLead.get(l.id);
      if (!firstCall) continue;
      const deltaMs = firstCall.getTime() - l.createdAt.getTime();
      if (deltaMs <= 30 * 60_000) within++;
    }
    // Denominator = hot leads (not just those that got called) — uncalled
    // hot leads are themselves SLA breaches.
    slaScore = pct(within, hotLeads.length);
  }

  return Math.round(meanOf([adherence, noShowInverse, slaScore]));
}

/**
 * Wellbeing axis — are they sustainable?
 * Composite of:
 *   • attendance_rate       — (PRESENT + LATE) / total working days in window
 *   • mood_trend            — avg DailyMood mapped 1-5 → 0-100
 *   • streak_preservation   — current daily streak / 30 days (cap)
 */
async function computeWellbeing(userId: string, start: Date, days: number): Promise<number> {
  const [attRows, moodRows, user] = await Promise.all([
    prisma.attendance.findMany({
      where: { userId, date: { gte: start } },
      select: { status: true },
    }),
    prisma.dailyMood.findMany({
      where: { userId, date: { gte: start } },
      select: { mood: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { dailyStreak: true, followupStreak: true },
    }),
  ]);

  const presentOrLate = attRows.filter(
    (r) => r.status === AttendanceStatus.PRESENT || r.status === AttendanceStatus.LATE,
  ).length;
  // Approximation: working days ≈ window days minus weekends. For "today"
  // we use 1 day flat (working assumption). For week/month we subtract ~2/7
  // of days as weekends.
  const workingDays =
    days === 1 ? 1 : Math.max(1, Math.round(days * (5 / 7)));
  const attendanceRate = clamp((presentOrLate / workingDays) * 100);

  let moodTrend = 60; // neutral default if no check-ins
  if (moodRows.length > 0) {
    const avg1to5 = meanOf(moodRows.map((r) => MOOD_TO_SCORE[r.mood]));
    moodTrend = clamp(((avg1to5 - 1) / 4) * 100); // 1 → 0, 5 → 100
  }

  const streak = Math.max(user?.dailyStreak ?? 0, user?.followupStreak ?? 0);
  const streakPreservation = clamp((streak / 30) * 100);

  return Math.round(meanOf([attendanceRate, moodTrend, streakPreservation]));
}

// ────────────────────────────────────────────────────────────────────
// PUBLIC API
// ────────────────────────────────────────────────────────────────────

/**
 * Compute the composite quality score for a single user over `window`.
 * Pass `opts.excludeWellbeing` for manager-facing reports (privacy line).
 */
export async function computeQualityScore(
  userId: string,
  window: QualityWindow,
  opts?: { excludeWellbeing?: boolean },
): Promise<QualityBreakdown> {
  const start = windowStart(window);
  const days = windowDays(window);

  // Look up the user's daily targets once (used by Activity axis).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyCallTarget: true, dailyConnectTarget: true },
  });
  const dailyCallTarget = user?.dailyCallTarget ?? 30;
  const dailyConnectTarget = user?.dailyConnectTarget ?? 10;

  const excludeWB = !!opts?.excludeWellbeing;

  const [activity, funnel, behavioural, wellbeing] = await Promise.all([
    computeActivity(userId, start, days, dailyCallTarget, dailyConnectTarget),
    computeFunnel(userId, start),
    computeBehavioural(userId, start),
    excludeWB ? Promise.resolve(0) : computeWellbeing(userId, start, days),
  ]);

  let total: number;
  if (excludeWB) {
    total =
      (activity * WEIGHTS_NO_WELLBEING.activity +
        funnel * WEIGHTS_NO_WELLBEING.funnel +
        behavioural * WEIGHTS_NO_WELLBEING.behavioural) /
      100;
  } else {
    total =
      (activity * WEIGHTS.activity +
        funnel * WEIGHTS.funnel +
        behavioural * WEIGHTS.behavioural +
        wellbeing * WEIGHTS.wellbeing) /
      100;
  }

  return {
    activity,
    funnel,
    behavioural,
    wellbeing: excludeWB ? null : wellbeing,
    total: Math.round(clamp(total)),
  };
}

/**
 * Bulk variant — compute scores for many users in one call. Each user gets
 * their own Promise; we fan out, then attach a 1-based rank by total desc.
 * Used by the /admin/quality table.
 */
export async function computeQualityScores(
  userIds: string[],
  window: QualityWindow,
  opts?: { excludeWellbeing?: boolean },
): Promise<Map<string, QualityBreakdown>> {
  const entries = await Promise.all(
    userIds.map(async (id) => [id, await computeQualityScore(id, window, opts)] as const),
  );
  // Rank by total desc; ties get the same rank (dense ranking).
  const sorted = [...entries].sort((a, b) => b[1].total - a[1].total);
  let lastTotal = -1;
  let rank = 0;
  const ranked = new Map<string, QualityBreakdown>();
  for (let i = 0; i < sorted.length; i++) {
    const [id, br] = sorted[i];
    if (br.total !== lastTotal) {
      rank = i + 1;
      lastTotal = br.total;
    }
    ranked.set(id, { ...br, rank });
  }
  return ranked;
}

/**
 * Pure UI helper — colour band for a total score (≥80 green / 60-79 amber /
 * <60 red). Returned as a tuple of tailwind classes for tone-by-context.
 */
export function totalBand(total: number): { tone: "green" | "amber" | "red"; bg: string; text: string; ring: string } {
  if (total >= 80) return { tone: "green", bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-300" };
  if (total >= 60) return { tone: "amber", bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-300" };
  return { tone: "red", bg: "bg-red-50", text: "text-red-700", ring: "ring-red-300" };
}

/**
 * Authorisation predicate — is `viewer` allowed to see `targetUserId`'s score?
 * Rules (per spec §4):
 *   • ADMIN  → anyone
 *   • MANAGER → themselves + their direct reports
 *   • AGENT  → themselves only
 */
export async function canViewQualityFor(
  viewer: { id: string; role: "ADMIN" | "MANAGER" | "AGENT" },
  targetUserId: string,
): Promise<boolean> {
  if (viewer.id === targetUserId) return true;
  if (viewer.role === "ADMIN") return true;
  if (viewer.role === "MANAGER") {
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { managerId: true },
    });
    return target?.managerId === viewer.id;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────
// Open-question defaults (per L's spec §5) — see deliverable summary:
//   1. Weights: kept L's 30/35/25/10. Funnel-first matches Lalit's
//      revenue focus; over-weighting wellbeing would reward cheerful
//      low-effort agents.
//   2. Empty axis: we return a neutral floor (50 for BANT-when-empty,
//      100 for follow-up-when-empty) rather than dragging the total
//      to zero — fairer to new hires per the spec's first option.
//   3. Comparison group: ranked across ALL active AGENTs+MANAGERs in the
//      computeQualityScores() bulk call. Per-team filtering happens in
//      the /admin/quality page UI, not in the score itself, so the
//      number is stable regardless of how it's sliced.
// ────────────────────────────────────────────────────────────────────
