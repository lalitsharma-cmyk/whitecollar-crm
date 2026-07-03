import { prisma } from "@/lib/prisma";
import type { NotifKind, NotifSeverity, Role } from "@prisma/client";
import { sendPushToUser } from "@/lib/push";
import { sendEmail, emailTemplate, emailEnabled } from "@/lib/email";
import type { NotifSource } from "@/lib/notifSource";

interface NotifyInput {
  userId: string;
  kind: NotifKind;
  severity?: NotifSeverity;
  title: string;
  body?: string;
  linkUrl?: string;
  leadId?: string;
  // REQUIRED source tracking (Lalit, 2026-07-03): every notification must trace to a
  // real CRM record. Mandatory ⇒ a source-less notification cannot be created — the
  // compiler enforces it at all call sites. See src/lib/notifSource.ts.
  source: NotifSource;
  // If true, also send email (when configured). Defaults to true for WARNING / CRITICAL.
  email?: boolean;
}

const BASE = process.env.NEXTAUTH_URL ?? "https://crm.whitecollarrealty.com";

// Map the in-app NotifKind enum → the notification-preference key used by the
// per-user mute toggles on Settings (§ wave 15). Kinds with no mapping are
// always delivered (operational alerts the user shouldn't be able to silence,
// e.g. AUTO_ASSIGN_FIRED). LEAD_ASSIGNED rides the "hot_lead" toggle since
// both are "a new lead needs you now" alerts.
const KIND_TO_PREF: Partial<Record<NotifKind, string>> = {
  LEAD_ASSIGNED: "hot_lead",
  CALL_SLA_BREACH: "sla",
  REMINDER: "followup",
};

export async function notify(input: NotifyInput) {
  const severity = input.severity ?? "INFO";

  // 1. In-app notification (always). Source is stored so every row is auditable +
  //    the UI can render a Source chip + "Open Source" jump to the backing record.
  const notif = await prisma.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      severity,
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
      leadId: input.leadId,
      sourceType: input.source.type,
      sourceId: input.source.id ?? null,
      createdById: input.source.createdById ?? null,
    },
  });

  // 2. Web Push (best-effort, never throws). Tag with the matching pref key
  //    so a muted type is suppressed at the push layer — the in-app row above
  //    is still created (the bell stays truthful; only the push is silenced).
  sendPushToUser(input.userId, {
    title: input.title,
    body: input.body,
    url: input.linkUrl ? `${BASE}${input.linkUrl}` : undefined,
    tag: input.leadId ?? input.kind,
    severity,
    prefKey: KIND_TO_PREF[input.kind],
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
