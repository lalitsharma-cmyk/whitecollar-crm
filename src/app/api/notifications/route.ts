import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await requireUser();
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({ where: { userId: me.id, readAt: null } }),
  ]);
  return NextResponse.json({ items, unread });
}

export async function POST(req: Request) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  if (body.action === "mark_all_read") {
    await prisma.notification.updateMany({
      where: { userId: me.id, readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "mark_read" && typeof body.id === "string") {
    await prisma.notification.updateMany({
      where: { id: body.id, userId: me.id },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
