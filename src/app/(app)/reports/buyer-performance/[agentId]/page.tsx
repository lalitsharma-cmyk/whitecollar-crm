import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { canAccessDubaiBuyers } from "@/lib/buyerScope";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  buildBuyerReport,
  resolveDateRange,
  avgAttempts,
  buyerConversionRate,
  buyerContactRate,
  totalReturned,
  type BuyerReportScope,
  type BuyerAgentMetrics,
  type BuyerDrillKey,
} from "@/lib/buyerPerformance";
import BuyerConversionFunnel, { buyerAgentFunnel } from "@/components/BuyerConversionFunnel";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// /reports/buyer-performance/[agentId] — detailed single-agent buyer view.
//   - All buyer metric groups for the agent, in the selected period.
//   - Derived: Conversion %, Contact %, Avg attempts / buyer.
//   - Drill-down: each metric links to a list of the underlying BuyerRecords
//     (…/[agentId]/drill?metric=…), whose count matches.
// Access: ADMIN any agent; MANAGER only own-team agents; AGENT only self.
// Mirrors the agent-performance detail page.
// ─────────────────────────────────────────────────────────────────────────

function num(n: number): string {
  return n.toLocaleString("en-IN");
}

// Metric → drill key map (every drillable metric).
const DRILLABLE: Partial<Record<keyof BuyerAgentMetrics, BuyerDrillKey>> = {
  buyersAssigned: "buyersAssigned",
  converted: "converted",
  rejected: "rejected",
  autoReturned: "autoReturned",
  manualReturned: "manualReturned",
  callsLogged: "callsLogged",
  whatsappInteractions: "whatsappInteractions",
  notesAdded: "notesAdded",
  voiceNotesAdded: "voiceNotesAdded",
  totalAttempts: "totalAttempts",
  funnelContacted: "funnelContacted",
  funnelEngaged: "funnelEngaged",
  funnelConverted: "funnelConverted",
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
  metricKey?: keyof BuyerAgentMetrics;
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
        href={`/reports/buyer-performance/${agentId}/drill${query}&metric=${drill}`}
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

export default async function BuyerAgentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  // Dubai Buyer Data — admin + Dubai-team users only.
  if (!canAccessDubaiBuyers(me)) redirect("/reports");
  const { agentId } = await params;
  const sp = await searchParams;
  const range = resolveDateRange(sp.range, sp.from, sp.to);

  // Access guard: AGENT may only view themselves.
  if (me.role === "AGENT" && agentId !== me.id) redirect("/reports/buyer-performance");

  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, team: true, role: true, active: true, hrOnly: true },
  });
  if (!agent || agent.hrOnly) notFound();

  // MANAGER may only view own-team agents.
  if (me.role === "MANAGER") {
    const myTeam = normalizeTeam(me.team);
    if (myTeam && normalizeTeam(agent.team) !== myTeam) redirect("/reports/buyer-performance");
  }

  // Reuse the engine but scoped to just this agent (build for all then pick, so
  // the numbers are byte-identical to the table).
  const scope: BuyerReportScope = { role: "ADMIN", meId: agentId, team: null };
  const all = await buildBuyerReport(range, scope);
  const m = all.find((r) => r.agentId === agentId) ?? null;
  // An agent with no buyer activity still gets a zero row from buildBuyerReport
  // (scopedBuyerAgents returns them), but guard defensively.
  if (!m) {
    // Fall back to an explicit zero card set rather than 404 — the agent exists.
    return (
      <>
        <div>
          <Link href="/reports/buyer-performance" className="text-xs text-gray-500 hover:underline">← Back to buyer performance</Link>
          <h1 className="text-xl sm:text-2xl font-bold">{agent.name}</h1>
          <p className="text-xs sm:text-sm text-gray-500">{agent.team ?? "—"} · {agent.role} · {range.label}</p>
        </div>
        <div className="card p-6 text-center text-gray-500 text-sm">No buyer activity in this period.</div>
      </>
    );
  }

  // Thread filters onto drill links.
  const qs = new URLSearchParams();
  qs.set("range", range.preset);
  if (range.preset === "custom") {
    if (sp.from) qs.set("from", sp.from);
    if (sp.to) qs.set("to", sp.to);
  }
  const query = `?${qs.toString()}`;
  const backQuery = sp.team ? `${query}&team=${sp.team}` : query;

  const cv = buyerConversionRate(m);
  const ct = buyerContactRate(m);
  const aa = avgAttempts(m);

  return (
    <>
      <div>
        <Link href={`/reports/buyer-performance${backQuery}`} className="text-xs text-gray-500 hover:underline">
          ← Back to buyer performance
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold">{m.agentName}</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          {m.team ?? "—"} · {agent.role} · {range.label}
          {!agent.active && <span className="ml-1 text-rose-600">(inactive)</span>}
        </p>
      </div>

      {/* Headline derived ratios */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 border-l-4 border-emerald-500">
          <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-bold">Conversion</div>
          <div className="text-2xl font-extrabold text-emerald-800 mt-1">{cv.toFixed(1)}%</div>
          <div className="text-[10px] text-gray-500">Converted ÷ assigned</div>
        </div>
        <div className="card p-4 border-l-4 border-sky-500">
          <div className="text-[10px] uppercase tracking-widest text-sky-700 font-bold">Contact rate</div>
          <div className="text-2xl font-extrabold text-sky-800 mt-1">{ct.toFixed(0)}%</div>
          <div className="text-[10px] text-gray-500">Contacted ÷ assigned</div>
        </div>
        <div className="card p-4 border-l-4 border-cyan-500">
          <div className="text-[10px] uppercase tracking-widest text-cyan-700 font-bold">Avg attempts</div>
          <div className="text-2xl font-extrabold text-cyan-800 mt-1">{aa.toFixed(1)}</div>
          <div className="text-[10px] text-gray-500">Per buyer worked</div>
        </div>
      </div>

      <Group title="Assignment (by stint history in period)">
        <Stat label="Buyer Records Assigned" value={m.buyersAssigned} agentId={agentId} metricKey="buyersAssigned" query={query} accent="text-blue-700" />
      </Group>

      <Group title="Outcomes (period)">
        <Stat label="Converted To Leads" value={m.converted} agentId={agentId} metricKey="converted" query={query} accent="text-emerald-700" />
        <Stat label="Rejected" value={m.rejected} agentId={agentId} metricKey="rejected" query={query} accent="text-rose-700" />
        <Stat label="Auto-Returned (5 attempts)" value={m.autoReturned} agentId={agentId} metricKey="autoReturned" query={query} accent="text-amber-700" />
        <Stat label="Manually Returned" value={m.manualReturned} agentId={agentId} metricKey="manualReturned" query={query} accent="text-amber-600" />
        <Stat label="Total Returned" value={totalReturned(m)} agentId={agentId} query={query} accent="text-amber-700" />
      </Group>

      <Group title="Contact Activity (period)">
        <Stat label="Calls Logged" value={m.callsLogged} agentId={agentId} metricKey="callsLogged" query={query} accent="text-violet-700" />
        <Stat label="WhatsApp Interactions" value={m.whatsappInteractions} agentId={agentId} metricKey="whatsappInteractions" query={query} />
        <Stat label="Notes Added" value={m.notesAdded} agentId={agentId} metricKey="notesAdded" query={query} />
        <Stat label="Voice Notes Added" value={m.voiceNotesAdded} agentId={agentId} metricKey="voiceNotesAdded" query={query} accent="text-gray-500" />
      </Group>

      <Group title="Attempt Metrics (period)">
        <Stat label="Total Attempts" value={m.totalAttempts} agentId={agentId} metricKey="totalAttempts" query={query} accent="text-cyan-700" />
        <Stat label="Avg Attempts / Buyer" value={aa.toFixed(2)} agentId={agentId} query={query} />
      </Group>

      <Group title="Conversion Funnel (period)">
        <Stat label="Assigned" value={m.funnelAssigned} agentId={agentId} metricKey="buyersAssigned" query={query} accent="text-indigo-700" />
        <Stat label="Contacted" value={m.funnelContacted} agentId={agentId} metricKey="funnelContacted" query={query} accent="text-sky-700" />
        <Stat label="Engaged" value={m.funnelEngaged} agentId={agentId} metricKey="funnelEngaged" query={query} accent="text-teal-700" />
        <Stat label="Converted" value={m.funnelConverted} agentId={agentId} metricKey="funnelConverted" query={query} accent="text-emerald-700" />
      </Group>

      <BuyerConversionFunnel stages={buyerAgentFunnel(m)} title="Conversion funnel" />
    </>
  );
}
