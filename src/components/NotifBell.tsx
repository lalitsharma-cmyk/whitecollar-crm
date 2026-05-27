"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Volume2, VolumeX } from "lucide-react";
import { playNotifSound, isNotifSoundEnabled, setNotifSoundEnabled, type NotifSeverity } from "@/lib/notifSounds";

type Notif = {
  id: string;
  kind: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body?: string;
  linkUrl?: string;
  readAt: string | null;
  createdAt: string;
};

const sevColor: Record<string, string> = {
  INFO:     "border-l-[#3b82f6]",
  WARNING:  "border-l-[#f59e0b]",
  CRITICAL: "border-l-[#ef4444]",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotifBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  // Track which notification IDs we've already "seen" so new arrivals play
  // a sound but old ones don't re-ring every 30s poll. Initial load (page
  // mount) seeds the set without playing — we only ring for things that
  // arrive AFTER the agent is already at their desk.
  const seenIds = useRef<Set<string> | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => { setSoundOn(isNotifSoundEnabled()); }, []);

  async function load() {
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      const incoming: Notif[] = j.items ?? [];

      // First poll: seed the seen-set, no sound. Subsequent polls: ring for
      // unread items we haven't seen before. Group sounds by highest severity
      // in the batch so we don't triple-ring when 3 lands at once.
      if (seenIds.current == null) {
        seenIds.current = new Set(incoming.map((n) => n.id));
      } else {
        const newUnread = incoming.filter((n) => !n.readAt && !seenIds.current!.has(n.id));
        if (newUnread.length > 0) {
          const order: Record<string, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
          const top = newUnread.reduce<NotifSeverity>((a, n) => (order[n.severity] > order[a] ? n.severity : a), "INFO");
          playNotifSound(top);
        }
        for (const n of incoming) seenIds.current.add(n.id);
      }

      setItems(incoming);
      setUnread(j.unread ?? 0);
    } catch {}
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000); // poll every 30s
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    setNotifSoundEnabled(next);
    if (next) {
      // Demo ping so the user can confirm what they just enabled — also
      // satisfies the "needs user gesture to start AudioContext" rule on
      // some browsers (the toggle click IS the user gesture).
      playNotifSound("INFO");
    }
  }

  async function markAllRead() {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mark_all_read" }) });
    setUnread(0);
    setItems((arr) => arr.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative p-1">
        <Bell className="w-[20px] h-[20px] text-gray-500" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-2 bg-[#ef4444] text-white text-[10px] font-bold rounded-full px-1.5">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          {/* On mobile: full-viewport panel anchored to header. On desktop: classic 384px dropdown. */}
          <div className="fixed sm:absolute left-2 right-2 sm:left-auto sm:right-0 top-14 sm:top-auto sm:mt-2 sm:w-96 max-h-[70vh] overflow-y-auto bg-white border border-[#e5e7eb] rounded-xl shadow-2xl z-40">
            <div className="flex items-center justify-between p-3 border-b border-[#e5e7eb]">
              <div className="font-semibold text-sm">Notifications</div>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleSound}
                  className="text-xs text-gray-500 hover:text-[#0b1a33] inline-flex items-center gap-1"
                  title={soundOn ? "Sound on — click to mute" : "Sound muted — click to enable"}
                  aria-label={soundOn ? "Mute notification sound" : "Enable notification sound"}
                >
                  {soundOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-gray-400" />}
                </button>
                {unread > 0 && <button onClick={markAllRead} className="text-xs text-[#0b1a33] font-semibold">Mark all read</button>}
                <Link href="/notifications" onClick={() => setOpen(false)} className="text-xs text-[#0b1a33] font-semibold">View all</Link>
              </div>
            </div>
            {items.length === 0 && <div className="p-6 text-sm text-gray-500 text-center">All caught up 🎉</div>}
            {items.slice(0, 10).map((n) => (
              <Link key={n.id} href={n.linkUrl ?? "#"} onClick={() => setOpen(false)}
                className={`block px-3 py-3 border-b border-[#f1f2f6] border-l-4 ${sevColor[n.severity]} ${n.readAt ? "bg-white" : "bg-blue-50/40"}`}>
                <div className="text-sm font-semibold text-[#0b1a33]">{n.title}</div>
                {n.body && <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{n.body}</div>}
                <div className="text-[10px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
