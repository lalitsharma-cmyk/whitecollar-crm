import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToUser, pushEnabled } from "@/lib/push";

// "Send Test Notification" — fires a real Web Push to every device this user has
// subscribed, so they can verify delivery (tab closed / phone locked / another
// app open). The client ALSO plays the chosen in-app sound locally for the
// open-tab case. Returns how many devices it reached so the UI can be honest.
export async function POST() {
  const me = await requireUser();
  const deviceCount = await prisma.pushSubscription.count({ where: { userId: me.id } });

  if (!pushEnabled()) {
    return NextResponse.json({ ok: false, reason: "push-not-configured", devices: deviceCount });
  }
  if (deviceCount === 0) {
    // No subscription on file → the OS push can't fire. The client still plays
    // the in-app sound; tell the user to press "Enable notifications" first.
    return NextResponse.json({ ok: true, devices: 0, reason: "no-subscription" });
  }

  const res = await sendPushToUser(me.id, {
    title: "🔔 Test notification",
    body: "If you can see + hear this, lead alerts are working on this device.",
    url: "/notifications",
    tag: "wcr-test",
    severity: "CRITICAL",
    // No prefKey → never suppressed by a per-type mute (this is an explicit test).
  });
  return NextResponse.json({ ok: true, devices: deviceCount, sent: res.sent, dead: res.dead });
}
