import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  resolveDateRange,
  drilldownWhere,
  DRILL_LABELS,
  type DrillKey,
} from "@/lib/agentPerformance";
import { formatLeadName } from "@/lib/leadName";
import { statusColor } from "@/lib/lead-statuses";
import { effectiveSource } from "@/lib/sourceLabel";
import { fmtISTDate } from "@/lib/datetime";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// Drill-down — lists the actual lead records behind a single metric for one
// agent + period. The where-clause is drilldownWhere(metric, agentId, range),
// the SAME query the count came from, so the number of rows here reconciles
// 1:1 with the metric on the table / detail view. Deleted leads excluded.
// Access mirrors the detail page (AGENT self only; MANAGER own team).
// ─────────────────────────────────────────────────────────────────────────

const VALID_KEYS = new Set<string>(Object.keys(DRILL_LABELS));

export default async function DrillPage({
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
  const key = metric as DrillKey;

  if (me.role === "AGENT" && agentId !== me.id) redirect("/reports/agent-performance");

  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, team: true, hrOnly: true },
  });
  if (!agent || agent.hrOnly) notFound();

  if (me.role === "MANAGER") {
    const myTeam = normalizeTeam(me.team);
    if (myTeam && normalizeTeam(agent.team) !== myTeam) redirect("/reports/agent-performance");
  }

  const where = drilldownWhere(key, agentId, range);
  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      select: {
        id: true, name: true, phone: true, currentStatus: true,
        source: true, sourceRaw: true, forwardedTeam: true,
        followupDate: true, createdAt: true, rejectedAt: true, rejectionReason: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.lead.count({ where }),
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
        <Link href={`/reports/agent-performance/${agentId}${backQuery}`} className="text-xs text-gray-500 hover:underline">
          ← Back to {agent.name}
        </Link>
        <h1 className="text-lg sm:text-xl font-bold">{DRILL_LABELS[key]}</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          {agent.name} · {range.label} · <strong>{total.toLocaleString("en-IN")}</strong> record{total !== 1 ? "s" : ""}
          {total > 500 ? " (showing first 500)" : ""}
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[640px] text-sm">
          <thead>
            <tr className="text-[11px]">
              <th>Lead</th>
              <th>Status</th>
              <th>Team</th>
              <th>Source</th>
              <th>Follow-up</th>
              <th>Created</th>
              {key === "rejected" && <th>Reject reason</th>}
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">
                  <Link href={`/leads/${l.id}`} className="text-blue-600 hover:underline font-medium">
                    {formatLeadName(l.name)}
                  </Link>
                </td>
                <td>
                  <span className={`chip ${statusColor(l.currentStatus)}`}>{l.currentStatus ?? "Fresh"}</span>
                </td>
                <td className="text-gray-600">{l.forwardedTeam ?? "—"}</td>
                <td className="text-gray-600 text-xs">{effectiveSource(l.sourceRaw, l.source)}</td>
                <td className="text-gray-600 text-xs">{l.followupDate ? fmtISTDate(l.followupDate) : "—"}</td>
                <td className="text-gray-500 text-xs">{fmtISTDate(l.createdAt)}</td>
                {key === "rejected" && <td className="text-gray-600 text-xs">{l.rejectionReason ?? "—"}</td>}
              </tr>
            ))}
            {leads.length === 0 && (
              <tr>
                <td colSpan={key === "rejected" ? 7 : 6} className="text-center text-gray-400 py-6">
                  No records
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-gray-500">
        This list runs the exact query behind the metric — the record count above reconciles 1:1 with the number shown on the
        report. Deleted &amp; recycle-bin leads are excluded.
      </div>
    </>
  );
}
