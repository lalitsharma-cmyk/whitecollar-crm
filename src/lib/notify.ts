import { prisma } from "@/lib/prisma";
import type { NotifKind, NotifSeverity, Role } from "@prisma/client";
import { sendPushToUser } from "@/lib/push";
import { sendEmail, emailTemplate, emailEnabled } from "@/lib/email";

interface NotifyInput {
  userId: string;
  kind: NotifKind;
  severity?: NotifSeverity;
  title: string;
  body?: string;
  linkUrl?: string;
  leadId?: string;
  // If true, also send email (when configured). Defaults to true for WARNING / CRITICAL.
  email?: boolean;
}

const BASE = process.env.NEXTAUTH_URL ?? "https://crm.whitecollarrealty.com";

export async function notify(input: NotifyInput) {
  const severity = input.severity ?? "INFO";

  // 1. In-app notification (always)
  const notif = await prisma.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      severity,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
      leadId: input.leadId,
    },
  });

  // 2. Web Push (best-effort, never throws)
  sendPushToUser(input.userId, {
    title: input.title,
    body: input.body,
    url: input.linkUrl ? `${BASE}${input.linkUrl}` : undefined,
    tag: input.leadId ?? input.kind,
    severity,
  }).catch(() => {});

  // 3. Email — only for important events, or when explicitly requested
  const shouldEmail = input.email ?? (severity === "WARNING" || severity === "CRITICAL");
  if (shouldEmail && emailEnabled()) {
    prisma.user.findUnique({ where: { id: input.userId } }).then((u) => {
      if (!u?.email) return;
      const html = emailTemplate({
        title: input.title,
        body: input.body ?? "Open the CRM for details.",
        ctaUrl: input.linkUrl ? `${BASE}${input.linkUrl}` : `${BASE}/dashboard`,
        ctaLabel: input.linkUrl ? "Open in CRM" : "Open dashboard",
      });
      sendEmail({ to: u.email, subject: `[WCR CRM] ${input.title}`, html }).catch(() => {});
    }).catch(() => {});
  }

  return notif;
}

// Notify every user with one of the given roles (e.g. all Admins)
export async function notifyRoles(roles: Role[], input: Omit<NotifyInput, "userId">) {
  const users = await prisma.user.findMany({ where: { role: { in: roles }, active: true } });
  for (const u of users) {
    await notify({ ...input, userId: u.id });
  }
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
