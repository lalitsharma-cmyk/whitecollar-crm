// Revival Attempt Cycles report — visibility for the Revival auto-return engine
// (lib/callAttempts.ts): owner-specific attempt progress, the auto-returned Admin
// queue, and cycle distribution.
//
// count == records, by construction (same discipline as /reports/lead-intake):
// every clickable figure is computed with the SAME where-clause its drill target
// (/cold-calls with ?attempts= / ?returned=) applies for an admin/manager viewer —
// the list's baseScope is {} for those roles, its status tab defaults to "all"
// and no shared filters ride the drill links.
//
// Scope: ADMIN/MANAGER only (agents → /reports, like followup-compliance/sla).
// Mirrors the /cold-calls role scoping — admin AND manager see the whole revival
// pool; agents only ever see their own rows on the list itself.
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { COLD_ORIGINS } from "@/lib/leadScope";
import { getRevivalMaxAttempts } from "@/lib/callAttempts";
import { formatLeadName } from "@/lib/leadName";
import { fmtIST } from "@/lib/datetime";

export const dynamic = "force-dynamic";

export default async function RevivalCyclesReportPage() {
  const me = await requireUser();
  if (me.role === "AGENT") redirect("/reports"); // attempt-cycle oversight = manager/admin only

  // Threshold = the SAME Setting-backed value the engine fires on
  // (revivalMaxAttempts, default 5, clamped) — surfaces can never drift from it.
  const T = await getRevivalMaxAttempts();

  // The SAME Revival membership envelope /cold-calls uses (its `originCold`):
  // non-deleted, non-rejected, leadOrigin ∈ COLD_ORIGINS OR legacy isColdCall.
  const originCold: Prisma.LeadWhereInput = {
    deletedAt: null,
    rejectedAt: null,
    OR: [{ leadOrigin: { in: COLD_ORIGINS } }, { isColdCall: true }],
  };
  // EXACTLY the /cold-calls filter fragments (?attempts=nearing / ?attempts=maxed /
  // ?returned=1) so each card's number == the rows its link opens.
  const nearingWhere: Prisma.LeadWhereInput = { ownerId: { not: null }, attemptCount: T - 1 };
  const maxedWhere: Prisma.LeadWhereInput = { ownerId: { not: null }, attemptCount: { gte: T } };
  const returnedWhere: Prisma.LeadWhereInput = { ownerId: null, returnedToPoolAt: { not: null } };

  const RETURNED_TABLE_MAX = 200;

  const [returnedCount, nearingCount, maxedCount, cycleRows, attemptRows, returnedRecords] = await Promise.all([
    prisma.lead.count({ where: { AND: [originCold, returnedWhere] } }),
    prisma.lead.count({ where: { AND: [originCold, nearingWhere] } }),
    prisma.lead.count({ where: { AND: [originCold, maxedWhere] } }),
    // Cycle distribution — over the WHOLE revival pool (cycle is a lifetime
    // property of the record: 1 = first ownership, +1 on every auto-return).
    prisma.lead.groupBy({
      by: ["revivalCycle"],
      where: { AND: [originCold] },
      _count: { _all: true },
    }),
    // Attempt distribution — OWNED records only: attempts are owner-specific and
    // reset on reassignment, so this is "current owners' progress". A returned
    // record's final count is shown in the Returned table below instead.
    prisma.lead.groupBy({
      by: ["attemptCount"],
      where: { AND: [originCold, { ownerId: { not: null } }] },
      _count: { _all: true },
    }),
    // The auto-returned queue — newest first. Same where as the Returned card.
    prisma.lead.findMany({
      where: { AND: [originCold, returnedWhere] },
      orderBy: { returnedToPoolAt: "desc" },
      take: RETURNED_TABLE_MAX,
      select: {
        id: true, name: true, previousOwnerId: true, returnedToPoolAt: true,
        revivalCycle: true, attemptCount: true, connectedCount: true,
      },
    }),
  ]);

  // Resolve Previous Owner names in ONE lookup (previousOwnerId is a plain
  // column, no relation). Deactivated users still resolve — rows are never deleted.
  const prevIds = [...new Set(returnedRecords.map((r) => r.previousOwnerId).filter((x): x is string => !!x))];
  const prevOwners = prevIds.length
    ? await prisma.user.findMany({ where: { id: { in: prevIds } }, select: { id: true, name: true } })
    : [];
  const prevNameById = new Map(prevOwners.map((u) => [u.id, u.name]));

  // Cycle buckets 1 / 2 / 3+ (3+ folds every higher cycle together).
  let cycle1 = 0, cycle2 = 0, cycle3plus = 0, cycleTotal = 0;
  for (const r of cycleRows) {
    cycleTotal += r._count._all;
    if (r.revivalCycle <= 1) cycle1 += r._count._all;
    else if (r.revivalCycle === 2) cycle2 += r._count._all;
    else cycle3plus += r._count._all;
  }

  // Attempt table rows: 0 .. T-1 individually, then a "≥T" bucket.
  const attemptCountByN = new Map<number, number>(attemptRows.map((r) => [r.attemptCount, r._count._all]));
  const ownedTotal = attemptRows.reduce((s, r) => s + r._count._all, 0);
  const gteT = attemptRows.filter((r) => r.attemptCount >= T).reduce((s, r) => s + r._count._all, 0);
  const attemptTable: { label: string; n: number; href: string | null; tone?: string }[] = [
    ...Array.from({ length: T }, (_, i) => ({
      label: `${i} / ${T}`,
      n: attemptCountByN.get(i) ?? 0,
      // Only T-1 has a matching list filter (?attempts=nearing) — count==records.
      href: i === T - 1 ? "/cold-calls?attempts=nearing" : null,
      tone: i === T - 1 ? "text-amber-700 dark:text-amber-300 font-semibold" : undefined,
    })),
    { label: `≥ ${T} / ${T}`, n: gteT, href: "/cold-calls?attempts=maxed", tone: "text-red-700 dark:text-red-300 font-semibold" },
  ];

  const pct = (n: number, total: number) => (total > 0 ? ((n / total) * 100).toFixed(1) : "0.0");

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-slate-100">Revival Attempt Cycles</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            Owner-specific call attempts vs the auto-return threshold ({T}) — a record with {T} unanswered
            attempts and no connect returns to the Admin Revival queue automatically. Every number opens the exact records.
          </p>
        </div>
        <Link href="/reports" className="text-[11px] text-gray-500 dark:text-slate-400 hover:underline">
          ← All reports
        </Link>
      </div>

      {/* ── Summary cards — same conditions as the /cold-calls admin chips ──── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4 border-l-4 border-blue-500">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">↩︎ Returned to Admin</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-gray-900 dark:text-slate-100">
            <Link href="/cold-calls?returned=1" className="hover:underline" title="Open exactly these records on the Revival list">
              {returnedCount}
            </Link>
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
            auto-returned, waiting unassigned in the Admin Revival queue
          </div>
        </div>
        <div className="card p-4 border-l-4 border-amber-500">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">📞 Nearing threshold ({T - 1}/{T})</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-gray-900 dark:text-slate-100">
            <Link href="/cold-calls?attempts=nearing" className="hover:underline" title="Open exactly these records on the Revival list">
              {nearingCount}
            </Link>
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
            owned records one unanswered call from auto-return
          </div>
        </div>
        <div className="card p-4 border-l-4 border-red-500">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">🔴 At threshold (still owned)</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-gray-900 dark:text-slate-100">
            <Link href="/cold-calls?attempts=maxed" className="hover:underline" title="Open exactly these records on the Revival list">
              {maxedCount}
            </Link>
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
            at/over {T} attempts but not returned (a connect or terminal status blocked it)
          </div>
        </div>
      </div>

      {/* ── By cycle number + by attempt count ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-bold text-base text-gray-900 dark:text-slate-100">By revival cycle</h2>
            <span className="text-[10px] text-gray-400 dark:text-slate-500">cycle 1 = first ownership · +1 on every auto-return</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            {([["Cycle 1", cycle1], ["Cycle 2", cycle2], ["Cycle 3+", cycle3plus]] as [string, number][]).map(([label, n]) => (
              <div key={label} className="p-3 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
                <div className="text-xl font-bold tabular-nums mt-0.5 text-gray-900 dark:text-slate-100">{n}</div>
                <div className="text-[10px] text-gray-400 dark:text-slate-500">{pct(n, cycleTotal)}%</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-gray-400 dark:text-slate-500">
            Whole active Revival pool ({cycleTotal} records) — a cycle ≥ 2 means the record already bounced back to Admin at least once.
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-bold text-base text-gray-900 dark:text-slate-100">By attempt count</h2>
            <span className="text-[10px] text-gray-400 dark:text-slate-500">currently owned records · attempts reset on reassignment</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[300px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2 pr-3">Attempts</th>
                  <th className="py-2 pr-3">Records</th>
                  <th className="py-2 pr-3">% of owned</th>
                </tr>
              </thead>
              <tbody>
                {attemptTable.map((row) => (
                  <tr key={row.label} className="border-b border-gray-100 dark:border-slate-800">
                    <td className={`py-1.5 pr-3 tabular-nums text-gray-800 dark:text-slate-200 ${row.tone ?? ""}`}>{row.label}</td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {row.href && row.n > 0 ? (
                        <Link href={row.href} className="text-sky-700 dark:text-sky-400 hover:underline font-semibold" title="Open exactly these records on the Revival list">
                          {row.n}
                        </Link>
                      ) : (
                        <span className="text-gray-800 dark:text-slate-200 font-semibold">{row.n}</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{pct(row.n, ownedTotal)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[10px] text-gray-400 dark:text-slate-500">
            {ownedTotal} owned records. The {T - 1}/{T} and ≥{T} rows drill to the matching Revival-list filters.
          </div>
        </div>
      </div>

      {/* ── Returned-to-Admin records ───────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-bold text-base text-gray-900 dark:text-slate-100">↩︎ Returned to Admin — records</h2>
          <span className="text-[10px] text-gray-400 dark:text-slate-500">
            {returnedCount > RETURNED_TABLE_MAX ? `latest ${RETURNED_TABLE_MAX} of ${returnedCount} · ` : ""}newest first · attempts shown are the last owner&rsquo;s final count
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2 pr-3">Client</th>
                <th className="py-2 pr-3">Previous owner</th>
                <th className="py-2 pr-3">Returned (IST)</th>
                <th className="py-2 pr-3">Cycle</th>
                <th className="py-2 pr-3">Attempts</th>
              </tr>
            </thead>
            <tbody>
              {returnedRecords.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-gray-400 dark:text-slate-500 text-xs">
                    No auto-returned records — no one has hit the {T}-attempt threshold yet.
                  </td>
                </tr>
              )}
              {returnedRecords.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 dark:border-slate-800 align-top">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/revival-engine/cold-data/${r.id}?back=/reports/revival-cycles`}
                      className="text-sky-700 dark:text-sky-400 hover:underline font-medium"
                    >
                      {formatLeadName(r.name)}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-slate-300">
                    {r.previousOwnerId ? (prevNameById.get(r.previousOwnerId) ?? "Unknown agent") : "—"}
                  </td>
                  <td className="py-2 pr-3 text-gray-600 dark:text-slate-400 whitespace-nowrap">
                    {r.returnedToPoolAt ? fmtIST(r.returnedToPoolAt) : "—"}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-gray-700 dark:text-slate-300">#{r.revivalCycle}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    <span className="text-red-700 dark:text-red-300 font-semibold">{r.attemptCount}/{T}</span>
                    {r.connectedCount > 0 && (
                      <span className="ml-1 text-[10px] text-gray-400 dark:text-slate-500">({r.connectedCount} connected)</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
