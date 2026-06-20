"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { fmtIST } from "@/lib/datetime";

type NotifRow = {
  id: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

const sevDot: Record<string, string> = {
  INFO: "bg-blue-500",
  WARNING: "bg-amber-500",
  CRITICAL: "bg-red-500",
};

// Preset chips on the per-row Snooze dropdown. Each is converted to hours
// before being sent to the API (the route caps at 168h / 1 week).
const SNOOZE_PRESETS: { label: string; hours: number }[] = [
  { label: "1h", hours: 1 },
  { label: "4h", hours: 4 },
  { label: "Tomorrow", hours: 24 },
  { label: "3 days", hours: 72 },
];

export default function NotificationsClient({
  items,
  snoozedHiddenCount,
  earliestSnoozedUntil,
}: {
  items: NotifRow[];
  snoozedHiddenCount: number;
  earliestSnoozedUntil: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [openSnoozeId, setOpenSnoozeId] = useState<string | null>(null);

  const unreadCount = items.filter((n) => !n.readAt).length;

  async function markAllRead() {
    await fetch("/api/notifications/mark-all-read", { method: "POST" });
    startTransition(() => router.refresh());
  }

  async function snooze(id: string, hours: number) {
    setOpenSnoozeId(null);
    await fetch(`/api/notifications/${id}/snooze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours }),
    });
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 mt-2 mb-3">
        <p className="text-sm text-gray-500">All your CRM alerts in one place.</p>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded-md bg-[#0b1a33] text-white hover:bg-[#1a2a4a] disabled:opacity-50"
          >
            ✓ Mark all read{unreadCount > 1 ? ` (${unreadCount})` : ""}
          </button>
        )}
      </div>

      <div className="card divide-y divide-[#f1f2f6]">
        {items.length === 0 && (
          <div className="p-12 text-center text-gray-500">
            {snoozedHiddenCount > 0 ? "No active notifications — all snoozed." : "No notifications yet."}
          </div>
        )}
        {items.map((n) => {
          const isUnread = !n.readAt;
          return (
            <div key={n.id} className="block p-4 hover:bg-gray-50 relative">
              <div className="flex items-start gap-3">
                <span
                  className={`mt-1.5 w-2.5 h-2.5 rounded-full ${sevDot[n.severity] ?? "bg-gray-400"} flex-none`}
                ></span>
                <Link href={n.linkUrl ?? "#"} className="flex-1 min-w-0">
                  <div className={`text-sm text-[#0b1a33] ${isUnread ? "font-semibold" : "font-normal"}`}>
                    {n.title}
                  </div>
                  {n.body && <div className="text-sm text-gray-600 mt-0.5">{n.body}</div>}
                  <div className="text-xs text-gray-400 mt-1">
                    {n.kind} · {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </div>
                </Link>
                {isUnread && (
                  <div className="flex-none relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setOpenSnoozeId(openSnoozeId === n.id ? null : n.id);
                      }}
                      className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-100"
                    >
                      ⏸ Snooze
                    </button>
                    {openSnoozeId === n.id && (
                      <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[120px]">
                        {SNOOZE_PRESETS.map((p) => (
                          <button
                            key={p.label}
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              snooze(n.id, p.hours);
                            }}
                            disabled={pending}
                            className="block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {snoozedHiddenCount > 0 && (
        <div className="mt-3 text-xs text-gray-400 text-center">
          snoozed {snoozedHiddenCount} hidden
          {earliestSnoozedUntil && (
            <> until {fmtIST(earliestSnoozedUntil)}</>
          )}
        </div>
      )}
    </>
  );
}
