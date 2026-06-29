// RecruitmentFunnel — the "Recruitment Funnel" panel of the redesigned HR
// dashboard (docs/HR-DASHBOARD-REDESIGN-SPEC.md item 16). It renders the hiring
// pipeline as a stacked column of horizontal stage bars in the canonical order
//   New → Called / Not Called → Interested → Pipeline → Interview Scheduled →
//   Interview Held → Shortlisted → Offer Released → Joined
// so a recruiter can see, top to bottom, how candidates flow (and where they
// fall out) without it ever feeling like a reporting screen.
//
// Each stage shows: a Lucide stage icon, the status label, its count, a
// proportional bar sized off `pct` (share of `total`) and accented with the
// status colour (derived from statusColor in hrStatus.ts so the funnel matches
// the status chips used everywhere else), and the step conversion % vs the
// previous stage — i.e. how many carried forward — rendered in the spec's
// semantic colours (GREEN healthy / AMBER soft drop / RED steep drop).
//
// PRESENTATIONAL ONLY. This is a SERVER component (no "use client"): it fetches
// nothing, queries nothing and computes no business state. Every stage —
// including its count and `pct` — arrives pre-shaped via props; the caller
// decides scope (Junior HR = own candidates only via hrActiveScopeWhere) before
// handing the list down. The step-conversion % is a trivial presentational
// derivation from the counts already in `stages`, not a data fetch.
//
// Colour coding (spec item 3): BLUE = info/neutral — the funnel is an
// informational rollup, so the header reads blue; GREEN/EMERALD = healthy
// (Joined accent + strong step conversion); AMBER = soft fall-off; RED =
// urgent/steep fall-off. Bar accents come from the status colour so they stay in
// lock-step with statusColor()/statusLabel(). Every colour ships a dark: variant
// matching the existing HR card conventions (rounded-2xl card, border,
// dark:bg-slate surfaces). No emoji — Lucide icons only.

import {
  Activity,
  UserPlus,
  Phone,
  CheckCircle2,
  Target,
  Calendar,
  Handshake,
  Inbox,
  TrendingDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { statusColor } from "@/lib/hrStatus";

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  pct: number;
}

export interface RecruitmentFunnelProps {
  stages: FunnelStage[];
  total: number;
}

// Lucide mark per stage. Keyed by the stage `key` (a status key or one of the
// merged funnel buckets, e.g. "CALLED"/"NOT_CALLED", "INTERVIEW_SCHEDULED").
// Falls back to a neutral Activity mark for anything unmapped so the funnel
// never renders an emoji or a blank slot.
function stageIcon(key: string): LucideIcon {
  const k = key.toUpperCase();
  if (k === "NEW") return UserPlus;
  if (k.includes("CALL")) return Phone; // CALLED / NOT_CALLED
  if (k.includes("INTEREST")) return CheckCircle2; // INTERESTED
  if (k === "PIPELINE") return Target;
  if (k.includes("SCHEDUL")) return Calendar; // INTERVIEW_SCHEDULED
  if (k.includes("HELD") || k.includes("INTERVIEW")) return CheckCircle2; // INTERVIEW_HELD
  if (k.includes("SHORTLIST")) return Target; // SHORTLISTED
  if (k.includes("OFFER")) return Handshake; // OFFER_RELEASED
  if (k.includes("JOIN")) return Handshake; // JOINED / EXPECTED_JOINING
  return Activity;
}

// Derive the SOLID bar accent (bg-*) from the status chip classes that
// statusColor() returns ("bg-<family>-100 text-<family>-800"). We promote the
// family to a saturated bar fill so the funnel bars match the chip colours used
// across the CRM without hand-picking a second palette. Ships dark: variants.
function barAccent(statusKey: string): string {
  const chip = statusColor(statusKey); // e.g. "bg-blue-100 text-blue-800"
  const m = chip.match(/bg-([a-z]+)-\d{2,3}/);
  const family = m?.[1] ?? "slate";
  const map: Record<string, string> = {
    blue: "bg-blue-500 dark:bg-blue-400",
    slate: "bg-slate-400 dark:bg-slate-500",
    emerald: "bg-emerald-500 dark:bg-emerald-400",
    indigo: "bg-indigo-500 dark:bg-indigo-400",
    purple: "bg-purple-500 dark:bg-purple-400",
    cyan: "bg-cyan-500 dark:bg-cyan-400",
    rose: "bg-rose-500 dark:bg-rose-400",
    teal: "bg-teal-500 dark:bg-teal-400",
    orange: "bg-orange-500 dark:bg-orange-400",
    amber: "bg-amber-500 dark:bg-amber-400",
    lime: "bg-lime-500 dark:bg-lime-400",
    sky: "bg-sky-500 dark:bg-sky-400",
    green: "bg-green-500 dark:bg-green-400",
    gray: "bg-gray-400 dark:bg-gray-500",
    red: "bg-red-500 dark:bg-red-400",
    pink: "bg-pink-500 dark:bg-pink-400",
  };
  return map[family] ?? "bg-slate-400 dark:bg-slate-500";
}

// Step conversion % vs the previous stage, in the spec's severity colours:
// GREEN healthy carry-forward, AMBER a soft drop, RED a steep drop. The first
// stage has no predecessor so it returns null (no chip rendered).
function stepConversion(
  curr: number,
  prev: number | null,
): { pct: number; classes: string } | null {
  if (prev === null) return null;
  if (prev <= 0) return null;
  const pct = Math.round((curr / prev) * 100);
  // GREEN = healthy (≥60% carried forward), AMBER = soft drop (30–59%),
  // RED = steep drop (<30%). Each ships dark: variants per HR conventions.
  const classes =
    pct >= 60
      ? "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300 dark:border dark:border-green-500/60"
      : pct >= 30
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:border dark:border-amber-500/60"
        : "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300 dark:border dark:border-red-500/60";
  return { pct, classes };
}

export function RecruitmentFunnel({ stages, total }: RecruitmentFunnelProps) {
  return (
    <section
      aria-label="Recruitment Funnel"
      className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Section header — BLUE info accent (spec item 3). */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 shrink-0">
            <Activity className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">
              Recruitment Funnel
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight">
              How candidates flow from New to Joined
            </p>
          </div>
        </div>
        {total > 0 && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:border dark:border-blue-500/60 shrink-0">
            {total} total
          </span>
        )}
      </div>

      {/* Empty state — nothing in the funnel yet. */}
      {stages.length === 0 || total <= 0 ? (
        <div className="px-4 py-10 text-center">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 mb-2">
            <Inbox className="w-5 h-5" />
          </span>
          <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">
            No candidates yet
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            The funnel fills in as candidates are added and worked.
          </p>
        </div>
      ) : (
        <ul className="px-4 py-3 space-y-2.5">
          {stages.map((stage, i) => {
            const Icon = stageIcon(stage.key);
            const accent = barAccent(stage.key);
            // Bar width is the stage's share of the total, clamped to 0–100 and
            // floored to a thin sliver so a non-zero count is always visible.
            const width =
              stage.count > 0 ? Math.max(2, Math.min(100, stage.pct)) : 0;
            const prevCount = i > 0 ? stages[i - 1].count : null;
            const conv = stepConversion(stage.count, prevCount);
            return (
              <li key={stage.key}>
                {/* Label row: icon + label on the left, count + step-conv on the right. */}
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="inline-flex items-center gap-1.5 min-w-0 text-xs font-semibold text-gray-700 dark:text-slate-200">
                    <Icon className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-slate-500" />
                    <span className="truncate">{stage.label}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {conv && (
                      <span
                        className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${conv.classes}`}
                        title={`${conv.pct}% carried forward from the previous stage`}
                      >
                        {conv.pct < 60 && (
                          <TrendingDown className="w-2.5 h-2.5" />
                        )}
                        {conv.pct}%
                      </span>
                    )}
                    <span className="text-xs font-bold tabular-nums text-gray-900 dark:text-white">
                      {stage.count}
                    </span>
                  </span>
                </div>

                {/* Proportional bar — accent derived from statusColor. */}
                <div
                  className="h-2 w-full rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden"
                  role="img"
                  aria-label={`${stage.label}: ${stage.count} candidates, ${stage.pct}% of total`}
                >
                  <div
                    className={`h-full rounded-full ${accent} transition-all`}
                    style={{ width: `${width}%` }}
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

export default RecruitmentFunnel;
