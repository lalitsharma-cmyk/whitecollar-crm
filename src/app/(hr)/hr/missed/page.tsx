import { requireHrPage, hrScopeWhere } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import HRFollowUpActions from "@/components/HRFollowUpActions";
import { CLOSED_STATUS_KEYS } from "@/lib/hrStatus";
import { AlertTriangle, HelpCircle, Ban, CheckCircle2, Target, type LucideIcon } from "lucide-react";

export const dynamic = "force-dynamic";

function fmt(s:string){return s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());}

export default async function MissedPage({ searchParams }: { searchParams: Promise<Record<string,string>> }) {
  const { me } = await requireHrPage();
  const sp = await searchParams;
  const now = new Date();
  const filter = sp.filter ?? "all";

  // Scope to candidates the user may see AND that are not soft-deleted.
  const candidateScope = { AND: [hrScopeWhere(me), { deletedAt: null }] };

  const [overdueFollowUps, noNextAction, noShowsPending, pendingConfirm] = await Promise.all([
    prisma.hRFollowUp.findMany({
      where: { completedAt: null, dueAt: { lt: now }, candidate: candidateScope },
      orderBy: { dueAt: "asc" },
      take: 50,
      include: { candidate: { select: { id:true, name:true, phone:true, primaryOwner:{ select:{name:true} } } }, user: { select:{name:true} } },
    }),
    prisma.hRCandidate.findMany({
      where: { AND: [ hrScopeWhere(me), { deletedAt: null, nextActionDate: null, status: { notIn: CLOSED_STATUS_KEYS as never[] } } ] },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: { id:true, name:true, phone:true, status:true, createdAt:true, primaryOwner:{ select:{name:true} } },
    }),
    prisma.hRInterview.findMany({
      where: { attendanceStatus: "NO_SHOW", candidate: candidateScope },
      orderBy: { scheduledAt: "desc" },
      take: 30,
      include: { candidate: { select: { id:true, name:true, phone:true, primaryOwner:{ select:{name:true} } } } },
    }),
    prisma.hRInterview.findMany({
      where: { scheduledAt: { gte: now }, confirmationStatus: "PENDING", candidate: candidateScope },
      orderBy: { scheduledAt: "asc" },
      take: 30,
      include: { candidate: { select: { id:true, name:true, phone:true } } },
    }),
  ]);

  const sections: Array<{ id:string; Icon:LucideIcon; label:string; count:number; urgent:boolean }> = [
    { id:"overdue",  Icon:AlertTriangle, label:"Overdue Follow-Ups",          count: overdueFollowUps.length,  urgent: overdueFollowUps.length > 0 },
    { id:"no-next",  Icon:HelpCircle,    label:"Candidates Without Next Action", count: noNextAction.length,      urgent: false },
    { id:"no-show",  Icon:Ban,           label:"No-Show Recovery Needed",       count: noShowsPending.length,    urgent: noShowsPending.length > 0 },
    { id:"confirm",  Icon:CheckCircle2,  label:"Pending Interview Confirmation", count: pendingConfirm.length,    urgent: pendingConfirm.length > 0 },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Missed Follow-Up Center</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Everything that needs immediate attention</p>
      </div>

      {/* Summary pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {sections.map(s => (
          <a key={s.id} href={`#${s.id}`}
            className={`rounded-xl p-3 border-l-4 text-center cursor-pointer hover:shadow-md transition
              ${s.urgent && s.count > 0 ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/30" : "border-gray-300 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
            <div className={`text-2xl font-extrabold ${s.urgent && s.count > 0 ? "text-red-700 dark:text-red-400" : "text-gray-800 dark:text-white"}`}>
              {s.count}
            </div>
            <div className="text-[11px] text-gray-600 dark:text-slate-400 inline-flex items-center justify-center gap-1">
              <s.Icon className="w-3 h-3" /> {s.label}
            </div>
          </a>
        ))}
      </div>

      {/* ── Overdue Follow-Ups ── */}
      <section id="overdue">
        <h2 className="font-semibold text-sm text-gray-700 dark:text-slate-200 mb-2 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500" /> Overdue Follow-Ups
          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5">{overdueFollowUps.length}</span>
        </h2>
        {overdueFollowUps.length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-slate-500 py-3 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-500" /> None — all follow-ups are on time.</div>
        ) : (
          <div className="space-y-2">
            {overdueFollowUps.map(fu => (
              <div key={fu.id} className="bg-white dark:bg-slate-900 rounded-xl border border-red-200 bg-red-50/20 dark:border-red-900/60 dark:bg-red-950/20 p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <Link href={`/hr/candidates/${fu.candidateId}`} className="font-semibold text-sm text-[#1a2e4a] dark:text-blue-400 hover:underline">{fu.candidate.name}</Link>
                  {fu.candidate.phone && <span className="text-xs text-gray-500 dark:text-slate-400 ml-2">{fu.candidate.phone}</span>}
                  <div className="text-[11px] text-red-600 dark:text-red-400 font-semibold mt-0.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Overdue since {new Date(fu.dueAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                    <span className="text-gray-500 dark:text-slate-400 font-normal ml-1.5">· {fmt(fu.type)}</span>
                  </div>
                  {fu.notes && <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{fu.notes}</div>}
                </div>
                <HRFollowUpActions followUpId={fu.id} candidateId={fu.candidateId} phone={fu.candidate.phone} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── No Next Action ── */}
      <section id="no-next">
        <h2 className="font-semibold text-sm text-gray-700 dark:text-slate-200 mb-2 flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-gray-500 dark:text-slate-400" /> Candidates Without Next Action
          <span className="bg-gray-500 text-white text-[10px] font-bold rounded-full px-1.5">{noNextAction.length}</span>
        </h2>
        {noNextAction.length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-slate-500 py-3 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-500" /> All active candidates have a next action.</div>
        ) : (
          <div className="space-y-2">
            {noNextAction.map(c => (
              <Link key={c.id} href={`/hr/candidates/${c.id}`}
                className="flex items-center gap-3 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-3 hover:shadow-sm transition">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-900 dark:text-white">{c.name}</div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400 flex gap-2 mt-0.5">
                    {c.phone && <span>{c.phone}</span>}
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300">{fmt(c.status)}</span>
                    {c.primaryOwner?.name && <span>Owner: {c.primaryOwner.name.split(" ")[0]}</span>}
                  </div>
                </div>
                <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0">Set action →</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── No-show recovery ── */}
      <section id="no-show">
        <h2 className="font-semibold text-sm text-gray-700 dark:text-slate-200 mb-2 flex items-center gap-2">
          <Ban className="w-4 h-4 text-rose-500" /> No-Show Recovery
          <span className="bg-rose-500 text-white text-[10px] font-bold rounded-full px-1.5">{noShowsPending.length}</span>
        </h2>
        {noShowsPending.length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-slate-500 py-3 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-500" /> No no-shows to recover.</div>
        ) : (
          <div className="space-y-2">
            {noShowsPending.map(iv => (
              <Link key={iv.id} href={`/hr/candidates/${iv.candidateId}`}
                className="flex items-center gap-3 bg-white dark:bg-slate-900 rounded-xl border border-rose-200 bg-rose-50/20 dark:border-rose-900/60 dark:bg-rose-950/20 p-3 hover:shadow-sm transition">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-900 dark:text-white">{iv.candidate.name}</div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 flex items-center gap-1 flex-wrap">
                    <Ban className="w-3 h-3 text-rose-500" /> No-show on {new Date(iv.scheduledAt).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}
                    {" · "}{iv.type.replace(/_/g," ")} interview
                    {iv.candidate.phone && <span className="ml-2">{iv.candidate.phone}</span>}
                  </div>
                </div>
                <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0">Follow up →</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Pending confirmation ── */}
      <section id="confirm">
        <h2 className="font-semibold text-sm text-gray-700 dark:text-slate-200 mb-2 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-orange-500" /> Pending Interview Confirmation
          <span className="bg-orange-500 text-white text-[10px] font-bold rounded-full px-1.5">{pendingConfirm.length}</span>
        </h2>
        {pendingConfirm.length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-slate-500 py-3 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-green-500" /> All interviews are confirmed.</div>
        ) : (
          <div className="space-y-2">
            {pendingConfirm.map(iv => (
              <Link key={iv.id} href={`/hr/candidates/${iv.candidateId}`}
                className="flex items-center gap-3 bg-white dark:bg-slate-900 rounded-xl border border-orange-200 bg-orange-50/20 dark:border-orange-900/60 dark:bg-orange-950/20 p-3 hover:shadow-sm transition">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-900 dark:text-white">{iv.candidate.name}</div>
                  <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 flex items-center gap-1 flex-wrap">
                    <Target className="w-3 h-3" /> {fmt(iv.type)} interview on {new Date(iv.scheduledAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}
                    {iv.candidate.phone && <span className="ml-2">{iv.candidate.phone}</span>}
                  </div>
                </div>
                <span className="text-xs text-blue-600 dark:text-blue-400 shrink-0">Confirm →</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
