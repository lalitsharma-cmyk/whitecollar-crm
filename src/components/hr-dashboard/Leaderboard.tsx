// Leaderboard — the "Recruiter Leaderboard" sidebar widget of the redesigned HR
// dashboard (docs/HR-DASHBOARD-REDESIGN-SPEC.md item 10). It ranks every
// recruiter by the work that actually moves a hire forward and shows the rich
// per-recruiter metric set the spec calls out by name: Calls Made, Follow-Ups
// Completed, Interviews Scheduled, Interviews Conducted, Offers Released and
// Candidates Joined (NOT just "Added"). The top three are marked with rank
// medals; everyone else is numbered.
//
// PRESENTATIONAL ONLY. This is a SERVER component (no "use client"): it fetches
// nothing, queries nothing and computes no business state. Every recruiter row
// arrives pre-shaped via `rows`, and the PAGE decides whether to render this at
// all — the leaderboard is reports-perm only (perms.reports), so the page gates
// on that and simply doesn't pass us rows when the viewer can't see it. We only
// rank and render.
//
// Ranking (spec item 10): sorted by Candidates Joined desc — the truest outcome
// of recruiting — then Calls Made desc as the activity tie-breaker. This sort is
// a trivial presentational ordering of the props, not a data fetch.
//
// Colour coding (spec item 3): GREEN/EMERALD = healthy/positive — Candidates
// Joined is the positive outcome metric, so its column reads emerald everywhere
// (the spec calls this out explicitly: "Candidates Joined in leaderboard").
// BLUE = info/neutral — the section header reads blue, since the leaderboard is
// an informational roster, not an action queue. The rank medals use the familiar
// gold / silver / bronze accents for the top three. Every colour ships a dark:
// variant matching the existing HR card conventions (rounded-2xl card, border,
// dark:bg-slate surfaces). No emoji — Lucide icons only.

import {
  Trophy,
  Award,
  Medal,
  Phone,
  CheckCircle2,
  Calendar,
  Handshake,
  UserCheck,
  Activity,
  Inbox,
} from "lucide-react";

export interface LeaderboardRow {
  userId: string;
  name: string;
  calls: number;
  followUpsCompleted: number;
  interviewsScheduled: number;
  interviewsConducted: number;
  offersReleased: number;
  joined: number;
}

export interface LeaderboardProps {
  rows: LeaderboardRow[];
  periodLabel: string;
}

// Rank medal accents for the top three. Gold / silver / bronze, each with a
// dark: variant matching the existing HR card conventions; everyone else is a
// plain numbered slate chip.
const MEDAL: Record<number, { ring: string; icon: typeof Trophy }> = {
  0: {
    ring: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 dark:border dark:border-amber-500/60",
    icon: Trophy,
  },
  1: {
    ring: "bg-slate-200 text-slate-600 dark:bg-slate-700/60 dark:text-slate-200 dark:border dark:border-slate-500/60",
    icon: Award,
  },
  2: {
    ring: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 dark:border dark:border-orange-500/60",
    icon: Medal,
  },
};

// One compact metric cell. The Candidates Joined column reads EMERALD (positive
// outcome, spec item 3); every other metric is calm neutral so Joined stands
// out as the metric that matters most.
function Metric({
  icon: Icon,
  label,
  value,
  positive = false,
}: {
  icon: typeof Phone;
  label: string;
  value: number;
  positive?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${
          positive
            ? "text-emerald-600 dark:text-emerald-300"
            : "text-gray-400 dark:text-slate-500"
        }`}
      >
        <Icon className="w-3 h-3 shrink-0" />
        <span className="truncate">{label}</span>
      </p>
      <p
        className={`mt-0.5 text-base font-bold tabular-nums leading-none ${
          positive
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-gray-900 dark:text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function Leaderboard({ rows, periodLabel }: LeaderboardProps) {
  // Spec item 10 ranking: Candidates Joined desc, then Calls Made desc as the
  // activity tie-breaker. Copy before sorting so we never mutate the caller's
  // array. Trivial presentational ordering — no business logic.
  const ranked = [...rows].sort(
    (a, b) => b.joined - a.joined || b.calls - a.calls,
  );

  return (
    <section
      aria-label="Recruiter Leaderboard"
      className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Section header — BLUE info accent (spec item 3): an informational roster. */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 shrink-0">
            <Trophy className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">
              Recruiter Leaderboard
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight truncate">
              {periodLabel}
            </p>
          </div>
        </div>
        {ranked.length > 0 && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300 shrink-0">
            {ranked.length}
          </span>
        )}
      </div>

      {/* Empty state — calm neutral: no activity yet is not a backlog. */}
      {ranked.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 mb-2">
            <Inbox className="w-5 h-5" />
          </span>
          <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">
            No recruiter activity yet
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            Calls, follow-ups, interviews and joinings will rank here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-800">
          {ranked.map((r, i) => {
            const medal = MEDAL[i];
            const RankIcon = medal?.icon;
            return (
              <li
                key={r.userId}
                className="px-4 py-3 hover:bg-gray-50/70 dark:hover:bg-slate-800/40 transition-colors"
              >
                {/* ── Rank + recruiter name ── */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold tabular-nums shrink-0 ${
                      medal
                        ? medal.ring
                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                    title={`Rank ${i + 1}`}
                  >
                    {RankIcon ? <RankIcon className="w-3.5 h-3.5" /> : i + 1}
                  </span>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate min-w-0 flex-1">
                    {r.name}
                  </p>
                </div>

                {/* ── Rich per-recruiter metrics (spec item 10) ── */}
                <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2.5 pl-9">
                  <Metric icon={Phone} label="Calls" value={r.calls} />
                  <Metric
                    icon={CheckCircle2}
                    label="Follow-Ups"
                    value={r.followUpsCompleted}
                  />
                  <Metric
                    icon={Calendar}
                    label="Int. Sched."
                    value={r.interviewsScheduled}
                  />
                  <Metric
                    icon={Activity}
                    label="Int. Held"
                    value={r.interviewsConducted}
                  />
                  <Metric
                    icon={Handshake}
                    label="Offers"
                    value={r.offersReleased}
                  />
                  {/* Candidates Joined — EMERALD positive outcome (spec item 3). */}
                  <Metric
                    icon={UserCheck}
                    label="Joined"
                    value={r.joined}
                    positive
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default Leaderboard;
