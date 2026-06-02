// Agent self-marks attendance for today. Used when auto-mark on login didn't
// fire (rare — e.g. agent stayed logged in from yesterday).
//
// Round-5 extension (Agent T, Lalit's "I am here" widget):
//   • Accepts optional JSON body { force?: boolean }. When force === true and
//     today's row is ABSENT or ON_LEAVE, we overwrite to PRESENT (with the
//     correct time-based status — PRESENT before 10:30 IST, LATE after).
//     This powers the "Tap to override if you're actually here" affordance.
//   • Default (no body / force=false) keeps the original idempotent behaviour:
//     no-op if the day already has a row.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  autoMarkAttendanceOnLogin,
  todayIST,
  hourIST,
  minIST,
} from "@/lib/attendance";
import { prisma } from "@/lib/prisma";
import { AttendanceStatus } from "@prisma/client";

export async function POST(req: NextRequest) {
  const me = await requireUser();

  // Read optional body. fetch() with no body sends Content-Length:0 — guard
  // against the resulting JSON parse error.
  let force = false;
  try {
    const body = await req.json();
    if (body && typeof body === "object" && body.force === true) force = true;
  } catch {
    /* no body — fine */
  }

  if (!force) {
    await autoMarkAttendanceOnLogin(me.id);
    return NextResponse.json({ ok: true });
  }

  // Force path — overwrite ABSENT / ON_LEAVE to PRESENT-or-LATE based on
  // current IST time. Leaves an existing PRESENT/LATE alone (no-op).
  const day = todayIST();
  const existing = await prisma.attendance.findUnique({
    where: { userId_date: { userId: me.id, date: day } },
  });

  if (!existing) {
    // No row yet — fall back to the standard auto-mark.
    await autoMarkAttendanceOnLogin(me.id);
    return NextResponse.json({ ok: true });
  }

  if (
    existing.status === AttendanceStatus.PRESENT ||
    existing.status === AttendanceStatus.LATE
  ) {
    // Already here — nothing to do.
    return NextResponse.json({ ok: true, alreadyHere: true });
  }

  const minutesSinceMidnight = hourIST() * 60 + minIST();
  const cutoffPresentMin = 10 * 60 + 30; // 10:30am IST
  const status: AttendanceStatus =
    minutesSinceMidnight <= cutoffPresentMin
      ? AttendanceStatus.PRESENT
      : AttendanceStatus.LATE;

  await prisma.attendance.update({
    where: { userId_date: { userId: me.id, date: day } },
    data: { status, markedAt: new Date(), markedBy: null },
  });
  return NextResponse.json({ ok: true, overridden: true });
}
