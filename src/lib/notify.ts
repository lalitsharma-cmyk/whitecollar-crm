import { prisma } from "@/lib/prisma";
import type { NotifKind, NotifSeverity, Role } from "@prisma/client";

interface NotifyInput {
  userId: string;
  kind: NotifKind;
  severity?: NotifSeverity;
  title: string;
  body?: string;
  linkUrl?: string;
  leadId?: string;
}

export async function notify(input: NotifyInput) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      severity: input.severity ?? "INFO",
      title: input.title,
      body: input.body,
      linkUrl: input.linkUrl,
      leadId: input.leadId,
    },
  });
}

// Notify every user with one of the given roles (e.g. all Admins)
export async function notifyRoles(roles: Role[], input: Omit<NotifyInput, "userId">) {
  const users = await prisma.user.findMany({ where: { role: { in: roles }, active: true } });
  await prisma.$transaction(
    users.map((u) => prisma.notification.create({
      data: { ...input, userId: u.id, severity: input.severity ?? "INFO" },
    })),
  );
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
