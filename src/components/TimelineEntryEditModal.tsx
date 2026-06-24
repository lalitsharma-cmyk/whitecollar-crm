"use client";

// TimelineEntryEditModal — admin/super-admin edit for a single Smart Timeline
// Activity entry. Editable fields: Date, Time (IST), Activity Type, Outcome,
// Remark Text, Follow-up Date. On Save it PATCHes the underlying Activity
// (/api/leads/[id]/activities/[activityId]) which updates it IN PLACE and writes
// the prior value to the ActivityEdit audit trail. Raw History is never touched.
//
// IST handling: Date+Time is edited as a "YYYY-MM-DDTHH:mm" wall-clock string
// (IST) via CRMDatePicker, then sent as "<val>:00+05:30" so the server parses it
// as IST→UTC. Follow-up date uses the same convention.

import { useState } from "react";
import { useRouter } from "next/navigation";
import CRMDatePicker from "./CRMDatePicker";

// Activity types selectable in the edit modal — mirrors EDITABLE_TYPES on the
// server. CALL / WHATSAPP / NOTE are intentionally excluded (own rows).
const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "SITE_VISIT", label: "🚗 Site Visit" },
  { value: "OFFICE_MEETING", label: "🏢 Office Meeting" },
  { value: "VIRTUAL_MEETING", label: "💻 Virtual Meeting" },
  { value: "HOME_VISIT", label: "🏠 Home Visit" },
  { value: "EXPO_MEETING", label: "🎪 Expo Meeting" },
  { value: "MEETING", label: "📅 Meeting" },
  { value: "PROJECT_DISCUSSED", label: "🏗 Project Discussed" },
  { value: "BROCHURE_SENT", label: "📄 Brochure Sent" },
  { value: "EMAIL", label: "✉️ Email" },
  { value: "STATUS_CHANGE", label: "🔄 Status Change" },
  { value: "REMINDER_FIRED", label: "🔔 Reminder" },
  { value: "LEAD_CREATED", label: "✨ Lead Created" },
  { value: "COLD_TO_LEAD", label: "🔥 Revived" },
  { value: "TASK", label: "✅ Task" },
];

export interface TimelineEntryEditModalProps {
  leadId: string;
  activityId: string;
  /** Initial values. Dates are IST wall-clock "YYYY-MM-DDTHH:mm" strings (or ""). */
  initial: {
    type: string;
    outcome: string;
    description: string;
    /** effective date/time (completedAt ?? scheduledAt) as IST local input */
    when: string;
    /** whether `when` maps to scheduledAt (true) or completedAt (false) */
    whenIsScheduled: boolean;
    followup: string;
  };
  onClose: () => void;
}

export default function TimelineEntryEditModal({
  leadId, activityId, initial, onClose,
}: TimelineEntryEditModalProps) {
  const router = useRouter();
  const [type, setType] = useState(initial.type);
  const [outcome, setOutcome] = useState(initial.outcome);
  const [description, setDescription] = useState(initial.description);
  const [when, setWhen] = useState(initial.when);
  const [followup, setFollowup] = useState(initial.followup);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Convert an IST wall-clock "YYYY-MM-DDTHH:mm" → "<val>:00+05:30", or null when blank.
  const toOffset = (v: string): string | null => (v ? `${v}:00+05:30` : null);

  async function save() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      // Send `when` to whichever date field the entry uses so we don't move a
      // completed event onto scheduledAt (or vice-versa).
      const whenField = initial.whenIsScheduled ? "scheduledAt" : "completedAt";
      const payload: Record<string, unknown> = {
        type,
        outcome: outcome.trim(),
        description: description.trim(),
        [whenField]: toOffset(when),
        followupDate: toOffset(followup),
      };
      const r = await fetch(`/api/leads/${leadId}/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) { onClose(); router.refresh(); return; }
      const j = await r.json().catch(() => ({} as { error?: string }));
      setErr(j.error ?? "Couldn't save the edit.");
    } catch {
      setErr("Network error — couldn't save the edit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/50 dark:bg-black/70" aria-hidden />
      <div className="relative bg-white dark:bg-slate-800 w-full sm:w-[420px] max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl z-10">
        {/* Drag handle (mobile) */}
        <div className="flex justify-center pt-3 sm:hidden">
          <div className="w-9 h-1 rounded-full bg-gray-300 dark:bg-slate-600" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-4 pb-2 border-b border-gray-100 dark:border-slate-700">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">✏️ Edit timeline entry</h3>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">The original is kept in the audit log — nothing is lost.</p>
          </div>
          <button type="button" onClick={() => !busy && onClose()} aria-label="Close"
            className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 rounded-full transition-colors">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-3.5">
          {/* Date + Time (IST) */}
          <div>
            <label className="text-[10px] font-bold tracking-widest text-gray-500 dark:text-slate-400 block mb-1">DATE &amp; TIME (IST)</label>
            <CRMDatePicker
              value={when}
              onConfirm={(v) => setWhen(v)}
              withTime
              triggerStyle="input"
              placeholder="Pick date & time"
              title="Entry date & time (IST)"
            />
          </div>

          {/* Activity Type */}
          <div>
            <label className="text-[10px] font-bold tracking-widest text-gray-500 dark:text-slate-400 block mb-1">ACTIVITY TYPE</label>
            <select value={type} onChange={(e) => setType(e.target.value)} disabled={busy}
              className="w-full text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#0b1a33] disabled:opacity-60">
              {/* Keep the current value selectable even if it's outside the curated list. */}
              {!TYPE_OPTIONS.some((o) => o.value === type) && type && (
                <option value={type}>{type}</option>
              )}
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Outcome */}
          <div>
            <label className="text-[10px] font-bold tracking-widest text-gray-500 dark:text-slate-400 block mb-1">OUTCOME</label>
            <input type="text" value={outcome} onChange={(e) => setOutcome(e.target.value)} disabled={busy}
              placeholder="e.g. Connected · Site visit done · Interested"
              className="w-full text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#0b1a33] disabled:opacity-60" />
          </div>

          {/* Remark text */}
          <div>
            <label className="text-[10px] font-bold tracking-widest text-gray-500 dark:text-slate-400 block mb-1">REMARK</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} disabled={busy}
              placeholder="What happened on this entry…"
              className="w-full text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#0b1a33] disabled:opacity-60" />
          </div>

          {/* Follow-up date */}
          <div>
            <label className="text-[10px] font-bold tracking-widest text-gray-500 dark:text-slate-400 block mb-1">FOLLOW-UP DATE <span className="font-normal normal-case text-gray-400">(optional — also updates the lead)</span></label>
            <CRMDatePicker
              value={followup}
              onConfirm={(v) => setFollowup(v)}
              withTime
              triggerStyle="input"
              placeholder="No follow-up"
              title="Follow-up date (IST)"
            />
            {followup && (
              <button type="button" onClick={() => setFollowup("")} disabled={busy}
                className="mt-1 text-[10px] text-gray-400 hover:text-gray-600">✕ clear follow-up</button>
            )}
          </div>

          {err && <div className="text-xs text-red-600 dark:text-red-400">⚠ {err}</div>}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 bg-gray-50 dark:bg-slate-900/60 border-t border-gray-100 dark:border-slate-700">
          <button type="button" onClick={save} disabled={busy}
            className="btn btn-primary flex-1 justify-center disabled:opacity-50">
            {busy ? "Saving…" : "Save changes"}
          </button>
          <button type="button" onClick={() => !busy && onClose()} disabled={busy}
            className="btn btn-ghost flex-1 justify-center">Cancel</button>
        </div>
      </div>
    </div>
  );
}
