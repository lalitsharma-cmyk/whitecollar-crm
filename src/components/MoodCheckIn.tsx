"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Check } from "lucide-react";

type MoodKey = "FRUSTRATING" | "NOT_GREAT" | "MIXED" | "LOOKS_GOOD" | "AWESOME";

const MOODS: { key: MoodKey; emoji: string; label: string; followUp: string }[] = [
  { key: "FRUSTRATING", emoji: "😣", label: "Really Frustrating", followUp: "What went wrong today? (admin sees this)" },
  { key: "NOT_GREAT",   emoji: "🙁", label: "Not Great",          followUp: "What slowed you down?" },
  { key: "MIXED",       emoji: "😐", label: "Mixed Feeling",      followUp: "What's one thing that could have been better?" },
  { key: "LOOKS_GOOD",  emoji: "🙂", label: "Looks Good",         followUp: "Nice — what worked well?" },
  { key: "AWESOME",     emoji: "😍", label: "Awesome",            followUp: "🔥 What was the highlight?" },
];

interface Props {
  /** Today's existing mood (if agent already checked in) — collapses the widget. */
  existing?: { mood: MoodKey; comment: string | null } | null;
}

/**
 * Optional end-of-day check-in. Renders on the dashboard. Agent picks an emoji;
 * we then ask a context-sensitive follow-up question whose phrasing adapts to
 * how they're feeling (more empathetic for low moods, celebratory for high).
 *
 * Submitting is fully optional — agent can dismiss with the ✕ in the corner.
 * One mood per agent per day (DailyMood @@unique [userId, date]).
 */
export default function MoodCheckIn({ existing }: Props) {
  const router = useRouter();
  const [picked, setPicked] = useState<MoodKey | null>(existing?.mood ?? null);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(!!existing);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  async function submit() {
    if (!picked || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/mood", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood: picked, comment: comment.trim() }),
      });
      if (r.ok) {
        setDone(true);
        router.refresh();
      }
    } finally { setBusy(false); }
  }

  const meta = picked ? MOODS.find((m) => m.key === picked) : null;

  // Already submitted today — collapsed "thanks" pill with their emoji
  if (done) {
    return (
      <div className="card p-3 border-l-4 border-emerald-500 bg-emerald-50/40 flex items-center justify-between">
        <div className="text-sm">
          <b>{meta?.emoji} Thanks!</b> <span className="text-gray-600">End-of-day check-in saved. See you tomorrow.</span>
        </div>
        <button onClick={() => setDismissed(true)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
      </div>
    );
  }

  return (
    <div className="card p-4 border-l-4 border-[#c9a24b]">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-sm">🌙 How was your day today?</div>
          <div className="text-[11px] text-gray-500">Optional — only Lalit sees the answer.</div>
        </div>
        <button onClick={() => setDismissed(true)} title="Not today" className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
      </div>

      {/* Emoji picker */}
      <div className="grid grid-cols-5 gap-2 mb-3">
        {MOODS.map((m) => {
          const selected = picked === m.key;
          return (
            <button
              key={m.key}
              onClick={() => setPicked(m.key)}
              className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition ${selected ? "border-[#c9a24b] bg-amber-50" : "border-transparent hover:bg-gray-50"}`}
              title={m.label}
            >
              <span className="text-2xl">{m.emoji}</span>
              <span className="text-[9px] sm:text-[10px] text-gray-700 leading-tight text-center">{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* Follow-up — phrased based on the chosen mood */}
      {meta && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-gray-600">{meta.followUp}</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Optional — type a sentence or leave blank"
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setDismissed(true)} disabled={busy} className="btn btn-ghost text-xs">Skip</button>
            <button onClick={submit} disabled={busy} className="btn btn-primary text-xs">
              {busy ? "Saving…" : <><Check className="w-3 h-3" /> Save</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
