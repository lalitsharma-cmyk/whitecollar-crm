import { requireHrPage, hrScopeWhere } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import HRFollowUpActions from "@/components/HRFollowUpActions";

export const dynamic = "force-dynamic";

function todayRange() {
  const s = new Date(); s.setHours(0,0,0,0);
  return { start: s, end: new Date(s.getTime() + 24*3600_000) };
}

function fmt(s:string){return s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());}

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<Record<string,string>> }) {
  const { me } = await requireHrPage();
  const sp = await searchParams;
  const { start, end } = todayRange();

  const filter = sp.filter ?? "today";
  let where: NonNullable<Parameters<typeof prisma.hRFollowUp.findMany>[0]>["where"] = { completedAt: null, candidate: hrScopeWhere(me) };
  if (filter === "today")    where = { ...where, dueAt: { gte: start, lt: end } };
  if (filter === "overdue")  where = { ...where, dueAt: { lt: start } };
  if (filter === "upcoming") where = { ...where, dueAt: { gte: end } };
  if (filter === "confirm")  where = { ...where, type: "INTERVIEW_CONFIRMATION" };
  if (filter === "no-show")  where = { ...where, type: "NO_SHOW_RECOVERY" };

  const followUps = await prisma.hRFollowUp.findMany({
    where,
    orderBy: { dueAt: "asc" },
    take: 100,
    include: {
      candidate: { select: { id: true, name: true, phone: true, primaryOwner: { select: { name: true } } } },
      user: { select: { name: true } },
    },
  });

  const tabs = [
    { key: "today",    label: "Today" },
    { key: "overdue",  label: "Overdue" },
    { key: "upcoming", label: "Upcoming" },
    { key: "confirm",  label: "Interview Confirmation" },
    { key: "no-show",  label: "No Show Recovery" },
  ];

  const now = new Date();

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">Follow-Ups</h1>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap border-b border-gray-200 dark:border-slate-700">
        {tabs.map(t => (
          <Link key={t.key} href={`/hr/followups?filter=${t.key}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition
              ${filter===t.key ? "border-[#1a2e4a] text-[#1a2e4a] dark:border-blue-400 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {followUps.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-2">✅</div>
          <div className="text-sm">No follow-ups in this category.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {followUps.map(fu => {
            const dueAt = new Date(fu.dueAt);
            const overdue = dueAt < now;
            return (
              <div key={fu.id}
                className={`bg-white dark:bg-slate-900 rounded-xl border p-4 flex items-start gap-3 ${overdue ? "border-red-300 bg-red-50/30" : "border-gray-200 dark:border-slate-700"}`}>
                {/* Candidate info */}
                <div className="flex-1 min-w-0">
                  <Link href={`/hr/candidates/${fu.candidateId}`}
                    className="font-semibold text-sm text-[#1a2e4a] dark:text-blue-400 hover:underline">
                    {fu.candidate.name}
                  </Link>
                  {fu.candidate.phone && (
                    <a href={`tel:${fu.candidate.phone}`} className="text-xs text-gray-500 ml-2 hover:text-blue-600">
                      {fu.candidate.phone}
                    </a>
                  )}
                  <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-gray-500">
                    <span className="font-medium text-gray-700">{fmt(fu.type)}</span>
                    <span className={overdue ? "text-red-600 font-semibold" : "text-amber-600"}>
                      {overdue ? "⚠ Overdue — " : "📅 "}
                      {dueAt.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
                      {" "}
                      {dueAt.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}
                    </span>
                    {fu.user?.name && <span>· {fu.user.name}</span>}
                    {fu.candidate.primaryOwner?.name && <span>Owner: {fu.candidate.primaryOwner.name.split(" ")[0]}</span>}
                  </div>
                  {fu.notes && <div className="text-[11px] text-gray-400 mt-0.5">{fu.notes}</div>}
                </div>

                {/* Action buttons */}
                <div className="flex flex-col gap-1.5 shrink-0">
                  <HRFollowUpActions followUpId={fu.id} candidateId={fu.candidateId} phone={fu.candidate.phone} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
