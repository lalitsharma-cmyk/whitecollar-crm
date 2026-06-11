import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { fmtMoneyDual, fmtMoney } from "@/lib/money";
import Link from "next/link";
import ReportDateRangePicker from "@/components/ReportDateRangePicker";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// ── Cooling Leads Report ──────────────────────────────────────────────
// Surfaces leads that WERE HOT but have been downgraded to WARM/COLD in
// a configurable window (default 14 days). This is the "save the deal"
// report — Lalit's most requested intervention list: hot leads that
// started cooling off, while there's still time to re-engage before they
// go fully cold.
//
// Detection: rescoreLead() logs every bucket flip as an Activity with
// type=STATUS_CHANGE and a title in the shape
//     "🤖 AI re-score: <prevScore> → <newScore> (<oldBucket> → <newBucket>)"
// So we look for STATUS_CHANGE activities in the picked window whose title
// contains "(HOT → WARM)" or "(HOT → COLD)", pick the most recent such
// downgrade per lead, then keep only leads whose CURRENT aiScore is still
// WARM/COLD — if they've been re-promoted back to HOT we don't surface
// them as cooling anymore.
//
// Role scope: AGENT sees own leads only; ADMIN/MANAGER see everything.
// Date controls: ?from=&to= via the shared ReportDateRangePicker. Default
// remains 14 days back → today, matching the page's original fixed window
// so a visit with no params is identical to the pre-picker behaviour.

const DEFAULT_WINDOW_DAYS = 14;

interface CoolingRow {
  id: string;
  name: string;
  phone: string | null;
  budget_min: number | null;
  budget_currency: string | null;
  owner_id: string | null;
  last_touched_at: Date | null;
  ai_score: string;            // current bucket — WARM or COLD
  ai_score_value: number | null;
  previous_score: string;      // HOT (we filtered to it)
  downgraded_at: Date;         // when the STATUS_CHANGE happened
}

// Strict YYYY-MM-DD → UTC midnight. Reject junk so we don't slip an
// Invalid Date into a Prisma filter.
function parseYmd(s: string | undefined): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function endOfDayUtc(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(23, 59, 59, 999);
  return out;
}
function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function CoolingLeadsReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  if (me.role === "AGENT") redirect("/reports");
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;
  const sp = await searchParams;
  const scopedOwnerId: string | null = null;

  // ── Resolve the window ──
  // Default = last 14 days → today, matching the page's pre-picker behaviour.
  // ?from=&to= via the shared picker override on either side; both bounds
  // are passed directly to the SQL query as parameters (no string interpolation).
  const now = new Date();
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);

  const since: Date =
    fromParam ?? new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);
  const until: Date = toParam ? endOfDayUtc(toParam) : now;

  // Span in days for the descriptive copy on the header / empty-state.
  const spanDays = Math.max(
    1,
    Math.round((until.getTime() - since.getTime()) / 86_400_000),
  );

  // Raw query — DISTINCT ON picks the most recent qualifying downgrade
  // per lead. We pass scopedOwnerId as a parameter so AGENTs only see
  // their own; ADMIN/MANAGER pass null and the OR short-circuits.
  //
  // Window bounds are now driven by ?from=&to= rather than a fixed
  // INTERVAL — both ends are Date params, so SQL injection isn't a risk.
  const rows = managerTeam
    ? await prisma.$queryRaw<CoolingRow[]>`
        WITH downgrades AS (
          SELECT DISTINCT ON (a."leadId")
            a."leadId"     AS lead_id,
            a."createdAt"  AS downgraded_at,
            CASE
              WHEN a.title LIKE '%(HOT → WARM)%' THEN 'WARM'
              WHEN a.title LIKE '%(HOT → COLD)%' THEN 'COLD'
            END            AS new_bucket
          FROM "Activity" a
          WHERE a."type" = 'STATUS_CHANGE'
            AND a."createdAt" >= ${since}
            AND a."createdAt" <= ${until}
            AND (a.title LIKE '%(HOT → WARM)%' OR a.title LIKE '%(HOT → COLD)%')
          ORDER BY a."leadId", a."createdAt" DESC
        )
        SELECT
          l."id"             AS id,
          l."name"           AS name,
          l."phone"          AS phone,
          l."budgetMin"      AS budget_min,
          l."budgetCurrency" AS budget_currency,
          l."ownerId"        AS owner_id,
          l."lastTouchedAt"  AS last_touched_at,
          l."aiScore"::text  AS ai_score,
          l."aiScoreValue"   AS ai_score_value,
          'HOT'              AS previous_score,
          d.downgraded_at    AS downgraded_at
        FROM "Lead" l
        INNER JOIN downgrades d ON d.lead_id = l."id"
        WHERE l."aiScore" IN ('WARM', 'COLD')
          AND l."deletedAt" IS NULL
          AND (${scopedOwnerId}::text IS NULL OR l."ownerId" = ${scopedOwnerId})
          AND l."forwardedTeam" = ${managerTeam}
        ORDER BY d.downgraded_at DESC
      `
    : await prisma.$queryRaw<CoolingRow[]>`
        WITH downgrades AS (
          SELECT DISTINCT ON (a."leadId")
            a."leadId"     AS lead_id,
            a."createdAt"  AS downgraded_at,
            CASE
              WHEN a.title LIKE '%(HOT → WARM)%' THEN 'WARM'
              WHEN a.title LIKE '%(HOT → COLD)%' THEN 'COLD'
            END            AS new_bucket
          FROM "Activity" a
          WHERE a."type" = 'STATUS_CHANGE'
            AND a."createdAt" >= ${since}
            AND a."createdAt" <= ${until}
            AND (a.title LIKE '%(HOT → WARM)%' OR a.title LIKE '%(HOT → COLD)%')
          ORDER BY a."leadId", a."createdAt" DESC
        )
        SELECT
          l."id"             AS id,
          l."name"           AS name,
          l."phone"          AS phone,
          l."budgetMin"      AS budget_min,
          l."budgetCurrency" AS budget_currency,
          l."ownerId"        AS owner_id,
          l."lastTouchedAt"  AS last_touched_at,
          l."aiScore"::text  AS ai_score,
          l."aiScoreValue"   AS ai_score_value,
          'HOT'              AS previous_score,
          d.downgraded_at    AS downgraded_at
        FROM "Lead" l
        INNER JOIN downgrades d ON d.lead_id = l."id"
        WHERE l."aiScore" IN ('WARM', 'COLD')
          AND l."deletedAt" IS NULL
          AND (${scopedOwnerId}::text IS NULL OR l."ownerId" = ${scopedOwnerId})
        ORDER BY d.downgraded_at DESC
      `;

  // Resolve owner names in one round-trip so the table can show "Owner".
  const ownerIds = Array.from(new Set(rows.map(r => r.owner_id).filter((x): x is string => !!x)));
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
    : [];
  const ownerNameById = new Map(owners.map(o => [o.id, o.name]));

  // ── Summary metrics ────────────────────────────────────────────────
  // 1. Total count
  // 2. Avg budget at risk — split by currency so AED + INR don't blend.
  // 3. Top owner — whoever has the most cooled leads (intervention target).
  const totalCount = rows.length;

  let sumAed = 0;
  let cntAed = 0;
  let sumInr = 0;
  let cntInr = 0;
  for (const r of rows) {
    if (!r.budget_min) continue;
    if ((r.budget_currency ?? "AED").toUpperCase() === "INR") {
      sumInr += r.budget_min;
      cntInr += 1;
    } else {
      sumAed += r.budget_min;
      cntAed += 1;
    }
  }
  const avgAed = cntAed > 0 ? sumAed / cntAed : 0;
  const avgInr = cntInr > 0 ? sumInr / cntInr : 0;

  const ownerCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.owner_id) continue;
    ownerCounts.set(r.owner_id, (ownerCounts.get(r.owner_id) ?? 0) + 1);
  }
  let topOwner: { id: string; name: string; count: number } | null = null;
  for (const [id, count] of ownerCounts.entries()) {
    if (!topOwner || count > topOwner.count) {
      topOwner = { id, name: ownerNameById.get(id) ?? "Unknown", count };
    }
  }

  // ── Table rows — compute days-since-downgrade + sort-stable on it ──
  const nowMs = Date.now();
  const tableRows = rows.map((r) => {
    const downgradeMs = new Date(r.downgraded_at).getTime();
    const daysSince = Math.max(0, Math.floor((nowMs - downgradeMs) / 86_400_000));
    return {
      ...r,
      ownerName: r.owner_id ? (ownerNameById.get(r.owner_id) ?? "—") : "Unassigned",
      daysSince,
    };
  });

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          {/* Clear back affordance per Lalit feedback 2026-06. */}
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">🌡 Cooling leads</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            HOT leads downgraded to WARM/COLD in the last {spanDays} day{spanDays === 1 ? "" : "s"} · {totalCount} lead{totalCount === 1 ? "" : "s"} losing momentum
            {scopedOwnerId ? " · your leads only" : " · team-wide"}
          </p>
        </div>
      </div>

      {/* Shared date-range picker — writes ?from=&to=. Default window is
          14 days back → today, so visitors without params see the same
          report they saw before the picker was added. */}
      <ReportDateRangePicker defaultFrom={toYmd(since)} defaultTo={toYmd(until)} />

      {/* Summary tiles — three things Lalit asks first: how many, how
          much money is on the line, and who needs the most help. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4 border-l-4 border-rose-500">
          <div className="text-[10px] uppercase tracking-widest text-rose-700 font-bold">
            🔥 Cooling leads
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-rose-800 mt-1 leading-tight">
            {totalCount}
          </div>
          <div className="text-[11px] text-rose-700/70 mt-1">
            Were HOT · now WARM or COLD · still time to save
          </div>
        </div>

        <div className="card p-4 border-l-4 border-amber-500">
          <div className="text-[10px] uppercase tracking-widest text-amber-700 font-bold">
            💰 Avg budget at risk
          </div>
          <div className="text-lg sm:text-xl font-extrabold text-amber-800 mt-1 leading-tight">
            {avgAed > 0 || avgInr > 0 ? fmtMoneyDual({ aed: avgAed, inr: avgInr }) : "—"}
          </div>
          <div className="text-[11px] text-amber-700/70 mt-1">
            Per lead · {cntAed + cntInr} of {totalCount} have a budget on file
          </div>
        </div>

        <div className="card p-4 border-l-4 border-indigo-500">
          <div className="text-[10px] uppercase tracking-widest text-indigo-700 font-bold">
            👤 Most cooled leads
          </div>
          {topOwner ? (
            <>
              <div className="text-lg sm:text-xl font-extrabold text-indigo-800 mt-1 leading-tight">
                {topOwner.name}
              </div>
              <div className="text-[11px] text-indigo-700/70 mt-1">
                {topOwner.count} cooled lead{topOwner.count === 1 ? "" : "s"} · coach or co-call
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400 mt-2">No owned leads cooled</div>
          )}
        </div>
      </div>

      {/* CTA banner — frames the report as an action, not a report. */}
      {totalCount > 0 && (
        <div className="card p-4 bg-gradient-to-r from-rose-50 to-amber-50 border-l-4 border-rose-500">
          <div className="font-bold text-rose-900 text-sm sm:text-base">
            🔥 Re-engage these clients before they go cold
          </div>
          <div className="text-[11px] sm:text-xs text-rose-800/80 mt-1">
            Every day a HOT lead sits without a touch, the chance of recovery drops.
            Pick the freshest downgrades first — they remember the conversation.
          </div>
        </div>
      )}

      {/* Main table */}
      <div className="card p-4 overflow-x-auto">
        <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">
          Cooling leads · sorted by most recent downgrade
        </div>
        {tableRows.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
            No leads have cooled off in the last {spanDays} day{spanDays === 1 ? "" : "s"}. 🎉 The pipeline is holding heat.
          </div>
        ) : (
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-200">
                <th className="text-left py-2 pr-2">Lead</th>
                <th className="text-left py-2 px-2">Owner</th>
                <th className="text-center py-2 px-2">Was</th>
                <th className="text-center py-2 px-2">Now</th>
                <th className="text-right py-2 px-2">Days since drop</th>
                <th className="text-right py-2 px-2">Last budget</th>
                <th className="text-right py-2 pl-2">Last touched</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tableRows.map((r) => {
                const lastTouch = r.last_touched_at
                  ? new Date(r.last_touched_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                  : "—";
                // Fresh downgrades (≤3d) are still very recoverable — flag them.
                const urgencyClass =
                  r.daysSince <= 3 ? "bg-rose-50 text-rose-800 font-semibold"
                  : r.daysSince <= 7 ? "bg-amber-50 text-amber-800"
                  : "text-gray-500";
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="py-2 pr-2">
                      <Link href={`/leads/${r.id}`} className="font-medium text-[#0b1a33] hover:underline">
                        {r.name}
                      </Link>
                      {r.phone && (
                        <div className="text-[10px] text-gray-500 tabular-nums">{r.phone}</div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-gray-700">{r.ownerName}</td>
                    <td className="py-2 px-2 text-center">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                        🔥 HOT
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                        r.ai_score === "COLD" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"
                      }`}>
                        {r.ai_score === "COLD" ? "🧊 COLD" : "🌤 WARM"}
                      </span>
                    </td>
                    <td className={`py-2 px-2 text-right tabular-nums rounded ${urgencyClass}`}>
                      {r.daysSince}d
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {fmtMoney(r.budget_min, r.budget_currency)}
                    </td>
                    <td className="py-2 pl-2 text-right text-gray-500 text-xs">
                      {lastTouch}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-[10px] text-gray-500 mt-3">
          Detected from the AI re-scorer's STATUS_CHANGE activity log. A lead that's been
          re-promoted back to HOT since the downgrade is excluded automatically.
        </p>
      </div>
    </>
  );
}
