import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ActivityType, ActivityStatus, CallOutcome } from "@prisma/client";
import { startOfDay, startOfWeek, startOfMonth } from "date-fns";
import Link from "next/link";

export const dynamic = "force-dynamic";

// §11.4 Multi-category leaderboards — six per-agent rankings refreshed per
// request. Range selector picks today / week / month. Top three get
// gold/silver/bronze chips. Empty boards show a friendly placeholder.

type Range = "today" | "week" | "month";

interface Row {
  userId: string;
  name: string;
  value: number;
  /** Pre-formatted display string (e.g. "85%", "12.4 min"). Defaults to value. */
  display?: string;
}

interface Board {
  emoji: string;
  title: string;
  /** Suffix shown after the number on each row (e.g. "calls", "%"). */
  unit?: string;
  /** Lower-is-better — used for the helper line under the title. */
  lowerIsBetter?: boolean;
  rows: Row[];
}

function rangeStart(range: Range): Date {
  const now = new Date();
  if (range === "today") return startOfDay(now);
  if (range === "month") return startOfMonth(now);
  // weekStartsOn: 1 → Monday (matches Lalit's weekly cadence)
  return startOfWeek(now, { weekStartsOn: 1 });
}

function parseRange(value: string | undefined): Range {
  if (value === "today" || value === "month") return value;
  return "week";
}

// gold / silver / bronze chip for top-3, plain rank for the rest.
function rankChip(rank: number) {
  if (rank === 1) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-yellow-400 text-yellow-900 text-xs font-bold shrink-0">🥇</span>;
  if (rank === 2) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-300 text-slate-800 text-xs font-bold shrink-0">🥈</span>;
  if (rank === 3) return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-600 text-amber-50 text-xs font-bold shrink-0">🥉</span>;
  return <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold shrink-0">{rank}</span>;
}

function BoardCard({ board }: { board: Board }) {
  return (
    <div className="card p-4 lg:p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl" aria-hidden>{board.emoji}</span>
        <h3 className="font-semibold text-base">{board.title}</h3>
        {board.lowerIsBetter && (
          <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-500">Lower = better</span>
        )}
      </div>
      {board.rows.length === 0 ? (
        <div className="text-sm text-slate-500 py-6 text-center">No data yet</div>
      ) : (
        <ol className="space-y-2">
          {board.rows.map((row, i) => (
            <li key={row.userId} className="flex items-center gap-3">
              {rankChip(i + 1)}
              <span className="flex-1 truncate text-sm font-medium">{row.name}</span>
              <span className="text-sm font-semibold tabular-nums">
                {row.display ?? row.value}
                {board.unit && !row.display ? <span className="ml-1 text-xs font-normal text-slate-500">{board.unit}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const start = rangeStart(range);

  // Active sales-floor users — the only people eligible for any board.
  const eligibleUsers = await prisma.user.findMany({
    where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] } },
    select: { id: true, name: true, dailyStreak: true },
  });
  const eligibleIds = eligibleUsers.map((u) => u.id);
  const nameById = new Map(eligibleUsers.map((u) => [u.id, u.name]));

  // ── 1. Most calls ────────────────────────────────────────────────────
  const callsAgg = await prisma.callLog.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: { startedAt: { gte: start }, userId: { in: eligibleIds } },
    orderBy: { _count: { userId: "desc" } },
    take: 5,
  });
  const mostCalls: Board = {
    emoji: "📞",
    title: "Most calls",
    unit: "calls",
    rows: callsAgg
      .filter((c) => nameById.has(c.userId))
      .map((c) => ({ userId: c.userId, name: nameById.get(c.userId)!, value: c._count._all })),
  };

  // ── 2. Fastest response — avg minutes from lead creation to first call ───
  // DISTINCT ON picks the EARLIEST call per lead so re-dials don't pollute
  // the response-time metric. Skip rows where the call was logged before
  // the lead (clock-skew imports) by guarding the EXTRACT result >= 0.
  const fastestRaw = await prisma.$queryRaw<Array<{ userId: string; avg_min: number }>>`
    WITH first_calls AS (
      SELECT DISTINCT ON (cl."leadId")
        cl."leadId",
        cl."userId",
        cl."startedAt",
        l."createdAt" AS lead_created
      FROM "CallLog" cl
      JOIN "Lead" l ON l.id = cl."leadId"
      WHERE cl."leadId" IS NOT NULL
        AND cl."startedAt" >= ${start}
      ORDER BY cl."leadId", cl."startedAt" ASC
    )
    SELECT
      "userId",
      AVG(EXTRACT(EPOCH FROM ("startedAt" - lead_created)) / 60.0)::float AS avg_min
    FROM first_calls
    WHERE EXTRACT(EPOCH FROM ("startedAt" - lead_created)) >= 0
    GROUP BY "userId"
    ORDER BY avg_min ASC
    LIMIT 5
  `;
  const fastest: Board = {
    emoji: "⚡",
    title: "Fastest response",
    lowerIsBetter: true,
    rows: fastestRaw
      .filter((r) => nameById.has(r.userId))
      .map((r) => ({
        userId: r.userId,
        name: nameById.get(r.userId)!,
        value: r.avg_min,
        display: `${r.avg_min.toFixed(1)} min`,
      })),
  };

  // ── 3. Most follow-ups completed (Activity type=TASK, status=DONE) ───
  const followupsAgg = await prisma.activity.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: {
      type: ActivityType.TASK,
      status: ActivityStatus.DONE,
      completedAt: { gte: start },
      userId: { in: eligibleIds },
    },
    orderBy: { _count: { userId: "desc" } },
    take: 5,
  });
  const followups: Board = {
    emoji: "🎯",
    title: "Most follow-ups completed",
    unit: "tasks",
    rows: followupsAgg
      .filter((r) => r.userId && nameById.has(r.userId))
      .map((r) => ({ userId: r.userId!, name: nameById.get(r.userId!)!, value: r._count._all })),
  };

  // ── 4. Highest connect rate (connected / total, min 5 sample) ────────
  const totalsAgg = await prisma.callLog.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: { startedAt: { gte: start }, userId: { in: eligibleIds } },
  });
  const connectedAgg = await prisma.callLog.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: { startedAt: { gte: start }, userId: { in: eligibleIds }, outcome: CallOutcome.CONNECTED },
  });
  const connectedByUser = new Map(connectedAgg.map((c) => [c.userId, c._count._all]));
  const connectRate: Board = {
    emoji: "📈",
    title: "Highest connect rate",
    rows: totalsAgg
      .filter((t) => t._count._all >= 5 && nameById.has(t.userId))
      .map((t) => {
        const conn = connectedByUser.get(t.userId) ?? 0;
        const pct = (conn / t._count._all) * 100;
        return {
          userId: t.userId,
          name: nameById.get(t.userId)!,
          value: pct,
          display: `${pct.toFixed(1)}%`,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 5),
  };

  // ── 5. Cold-to-warm (Activity type=COLD_TO_LEAD) ─────────────────────
  const coldAgg = await prisma.activity.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: {
      type: ActivityType.COLD_TO_LEAD,
      completedAt: { gte: start },
      userId: { in: eligibleIds },
    },
    orderBy: { _count: { userId: "desc" } },
    take: 5,
  });
  const coldToWarm: Board = {
    emoji: "🔥",
    title: "Cold-to-warm",
    unit: "promoted",
    rows: coldAgg
      .filter((r) => r.userId && nameById.has(r.userId))
      .map((r) => ({ userId: r.userId!, name: nameById.get(r.userId!)!, value: r._count._all })),
  };

  // ── 6. Most consistent (User.dailyStreak) — range-agnostic ───────────
  const consistent: Board = {
    emoji: "🏆",
    title: "Most consistent",
    unit: "day streak",
    rows: [...eligibleUsers]
      .filter((u) => u.dailyStreak > 0)
      .sort((a, b) => b.dailyStreak - a.dailyStreak)
      .slice(0, 5)
      .map((u) => ({ userId: u.id, name: u.name, value: u.dailyStreak })),
  };

  const boards: Board[] = [mostCalls, fastest, followups, connectRate, coldToWarm, consistent];

  const rangeLabel: Record<Range, string> = {
    today: "Today",
    week: "This week",
    month: "This month",
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl lg:text-2xl font-bold flex items-center gap-2">
          <span aria-hidden>🏆</span> Leaderboards
        </h1>
        <span className="text-sm text-slate-500">{rangeLabel[range]}</span>
      </div>

      {/* Period selector — links instead of a form so the URL stays
          shareable and the page can render fully on the server. */}
      <div className="flex gap-2" role="tablist" aria-label="Leaderboard period">
        {(["today", "week", "month"] as const).map((r) => {
          const active = r === range;
          return (
            <Link
              key={r}
              href={`/leaderboards?range=${r}`}
              role="tab"
              aria-selected={active}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                active
                  ? "bg-[#0b1a33] text-white border-[#0b1a33]"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {rangeLabel[r]}
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 lg:gap-4">
        {boards.map((b) => (
          <BoardCard key={b.title} board={b} />
        ))}
      </div>
    </div>
  );
}
