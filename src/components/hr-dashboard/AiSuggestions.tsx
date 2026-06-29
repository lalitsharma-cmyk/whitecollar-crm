// AiSuggestions — the "AI Recruiter Assistant" widget of the redesigned HR
// dashboard (docs/HR-DASHBOARD-REDESIGN-SPEC.md item 14). It is rule-based, with
// NO LLM dependency: page.tsx computes a small list of plain-language nudges
// ("Call X first (high priority)", "Y likely to ghost", "Z waiting 2 days",
// "salary discussion pending", "confirmation overdue") and hands them down here
// fully shaped. This component ONLY renders + color-codes them by severity — it
// holds no rules, no thresholds and no business logic of its own.
//
// PRESENTATIONAL ONLY. This is a SERVER component (no "use client"): it fetches
// nothing, queries nothing and computes no state. Every suggestion arrives
// pre-computed via `suggestions`, and the caller decides scope (Junior HR = own
// candidates only via hrActiveScopeWhere; Admin/Senior = all) BEFORE building the
// list — we never widen what we're shown. Each suggestion's `href` deep-links to
// the relevant filtered list / queue anchor so one tap takes the recruiter
// straight to the work.
//
// Color coding (spec item 3) is driven entirely by `severity`:
//   🔴 RED   = high   — urgent / overdue (AlertTriangle): "call first", "confirmation overdue"
//   🟠 AMBER = medium — pending / waiting (Clock): "likely to ghost", "waiting 2 days"
//   🔵 BLUE  = info   — neutral nudge (Info): "salary discussion pending", general tips
// Each severity ships a left-border accent (border-l-4), a tinted icon tile, an
// affected-count chip and a "View →" CTA in the matching hue. The empty state is
// the GREEN / healthy "all caught up" pattern shared with the other HR queues.
//
// Every colour ships a dark: variant (bg-X-50 / dark:bg-X-900/20, text-X-700 /
// dark:text-X-300, border-X-400 / dark:border-X-500/60) matching the existing HR
// card conventions (rounded-2xl card, border, dark:bg-slate surfaces). No emoji —
// Lucide icons only (Sparkles header, AlertTriangle / Clock / Info per severity,
// CheckCircle2 empty state, ArrowUpRight CTA).

import Link from "next/link";
import {
  Sparkles,
  AlertTriangle,
  Clock,
  Info,
  CheckCircle2,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";

export type SuggestionSeverity = "high" | "medium" | "info";

export interface AiSuggestion {
  id: string;
  severity: SuggestionSeverity;
  message: string;
  count: number;
  href: string;
}

export interface AiSuggestionsProps {
  suggestions: AiSuggestion[];
}

// Fixed icon + semantic colour per severity (spec item 3). Each ships light +
// dark variants. `accent` is the card's left border + tinted icon tile + count
// chip; `cta` is the matching-hue "View →" link colour.
const SEVERITY_VISUAL: Record<
  SuggestionSeverity,
  {
    Icon: LucideIcon;
    /** Left-border accent + card wash. */
    card: string;
    /** Tinted square icon tile. */
    iconTile: string;
    /** Affected-count chip. */
    chip: string;
    /** "View →" CTA link colour. */
    cta: string;
    /** Accessible severity label (also the icon tile title). */
    label: string;
  }
> = {
  // RED — high / urgent.
  high: {
    Icon: AlertTriangle,
    card: "border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-500/60",
    iconTile:
      "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300",
    chip: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    cta: "text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200",
    label: "High priority",
  },
  // AMBER — medium / pending.
  medium: {
    Icon: Clock,
    card: "border-amber-400 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-500/60",
    iconTile:
      "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    cta: "text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200",
    label: "Pending",
  },
  // BLUE — info / neutral nudge.
  info: {
    Icon: Info,
    card: "border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-500/60",
    iconTile:
      "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300",
    chip: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    cta: "text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-200",
    label: "Info",
  },
};

// Stable severity order so high-priority nudges always surface first regardless
// of the order page.tsx happened to build the list in.
const SEVERITY_RANK: Record<SuggestionSeverity, number> = {
  high: 0,
  medium: 1,
  info: 2,
};

// Human "N candidates" affected-count label.
function affectedLabel(count: number): string {
  return count === 1 ? "1 candidate" : `${count} candidates`;
}

export function AiSuggestions({ suggestions }: AiSuggestionsProps) {
  const ordered = [...suggestions].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );

  return (
    <section
      aria-label="AI Recruiter Assistant"
      className="rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Section header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300 shrink-0">
            <Sparkles className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white leading-tight truncate">
              AI Recruiter Assistant
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-slate-400 leading-tight">
              Smart nudges on who needs attention next
            </p>
          </div>
        </div>
        {ordered.length > 0 && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300 shrink-0">
            {ordered.length}
          </span>
        )}
      </div>

      {/* Empty state — nothing to flag (GREEN / healthy per spec item 3). */}
      {ordered.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 mb-2">
            <CheckCircle2 className="w-5 h-5" />
          </span>
          <p className="text-sm font-semibold text-gray-700 dark:text-slate-200">
            All caught up
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            No suggestions right now — nothing needs your attention.
          </p>
        </div>
      ) : (
        <ul className="p-3 space-y-2">
          {ordered.map((s) => {
            const v = SEVERITY_VISUAL[s.severity];
            const Icon = v.Icon;
            return (
              <li key={s.id}>
                <div
                  className={`rounded-xl border-l-4 ${v.card} p-3 transition hover:shadow-md`}
                >
                  <div className="flex items-start gap-3">
                    {/* Severity icon tile */}
                    <span
                      className={`inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${v.iconTile}`}
                      title={v.label}
                      aria-label={v.label}
                    >
                      <Icon className="w-4 h-4" />
                    </span>

                    {/* Message + affected count + CTA */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug">
                        {s.message}
                      </p>
                      <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${v.chip}`}
                        >
                          {affectedLabel(s.count)}
                        </span>
                        <Link
                          href={s.href}
                          className={`inline-flex items-center gap-1 text-xs font-semibold transition-colors ${v.cta}`}
                        >
                          View
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default AiSuggestions;
