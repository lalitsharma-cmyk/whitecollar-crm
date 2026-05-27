// POST /api/test-push — fires a self-test Web Push to the current user so they
// can verify push delivery from the Settings page. Returns the active
// subscription count so the UI can tell users "you're not subscribed yet".
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

export async function POST() {
  const me = await requireUser();
  const subscriptions = await prisma.pushSubscription.count({ where: { userId: me.id } });
  const result = await sendPushToUser(me.id, {
    title: "🧪 Test notification",
    body: "If you see this, push is working!",
    url: "/dashboard",
    tag: "test-push",
  });
  return NextResponse.json({ ok: true, subscriptions, sent: result.sent, dead: result.dead });
}
