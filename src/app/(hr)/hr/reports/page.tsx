import { requireHrPagePermission } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import Link from "next/link";
import { statusColor, statusLabel } from "@/lib/hrStatus";
import { getHrUsers } from "@/lib/hrUsers";
import HRRecruiterCsvButton, { type RecruiterRow } from "@/components/HRRecruiterCsvButton";

export const dynamic = "force-dynamic";

const CALL_TYPES = ["CALL_CONNECTED", "CALL_NOT_ANSWERED", "CALL_BUSY", "CALL_SWITCHED_OFF", "CALL_WRONG_NUMBER", "CALL_LATER"];
const FUNNEL = ["NEW", "NOT_CALLED", "INTERESTED", "PIPELINE", "VIRTUAL_INTERVIEW_SCHEDULED", "F2F_INTERVIEW_SCHEDULED", "INTERVIEW_HELD", "SHORTLISTED", "OFFER_RELEASED", "JOINED"];

function countBy<T extends string>(arr: { _count: number }[], key: T): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of arr) { const k = (r as Record<string, unknown>)[key]; if (k) m[String(k)] = r._count; }
  return m;
}

export default async function HRReportsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireHrPagePermission("reports");
  const sp = await searchParams;
  const period = sp.period ?? "30d";

  let since: Date | undefined;
  if (period === "today") { const d = new Date(); since = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  else if (period === "7d") since = new Date(Date.now() - 7 * 864e5);
  else if (period === "30d") since = new Date(Date.now() - 30 * 864e5);
  else if (period === "month") { const d = new Date(); since = new Date(d.getFullYear(), d.getMonth(), 1); }
  // Period end — funnel/time-to-hire count activity that happened up to "now" within the window.
  const periodEnd = new Date();
  const actWhere = since ? { createdAt: { gte: since }, candidate: { deletedAt: null } } : { candidate: { deletedAt: null } };
  // Candidate counts in this report are "current snapshot" of candidates ADDED in the period.
  const candWhere = since ? { createdAt: { gte: since }, deletedAt: null } : { deletedAt: null };
  // Activity-timestamp window for the PERIOD-SCOPED conversion funnel + time-to-hire.
  // Counts the progression EVENTS that occurred inside the selected period.
  const actWindow = since ? { gte: since, lte: periodEnd } : { lte: periodEnd };

  // Period-scoped funnel: DISTINCT candidates with each progression activity inside the window.
  // groupBy candidateId then count the groups → one candidate counted once per stage.
  const distinctCandActivity = (types: string[]) =>
    prisma.hRActivity.groupBy({
      by: ["candidateId"],
      where: { type: { in: types as never[] }, createdAt: actWindow, candidate: { deletedAt: null } },
      _count: true,
    });

  // Per-recruiter, period-scoped, DISTINCT-candidate activity counting.
  // groupBy [userId, candidateId] → one row per (recruiter, candidate). Counting
  // rows per userId then yields DISTINCT candidates that recruiter progressed in
  // the window — so a reschedule / re-log does NOT double-credit the recruiter
  // (matches how the funnel counts distinct candidates, not activity rows).
  const distinctPerRecruiter = (filter: Prisma.HRActivityWhereInput) =>
    prisma.hRActivity.groupBy({
      by: ["userId", "candidateId"],
      where: { ...filter, userId: { not: null }, createdAt: actWindow, candidate: { deletedAt: null } },
    });
  // Collapse [userId, candidateId] rows → distinct-candidate count per userId.
  const distinctByUser = (rows: { userId: string | null }[]): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const r of rows) if (r.userId) m[r.userId] = (m[r.userId] ?? 0) + 1;
    return m;
  };

  // Per-promise fallback: one failed query must NOT blank the whole report.
  // `safe` preserves the SUCCESS type (fallback must match it), so no widened
  // union breaks downstream inference — on error it logs and yields the fallback.
  const safe = <T,>(label: string, p: Promise<T>, fallback: T): Promise<T> =>
    p.catch((e) => { console.error(`[hr-reports] query failed: ${label}`, e); return fallback; });

  const [
    users, calls, added, ivSchedRows, ivDoneRows, shortlistedRows, offerRows, joinedRows, funnel,
    sourceGroup, joinedThisPeriod, offersReleasedPeriod,
    pvInterviewed, pvOffered, pvJoined, timeToHireRaw,
  ] = await Promise.all([
    safe("users", getHrUsers(), []),
    safe("calls", prisma.hRActivity.groupBy({ by: ["userId"], where: { type: { in: CALL_TYPES as never[] }, ...actWhere }, _count: true }), []),
    safe("added", prisma.hRCandidate.groupBy({ by: ["primaryOwnerId"], where: candWhere, _count: true }), []),
    // Iv Sched / Iv Done — DISTINCT candidates per recruiter, in-window (not activity rows).
    safe("ivSched", distinctPerRecruiter({ type: "INTERVIEW_SCHEDULED" }), []),
    safe("ivDone", distinctPerRecruiter({ type: "INTERVIEW_ATTENDED" }), []),
    // Shortlisted / Offers / Joined — PERIOD-SCOPED via progression activities in-window,
    // DISTINCT candidate per recruiter, replacing the previous all-time status snapshot.
    // Shortlisted has no dedicated activity type → detect STATUS_CHANGED → SHORTLISTED.
    safe("shortlisted", distinctPerRecruiter({ type: "STATUS_CHANGED", newStatus: "SHORTLISTED" }), []),
    safe("offers", distinctPerRecruiter({ type: "OFFER_RELEASED" }), []),
    safe("joined", distinctPerRecruiter({ type: "CANDIDATE_JOINED" }), []),
    safe("funnel", prisma.hRCandidate.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }), []),
    // Source performance — group candidates added in the period by source.
    safe("sourceGroup", prisma.hRCandidate.groupBy({ by: ["source"], where: candWhere, _count: true }), []),
    safe("joinedThisPeriod", prisma.hRActivity.count({ where: { type: "CANDIDATE_JOINED", ...actWhere } }), 0),
    safe("offersReleasedPeriod", prisma.hRActivity.count({ where: { type: "OFFER_RELEASED", ...actWhere } }), 0),
    // ── Period-scoped conversion funnel (distinct candidates by activity type, in-window) ──
    // "Attended Interview" = candidates who ATTENDED (INTERVIEW_ATTENDED), not merely
    // scheduled — scheduled-but-no-show should not count as having reached interview.
    safe("pvInterviewed", distinctCandActivity(["INTERVIEW_ATTENDED"]), []),
    safe("pvOffered", distinctCandActivity(["OFFER_RELEASED"]), []),
    safe("pvJoined", distinctCandActivity(["CANDIDATE_JOINED"]), []),
    // ── Time-to-hire: days from candidate.createdAt → earliest CANDIDATE_JOINED activity in-window ──
    // DISTINCT-on candidateId (GROUP BY) to avoid double counting if multiple join activities exist.
    safe("timeToHire", prisma.$queryRaw<{ avg_days: number | null; min_days: number | null; max_days: number | null; n: bigint }[]>(
      Prisma.sql`
      SELECT
        AVG(diff_days)::float AS avg_days,
        MIN(diff_days)::float AS min_days,
        MAX(diff_days)::float AS max_days,
        COUNT(*)::bigint      AS n
      FROM (
        SELECT
          a."candidateId",
          EXTRACT(EPOCH FROM (MIN(a."createdAt") - c."createdAt")) / 86400.0 AS diff_days
        FROM "HRActivity" a
        JOIN "HRCandidate" c ON c.id = a."candidateId"
        WHERE a."type" = 'CANDIDATE_JOINED'
          AND c."deletedAt" IS NULL
          AND a."createdAt" <= ${periodEnd}
          ${since ? Prisma.sql`AND a."createdAt" >= ${since}` : Prisma.empty}
        GROUP BY a."candidateId", c."createdAt"
      ) sub
      WHERE diff_days >= 0
    `), []),
  ]);

  const cCalls = countBy(calls, "userId"), cAdded = countBy(added, "primaryOwnerId");
  // Iv Sched / Iv Done / Shortlisted / Offers / Joined — distinct candidates per recruiter,
  // in-period (activity-derived; credited to the recruiter who logged the progression).
  const cSched = distinctByUser(ivSchedRows), cDone = distinctByUser(ivDoneRows);
  const cShort = distinctByUser(shortlistedRows), cOff = distinctByUser(offerRows), cJoin = distinctByUser(joinedRows);
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

  const csvRows: RecruiterRow[] = rows.map(r => ({ ...r }));

  // ── Source performance ──
  const sourceRows = sourceGroup
    .map(s => ({ source: (s.source && s.source.trim()) || "Unknown", n: s._count }))
    .sort((a, b) => b.n - a.n);
  const sourceTotal = sourceRows.reduce((t, s) => t + s.n, 0);
  const maxSource = Math.max(1, ...sourceRows.map(s => s.n));

  // ── Conversion funnel (PERIOD-SCOPED) ──
  // Applied = candidates ADDED in the period (all owners, not just those with later activity).
  // Each later stage = DISTINCT candidates with the matching progression activity IN-WINDOW.
  // "all" period → these become lifetime totals (since/window unbounded below), accurately.
  const pct = (n: number, d: number) => d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
  const appliedAll = added.reduce((a: number, r) => a + r._count, 0);
  // "Attended Interview" = candidates who actually ATTENDED (INTERVIEW_ATTENDED) in-window —
  // NOT merely scheduled. Scheduled-but-no-show no longer inflates this stage.
  const interviewedN = pvInterviewed.length;   // distinct candidates who attended an interview in-window
  const offeredN = pvOffered.length;           // distinct candidates with offer-released activity in-window
  const joinedN = pvJoined.length;             // distinct candidates with join activity in-window
  const conv = [
    { label: "Applied", n: appliedAll, of: "added in period" },
    { label: "Attended Interview", n: interviewedN, of: appliedAll > 0 ? `${pct(interviewedN, appliedAll)}% of applied` : "—" },
    { label: "Offered", n: offeredN, of: interviewedN > 0 ? `${pct(offeredN, interviewedN)}% of attended` : "—" },
    { label: "Joined", n: joinedN, of: offeredN > 0 ? `${pct(joinedN, offeredN)}% of offered` : "—" },
  ];

  // ── Time-to-hire (PERIOD-SCOPED): avg days from candidate.createdAt → join activity, for in-window joins ──
  const tth = timeToHireRaw?.[0];
  const tthCount = tth?.n != null ? Number(tth.n) : 0;
  // Round to 1dp; guard against negative/zero diffs (e.g. a join activity backdated
  // before the candidate's createdAt) — these are meaningless as a "time to hire",
  // so collapse anything ≤ 0 (or non-finite) to null → renders "—", never a negative.
  const fmt1 = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) || v <= 0 ? null : Math.round(v * 10) / 10;
  const tthAvg = tthCount > 0 ? fmt1(tth?.avg_days) : null;
  const tthMin = tthCount > 0 ? fmt1(tth?.min_days) : null;
  const tthMax = tthCount > 0 ? fmt1(tth?.max_days) : null;
  const dayStr = (v: number | null) => v == null ? "—" : `${v} ${v === 1 ? "day" : "days"}`;

  // ── Offers / Joining summary (current snapshot) ──
  const offerSummary = [
    { label: "Offers Released", n: fmap["OFFER_RELEASED"] ?? 0, color: "text-amber-700 dark:text-amber-400" },
    { label: "Expected Joinings", n: fmap["EXPECTED_JOINING"] ?? 0, color: "text-lime-700 dark:text-lime-400" },
    { label: "Joined (total)", n: fmap["JOINED"] ?? 0, color: "text-green-700 dark:text-green-400" },
    { label: "Offers Declined", n: fmap["OFFER_DECLINED"] ?? 0, color: "text-orange-700 dark:text-orange-400" },
  ];

  const periods = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["all", "All time"]];
  const maxFunnel = Math.max(1, ...FUNNEL.map(s => fmap[s] ?? 0));
  const periodLabel = (periods.find(p => p[0] === period)?.[1]) ?? "Last 30 days";

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Reports</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Recruiter performance, pipeline &amp; conversion</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {periods.map(([k, label]) => (
            <Link key={k} href={`/hr/reports?period=${k}`}
              className={`text-xs px-3 py-1.5 rounded-lg border ${period === k ? "bg-[#1a2e4a] text-white border-[#1a2e4a]" : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
              {label}
            </Link>
          ))}
        </div>
      </div>

      {/* Conversion funnel — PERIOD-SCOPED (cohort added in period, tracked via activity timestamps) */}
      <div>
        <div className="flex items-baseline gap-2 mb-2">
          <div className="text-sm font-semibold text-gray-700 dark:text-slate-200">Conversion Funnel</div>
          <span className="text-[11px] font-normal text-gray-400">{periodLabel.toLowerCase()} · cohort added in period, progressed via activity</span>
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          {conv.map((c) => (
            <div key={c.label} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">{c.label}</div>
              <div className="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">{c.n}</div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{c.of}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Time-to-hire — PERIOD-SCOPED (candidates joined in period; createdAt → join activity) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex items-baseline gap-2 mb-3">
          <div className="text-sm font-semibold text-gray-700 dark:text-slate-200">Time to Hire</div>
          <span className="text-[11px] font-normal text-gray-400">
            {tthCount > 0
              ? `avg from added → joined · ${tthCount} joined in ${periodLabel.toLowerCase()}`
              : `no candidates joined in ${periodLabel.toLowerCase()}`}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-gray-50 dark:bg-slate-800 p-3">
            <div className="text-2xl font-extrabold text-indigo-700 dark:text-indigo-400">{dayStr(tthAvg)}</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Average</div>
          </div>
          <div className="rounded-xl bg-gray-50 dark:bg-slate-800 p-3">
            <div className="text-2xl font-extrabold text-gray-700 dark:text-slate-200">{dayStr(tthMin)}</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Fastest</div>
          </div>
          <div className="rounded-xl bg-gray-50 dark:bg-slate-800 p-3">
            <div className="text-2xl font-extrabold text-gray-700 dark:text-slate-200">{dayStr(tthMax)}</div>
            <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Slowest</div>
          </div>
        </div>
        {/* One-line caption — explains exactly what "time to hire" measures. */}
        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-3">
          Calendar days from when a candidate was added (created) to their join activity, for candidates joined in {periodLabel.toLowerCase()}. Excludes join activity backdated before the candidate was added (only non-negative durations are counted).
        </p>
      </div>

      {/* Offers / Joining summary + new this period */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
          <div className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-3">Offers &amp; Joining (current)</div>
          <div className="grid grid-cols-2 gap-3">
            {offerSummary.map(o => (
              <div key={o.label} className="rounded-xl bg-gray-50 dark:bg-slate-800 p-3">
                <div className={`text-2xl font-extrabold ${o.color}`}>{o.n}</div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{o.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
          <div className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-3">Activity in {periodLabel}</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-gray-50 dark:bg-slate-800 p-3">
              <div className="text-2xl font-extrabold text-teal-700 dark:text-teal-400">{totals.added}</div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Candidates Added</div>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-slate-800 p-3">
              <div className="text-2xl font-extrabold text-blue-700 dark:text-blue-400">{totals.calls}</div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Calls Logged</div>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-slate-800 p-3">
              <div className="text-2xl font-extrabold text-amber-700 dark:text-amber-400">{offersReleasedPeriod}</div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Offers Released</div>
            </div>
            <div className="rounded-xl bg-gray-50 dark:bg-slate-800 p-3">
              <div className="text-2xl font-extrabold text-green-700 dark:text-green-400">{joinedThisPeriod}</div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Joined (this period)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Recruiter performance */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-700 dark:text-slate-200">
            Recruiter Performance
            {/* Period-vs-snapshot hint — visible on mobile too (was hidden sm:inline).
                On phones it wraps onto its own line; on ≥sm it sits inline after the title. */}
            <span className="text-[11px] font-normal text-gray-400 sm:ml-2 block sm:inline mt-0.5 sm:mt-0">all columns are {periodLabel.toLowerCase()} activity (distinct candidates per stage)</span>
          </div>
          <HRRecruiterCsvButton rows={csvRows} period={period} />
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
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500 text-xs">No recruiter activity in this period.</td></tr>}
              {rows.map(r => (
                <tr key={r.name} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/50">
                  <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-slate-200 whitespace-nowrap">{r.name}</td>
                  <td className="px-3 py-2.5 text-center text-gray-700 dark:text-slate-300">{r.calls}</td>
                  <td className="px-3 py-2.5 text-center text-gray-700 dark:text-slate-300">{r.added}</td>
                  <td className="px-3 py-2.5 text-center text-gray-700 dark:text-slate-300">{r.sched}</td>
                  <td className="px-3 py-2.5 text-center text-gray-700 dark:text-slate-300">{r.done}</td>
                  <td className="px-3 py-2.5 text-center text-teal-700 dark:text-teal-400 font-medium">{r.short}</td>
                  <td className="px-3 py-2.5 text-center text-amber-700 dark:text-amber-400 font-medium">{r.off}</td>
                  <td className="px-3 py-2.5 text-center text-green-700 dark:text-green-400 font-semibold">{r.join}</td>
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

      {/* Source performance */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
        <div className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-3">
          Source Performance
          <span className="text-[11px] font-normal text-gray-400 ml-2">candidates added in {periodLabel.toLowerCase()}</span>
        </div>
        {sourceRows.length === 0 ? (
          <div className="px-2 py-6 text-center text-gray-400 dark:text-slate-500 text-xs">No candidates added in this period.</div>
        ) : (
          <div className="space-y-1.5">
            {sourceRows.map(s => (
              <div key={s.source} className="flex items-center gap-2">
                <div className="w-36 shrink-0 text-xs text-gray-700 dark:text-slate-300 truncate" title={s.source}>{s.source}</div>
                <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-4 overflow-hidden">
                  <div className="h-full bg-teal-500 rounded-full" style={{ width: `${(s.n / maxSource) * 100}%` }} />
                </div>
                <div className="w-20 text-right text-xs font-semibold text-gray-700 dark:text-slate-200 whitespace-nowrap">
                  {s.n} <span className="text-gray-400 font-normal">({sourceTotal > 0 ? Math.round((s.n / sourceTotal) * 100) : 0}%)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pipeline funnel (current snapshot) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
        <div className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-3">Pipeline by Status (current)</div>
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
