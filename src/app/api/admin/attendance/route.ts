// Admin override of a single attendance cell.
// POST { userId, date "YYYY-MM-DD", status: enum | null }
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { AttendanceStatus } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  const dateStr = String(body.date ?? "");
  const statusRaw = body.status as string | null | undefined;

  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: "userId + date YYYY-MM-DD required" }, { status: 400 });
  }
  const date = new Date(dateStr + "T00:00:00.000Z");

  // null = delete the row
  if (statusRaw == null || statusRaw === "") {
    await prisma.attendance.deleteMany({ where: { userId, date } });
    await audit({ userId: me.id, action: "attendance.clear", entity: "User", entityId: userId, meta: { date: dateStr }, request: reqMeta(req) });
    return NextResponse.json({ ok: true });
  }
  if (!(Object.values(AttendanceStatus) as string[]).includes(statusRaw)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const status = statusRaw as AttendanceStatus;

  await prisma.attendance.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, status, markedBy: me.id },
    update: { status, markedBy: me.id },
  });
  await audit({ userId: me.id, action: "attendance.override", entity: "User", entityId: userId, meta: { date: dateStr, status }, request: reqMeta(req) });
  return NextResponse.json({ ok: true });
}
