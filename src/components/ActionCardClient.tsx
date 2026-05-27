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
import { useState, useRef, useEffect } from "react";
import { showXpToast } from "@/components/XPToast";

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
}

const SNOOZE_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: "1 hour",  hours: 1 },
  { label: "4 hours", hours: 4 },
  { label: "Tomorrow", hours: 24 },
  { label: "3 days",  hours: 72 },
];

export default function ActionCardClient({ leadId, leadName, phone, waLink, flagKind }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "complete" | "snooze" | "escalate">(null);
  const [showSnooze, setShowSnooze] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);
  const [escalateReason, setEscalateReason] = useState(
    flagKind === "overdue" ? "Multiple attempts, can't reach the client" : ""
  );
  const snoozeRef = useRef<HTMLDivElement>(null);
  const escalateRef = useRef<HTMLDivElement>(null);

  // Click-outside dismiss for popovers. Done in one effect so we share the
  // listener instead of registering two — micro-optimisation but keeps the
  // event hot list shorter on pages with 30+ cards.
  useEffect(() => {
    if (!showSnooze && !showEscalate) return;
    function handle(e: MouseEvent) {
      const t = e.target as Node;
      if (showSnooze && snoozeRef.current && !snoozeRef.current.contains(t)) {
        setShowSnooze(false);
      }
      if (showEscalate && escalateRef.current && !escalateRef.current.contains(t)) {
        setShowEscalate(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showSnooze, showEscalate]);

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

  return (
    <div className="mt-3 flex flex-wrap gap-2 relative">
      <button
        type="button"
        onClick={doComplete}
        disabled={!!busy}
        className="btn text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
        title={`Mark today's follow-up for ${leadName} as done`}
      >
        {busy === "complete" ? "Saving…" : "✅ Complete"}
      </button>

      {/* Snooze — popover with preset windows */}
      <div ref={snoozeRef} className="relative">
        <button
          type="button"
          onClick={() => { setShowSnooze((s) => !s); setShowEscalate(false); }}
          disabled={!!busy}
          className="btn text-xs bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {busy === "snooze" ? "Snoozing…" : "⏸ Snooze ▾"}
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
          className="btn text-xs bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
        >
          {busy === "escalate" ? "Sending…" : "🆘 Escalate"}
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
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="btn text-xs bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
        >
          💬 WhatsApp
        </a>
      )}
      {phone && (
        <a
          href={`tel:${phone.replace(/[^\d+]/g, "")}`}
          className="btn btn-primary text-xs"
        >
          📞 Call
        </a>
      )}
    </div>
  );
}
