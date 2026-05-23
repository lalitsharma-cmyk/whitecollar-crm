import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

// Browser → POST here after a successful PushManager.subscribe().
// We dedupe by endpoint (one entry per device).
export async function POST(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  const endpoint = String(body.endpoint ?? "");
  const p256dh = String(body.keys?.p256dh ?? "");
  const auth = String(body.keys?.auth ?? "");
  const userAgent = req.headers.get("user-agent") ?? undefined;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "Missing subscription fields" }, { status: 400 });
  }
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: me.id, endpoint, p256dh, authKey: auth, userAgent },
    update: { userId: me.id, p256dh, authKey: auth, userAgent },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const endpoint = String(body.endpoint ?? "");
  if (!endpoint) return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return NextResponse.json({ ok: true });
}
