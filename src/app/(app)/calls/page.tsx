import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { fmtIST12 } from "@/lib/datetime";
import CallsClient, { type CallRowData } from "@/components/CallsClient";

export const dynamic = "force-dynamic";

// Row shape returned by the connect-rate-by-hour heatmap query. Postgres returns
// numeric aggregates as bigint when grouping with COUNT/SUM, so we parse them
// to plain JS numbers on the way in.
type HourRow = { hour: number; total: number; connected: number };

// Per-call quality row computed server-side. Score is 0–100, or null when we
// don't have enough signal to score (outcome is missing).
type QualityRow = {
  id: string;
  startedAt: Date;
  outcome: string | null;
  leadName: string;
  agent: string;
  score: number | null;
};

export default async function CallsPage() {
  const me = await requireUser();
  const isAgent = me.role === "AGENT";

  // -------- 1) Connect-rate-by-hour heatmap (last 14 days, IST) --------
  // Extract hour-of-day in IST from startedAt, group + count, sum CONNECTED.
  // Role scoping: AGENT sees only their own calls; ADMIN/MANAGER see all.
  const hourRowsRaw = isAgent
    ? await prisma.$queryRaw<Array<{ hour: number; total: bigint; connected: bigint }>>`
        SELECT EXTRACT(HOUR FROM "startedAt" AT TIME ZONE 'Asia/Kolkata')::int AS hour,
               COUNT(*)::bigint AS total,
               SUM(CASE WHEN "outcome" = 'CONNECTED' THEN 1 ELSE 0 END)::bigint AS connected
        FROM "CallLog"
        WHERE "startedAt" >= NOW() - INTERVAL '14 days'
          AND "userId" = ${me.id}
        GROUP BY 1
        ORDER BY 1
      `
    : await prisma.$queryRaw<Array<{ hour: number; total: bigint; connected: bigint }>>`
        SELECT EXTRACT(HOUR FROM "startedAt" AT TIME ZONE 'Asia/Kolkata')::int AS hour,
               COUNT(*)::bigint AS total,
               SUM(CASE WHEN "outcome" = 'CONNECTED' THEN 1 ELSE 0 END)::bigint AS connected
        FROM "CallLog"
        WHERE "startedAt" >= NOW() - INTERVAL '14 days'
        GROUP BY 1
        ORDER BY 1
      `;

  // Normalize into a fixed 24-slot array indexed by hour-of-day so the strip
  // always renders all 24 cells even when some hours have zero calls.
  const byHour = new Map<number, HourRow>();
  for (const r of hourRowsRaw) {
    byHour.set(Number(r.hour), {
      hour: Number(r.hour),
      total: Number(r.total),
      connected: Number(r.connected),
    });
  }
  const hours: HourRow[] = Array.from({ length: 24 }, (_, h) =>
    byHour.get(h) ?? { hour: h, total: 0, connected: 0 }
  );

  // -------- 2) Recent calls list --------
  // Role scoping (audit B-02): an AGENT must see ONLY their own calls. Without
  // this where-clause the list returned the latest 50 calls COMPANY-WIDE, and
  // tapping a row exposed peers' lead name/phone/email/budget/BANT/notes via
  // CallsClient (plus the QualityList below, which maps over the same array).
  // Mirror the heatmap scope above: AGENT → own (userId), ADMIN/MANAGER → all.
  const calls = await prisma.callLog.findMany({
    where: isAgent ? { userId: me.id } : {},
    orderBy: { startedAt: "desc" },
    take: 50,
    // B-15: select only the fields the QualityList + CallsClient rows actually
    // render. `lead` is a ~100-column model with long-text fields (aiSummary,
    // remarks, photoUrls, EOI/KYC/commission…); a bare `include` dragged all of
    // them ×50 rows ×(1 + up to 5 nested call logs). The `where` scope above is
    // unchanged — this only narrows the column projection.
    select: {
      id: true,
      startedAt: true,
      outcome: true,
      direction: true,
      durationSec: true,
      notes: true,
      phoneNumber: true,
      attributedAgentName: true,
      user: { select: { name: true } },
      lead: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          status: true,
          aiScore: true,
          aiScoreValue: true,
          bantStatus: true,
          bantReason: true,
          budgetMin: true,
          budgetCurrency: true,
          configuration: true,
          whoIsClient: true,
          followupDate: true,
          todoNext: true,
          forwardedTeam: true,
          currentStatus: true,
          categorization: true,
          owner: { select: { name: true } },
          callLogs: {
            orderBy: { startedAt: "desc" },
            take: 5,
            select: {
              startedAt: true,
              outcome: true,
              attributedAgentName: true,
              notes: true,
              user: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // Compute per-call quality scores for the standalone Quality column below.
  // Kept here in page.tsx (not CallsClient) because the spec scopes edits to
  // this file only. Scoring rules: +50 connected/interested, +20 ≥60s,
  // +10 ≥180s, +20 note present, capped at 100.
  const quality: QualityRow[] = calls.map((c) => ({
    id: c.id,
    startedAt: c.startedAt,
    outcome: c.outcome,
    leadName: c.lead?.name ?? c.phoneNumber ?? "—",
    agent: c.attributedAgentName ?? c.user?.name ?? "—",
    score: c.outcome ? scoreCall(c.outcome, c.durationSec, c.notes) : null,
  }));

  const rows: CallRowData[] = calls.map((c) => ({
    id: c.id,
    startedAt: c.startedAt.toISOString(),
    outcome: c.outcome,
    direction: c.direction,
    durationSec: c.durationSec,
    notes: c.notes,
    phoneNumber: c.phoneNumber,
    agentName: c.user?.name ?? "—",
    attributedAgentName: c.attributedAgentName,
    lead: c.lead
      ? {
          id: c.lead.id,
          name: c.lead.name,
          phone: c.lead.phone,
          email: c.lead.email,
          status: c.lead.status,
          aiScore: c.lead.aiScore,
          aiScoreValue: c.lead.aiScoreValue,
          bantStatus: c.lead.bantStatus,
          bantReason: c.lead.bantReason,
          budgetMin: c.lead.budgetMin,
          budgetCurrency: c.lead.budgetCurrency,
          configuration: c.lead.configuration,
          whoIsClient: c.lead.whoIsClient,
          followupDate: c.lead.followupDate ? c.lead.followupDate.toISOString() : null,
          todoNext: c.lead.todoNext,
          team: c.lead.forwardedTeam,
          currentStatus: c.lead.currentStatus,
          categorization: c.lead.categorization,
          ownerName: c.lead.owner?.name ?? null,
          recentCallSummary: c.lead.callLogs.map((rc) => ({
            at: rc.startedAt.toISOString(),
            outcome: rc.outcome,
            agent: rc.attributedAgentName ?? rc.user?.name ?? "—",
            note: rc.notes,
          })),
        }
      : null,
  }));

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">Call Records</h1>
        <p className="text-xs text-gray-500">Tap a row to see that client's full summary on the right.</p>
      </div>

      {/* Connect-rate-by-hour heatmap (last 14 days, IST). 24 cells, one per
          hour-of-day, tinted from gray (0%) to green (100%). Scope respects
          role: agents see only their own activity, leadership sees all. */}
      <HourHeatmap hours={hours} scope={isAgent ? "you" : "team"} />

      {/* Per-call quality scores for the same 50 calls shown below. Rendered
          here in page.tsx (not inside CallsClient) because the spec scopes
          edits to this file only. */}
      <QualityList rows={quality} />

      <CallsClient calls={rows} />
    </>
  );
}

// ---------- Heatmap ----------

function HourHeatmap({ hours, scope }: { hours: HourRow[]; scope: "you" | "team" }) {
  const totalCalls = hours.reduce((s, h) => s + h.total, 0);
  const totalConnected = hours.reduce((s, h) => s + h.connected, 0);
  const overallRate = totalCalls > 0 ? Math.round((totalConnected / totalCalls) * 100) : 0;

  return (
    <div className="card p-3 sm:p-4 my-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-[#0b1a33]">
            Connect rate by hour <span className="text-[10px] font-normal text-gray-500">(last 14 days · IST · {scope === "you" ? "your calls" : "all calls"})</span>
          </div>
          <div className="text-[11px] text-gray-500">
            {totalCalls.toLocaleString()} calls · {overallRate}% connected overall
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-gray-500">
          <span>0%</span>
          <div className="flex">
            {[0, 25, 50, 75, 100].map((p) => (
              <div key={p} className="w-3 h-3" style={{ background: tintForRate(p) }} />
            ))}
          </div>
          <span>100%</span>
        </div>
      </div>
      <div className="grid grid-cols-12 sm:grid-cols-24 gap-0.5">
        {hours.map((h) => {
          const rate = h.total > 0 ? Math.round((h.connected / h.total) * 100) : 0;
          const bg = h.total === 0 ? "#f3f4f6" : tintForRate(rate);
          const hourLabel = `${String(h.hour).padStart(2, "0")}:00 IST · ${h.total} call${h.total === 1 ? "" : "s"} · ${rate}% connected`;
          return (
            <div
              key={h.hour}
              title={hourLabel}
              className="aspect-square rounded flex flex-col items-center justify-center text-center"
              style={{ background: bg }}
            >
              <div className="text-[9px] font-semibold text-[#0b1a33] leading-tight">
                {h.total === 0 ? "—" : `${rate}%`}
              </div>
              <div className="text-[7px] text-gray-600 leading-tight">
                {h.total === 0 ? "" : `n=${h.total}`}
              </div>
              <div className="text-[7px] text-gray-500 leading-tight">{String(h.hour).padStart(2, "0")}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Scale 0 → gray-100, 100 → emerald-500-ish. Interpolated in RGB space — good
// enough for a 24-cell strip, no chroma library needed.
function tintForRate(rate: number): string {
  const t = Math.max(0, Math.min(100, rate)) / 100;
  // gray-100 (#f3f4f6) → emerald-500 (#10b981)
  const from = { r: 0xf3, g: 0xf4, b: 0xf6 };
  const to = { r: 0x10, g: 0xb9, b: 0x81 };
  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

// ---------- Quality scoring ----------

// Compute a 0-100 quality score for a single call. Heuristic rules per spec
// §9.10: connect/intent matters most, duration adds confidence the agent
// actually spoke to the client, a note proves the agent captured something.
function scoreCall(outcome: string, durationSec: number | null, notes: string | null): number {
  let score = 0;
  if (outcome === "CONNECTED" || outcome === "INTERESTED") score += 50;
  if (durationSec !== null) {
    if (durationSec >= 60) score += 20;
    if (durationSec >= 180) score += 10;
  }
  if (notes && notes.trim().length > 0) score += 20;
  return Math.min(100, score);
}

function QualityList({ rows }: { rows: QualityRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="card overflow-hidden my-3">
      <div className="px-3 sm:px-4 py-2 border-b border-[#e5e7eb] flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[#0b1a33]">Call quality (latest {rows.length})</div>
        <div className="text-[10px] text-gray-500">
          Score: +50 connected · +20 ≥60s · +10 ≥180s · +20 note
        </div>
      </div>
      <table className="tbl w-full">
        <thead>
          <tr>
            <th>Time</th>
            <th>Lead</th>
            <th>Agent</th>
            <th>Quality</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="text-sm whitespace-nowrap">{fmtIST12(r.startedAt.toISOString())} IST</td>
              <td className="text-sm font-medium">{r.leadName}</td>
              <td className="text-sm">{r.agent}</td>
              <td><QualityPill score={r.score} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualityPill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-gray-400">—</span>;
  const cls =
    score >= 70 ? "bg-emerald-100 text-emerald-700"
      : score >= 40 ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>
      {score}
    </span>
  );
}
