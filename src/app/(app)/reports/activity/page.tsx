import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import Link from "next/link";
import { formatLeadName } from "@/lib/leadName";

export const dynamic = "force-dynamic";

// IST midnight for today — all activity is relative to the start of the IST day
function getTodayIstMidnight(): Date {
  const nowMs = Date.now();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(nowMs + istOffsetMs);
  return new Date(
    Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate()) - istOffsetMs
  );
}

function fmtTime(d: Date): string {
  // Format as HH:MM in IST
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(d.getTime() + istOffsetMs);
  const h = String(istDate.getUTCHours()).padStart(2, "0");
  const m = String(istDate.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

type CallEntry = {
  kind: "call";
  time: Date;
  agentName: string;
  isHistorical: boolean; // true when user is null but attributedAgentName is set (MIS import)
  leadName: string | null;
  outcome: string;
  durationSec: number | null;
};

type AuditEntry = {
  kind: "audit";
  time: Date;
  agentName: string;
  leadId: string | null;
  action: string;
};

type FeedItem = CallEntry | AuditEntry;

export default async function ActivityFeedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireRole("ADMIN", "MANAGER");
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;
  const sp = await searchParams;

  // BUG-020: support ?date=YYYY-MM-DD to view a specific day's activity.
  // If absent, fall back to today (IST).
  const todayIstMidnight = getTodayIstMidnight();

  // Parse selected date from query param; fall back to today on invalid input.
  let selectedDayStart: Date;
  let currentDateISO: string;
  if (sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)) {
    // Parse as an IST midnight for the chosen date
    const [year, month, day] = sp.date.split("-").map(Number);
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    selectedDayStart = new Date(
      Date.UTC(year, month - 1, day) - istOffsetMs
    );
    currentDateISO = sp.date;
  } else {
    selectedDayStart = todayIstMidnight;
    // Format today as YYYY-MM-DD in IST for the date input default
    const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    currentDateISO = `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, "0")}-${String(istNow.getUTCDate()).padStart(2, "0")}`;
  }

  // The end of the selected day in IST = start of next day
  const selectedDayEnd = new Date(selectedDayStart.getTime() + 24 * 60 * 60 * 1000);

  const [callLogs, auditLogs] = await Promise.all([
    prisma.callLog.findMany({
      where: {
        startedAt: { gte: selectedDayStart, lt: selectedDayEnd },
        lead: { deletedAt: null },
        ...(managerTeam ? { user: { team: managerTeam } } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: 100,
      include: {
        user: { select: { name: true } },
        lead: { select: { id: true, name: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: {
        action: "lead.update",
        createdAt: { gte: selectedDayStart, lt: selectedDayEnd },
        ...(managerTeam ? { user: { team: managerTeam } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { name: true } } },
    }),
  ]);

  // Merge into a single typed feed
  const feed: FeedItem[] = [
    ...callLogs.map((c): CallEntry => ({
      kind: "call",
      time: c.startedAt,
      // isHistorical: attributedAgentName is set → entry was created by MIS import,
      // the real caller is not a registered user in the system
      isHistorical: c.attributedAgentName != null,
      agentName: c.attributedAgentName ?? c.user?.name ?? "Unknown Agent",
      leadName: c.lead?.name ? formatLeadName(c.lead.name) : null,
      outcome: c.outcome,
      durationSec: c.durationSec,
    })),
    ...auditLogs.map((a): AuditEntry => {
      // Try to parse leadId from meta JSON
      let leadId: string | null = a.entityId ?? null;
      if (!leadId && a.meta) {
        try {
          const parsed = JSON.parse(a.meta) as Record<string, unknown>;
          const id = parsed.leadId ?? parsed.id;
          if (typeof id === "string") leadId = id;
        } catch {
          // meta not valid JSON — leave leadId as entityId or null
        }
      }
      return {
        kind: "audit",
        time: a.createdAt,
        agentName: a.user?.name ?? "System",
        leadId,
        action: a.action,
      };
    }),
  ];

  // Sort chronologically, newest first
  feed.sort((a, b) => b.time.getTime() - a.time.getTime());

  // Group by agent name
  const byAgent = new Map<string, FeedItem[]>();
  for (const item of feed) {
    const name = item.agentName;
    if (!byAgent.has(name)) byAgent.set(name, []);
    byAgent.get(name)!.push(item);
  }

  // Sort agents by their most recent action desc
  const agentEntries = [...byAgent.entries()].sort(
    (a, b) => b[1][0].time.getTime() - a[1][0].time.getTime()
  );

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">📋 Activity Feed</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Calls and lead updates for {currentDateISO} (IST) — live
            {managerTeam ? ` · ${managerTeam} team` : " · all teams"}
          </p>
        </div>
        {me.isSuperAdmin && <a href="/api/call-logs/export" className="btn btn-ghost btn-sm">⬇️ Export CSV</a>}
      </div>

      {/* BUG-020: date selector — ?date=YYYY-MM-DD, defaults to today */}
      <form method="GET" className="flex items-center gap-2 mb-4">
        <label className="text-sm font-medium">Date:</label>
        <input
          type="date"
          name="date"
          defaultValue={currentDateISO}
          className="border rounded px-2 py-1 text-sm"
        />
        <button type="submit" className="btn btn-sm">View</button>
      </form>

      {feed.length === 0 ? (
        <div className="card p-5 text-center text-gray-500 text-sm">
          No activity logged for {currentDateISO} yet
        </div>
      ) : (
        <div className="space-y-4">
          {agentEntries.map(([agentName, items]) => {
            // Detect historical/imported agent: any call in this group that has no registered user
            const agentIsHistorical = items.some(
              (item) => item.kind === "call" && (item as CallEntry).isHistorical
            );
            return (
            <div key={agentName} className="card p-4">
              {/* Agent section header */}
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold uppercase">
                  {agentName.slice(0, 2)}
                </div>
                <div>
                  <span className="font-semibold text-sm">{agentName}</span>
                  {agentIsHistorical && (
                    <span className="ml-1.5 text-xs text-gray-400">(historical data)</span>
                  )}
                  <span className="ml-2 text-[11px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                    {items.length} action{items.length !== 1 ? "s" : ""} today
                  </span>
                </div>
              </div>

              {/* Items for this agent */}
              <ul className="space-y-1.5">
                {items.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-[11px] text-gray-400 font-mono w-11 shrink-0 mt-0.5">
                      {fmtTime(item.time)}
                    </span>
                    {item.kind === "call" ? (
                      <span className="text-gray-700">
                        <span className="mr-1">📞</span>
                        <span className="font-medium">{item.agentName}</span>
                        {" called "}
                        <span className="font-medium">{item.leadName ?? "unknown lead"}</span>
                        {" — "}
                        <span className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                          {item.outcome.replace(/_/g, " ")}
                        </span>
                        {item.durationSec != null && (
                          <span className="text-xs text-gray-500 ml-1">({item.durationSec}s)</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-700">
                        <span className="mr-1">✏️</span>
                        <span className="font-medium">{item.agentName}</span>
                        {" updated "}
                        {item.leadId ? (
                          <Link
                            href={`/leads/${item.leadId}`}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            lead
                          </Link>
                        ) : (
                          <span className="font-medium text-gray-500">lead</span>
                        )}
                        {" — "}
                        <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                          {item.action.replace(/\./g, " ")}
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
          })}
        </div>
      )}
    </>
  );
}
