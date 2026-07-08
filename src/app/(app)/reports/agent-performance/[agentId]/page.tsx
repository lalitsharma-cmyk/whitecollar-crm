import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  buildAgentReport,
  resolveDateRange,
  connectRate,
  conversionRate,
  followupCompliance,
  type ReportScope,
  type AgentMetrics,
  type DrillKey,
} from "@/lib/agentPerformance";
import ConversionFunnel, { agentFunnel } from "@/components/ConversionFunnel";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// /reports/agent-performance/[agentId] — detailed single-agent view.
//   - All metric groups for the agent, in the selected period.
//   - Derived: Conversion %, Connect %, Follow-up Compliance %.
//   - Drill-down: each assignment/outcome/funnel metric links to a list of the
//     underlying lead records (…/[agentId]/drill?metric=…), whose count matches.
// Access: ADMIN any agent; MANAGER only own-team agents; AGENT only self.
// ─────────────────────────────────────────────────────────────────────────

function num(n: number): string {
  return n.toLocaleString("en-IN");
}

// Metric → drill key map (only metrics that have a lead-list drill-down).
const DRILLABLE: Partial<Record<keyof AgentMetrics, DrillKey>> = {
  totalAssigned: "totalAssigned",
  freshAssigned: "freshAssigned",
  websiteAssigned: "websiteAssigned",
  eventAssigned: "eventAssigned",
  revivalAssigned: "revivalAssigned",
  rejected: "rejected",
  closedWon: "closedWon",
  lost: "lost",
  stillActive: "stillActive",
  awaitingFollowup: "awaitingFollowup",
  noFollowup: "noFollowup",
  funnelQualified: "funnelQualified",
  funnelMeetings: "funnelMeetings",
  funnelSiteVisits: "funnelSiteVisits",
  funnelNegotiations: "funnelNegotiations",
  funnelBookings: "funnelBookings",
};

function Stat({
  label,
  value,
  agentId,
  metricKey,
  query,
  accent,
}: {
  label: string;
  value: number | string;
  agentId: string;
  metricKey?: keyof AgentMetrics;
  query: string;
  accent?: string;
}) {
  const drill = metricKey ? DRILLABLE[metricKey] : undefined;
  const inner = (
    <>
      <div className={`text-lg font-extrabold ${accent ?? ""}`}>{typeof value === "number" ? num(value) : value}</div>
      <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">{label}</div>
    </>
  );
  if (drill) {
    return (
      <Link
        href={`/reports/agent-performance/${agentId}/drill${query}&metric=${drill}`}
        className="card p-3 hover:shadow-md transition block"
      >
        {inner}
        <div className="text-[9px] text-blue-500 mt-1">view records →</div>
      </Link>
    );
  }
  return <div className="card p-3">{inner}</div>;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-bold text-gray-700 mb-2">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">{children}</div>
    </div>
  );
}

export default async function AgentDetailPage({
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

  // Access guard: AGENT may only view themselves.
  if (me.role === "AGENT" && agentId !== me.id) redirect("/reports/agent-performance");

  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, team: true, role: true, active: true, hrOnly: true },
  });
  if (!agent || agent.hrOnly) notFound();

  // MANAGER may only view own-team agents.
  if (me.role === "MANAGER") {
    const myTeam = normalizeTeam(me.team);
    if (myTeam && normalizeTeam(agent.team) !== myTeam) redirect("/reports/agent-performance");
  }

  // Reuse the engine but scoped to just this agent (build for all then pick, so
  // the numbers are byte-identical to the table). We scope by the agent's own
  // identity to keep the query tight.
  const scope: ReportScope = { role: "ADMIN", meId: agentId, team: null };
  const all = await buildAgentReport(range, scope);
  const m = all.find((r) => r.agentId === agentId);
  if (!m) notFound();

  // Thread filters onto drill links.
  const qs = new URLSearchParams();
  qs.set("range", range.preset);
  if (range.preset === "custom") {
    if (sp.from) qs.set("from", sp.from);
    if (sp.to) qs.set("to", sp.to);
  }
  const query = `?${qs.toString()}`;
  const backQuery = sp.team ? `${query}&team=${sp.team}` : query;

  const cr = connectRate(m);
  const cv = conversionRate(m);
  const fc = followupCompliance(m);

  return (
    <>
      <div>
        <Link href={`/reports/agent-performance${backQuery}`} className="text-xs text-gray-500 hover:underline">
          ← Back to agent performance
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold">{m.agentName}</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          {m.team ?? "—"} · {agent.role} · {range.label}
          {!agent.active && <span className="ml-1 text-rose-600">(inactive)</span>}
        </p>
      </div>

      {/* Headline derived ratios */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4 border-l-4 border-emerald-500">
          <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-bold">Conversion</div>
          <div className="text-2xl font-extrabold text-emerald-800 mt-1">{cv.toFixed(1)}%</div>
          <div className="text-[10px] text-gray-500">Bookings ÷ assigned (book)</div>
        </div>
        <div className="card p-4 border-l-4 border-violet-500">
          <div className="text-[10px] uppercase tracking-widest text-violet-700 font-bold">Call connect</div>
          <div className="text-2xl font-extrabold text-violet-800 mt-1">{cr.toFixed(0)}%</div>
          <div className="text-[10px] text-gray-500">Connected ÷ calls (period)</div>
        </div>
        <div className="card p-4 border-l-4 border-amber-500">
          <div className="text-[10px] uppercase tracking-widest text-amber-700 font-bold">Follow-up compliance</div>
          <div className="text-2xl font-extrabold text-amber-800 mt-1">{fc.toFixed(0)}%</div>
          <div className="text-[10px] text-gray-500">Active book not overdue</div>
        </div>
      </div>

      <Group title="Lead Assignment (by current owner)">
        <Stat label="Total Assigned" value={m.totalAssigned} agentId={agentId} metricKey="totalAssigned" query={query} accent="text-blue-700" />
        <Stat label="Fresh Assigned" value={m.freshAssigned} agentId={agentId} metricKey="freshAssigned" query={query} />
        <Stat label="Website Assigned" value={m.websiteAssigned} agentId={agentId} metricKey="websiteAssigned" query={query} />
        <Stat label="Event Assigned" value={m.eventAssigned} agentId={agentId} metricKey="eventAssigned" query={query} />
        <Stat label="Revival Assigned" value={m.revivalAssigned} agentId={agentId} metricKey="revivalAssigned" query={query} />
        <Stat label="Buyer Assigned (n/a)" value={m.buyerAssigned} agentId={agentId} query={query} accent="text-gray-400" />
      </Group>

      <Group title="Lead Outcomes (current book)">
        <Stat label="Rejected (in period)" value={m.rejected} agentId={agentId} metricKey="rejected" query={query} accent="text-rose-700" />
        <Stat label="Closed / Won" value={m.closedWon} agentId={agentId} metricKey="closedWon" query={query} accent="text-emerald-700" />
        <Stat label="Lost" value={m.lost} agentId={agentId} metricKey="lost" query={query} accent="text-rose-600" />
        <Stat label="Still Active" value={m.stillActive} agentId={agentId} metricKey="stillActive" query={query} />
        <Stat label="Awaiting Follow-up" value={m.awaitingFollowup} agentId={agentId} metricKey="awaitingFollowup" query={query} accent="text-amber-700" />
        <Stat label="No Follow-up" value={m.noFollowup} agentId={agentId} metricKey="noFollowup" query={query} accent="text-amber-600" />
      </Group>

      <Group title="Engagement (period)">
        {/* Total Calls = lead/Revival calls (callsLogged) + Buyer-Data calls (buyerCalls),
            so the tiles agree with the "Call connect" headline above, which already uses
            connectRate(m) = (callsLogged + buyerCalls). Buyer-Data work counted (Lalit 2026-07-08). */}
        <Stat label="Calls Logged" value={m.callsLogged + m.buyerCalls} agentId={agentId} query={query} accent="text-violet-700" />
        <Stat label="Connected Calls" value={m.connectedCalls + m.buyerConnectedCalls} agentId={agentId} query={query} accent="text-emerald-700" />
        <Stat label="Not Picked" value={m.notPickedCalls} agentId={agentId} query={query} accent="text-gray-500" />
        <Stat label="WhatsApp" value={m.whatsappConversations} agentId={agentId} query={query} />
        <Stat label="Notes Added" value={m.notesAdded} agentId={agentId} query={query} />
        <Stat label="Voice Notes" value={m.voiceNotesAdded} agentId={agentId} query={query} accent="text-gray-500" />
      </Group>

      <Group title="Meetings (period)">
        <Stat label="Scheduled" value={m.meetingsScheduled} agentId={agentId} query={query} />
        <Stat label="Completed" value={m.meetingsCompleted} agentId={agentId} query={query} accent="text-emerald-700" />
        <Stat label="Office" value={m.officeMeetings} agentId={agentId} query={query} />
        <Stat label="Virtual" value={m.virtualMeetings} agentId={agentId} query={query} />
      </Group>

      <Group title="Site Visits (period)">
        <Stat label="Scheduled" value={m.siteVisitsScheduled} agentId={agentId} query={query} />
        <Stat label="Completed" value={m.siteVisitsCompleted} agentId={agentId} query={query} accent="text-emerald-700" />
        <Stat label="Cancelled" value={m.siteVisitsCancelled} agentId={agentId} query={query} accent="text-gray-500" />
      </Group>

      <ConversionFunnel stages={agentFunnel(m)} title="Conversion funnel" />
    </>
  );
}
