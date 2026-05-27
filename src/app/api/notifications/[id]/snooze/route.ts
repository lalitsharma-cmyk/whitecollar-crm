import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/**
 * POST /api/notifications/[id]/snooze
 *
 * Body: { hours: number }
 *
 * Hides this notification from the inbox until `now + hours`. Caps at 168h
 * (1 week) to prevent accidentally burying something forever. Only the
 * notification's owner can snooze it.
 *
 * The list endpoint filters out rows where `snoozedUntil > now`, so no cron
 * is needed — they reappear automatically once the timestamp passes.
 */
export const dynamic = "force-dynamic";

const MAX_HOURS = 168; // 1 week

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const hoursRaw = Number(body?.hours);
  if (!isFinite(hoursRaw) || hoursRaw <= 0) {
    return NextResponse.json({ error: "hours must be a positive number" }, { status: 400 });
  }
  const hours = Math.min(hoursRaw, MAX_HOURS);

  // Ownership check is enforced by including userId in the WHERE clause —
  // updateMany with the wrong userId silently affects 0 rows and we can
  // return 404 without leaking whether the notification exists.
  const result = await prisma.notification.updateMany({
    where: { id, userId: me.id },
    data: { snoozedUntil: new Date(Date.now() + hours * 3600_000) },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
