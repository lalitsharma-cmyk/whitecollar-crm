import { requireHrPage, hrScopeWhere } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { statusColor, statusLabel, CLOSED_STATUS_KEYS } from "@/lib/hrStatus";
import HRRemindersCard, { type HRReminderEvent, type HREventType } from "@/components/HRRemindersCard";
import HRFollowUpTabs, { type FU } from "@/components/HRFollowUpTabs";
import { getHrUsers } from "@/lib/hrUsers";
import type { HRActivityType } from "@prisma/client";
import {
  Phone, CalendarCheck, CheckCircle2, FileText, Handshake, Activity,
  UserPlus, AlertTriangle, Ban, Inbox, Target, ClipboardList, RotateCcw,
  MessageCircle,
} from "lucide-react";
import { ActionIconButton } from "@/components/actions/ActionIconButton";

export const dynamic = "force-dynamic";

const CALL_TYPES: HRActivityType[] = ["CALL_CONNECTED", "CALL_NOT_ANSWERED", "CALL_BUSY", "CALL_SWITCHED_OFF", "CALL_WRONG_NUMBER", "CALL_LATER"];

// Human-readable label for an activity type, used in the Recent Activities feed.
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

function istRange() {
  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const start = new Date(todayIso + "T00:00:00+05:30");
  return { todayIso, start, end: new Date(start.getTime() + 24 * 3600_000) };
}
function fmt(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }
function fmtTime(d: Date) { return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }); }
function fmtDate(d: Date) { return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }); }

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

export default async function HRDashboard() {
  const { me, perms } = await requireHrPage();
  const { todayIso, start: todayStart, end: todayEnd } = istRange();
  // All candidate-scoped queries must hide soft-deleted candidates.
  const scope = { AND: [hrScopeWhere(me), { deletedAt: null }] };
  const scopedCandidate = { AND: [hrScopeWhere(me), { deletedAt: null }] }; // for { candidate: ... } relation filters
  const now = new Date();
  const weekAgo = new Date(todayStart.getTime() - 7 * 24 * 3600_000);
  const isLeader = perms.viewAllCandidates; // Admin / Senior HR see the team leaderboard

  const [
    followUps, interviews, newCount, expectedList, noNextAction, noNextActionCount,
    todaysCalls, offersPending, recentActivities, leaderAdded, leaderJoined, hrUsers,
  ] = await Promise.all([
    prisma.hRFollowUp.findMany({
      where: { completedAt: null, candidate: scopedCandidate },
      orderBy: { dueAt: "asc" }, take: 200,
      include: { candidate: { select: { id: true, name: true, phone: true, whatsappPhone: true, status: true, nextAction: true, primaryOwner: { select: { name: true } } } } },
    }),
    prisma.hRInterview.findMany({
      where: { candidate: scopedCandidate, scheduledAt: { gte: weekAgo } },
      orderBy: { scheduledAt: "asc" }, take: 200,
      include: { candidate: { select: { id: true, name: true, phone: true, positionApplied: true, primaryOwner: { select: { name: true } } } }, interviewer: { select: { name: true } } },
    }),
    prisma.hRCandidate.count({ where: { status: "NEW", ...scope } }),
    prisma.hRCandidate.findMany({
      where: { AND: [scope, { OR: [{ status: "EXPECTED_JOINING" }, { joiningDate: { not: null } }] }] },
      orderBy: { joiningDate: "asc" }, take: 20,
      select: { id: true, name: true, positionApplied: true, joiningDate: true, status: true },
    }),
    prisma.hRCandidate.findMany({
      where: { AND: [scope, { nextActionDate: null, status: { notIn: CLOSED_STATUS_KEYS } }] },
      orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, name: true, phone: true, whatsappPhone: true, status: true, positionApplied: true, primaryOwner: { select: { name: true } } },
    }),
    prisma.hRCandidate.count({ where: { AND: [scope, { nextActionDate: null, status: { notIn: CLOSED_STATUS_KEYS } }] } }),
    // Today's Calls — call activities logged today (IST), scoped to my candidates.
    prisma.hRActivity.count({
      where: {
        type: { in: CALL_TYPES },
        createdAt: { gte: todayStart, lt: todayEnd },
        candidate: scopedCandidate,
      },
    }),
    // Offers Pending — released offers not yet joined/declined.
    prisma.hRCandidate.count({ where: { status: "OFFER_RELEASED", ...scope } }),
    // Recent Activities feed (scoped).
    prisma.hRActivity.findMany({
      where: { candidate: scopedCandidate },
      orderBy: { createdAt: "desc" }, take: 12,
      include: { candidate: { select: { id: true, name: true } }, user: { select: { name: true } } },
    }),
    // Recruiter leaderboard (Admin / Senior only) — candidates added per owner this week.
    isLeader
      ? prisma.hRCandidate.groupBy({
          by: ["primaryOwnerId"],
          where: { deletedAt: null, primaryOwnerId: { not: null }, createdAt: { gte: weekAgo } },
          _count: true,
        })
      : Promise.resolve([] as { primaryOwnerId: string | null; _count: number }[]),
    // Leaderboard — candidates joined per owner this week.
    isLeader
      ? prisma.hRActivity.groupBy({
          by: ["userId"],
          where: { type: "CANDIDATE_JOINED", userId: { not: null }, createdAt: { gte: weekAgo }, candidate: { deletedAt: null } },
          _count: true,
        })
      : Promise.resolve([] as { userId: string | null; _count: number }[]),
    isLeader ? getHrUsers() : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  // ── Build leaderboard rows (added + joined this week, per recruiter) ──
  const addedByOwner: Record<string, number> = {};
  for (const r of leaderAdded) if (r.primaryOwnerId) addedByOwner[r.primaryOwnerId] = r._count;
  const joinedByOwner: Record<string, number> = {};
  for (const r of leaderJoined) if (r.userId) joinedByOwner[r.userId] = r._count;
  const leaderboard = hrUsers
    .map(u => ({ name: u.name, added: addedByOwner[u.id] ?? 0, joined: joinedByOwner[u.id] ?? 0 }))
    .filter(r => r.added || r.joined)
    .sort((a, b) => (b.joined - a.joined) || (b.added - a.added))
    .slice(0, 8);

  // ── Derive follow-up buckets ──
  const overdueFU = followUps.filter(f => new Date(f.dueAt) < todayStart);
  const todayFU = followUps.filter(f => { const d = new Date(f.dueAt); return d >= todayStart && d < todayEnd; });
  const upcomingFU = followUps.filter(f => new Date(f.dueAt) >= todayEnd).slice(0, 30);

  // Main action list — one row per candidate needing action today (overdue + due today, soonest first).
  const seen = new Set<string>();
  const actionItems = [...overdueFU, ...todayFU]
    .sort((a, b) => +new Date(a.dueAt) - +new Date(b.dueAt))
    .filter(f => { if (seen.has(f.candidateId)) return false; seen.add(f.candidateId); return true; })
    .slice(0, 25);

  // ── Derive interview buckets ──
  const ivToday = interviews.filter(iv => { const d = new Date(iv.scheduledAt); return d >= todayStart && d < todayEnd && (iv.attendanceStatus === "SCHEDULED" || iv.attendanceStatus === "RESCHEDULED"); });
  const confirmPending = interviews.filter(iv => new Date(iv.scheduledAt) >= now && iv.confirmationStatus === "PENDING" && (iv.attendanceStatus === "SCHEDULED" || iv.attendanceStatus === "RESCHEDULED"));
  const noShowSeen = new Set<string>();
  const noShowList = interviews.filter(iv => iv.attendanceStatus === "NO_SHOW").reverse()
    .filter(iv => { if (noShowSeen.has(iv.candidateId)) return false; noShowSeen.add(iv.candidateId); return true; }).slice(0, 10);

  // ── Reminder events ──
  const reminderEvents: HRReminderEvent[] = [
    ...followUps.map(f => ({ id: f.id, candidateId: f.candidateId, candidateName: f.candidate.name, type: FU_EVENT[f.type]?.type ?? "FOLLOWUP", label: FU_EVENT[f.type]?.label ?? "Follow-up", timeIso: new Date(f.dueAt).toISOString(), ownerName: f.candidate.primaryOwner?.name ?? null })),
    ...interviews.filter(iv => iv.attendanceStatus === "SCHEDULED" || iv.attendanceStatus === "RESCHEDULED").map(iv => ({ id: iv.id, candidateId: iv.candidateId, candidateName: iv.candidate.name, type: "INTERVIEW" as HREventType, label: `${fmt(iv.type)} Interview`, timeIso: new Date(iv.scheduledAt).toISOString(), ownerName: iv.candidate.primaryOwner?.name ?? null })),
  ];

  const toFU = (f: typeof followUps[number]): FU => ({ id: f.id, candidateId: f.candidateId, candidateName: f.candidate.name, phone: f.candidate.phone, type: f.type, dueAt: new Date(f.dueAt).toISOString(), notes: f.notes });

  const metrics = [
    { label: "New Candidates", n: newCount, href: "/hr/candidates?status=NEW", Icon: UserPlus, color: "border-blue-400 text-blue-700 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-500/60" },
    { label: "Calls Due Today", n: todayFU.length, href: "#action", Icon: Phone, color: "border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-500/60" },
    { label: "Interviews Today", n: ivToday.length, href: "#interviews", Icon: Target, color: "border-indigo-400 text-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-500/60" },
    { label: "Confirmations Pending", n: confirmPending.length, href: "#interviews", Icon: CheckCircle2, color: "border-orange-400 text-orange-700 bg-orange-50 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-500/60" },
    { label: "Overdue Follow-Ups", n: overdueFU.length, href: "#followups", Icon: AlertTriangle, color: "border-red-400 text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300 dark:border-red-500/60" },
    { label: "No-Shows", n: noShowList.length, href: "#noshow", Icon: Ban, color: "border-rose-400 text-rose-700 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-500/60" },
    { label: "Expected Joinings", n: expectedList.length, href: "#joinings", Icon: Handshake, color: "border-green-400 text-green-700 bg-green-50 dark:bg-green-900/20 dark:text-green-300 dark:border-green-500/60" },
    { label: "No Next Action", n: noNextActionCount, href: "#nonext", Icon: Inbox, color: "border-slate-400 text-slate-700 bg-slate-50 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-600" },
  ];

  const wa = (p: string | null, alt: string | null) => { const x = p ?? alt; return x ? `https://wa.me/${x.replace(/\D/g, "")}` : null; };

  // Spec cards — "today at a glance" (Lucide icons for new UI).
  const specCards = [
    { label: "Today's Calls", n: todaysCalls, href: "#action", Icon: Phone, color: "text-blue-600" },
    { label: "Interviews Today", n: ivToday.length, href: "#interviews", Icon: CalendarCheck, color: "text-indigo-600" },
    { label: "Pending Confirmations", n: confirmPending.length, href: "#interviews", Icon: CheckCircle2, color: "text-orange-600" },
    { label: "Offers Pending", n: offersPending, href: "/hr/candidates?status=OFFER_RELEASED", Icon: FileText, color: "text-amber-600" },
    { label: "Expected Joinings", n: expectedList.length, href: "#joinings", Icon: Handshake, color: "text-green-600" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          {now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening"}, {me.name.split(" ")[0]}
        </h1>
        <Link href="/hr/candidates/new" className="inline-flex items-center gap-2 bg-[#1a2e4a] text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#243d60] transition">
          <UserPlus className="w-4 h-4" /> Add Candidate
        </Link>
      </div>

      {/* Today at a glance — spec cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        {specCards.map(c => (
          <a key={c.label} href={c.href} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 hover:shadow-md transition flex items-center gap-3">
            <div className={`shrink-0 ${c.color}`}><c.Icon className="w-6 h-6" /></div>
            <div className="min-w-0">
              <div className="text-2xl font-extrabold text-gray-800 dark:text-white leading-none">{c.n}</div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-1 truncate">{c.label}</div>
            </div>
          </a>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* ── LEFT: action content ── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Top summary bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {metrics.map(m => (
              <a key={m.label} href={m.href} className={`rounded-xl border-l-4 ${m.color} p-3 hover:shadow-md transition`}>
                <div className="text-2xl font-extrabold text-gray-800 dark:text-white">{m.n}</div>
                <div className="text-[10px] text-gray-600 dark:text-slate-300 mt-0.5 flex items-center gap-1">
                  <m.Icon className="w-3 h-3 shrink-0" /> {m.label}
                </div>
              </a>
            ))}
          </div>

          {/* Main action list */}
          <section id="action" className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-gray-400" /> Who to call now ({actionItems.length})
            </div>
            {actionItems.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <CheckCircle2 className="w-7 h-7 mx-auto text-emerald-400 mb-2" />
                <div className="text-xs text-gray-400 dark:text-slate-500">Nothing due — you&apos;re all caught up.</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                    {["Candidate", "Phone", "Status", "Next Action", "Due", "Owner", "Actions"].map(h => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {actionItems.map(f => {
                      const due = new Date(f.dueAt); const overdue = due < todayStart;
                      const waHref = wa(f.candidate.whatsappPhone, f.candidate.phone);
                      return (
                        <tr key={f.id} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/50">
                          <td className="px-3 py-2"><Link href={`/hr/candidates/${f.candidateId}`} className="font-semibold text-[#1a2e4a] dark:text-blue-400 hover:underline">{f.candidate.name}</Link></td>
                          <td className="px-3 py-2 text-xs text-gray-600 dark:text-slate-300 whitespace-nowrap">{f.candidate.phone ?? "—"}</td>
                          <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor(f.candidate.status)}`}>{statusLabel(f.candidate.status)}</span></td>
                          <td className="px-3 py-2 text-xs text-gray-600 dark:text-slate-300 max-w-[140px] truncate">{f.candidate.nextAction ?? fmt(f.type)}</td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap"><span className={overdue ? "text-red-600 dark:text-red-400 font-semibold inline-flex items-center gap-1" : "text-amber-600 dark:text-amber-400"}>{overdue && <AlertTriangle className="w-3 h-3" />}{fmtTime(due)}</span></td>
                          <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">{f.candidate.primaryOwner?.name?.split(" ")[0] ?? "—"}</td>
                          <td className="px-3 py-2"><div className="flex items-center gap-1">
                            {f.candidate.phone && <ActionIconButton action="call" href={`tel:${f.candidate.phone}`} />}
                            {waHref && <ActionIconButton action="whatsapp" href={waHref} external />}
                            <Link href={`/hr/candidates/${f.candidateId}?do=interview`} title="Schedule" className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30"><CalendarCheck className="w-4 h-4" /></Link>
                            <Link href={`/hr/candidates/${f.candidateId}?do=note`} title="Note" className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"><FileText className="w-4 h-4" /></Link>
                          </div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* No Next Action — fresh candidates needing a first follow-up */}
          <section id="nonext" className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200 flex items-center gap-2">
              <Inbox className="w-4 h-4 text-gray-400" /> No Next Action — needs a first follow-up ({noNextActionCount})
            </div>
            {noNextAction.length === 0 ? <div className="px-4 py-6 text-center text-xs text-gray-400 dark:text-slate-500">Every active candidate has a next action.</div> : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {noNextAction.map(c => {
                  const waHref = wa(c.whatsappPhone, c.phone);
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <Link href={`/hr/candidates/${c.id}`} className="text-sm font-semibold text-gray-800 dark:text-slate-100 hover:underline">{c.name}</Link>
                        <div className="text-[11px] text-gray-500 dark:text-slate-400">{[c.positionApplied, statusLabel(c.status)].filter(Boolean).join(" · ") || "—"}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-500/50 dark:text-blue-300 dark:hover:bg-blue-900/30"><Phone className="w-3 h-3" /> Call</a>}
                        {waHref && <a href={waHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 dark:border-green-500/50 dark:text-green-300 dark:hover:bg-green-900/30"><MessageCircle className="w-3 h-3" /> WA</a>}
                        <Link href={`/hr/candidates/${c.id}?do=followup`} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-500/50 dark:text-amber-300 dark:hover:bg-amber-900/30"><CalendarCheck className="w-3 h-3" /> Schedule</Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {noNextActionCount > noNextAction.length && (
              <div className="px-4 py-2 border-t border-gray-100 dark:border-slate-800 text-center">
                <Link href="/hr/candidates" className="text-xs font-medium text-[#1a2e4a] dark:text-blue-400 hover:underline">
                  Showing {noNextAction.length} of {noNextActionCount} — open Candidates to select all &amp; bulk-set a follow-up date →
                </Link>
              </div>
            )}
          </section>

          {/* Follow-up tabs */}
          <section id="followups"><HRFollowUpTabs today={todayFU.map(toFU)} overdue={overdueFU.map(toFU)} upcoming={upcomingFU.map(toFU)} /></section>

          {/* Today's interviews */}
          <section id="interviews" className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200 flex items-center gap-2">
              <Target className="w-4 h-4 text-gray-400" /> Today&apos;s Interviews ({ivToday.length})
            </div>
            {ivToday.length === 0 ? <div className="px-4 py-6 text-center text-xs text-gray-400 dark:text-slate-500">No interviews scheduled today.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  {["Candidate", "Position", "Time", "Interviewer", "Status"].map(h => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {ivToday.map(iv => (
                    <tr key={iv.id} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2"><Link href={`/hr/candidates/${iv.candidateId}`} className="font-medium text-[#1a2e4a] dark:text-blue-400 hover:underline">{iv.candidate.name}</Link></td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-slate-300">{iv.candidate.positionApplied ?? "—"}</td>
                      <td className="px-3 py-2 text-xs font-medium whitespace-nowrap text-gray-700 dark:text-slate-200">{fmtTime(new Date(iv.scheduledAt))}</td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">{iv.interviewer?.name?.split(" ")[0] ?? "—"}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${iv.confirmationStatus === "CONFIRMED" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>{fmt(iv.confirmationStatus)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>

          {/* No-show recovery */}
          <section id="noshow" className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200 flex items-center gap-2">
              <Ban className="w-4 h-4 text-gray-400" /> No-Show Recovery ({noShowList.length})
            </div>
            {noShowList.length === 0 ? <div className="px-4 py-6 text-center text-xs text-gray-400 dark:text-slate-500">No pending no-shows.</div> : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {noShowList.map(iv => {
                  const waHref = wa(iv.candidate.phone, null);
                  return (
                    <div key={iv.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <Link href={`/hr/candidates/${iv.candidateId}`} className="text-sm font-semibold text-gray-800 dark:text-slate-100 hover:underline">{iv.candidate.name}</Link>
                        <div className="text-[11px] text-gray-500 dark:text-slate-400">Missed {fmt(iv.type)} on {fmtDate(new Date(iv.scheduledAt))}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {iv.candidate.phone && <a href={`tel:${iv.candidate.phone}`} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-500/50 dark:text-blue-300 dark:hover:bg-blue-900/30"><Phone className="w-3 h-3" /> Call</a>}
                        {waHref && <a href={waHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 dark:border-green-500/50 dark:text-green-300 dark:hover:bg-green-900/30"><MessageCircle className="w-3 h-3" /> WA</a>}
                        <Link href={`/hr/candidates/${iv.candidateId}?do=interview`} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-500/50 dark:text-purple-300 dark:hover:bg-purple-900/30"><RotateCcw className="w-3 h-3" /> Reschedule</Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Expected joinings */}
          <section id="joinings" className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200 flex items-center gap-2">
              <Handshake className="w-4 h-4 text-gray-400" /> Expected Joinings ({expectedList.length})
            </div>
            {expectedList.length === 0 ? <div className="px-4 py-6 text-center text-xs text-gray-400 dark:text-slate-500">No expected joinings yet — set a joining date on offered candidates.</div> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                  {["Candidate", "Joining Date", "Position", "Offer Status"].map(h => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {expectedList.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/50">
                      <td className="px-3 py-2"><Link href={`/hr/candidates/${c.id}`} className="font-medium text-[#1a2e4a] dark:text-blue-400 hover:underline">{c.name}</Link></td>
                      <td className="px-3 py-2 text-xs font-medium whitespace-nowrap text-gray-700 dark:text-slate-200">{c.joiningDate ? fmtDate(new Date(c.joiningDate)) : "—"}</td>
                      <td className="px-3 py-2 text-xs text-gray-600 dark:text-slate-300">{c.positionApplied ?? "—"}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor(c.status)}`}>{statusLabel(c.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>
        </div>

        {/* ── RIGHT: sticky reminders + activity + leaderboard ── */}
        <div className="lg:sticky lg:top-4 lg:self-start space-y-4">
          <HRRemindersCard events={reminderEvents} todayIso={todayIso} showOwner={perms.viewAllCandidates} />

          {/* Recruiter leaderboard (Admin / Senior HR) */}
          {isLeader && (
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200">Leaderboard — this week</div>
              {leaderboard.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-gray-400 dark:text-slate-500">No recruiter activity this week yet.</div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-slate-800">
                  {leaderboard.map((r, i) => (
                    <div key={r.name} className="flex items-center gap-3 px-4 py-2">
                      <div className={`w-5 text-center text-xs font-bold ${i === 0 ? "text-amber-500" : i === 1 ? "text-slate-400" : i === 2 ? "text-orange-400" : "text-gray-300"}`}>{i + 1}</div>
                      <div className="flex-1 min-w-0 text-sm font-medium text-gray-800 dark:text-slate-200 truncate">{r.name}</div>
                      <div className="text-[11px] text-gray-500 dark:text-slate-400 whitespace-nowrap">
                        <span className="font-semibold text-teal-700 dark:text-teal-400">{r.added}</span> added
                        <span className="mx-1 text-gray-300 dark:text-slate-600">·</span>
                        <span className="font-semibold text-green-700 dark:text-green-400">{r.joined}</span> joined
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Recent activities feed */}
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200 flex items-center gap-2">
              <Activity className="w-4 h-4 text-gray-400" /> Recent Activity
            </div>
            {recentActivities.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-gray-400 dark:text-slate-500">No recent activity.</div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-800">
                {recentActivities.map(a => (
                  <div key={a.id} className="px-4 py-2">
                    <div className="text-xs text-gray-700 dark:text-slate-200">
                      <span className="font-medium">{ACTIVITY_LABEL[a.type] ?? fmt(a.type)}</span>
                      {" · "}
                      <Link href={`/hr/candidates/${a.candidateId}`} className="text-[#1a2e4a] dark:text-blue-400 hover:underline">{a.candidate.name}</Link>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {a.user?.name?.split(" ")[0] ? `${a.user.name.split(" ")[0]} · ` : ""}{fmtDate(new Date(a.createdAt))} {fmtTime(new Date(a.createdAt))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
