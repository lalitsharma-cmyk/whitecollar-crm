"use client";

// FollowupNextPopup — the "What do you want to do with this follow-up?" prompt
// shown AFTER a successful Log Call or WhatsApp send, forcing the agent to close
// the action (Complete · Snooze · Escalate) rather than leaving it open.
//
// DRY: it calls the EXACT same shared endpoints as every other surface —
//   POST /api/leads/[id]/action-complete   (now passes the gate: a touch was just logged)
//   POST /api/leads/[id]/action-snooze     (with the inline IST picker; reason-prompts if asked)
//   POST /api/leads/[id]/action-escalate   (optional reason)
// No follow-up logic is duplicated here; this is purely the prompt UX.
//
// Mounted by LeadActionsClient (after Log Call) + TemplatePickerButton (after WA
// send). The parent owns visibility via `open`; on any successful action (or
// dismiss) it calls onClose, and on a mutating success it router.refresh()es so
// the timeline + follow-up banner update.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACTION_TOKENS } from "@/lib/actionDesign";
import CRMDatePicker from "@/components/CRMDatePicker";
import { backdropProps } from "@/lib/useDismiss";
import { isPastISTLocalInput } from "@/lib/datetime";
import { showXpToast } from "@/components/XPToast";

interface Props {
  open: boolean;
  leadId: string;
  leadName: string;
  onClose: () => void;
}

export default function FollowupNextPopup({ open, leadId, leadName, onClose }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "complete" | "snooze" | "escalate">(null);
  const [mode, setMode] = useState<"choose" | "escalate">("choose");
  const [escalateReason, setEscalateReason] = useState("");

  if (!open) return null;

  const CompleteIcon = ACTION_TOKENS.complete.icon;
  const SnoozeIcon = ACTION_TOKENS.snooze.icon;
  const EscalateIcon = ACTION_TOKENS.escalate.icon;

  async function doComplete() {
    if (busy) return;
    setBusy("complete");
    try {
      const r = await fetch(`/api/leads/${leadId}/action-complete`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.error ?? "Could not complete follow-up"); return; }
      if (j.awardedXp) showXpToast({ amount: j.awardedXp.amount, label: j.awardedXp.label, leveledUp: j.awardedXp.leveledUp, newLevel: j.awardedXp.newLevel });
      onClose();
      router.refresh();
    } finally { setBusy(null); }
  }

  // Snooze via the shared inline IST picker. V1: instant — no reason prompt
  // (Lalit's UX simplification). Same endpoint as LeadFollowupActions.
  async function doSnooze(v: string) {
    if (!v) return;
    if (isPastISTLocalInput(v)) throw new Error("Pick a future date/time (IST).");
    setBusy("snooze");
    try {
      const r = await fetch(`/api/leads/${leadId}/action-snooze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at: `${v}:00+05:30` }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not snooze");
      onClose();
      router.refresh();
    } finally { setBusy(null); }
  }

  async function doEscalate() {
    if (busy) return;
    setBusy("escalate");
    try {
      const r = await fetch(`/api/leads/${leadId}/action-escalate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: escalateReason.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.error ?? "Could not escalate"); return; }
      onClose();
      router.refresh();
    } finally { setBusy(null); }
  }

  return (
    // Bottom-sheet on mobile, centred dialog on desktop — mirrors the Log Call modal.
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" {...backdropProps(onClose)}>
      <div
        className="bg-white dark:bg-slate-800 sm:rounded-xl rounded-t-2xl max-w-md w-full p-5 shadow-2xl safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-semibold text-lg text-[#0b1a33] dark:text-slate-100">What next for this follow-up?</div>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
          Logged for <span className="font-medium">{leadName}</span>. Close the action so it leaves your list.
        </p>

        {mode === "choose" ? (
          <div className="mt-4 space-y-2">
            {/* Complete — the touch was just logged, so this passes the gate. */}
            <button
              type="button"
              onClick={doComplete}
              disabled={!!busy}
              className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm min-h-11 disabled:opacity-60 ${ACTION_TOKENS.complete.solid}`}
            >
              <CompleteIcon className="w-4 h-4" />
              {busy === "complete" ? "Completing…" : "Complete follow-up"}
            </button>

            {/* Snooze — inline IST picker (its own modal). Reschedules followupDate. */}
            <CRMDatePicker
              onConfirm={doSnooze}
              withTime
              futureOnly
              title="Snooze follow-up"
              placeholder={
                busy === "snooze" ? "Saving…" : (
                  <span className="inline-flex items-center gap-2 justify-center">
                    <SnoozeIcon className="w-4 h-4" /> Snooze to a later date
                  </span>
                )
              }
              triggerStyle="chip"
              chipClassName={`w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm min-h-11 disabled:opacity-60 ${ACTION_TOKENS.snooze.solid}`}
            />

            {/* Escalate — switches to the reason sub-view. */}
            <button
              type="button"
              onClick={() => setMode("escalate")}
              disabled={!!busy}
              className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm min-h-11 disabled:opacity-60 ${ACTION_TOKENS.escalate.solid}`}
            >
              <EscalateIcon className="w-4 h-4" />
              Escalate to manager
            </button>

            <button type="button" onClick={onClose} className="w-full btn btn-ghost text-xs mt-1">
              Not now
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Tell manager why</label>
            <textarea
              value={escalateReason}
              onChange={(e) => setEscalateReason(e.target.value)}
              rows={3}
              placeholder="e.g. Client wants a 30% discount, need approval"
              autoFocus
              className="w-full mt-1 border rounded-lg p-2 text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"
            />
            <div className="flex gap-2 mt-3 justify-end">
              <button type="button" onClick={() => setMode("choose")} className="btn btn-ghost text-xs">← Back</button>
              <button type="button" onClick={doEscalate} disabled={!!busy}
                className="btn text-xs bg-rose-600 text-white">
                {busy === "escalate" ? "Sending…" : "Send to manager"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
