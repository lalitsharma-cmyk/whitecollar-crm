import { requireHrPage, hrActiveScopeWhere } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import { CLOSED_STATUS_KEYS } from "@/lib/hrStatus";
import { getHrUsers } from "@/lib/hrUsers";
import { greetingFor, tzForTeam, istDayRange } from "@/lib/datetime";
import type { HRActivityType } from "@prisma/client";

import HRRemindersCard, { type HRReminderEvent, type HREventType } from "@/components/HRRemindersCard";

import { HrDashboardChrome } from "@/components/hr-dashboard/HrDashboardChrome";
import { ActionCenterKpis, type HrKpiTile } from "@/components/hr-dashboard/ActionCenterKpis";
import { AiSuggestions, type AiSuggestion } from "@/components/hr-dashboard/AiSuggestions";
import { CallNowQueue, type CallNowItem } from "@/components/hr-dashboard/CallNowQueue";
import { NoNextActionQueue, type NoNextActionItem } from "@/components/hr-dashboard/NoNextActionQueue";
import { TodaysInterviews, type TodaysInterviewItem } from "@/components/hr-dashboard/TodaysInterviews";
import { PendingConfirmations, type PendingConfirmItem } from "@/components/hr-dashboard/PendingConfirmations";
import { NoShowRecovery, type NoShowItem } from "@/components/hr-dashboard/NoShowRecovery";
import { ExpectedJoinings, type ExpectedJoiningItem } from "@/components/hr-dashboard/ExpectedJoinings";
import { RecruitmentFunnel, type FunnelStage } from "@/components/hr-dashboard/RecruitmentFunnel";
import { DailyProductivity } from "@/components/hr-dashboard/DailyProductivity";
import { Leaderboard, type LeaderboardRow } from "@/components/hr-dashboard/Leaderboard";
import { RecentActivityFeed, type RecentActivityRow } from "@/components/hr-dashboard/RecentActivityFeed";

export const dynamic = "force-dynamic";

// Daily per-recruiter call target (spec item 15). Calls completed today vs this.
const CALL_TARGET = 40;

const CALL_TYPES: HRActivityType[] = [
  "CALL_CONNECTED", "CALL_NOT_ANSWERED", "CALL_BUSY",
  "CALL_SWITCHED_OFF", "CALL_WRONG_NUMBER", "CALL_LATER",
];

// Human-readable label for an activity type, used in the Recent Activity feed.
const ACTIVITY_LABEL: Record<string, string> = {
  CALL_CONNECTED: "Call connected", CALL_NOT_ANSWERED: "Call not answered", CALL_BUSY: "Call busy",
  CALL_SWITCHED_OFF: "Phone switched off", CALL_WRONG_NUMBER: "Wrong number", CALL_LATER: "Call later",
  WHATSAPP_SENT: "WhatsApp sent", WHATSAPP_RECEIVED: "WhatsApp received", EMAIL_LOGGED: "Email logged",
  INTERVIEW_SCHEDULED: "Interview scheduled", INTERVIEW_ATTENDED: "Interview attended",
  INTERVIEW_NO_SHOW: "Interview no-show", INTERVIEW_RESCHEDULED: "Interview rescheduled",
  OFFER_RELEASED: "Offer released", OFFER_DECLINED: "Offer declined", CANDIDATE_JOINED: "Candidate joined",
  FOLLOWUP_CREATED: "Follow-up set", FOLLOWUP_COMPLETED: "Follow-up done", STATUS_CHANGED: "Status changed",
  NOTE_ADDED: "Note added", RESUME_UPLOADED: "Resume uploaded", VOICE_NOTE: "Voice note",
  VOICE_GUIDANCE: "Voice guidance", ESCALATION_RAISED: "Escalation raised",
  ESCALATION_REPLIED: "Escalation reply", ESCALATION_RESOLVED: "Escalation resolved",
};

// HRFollowUp.type → the reminder card's event type + label (legacy HRRemindersCard).
const FU_EVENT: Record<string, { type: HREventType; label: string }> = {
  CALL_BACK: { type: "FOLLOWUP", label: "Call" },
  INTERVIEW_CONFIRMATION: { type: "CONFIRM", label: "Confirm Interview" },
  REMINDER: { type: "FOLLOWUP", label: "Reminder" },
  WHATSAPP_FOLLOWUP: { type: "FOLLOWUP", label: "WhatsApp" },
  EMAIL_FOLLOWUP: { type: "FOLLOWUP", label: "Email" },
  SALARY_DISCUSSION: { type: "FOLLOWUP", label: "Salary Discussion" },
  OFFER_DISCUSSION: { type: "OFFER", label: "Offer Discussion" },
  JOINING_FOLLOWUP: { type: "OFFER", label: "Joining Follow-up" },
  NO_SHOW_RECOVERY: { type: "FOLLOWUP", label: "No-Show Recovery" },
  CUSTOM: { type: "FOLLOWUP", label: "Follow-up" },
};

// Interview-type enum label (mirrors TodaysInterviews / readable form elsewhere).
function fmtType(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function firstNameOf(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  return n ? n.split(/\s+/)[0] : null;
}

// Whole-day difference between two instants, IST calendar-day based, floored.
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

// Human "in N days / hours" relative label for a FUTURE instant (PendingConfirmations).
function relativeFuture(target: Date, now: Date): string {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return "Due now";
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return "in under an hour";
  if (hours < 24) return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

export default async function HRDashboard() {
  const { me, perms } = await requireHrPage();

  const now = new Date();
  const { start: todayStart, end: todayEnd } = istDayRange(); // today (IST) [start, end)
  const todayIso = todayStart.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const weekAgo = new Date(todayStart.getTime() - 7 * 24 * 3600_000);

  // Scope EVERY candidate read: Junior HR → own only; Admin/Senior → all.
  const scope = hrActiveScopeWhere(me);
  // For { candidate: <scope> } relation filters on HRFollowUp / HRInterview / HRActivity.
  const scopedCandidate = hrActiveScopeWhere(me);

  const isLeader = perms.reports; // Leaderboard only when the viewer has reports perm.
  const showOwner = perms.viewAllCandidates; // Admin / Senior HR see the owning recruiter.

  // Per-promise fallback defaults: one failed query must NOT blank the whole
  // dashboard. Each `.catch` logs and resolves to an empty/zero shape of the
  // SAME type as the query, so downstream code keeps rendering the rest.
  type FollowUpRow = Awaited<ReturnType<typeof loadFollowUps>>[number];
  type InterviewRow = Awaited<ReturnType<typeof loadInterviews>>[number];
  type ExpectedRow = Awaited<ReturnType<typeof loadExpected>>[number];
  type NoNextRow = Awaited<ReturnType<typeof loadNoNext>>[number];
  type RecentRow = Awaited<ReturnType<typeof loadRecent>>[number];
  type StatusGroupRow = { status: string; _count: number };
  type UserGroupRow = { userId: string | null; _count: number };

  function loadFollowUps() {
    // Open follow-ups (scoped) — drives Call-Now queue, Calls-Due/Overdue KPIs + reminders.
    return prisma.hRFollowUp.findMany({
      where: { completedAt: null, candidate: scopedCandidate },
      orderBy: { dueAt: "asc" },
      take: 300,
      include: {
        candidate: {
          select: {
            id: true, name: true, phone: true, whatsappPhone: true,
            status: true, nextAction: true, positionApplied: true,
            primaryOwner: { select: { name: true } },
          },
        },
      },
    });
  }
  function loadInterviews() {
    // Interviews in the recent window (scoped) — Today / Pending-confirm / No-show buckets.
    return prisma.hRInterview.findMany({
      where: { candidate: scopedCandidate, scheduledAt: { gte: weekAgo } },
      orderBy: { scheduledAt: "asc" },
      take: 300,
      include: {
        candidate: { select: { id: true, name: true, phone: true, whatsappPhone: true, positionApplied: true } },
      },
    });
  }
  function loadExpected() {
    // Expected Joinings (scoped).
    return prisma.hRCandidate.findMany({
      where: { AND: [scope, { OR: [{ status: "EXPECTED_JOINING" }, { joiningDate: { not: null } }] }] },
      orderBy: { joiningDate: "asc" },
      take: 20,
      select: {
        id: true, name: true, positionApplied: true, joiningDate: true, status: true,
        phone: true, whatsappPhone: true, primaryOwner: { select: { name: true } },
      },
    });
  }
  function loadNoNext() {
    // No-Next-Action queue rows (scoped) — active candidates with nothing scheduled.
    return prisma.hRCandidate.findMany({
      where: { AND: [scope, { nextActionDate: null, status: { notIn: CLOSED_STATUS_KEYS } }] },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true, name: true, phone: true, whatsappPhone: true,
        status: true, positionApplied: true, createdAt: true,
        primaryOwner: { select: { name: true } },
      },
    });
  }
  function loadRecent() {
    // Recent Activity feed (scoped).
    return prisma.hRActivity.findMany({
      where: { candidate: scopedCandidate },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        candidate: { select: { id: true, name: true, phone: true, whatsappPhone: true, email: true } },
        user: { select: { name: true } },
      },
    });
  }
  const onErr = (label: string) => (e: unknown) => {
    console.error(`[hr-dashboard] query failed: ${label}`, e);
  };

  const [
    followUps,
    interviews,
    newCount,
    expectedRows,
    noNextRows,
    noNextActionCount,
    noShowFullCount,
    callsToday,
    recentRows,
    funnelGroup,
    funnelTotal,
    // ── Leaderboard groupings (reports perm only) ──
    hrUsers,
    lbCalls,
    lbFollowups,
    lbIvSched,
    lbIvDone,
    lbOffers,
    lbJoined,
  ] = await Promise.all([
    loadFollowUps().catch((e) => { onErr("followUps")(e); return [] as FollowUpRow[]; }),
    loadInterviews().catch((e) => { onErr("interviews")(e); return [] as InterviewRow[]; }),
    // New Candidates KPI.
    prisma.hRCandidate.count({ where: { AND: [scope, { status: "NEW" }] } })
      .catch((e) => { onErr("newCount")(e); return 0; }),
    loadExpected().catch((e) => { onErr("expectedRows")(e); return [] as ExpectedRow[]; }),
    loadNoNext().catch((e) => { onErr("noNextRows")(e); return [] as NoNextRow[]; }),
    // No-Next-Action total (scoped).
    prisma.hRCandidate.count({
      where: { AND: [scope, { nextActionDate: null, status: { notIn: CLOSED_STATUS_KEYS } }] },
    }).catch((e) => { onErr("noNextActionCount")(e); return 0; }),
    // FULL distinct No-Show count (scoped, recent window) — drives the KPI tile so it
    // is NOT capped at the 10-row recovery list below. One candidate counts once even
    // with multiple no-show interviews (groupBy candidateId → number of groups).
    prisma.hRInterview.groupBy({
      by: ["candidateId"],
      where: { candidate: scopedCandidate, scheduledAt: { gte: weekAgo }, attendanceStatus: "NO_SHOW" },
    }).then((g) => g.length).catch((e) => { onErr("noShowFullCount")(e); return 0; }),
    // Daily Productivity — CALL_* activities logged today (IST), scoped to my candidates.
    prisma.hRActivity.count({
      where: { type: { in: CALL_TYPES }, createdAt: { gte: todayStart, lt: todayEnd }, candidate: scopedCandidate },
    }).catch((e) => { onErr("callsToday")(e); return 0; }),
    loadRecent().catch((e) => { onErr("recentRows")(e); return [] as RecentRow[]; }),
    // Recruitment funnel — current candidate snapshot by status (scoped).
    prisma.hRCandidate.groupBy({ by: ["status"], where: scope, _count: true })
      .catch((e) => { onErr("funnelGroup")(e); return [] as StatusGroupRow[]; }),
    prisma.hRCandidate.count({ where: scope })
      .catch((e) => { onErr("funnelTotal")(e); return 0; }),
    // ── Leaderboard (reports perm only). Activity over the week window, by recruiter. ──
    isLeader
      ? getHrUsers().catch((e) => { onErr("hrUsers")(e); return [] as { id: string; name: string }[]; })
      : Promise.resolve([] as { id: string; name: string }[]),
    isLeader
      ? prisma.hRActivity.groupBy({ by: ["userId"], where: { type: { in: CALL_TYPES }, userId: { not: null }, createdAt: { gte: weekAgo }, candidate: { deletedAt: null } }, _count: true })
          .catch((e) => { onErr("lbCalls")(e); return [] as UserGroupRow[]; })
      : Promise.resolve([] as UserGroupRow[]),
    isLeader
      ? prisma.hRActivity.groupBy({ by: ["userId"], where: { type: "FOLLOWUP_COMPLETED", userId: { not: null }, createdAt: { gte: weekAgo }, candidate: { deletedAt: null } }, _count: true })
          .catch((e) => { onErr("lbFollowups")(e); return [] as UserGroupRow[]; })
      : Promise.resolve([] as UserGroupRow[]),
    isLeader
      ? prisma.hRActivity.groupBy({ by: ["userId"], where: { type: "INTERVIEW_SCHEDULED", userId: { not: null }, createdAt: { gte: weekAgo }, candidate: { deletedAt: null } }, _count: true })
          .catch((e) => { onErr("lbIvSched")(e); return [] as UserGroupRow[]; })
      : Promise.resolve([] as UserGroupRow[]),
    isLeader
      ? prisma.hRActivity.groupBy({ by: ["userId"], where: { type: "INTERVIEW_ATTENDED", userId: { not: null }, createdAt: { gte: weekAgo }, candidate: { deletedAt: null } }, _count: true })
          .catch((e) => { onErr("lbIvDone")(e); return [] as UserGroupRow[]; })
      : Promise.resolve([] as UserGroupRow[]),
    isLeader
      ? prisma.hRActivity.groupBy({ by: ["userId"], where: { type: "OFFER_RELEASED", userId: { not: null }, createdAt: { gte: weekAgo }, candidate: { deletedAt: null } }, _count: true })
          .catch((e) => { onErr("lbOffers")(e); return [] as UserGroupRow[]; })
      : Promise.resolve([] as UserGroupRow[]),
    isLeader
      ? prisma.hRActivity.groupBy({ by: ["userId"], where: { type: "CANDIDATE_JOINED", userId: { not: null }, createdAt: { gte: weekAgo }, candidate: { deletedAt: null } }, _count: true })
          .catch((e) => { onErr("lbJoined")(e); return [] as UserGroupRow[]; })
      : Promise.resolve([] as UserGroupRow[]),
  ]);

  // ── Follow-up buckets (day-granular: overdue = due before start-of-today-IST) ──
  const overdueFU = followUps.filter((f) => new Date(f.dueAt) < todayStart);
  const todayFU = followUps.filter((f) => {
    const d = new Date(f.dueAt);
    return d >= todayStart && d < todayEnd;
  });

  // Call-Now queue — one row per candidate (overdue + due-today, soonest first).
  const callNowSeen = new Set<string>();
  const callNowItems: CallNowItem[] = [...overdueFU, ...todayFU]
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))
    .filter((f) => {
      if (callNowSeen.has(f.candidateId)) return false;
      callNowSeen.add(f.candidateId);
      return true;
    })
    .slice(0, 25)
    .map((f) => ({
      followUpId: f.id,
      candidateId: f.candidateId,
      name: f.candidate.name,
      position: f.candidate.positionApplied,
      status: f.candidate.status,
      nextAction: f.candidate.nextAction ?? null,
      ownerFirstName: firstNameOf(f.candidate.primaryOwner?.name),
      phone: f.candidate.phone,
      whatsappPhone: f.candidate.whatsappPhone,
      dueIso: new Date(f.dueAt).toISOString(),
      overdue: new Date(f.dueAt) < todayStart,
    }));

  // ── Interview buckets ──
  const ivToday = interviews.filter((iv) => {
    const d = new Date(iv.scheduledAt);
    return (
      d >= todayStart && d < todayEnd &&
      (iv.attendanceStatus === "SCHEDULED" || iv.attendanceStatus === "RESCHEDULED")
    );
  });
  const confirmPending = interviews.filter(
    (iv) =>
      new Date(iv.scheduledAt) >= now &&
      iv.confirmationStatus === "PENDING" &&
      (iv.attendanceStatus === "SCHEDULED" || iv.attendanceStatus === "RESCHEDULED"),
  );
  const noShowSeen = new Set<string>();
  const noShowInterviews = interviews
    .filter((iv) => iv.attendanceStatus === "NO_SHOW")
    .reverse()
    .filter((iv) => {
      if (noShowSeen.has(iv.candidateId)) return false;
      noShowSeen.add(iv.candidateId);
      return true;
    })
    .slice(0, 10);

  // ── Component item shapes ──
  const todaysInterviewItems: TodaysInterviewItem[] = ivToday.map((iv) => ({
    interviewId: iv.id,
    candidateId: iv.candidateId,
    name: iv.candidate.name,
    position: iv.candidate.positionApplied,
    type: iv.type,
    timeIso: new Date(iv.scheduledAt).toISOString(),
    confirmationStatus: iv.confirmationStatus,
    attendanceStatus: iv.attendanceStatus,
    phone: iv.candidate.phone,
    whatsappPhone: iv.candidate.whatsappPhone,
  }));

  const pendingConfirmItems: PendingConfirmItem[] = confirmPending.map((iv) => ({
    interviewId: iv.id,
    candidateId: iv.candidateId,
    name: iv.candidate.name,
    position: iv.candidate.positionApplied,
    scheduledIso: new Date(iv.scheduledAt).toISOString(),
    relativeLabel: relativeFuture(new Date(iv.scheduledAt), now),
    phone: iv.candidate.phone,
    whatsappPhone: iv.candidate.whatsappPhone,
    attendanceStatus: iv.attendanceStatus,
  }));

  const noShowItems: NoShowItem[] = noShowInterviews.map((iv) => ({
    interviewId: iv.id,
    candidateId: iv.candidateId,
    name: iv.candidate.name,
    type: iv.type,
    missedIso: new Date(iv.scheduledAt).toISOString(),
    daysSince: Math.max(0, daysBetween(new Date(iv.scheduledAt), now)),
    reason: iv.noShowReason ?? null,
    phone: iv.candidate.phone,
    whatsappPhone: iv.candidate.whatsappPhone,
  }));

  const expectedItems: ExpectedJoiningItem[] = expectedRows.map((c) => ({
    candidateId: c.id,
    name: c.name,
    position: c.positionApplied,
    status: c.status,
    joiningIso: c.joiningDate ? new Date(c.joiningDate).toISOString() : null,
    daysUntil: c.joiningDate ? daysBetween(todayStart, new Date(c.joiningDate)) : null,
    ownerFirstName: firstNameOf(c.primaryOwner?.name),
    phone: c.phone,
    whatsappPhone: c.whatsappPhone,
  }));

  const noNextItems: NoNextActionItem[] = noNextRows.map((c) => ({
    candidateId: c.id,
    name: c.name,
    position: c.positionApplied,
    status: c.status,
    ownerFirstName: firstNameOf(c.primaryOwner?.name),
    daysSinceCreated: Math.max(0, daysBetween(new Date(c.createdAt), now)),
    phone: c.phone,
    whatsappPhone: c.whatsappPhone,
  }));

  const recentItems: RecentActivityRow[] = recentRows.map((a) => ({
    id: a.id,
    label: ACTIVITY_LABEL[a.type] ?? fmtType(a.type),
    candidateId: a.candidateId,
    candidateName: a.candidate.name,
    userFirstName: firstNameOf(a.user?.name),
    whenIso: new Date(a.createdAt).toISOString(),
    // Optional contact extras the feed renders quick actions from when present.
    phone: a.candidate.phone,
    whatsappPhone: a.candidate.whatsappPhone,
    email: a.candidate.email,
  }));

  // ── Recruitment funnel (canonical order; counts from the scoped status snapshot) ──
  const statusCount: Record<string, number> = {};
  for (const r of funnelGroup) statusCount[r.status] = r._count;
  const sum = (...keys: string[]) => keys.reduce((n, k) => n + (statusCount[k] ?? 0), 0);
  const funnelDefs: { key: string; label: string; count: number }[] = [
    { key: "NEW", label: "New", count: sum("NEW") },
    { key: "NOT_CALLED", label: "Not Called", count: sum("NOT_CALLED") },
    { key: "INTERESTED", label: "Interested", count: sum("INTERESTED") },
    { key: "PIPELINE", label: "Pipeline", count: sum("PIPELINE") },
    { key: "VIRTUAL_INTERVIEW_SCHEDULED", label: "Interview Scheduled", count: sum("VIRTUAL_INTERVIEW_SCHEDULED", "F2F_INTERVIEW_SCHEDULED") },
    { key: "INTERVIEW_HELD", label: "Interview Held", count: sum("INTERVIEW_HELD") },
    { key: "SHORTLISTED", label: "Shortlisted", count: sum("SHORTLISTED") },
    { key: "OFFER_RELEASED", label: "Offer Released", count: sum("OFFER_RELEASED") },
    { key: "JOINED", label: "Joined", count: sum("JOINED") },
  ];
  const funnelStages: FunnelStage[] = funnelDefs.map((s) => ({
    key: s.key,
    label: s.label,
    count: s.count,
    pct: funnelTotal > 0 ? Math.round((s.count / funnelTotal) * 100) : 0,
  }));

  // ── Reminder events (legacy HRRemindersCard, shrunk in the sidebar) ──
  const reminderEvents: HRReminderEvent[] = [
    ...followUps.map((f) => ({
      id: f.id,
      candidateId: f.candidateId,
      candidateName: f.candidate.name,
      type: FU_EVENT[f.type]?.type ?? "FOLLOWUP",
      label: FU_EVENT[f.type]?.label ?? "Follow-up",
      timeIso: new Date(f.dueAt).toISOString(),
      ownerName: f.candidate.primaryOwner?.name ?? null,
    })),
    ...interviews
      .filter((iv) => iv.attendanceStatus === "SCHEDULED" || iv.attendanceStatus === "RESCHEDULED")
      .map((iv) => ({
        id: iv.id,
        candidateId: iv.candidateId,
        candidateName: iv.candidate.name,
        type: "INTERVIEW" as HREventType,
        label: `${fmtType(iv.type)} Interview`,
        timeIso: new Date(iv.scheduledAt).toISOString(),
        ownerName: null,
      })),
  ];

  // ── Leaderboard rows (reports perm only) ──
  const byUser = (rows: { userId: string | null; _count: number }[]) => {
    const m: Record<string, number> = {};
    for (const r of rows) if (r.userId) m[r.userId] = r._count;
    return m;
  };
  const cCalls = byUser(lbCalls), cFollow = byUser(lbFollowups), cSched = byUser(lbIvSched);
  const cDone = byUser(lbIvDone), cOffers = byUser(lbOffers), cJoined = byUser(lbJoined);
  const leaderboardRows: LeaderboardRow[] = hrUsers
    .map((u) => ({
      userId: u.id,
      name: u.name,
      calls: cCalls[u.id] ?? 0,
      followUpsCompleted: cFollow[u.id] ?? 0,
      interviewsScheduled: cSched[u.id] ?? 0,
      interviewsConducted: cDone[u.id] ?? 0,
      offersReleased: cOffers[u.id] ?? 0,
      joined: cJoined[u.id] ?? 0,
    }))
    .filter((r) => r.calls || r.followUpsCompleted || r.interviewsScheduled || r.interviewsConducted || r.offersReleased || r.joined)
    .slice(0, 12);

  // ── 8 deduped KPI tiles (Action Center) ──
  const kpiTiles: HrKpiTile[] = [
    { kind: "new", label: "New Candidates", count: newCount, href: "/hr/candidates?status=NEW" },
    { kind: "callsDue", label: "Calls Due Today", count: todayFU.length, href: "#call-now" },
    { kind: "overdue", label: "Overdue Follow-Ups", count: overdueFU.length, href: "#call-now" },
    { kind: "interviewsToday", label: "Interviews Today", count: ivToday.length, href: "#interviews-today" },
    { kind: "pendingConfirm", label: "Pending Confirmations", count: confirmPending.length, href: "#pending-confirmations" },
    { kind: "noShow", label: "No-Shows", count: noShowFullCount, href: "#no-show-recovery" },
    { kind: "expectedJoin", label: "Expected Joinings", count: expectedItems.length, href: "#expected-joinings" },
    { kind: "noNextAction", label: "No Next Action", count: noNextActionCount, href: "#no-next-action" },
  ];

  // ── Rule-based AI suggestions (no LLM) ──
  const suggestions: AiSuggestion[] = [];
  if (overdueFU.length > 0) {
    const first = callNowItems.find((i) => i.overdue);
    suggestions.push({
      id: "overdue-followups",
      severity: "high",
      message: first
        ? `Call ${first.name} first — ${overdueFU.length} overdue follow-up${overdueFU.length === 1 ? "" : "s"} need attention.`
        : `${overdueFU.length} overdue follow-up${overdueFU.length === 1 ? "" : "s"} need attention.`,
      count: overdueFU.length,
      href: "#call-now",
    });
  }
  if (confirmPending.length > 0) {
    const c = confirmPending[0];
    suggestions.push({
      id: "unconfirmed-interviews",
      severity: "medium",
      message: `${c.candidate.name}${confirmPending.length > 1 ? ` and ${confirmPending.length - 1} other${confirmPending.length - 1 === 1 ? "" : "s"}` : ""} may ghost — confirm the upcoming interview.`,
      count: confirmPending.length,
      href: "#pending-confirmations",
    });
  }
  if (noShowFullCount > 0) {
    suggestions.push({
      id: "no-show-recovery",
      severity: "high",
      message: `${noShowFullCount} candidate${noShowFullCount === 1 ? "" : "s"} missed an interview — recover before they go cold.`,
      count: noShowFullCount,
      href: "#no-show-recovery",
    });
  }
  // Candidates waiting too long with no next action (≥ 3 days since created).
  const staleNoNext = noNextItems.filter((i) => i.daysSinceCreated >= 3);
  if (staleNoNext.length > 0) {
    suggestions.push({
      id: "stale-no-next-action",
      severity: "medium",
      message: `${staleNoNext.length} active candidate${staleNoNext.length === 1 ? "" : "s"} waiting ${staleNoNext.length === 1 ? `${staleNoNext[0].daysSinceCreated} days` : "3+ days"} with no next step set.`,
      count: staleNoNext.length,
      href: "#no-next-action",
    });
  }
  // Offers released with a joining date → joining follow-up.
  const joiningSoon = expectedItems.filter((i) => i.status === "OFFER_RELEASED" || (i.daysUntil !== null && i.daysUntil <= 7));
  if (joiningSoon.length > 0) {
    suggestions.push({
      id: "joining-followups",
      severity: "info",
      message: `${joiningSoon.length} offered candidate${joiningSoon.length === 1 ? "" : "s"} joining soon — confirm documents and joining date.`,
      count: joiningSoon.length,
      href: "#expected-joinings",
    });
  }
  // Salary discussion follow-ups pending.
  const salaryPending = followUps.filter((f) => f.type === "SALARY_DISCUSSION");
  if (salaryPending.length > 0) {
    suggestions.push({
      id: "salary-pending",
      severity: "info",
      message: `${salaryPending.length} salary discussion${salaryPending.length === 1 ? "" : "s"} pending — close the loop on compensation.`,
      count: salaryPending.length,
      href: "#call-now",
    });
  }

  const greeting = greetingFor(now, tzForTeam(me.team));
  const firstName = firstNameOf(me.name) ?? me.name;

  // ── LEFT column (action content) ──
  const left = (
    <>
      <ActionCenterKpis tiles={kpiTiles} />
      <AiSuggestions suggestions={suggestions} />
      <div id="call-now">
        <CallNowQueue items={callNowItems} showOwner={showOwner} />
      </div>
      <div id="no-next-action">
        <NoNextActionQueue items={noNextItems} totalCount={noNextActionCount} showOwner={showOwner} />
      </div>
      <TodaysInterviews items={todaysInterviewItems} />
      <div id="pending-confirmations">
        <PendingConfirmations items={pendingConfirmItems} />
      </div>
      <div id="no-show-recovery">
        <NoShowRecovery items={noShowItems} />
      </div>
      <div id="expected-joinings">
        <ExpectedJoinings items={expectedItems} showOwner={showOwner} />
      </div>
      <RecruitmentFunnel stages={funnelStages} total={funnelTotal} />
    </>
  );

  // ── RIGHT column (sticky sidebar) ──
  const right = (
    <>
      <DailyProductivity callsCompleted={callsToday} callsTarget={CALL_TARGET} />

      {/* Existing reminders/calendar card — SHRUNK into a collapsible <details> so
          it never dominates the redesigned sidebar (spec: keep it small). */}
      <details className="group rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
        <summary className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none list-none">
          <span className="text-sm font-bold text-gray-900 dark:text-white">
            Reminders &amp; Calendar
          </span>
          <span className="inline-flex items-center gap-2">
            {reminderEvents.length > 0 && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300">
                {reminderEvents.length}
              </span>
            )}
            <span className="text-[11px] text-gray-400 dark:text-slate-500 group-open:hidden">Show</span>
            <span className="text-[11px] text-gray-400 dark:text-slate-500 hidden group-open:inline">Hide</span>
          </span>
        </summary>
        <div className="px-2 pb-2">
          <HRRemindersCard events={reminderEvents} todayIso={todayIso} showOwner={showOwner} />
        </div>
      </details>

      {isLeader && (
        <Leaderboard rows={leaderboardRows} periodLabel="Last 7 days" />
      )}

      <RecentActivityFeed rows={recentItems} />
    </>
  );

  return (
    <HrDashboardChrome firstName={firstName} greeting={greeting} left={left} right={right} />
  );
}
