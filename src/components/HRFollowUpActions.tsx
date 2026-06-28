"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle, Check, Clock, SkipForward, X } from "lucide-react";

interface Props {
  followUpId: string;
  candidateId: string;
  phone: string | null;
}

type Mode = null | "snooze" | "next" | "skip";

// Quick relative-snooze presets (label → ms from now).
const SNOOZE_PRESETS: { label: string; ms: number }[] = [
  { label: "+1 hour", ms: 60 * 60_000 },
  { label: "+3 hours", ms: 3 * 60 * 60_000 },
  { label: "Tomorrow", ms: 24 * 60 * 60_000 },
  { label: "+3 days", ms: 3 * 24 * 60 * 60_000 },
  { label: "Next week", ms: 7 * 24 * 60 * 60_000 },
];

export default function HRFollowUpActions({ followUpId, candidateId, phone }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [, startT] = useTransition();

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/candidates/${candidateId}/followup`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followUpId, ...body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Action failed");
        return;
      }
      setMode(null);
      startT(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  const markDone = () => post({ action: "complete" });
  const snooze = (ms: number) => post({ action: "snooze", dueAt: new Date(Date.now() + ms).toISOString() });
  const skip = () => post({ action: "skip" });
  const completeWithNext = (ms: number) =>
    post({ action: "complete", nextDueAt: new Date(Date.now() + ms).toISOString() });

  const btn =
    "text-[11px] px-2.5 py-1 rounded-lg border text-center inline-flex items-center justify-center gap-1 disabled:opacity-50";

  // ── Sub-panel: pick a relative time for snooze / next follow-up ─────────────
  if (mode === "snooze" || mode === "next") {
    const apply = mode === "snooze" ? snooze : completeWithNext;
    return (
      <div className="flex flex-col gap-1 shrink-0 w-32">
        <div className="text-[10px] font-medium text-gray-500 flex items-center justify-between">
          {mode === "snooze" ? "Snooze to…" : "Next follow-up…"}
          <button type="button" onClick={() => setMode(null)} className="text-gray-400 hover:text-gray-600">
            <X className="w-3 h-3" />
          </button>
        </div>
        {SNOOZE_PRESETS.map(p => (
          <button key={p.label} type="button" disabled={busy} onClick={() => apply(p.ms)}
            className={`${btn} border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-50`}>
            {p.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 shrink-0">
      {phone && (
        <a href={`tel:${phone}`}
          className={`${btn} border-blue-300 bg-white text-blue-700 hover:bg-blue-50`}>
          <Phone className="w-3 h-3" /> Call
        </a>
      )}
      {phone && (
        <a href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
          className={`${btn} border-green-300 bg-white text-green-700 hover:bg-green-50`}>
          <MessageCircle className="w-3 h-3" /> WA
        </a>
      )}
      <button type="button" disabled={busy} onClick={markDone}
        className={`${btn} border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50`}>
        <Check className="w-3 h-3" /> {busy ? "…" : "Done"}
      </button>
      <button type="button" disabled={busy} onClick={() => setMode("next")}
        className={`${btn} border-teal-300 bg-white text-teal-700 hover:bg-teal-50`}>
        <Check className="w-3 h-3" /> Done + Next
      </button>
      <button type="button" disabled={busy} onClick={() => setMode("snooze")}
        className={`${btn} border-amber-300 bg-white text-amber-700 hover:bg-amber-50`}>
        <Clock className="w-3 h-3" /> Snooze
      </button>
      <button type="button" disabled={busy} onClick={skip}
        className={`${btn} border-gray-300 bg-white text-gray-600 hover:bg-gray-50`}>
        <SkipForward className="w-3 h-3" /> Skip
      </button>
    </div>
  );
}
