"use client";

// LeadFollowupActions — the Complete / Snooze / Escalate bar shown in the
// Lead-Detail header (next to Call / WhatsApp / Log Call), so an agent can act
// on the lead's follow-up WITHOUT bouncing over to /action-list.
//
// DRY: this hits the EXACT same three endpoints the Action List card uses —
//   POST /api/leads/[id]/action-complete   (clears/advances followupDate + Activity)
//   POST /api/leads/[id]/action-snooze     (sets a new followupDate + Activity)
//   POST /api/leads/[id]/action-escalate   (needsManagerReview + notify + Activity)
// No follow-up logic is duplicated; the only thing that differs from the
// card is the Snooze UX — here we open the shared CRMDatePicker so the agent
// can choose an exact IST date/time (the card uses quick presets).
//
// Every action logs a Smart-Timeline Activity server-side and we router.refresh()
// so the timeline + follow-up banner update in place.

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { showXpToast } from "@/components/XPToast";
import CRMDatePicker from "@/components/CRMDatePicker";
import { toISTLocalInput, isPastISTLocalInput } from "@/lib/datetime";
import { ActionButton } from "@/components/actions/ActionButton";
import { ACTION_TOKENS } from "@/lib/actionDesign";

interface Props {
  leadId: string;
  leadName: string;
  /** Current follow-up (ISO) — seeds the Snooze picker so it opens on the existing date. */
  followupDate: string | null;
}

export default function LeadFollowupActions({ leadId, leadName, followupDate }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "complete" | "snooze" | "escalate">(null);
  const [showEscalate, setShowEscalate] = useState(false);
  const [escalateReason, setEscalateReason] = useState("");
  const escalateRef = useRef<HTMLDivElement>(null);

  // Seed the snooze picker: existing follow-up if any, else blank (picker
  // defaults to today). CRMDatePicker takes a "YYYY-MM-DDTHH:mm" IST string.
  const snoozeSeed = followupDate ? toISTLocalInput(followupDate) : "";

  useEffect(() => {
    if (!showEscalate) return;
    function handle(e: MouseEvent) {
      const t = e.target as Node;
      if (escalateRef.current && !escalateRef.current.contains(t)) setShowEscalate(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showEscalate]);

  async function doComplete() {
    if (busy) return;
    setBusy("complete");
    try {
      const r = await fetch(`/api/leads/${leadId}/action-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.error ?? "Could not complete follow-up"); return; }
      if (j.awardedXp) {
        showXpToast({
          amount: j.awardedXp.amount,
          label: j.awardedXp.label,
          leveledUp: j.awardedXp.leveledUp,
          newLevel: j.awardedXp.newLevel,
        });
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  // Snooze via the shared CRMDatePicker (withTime, futureOnly). The picker
  // returns "YYYY-MM-DDTHH:mm" in IST wall-clock; we send it as an explicit
  // IST instant so the follow-up lands exactly when the agent picked.
  async function doSnooze(v: string) {
    if (!v) return;
    if (isPastISTLocalInput(v)) throw new Error("Pick a future date/time (IST).");
    setBusy("snooze");
    try {
      const r = await fetch(`/api/leads/${leadId}/action-snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at: `${v}:00+05:30` }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not snooze");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function doEscalate() {
    if (busy) return;
    setBusy("escalate");
    setShowEscalate(false);
    try {
      const r = await fetch(`/api/leads/${leadId}/action-escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: escalateReason.trim() || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.error ?? "Could not escalate"); return; }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  // Complete / Snooze / Escalate visuals all come from the central Action Design
  // System (src/lib/actionDesign.ts) so they match the same actions elsewhere.
  // The follow-up row is a flex row whose direct children get `grow basis-28`
  // (see parent + the `contents` wrapper below), so each control adds that sizing.
  // Snooze + Escalate keep their bespoke shells (CRMDatePicker chip / popover
  // toggle) but borrow the token colours/icon. Layout-only; handlers unchanged.
  const sizing = "grow basis-28";
  const SnoozeIcon = ACTION_TOKENS.snooze.icon;
  const snoozeChip = `${sizing} inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition shadow-sm min-h-10 disabled:opacity-60 ${ACTION_TOKENS.snooze.solid}`;

  return (
    // `contents` makes this wrapper layout-transparent: its children become direct
    // flex items of the parent action row, so the 3 follow-up buttons render inline
    // with the primary action buttons instead of on a separate stacked line.
    <div className="contents">
      <ActionButton
        action="complete"
        size="md"
        onClick={doComplete}
        disabled={!!busy}
        loading={busy === "complete"}
        className={sizing}
        title={`Mark the current follow-up for ${leadName} as done`}
      />

      {/* Snooze — opens the shared IST date/time picker (CRMDatePicker handles
          the modal/bottom-sheet itself; this trigger button is its child). Uses the
          compact "chip" trigger so it sits inline with the other action buttons.
          The Clock icon is injected via the placeholder to match the snooze token. */}
      <CRMDatePicker
        value={snoozeSeed}
        onConfirm={doSnooze}
        withTime
        futureOnly
        title="Snooze follow-up"
        placeholder={
          busy === "snooze" ? (
            "Saving…"
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <SnoozeIcon className="w-4 h-4" /> Snooze
            </span>
          )
        }
        triggerStyle="chip"
        chipClassName={snoozeChip}
      />

      {/* Escalate — popover with optional reason (notifies manager + admins).
          This wrapper is the flex item (so the popover anchors to it); it carries
          the `grow basis-28` sizing while the inner button fills it (w-full). */}
      <div ref={escalateRef} className={`relative ${sizing}`}>
        <ActionButton
          action="escalate"
          size="md"
          onClick={() => setShowEscalate((s) => !s)}
          disabled={!!busy}
          loading={busy === "escalate"}
          loadingLabel="Sending…"
          className="w-full"
        />
        {showEscalate && (
          <div className="absolute z-30 top-full mt-1 left-0 w-[280px] rounded-lg border bg-white dark:bg-slate-800 dark:border-slate-600 shadow-xl p-3 text-xs">
            <div className="font-bold mb-2 text-[#0b1a33] dark:text-slate-100">Tell manager why</div>
            <textarea
              value={escalateReason}
              onChange={(e) => setEscalateReason(e.target.value)}
              rows={3}
              placeholder="e.g. Client wants a 30% discount, need approval"
              className="w-full border rounded p-2 text-xs dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"
              autoFocus
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button type="button" onClick={() => setShowEscalate(false)} className="btn btn-ghost text-[11px]">
                Cancel
              </button>
              <button type="button" onClick={doEscalate} className="btn text-[11px] bg-rose-600 text-white">
                Send to manager
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
