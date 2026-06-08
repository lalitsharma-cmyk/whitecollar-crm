import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import HRInterviewRowActions from "@/components/HRInterviewRowActions";

export const dynamic = "force-dynamic";

function todayRange() {
  const s = new Date(); s.setHours(0,0,0,0);
  return { start: s, end: new Date(s.getTime() + 24*3600_000), tomorrow: new Date(s.getTime() + 48*3600_000) };
}

const CONF_COLOR: Record<string,string> = {
  PENDING:"bg-amber-100 text-amber-700",CONFIRMED:"bg-green-100 text-green-700",
  NOT_CONFIRMED:"bg-red-100 text-red-700",NOT_REACHABLE:"bg-gray-100 text-gray-600",
  RESCHEDULED:"bg-blue-100 text-blue-700",CANCELLED:"bg-slate-100 text-slate-500",
};
const ATT_COLOR: Record<string,string> = {
  SCHEDULED:"bg-indigo-100 text-indigo-700",ATTENDED:"bg-green-100 text-green-700",
  NO_SHOW:"bg-red-100 text-red-700",RESCHEDULED:"bg-blue-100 text-blue-700",
  CANCELLED:"bg-slate-100 text-slate-500",
};
function fmt(s:string){return s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());}

export default async function InterviewsPage({ searchParams }: { searchParams: Promise<Record<string,string>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const { start, end, tomorrow } = todayRange();
  const scope = me.role === "AGENT" ? { OR:[{primaryOwnerId:me.id},{secondaryOwnerId:me.id}] } : {};

  const filter = sp.filter ?? "upcoming";
  let where: NonNullable<Parameters<typeof prisma.hRInterview.findMany>[0]>["where"] = { candidate: scope };
  if (filter === "today")    where = { ...where, scheduledAt: { gte: start, lt: end }, attendanceStatus: "SCHEDULED" };
  if (filter === "tomorrow") where = { ...where, scheduledAt: { gte: end, lt: tomorrow }, attendanceStatus: "SCHEDULED" };
  if (filter === "pending-confirm") where = { ...where, scheduledAt: { gte: new Date() }, confirmationStatus: "PENDING" };
  if (filter === "upcoming") where = { ...where, scheduledAt: { gte: new Date() }, attendanceStatus: "SCHEDULED" };
  if (filter === "no-show-recovery") where = { ...where, attendanceStatus: "NO_SHOW" };

  const interviews = await prisma.hRInterview.findMany({
    where,
    orderBy: { scheduledAt: "asc" },
    take: 100,
    include: {
      candidate: { select: { id: true, name: true, phone: true, primaryOwner: { select: { name: true } } } },
      interviewer: { select: { name: true } },
    },
  });

  const tabs = [
    { key: "today",           label: "Today" },
    { key: "tomorrow",        label: "Tomorrow" },
    { key: "upcoming",        label: "Upcoming" },
    { key: "pending-confirm",  label: "Pending Confirmation" },
    { key: "no-show-recovery", label: "No Show Recovery" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">Interviews</h1>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap border-b border-gray-200 dark:border-slate-700">
        {tabs.map(t => (
          <Link key={t.key} href={`/hr/interviews?filter=${t.key}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition
              ${filter===t.key ? "border-[#1a2e4a] text-[#1a2e4a] dark:border-blue-400 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {interviews.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-2">🎯</div>
          <div className="text-sm">No interviews found for this filter.</div>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Candidate</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Date & Time</th>
                  <th className="px-4 py-3">Interviewer</th>
                  <th className="px-4 py-3">Confirmation</th>
                  <th className="px-4 py-3">Attendance</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {interviews.map(iv => (
                  <tr key={iv.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3">
                      <Link href={`/hr/candidates/${iv.candidateId}`} className="font-medium text-[#1a2e4a] dark:text-blue-400 hover:underline">
                        {iv.candidate.name}
                      </Link>
                      {iv.candidate.phone && <div className="text-[11px] text-gray-400">{iv.candidate.phone}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium">{fmt(iv.type)}</td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium">{new Date(iv.scheduledAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</div>
                      <div className="text-gray-500">{new Date(iv.scheduledAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{iv.interviewer?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${CONF_COLOR[iv.confirmationStatus] ?? ""}`}>
                        {fmt(iv.confirmationStatus)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${ATT_COLOR[iv.attendanceStatus] ?? ""}`}>
                        {fmt(iv.attendanceStatus)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{iv.candidate.primaryOwner?.name?.split(" ")[0]}</td>
                    <td className="px-4 py-3">
                      <HRInterviewRowActions interviewId={iv.id} candidateId={iv.candidateId} phone={iv.candidate.phone} attendanceStatus={iv.attendanceStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden divide-y divide-gray-100 dark:divide-slate-800">
            {interviews.map(iv => (
              <Link key={iv.id} href={`/hr/candidates/${iv.candidateId}`} className="block p-4 hover:bg-gray-50">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-sm">{iv.candidate.name}</div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${ATT_COLOR[iv.attendanceStatus] ?? ""}`}>
                    {fmt(iv.attendanceStatus)}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-2">
                  <span>🎯 {fmt(iv.type)}</span>
                  <span>📅 {new Date(iv.scheduledAt).toLocaleDateString("en-IN",{day:"numeric",month:"short"})} {new Date(iv.scheduledAt).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span>
                  <span className={`px-1.5 py-0 rounded ${CONF_COLOR[iv.confirmationStatus] ?? ""}`}>{fmt(iv.confirmationStatus)}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
