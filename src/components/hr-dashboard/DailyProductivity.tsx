// DailyProductivity — the "Daily Productivity" card of the redesigned HR
// dashboard (docs/HR-DASHBOARD-REDESIGN-SPEC.md item 15). It is the compact
// sidebar widget that answers, at a glance, "how many calls have I made today,
// and how many are left?" — Calls Completed, the daily Target, and the Remaining
// gap, fronted by a single progress bar so the recruiter feels the day's pace
// without reading numbers. It deliberately reads like a personal pace meter, not
// a reporting tile.
//
// PRESENTATIONAL ONLY. This is a SERVER component (no "use client"): it fetches
// nothing, queries nothing and computes no business state. Both numbers arrive
// pre-shaped via props — `callsCompleted` and `callsTarget` — and the caller
// decides scope (Junior HR = own calls only via hrActiveScopeWhere; Admin/Senior
// see their own pace) before handing them down. The percentage, the remaining
// count and the "met" flag are trivial presentational derivations from those two
// numbers, not data fetches.
//
// Target is OPTIONAL. When `callsTarget` is null (no daily target set) we drop
// the Target / Remaining split and the bar entirely and simply show the
// completed count — there is nothing to measure progress against, so we don't
// invent a denominator.
//
// Colour coding (spec item 3): GREEN/EMERALD = healthy/positive — when the
// target is met the progress bar, the headline count and the "target met!" note
// all read emerald (the spec calls this out explicitly: "DailyProductivity bar
// when target met"). AMBER = pending/in-progress — while the recruiter is still
// short of target the bar, the headline and the Remaining stat read amber, the
// "keep going" pending colour. BLUE = info/neutral — the section header reads
// blue, since the card itself is an informational pace meter. Every colour ships
// a dark: variant matching the existing HR card conventions (rounded-2xl card,
// border, dark:bg-slate surfaces). No emoji — Lucide icons only.

import { Activity, Phone, Target, CheckCircle2 } from "lucide-react";

export interface DailyProductivityProps {
  callsCompleted: number;
  callsTarget: number | null;
}

export function DailyProductivity({
  callsCompleted,
  callsTarget,
}: DailyProductivityProps) {
  // No target set → show the completed count only (no bar, no remaining): there
  // is no denominator to measure progress against.
  const hasTarget = callsTarget !== null && callsTarget > 0;

  // Derive the pace metrics only when a target exists. `met` drives the
  // GREEN-vs-AMBER colour split called out in spec item 3.
  const remaining = hasTarget ? Math.max(0, callsTarget - callsCompleted) : 0;
  const met = hasTarget && callsCompleted >= callsTarget;
  // Clamp the bar to 0–100; floor a non-zero count to a thin sliver so any
  // progress is always visible, and cap an over-target day at a full bar.
  const pct = hasTarget
    ? Math.min(100, Math.round((callsCompleted / callsTarget) * 100))
    : 0;
  const barWidth = callsCompleted > 0 ? Math.max(2, pct) : 0;

  return (
    <section
      aria-label="Daily Productivity"
      className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Section header — BLUE info accent (spec item 3): this is a pace meter. */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 shrink-0">
            <Activity className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">
              Daily Productivity
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight">
              Calls completed today versus your target
            </p>
          </div>
        </div>
        {/* "target met!" badge — GREEN positive accent (spec item 3). */}
        {met && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border dark:border-emerald-500/60 shrink-0">
            <CheckCircle2 className="w-3 h-3" />
            Target met
          </span>
        )}
      </div>

      <div className="px-4 py-4">
        {/* Headline: calls completed. Emerald once target met, amber while still
            short, slate when there is no target to measure against. */}
        <div className="flex items-baseline gap-2">
          <span
            className={`text-3xl font-bold tabular-nums leading-none ${
              !hasTarget
                ? "text-gray-900 dark:text-white"
                : met
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {callsCompleted}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-slate-400">
            <Phone className="w-3.5 h-3.5 shrink-0" />
            calls completed
          </span>
        </div>

        {hasTarget ? (
          <>
            {/* Progress bar — GREEN when target met, AMBER while in progress. */}
            <div
              className="mt-3 h-2.5 w-full rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden"
              role="img"
              aria-label={`${callsCompleted} of ${callsTarget} calls completed (${pct}%)`}
            >
              <div
                className={`h-full rounded-full transition-all ${
                  met
                    ? "bg-emerald-500 dark:bg-emerald-400"
                    : "bg-amber-500 dark:bg-amber-400"
                }`}
                style={{ width: `${barWidth}%` }}
              />
            </div>

            {/* Target / Remaining split. Target = neutral info; Remaining =
                amber pending while work is left, emerald when nothing remains. */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 dark:border dark:border-blue-500/40 px-3 py-2">
                <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">
                  <Target className="w-3 h-3 shrink-0" />
                  Target
                </p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-gray-900 dark:text-white leading-none">
                  {callsTarget}
                </p>
              </div>
              <div
                className={`rounded-lg px-3 py-2 ${
                  remaining > 0
                    ? "bg-amber-50 dark:bg-amber-900/20 dark:border dark:border-amber-500/40"
                    : "bg-emerald-50 dark:bg-emerald-900/20 dark:border dark:border-emerald-500/40"
                }`}
              >
                <p
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${
                    remaining > 0
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {remaining > 0 ? (
                    <Phone className="w-3 h-3 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                  )}
                  Remaining
                </p>
                <p
                  className={`mt-0.5 text-lg font-bold tabular-nums leading-none ${
                    remaining > 0
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  {remaining}
                </p>
              </div>
            </div>

            {/* One-line pace note under the stats. */}
            <p
              className={`mt-2.5 inline-flex items-center gap-1 text-[11px] font-medium ${
                met
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {met ? (
                <>
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  Daily target met — great work
                </>
              ) : (
                <>
                  <Phone className="w-3 h-3 shrink-0" />
                  {remaining} more {remaining === 1 ? "call" : "calls"} to hit
                  today&apos;s target
                </>
              )}
            </p>
          </>
        ) : (
          // No target set — completed count only, calm neutral note.
          <p className="mt-2 text-[11px] text-gray-500 dark:text-slate-400">
            No daily call target set.
          </p>
        )}
      </div>
    </section>
  );
}

export default DailyProductivity;
