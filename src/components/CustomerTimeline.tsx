"use client";

import { useState } from "react";
import {
  TIMELINE_CHIPS,
  TIMELINE_EVENT,
  chipForEvent,
  eventMatchesChip,
  type TimelineChipKey,
  type TimelineEventType,
} from "@/lib/customer/timelineEvents";

// Customer-layer master timeline (Step 1 foundation). READ-ONLY. The events are
// passed in pre-aggregated from the server (every Activity across the customer's
// enquiries + the link/unlink audit events), each tagged with a STANDARDIZED
// taxonomy event type (timelineEvents.ts). The chips FILTER what is shown — events
// are never removed, only hidden (Rule 4). Default = All Events.

export interface ClientTimelineEvent {
  id: string;
  leadId: string | null;
  at: string;            // ISO
  /** A locked taxonomy event type (timelineEvents.ts TIMELINE_EVENT). */
  category: string;
  title: string;
  detail: string | null;
  by: string | null;
}

// Per-event dot colour, keyed by the LOCKED taxonomy event type. Anything not
// explicitly listed falls back to a neutral dot.
const EVENT_DOT: Partial<Record<TimelineEventType, string>> = {
  [TIMELINE_EVENT.CALL_LOGGED]: "bg-blue-500",
  [TIMELINE_EVENT.WHATSAPP_LOGGED]: "bg-green-500",
  [TIMELINE_EVENT.NOTE_ADDED]: "bg-slate-400",
  [TIMELINE_EVENT.LEAD_ASSIGNED]: "bg-indigo-500",
  [TIMELINE_EVENT.LEAD_REASSIGNED]: "bg-indigo-500",
  [TIMELINE_EVENT.FOLLOWUP_CREATED]: "bg-orange-500",
  [TIMELINE_EVENT.FOLLOWUP_COMPLETED]: "bg-orange-500",
  [TIMELINE_EVENT.FOLLOWUP_RESCHEDULED]: "bg-orange-500",
  [TIMELINE_EVENT.STATUS_CHANGED]: "bg-emerald-600",
  [TIMELINE_EVENT.STAGE_CHANGED]: "bg-emerald-600",
  [TIMELINE_EVENT.AI_RECOMMENDATION]: "bg-purple-500",
  [TIMELINE_EVENT.AI_SUMMARY]: "bg-purple-500",
  [TIMELINE_EVENT.IMPORT]: "bg-amber-500",
  [TIMELINE_EVENT.EXPORT]: "bg-amber-500",
  [TIMELINE_EVENT.LEAD_CREATED]: "bg-amber-500",
  [TIMELINE_EVENT.CUSTOMER_CREATED]: "bg-teal-500",
  [TIMELINE_EVENT.CUSTOMER_LINKED]: "bg-teal-500",
  [TIMELINE_EVENT.MERGE]: "bg-teal-500",
  [TIMELINE_EVENT.ROLLBACK]: "bg-rose-500",
  [TIMELINE_EVENT.CUSTOMER_UNLINKED]: "bg-rose-500",
  [TIMELINE_EVENT.SOFT_DELETE]: "bg-red-500",
  [TIMELINE_EVENT.RESTORE]: "bg-lime-600",
};

function dotFor(ev: string): string {
  return EVENT_DOT[ev as TimelineEventType] ?? "bg-slate-300";
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

export default function CustomerTimeline({ events }: { events: ClientTimelineEvent[] }) {
  const [active, setActive] = useState<TimelineChipKey>("all");

  // Count events per chip GROUP (an event belongs to exactly one non-"all" chip).
  const countForChip = (key: TimelineChipKey): number =>
    key === "all"
      ? events.length
      : events.filter((e) => eventMatchesChip(e.category as TimelineEventType, key)).length;

  // Only show chips for groups that actually have events (plus the "all" chip).
  const visibleChips = TIMELINE_CHIPS.filter((c) => c.key === "all" || countForChip(c.key) > 0);

  // Filter (never remove) — "all" passes everything.
  const shown =
    active === "all"
      ? events
      : events.filter((e) => eventMatchesChip(e.category as TimelineEventType, active));

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {visibleChips.map((c) => {
          const count = countForChip(c.key);
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
                  dotFor(e.category)
                }
              />
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{e.title}</p>
                <time className="text-xs text-slate-400 whitespace-nowrap">{fmt(e.at)}</time>
              </div>
              {e.detail && <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">{e.detail}</p>}
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                <span className="uppercase tracking-wide">{chipForEvent(e.category as TimelineEventType)}</span>
                {e.by && <span>· {e.by}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
