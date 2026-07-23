"use client";

// ActionCardClient — the interactive layer on each card in /action-list.
//
// Renders ONLY the action bar (Complete · Snooze · Escalate · Call · WhatsApp)
// and the optional snooze popover. The static card chrome (name, status chips,
// remarks, "Why you") is rendered server-side by /action-list/page.tsx so the
// first paint is fast and SEO-clean — we layer interactivity on top.
//
// Why a separate component instead of inlining into the page?
//   1. The page is a Server Component (async db queries) — can't have onClick.
//   2. The same bar is reused across all three sections (Ready / Need-you /
//      Overdue) so consolidating the fetch + state + toast logic here keeps
//      the page file readable.
//   3. The card needs router.refresh() after each action; that's a client-only
//      hook. Doing it once per card keeps server traffic minimal.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDismiss } from "@/lib/useDismiss";
import { showXpToast } from "@/components/XPToast";
import { ActionButton } from "@/components/actions/ActionButton";
import { ActionIconButton } from "@/components/actions/ActionIconButton";
import { useDialBeacon } from "@/components/useDialBeacon";
import { ACTION_TOKENS } from "@/lib/actionDesign";

interface Props {
  leadId: string;
  leadName: string;
  phone: string | null;
  waLink: string;
  /**
   * Which flag bucket this card came from. We use it to:
   *   • show a different default snooze (overdue → +1h, others → +4h)
   *   • pre-fill the escalate reason on Overdue cards ("3+ days overdue, can't reach")
   */
  flagKind: "ready_close" | "overdue" | "needs_you";
  /**
   * True when the lead has a valid contact attempt (call / WhatsApp / email)
   * logged TODAY (IST). The Complete button is disabled until this is true —
   * an agent must log a touch before closing the follow-up (Lalit's policy).
   * Computed once per card by the server page (batch query). Snooze + Escalate
   * stay available regardless.
   */
  hasContactToday?: boolean;
}

const SNOOZE_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: "1 hour",  hours: 1 },
  { label: "4 hours", hours: 4 },
  { label: "Tomorrow", hours: 24 },
  { label: "3 days",  hours: 72 },
];

export default function ActionCardClient({ leadId, leadName, phone, waLink, flagKind, hasContactToday = false }: Props) {
  const router = useRouter();
  const dial = useDialBeacon();
  const [busy, setBusy] = useState<null | "complete" | "snooze" | "escalate">(null);
  const [showSnooze, setShowSnooze] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);
  const [escalateReason, setEscalateReason] = useState(
    flagKind === "overdue" ? "Multiple attempts, can't reach the client" : ""
  );
  // Click-outside dismiss for the two popovers — via the shared useDismiss helper so a
  // text selection that began inside (e.g. the escalate note) never drops the box
  // mid-drag. One ref per popover; each closes only on a genuine outside interaction.
  const snoozeRef = useDismiss<HTMLDivElement>(showSnooze, () => setShowSnooze(false));
  const escalateRef = useDismiss<HTMLDivElement>(showEscalate, () => setShowEscalate(false));

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
      if (!r.ok) {
        alert(j.error ?? "Could not complete action");
        return;
      }
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

  async function doSnooze(hours: number) {
    if (busy) return;
    setBusy("snooze");
    setShowSnooze(false);
    try {
      const r = await fetch(`/api/leads/${leadId}/action-snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j.error ?? "Could not snooze");
        return;
      }
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
      if (!r.ok) {
        alert(j.error ?? "Could not escalate");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  // Action visuals (icon + colour) come from the central Action Design System
  // tokens — see src/lib/actionDesign.ts. Behaviour (these popovers/handlers/
  // endpoints) is unchanged. Snooze/Escalate are popover TOGGLES, so they stay
  // bespoke buttons but borrow the token colours/icon for a consistent look;
  // Complete + the Call/WhatsApp chips use the shared components directly.
  const CompleteIcon = ACTION_TOKENS.complete.icon;
  const SnoozeIcon = ACTION_TOKENS.snooze.icon;
  const EscalateIcon = ACTION_TOKENS.escalate.icon;

  return (
    <div className="mt-3 flex flex-wrap gap-2 relative">
      <ActionButton
        action="complete"
        size="sm"
        onClick={doComplete}
        disabled={!!busy || !hasContactToday}
        loading={busy === "complete"}
        title={hasContactToday
          ? `Mark today's follow-up for ${leadName} as done`
          : "Contact attempt required before completing."}
      />

      {/* Snooze — popover with preset windows */}
      <div ref={snoozeRef} className="relative">
        <button
          type="button"
          onClick={() => { setShowSnooze((s) => !s); setShowEscalate(false); }}
          disabled={!!busy}
          className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm min-h-9 disabled:opacity-60 ${ACTION_TOKENS.snooze.solid}`}
        >
          <SnoozeIcon className="w-3.5 h-3.5" />
          {busy === "snooze" ? "Snoozing…" : "Snooze ▾"}
        </button>
        {showSnooze && (
          <div className="absolute z-20 top-full mt-1 left-0 min-w-[160px] rounded-lg border bg-white shadow-xl p-1 text-xs">
            {SNOOZE_OPTIONS.map((opt) => (
              <button
                key={opt.hours}
                type="button"
                onClick={() => doSnooze(opt.hours)}
                className="w-full text-left px-3 py-2 rounded hover:bg-amber-50 text-[#0b1a33]"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Escalate — popover with required note (pre-filled for overdue) */}
      <div ref={escalateRef} className="relative">
        <button
          type="button"
          onClick={() => { setShowEscalate((s) => !s); setShowSnooze(false); }}
          disabled={!!busy}
          className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition shadow-sm min-h-9 disabled:opacity-60 ${ACTION_TOKENS.escalate.solid}`}
        >
          <EscalateIcon className="w-3.5 h-3.5" />
          {busy === "escalate" ? "Sending…" : "Escalate"}
        </button>
        {showEscalate && (
          <div className="absolute z-20 top-full mt-1 left-0 w-[280px] rounded-lg border bg-white shadow-xl p-3 text-xs">
            <div className="font-bold mb-2 text-[#0b1a33]">Tell manager why</div>
            <textarea
              value={escalateReason}
              onChange={(e) => setEscalateReason(e.target.value)}
              rows={3}
              placeholder="e.g. Client wants a 30% discount, need approval"
              className="w-full border rounded p-2 text-xs"
              autoFocus
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button
                type="button"
                onClick={() => setShowEscalate(false)}
                className="btn btn-ghost text-[11px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doEscalate}
                className="btn text-[11px] bg-rose-600 text-white"
              >
                Send to manager
              </button>
            </div>
          </div>
        )}
      </div>

      <span className="grow" />

      {waLink && (
        <ActionIconButton action="whatsapp" href={waLink} variant="solid" external />
      )}
      {phone && (
        <ActionIconButton action="call" href={`tel:${phone.replace(/[^\d+]/g, "")}`} variant="solid" onClick={dial({ leadId })} />
      )}
    </div>
  );
}
