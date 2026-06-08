"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  followUpId: string;
  candidateId: string;
  phone: string | null;
}

export default function HRFollowUpActions({ followUpId, candidateId, phone }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startT] = useTransition();

  async function markDone() {
    setBusy(true);
    await fetch(`/api/hr/candidates/${candidateId}/followup`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ followUpId }),
    });
    setBusy(false);
    startT(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-1.5 shrink-0">
      {phone && (
        <a href={`tel:${phone}`}
          className="text-[11px] px-2.5 py-1 rounded-lg border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 text-center">
          📞 Call
        </a>
      )}
      {phone && (
        <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
          className="text-[11px] px-2.5 py-1 rounded-lg border border-green-300 bg-white text-green-700 hover:bg-green-50 text-center">
          💬 WA
        </a>
      )}
      <button type="button" disabled={busy} onClick={markDone}
        className="text-[11px] px-2.5 py-1 rounded-lg border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
        {busy ? "…" : "✔ Done"}
      </button>
    </div>
  );
}
