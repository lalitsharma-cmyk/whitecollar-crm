"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /** Today's attendance row for the current user, if any. */
  today: { status: "PRESENT" | "LATE" | "ABSENT" | "ON_LEAVE"; markedAt: string } | null;
}

const STATUS_LABEL: Record<string, { emoji: string; label: string; cls: string }> = {
  PRESENT:  { emoji: "✅", label: "Present today",  cls: "border-emerald-500 bg-emerald-50 text-emerald-800" },
  LATE:     { emoji: "🕓", label: "Late today",     cls: "border-amber-500  bg-amber-50  text-amber-800" },
  ABSENT:   { emoji: "❌", label: "Marked absent",  cls: "border-red-500    bg-red-50    text-red-800" },
  ON_LEAVE: { emoji: "🌴", label: "On leave",       cls: "border-blue-500   bg-blue-50   text-blue-800" },
};

/**
 * Small attendance widget on the dashboard. If already marked today (auto-marks
 * on login), shows a chip. Otherwise shows a "Mark me present" button.
 */
export default function AttendanceBadge({ today }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function mark() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/attendance/mark", { method: "POST" });
      if (r.ok) router.refresh();
    } finally { setBusy(false); }
  }

  if (today) {
    const meta = STATUS_LABEL[today.status];
    return (
      <div className={`card p-2 border-l-4 ${meta.cls} text-xs flex items-center gap-2 self-start`}>
        <span className="text-base">{meta.emoji}</span>
        <span className="font-semibold">{meta.label}</span>
      </div>
    );
  }
  return (
    <button
      onClick={mark}
      disabled={busy}
      className="btn btn-primary text-xs justify-center self-start"
      title="Round-robin only assigns new leads to agents who are marked present today"
    >
      {busy ? "Marking…" : "👋 I'm here today — mark me present"}
    </button>
  );
}
