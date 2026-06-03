"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import DateTimeIST from "./DateTimeIST";
import { isPastISTLocalInput } from "@/lib/datetime";

interface Props {
  leadId: string;
  field: string;
  title: string;       // modal header: "Set Follow-up"
  label: string;       // tile label: "🔁 Follow-up"
  value: string;       // "YYYY-MM-DDTHH:mm" or ""
  placeholder?: string;
  variant?: "primary" | "default";
}

/** "2026-06-08T13:00" → "08 Jun 2026, 1:00 PM IST" */
function fmtDisplay(iso: string): string {
  if (!iso) return "";
  const [datePart = "", timePart = "00:00"] = iso.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h24 = 0, min = 0] = timePart.split(":").map(Number);
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${String(d).padStart(2,"0")} ${months[(mo ?? 1) - 1]} ${y}, ${h12}:${String(min).padStart(2,"0")} ${ampm} IST`;
}

export default function SchedulingField({
  leadId, field, title, label, value, placeholder = "Not scheduled", variant = "default",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isPrimary = variant === "primary";
  const tileClass = isPrimary
    ? "p-3 border border-emerald-200 rounded-lg bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors select-none"
    : "p-3 border border-[#e5e7eb] dark:border-slate-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors select-none";
  const labelClass = isPrimary
    ? "text-xs text-emerald-700 dark:text-emerald-400 font-semibold"
    : "text-xs text-gray-500 dark:text-slate-400";

  function openModal() {
    setDraft(value);
    setErr(null);
    setOpen(true);
  }

  async function save() {
    if (busy) return;
    if (draft && isPastISTLocalInput(draft)) {
      setErr("Pick a future date/time (IST).");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload = draft ? `${draft}:00+05:30` : null;
      const r = await fetch(`/api/leads/${leadId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: payload }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        setErr(j.error ?? "Save failed");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setDraft(value);
    setErr(null);
    setOpen(false);
  }

  const displayed = value ? fmtDisplay(value) : null;

  return (
    <>
      {/* ── Tile (read-only) ──────────────────────────────────────────── */}
      <div onClick={openModal} className={tileClass}>
        <div className={labelClass}>{label}</div>
        <div className="mt-0.5 text-sm font-medium text-gray-800 dark:text-slate-200 truncate">
          {displayed ?? (
            <span className="text-gray-400 dark:text-slate-500 italic font-normal">{placeholder}</span>
          )}
          <span className="text-[10px] text-gray-400 ml-1">✎</span>
        </div>
      </div>

      {/* ── Modal / bottom-sheet ──────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50" aria-hidden />

          {/* Sheet */}
          <div className="relative bg-white dark:bg-slate-800 w-full sm:w-[360px] rounded-t-2xl sm:rounded-2xl shadow-2xl z-10 overflow-hidden">
            {/* Drag handle (mobile only) */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-9 h-1 rounded-full bg-gray-300 dark:bg-slate-600" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 rounded-full p-1.5 -mr-1 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Picker */}
            <div className="px-5 pb-2">
              <DateTimeIST value={draft} onChange={setDraft} futureOnly />
              {err && <p className="text-xs text-red-600 mt-2">⚠ {err}</p>}
            </div>

            {/* Actions — sticky footer */}
            <div className="flex gap-3 px-5 py-4 bg-gray-50 dark:bg-slate-900/60 border-t border-gray-100 dark:border-slate-700">
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="btn btn-primary flex-1 justify-center"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={close}
                className="btn btn-ghost flex-1 justify-center"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
