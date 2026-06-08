import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { statusColor, statusLabel } from "@/lib/hrStatus";
import { getHrUsers } from "@/lib/hrUsers";

export const dynamic = "force-dynamic";

const CALL_TYPES = ["CALL_CONNECTED", "CALL_NOT_ANSWERED", "CALL_BUSY", "CALL_SWITCHED_OFF", "CALL_WRONG_NUMBER", "CALL_LATER"];
const FUNNEL = ["NEW", "NOT_CALLED", "INTERESTED", "PIPELINE", "VIRTUAL_INTERVIEW_SCHEDULED", "F2F_INTERVIEW_SCHEDULED", "INTERVIEW_HELD", "SHORTLISTED", "OFFER_RELEASED", "JOINED"];

function countBy<T extends string>(arr: { _count: number }[], key: T): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of arr) { const k = (r as Record<string, unknown>)[key]; if (k) m[String(k)] = r._count; }
  return m;
}

export default async function HRReportsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser();
  if (me.role !== "ADMIN") redirect("/hr");
  const sp = await searchParams;
  const period = sp.period ?? "30d";

  let since: Date | undefined;
  if (period === "30d") since = new Date(Date.now() - 30 * 864e5);
  else if (period === "7d") since = new Date(Date.now() - 7 * 864e5);
  else if (period === "month") { const d = new Date(); since = new Date(d.getFullYear(), d.getMonth(), 1); }
  const actWhere = since ? { createdAt: { gte: since } } : {};
  const candWhere = since ? { createdAt: { gte: since } } : {};

  const [users, calls, added, ivSched, ivDone, shortlisted, offers, joined, funnel] = await Promise.all([
    getHrUsers(),
    prisma.hRActivity.groupBy({ by: ["userId"], where: { type: { in: CALL_TYPES as never[] }, ...actWhere }, _count: true }),
    prisma.hRCandidate.groupBy({ by: ["primaryOwnerId"], where: candWhere, _count: true }),
    prisma.hRActivity.groupBy({ by: ["userId"], where: { type: "INTERVIEW_SCHEDULED", ...actWhere }, _count: true }),
    prisma.hRActivity.groupBy({ by: ["userId"], where: { type: "INTERVIEW_ATTENDED", ...actWhere }, _count: true }),
    prisma.hRCandidate.groupBy({ by: ["primaryOwnerId"], where: { status: "SHORTLISTED" }, _count: true }),
    prisma.hRCandidate.groupBy({ by: ["primaryOwnerId"], where: { status: "OFFER_RELEASED" }, _count: true }),
    prisma.hRCandidate.groupBy({ by: ["primaryOwnerId"], where: { status: "JOINED" }, _count: true }),
    prisma.hRCandidate.groupBy({ by: ["status"], _count: true }),
  ]);

  const cCalls = countBy(calls, "userId"), cAdded = countBy(added, "primaryOwnerId");
  const cSched = countBy(ivSched, "userId"), cDone = countBy(ivDone, "userId");
  const cShort = countBy(shortlisted, "primaryOwnerId"), cOff = countBy(offers, "primaryOwnerId"), cJoin = countBy(joined, "primaryOwnerId");
  const fmap = countBy(funnel, "status");

  const rows = users.map(u => ({
    name: u.name,
    calls: cCalls[u.id] ?? 0, added: cAdded[u.id] ?? 0, sched: cSched[u.id] ?? 0, done: cDone[u.id] ?? 0,
    short: cShort[u.id] ?? 0, off: cOff[u.id] ?? 0, join: cJoin[u.id] ?? 0,
  })).filter(r => r.calls || r.added || r.sched || r.done || r.short || r.off || r.join)
    .sort((a, b) => (b.calls + b.added + b.sched + b.done) - (a.calls + a.added + a.sched + a.done));

  const totals = rows.reduce((t, r) => ({
    calls: t.calls + r.calls, added: t.added + r.added, sched: t.sched + r.sched, done: t.done + r.done,
    short: t.short + r.short, off: t.off + r.off, join: t.join + r.join,
  }), { calls: 0, added: 0, sched: 0, done: 0, short: 0, off: 0, join: 0 });

  const periods = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["all", "All time"]];
  const maxFunnel = Math.max(1, ...FUNNEL.map(s => fmap[s] ?? 0));

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Reports</h1>
          <p className="text-sm text-gray-500">Recruiter performance &amp; pipeline</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {periods.map(([k, label]) => (
            <Link key={k} href={`/hr/reports?period=${k}`}
              className={`text-xs px-3 py-1.5 rounded-lg border ${period === k ? "bg-[#1a2e4a] text-white border-[#1a2e4a]" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
              {label}
            </Link>
          ))}
        </div>
      </div>

      {/* Recruiter performance */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-semibold text-gray-700 dark:text-slate-200">
          Recruiter Performance
          <span className="text-[11px] font-normal text-gray-400 ml-2">calls, candidates &amp; interviews are for the selected period; status counts are current</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-slate-800 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-3 py-2.5">Recruiter</th>
                {["Calls", "Added", "Iv Sched", "Iv Done", "Shortlisted", "Offers", "Joined"].map(h => <th key={h} className="px-3 py-2.5 text-center whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-xs">No recruiter activity in this period.</td></tr>}
              {rows.map(r => (
                <tr key={r.name} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-slate-200 whitespace-nowrap">{r.name}</td>
                  <td className="px-3 py-2.5 text-center">{r.calls}</td>
                  <td className="px-3 py-2.5 text-center">{r.added}</td>
                  <td className="px-3 py-2.5 text-center">{r.sched}</td>
                  <td className="px-3 py-2.5 text-center">{r.done}</td>
                  <td className="px-3 py-2.5 text-center text-teal-700 font-medium">{r.short}</td>
                  <td className="px-3 py-2.5 text-center text-amber-700 font-medium">{r.off}</td>
                  <td className="px-3 py-2.5 text-center text-green-700 font-semibold">{r.join}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 dark:bg-slate-800 font-semibold text-gray-700 dark:text-slate-200">
                  <td className="px-3 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-center">{totals.calls}</td>
                  <td className="px-3 py-2.5 text-center">{totals.added}</td>
                  <td className="px-3 py-2.5 text-center">{totals.sched}</td>
                  <td className="px-3 py-2.5 text-center">{totals.done}</td>
                  <td className="px-3 py-2.5 text-center">{totals.short}</td>
                  <td className="px-3 py-2.5 text-center">{totals.off}</td>
                  <td className="px-3 py-2.5 text-center">{totals.join}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Pipeline funnel (current snapshot) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
        <div className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-3">Pipeline (current)</div>
        <div className="space-y-1.5">
          {FUNNEL.map(s => {
            const n = fmap[s] ?? 0;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className="w-40 shrink-0 text-xs"><span className={`px-2 py-0.5 rounded-full ${statusColor(s)}`}>{statusLabel(s)}</span></div>
                <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-4 overflow-hidden">
                  <div className="h-full bg-[#1a2e4a] rounded-full" style={{ width: `${(n / maxFunnel) * 100}%` }} />
                </div>
                <div className="w-8 text-right text-xs font-semibold text-gray-700 dark:text-slate-200">{n}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
