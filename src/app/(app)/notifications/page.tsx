import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

export const dynamic = "force-dynamic";

const sevDot: Record<string, string> = { INFO: "bg-blue-500", WARNING: "bg-amber-500", CRITICAL: "bg-red-500" };

export default async function NotificationsPage() {
  const me = await requireUser();
  const items = await prisma.notification.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  await prisma.notification.updateMany({ where: { userId: me.id, readAt: null }, data: { readAt: new Date() } });

  return (
    <>
      <h1 className="text-2xl font-bold">Notifications</h1>
      <p className="text-sm text-gray-500">All your CRM alerts in one place. Auto-marked read on visit.</p>
      <div className="card divide-y divide-[#f1f2f6]">
        {items.length === 0 && <div className="p-12 text-center text-gray-500">No notifications yet.</div>}
        {items.map((n) => (
          <Link key={n.id} href={n.linkUrl ?? "#"} className="block p-4 hover:bg-gray-50">
            <div className="flex items-start gap-3">
              <span className={`mt-1.5 w-2.5 h-2.5 rounded-full ${sevDot[n.severity]} flex-none`}></span>
              <div className="flex-1">
                <div className="font-semibold text-sm text-[#0b1a33]">{n.title}</div>
                {n.body && <div className="text-sm text-gray-600 mt-0.5">{n.body}</div>}
                <div className="text-xs text-gray-400 mt-1">{n.kind} · {formatDistanceToNow(n.createdAt, { addSuffix: true })}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
