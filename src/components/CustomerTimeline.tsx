"use client";

import { useState } from "react";

// Customer-layer master timeline (Step 1 foundation). READ-ONLY. The events are
// passed in pre-aggregated from the server (every Activity across the customer's
// enquiries + the link/unlink audit events). The chips FILTER what is shown —
// events are never removed, only hidden (Rule 4). Default = All Events.

export interface ClientTimelineEvent {
  id: string;
  leadId: string | null;
  at: string;            // ISO
  category: string;
  title: string;
  detail: string | null;
  by: string | null;
}

const CHIPS: { key: string; label: string }[] = [
  { key: "all", label: "All Events" },
  { key: "call", label: "Calls" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "note", label: "Notes" },
  { key: "assignment", label: "Assignments" },
  { key: "ai", label: "AI" },
  { key: "import", label: "Imports" },
  { key: "followup", label: "Follow-ups" },
  { key: "merge", label: "Merges" },
  { key: "unlink", label: "Unlinks" },
  { key: "converted", label: "Converted" },
  { key: "rejected", label: "Rejected" },
];

const CAT_DOT: Record<string, string> = {
  call: "bg-blue-500",
  whatsapp: "bg-green-500",
  note: "bg-slate-400",
  assignment: "bg-indigo-500",
  ai: "bg-purple-500",
  import: "bg-amber-500",
  followup: "bg-orange-500",
  merge: "bg-teal-500",
  unlink: "bg-rose-500",
  converted: "bg-emerald-600",
  rejected: "bg-red-500",
  other: "bg-slate-300",
};

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

export default function CustomerTimeline({ events }: { events: ClientTimelineEvent[] }) {
  const [active, setActive] = useState<string>("all");

  // Only show chips for categories that actually have events (plus "All").
  const present = new Set(events.map((e) => e.category));
  const visibleChips = CHIPS.filter((c) => c.key === "all" || present.has(c.key));

  const shown = active === "all" ? events : events.filter((e) => e.category === active);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {visibleChips.map((c) => {
          const count = c.key === "all" ? events.length : events.filter((e) => e.category === c.key).length;
          const on = active === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setActive(c.key)}
              className={
                "px-3 py-1 rounded-full text-xs font-medium border transition " +
                (on
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700")
              }
            >
              {c.label} <span className="opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">No events in this filter.</p>
      ) : (
        <ol className="relative border-l border-slate-200 dark:border-slate-700 ml-2">
          {shown.map((e) => (
            <li key={e.id} className="mb-5 ml-4">
              <span
                className={
                  "absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border border-white dark:border-slate-900 " +
                  (CAT_DOT[e.category] ?? CAT_DOT.other)
                }
              />
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{e.title}</p>
                <time className="text-xs text-slate-400 whitespace-nowrap">{fmt(e.at)}</time>
              </div>
              {e.detail && <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">{e.detail}</p>}
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                <span className="uppercase tracking-wide">{e.category}</span>
                {e.by && <span>· {e.by}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
