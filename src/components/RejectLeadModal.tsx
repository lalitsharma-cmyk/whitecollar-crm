"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { rejectReasonsForTeam } from "@/lib/reject-reasons";

/**
 * Reject Lead — Agent J's clean-room implementation per the spec.
 *
 * Trigger: red "❌ Reject lead" button at the spot the parent page mounts it.
 * Modal: fixed 6-reason dropdown + conditional free-text (required on OTHER).
 * On confirm POSTs to /api/leads/{id}/reject; on 200 we toast, refresh the
 * router cache, and navigate back to /leads so the agent sees the lead
 * disappear from their default view immediately. On error we show the
 * message inline and KEEP the modal open so the agent can retry/correct.
 *
 * Distinct from the older RejectLeadClient (card-style admin section) —
 * this is the modal flow that the spec wires onto the lead detail page.
 */
interface Props {
  leadId: string;
  /** The lead's forwarded team ("Dubai" | "India" | null). Drives team-conditional
   *  reject reasons — e.g. "Expo Only" is offered ONLY for Dubai-team leads. */
  forwardedTeam?: string | null;
}

const NOTE_MAX = 500;

export default function RejectLeadModal({ leadId, forwardedTeam }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("NOT_INTERESTED");
  // Reasons offered for THIS lead's team — Dubai leads additionally get "Expo Only".
  const reasons = rejectReasonsForTeam(forwardedTeam);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useBodyScrollLock(open);

  function close() {
    if (busy) return; // don't let the user lose state mid-request
    setOpen(false);
    setErr(null);
  }

  async function onConfirm() {
    if (busy) return;
    setErr(null);

    if (!note.trim()) {
      setErr("Reject remarks are required — explain why this lead is being rejected.");
      return;
    }
    if (note.length > NOTE_MAX) {
      setErr(`Remarks are too long — max ${NOTE_MAX} characters.`);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          note: note.trim(),
        }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        setErr(data.error ?? `Request failed (${res.status})`);
        return; // keep modal open per spec
      }
      // Success: light-weight toast (no toast lib in the project), refresh
      // the router cache so any cached server data is regenerated, then
      // bounce back to /leads — the rejected lead is now LOST and falls out
      // of the agent's default view, so this is the right next screen.
      if (typeof window !== "undefined") {
        // alert() is the existing project-wide pattern for one-shot toasts.
        // If a toast library lands later, swap this single call.
        // eslint-disable-next-line no-alert
        window.alert("Lead rejected");
      }
      router.refresh();
      router.push("/leads");
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn bg-red-600 hover:bg-red-700 text-white inline-flex items-center gap-2"
        title="Reject this lead — marks it LOST with a structured reason"
      >
        <XCircle className="w-4 h-4" />
        Reject lead
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-modal-title"
        >
          <div
            className="bg-white sm:rounded-xl rounded-t-2xl max-w-md w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="reject-modal-title" className="font-semibold text-lg mb-1 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-600" />
              Reject lead
            </div>
            <p className="text-xs text-gray-500 mb-4">
              The lead will be marked LOST and removed from your default view.
              Admins keep oversight in <span className="font-mono">/admin/rejected-leads</span>.
            </p>

            <label htmlFor="reject-reason" className="text-xs font-semibold text-gray-600">
              Reason <span className="text-red-600">*</span>
            </label>
            <select
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm bg-white"
            >
              {reasons.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>

            {/* Reject remarks — ALWAYS required so we capture WHY the lead is rejected. */}
            <label htmlFor="reject-note" className="text-xs font-semibold text-gray-600">
              Reject Remarks / Reason Details <span className="text-red-600">*</span>
            </label>
            <textarea
              id="reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              rows={3}
              maxLength={NOTE_MAX}
              disabled={busy}
              placeholder="Explain why this lead is being rejected…"
              className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
            />
            <div className="text-[10px] text-gray-400 mt-0.5 text-right">
              {note.length}/{NOTE_MAX}
            </div>

            {err && (
              <div className="text-xs text-red-600 mt-2" role="alert">
                {err}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="btn bg-red-600 hover:bg-red-700 text-white disabled:opacity-60"
              >
                {busy ? "Rejecting…" : "Confirm reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
