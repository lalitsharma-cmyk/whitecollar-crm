"use client";
// "I am here" attendance widget — Round 5, Agent T.
//
// Lalit's brief (verbatim):
//   "Put I am here at top. so user knows its attendance."
//
// Mounts at the TOP of /dashboard. Bigger and more visible than the small
// AttendanceBadge — Lalit wants the agent to see their check-in status the
// moment the dashboard loads.
//
// Five states drive the visual:
//   • null       → amber "👋 Mark yourself here" with big green CTA
//   • PRESENT    → green "✅ You're here — checked in at HH:MM IST"
//   • LATE       → amber "⚠️ Here, but late" with cutoff note
//   • ABSENT     → red, with override CTA (re-marks PRESENT via force=true)
//   • ON_LEAVE   → grey, no CTA

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmtISTTime } from "@/lib/datetime";

type AttendanceStatus = "PRESENT" | "LATE" | "ABSENT" | "ON_LEAVE";

interface Props {
  /** Today's attendance row for the current user — null if not yet marked. */
  today: { status: AttendanceStatus; markedAt: string } | null;
  userId: string;
  userName: string;
}

export default function IamHereCard({ today, userName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function mark(force: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/attendance/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      if (r.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // ── State 1: not yet marked today ─────────────────────────────────
  if (!today) {
    return (
      <div className="card p-4 border-l-4 border-amber-500 bg-amber-50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base sm:text-lg font-bold text-amber-900">
              👋 Mark yourself here, {userName.split(" ")[0]}
            </div>
            <div className="text-xs sm:text-sm text-amber-800 mt-0.5">
              Tap below to check in for today.
            </div>
          </div>
          <button
            onClick={() => mark(false)}
            disabled={busy}
            className="btn btn-primary w-full sm:w-auto justify-center min-h-11 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 border-emerald-700 text-white"
          >
            {busy ? "Marking…" : "✅ I'm here"}
          </button>
        </div>
      </div>
    );
  }

  const markedTime = `${fmtISTTime(today.markedAt)} IST`;

  // ── State 2: PRESENT ───────────────────────────────────────────────
  if (today.status === "PRESENT") {
    return (
      <div className="card p-4 border-l-4 border-emerald-500 bg-emerald-50">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-base sm:text-lg font-bold text-emerald-900">
              ✅ You're here — checked in at {markedTime}
            </div>
            <div className="text-[11px] sm:text-xs text-emerald-800/80 mt-0.5">
              You're in today's round-robin for new leads.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── State 3: LATE ──────────────────────────────────────────────────
  if (today.status === "LATE") {
    return (
      <div className="card p-4 border-l-4 border-amber-500 bg-amber-50">
        <div className="min-w-0">
          <div className="text-base sm:text-lg font-bold text-amber-900">
            ⚠️ Here, but late — checked in at {markedTime}
          </div>
          <div className="text-[11px] sm:text-xs text-amber-800 mt-1">
            Office expects PRESENT by 10:30 IST.
          </div>
        </div>
      </div>
    );
  }

  // ── State 4: ABSENT ────────────────────────────────────────────────
  if (today.status === "ABSENT") {
    return (
      <div className="card p-4 border-l-4 border-red-500 bg-red-50">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base sm:text-lg font-bold text-red-900">
              ❌ Marked absent today
            </div>
            <div className="text-xs sm:text-sm text-red-800 mt-0.5">
              Tap to override if you're actually here.
            </div>
          </div>
          <button
            onClick={() => mark(true)}
            disabled={busy}
            className="btn btn-primary w-full sm:w-auto justify-center min-h-11 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 border-emerald-700 text-white"
          >
            {busy ? "Marking…" : "✅ I'm here"}
          </button>
        </div>
      </div>
    );
  }

  // ── State 5: ON_LEAVE ──────────────────────────────────────────────
  return (
    <div className="card p-4 border-l-4 border-gray-400 bg-gray-50">
      <div className="text-base sm:text-lg font-bold text-gray-800">
        🌴 On approved leave today
      </div>
      <div className="text-[11px] sm:text-xs text-gray-600 mt-0.5">
        Enjoy the day off — you're not in today's round-robin.
      </div>
    </div>
  );
}
