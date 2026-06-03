import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";

// CSV export for call logs — role-scoped:
//   AGENT   → only their own logs
//   MANAGER → their team's agents' logs
//   ADMIN   → all logs; optional userId filter

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 330 minutes

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // RFC 4180: wrap in double-quotes if value contains comma, quote, CR or LF.
  // Escape embedded double-quotes by doubling them.
  return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toIstDate(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const mo = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function toIstTime(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const h = String(ist.getUTCHours()).padStart(2, "0");
  const m = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const userIdParam = url.searchParams.get("userId") ?? undefined;

  // Default date range: last 30 days
  const toDate = toParam ? new Date(toParam) : new Date();
  const fromDate = fromParam
    ? new Date(fromParam)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Ensure toDate covers the full end day (set to end-of-day if a bare date was provided)
  if (toParam && !toParam.includes("T")) {
    toDate.setUTCHours(23, 59, 59, 999);
  }

  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team ?? "") : null;

  const logs = await prisma.callLog.findMany({
    where: {
      startedAt: { gte: fromDate, lte: toDate },
      // ADMIN: optional userId filter
      ...(userIdParam && me.role === "ADMIN" ? { userId: userIdParam } : {}),
      // AGENT: own logs only
      ...(me.role === "AGENT" ? { userId: me.id } : {}),
      // MANAGER: their team's logs only
      ...(me.role === "MANAGER" && managerTeam ? { user: { team: managerTeam } } : {}),
    },
    orderBy: { startedAt: "desc" },
    take: 10000,
    include: {
      user: { select: { name: true } },
      lead: { select: { name: true, phone: true } },
    },
  });

  const HEADER = "Date,Time,Agent,Lead Name,Phone,Outcome,Duration (sec),Notes";

  const rows = logs.map((log) => {
    const agentName = log.attributedAgentName ?? log.user.name;
    return [
      toIstDate(log.startedAt),
      toIstTime(log.startedAt),
      agentName,
      log.lead?.name ?? "",
      log.lead?.phone ?? "",
      log.outcome,
      log.durationSec != null ? String(log.durationSec) : "",
      log.notes ?? "",
    ]
      .map(csvEscape)
      .join(",");
  });

  const csvString = [HEADER, ...rows].join("\r\n");

  return new Response(csvString, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="call-logs.csv"',
    },
  });
}
