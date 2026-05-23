import webpush from "web-push";
import { prisma } from "@/lib/prisma";

// FREE web push using browser-native APIs (Apple/Google push servers).
// VAPID keys generated once with `npx web-push generate-vapid-keys`.

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:lalit@whitecollarrealty.com";
  if (!pub || !priv) return; // not configured yet — push silently no-ops
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

export function pushEnabled(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;        // dedupes notifications for the same lead
  severity?: "INFO" | "WARNING" | "CRITICAL";
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!pushEnabled()) return { sent: 0, dead: 0 };
  configure();
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return { sent: 0, dead: 0 };

  const body = JSON.stringify(payload);
  let sent = 0, dead = 0;
  const deadIds: string[] = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.authKey } }, body);
      sent++;
    } catch (e) {
      const err = e as { statusCode?: number };
      if (err.statusCode === 410 || err.statusCode === 404) {
        deadIds.push(s.id);
        dead++;
      }
    }
  }
  if (deadIds.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: deadIds } } });
  return { sent, dead };
}
