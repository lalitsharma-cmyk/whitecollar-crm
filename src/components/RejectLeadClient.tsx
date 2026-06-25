"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

interface Props {
  leadId: string;
  leadName: string;
  alreadyRejected?: boolean;
  currentReason?: string | null;
}

const REASONS = [
  { v: "FUND_ISSUE",                  label: "💰 Fund issue" },
  // "War Fear" retired as a reject reason (2026-06-26) — it's now a workable status.
  { v: "LOW_BUDGET",                  label: "📉 Low budget" },
  { v: "LOOK_AFTER_2_YEARS",          label: "📅 Look after 2 years" },
  { v: "WAITING_FOR_PROPERTY_SALE",   label: "🏠 Waiting to sell own property" },
  { v: "OTHER",                       label: "✏ Other (specify)" },
];

const REASON_LABELS: Record<string, string> = Object.fromEntries(REASONS.map(r => [r.v, r.label]));

/**
 * Reject Lead button + modal. Sets status=LOST with a structured reason from
 * the dropdown Lalit asked for. Free-text required when "Other" picked.
 * On reject: lead disappears from Today's follow-ups + dashboard counts as
 * lost. Reversible only by an admin changing the status field back.
 */
export default function RejectLeadClient({ leadId, leadName, alreadyRejected, currentReason }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("FUND_ISSUE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useBodyScrollLock(open);

  async function submit() {
    if (busy) return;
    if (reason === "OTHER" && !note.trim()) {
      setErr("Please specify the reason in the note.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, note: note.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? `Failed (${r.status})`); return; }
      setOpen(false);
      setReason("FUND_ISSUE"); setNote("");
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBusy(false); }
  }

  // Already-rejected — show the reason badge + an "undo" hint
  if (alreadyRejected) {
    return (
      <div className="card p-3 border-l-4 border-red-500 bg-red-50">
        <div className="text-xs font-bold text-red-900 flex items-center gap-1.5">
          <XCircle className="w-4 h-4" />
          REJECTED
        </div>
        <div className="text-[11px] text-red-800 mt-0.5">
          Reason: {currentReason ? (REASON_LABELS[currentReason] ?? currentReason) : "—"}
        </div>
        <div className="text-[10px] text-red-700/80 mt-1">
          Use the Stage dropdown in Qualification to un-reject this lead.
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="card p-3 w-full text-left text-red-700 hover:bg-red-50 transition flex items-center gap-2 border-l-4 border-red-300"
      >
        <XCircle className="w-4 h-4" />
        <div className="flex-1 text-xs font-semibold">Reject lead</div>
        <span className="text-[10px] text-gray-400">→</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-white sm:rounded-xl rounded-t-2xl max-w-md w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-semibold text-lg mb-1 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              Reject {leadName}
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Lead is marked LOST, removed from Today's follow-ups, and the reason is recorded in Reports for funnel analysis.
            </p>

            <label className="text-xs font-semibold text-gray-600">Reason *</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm bg-white"
            >
              {REASONS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
            </select>

            <label className="text-xs font-semibold text-gray-600">
              {reason === "OTHER" ? "Specify *" : "Note (optional)"}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={
                reason === "OTHER"
                  ? "e.g. Client passed away, moved abroad, family dispute…"
                  : "Add context — what did they say?"
              }
              className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm font-mono text-[13px]"
            />

            {err && <div className="text-xs text-red-600 mt-2">{err}</div>}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOpen(false)} className="btn btn-ghost">Cancel</button>
              <button
                onClick={submit}
                disabled={busy}
                className="btn bg-red-600 hover:bg-red-700 text-white"
              >
                {busy ? "Rejecting…" : "Reject Lead"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
