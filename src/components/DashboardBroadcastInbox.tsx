"use client";
// DashboardBroadcastInbox — Feature 1 RECIPIENT view. Every user sees the voice
// broadcasts targeted to them (Everyone / their Team / them) and plays them here.
// Marks "heard" on first play (clears the NEW badge). Separate from lead voice.
import { useState } from "react";
import { Megaphone } from "lucide-react";

export interface BroadcastItem {
  id: string;
  by: string;
  at: string;          // ISO
  audience: string;    // "Everyone" | "Dubai team" | "You" …
  title: string | null;
  transcript: string | null;
  durationSec: number | null;
  heard: boolean;
}

const fmtIST = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) + " IST";
const fmtDur = (s: number | null) => { if (!s || s <= 0) return ""; const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; };

export default function DashboardBroadcastInbox({ items }: { items: BroadcastItem[] }) {
  const [heard, setHeard] = useState<Set<string>>(new Set(items.filter((i) => i.heard).map((i) => i.id)));
  if (items.length === 0) return null;

  function markHeard(id: string) {
    if (heard.has(id)) return;
    setHeard((prev) => new Set(prev).add(id));
    fetch(`/api/voice-broadcast/${id}/heard`, { method: "POST", keepalive: true }).catch(() => {});
  }

  const unheard = items.filter((i) => !heard.has(i.id)).length;

  return (
    <section className="rounded-xl border border-[#c9a24b]/50 bg-amber-50/50 dark:bg-slate-800/50 p-3 sm:p-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <Megaphone size={16} className="text-[#c9a24b]" />
        <h3 className="text-sm font-bold text-gray-800 dark:text-slate-100">Voice messages</h3>
        {unheard > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white">{unheard} new</span>}
      </div>

      <div className="space-y-2">
        {items.map((b) => {
          const isNew = !heard.has(b.id);
          return (
            <div key={b.id} className={`rounded-lg border p-2.5 ${isNew ? "border-[#c9a24b] bg-white dark:bg-slate-900" : "border-gray-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/60"}`}>
              <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-slate-400">
                <span className="font-semibold text-gray-700 dark:text-slate-200">
                  🎙 Voice message from {b.by}{isNew && <span className="ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded bg-red-500 text-white align-middle">NEW</span>}
                </span>
                <span>{fmtIST(b.at)}{b.durationSec ? ` · ${fmtDur(b.durationSec)}` : ""}</span>
              </div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">To: {b.audience}{b.title ? ` · ${b.title}` : ""}</div>
              <audio controls preload="none" src={`/api/voice-broadcast/${b.id}/audio`} onPlay={() => markHeard(b.id)} className="w-full h-9 mt-1.5" />
              {b.transcript && <p className="text-sm text-gray-700 dark:text-slate-200 mt-1.5 whitespace-pre-wrap">{b.transcript}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
