import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import Link from "next/link";

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

export default async function ActivityFeedPage() {
  const me = await requireRole("ADMIN", "MANAGER");
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;

  const todayIstMidnight = getTodayIstMidnight();

  const [callLogs, auditLogs] = await Promise.all([
    prisma.callLog.findMany({
      where: {
        startedAt: { gte: todayIstMidnight },
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
        createdAt: { gte: todayIstMidnight },
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
      agentName: c.attributedAgentName ?? c.user.name,
      leadName: c.lead?.name ?? null,
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
          <h1 className="text-xl sm:text-2xl font-bold">📋 Today&apos;s Activity Feed</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Calls and lead updates logged today (IST) — live
            {managerTeam ? ` · ${managerTeam} team` : " · all teams"}
          </p>
        </div>
        <a href="/api/call-logs/export" className="btn btn-ghost btn-sm">⬇️ Export CSV</a>
      </div>

      {feed.length === 0 ? (
        <div className="card p-6 text-center text-gray-500 text-sm">
          No activity logged today yet
        </div>
      ) : (
        <div className="space-y-4">
          {agentEntries.map(([agentName, items]) => (
            <div key={agentName} className="card p-4">
              {/* Agent section header */}
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold uppercase">
                  {agentName.slice(0, 2)}
                </div>
                <div>
                  <span className="font-semibold text-sm">{agentName}</span>
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
          ))}
        </div>
      )}
    </>
  );
}
