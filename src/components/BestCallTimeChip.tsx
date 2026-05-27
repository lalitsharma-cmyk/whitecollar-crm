import { prisma } from "@/lib/prisma";

/**
 * 💡 Best time to call — small gold-tinted chip rendered in the lead header.
 *
 * Step 1 — Per-lead signal: aggregate THIS lead's CallLog rows by
 * hour-of-day in IST. If any hour has ≥3 CONNECTED calls, pick the hour
 * with the best connect rate (ties broken by raw connected count).
 *
 * Step 2 — Org-wide fallback: if per-lead history is too thin, run the
 * same query as /reports (last 30 days, all users) and surface the
 * best org-wide hour. Same ≥3 connected guard applies.
 *
 * Returns null if neither source has any signal at all — the chip just
 * disappears rather than rendering an empty placeholder.
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

const MIN_CONNECTED = 3;

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
    WHERE "leadId" = ${leadId}
    GROUP BY hour
  `;

  const perLeadBest = pickBestHour(perLeadRows);

  let bestHour: number | null = null;
  let rate = 0;
  let source: "lead" | "org" = "lead";
  let totalCalls = 0;
  let connectedCalls = 0;

  if (perLeadBest) {
    bestHour = perLeadBest.hour;
    totalCalls = perLeadBest.total;
    connectedCalls = perLeadBest.connected;
    rate = connectedCalls / Math.max(1, totalCalls);
    source = "lead";
  } else {
    // ── Step 2: org-wide fallback (last 30 days) ────────────────────
    // Same shape as the /reports heatmap, just collapsed across DOW so
    // we only group by hour. No user scoping — header chip is purely
    // informational so we don't restrict by role here.
    const orgRows = await prisma.$queryRaw<HourRow[]>`
      SELECT
        EXTRACT(HOUR FROM "startedAt" AT TIME ZONE 'Asia/Kolkata')::int AS hour,
        COUNT(*)::int AS total,
        SUM(CASE WHEN outcome::text = 'CONNECTED' THEN 1 ELSE 0 END)::int AS connected
      FROM "CallLog"
      WHERE "startedAt" >= NOW() - INTERVAL '30 days'
      GROUP BY hour
    `;
    const orgBest = pickBestHour(orgRows);
    if (!orgBest) return null;
    bestHour = orgBest.hour;
    totalCalls = orgBest.total;
    connectedCalls = orgBest.connected;
    rate = connectedCalls / Math.max(1, totalCalls);
    source = "org";
  }

  const pct = Math.round(rate * 100);
  const label =
    source === "lead"
      ? `💡 Best time to call: ${fmtHourIST(bestHour)} IST`
      : `💡 Best time (org avg): ${fmtHourIST(bestHour)} IST`;
  const tooltip =
    source === "lead"
      ? `Based on this lead's calls — ${connectedCalls}/${totalCalls} connected at ${fmtHourIST(bestHour)} IST (${pct}% pickup).`
      : `Org-wide last 30 days — ${connectedCalls}/${totalCalls} connected at ${fmtHourIST(bestHour)} IST (${pct}% pickup).`;

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
