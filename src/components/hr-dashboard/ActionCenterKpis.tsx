// ActionCenterKpis — the Top Action Center for the HR dashboard.
//
// Renders the 8 deduped, color-coded, clickable KPI tiles (New Candidates,
// Calls Due Today, Overdue Follow-Ups, Interviews Today, Pending Confirmations,
// No-Shows, Expected Joinings, No Next Action). This ONE strip replaces BOTH the
// old `specCards` "today at a glance" row AND the old `metrics` border-l-4 bar —
// they are merged here so there are no duplicate KPIs anywhere (spec items 1, 3,
// 13).
//
// PRESENTATIONAL ONLY. All counts + hrefs arrive via props; this component never
// fetches or queries. The icon + semantic color for each tile is derived
// internally from its `kind` so the same KPI always looks identical:
//   🔵 BLUE   = info / neutral   (New Candidates, No Next Action = slate low-signal)
//   🟠 AMBER  = pending / waiting (Calls Due Today, Pending Confirmations)
//   🔴 RED    = urgent / overdue  (Overdue Follow-Ups; No-Shows = rose)
//   🟢 GREEN  = healthy / positive (Expected Joinings)
//   🔵 INDIGO = info variant       (Interviews Today)
// Every tile is an <a href> to a filtered list / in-page anchor (spec item 3).
//
// No emoji — Lucide icons only. Dark: variants ship on every colour, matching the
// existing HR card conventions (bg-X-50 / dark:bg-X-900/20, border-X-500/60).

import {
  UserPlus,
  Phone,
  AlertTriangle,
  Target,
  CheckCircle2,
  Ban,
  Handshake,
  Inbox,
  type LucideIcon,
} from "lucide-react";

export type HrKpiKind =
  | "new"
  | "callsDue"
  | "overdue"
  | "interviewsToday"
  | "pendingConfirm"
  | "noShow"
  | "expectedJoin"
  | "noNextAction";

export interface HrKpiTile {
  kind: HrKpiKind;
  label: string;
  count: number;
  href: string;
}

export interface ActionCenterKpisProps {
  tiles: HrKpiTile[];
}

// Fixed icon + semantic colour per KPI kind (spec item 3). Colours follow the
// four-bucket severity system; each ships light + dark variants. The accent is a
// left border (border-l-4) so the strip reads as a row of severity-tagged cards.
const KPI_VISUAL: Record<
  HrKpiKind,
  { Icon: LucideIcon; classes: string }
> = {
  // BLUE — info / neutral
  new: {
    Icon: UserPlus,
    classes:
      "border-blue-400 text-blue-700 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-500/60",
  },
  // AMBER — pending / waiting
  callsDue: {
    Icon: Phone,
    classes:
      "border-amber-400 text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-500/60",
  },
  // RED — urgent / overdue
  overdue: {
    Icon: AlertTriangle,
    classes:
      "border-red-400 text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300 dark:border-red-500/60",
  },
  // INDIGO — info variant
  interviewsToday: {
    Icon: Target,
    classes:
      "border-indigo-400 text-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-500/60",
  },
  // ORANGE — pending / waiting
  pendingConfirm: {
    Icon: CheckCircle2,
    classes:
      "border-orange-400 text-orange-700 bg-orange-50 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-500/60",
  },
  // ROSE — urgent (no-show accent)
  noShow: {
    Icon: Ban,
    classes:
      "border-rose-500 text-rose-700 bg-rose-50 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-500/60",
  },
  // GREEN — healthy / positive
  expectedJoin: {
    Icon: Handshake,
    classes:
      "border-green-400 text-green-700 bg-green-50 dark:bg-green-900/20 dark:text-green-300 dark:border-green-500/60",
  },
  // SLATE — low-signal info
  noNextAction: {
    Icon: Inbox,
    classes:
      "border-slate-400 text-slate-700 bg-slate-50 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-600",
  },
};

export function ActionCenterKpis({ tiles }: ActionCenterKpisProps) {
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 mb-4"
      aria-label="Action Center"
    >
      {tiles.map((t) => {
        const { Icon, classes } = KPI_VISUAL[t.kind];
        return (
          <a
            key={t.kind}
            href={t.href}
            className={`rounded-xl border-l-4 ${classes} p-3 hover:shadow-md transition`}
          >
            <div className="text-2xl font-extrabold text-gray-800 dark:text-white leading-none">
              {t.count}
            </div>
            <div className="text-[10px] text-gray-600 dark:text-slate-300 mt-1 flex items-center gap-1">
              <Icon className="w-3 h-3 shrink-0" />
              <span className="truncate">{t.label}</span>
            </div>
          </a>
        );
      })}
    </div>
  );
}

export default ActionCenterKpis;
