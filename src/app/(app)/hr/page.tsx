import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

const IST = "Asia/Kolkata";

function startOfDayIST(d: Date): Date {
  const s = new Date(d.toLocaleDateString("en-CA", { timeZone: IST }) + "T00:00:00+05:30");
  return s;
}

export default async function HRPage() {
  const me = await requireUser();

  const now = new Date();
  const todayStart = startOfDayIST(now);
  const todayEnd = new Date(todayStart.getTime() + 24 * 3600_000);
  const tomorrowEnd = new Date(todayStart.getTime() + 48 * 3600_000);

  const scope = me.role === "AGENT"
    ? { OR: [{ primaryOwnerId: me.id }, { secondaryOwnerId: me.id }] }
    : {};

  const [
    todayFollowUps, overdueFollowUps, todayInterviews, tomorrowInterviews,
    pendingConfirmations, pipeline, offersOut, expectedJoinings,
    totalActive, recentActivities,
  ] = await Promise.all([
    prisma.hRFollowUp.count({ where: { completedAt: null, dueAt: { gte: todayStart, lt: todayEnd }, candidate: scope } }),
    prisma.hRFollowUp.count({ where: { completedAt: null, dueAt: { lt: todayStart }, candidate: scope } }),
    prisma.hRInterview.count({ where: { scheduledAt: { gte: todayStart, lt: todayEnd }, attendanceStatus: "SCHEDULED", candidate: scope } }),
    prisma.hRInterview.count({ where: { scheduledAt: { gte: todayEnd, lt: tomorrowEnd }, attendanceStatus: "SCHEDULED", candidate: scope } }),
    prisma.hRInterview.count({ where: { scheduledAt: { gte: now }, confirmationStatus: "PENDING", candidate: scope } }),
    prisma.hRCandidate.count({ where: { status: "PIPELINE", ...scope } }),
    prisma.hRCandidate.count({ where: { status: "OFFER_RELEASED", ...scope } }),
    prisma.hRCandidate.count({ where: { status: "SHORTLISTED", ...scope } }),
    prisma.hRCandidate.count({ where: { status: { notIn: ["NOT_INTERESTED","NOT_SUITABLE","HIGH_SALARY","OTHER_PROFILE","REJECTED","OFFER_DECLINED","WRONG_NUMBER","SWITCH_OFF","NEVER_RESPONSE","NOT_RESPONDING","JOINED"] as never[] }, ...scope } }),
    prisma.hRActivity.findMany({
      where: { candidate: scope },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { candidate: { select: { id: true, name: true } }, user: { select: { name: true } } },
    }),
  ]);

  const tiles = [
    { label: "Today's Follow-Ups",    count: todayFollowUps,       color: "border-amber-400 bg-amber-50", href: "/hr/candidates?followup=today", emoji: "📅" },
    { label: "Overdue Follow-Ups",     count: overdueFollowUps,     color: "border-red-400 bg-red-50",    href: "/hr/candidates?followup=overdue", emoji: "⚠️" },
    { label: "Today's Interviews",     count: todayInterviews,      color: "border-blue-400 bg-blue-50",  href: "/hr/candidates?interview=today", emoji: "🎯" },
    { label: "Tomorrow's Interviews",  count: tomorrowInterviews,   color: "border-indigo-400 bg-indigo-50", href: "/hr/candidates?interview=tomorrow", emoji: "📆" },
    { label: "Pending Confirmations",  count: pendingConfirmations, color: "border-orange-400 bg-orange-50", href: "/hr/candidates?confirmation=pending", emoji: "✅" },
    { label: "Pipeline",               count: pipeline,             color: "border-emerald-400 bg-emerald-50", href: "/hr/candidates?status=PIPELINE", emoji: "🔄" },
    { label: "Offers Out",             count: offersOut,            color: "border-purple-400 bg-purple-50", href: "/hr/candidates?status=OFFER_RELEASED", emoji: "📄" },
    { label: "Expected Joinings",      count: expectedJoinings,     color: "border-teal-400 bg-teal-50",  href: "/hr/candidates?status=SHORTLISTED", emoji: "🤝" },
  ];

  const activityLabel: Record<string, string> = {
    CALL_CONNECTED: "📞 Call connected",
    CALL_NOT_ANSWERED: "📵 No answer",
    CALL_BUSY: "⏳ Busy",
    CALL_SWITCHED_OFF: "📴 Switched off",
    WHATSAPP_SENT: "💬 WhatsApp sent",
    WHATSAPP_RECEIVED: "💬 WA reply received",
    INTERVIEW_SCHEDULED: "🎯 Interview scheduled",
    INTERVIEW_ATTENDED: "✅ Interview attended",
    INTERVIEW_NO_SHOW: "⚠️ No-show",
    OFFER_RELEASED: "📄 Offer released",
    CANDIDATE_JOINED: "🎉 Joined",
    STATUS_CHANGED: "🔄 Status changed",
    NOTE_ADDED: "📝 Note added",
    FOLLOWUP_CREATED: "📅 Follow-up set",
    FOLLOWUP_COMPLETED: "✔ Follow-up done",
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">HR Recruitment</h1>
          <p className="text-sm text-gray-500">Welcome back, {me.name.split(" ")[0]}</p>
        </div>
        <Link href="/hr/candidates/new" className="btn btn-primary text-sm">
          + Add Candidate
        </Link>
      </div>

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map(t => (
          <Link key={t.label} href={t.href}
            className={`card p-4 border-l-4 ${t.color} hover:shadow-md transition text-center`}>
            <div className="text-2xl font-extrabold text-gray-800">{t.count}</div>
            <div className="text-[11px] text-gray-600 mt-0.5">{t.emoji} {t.label}</div>
          </Link>
        ))}
      </div>

      {/* Total active + quick nav */}
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <span className="text-gray-600">
          <b className="text-gray-900">{totalActive}</b> active candidates total
        </span>
        <Link href="/hr/candidates" className="text-blue-600 hover:underline">View all →</Link>
        <Link href="/hr/candidates?closed=1" className="text-gray-400 hover:underline text-xs">Include closed</Link>
      </div>

      {/* Recent Activity */}
      {recentActivities.length > 0 && (
        <div className="card p-4">
          <h2 className="font-semibold text-sm mb-3 text-gray-700 dark:text-slate-200">Recent Activity</h2>
          <div className="space-y-2">
            {recentActivities.map(a => (
              <Link key={a.id} href={`/hr/candidates/${a.candidateId}`}
                className="flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-slate-800 p-1.5 rounded-lg transition">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-gray-800 dark:text-slate-200">{a.candidate.name}</span>
                  <span className="text-xs text-gray-500 ml-1.5">{activityLabel[a.type] ?? a.type.replace(/_/g," ")}</span>
                  {a.notes && <p className="text-[11px] text-gray-500 truncate mt-0.5">{a.notes}</p>}
                </div>
                <div className="text-[10px] text-gray-400 shrink-0 mt-0.5">
                  {a.user?.name?.split(" ")[0]} · {a.createdAt.toLocaleDateString("en-IN", { day:"numeric",month:"short" })}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
