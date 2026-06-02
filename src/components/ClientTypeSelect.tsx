"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Lalit ask 2026-06-02 — "Who is client" is a selection, not a free-text
// brain dump. Three real options + one "haven't worked it out yet" slot.
// The long client situation still lives below this in the existing
// `whoIsClient` notes box on the lead detail page.
const OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "",        label: "— not set —", hint: "Pick once you know" },
  { value: "INVESTOR", label: "Investor",    hint: "Buying for yield / flip" },
  { value: "END_USER", label: "End-user",    hint: "Will live in / use it" },
  { value: "BOTH",     label: "Both",        hint: "Mixed motive" },
  { value: "UNCLEAR",  label: "Unclear",     hint: "Need to qualify further" },
];

interface Props {
  leadId: string;
  value: string | null;
}

export default function ClientTypeSelect({ leadId, value }: Props) {
  const router = useRouter();
  const [v, setV] = useState<string>(value ?? "");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function save(next: string) {
    if (busy) return;
    const prev = v;
    setV(next);            // optimistic
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientType: next === "" ? null : next }),
      });
      if (!res.ok) throw new Error("save failed");
      setToast("Saved");
      router.refresh();
      setTimeout(() => setToast(null), 1500);
    } catch {
      setV(prev);          // rollback
      setToast("Failed — try again");
      setTimeout(() => setToast(null), 2000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={v}
        onChange={(e) => save(e.target.value)}
        disabled={busy}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm font-semibold text-gray-800 focus:border-[#c9a24b] focus:outline-none"
      >
        {OPTIONS.map((o) => (
          <option key={o.value || "none"} value={o.value}>{o.label}</option>
        ))}
      </select>
      {OPTIONS.find((o) => o.value === v)?.hint && (
        <span className="text-xs text-gray-500">{OPTIONS.find((o) => o.value === v)?.hint}</span>
      )}
      {toast && <span className="text-xs text-emerald-600">{toast}</span>}
    </div>
  );
}
