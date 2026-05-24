"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props { leadId: string; initial: boolean; }

/** Toggles isColdCall — used on /cold-calls cards + lead detail. */
export default function ColdCallToggle({ leadId, initial }: Props) {
  const router = useRouter();
  const [cold, setCold] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function flip() {
    if (busy) return;
    const next = !cold;
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isColdCall: next }),
      });
      if (r.ok) {
        setCold(next);
        router.refresh();
      }
    } finally { setBusy(false); }
  }

  return (
    <button
      onClick={flip}
      disabled={busy}
      title={cold ? "Promote back to active lead" : "Move to Cold Calls"}
      className={`text-[10px] px-2 py-1 rounded-full font-semibold whitespace-nowrap ${cold ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-700"}`}
    >
      {cold ? "🧊 Cold" : "⤴ Promote"}
    </button>
  );
}
