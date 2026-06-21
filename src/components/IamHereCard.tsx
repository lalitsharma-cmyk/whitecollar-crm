"use client";
// "I am here" — agent morning self-check-in (Lalit, 2026-06-20).
//
// Behaviour:
//   • Sits at the VERY TOP of the Agent dashboard (rendered for AGENT/MANAGER).
//   • Shows a big check-in button until the agent taps it.
//   • Once tapped (selfCheckedInAt set) it HIDES for the rest of the day —
//     refresh / re-login won't bring it back (server-stored).
//   • Resets automatically next IST day (attendance row is keyed by IST date).
//   • ON_LEAVE → a small note, no button. ABSENT → tap overrides to PRESENT.

import { useState } from "react";
import { useRouter } from "next/navigation";

type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "ON_LEAVE";

interface Props {
  /** Today's attendance row for the current user — null if no row yet. */
  today: { status: AttendanceStatus; markedAt: string } | null;
  /** True once the agent has tapped "I'm here" today (selfCheckedInAt set). */
  checkedIn: boolean;
  userName: string;
}

export default function IamHereCard({ today, checkedIn, userName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Already checked in today → gone for the day.
  if (checkedIn) return null;

  // On approved leave → nothing to check in.
  if (today?.status === "ON_LEAVE") {
    return (
      <div className="card p-3 border-l-4 border-gray-400 bg-gray-50 dark:bg-slate-800">
        <div className="text-sm font-semibold text-gray-700 dark:text-slate-200">🌴 On approved leave today — enjoy the day off.</div>
      </div>
    );
  }

  const isAbsent = today?.status === "ABSENT";

  async function checkIn() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/attendance/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selfCheckin: true, force: isAbsent }),
      });
      if (r.ok) router.refresh(); // re-renders dashboard → checkedIn true → card hides
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 sm:p-5 border-l-4 border-emerald-500 bg-gradient-to-br from-emerald-50 to-white dark:from-slate-800 dark:to-slate-900 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg sm:text-xl font-bold text-emerald-900 dark:text-emerald-300">
            👋 Good morning, {userName.split(" ")[0]} — mark your attendance
          </div>
          <div className="text-xs sm:text-sm text-emerald-800/80 dark:text-emerald-400/80 mt-0.5">
            {isAbsent
              ? "You're marked absent — tap if you're actually here today."
              : "Tap “I’m here” to check in for today. It only takes one tap."}
          </div>
        </div>
        <button
          onClick={checkIn}
          disabled={busy}
          className="btn w-full sm:w-auto justify-center min-h-12 px-6 text-base font-bold bg-emerald-600 hover:bg-emerald-700 border-emerald-700 text-white shadow disabled:opacity-60"
        >
          {busy ? "Checking in…" : "✅ I’m here"}
        </button>
      </div>
    </div>
  );
}
