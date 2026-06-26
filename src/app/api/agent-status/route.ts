// Agent field-movement status endpoint.
//   POST  → log the CALLER's own status (one of the 6 kinds). Auth-gated to any
//           active user (agent/manager/admin log their OWN movements). For
//           "Returned" taps the matching open "Going" is closed + duration
//           computed. Manager (Lalit) is notified. HERE also marks the existing
//           Attendance self-check-in (no duplicate "I'm here" path) and is
//           IDEMPOTENT PER IST DAY — a 2nd HERE is a no-op (first event echoed
//           back, nothing written, manager not re-notified; `duplicate:true`).
//   GET   → the caller's today's events + current open-going state (widget refresh).
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AttendanceStatus } from "@prisma/client";
import {
  logAgentStatus,
  isAgentStatusKind,
  todaysEvents,
  openGoingEvent,
  todaysHereEvent,
} from "@/lib/agentStatus";
import { autoMarkAttendanceOnLogin, todayIST, hourIST, minIST } from "@/lib/attendance";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Mark the existing daily Attendance self-check-in for this user — the SAME
 * effect as the "I'm here" card / /api/attendance/mark. Reused here so the
 * field-status "I Am Here" button drives the one canonical attendance feature
 * (round-robin presence, dashboard card auto-hide) instead of a parallel one.
 */
async function markAttendanceSelfCheckin(userId: string, ip: string | null, device: string | null) {
  const day = todayIST();
  const now = new Date();
  let row = await prisma.attendance.findUnique({ where: { userId_date: { userId, date: day } } });
  if (!row) {
    await autoMarkAttendanceOnLogin(userId);
    row = await prisma.attendance.findUnique({ where: { userId_date: { userId, date: day } } });
  }
  if (!row) return;
  // An "I'm here" tap on an ABSENT/ON_LEAVE day flips to PRESENT (or LATE post-10:30).
  let status = row.status;
  if (row.status === AttendanceStatus.ABSENT || row.status === AttendanceStatus.ON_LEAVE) {
    const minutes = hourIST() * 60 + minIST();
    status = minutes <= 10 * 60 + 30 ? AttendanceStatus.PRESENT : AttendanceStatus.LATE;
  }
  await prisma.attendance.update({
    where: { userId_date: { userId, date: day } },
    data: {
      status,
      markedAt: status !== row.status ? now : row.markedAt,
      // First tap of the day wins for the timestamp/device/IP.
      selfCheckedInAt: row.selfCheckedInAt ?? now,
      checkInIp: row.checkInIp ?? ip,
      checkInDevice: row.checkInDevice ?? device,
    },
  });
}

export async function POST(req: NextRequest) {
  const me = await requireUser();

  let statusRaw: unknown;
  let note: string | null = null;
  try {
    const body = await req.json();
    if (body && typeof body === "object") {
      statusRaw = (body as Record<string, unknown>).status;
      const n = (body as Record<string, unknown>).note;
      if (typeof n === "string") note = n;
    }
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!isAgentStatusKind(statusRaw)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // Check-in-before-check-out (Lalit 2026-06-27): a user cannot mark "Leaving for
  // the Day" (LEAVING_OFFICE) unless they have already checked in (HERE) today.
  if (statusRaw === "LEAVING_OFFICE" && !(await todaysHereEvent(me.id))) {
    return NextResponse.json({ error: "You haven't checked in today." }, { status: 400 });
  }

  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || null;
  const device = req.headers.get("user-agent") ?? null;

  const result = await logAgentStatus(
    { id: me.id, name: me.name },
    statusRaw,
    note,
    statusRaw === "HERE" ? () => markAttendanceSelfCheckin(me.id, ip, device) : undefined,
  );

  // Echo back the fresh today-list so the widget can re-render without a 2nd call.
  const events = await todaysEvents(me.id);
  return NextResponse.json({
    ok: true,
    event: serialize(result.event),
    durationMin: result.durationMin,
    pairedClosed: result.pairedClosed,
    // True when this was a 2nd HERE for the day — no row written, first kept.
    duplicate: result.duplicate ?? false,
    openGoing: result.openGoing ? serialize(result.openGoing) : null,
    events: events.map(serialize),
  });
}

export async function GET() {
  const me = await requireUser();
  const [events, open] = await Promise.all([todaysEvents(me.id), openGoingEvent(me.id)]);
  return NextResponse.json({
    ok: true,
    openGoing: open
      ? serialize({
          id: open.id,
          status: open.status,
          startedAt: open.startedAt,
          endedAt: open.endedAt,
          durationMin: open.durationMin,
          pairedEventId: open.pairedEventId,
        })
      : null,
    events: events.map(serialize),
  });
}

// ISO-string the dates for JSON transport.
function serialize(e: {
  id: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  durationMin: number | null;
  pairedEventId: string | null;
}) {
  return {
    id: e.id,
    status: e.status,
    startedAt: e.startedAt.toISOString(),
    endedAt: e.endedAt ? e.endedAt.toISOString() : null,
    durationMin: e.durationMin,
    pairedEventId: e.pairedEventId,
  };
}
