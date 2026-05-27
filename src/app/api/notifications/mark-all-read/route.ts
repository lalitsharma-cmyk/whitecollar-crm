import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/**
 * POST /api/notifications/mark-all-read
 *
 * Marks every unread notification for the caller as read. Returns the count
 * actually updated so the UI can show "marked N read" feedback if desired.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const me = await requireUser();
  const result = await prisma.notification.updateMany({
    where: { userId: me.id, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true, count: result.count });
}
