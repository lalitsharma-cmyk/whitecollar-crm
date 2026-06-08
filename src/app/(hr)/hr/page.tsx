import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import HRFollowUpActions from "@/components/HRFollowUpActions";

export const dynamic = "force-dynamic";

function todayRangeIST() {
  const now = new Date();
  const istStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const start = new Date(istStr + "T00:00:00+05:30");
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { start, end, tomorrowEnd: new Date(start.getTime() + 48 * 3600_000) };
}
function fmtTime(d: Date) { return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }); }
function fmtDay(d: Date) { return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }); }
function fmt(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

const CLOSED_OR_DONE = [
  "NOT_INTERESTED", "NOT_SUITABLE", "HIGH_SALARY", "OTHER_PROFILE", "REJECTED",
  "OFFER_DECLINED", "WRONG_NUMBER", "SWITCH_OFF", "NEVER_RESPONSE", "NOT_RESPONDING", "JOINED",
];

// Inline call / WhatsApp / open-profile actions for interview & no-show rows.
function RowActions({ id, phone }: { id: string; phone: string | null }) {
  return (
    <div className="flex flex-col gap-1.5 shrink-0">
      {phone && (
        <a href={`tel:${phone}`} className="text-[11px] px-2.5 py-1 rounded-lg border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 text-center">📞 Call</a>
      )}
      {phone && (
        <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
          className="text-[11px] px-2.5 py-1 rounded-lg border border-green-300 bg-white text-green-700 hover:bg-green-50 text-center">💬 WA</a>
      )}
      <Link href={`/hr/candidates/${id}`} className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 text-center">Open →</Link>
    </div>
  );
}

function Section({ emoji, title, count, accent, empty, moreHref, moreCount, children }: {
  emoji: string; title: string; count: number; accent: string; empty: string;
  moreHref?: string; moreCount?: number; children?: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div className={`flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 ${accent}`}>
        <h2 className="text-sm font-bold flex items-center gap-2">{emoji} {title}</h2>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/70 dark:bg-slate-800 text-gray-700 dark:text-slate-200">{count}</span>
      </div>
      {count === 0 ? (
        <div className="px-4 py-5 text-center text-xs text-gray-400">{empty}</div>
      ) : (
        <>
          <div className="divide-y divide-gray-100 dark:divide-slate-800">{children}</div>
          {moreHref && moreCount && moreCount > 0 && (
            <Link href={moreHref} className="block text-center text-[11px] text-blue-600 hover:underline py-2 border-t border-gray-100 dark:border-slate-800">
              View all {moreCount}+ →
            </Link>
          )}
        </>
      )}
    </section>
  );
}

export default async function HRDashboard() {
  const me = await requireUser();
  const { start: todayStart, end: todayEnd, tomorrowEnd } = todayRangeIST();
  const scope = me.role === "AGENT" ? { OR: [{ primaryOwnerId: me.id }, { secondaryOwnerId: me.id }] } : {};

  const [todayInterviews, confirmSoon, dueToday, overdue, noShows, pipe] = await Promise.all([
    prisma.hRInterview.findMany({
      where: { scheduledAt: { gte: todayStart, lt: todayEnd }, attendanceStatus: { in: ["SCHEDULED", "RESCHEDULED"] }, candidate: scope },
      orderBy: { scheduledAt: "asc" }, take: 30,
      include: { candidate: { select: { id: true, name: true, phone: true } }, interviewer: { select: { name: true } } },
    }),
    prisma.hRInterview.findMany({
      where: { scheduledAt: { gte: todayStart, lt: tomorrowEnd }, confirmationStatus: "PENDING", attendanceStatus: { in: ["SCHEDULED", "RESCHEDULED"] }, candidate: scope },
      orderBy: { scheduledAt: "asc" }, take: 30,
      include: { candidate: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.hRFollowUp.findMany({
      where: { completedAt: null, dueAt: { gte: todayStart, lt: todayEnd }, candidate: scope },
      orderBy: { dueAt: "asc" }, take: 30,
      include: { candidate: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.hRFollowUp.findMany({
      where: { completedAt: null, dueAt: { lt: todayStart }, candidate: scope },
      orderBy: { dueAt: "asc" }, take: 30,
      include: { candidate: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.hRInterview.findMany({
      where: { attendanceStatus: "NO_SHOW", candidate: { ...scope, status: { notIn: CLOSED_OR_DONE as never[] } } },
      orderBy: { scheduledAt: "desc" }, take: 20,
      include: { candidate: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.hRCandidate.groupBy({ by: ["status"], where: scope, _count: true }),
  ]);

  const total = todayInterviews.length + confirmSoon.length + dueToday.length + overdue.length + noShows.length;
  const pmap: Record<string, number> = {};
  for (const p of pipe) pmap[p.status] = p._count;
  const glance: [string, string][] = [["NEW", "New"], ["PIPELINE", "Pipeline"], ["SHORTLISTED", "Shortlisted"], ["OFFER_RELEASED", "Offers"], ["JOINED", "Joined"]];

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, {me.name.split(" ")[0]} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {total > 0 ? <><b className="text-gray-700 dark:text-slate-200">{total}</b> {total === 1 ? "thing needs" : "things need"} your attention today</> : "You're all caught up 🎉"}
          </p>
        </div>
        <Link href="/hr/candidates/new"
          className="inline-flex items-center gap-2 bg-[#1a2e4a] text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#243d60] transition shrink-0">
          + Add Candidate
        </Link>
      </div>

      {/* 1 — Interviews scheduled today */}
      <Section emoji="🎯" title="Interviews Today" count={todayInterviews.length} accent="bg-indigo-50 dark:bg-indigo-900/20"
        empty="No interviews scheduled today.">
        {todayInterviews.map(iv => (
          <div key={iv.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="text-xs font-bold text-indigo-700 dark:text-indigo-300 w-16 shrink-0">{fmtTime(iv.scheduledAt)}</div>
            <div className="flex-1 min-w-0">
              <Link href={`/hr/candidates/${iv.candidateId}`} className="text-sm font-semibold text-gray-800 dark:text-slate-100 hover:underline">{iv.candidate.name}</Link>
              <div className="text-[11px] text-gray-500 flex flex-wrap gap-x-2">
                <span>{fmt(iv.type)} interview</span>
                {iv.interviewer && <span>· {iv.interviewer.name}</span>}
                <span className={iv.confirmationStatus === "CONFIRMED" ? "text-green-600" : "text-amber-600"}>· {fmt(iv.confirmationStatus)}</span>
              </div>
            </div>
            <RowActions id={iv.candidateId} phone={iv.candidate.phone} />
          </div>
        ))}
      </Section>

      {/* 2 — Candidates requiring confirmation */}
      <Section emoji="✅" title="Need Confirmation" count={confirmSoon.length} accent="bg-orange-50 dark:bg-orange-900/20"
        empty="All upcoming interviews are confirmed.">
        {confirmSoon.map(iv => (
          <div key={iv.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="text-[11px] font-semibold text-orange-700 dark:text-orange-300 w-16 shrink-0">{fmtDay(iv.scheduledAt)}<br />{fmtTime(iv.scheduledAt)}</div>
            <div className="flex-1 min-w-0">
              <Link href={`/hr/candidates/${iv.candidateId}`} className="text-sm font-semibold text-gray-800 dark:text-slate-100 hover:underline">{iv.candidate.name}</Link>
              <div className="text-[11px] text-gray-500">{fmt(iv.type)} interview · needs confirming</div>
            </div>
            <RowActions id={iv.candidateId} phone={iv.candidate.phone} />
          </div>
        ))}
      </Section>

      {/* 3 — Follow-ups due today */}
      <Section emoji="📅" title="Follow-ups Due Today" count={dueToday.length} accent="bg-amber-50 dark:bg-amber-900/20"
        empty="No follow-ups due today." moreHref="/hr/followups?filter=today" moreCount={dueToday.length === 30 ? 30 : 0}>
        {dueToday.map(fu => (
          <div key={fu.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="text-xs font-bold text-amber-700 dark:text-amber-300 w-16 shrink-0">{fmtTime(fu.dueAt)}</div>
            <div className="flex-1 min-w-0">
              <Link href={`/hr/candidates/${fu.candidateId}`} className="text-sm font-semibold text-gray-800 dark:text-slate-100 hover:underline">{fu.candidate.name}</Link>
              <div className="text-[11px] text-gray-500">{fmt(fu.type)}{fu.notes ? ` · ${fu.notes}` : ""}</div>
            </div>
            <HRFollowUpActions followUpId={fu.id} candidateId={fu.candidateId} phone={fu.candidate.phone} />
          </div>
        ))}
      </Section>

      {/* 4 — Overdue follow-ups */}
      <Section emoji="⚠️" title="Overdue Follow-ups" count={overdue.length} accent="bg-red-50 dark:bg-red-900/20"
        empty="Nothing overdue — great work." moreHref="/hr/followups?filter=overdue" moreCount={overdue.length === 30 ? 30 : 0}>
        {overdue.map(fu => (
          <div key={fu.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="text-[11px] font-bold text-red-600 dark:text-red-300 w-16 shrink-0">{fmtDay(fu.dueAt)}<br />{fmtTime(fu.dueAt)}</div>
            <div className="flex-1 min-w-0">
              <Link href={`/hr/candidates/${fu.candidateId}`} className="text-sm font-semibold text-gray-800 dark:text-slate-100 hover:underline">{fu.candidate.name}</Link>
              <div className="text-[11px] text-gray-500">{fmt(fu.type)}{fu.notes ? ` · ${fu.notes}` : ""}</div>
            </div>
            <HRFollowUpActions followUpId={fu.id} candidateId={fu.candidateId} phone={fu.candidate.phone} />
          </div>
        ))}
      </Section>

      {/* 5 — No-show recovery */}
      <Section emoji="🚫" title="No-Show Recovery" count={noShows.length} accent="bg-rose-50 dark:bg-rose-900/20"
        empty="No pending no-shows.">
        {noShows.map(iv => (
          <div key={iv.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="text-[11px] font-semibold text-rose-600 dark:text-rose-300 w-16 shrink-0">Missed<br />{fmtDay(iv.scheduledAt)}</div>
            <div className="flex-1 min-w-0">
              <Link href={`/hr/candidates/${iv.candidateId}`} className="text-sm font-semibold text-gray-800 dark:text-slate-100 hover:underline">{iv.candidate.name}</Link>
              <div className="text-[11px] text-gray-500">{fmt(iv.type)} interview · no-show, needs recovery</div>
            </div>
            <RowActions id={iv.candidateId} phone={iv.candidate.phone} />
          </div>
        ))}
      </Section>

      {/* Slim pipeline glance (secondary) */}
      <div className="flex flex-wrap gap-2 pt-1">
        {glance.map(([k, label]) => (
          <Link key={k} href={`/hr/candidates?status=${k}`}
            className="text-[11px] px-3 py-1.5 rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 hover:border-gray-300">
            {label} <b className="text-gray-800 dark:text-white">{pmap[k] ?? 0}</b>
          </Link>
        ))}
        <Link href="/hr/reports" className="text-[11px] px-3 py-1.5 rounded-full text-gray-400 hover:text-gray-600">Full reports →</Link>
      </div>
    </div>
  );
}
