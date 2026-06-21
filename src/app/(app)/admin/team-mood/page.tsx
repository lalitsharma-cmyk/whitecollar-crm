import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";
import { format, subDays, startOfDay } from "date-fns";

export const dynamic = "force-dynamic";

const EMOJI: Record<string, { emoji: string; label: string; cls: string }> = {
  FRUSTRATING: { emoji: "😣", label: "Really frustrating", cls: "bg-red-50 text-red-700" },
  NOT_GREAT:   { emoji: "🙁", label: "Not great",         cls: "bg-amber-50 text-amber-700" },
  MIXED:       { emoji: "😐", label: "Mixed",             cls: "bg-gray-50 text-gray-700" },
  LOOKS_GOOD:  { emoji: "🙂", label: "Looks good",        cls: "bg-blue-50 text-blue-700" },
  AWESOME:     { emoji: "😍", label: "Awesome",           cls: "bg-emerald-50 text-emerald-700" },
};
const ORDER = ["FRUSTRATING", "NOT_GREAT", "MIXED", "LOOKS_GOOD", "AWESOME"];

// §10.6 Anonymous Team Insight — aggregate-only signals, NEVER raw vault content.
// Mood values used here are stored on VaultEntry.mood (free-string column). We
// only ever SELECT mood / kind / createdAt — never the `content` column — so
// admins can never read an agent's private journal text through this page.
const LOW_MOODS = ["HESITANT", "COLD", "CONFUSED", "ANGRY"] as const;
const BURNOUT_THRESHOLD = 3; // ≥3 low-mood entries in last 7d = at-risk

// Mood colours for the stacked-bar trend chart (used for any mood value that
// shows up over the 30-day window; unknown values fall back to slate).
const MOOD_COLOR: Record<string, string> = {
  GREAT:       "#10b981", // emerald
  OK:          "#3b82f6", // blue
  STRESSED:    "#f59e0b", // amber
  OVERWHELMED: "#f97316", // orange
  HESITANT:    "#fbbf24", // yellow
  CONFUSED:    "#a78bfa", // violet
  COLD:        "#60a5fa", // sky
  ANGRY:       "#ef4444", // red
  SAD:         "#6366f1", // indigo
};
const moodColor = (m: string) => MOOD_COLOR[m] ?? "#94a3b8";

export default async function TeamMoodPage() {
  await requireRole("ADMIN", "MANAGER");

  // Last 14 days × every active agent — sparse grid (blank cells = no check-in)
  const today = startOfDay(new Date());
  const days = Array.from({ length: 14 }, (_, i) => subDays(today, 13 - i));
  const firstDay = days[0];

  const since7d  = subDays(today, 7);
  const since14d = subDays(today, 14);
  const since30d = subDays(today, 30);
  const prev7dStart = subDays(today, 14);
  const prev7dEnd   = subDays(today, 7);

  const [agents, moodsRaw] = await Promise.all([
    prisma.user.findMany({ where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] } }, orderBy: { name: "asc" } }),
    prisma.dailyMood.findMany({ where: { date: { gte: firstDay } } }),
  ]);
  // Manual join — DailyMood doesn't declare a Prisma relation to User
  const userById = new Map(agents.map((u) => [u.id, u]));
  const moods = moodsRaw.map((m) => ({ ...m, user: userById.get(m.userId) ?? { name: "Unknown", team: null } }));

  // index by userId → date(YYYY-MM-DD) → mood row
  const idx = new Map<string, Map<string, typeof moods[number]>>();
  for (const m of moods) {
    if (!idx.has(m.userId)) idx.set(m.userId, new Map());
    idx.get(m.userId)!.set(format(m.date, "yyyy-MM-dd"), m);
  }

  // Today's at-a-glance: how many AWESOME/LOOKS_GOOD/FRUSTRATING etc.
  const todayKey = format(today, "yyyy-MM-dd");
  const todayCounts = { FRUSTRATING: 0, NOT_GREAT: 0, MIXED: 0, LOOKS_GOOD: 0, AWESOME: 0 } as Record<string, number>;
  let todayResponded = 0;
  for (const a of agents) {
    const m = idx.get(a.id)?.get(todayKey);
    if (m) { todayCounts[m.mood]++; todayResponded++; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §10.6 — Anonymous Team Insight (aggregate-only signals)
  // ─────────────────────────────────────────────────────────────────────────

  // 1. BURNOUT-RISK GAUGE — count of agents with ≥3 low-mood VaultEntries in 7d.
  //    We groupBy userId on VaultEntry filtered to LOW_MOODS — `content` is
  //    NEVER selected so private journal text cannot leak through this query.
  const lowMoodGroups = await prisma.vaultEntry.groupBy({
    by: ["userId"],
    where: { mood: { in: [...LOW_MOODS] }, createdAt: { gte: since7d } },
    _count: { _all: true },
  });
  const burnoutAgents = lowMoodGroups.filter((g) => g._count._all >= BURNOUT_THRESHOLD).length;
  const burnoutTone = burnoutAgents === 0
    ? { bar: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", label: "All clear" }
    : burnoutAgents <= 2
    ? { bar: "bg-amber-500",   text: "text-amber-700",   bg: "bg-amber-50",   label: "Watch closely" }
    : { bar: "bg-red-500",     text: "text-red-700",     bg: "bg-red-50",     label: "Intervene now" };
  // Gauge fill: 0 agents = 5% (sliver visible), scale to 100% by 6 agents.
  const burnoutPct = Math.min(100, Math.max(5, burnoutAgents * (100 / 6)));

  // 2. TEAM PRESSURE SIGNAL — (rejected + overdue followups) / total active leads
  //    over the last 14 days. Pure Lead-table counts, no vault data involved.
  const now = new Date();
  const [rejectedCount, overdueCount, activeLeadsCount] = await Promise.all([
    prisma.lead.count({ where: { rejectedAt: { gte: since14d } } }),
    prisma.lead.count({
      where: {
        deletedAt: null,
        followupDate: { lt: now, gte: since14d },
        currentStatus: { notIn: SUPPRESSED_STATUSES },
      },
    }),
    prisma.lead.count({ where: { deletedAt: null, currentStatus: { notIn: SUPPRESSED_STATUSES } } }),
  ]);
  const stressIndex = activeLeadsCount === 0
    ? 0
    : Math.min(100, Math.round(((rejectedCount + overdueCount) / activeLeadsCount) * 100));
  const stressTone = stressIndex < 20
    ? { bar: "bg-emerald-500", text: "text-emerald-700" }
    : stressIndex < 50
    ? { bar: "bg-amber-500",   text: "text-amber-700" }
    : { bar: "bg-red-500",     text: "text-red-700" };
  const stressTooltip =
    `Pressure = (rejected leads + overdue follow-ups in last 14d) ÷ total active leads. ` +
    `${rejectedCount} rejected + ${overdueCount} overdue ÷ ${activeLeadsCount} active.`;

  // 3. MOOD TREND (last 30 days) — groupBy date+mood at the DB level. We use
  //    a raw query because Prisma groupBy can't truncate a timestamp to a day.
  //    NEVER selects `content` — only the mood enum-string and the day bucket.
  const trendRows = await prisma.$queryRaw<Array<{ day: Date; mood: string; n: bigint }>>`
    SELECT date_trunc('day', "createdAt") AS day, "mood", COUNT(*)::bigint AS n
    FROM "VaultEntry"
    WHERE "createdAt" >= ${since30d} AND "mood" IS NOT NULL
    GROUP BY day, "mood"
    ORDER BY day ASC
  `;
  // Bucket by YYYY-MM-DD → mood → count
  const trendByDay = new Map<string, Map<string, number>>();
  const moodsSeen = new Set<string>();
  for (const r of trendRows) {
    const key = format(r.day, "yyyy-MM-dd");
    if (!trendByDay.has(key)) trendByDay.set(key, new Map());
    trendByDay.get(key)!.set(r.mood, Number(r.n));
    moodsSeen.add(r.mood);
  }
  const trendDays = Array.from({ length: 30 }, (_, i) => subDays(today, 29 - i));
  let trendMax = 1;
  for (const d of trendDays) {
    const bucket = trendByDay.get(format(d, "yyyy-MM-dd"));
    if (!bucket) continue;
    let sum = 0;
    for (const v of bucket.values()) sum += v;
    if (sum > trendMax) trendMax = sum;
  }
  const moodOrder = Array.from(moodsSeen).sort();
  const CHART_W = 600;
  const CHART_H = 160;
  const PAD_L = 28;
  const PAD_B = 22;
  const PAD_T = 8;
  const barW = (CHART_W - PAD_L - 4) / 30;

  // 4. RESET MODE ADOPTION — VaultEntries with kind="reset" in last 30d, with
  //    trend arrow comparing the last 7d window to the prior 7d window.
  const [resetCount30d, resetLast7d, resetPrev7d] = await Promise.all([
    prisma.vaultEntry.count({ where: { kind: "reset", createdAt: { gte: since30d } } }),
    prisma.vaultEntry.count({ where: { kind: "reset", createdAt: { gte: since7d } } }),
    prisma.vaultEntry.count({ where: { kind: "reset", createdAt: { gte: prev7dStart, lt: prev7dEnd } } }),
  ]);
  const resetTrend: "up" | "down" | "flat" =
    resetLast7d > resetPrev7d ? "up" : resetLast7d < resetPrev7d ? "down" : "flat";
  const resetDelta = resetLast7d - resetPrev7d;

  // 5. AGENTS NEEDING SUPPORT — for each agent, look at their LAST 5 vault
  //    entries (mood + createdAt only — never content). If ≥3 are LOW_MOODS
  //    AND (followupStreak == 0 OR today's call count < 50% of dailyCallTarget),
  //    surface FIRST NAME only with a generic reason.
  const recentMoodRows = await prisma.vaultEntry.findMany({
    where: { userId: { in: agents.map((a) => a.id) }, mood: { not: null }, createdAt: { gte: since30d } },
    select: { userId: true, mood: true, createdAt: true }, // content intentionally omitted
    orderBy: { createdAt: "desc" },
  });
  const last5ByUser = new Map<string, string[]>();
  for (const r of recentMoodRows) {
    const arr = last5ByUser.get(r.userId) ?? [];
    if (arr.length < 5 && r.mood) { arr.push(r.mood); last5ByUser.set(r.userId, arr); }
  }
  // Today's call count per agent (for the "low daily activity" heuristic).
  const callsToday = await prisma.callLog.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: today } },
    _count: { _all: true },
  });
  const callsByUser = new Map(callsToday.map((c) => [c.userId, c._count._all]));

  type SupportCallout = { firstName: string; reason: string };
  const needsSupport: SupportCallout[] = [];
  for (const a of agents) {
    const last5 = last5ByUser.get(a.id) ?? [];
    if (last5.length < 3) continue; // not enough signal to call it declining
    const lowCount = last5.filter((m) => (LOW_MOODS as readonly string[]).includes(m)).length;
    if (lowCount < 3) continue;
    const calls = callsByUser.get(a.id) ?? 0;
    const target = a.dailyCallTarget ?? 30;
    const lowActivity = calls < target * 0.5;
    const brokenStreak = (a.followupStreak ?? 0) === 0;
    if (!(lowActivity || brokenStreak)) continue;
    const firstName = a.name.split(" ")[0];
    const bits: string[] = [];
    if (lowActivity) bits.push("low daily activity");
    bits.push("sustained low mood");
    if (brokenStreak) bits.push("broken follow-up streak");
    needsSupport.push({
      firstName,
      reason: `${bits.join(" + ")} — consider a 1:1`,
    });
  }

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">😊 Team Mood</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          Optional end-of-day check-ins from the team. Helps spot burnout early.
          Last 14 days · {todayResponded} / {agents.length} responded today.
        </p>
      </div>

      {/* Today's snapshot */}
      <div className="grid grid-cols-5 gap-2">
        {ORDER.map((k) => {
          const e = EMOJI[k];
          return (
            <div key={k} className={`card p-3 text-center ${e.cls}`}>
              <div className="text-2xl">{e.emoji}</div>
              <div className="text-2xl font-bold mt-1">{todayCounts[k]}</div>
              <div className="text-[10px] uppercase tracking-widest">{e.label}</div>
            </div>
          );
        })}
      </div>

      {/* ─── §10.6 ANONYMOUS TEAM INSIGHT ─────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-bold mt-2">🔒 Anonymous Team Insight</h2>
        <p className="text-[11px] text-gray-500">
          Aggregate signals only — individual journal entries stay private to the agent.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 1. Burnout-risk gauge */}
        <div className={`card p-4 ${burnoutTone.bg}`}>
          <div className="flex items-baseline justify-between">
            <div className="font-semibold">Burnout-risk gauge</div>
            <div className={`text-[11px] font-semibold ${burnoutTone.text}`}>{burnoutTone.label}</div>
          </div>
          <div className="mt-2 flex items-end gap-3">
            <div className={`text-3xl font-bold ${burnoutTone.text}`}>{burnoutAgents}</div>
            <div className="text-[11px] text-gray-600 pb-1">
              agent{burnoutAgents === 1 ? "" : "s"} with ≥{BURNOUT_THRESHOLD} low-mood entries (last 7d)
            </div>
          </div>
          <div className="mt-3 h-3 w-full rounded-full bg-white/70 overflow-hidden">
            <div className={`${burnoutTone.bar} h-3 rounded-full transition-all`} style={{ width: `${burnoutPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-gray-500">
            <span>0 (green)</span><span>1-2 (amber)</span><span>3+ (red)</span>
          </div>
        </div>

        {/* 2. Team pressure signal */}
        <div className="card p-4" title={stressTooltip}>
          <div className="flex items-baseline justify-between">
            <div className="font-semibold">Team pressure signal</div>
            <div className="text-[10px] text-gray-400 cursor-help" title={stressTooltip}>ⓘ what is this?</div>
          </div>
          <div className="mt-2 flex items-end gap-3">
            <div className={`text-3xl font-bold ${stressTone.text}`}>{stressIndex}</div>
            <div className="text-[11px] text-gray-600 pb-1">/ 100 stress index (last 14d)</div>
          </div>
          <div className="mt-3 h-3 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className={`${stressTone.bar} h-3 rounded-full transition-all`} style={{ width: `${stressIndex}%` }} />
          </div>
          <div className="mt-1 text-[10px] text-gray-500">
            {rejectedCount} rejected · {overdueCount} overdue follow-ups · {activeLeadsCount} active leads
          </div>
        </div>
      </div>

      {/* 3. Mood trend (last 30 days) — stacked bar chart, inline SVG. */}
      <div className="card p-4">
        <div className="flex items-baseline justify-between">
          <div className="font-semibold">Mood trend (last 30 days)</div>
          <div className="text-[11px] text-gray-500">Stacked by mood · daily counts</div>
        </div>
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          className="mt-3 w-full h-40"
          role="img"
          aria-label="Daily VaultEntry mood counts for the last 30 days"
        >
          {/* baseline */}
          <line x1={PAD_L} y1={CHART_H - PAD_B} x2={CHART_W} y2={CHART_H - PAD_B} stroke="#e5e7eb" />
          {/* y-axis ticks (0 + max) */}
          <text x={4} y={CHART_H - PAD_B} fontSize="9" fill="#9ca3af">0</text>
          <text x={4} y={PAD_T + 8} fontSize="9" fill="#9ca3af">{trendMax}</text>
          {trendDays.map((d, i) => {
            const key = format(d, "yyyy-MM-dd");
            const bucket = trendByDay.get(key);
            const x = PAD_L + i * barW;
            const segs: React.ReactElement[] = [];
            let yCursor = CHART_H - PAD_B;
            if (bucket) {
              for (const mood of moodOrder) {
                const v = bucket.get(mood) ?? 0;
                if (v === 0) continue;
                const h = ((CHART_H - PAD_B - PAD_T) * v) / trendMax;
                yCursor -= h;
                segs.push(
                  <rect
                    key={mood}
                    x={x + 1}
                    y={yCursor}
                    width={Math.max(1, barW - 2)}
                    height={h}
                    fill={moodColor(mood)}
                  >
                    <title>{format(d, "d MMM")} · {mood}: {v}</title>
                  </rect>
                );
              }
            }
            return <g key={key}>{segs}</g>;
          })}
          {/* x-axis labels — every 5th day */}
          {trendDays.map((d, i) => i % 5 === 0 ? (
            <text key={`lbl-${i}`} x={PAD_L + i * barW} y={CHART_H - 6} fontSize="9" fill="#9ca3af">
              {format(d, "d MMM")}
            </text>
          ) : null)}
        </svg>
        {moodOrder.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
            {moodOrder.map((m) => (
              <span key={m} className="inline-flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: moodColor(m) }} />
                <span className="text-gray-600">{m}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-gray-500">No mood data in the last 30 days.</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 4. Reset Mode adoption */}
        <div className="card p-4">
          <div className="font-semibold">Reset Mode adoption</div>
          <div className="mt-2 flex items-end gap-3">
            <div className="text-3xl font-bold">{resetCount30d}</div>
            <div className="text-[11px] text-gray-600 pb-1">resets logged (last 30d)</div>
          </div>
          <div className="mt-2 text-[11px] flex items-center gap-2">
            <span className={
              resetTrend === "up" ? "text-emerald-700" :
              resetTrend === "down" ? "text-red-700" : "text-gray-500"
            }>
              {resetTrend === "up" ? "▲" : resetTrend === "down" ? "▼" : "—"} {Math.abs(resetDelta)}
            </span>
            <span className="text-gray-500">
              vs prior 7d ({resetLast7d} this week, {resetPrev7d} previous)
            </span>
          </div>
        </div>

        {/* 5. Agents needing support callout */}
        <div className="card p-4">
          <div className="font-semibold">Agents needing support</div>
          <div className="text-[10px] text-gray-500 mb-2">First names only · no journal content shown.</div>
          {needsSupport.length === 0 ? (
            <div className="text-xs text-gray-500">Nobody flagged right now. 🌿</div>
          ) : (
            <ul className="space-y-2">
              {needsSupport.map((c) => (
                <li key={c.firstName} className="text-sm">
                  <span className="font-semibold">{c.firstName}</span>
                  <span className="text-gray-600"> · {c.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 14-day mood grid */}
      <div className="card overflow-x-auto">
        <table className="tbl min-w-[820px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10 text-left">Agent</th>
              {days.map((d) => (
                <th key={d.toISOString()} className="text-center text-[10px]">{format(d, "d MMM")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const inner = idx.get(a.id);
              return (
                <tr key={a.id}>
                  <td className="sticky left-0 bg-white z-10 font-semibold text-sm">
                    {a.name}
                    <div className="text-[10px] text-gray-500">{a.team ?? "—"}</div>
                  </td>
                  {days.map((d) => {
                    const m = inner?.get(format(d, "yyyy-MM-dd"));
                    return (
                      <td key={d.toISOString()} className="text-center" title={m?.comment ?? ""}>
                        {m ? (
                          <span className="text-xl" title={`${EMOJI[m.mood].label}${m.comment ? " — " + m.comment : ""}`}>
                            {EMOJI[m.mood].emoji}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent comments (last 7 days, latest first) */}
      <div className="card p-4">
        <div className="font-semibold mb-3">Recent comments (last 7 days)</div>
        <div className="space-y-2">
          {moods
            .filter((m) => m.comment && m.date >= subDays(today, 6))
            .sort((a, b) => b.date.getTime() - a.date.getTime())
            .slice(0, 20)
            .map((m) => (
              <div key={m.id} className="border-l-2 border-[#e5e7eb] pl-3 py-1">
                <div className="text-[11px] text-gray-500">
                  <b>{m.user.name}</b> · {format(m.date, "d MMM")} · {EMOJI[m.mood].emoji} {EMOJI[m.mood].label}
                </div>
                <div className="text-sm text-gray-800 italic">"{m.comment}"</div>
              </div>
            ))}
          {moods.filter((m) => m.comment && m.date >= subDays(today, 6)).length === 0 && (
            <div className="text-xs text-gray-500">No comments in the last 7 days.</div>
          )}
        </div>
      </div>
    </>
  );
}
