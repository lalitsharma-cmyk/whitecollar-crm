import { prisma } from "@/lib/prisma";
import CallsClient, { type CallRowData } from "@/components/CallsClient";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  // Fetch the latest 50 calls AND for each call's lead, the lead's recent 5
  // calls (so the side panel can show running conversation history without
  // an extra round-trip). That's <300 rows total — fine on Postgres.
  const calls = await prisma.callLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: {
      user: { select: { name: true } },
      lead: {
        include: {
          owner: { select: { name: true } },
          callLogs: {
            orderBy: { startedAt: "desc" },
            take: 5,
            include: { user: { select: { name: true } } },
          },
        },
      },
    },
  });

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
      <CallsClient calls={rows} />
    </>
  );
}
