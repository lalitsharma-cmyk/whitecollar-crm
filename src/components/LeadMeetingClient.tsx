"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fromISTLocalInput } from "@/lib/datetime";
import CRMDatePicker from "./CRMDatePicker";
import { showXpToast } from "./XPToast";
import { showCelebration } from "@/components/DealCelebration";
import EditableNote, { canEditLogNote } from "./EditableNote";

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
  /** Activity.userId — who logged it (same-day edit gate). */
  userId?: string | null;
  /** Activity.createdAt ISO — when it was logged (same-day edit gate). */
  createdAt?: string | null;
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

// Collapsed preview length — ~2 lines, then "Read More".
const PREVIEW_LEN = 120;

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

export default function LeadMeetingClient({
  leadId, counts, leadName, activities = [], viewerRole, viewerId,
}: {
  leadId: string;
  counts: Counts;
  leadName?: string;
  activities?: MeetingActivity[];
  viewerRole?: string;
  viewerId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("OFFICE_MEETING");
  const [when, setWhen] = useState("");
  const [duration, setDuration] = useState("");
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Count tiles filter the list by type. null = show ALL records. Records render
  // collapsed by default (date/time/agent/type + preview); each expands on its own.
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const pickType = (t: string) => setTypeFilter(f => (f === t ? null : t));
  // Accordion: only ONE record open at a time. Opening another auto-collapses the
  // previous; clicking the open one collapses it. Default: all collapsed (null).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleRecord = (id: string) => setExpandedId(prev => (prev === id ? null : id));

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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center text-sm">
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

      {/* Records — collapsed by default. Each row shows date · time · agent · type
          + a short preview; click to expand the full Notes / Outcome. Every record
          toggles independently (opening one never opens others). Toggling is local
          state so the page never jumps scroll position. */}
      {activities.length > 0 && (() => {
        const list = (typeFilter ? activities.filter(a => a.type === typeFilter) : activities)
          .slice()
          .sort((a, b) => {
            const da = new Date(a.completedAt ?? a.startedAt ?? 0).getTime();
            const db = new Date(b.completedAt ?? b.startedAt ?? 0).getTime();
            return db - da; // newest first
          });
        const filterLabel = typeFilter ? (TYPE_LABEL[typeFilter] ?? typeFilter) : "All";
        return (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-gray-700 dark:text-slate-200">
                {filterLabel} · {list.length} record{list.length === 1 ? "" : "s"}
              </span>
              {typeFilter && (
                <button type="button" onClick={() => setTypeFilter(null)} className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-slate-300">Show all</button>
              )}
            </div>
            {list.length === 0 ? (
              <div className="text-xs text-gray-400 dark:text-slate-500 italic py-2">No {filterLabel} entries.</div>
            ) : (
              <div className="space-y-2">
                {list.map((a) => {
                  const dateIso = a.completedAt ?? a.startedAt;
                  const expanded = expandedId === a.id;
                  const desc = (a.description ?? "").trim();
                  const oneLine = desc.replace(/\s+/g, " ").trim();
                  const isLong = oneLine.length > PREVIEW_LEN;
                  const preview = isLong ? oneLine.slice(0, PREVIEW_LEN).replace(/\s+\S*$/, "") + "…" : oneLine;
                  return (
                    <div key={a.id} className="border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50/50 dark:bg-slate-800/40 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleRecord(a.id)}
                        aria-expanded={expanded}
                        className="w-full flex items-start gap-2 p-3 text-left hover:bg-gray-100/60 dark:hover:bg-slate-700/40 transition-colors"
                      >
                        <span className="flex-none w-3 mt-0.5 text-[11px] text-gray-400 dark:text-slate-500">{expanded ? "▲" : "▼"}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-slate-400 flex-wrap">
                            <span className="font-semibold text-gray-700 dark:text-slate-200">{TYPE_LABEL[a.type] ?? a.type}</span>
                            <span>· {fmtDate(dateIso)}</span>
                            <span>· {fmtTime(dateIso)} IST</span>
                            {a.loggedBy && <span>· 👤 {a.loggedBy}</span>}
                            {a.isNoShow && (
                              <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">No-show</span>
                            )}
                          </div>
                          {!expanded && (
                            desc
                              ? <div className="mt-1 text-sm text-gray-600 dark:text-slate-300 leading-snug break-words">{preview}{isLong && <span className="text-blue-600 dark:text-blue-400 font-medium"> Read More</span>}</div>
                              : <div className="mt-1 text-xs text-gray-400 dark:text-slate-500 italic">No notes recorded.</div>
                          )}
                        </div>
                      </button>
                      {expanded && (
                        <div className="px-3 pb-3 pl-8">
                          {a.source === "logged" && canEditLogNote({ viewerRole, viewerId, entryUserId: a.userId, loggedAt: a.createdAt }) ? (
                            <EditableNote
                              leadId={leadId}
                              kind="activity"
                              entryId={a.id}
                              note={desc || null}
                              canEdit
                              emptyLabel="Add what happened…"
                              textClass="text-sm text-gray-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed break-words max-h-72 overflow-y-auto pr-1"
                            />
                          ) : desc ? (
                            <div className="text-sm text-gray-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed break-words max-h-72 overflow-y-auto pr-1">{desc}</div>
                          ) : (
                            <div className="text-xs text-gray-400 dark:text-slate-500 italic">No notes recorded.</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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
