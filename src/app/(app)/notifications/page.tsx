import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import NotificationsClient from "./NotificationsClient";
import NotificationSettingsCard from "@/components/NotificationSettingsCard";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const me = await requireUser();
  const now = new Date();

  // Fetch active (non-snoozed) rows and a count of currently-snoozed ones so
  // the UI can show a "N hidden" footer. We deliberately do NOT auto-mark
  // everything read on visit anymore — the new "Mark all read" button gives
  // the user explicit control (and unread styling stays meaningful).
  const [items, snoozedRows] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId: me.id,
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.notification.findMany({
      where: { userId: me.id, snoozedUntil: { gt: now } },
      orderBy: { snoozedUntil: "asc" },
      select: { snoozedUntil: true },
    }),
  ]);

  // Resolve "Created By" names for source tracking — batch-fetch the distinct
  // actor ids so each notification can show who/what fired it (or "System").
  const creatorIds = Array.from(new Set(items.map((n) => n.createdById).filter((x): x is string => !!x)));
  const creators = creatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })
    : [];
  const creatorName = new Map(creators.map((u) => [u.id, u.name]));

  const serialized = items.map((n) => ({
    id: n.id,
    kind: n.kind,
    severity: n.severity,
    title: n.title,
    body: n.body,
    linkUrl: n.linkUrl,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
    // Source tracking — every notification traces to a real record.
    sourceType: n.sourceType,
    sourceId: n.sourceId,
    createdBy: n.createdById ? (creatorName.get(n.createdById) ?? "Unknown") : "System",
  }));

  const earliestSnoozed = snoozedRows[0]?.snoozedUntil ?? null;

  return (
    <>
      <h1 className="text-2xl font-bold">Notifications</h1>
      <NotificationSettingsCard />
      <NotificationsClient
        items={serialized}
        snoozedHiddenCount={snoozedRows.length}
        earliestSnoozedUntil={earliestSnoozed ? earliestSnoozed.toISOString() : null}
      />
    </>
  );
}
