"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fromISTLocalInput } from "@/lib/datetime";
import CRMDatePicker from "./CRMDatePicker";
import { showXpToast } from "./XPToast";
import { showCelebration } from "@/components/DealCelebration";

interface Counts {
  officeMeetings: { count: number; lastAt: string | null };
  virtualMeetings: { count: number; lastAt: string | null };
  siteVisits: { count: number; lastAt: string | null };
}

interface MeetingActivity {
  id: string;
  type: string;
  completedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  description: string | null;
  isNoShow: boolean;
  loggedBy: string | null;
  /** "logged" = CRM-logged Activity row · "remark" = auto-detected from imported conversation history */
  source?: "remark" | "logged";
}

const TYPES = [
  { v: "OFFICE_MEETING",  label: "🏢 Office Meeting" },
  { v: "VIRTUAL_MEETING", label: "💻 Virtual Meeting" },
  { v: "SITE_VISIT",      label: "🚗 Site Visit" },
];

const TYPE_LABEL: Record<string, string> = {
  OFFICE_MEETING:  "🏢 Office",
  VIRTUAL_MEETING: "💻 Virtual",
  SITE_VISIT:      "🚗 Site Visit",
};

function ago(d: string | null) {
  if (!d) return "never";
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Format a Date to "4 Jun 2025" */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
}

/** Format a Date to "3:30 PM" IST */
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}

/** Duration between two ISO strings in minutes, formatted */
function fmtDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function LeadMeetingClient({
  leadId, counts, leadName, activities = [],
}: {
  leadId: string;
  counts: Counts;
  leadName?: string;
  activities?: MeetingActivity[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("OFFICE_MEETING");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("");
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  // Clicking a count tile filters the history list to that meeting type.
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const pickType = (t: string) => { setTypeFilter(f => (f === t ? null : t)); setShowHistory(true); };

  async function save() {
    if (remarks.trim().length < 3) { setErr("Remarks required (min 3 chars)."); return; }
    const whenISO = when ? fromISTLocalInput(when)?.toISOString() ?? "" : "";
    setErr(null); setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, when: whenISO, durationMin: Number(duration) || 0, remarks }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed"); return; }
      setOpen(false); setWhen(""); setDuration(""); setRemarks("");
      if (j.awardedXp) {
        showXpToast({
          amount: j.awardedXp.amount,
          label: j.awardedXp.label,
          leveledUp: !!j.awardedXp.leveledUp,
          newLevel: j.awardedXp.newLevel,
        });
      }
      showCelebration({ kind: "meeting_booked", message: `Meeting booked — ${leadName ?? "client"}` });
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">Meetings & Site Visits</div>
        <button onClick={() => setOpen(true)} className="text-xs btn btn-ghost py-1">+ Log</button>
      </div>

      {/* Count tiles — click to filter the history list below by type */}
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        {([
          { t: "OFFICE_MEETING",  emoji: "🏢", label: "Office",     c: counts.officeMeetings },
          { t: "SITE_VISIT",      emoji: "🚗", label: "Site Visit", c: counts.siteVisits },
          { t: "VIRTUAL_MEETING", emoji: "💻", label: "Virtual",    c: counts.virtualMeetings },
        ] as const).map(({ t, emoji, label, c }) => {
          const active = typeFilter === t;
          const clickable = c.count > 0;
          return (
            <button
              key={t}
              type="button"
              onClick={() => clickable && pickType(t)}
              disabled={!clickable}
              aria-pressed={active}
              title={clickable ? `Show ${label} history` : `No ${label.toLowerCase()} entries yet`}
              className={[
                "p-2 border rounded-lg transition-colors",
                active
                  ? "border-[#0b1a33] ring-2 ring-[#0b1a33]/20 bg-[#0b1a33]/5 dark:border-blue-500 dark:bg-blue-500/10"
                  : "border-[#e5e7eb] dark:border-slate-600",
                clickable ? "cursor-pointer hover:border-gray-400 dark:hover:border-slate-400" : "opacity-60 cursor-default",
              ].join(" ")}
            >
              <div className="text-[11px] text-gray-500 dark:text-slate-400">{emoji} {label}</div>
              <div className="text-xl font-bold dark:text-slate-100">{c.count}</div>
              <div className="text-[10px] text-gray-500 dark:text-slate-400">last {ago(c.lastAt)}</div>
            </button>
          );
        })}
      </div>

      {/* History table — reflects the active type filter (click a tile above) */}
      {activities.length > 0 && (() => {
        const filtered = typeFilter ? activities.filter(a => a.type === typeFilter) : activities;
        const filterLabel = typeFilter ? (TYPE_LABEL[typeFilter] ?? typeFilter) : null;
        return (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => setShowHistory(v => !v)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <span>{showHistory ? "▾" : "▸"}</span>
              History ({filtered.length})
            </button>
            {typeFilter && (
              <button
                type="button"
                onClick={() => setTypeFilter(null)}
                title="Clear filter"
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[#0b1a33] text-white dark:bg-blue-700"
              >
                {filterLabel} <span className="text-white/70">✕</span>
              </button>
            )}
          </div>

          {showHistory && (
            filtered.length === 0 ? (
              <div className="text-xs text-gray-400 dark:text-slate-500 italic py-2">No {filterLabel} entries.</div>
            ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs border-collapse min-w-[480px]">
                <thead>
                  <tr className="text-left text-[10px] font-semibold text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                    <th className="pb-1.5 pr-3 whitespace-nowrap">Type</th>
                    <th className="pb-1.5 pr-3 whitespace-nowrap">Date</th>
                    <th className="pb-1.5 pr-3 whitespace-nowrap">Time (IST)</th>
                    <th className="pb-1.5 pr-3 whitespace-nowrap">Duration</th>
                    <th className="pb-1.5 pr-3 whitespace-nowrap">Agent</th>
                    <th className="pb-1.5">Notes / Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const duration = fmtDuration(a.startedAt, a.endedAt);
                    const dateIso = a.completedAt ?? a.startedAt;
                    return (
                      <tr
                        key={a.id}
                        className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50"
                      >
                        <td className="py-2 pr-3 whitespace-nowrap font-medium">
                          {TYPE_LABEL[a.type] ?? a.type}
                          {a.isNoShow && (
                            <span className="ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                              No-show
                            </span>
                          )}
                          {a.source === "remark" && (
                            <span
                              title="Auto-detected from imported conversation history"
                              className="ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                            >
                              history
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-700 dark:text-slate-300">
                          {fmtDate(dateIso)}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-700 dark:text-slate-300">
                          {fmtTime(dateIso)}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500 dark:text-slate-400">
                          {duration ?? "—"}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500 dark:text-slate-400">
                          {a.loggedBy ?? "—"}
                        </td>
                        <td className="py-2 text-gray-600 dark:text-slate-300 max-w-[180px]">
                          {a.description ? (
                            <span className="line-clamp-2" title={a.description}>{a.description}</span>
                          ) : (
                            <span className="text-gray-400 dark:text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )
          )}
        </div>
        );
      })()}

      {/* Log meeting modal */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold mb-3 text-lg">Log Meeting / Site Visit</div>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-600">
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300 block mb-1.5">When (leave empty to log as now)</label>
            <div className="mb-3">
              <CRMDatePicker
                value={when}
                onChange={setWhen}
                withTime
                triggerStyle="input"
                placeholder="Leave empty — defaults to now"
                title="When did this happen?"
              />
            </div>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Duration (minutes, optional)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => { if (["-", "e", "E", "+", "."].includes(e.key)) e.preventDefault(); }}
              onBlur={(e) => { const n = Number(e.target.value); if (!isFinite(n) || n < 0) setDuration(""); }}
              min={0}
              step={1}
              inputMode="numeric"
              placeholder="e.g. 45"
              className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm min-h-11 dark:bg-slate-800 dark:border-slate-600"
            />
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">What happened? *</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={4}
              placeholder="What did client say? Which projects did you discuss? What's the next step?"
              className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm font-mono text-[13px] dark:bg-slate-800 dark:border-slate-600" />
            {err && <div className="text-xs text-red-600 mt-2">{err}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOpen(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={save} disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
