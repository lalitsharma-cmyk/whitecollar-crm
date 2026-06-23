import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { fmtIST12 } from "@/lib/datetime";
import { formatLeadName } from "@/lib/leadName";
import { fmtDuration, STATUS_LABEL } from "@/lib/agentStatus";
import type { AgentStatusKind } from "@prisma/client";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ICON: Record<AgentStatusKind, string> = {
  HERE: "📍",
  LEAVING_OFFICE: "🚪",
  GOING_MEETING: "🤝",
  RETURNED_MEETING: "↩️",
  GOING_SITE_VISIT: "🏗️",
  RETURNED_SITE_VISIT: "↩️",
};

// IST day window (UTC bounds) — today's movements only.
function istDayBoundsUTC(): { start: Date; end: Date } {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istMidnight = new Date(Date.now() + istOffsetMs);
  istMidnight.setUTCHours(0, 0, 0, 0);
  const start = new Date(istMidnight.getTime() - istOffsetMs);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function elapsedMinFrom(d: Date): number {
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60_000));
}

export default async function FieldStatusPage() {
  await requireRole("ADMIN", "MANAGER");
  const { start, end } = istDayBoundsUTC();

  const [openGoing, todayEvents] = await Promise.all([
    // Currently OUT — any GOING_* with no end yet.
    prisma.agentStatusEvent.findMany({
      where: { status: { in: ["GOING_MEETING", "GOING_SITE_VISIT"] }, endedAt: null },
      orderBy: { startedAt: "asc" },
      include: { user: { select: { name: true, team: true } } },
    }),
    // Today's movements (all kinds), newest first.
    prisma.agentStatusEvent.findMany({
      where: { startedAt: { gte: start, lt: end } },
      orderBy: { startedAt: "desc" },
      take: 300,
      include: { user: { select: { name: true, team: true } } },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold">📲 Field Status</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            Live agent movements — who is out, and today&apos;s check-ins, meetings &amp; site visits.
          </p>
        </div>
        <Link href="/admin/attendance" className="btn btn-ghost justify-center text-sm">📋 Attendance</Link>
      </div>

      {/* ── Currently OUT ── */}
      <div className="card p-4">
        <div className="text-xs font-bold tracking-widest text-gray-500 dark:text-slate-400 uppercase mb-2.5">
          🚶 Currently out · {openGoing.length}
        </div>
        {openGoing.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-slate-400">Everyone is in the office — no open meetings or site visits.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {openGoing.map((e) => (
              <div
                key={e.id}
                className={`rounded-xl border-l-4 p-3 ${e.status === "GOING_SITE_VISIT" ? "border-violet-500 bg-violet-50 dark:bg-violet-900/15" : "border-blue-500 bg-blue-50 dark:bg-blue-900/15"}`}
              >
                <div className="font-semibold text-sm text-[#0b1a33] dark:text-white">{formatLeadName(e.user.name)}</div>
                <div className="text-xs text-gray-600 dark:text-slate-300 mt-0.5">
                  {ICON[e.status]} {e.status === "GOING_SITE_VISIT" ? "On site visit" : "In meeting"}
                  {e.user.team && <span className="text-gray-400"> · {e.user.team}</span>}
                </div>
                <div className="text-xs font-bold text-amber-600 dark:text-amber-400 mt-1">
                  out for {fmtDuration(elapsedMinFrom(e.startedAt))} · since {fmtIST12(e.startedAt)} IST
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Today's movements ── */}
      <div className="card p-3 lg:p-5 overflow-x-auto">
        <div className="text-xs font-bold tracking-widest text-gray-500 dark:text-slate-400 uppercase mb-3">
          🕒 Today&apos;s movements · {todayEvents.length}
        </div>
        {todayEvents.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-slate-400">No field-status events logged today yet.</div>
        ) : (
          <table className="tbl w-full min-w-[560px]">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Team</th>
                <th>Status</th>
                <th className="text-right">Time (IST)</th>
                <th className="text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {todayEvents.map((e) => (
                <tr key={e.id}>
                  <td className="font-semibold">{formatLeadName(e.user.name)}</td>
                  <td className="text-gray-500">{e.user.team ?? "—"}</td>
                  <td>
                    <span className="inline-flex items-center gap-1">
                      {ICON[e.status]} {STATUS_LABEL[e.status]}
                      {e.status.startsWith("GOING_") && e.endedAt === null && (
                        <span className="chip chip-warm ml-1">out</span>
                      )}
                    </span>
                  </td>
                  <td className="text-right whitespace-nowrap text-gray-600 dark:text-slate-300">{fmtIST12(e.startedAt)}</td>
                  <td className="text-right whitespace-nowrap font-semibold text-amber-600 dark:text-amber-400">
                    {e.durationMin != null ? fmtDuration(e.durationMin) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
