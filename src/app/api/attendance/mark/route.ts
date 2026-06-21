// Agent "I am here" self-check-in. Distinct from the login auto-mark: this is the
// explicit tap on the dashboard card. It ensures today's attendance row exists,
// records the self-check-in time + device/IP (kept from the FIRST tap of the
// day), and — with { force:true } — overrides an ABSENT/ON_LEAVE row to PRESENT.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { autoMarkAttendanceOnLogin, todayIST, hourIST, minIST } from "@/lib/attendance";
import { prisma } from "@/lib/prisma";
import { AttendanceStatus } from "@prisma/client";

export async function POST(req: NextRequest) {
  const me = await requireUser();

  let force = false;
  let selfCheckin = false;            // true ONLY for the explicit "I'm here" tap
  try {
    const body = await req.json();
    if (body && typeof body === "object") {
      if (body.force === true) force = true;
      if (body.selfCheckin === true) selfCheckin = true;
    }
  } catch { /* no body (passive AttendancePing) — auto-mark only, never stamp self-checkin */ }

  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim() || null;
  const device = req.headers.get("user-agent") ?? null;
  const day = todayIST();
  const now = new Date();

  // Ensure today's row exists (login auto-mark may not have fired if the agent
  // stayed logged in from yesterday).
  let row = await prisma.attendance.findUnique({ where: { userId_date: { userId: me.id, date: day } } });
  if (!row) {
    await autoMarkAttendanceOnLogin(me.id);
    row = await prisma.attendance.findUnique({ where: { userId_date: { userId: me.id, date: day } } });
  }
  if (!row) return NextResponse.json({ ok: true }); // shouldn't happen

  // Force override: a self-check-in on an ABSENT / ON_LEAVE day flips to PRESENT
  // (or LATE after 10:30 IST) — "Tap to override if you're actually here".
  let status = row.status;
  if (force && (row.status === AttendanceStatus.ABSENT || row.status === AttendanceStatus.ON_LEAVE)) {
    const minutes = hourIST() * 60 + minIST();
    status = minutes <= 10 * 60 + 30 ? AttendanceStatus.PRESENT : AttendanceStatus.LATE;
  }

  // Record the explicit self-check-in. Idempotent: the FIRST tap of the day wins
  // for the time/device/IP, so refresh/re-login never overwrites the real moment.
  await prisma.attendance.update({
    where: { userId_date: { userId: me.id, date: day } },
    data: {
      status,
      markedAt: status !== row.status ? now : row.markedAt,
      // Only the explicit "I'm here" tap (or a force override) stamps the
      // self-check-in. The passive AttendancePing must NOT — otherwise it
      // pre-stamps on page load and the "I'm here" card never appears.
      ...(selfCheckin || force
        ? {
            selfCheckedInAt: row.selfCheckedInAt ?? now,
            checkInIp: row.checkInIp ?? ip,
            checkInDevice: row.checkInDevice ?? device,
          }
        : {}),
    },
  });
  return NextResponse.json({ ok: true, checkedInAt: (row.selfCheckedInAt ?? now).toISOString() });
}
