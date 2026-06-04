"use client";
import { missionCheer, REVIVAL_MISSION } from "@/lib/missions";

// Revival Engine — "Today's Mission" panel.
//
// Stays a client component so the progress bar can animate smoothly when
// `count` changes after a router.refresh() (e.g. agent calls a cold lead,
// CallLog is written, page re-renders, prop updates → bar fills).
//
// All counting happens server-side in cold-calls/page.tsx — this just
// renders. Keep it dumb so mission targets can be changed in
// src/lib/missions.ts without touching UI logic.

interface Props {
  /** How many cold contacts the agent has converted to active leads today (Transfer to Lead). */
  count: number;
  /** Daily target (defaults to the missions.ts value). */
  target?: number;
}

export default function DailyRevivalMission({
  count,
  target = REVIVAL_MISSION.dailyCallTarget,
}: Props) {
  const safeTarget = Math.max(1, target);
  const clamped = Math.min(count, safeTarget);
  const pct = Math.round((clamped / safeTarget) * 100);
  const done = count >= safeTarget;
  const cheer = missionCheer(count, safeTarget);

  return (
    <div
      className={`card p-3 sm:p-4 ${done ? "border-emerald-300" : ""}`}
      style={done ? { borderColor: "rgb(110 231 183)" } : undefined}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base">🎯</span>
            <h2 className="text-sm sm:text-base font-bold">Today&apos;s Mission</h2>
          </div>
          <p className="text-[11px] sm:text-xs text-gray-600 mt-0.5">
            Convert {safeTarget} cold contacts to active leads via Transfer to Lead
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-lg sm:text-xl font-bold tabular-nums leading-none">
              {count}
              <span className="text-gray-400 font-normal text-sm">/{safeTarget}</span>
            </div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">converted today</div>
          </div>
          {done && (
            <span className="text-2xl" title="Mission complete">
              🏆
            </span>
          )}
        </div>
      </div>

      {/* Progress bar — soft gold gradient so it feels like treasure, not
          a children's video game. Animates width via CSS transition. */}
      <div
        className="mt-3 h-2.5 w-full rounded-full overflow-hidden"
        style={{ background: "rgba(201, 162, 75, 0.12)" }}
        role="progressbar"
        aria-valuenow={count}
        aria-valuemin={0}
        aria-valuemax={safeTarget}
        aria-label="Daily revival mission progress"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: done
              ? "linear-gradient(90deg, #10b981, #34d399)"
              : "linear-gradient(90deg, #c9a24b, #e7c97a)",
          }}
        />
      </div>

      <div
        className={`mt-2 text-[11px] sm:text-xs font-semibold ${
          done ? "text-emerald-700" : "text-gray-700"
        }`}
      >
        {cheer}
      </div>
    </div>
  );
}
