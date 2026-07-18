import { prisma } from "@/lib/prisma";
import { PENDING_CALL_OUTCOMES } from "@/lib/ghosting";

/**
 * 💡 Best time to call — small gold-tinted chip rendered in the lead header.
 *
 * Per-lead signal only: aggregates THIS lead's CallLog rows by hour-of-day
 * in IST. Requires at least 1 CONNECTED call (MIN_CONNECTED = 1). Picks the
 * hour with the best connect rate; ties broken by raw connected count.
 *
 * Returns null when there is no per-lead connected call data — the chip
 * disappears rather than rendering a misleading org-wide average.
 *
 * Hour grouping is done in Postgres via `AT TIME ZONE 'Asia/Kolkata'`
 * so DST/offset math stays in the DB. We don't trust JS Date math on
 * the server (could be UTC, could be the runner's TZ — different across
 * Vercel regions vs local dev).
 */
type HourRow = { hour: number; total: number; connected: number };

function fmtHourIST(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  if (h < 12) return `${h}am`;
  return `${h - 12}pm`;
}

const MIN_CONNECTED = 1;

function pickBestHour(rows: HourRow[]): HourRow | null {
  let best: HourRow | null = null;
  for (const r of rows) {
    // Coerce — Prisma may return BigInt/string for COUNT/SUM aggregates
    // depending on driver version; Number() normalizes for the comparison.
    const total = Number(r.total);
    const connected = Number(r.connected);
    if (connected < MIN_CONNECTED) continue;
    const rate = total > 0 ? connected / total : 0;
    if (
      !best ||
      rate > (Number(best.connected) / Math.max(1, Number(best.total))) ||
      (rate === Number(best.connected) / Math.max(1, Number(best.total)) &&
        connected > Number(best.connected))
    ) {
      best = { hour: Number(r.hour), total, connected };
    }
  }
  return best;
}

export default async function BestCallTimeChip({ leadId }: { leadId: string }) {
  // ── Step 1: per-lead hour distribution ──────────────────────────────
  // Parameter binding (${leadId}) — never string-interp into raw SQL.
  const perLeadRows = await prisma.$queryRaw<HourRow[]>`
    SELECT
      EXTRACT(HOUR FROM "startedAt" AT TIME ZONE 'Asia/Kolkata')::int AS hour,
      COUNT(*)::int AS total,
      SUM(CASE WHEN outcome::text = 'CONNECTED' THEN 1 ELSE 0 END)::int AS connected
    FROM "CallLog"
    -- Only real, agent-logged calls — imported MIS remarks (attributedAgentName
    -- set) are Historical Notes, not dialled calls, so they must not skew best-time.
    -- Same reasoning for unresolved dials (INITIATED / RINGING): they can never be
    -- CONNECTED, so they only pad the total and drag the connect rate of whatever
    -- hour they landed in — which is exactly the hour ranking this chip reports.
    -- (No backticks in these comments: this is a template literal, so one would
    -- terminate the query and the rest of the SQL would parse as TypeScript.)
    WHERE "leadId" = ${leadId} AND "attributedAgentName" IS NULL
      AND "outcome"::text <> ALL(${PENDING_CALL_OUTCOMES})
    GROUP BY hour
  `;

  const perLeadBest = pickBestHour(perLeadRows);

  // No org-wide fallback — if this lead has no connected call history,
  // render nothing rather than showing a misleading "org average" time.
  if (!perLeadBest) return null;

  const bestHour = perLeadBest.hour;
  const totalCalls = perLeadBest.total;
  const connectedCalls = perLeadBest.connected;
  const rate = connectedCalls / Math.max(1, totalCalls);
  const pct = Math.round(rate * 100);

  const callWord = connectedCalls === 1 ? "call" : "calls";
  const label = `💡 Best time: ${fmtHourIST(bestHour)} IST (${connectedCalls} connected ${callWord})`;
  const tooltip = `Based on this lead's call history — ${connectedCalls}/${totalCalls} connected at ${fmtHourIST(bestHour)} IST (${pct}% pickup).`;

  // Gold-tinted chip — matches the brand accent used elsewhere (.btn-gold,
  // border-[#c9a24b] on EOI/WHO IS THE CLIENT cards). Inline styles instead
  // of relying on tailwind arbitrary values for the color so it's robust
  // even if the JIT misses the class.
  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold border"
      style={{
        background: "#fef3c7",
        color: "#92400e",
        borderColor: "#c9a24b",
      }}
    >
      {label}
    </span>
  );
}
