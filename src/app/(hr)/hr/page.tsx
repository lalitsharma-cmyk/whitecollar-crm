import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

function todayRangeIST() {
  const now = new Date();
  const istStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const start = new Date(istStr + "T00:00:00+05:30");
  const end   = new Date(start.getTime() + 24 * 3600_000);
  return { start, end, tomorrow: new Date(start.getTime() + 48 * 3600_000) };
}

export default async function HRDashboard() {
  const me = await requireUser();
  const { start: todayStart, end: todayEnd, tomorrow: tomorrowEnd } = todayRangeIST();

  const scope = me.role === "AGENT"
    ? { OR: [{ primaryOwnerId: me.id }, { secondaryOwnerId: me.id }] }
    : {};

  const [
    newCount, notCalledCount, todayFU, overdueFU, todayIV, tomorrowIV,
    pendingConfirm, noShows, shortlisted, offersOut, expectedJoin,
    noNextAction, recentActivity,
  ] = await Promise.all([
    prisma.hRCandidate.count({ where: { status: "NEW", ...scope } }),
    prisma.hRCandidate.count({ where: { status: "NOT_CALLED", ...scope } }),
    prisma.hRFollowUp.count({ where: { completedAt: null, dueAt: { gte: todayStart, lt: todayEnd }, candidate: scope } }),
    prisma.hRFollowUp.count({ where: { completedAt: null, dueAt: { lt: todayStart }, candidate: scope } }),
    prisma.hRInterview.count({ where: { scheduledAt: { gte: todayStart, lt: todayEnd }, attendanceStatus: "SCHEDULED", candidate: scope } }),
    prisma.hRInterview.count({ where: { scheduledAt: { gte: todayEnd, lt: tomorrowEnd }, attendanceStatus: "SCHEDULED", candidate: scope } }),
    prisma.hRInterview.count({ where: { scheduledAt: { gte: new Date() }, confirmationStatus: "PENDING", candidate: scope } }),
    prisma.hRInterview.count({ where: { attendanceStatus: "NO_SHOW", candidate: scope } }),
    prisma.hRCandidate.count({ where: { status: "SHORTLISTED", ...scope } }),
    prisma.hRCandidate.count({ where: { status: "OFFER_RELEASED", ...scope } }),
    prisma.hRCandidate.count({ where: { status: { in: ["SHORTLISTED", "OFFER_RELEASED"] as const }, ...scope } }),
    prisma.hRCandidate.count({
      where: {
        ...scope,
        status: { notIn: ["NOT_INTERESTED","NOT_SUITABLE","HIGH_SALARY","OTHER_PROFILE","REJECTED","OFFER_DECLINED","WRONG_NUMBER","SWITCH_OFF","NEVER_RESPONSE","NOT_RESPONDING","JOINED"] as never[] },
        nextActionDate: null,
      },
    }),
    prisma.hRActivity.findMany({
      where: { candidate: scope },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { candidate: { select: { id: true, name: true } }, user: { select: { name: true } } },
    }),
  ]);

  const tiles = [
    { label: "New Candidates",          count: newCount,       href: "/hr/candidates?status=NEW",            color: "border-blue-400 text-blue-700",    bg: "bg-blue-50",    emoji: "🆕" },
    { label: "Not Called By HR",         count: notCalledCount, href: "/hr/candidates?status=NOT_CALLED",     color: "border-slate-400 text-slate-700",  bg: "bg-slate-50",   emoji: "📵" },
    { label: "Today's Follow-Ups",       count: todayFU,        href: "/hr/followups?filter=today",           color: "border-amber-400 text-amber-700",  bg: "bg-amber-50",   emoji: "📅" },
    { label: "Overdue Follow-Ups",       count: overdueFU,      href: "/hr/missed",                           color: "border-red-400 text-red-700",      bg: "bg-red-50",     emoji: "⚠️",  urgent: overdueFU > 0 },
    { label: "Today's Interviews",       count: todayIV,        href: "/hr/interviews?filter=today",          color: "border-indigo-400 text-indigo-700",bg: "bg-indigo-50",  emoji: "🎯" },
    { label: "Tomorrow's Interviews",    count: tomorrowIV,     href: "/hr/interviews?filter=tomorrow",       color: "border-violet-400 text-violet-700",bg: "bg-violet-50",  emoji: "📆" },
    { label: "Pending Confirmations",    count: pendingConfirm, href: "/hr/interviews?filter=pending-confirm",color: "border-orange-400 text-orange-700",bg: "bg-orange-50",  emoji: "✅" },
    { label: "No Shows",                 count: noShows,        href: "/hr/missed?filter=no-show",            color: "border-rose-400 text-rose-700",    bg: "bg-rose-50",    emoji: "🚫" },
    { label: "Shortlisted",              count: shortlisted,    href: "/hr/candidates?status=SHORTLISTED",    color: "border-teal-400 text-teal-700",    bg: "bg-teal-50",    emoji: "⭐" },
    { label: "Offers Released",          count: offersOut,      href: "/hr/candidates?status=OFFER_RELEASED", color: "border-purple-400 text-purple-700", bg: "bg-purple-50", emoji: "📄" },
    { label: "Expected Joinings",        count: expectedJoin,   href: "/hr/candidates?status=OFFER_RELEASED", color: "border-green-400 text-green-700",  bg: "bg-green-50",   emoji: "🤝" },
    { label: "No Next Action",           count: noNextAction,   href: "/hr/missed?filter=no-next-action",     color: "border-gray-400 text-gray-700",    bg: "bg-gray-50",    emoji: "❓", urgent: noNextAction > 0 },
  ];

  const actLabel: Record<string, string> = {
    CALL_CONNECTED:"📞 Call connected",CALL_NOT_ANSWERED:"📵 No answer",CALL_BUSY:"⏳ Busy",
    CALL_SWITCHED_OFF:"📴 Switched off",CALL_WRONG_NUMBER:"🚫 Wrong number",CALL_LATER:"🔁 Call later",
    WHATSAPP_SENT:"💬 WhatsApp sent",WHATSAPP_RECEIVED:"💬 WA reply",EMAIL_LOGGED:"📧 Email logged",
    INTERVIEW_SCHEDULED:"🎯 Interview scheduled",INTERVIEW_ATTENDED:"✅ Interview attended",
    INTERVIEW_NO_SHOW:"⚠️ No-show",OFFER_RELEASED:"📄 Offer released",CANDIDATE_JOINED:"🎉 Joined",
    STATUS_CHANGED:"🔄 Status changed",NOTE_ADDED:"📝 Note added",
    FOLLOWUP_CREATED:"📅 Follow-up set",FOLLOWUP_COMPLETED:"✔ Follow-up done",
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {me.name.split(" ")[0]} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">HR Recruitment Dashboard</p>
        </div>
        <Link href="/hr/candidates/new"
          className="inline-flex items-center gap-2 bg-[#1a2e4a] text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#243d60] transition">
          + Add Candidate
        </Link>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tiles.map(t => (
          <Link key={t.label} href={t.href}
            className={`rounded-xl border-l-4 ${t.color} ${t.bg} p-4 hover:shadow-md transition ${t.urgent ? "ring-2 ring-red-300" : ""}`}>
            <div className="text-3xl font-extrabold text-gray-800">{t.count}</div>
            <div className="text-[11px] text-gray-600 mt-0.5">{t.emoji} {t.label}</div>
          </Link>
        ))}
      </div>

      {/* Recent activity */}
      {recentActivity.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-4">
          <h2 className="font-semibold text-sm text-gray-700 dark:text-slate-200 mb-3">Recent Activity</h2>
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {recentActivity.map(a => (
              <Link key={a.id} href={`/hr/candidates/${a.candidateId}`}
                className="flex items-start gap-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800/50 px-1 rounded transition">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-gray-800 dark:text-slate-200">{a.candidate.name}</span>
                  <span className="text-xs text-gray-500 ml-1.5">{actLabel[a.type] ?? a.type.replace(/_/g," ")}</span>
                  {a.notes && <p className="text-[11px] text-gray-400 truncate mt-0.5">{a.notes}</p>}
                </div>
                <div className="text-[10px] text-gray-400 shrink-0 pt-0.5 text-right">
                  <div>{a.user?.name?.split(" ")[0]}</div>
                  <div>{new Date(a.createdAt).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
