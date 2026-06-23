import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  resolveDateRange,
  buyerDrilldownWhere,
  buyerEventCount,
  BUYER_DRILL_LABELS,
  BUYER_EVENT_METRICS,
  type BuyerDrillKey,
} from "@/lib/buyerPerformance";
import { fmtISTDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// Buyer drill-down — lists the actual BuyerRecords behind a single metric for
// one agent + period. The where-clause is buyerDrilldownWhere(metric, agentId,
// range), the SAME query the count came from, so the number of distinct buyer
// rows here reconciles 1:1 with the metric.
//
// For EVENT metrics (calls/notes/WA/voice/attempts/converted/rejected/returns) a
// buyer can appear behind multiple events — so we ALSO show the raw event count
// (buyerEventCount) which equals the report number, alongside the distinct-buyer
// count. Each row shows: assigned owner, pool status, transfer history (stints),
// attempt count, and a conversion link when converted.
// Access mirrors the detail page (AGENT self only; MANAGER own team).
// Deleted buyers excluded.
// ─────────────────────────────────────────────────────────────────────────

const VALID_KEYS = new Set<string>(Object.keys(BUYER_DRILL_LABELS));

const POOL_LABEL: Record<string, string> = {
  ADMIN_POOL: "Admin Pool",
  ASSIGNED: "Assigned",
  CONVERTED: "Converted",
  REJECTED: "Rejected",
};

const RETURN_REASON_LABEL: Record<string, string> = {
  MANUAL_REJECT: "Manual reject",
  AUTO_5_ATTEMPTS: "Auto (5 attempts)",
  ADMIN_REASSIGN: "Admin reassign",
};

function poolChipClass(status: string): string {
  switch (status) {
    case "CONVERTED": return "bg-emerald-100 text-emerald-800";
    case "ASSIGNED": return "bg-blue-100 text-blue-800";
    case "REJECTED": return "bg-rose-100 text-rose-800";
    default: return "bg-gray-100 text-gray-700"; // ADMIN_POOL
  }
}

export default async function BuyerDrillPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  const { agentId } = await params;
  const sp = await searchParams;
  const range = resolveDateRange(sp.range, sp.from, sp.to);
  const metric = sp.metric;

  if (!metric || !VALID_KEYS.has(metric)) notFound();
  const key = metric as BuyerDrillKey;

  if (me.role === "AGENT" && agentId !== me.id) redirect("/reports/buyer-performance");

  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, team: true, hrOnly: true },
  });
  if (!agent || agent.hrOnly) notFound();

  if (me.role === "MANAGER") {
    const myTeam = normalizeTeam(me.team);
    if (myTeam && normalizeTeam(agent.team) !== myTeam) redirect("/reports/buyer-performance");
  }

  const where = buyerDrilldownWhere(key, agentId, range);
  const isEvent = BUYER_EVENT_METRICS.has(key);

  const [buyers, distinctTotal, eventTotal] = await Promise.all([
    prisma.buyerRecord.findMany({
      where,
      select: {
        id: true,
        clientName: true,
        projectName: true,
        poolStatus: true,
        attemptCount: true,
        ownerId: true,
        owner: { select: { name: true } },
        convertedLeadId: true,
        // Stint history — who held the buyer, when, why it returned.
        assignments: {
          select: {
            id: true,
            assignedAt: true,
            returnedAt: true,
            returnReason: true,
            attemptsInStint: true,
            user: { select: { name: true } },
          },
          orderBy: { assignedAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
    prisma.buyerRecord.count({ where }),
    isEvent ? buyerEventCount(key, agentId, range) : Promise.resolve(0),
  ]);

  const qs = new URLSearchParams();
  qs.set("range", range.preset);
  if (range.preset === "custom") {
    if (sp.from) qs.set("from", sp.from);
    if (sp.to) qs.set("to", sp.to);
  }
  const backQuery = `?${qs.toString()}`;

  return (
    <>
      <div>
        <Link href={`/reports/buyer-performance/${agentId}${backQuery}`} className="text-xs text-gray-500 hover:underline">
          ← Back to {agent.name}
        </Link>
        <h1 className="text-lg sm:text-xl font-bold">{BUYER_DRILL_LABELS[key]}</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          {agent.name} · {range.label} ·{" "}
          {isEvent ? (
            <>
              <strong>{eventTotal.toLocaleString("en-IN")}</strong> event{eventTotal !== 1 ? "s" : ""} across{" "}
              <strong>{distinctTotal.toLocaleString("en-IN")}</strong> buyer{distinctTotal !== 1 ? "s" : ""}
            </>
          ) : (
            <>
              <strong>{distinctTotal.toLocaleString("en-IN")}</strong> buyer record{distinctTotal !== 1 ? "s" : ""}
            </>
          )}
          {distinctTotal > 500 ? " (showing first 500)" : ""}
        </p>
      </div>

      {isEvent && (
        <div className="card p-3 bg-violet-50 border-l-4 border-violet-400 text-[11px] text-violet-800">
          This is an <strong>event</strong> metric: the report shows <strong>{eventTotal.toLocaleString("en-IN")}</strong> (the count of
          activity rows the agent logged). The same buyer can appear behind several events, so the distinct buyers listed below
          ({distinctTotal.toLocaleString("en-IN")}) may be fewer. Both numbers come from the same query — they reconcile.
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[820px] text-sm">
          <thead>
            <tr className="text-[11px]">
              <th>Buyer</th>
              <th>Project</th>
              <th>Status</th>
              <th className="text-center">Attempts</th>
              <th>Current owner</th>
              <th>Transfer history (stints)</th>
              <th>Converted lead</th>
            </tr>
          </thead>
          <tbody>
            {buyers.map((b) => (
              <tr key={b.id}>
                <td className="whitespace-nowrap">
                  <Link href={`/buyer-data/${b.id}`} className="text-blue-600 hover:underline font-medium">
                    {b.clientName}
                  </Link>
                </td>
                <td className="text-gray-600 text-xs">{b.projectName ?? "—"}</td>
                <td>
                  <span className={`chip ${poolChipClass(b.poolStatus)}`}>{POOL_LABEL[b.poolStatus] ?? b.poolStatus}</span>
                </td>
                <td className="text-center text-gray-700 tabular-nums">{b.attemptCount}</td>
                <td className="text-gray-600 text-xs">{b.owner?.name ?? "—"}</td>
                <td className="text-gray-600 text-[11px] leading-snug">
                  {b.assignments.length === 0 ? (
                    "—"
                  ) : (
                    <div className="space-y-0.5">
                      {b.assignments.map((s) => (
                        <div key={s.id}>
                          <span className="font-medium">{s.user?.name ?? "—"}</span>{" "}
                          <span className="text-gray-400">{fmtISTDate(s.assignedAt)}</span>
                          {s.returnedAt ? (
                            <span className="text-amber-700">
                              {" → "}returned {fmtISTDate(s.returnedAt)}
                              {s.returnReason ? ` (${RETURN_REASON_LABEL[s.returnReason] ?? s.returnReason})` : ""}
                            </span>
                          ) : (
                            <span className="text-emerald-700"> · active</span>
                          )}
                          <span className="text-gray-400"> · {s.attemptsInStint} att.</span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="text-xs">
                  {b.convertedLeadId ? (
                    <Link href={`/leads/${b.convertedLeadId}`} className="text-emerald-700 hover:underline font-medium">
                      view lead →
                    </Link>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {buyers.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-6">
                  No records
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-gray-500">
        This list runs the exact query behind the metric — the {isEvent ? "buyer / event counts above reconcile" : "record count above reconciles"} with the
        number shown on the report. Each row shows the buyer&apos;s current owner, full transfer history (every stint, with return reason
        and per-stint attempts), attempt count, and the converted-lead link. Deleted &amp; recycle-bin buyers are excluded.
      </div>
    </>
  );
}
