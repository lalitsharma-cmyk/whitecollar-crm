import { LEAD_SOURCE_MODULES, type SourceModule } from "@/lib/moduleSource";

// ─────────────────────────────────────────────────────────────────────────
// SHARED per-module breakdown renderer (Lalit 2026-07-06).
//
// The canonical source_module bifurcation — Leads · Master Data · Revival
// Engine — rendered as a compact, additive mini-table. Every report that has a
// per-lead metric uses THIS one component so the 3-way split looks and behaves
// identically everywhere (same as the Agent Lead Performance breakdown).
//
// It is READ-ONLY and ADDITIVE: the caller keeps its existing flat totals; this
// only visualises how a total decomposes across the 3 lead-origin modules. By
// construction every lead classifies into exactly ONE module (leadSourceModule),
// so each row's Total column equals Leads + Master Data + Revival. The component
// itself asserts nothing about the DB — it just renders the numbers it is given.
//
// NOTE: this covers only the 3 LEAD modules. Buyer Data is a separate parallel
// concern (its own report) and is never mixed in here.
// ─────────────────────────────────────────────────────────────────────────

/** A single metric split across the 3 lead modules. `total` is optional — when
 *  omitted it is computed as the sum of the module parts (they are equal by
 *  construction; pass an explicit total only if you want the flat figure shown
 *  verbatim to prove reconciliation). */
export interface ModuleBreakdownRow {
  label: string;
  counts: Partial<Record<SourceModule, number>>;
  total?: number;
}

const MODULE_ACCENT: Record<SourceModule, string> = {
  "Leads": "text-blue-700",
  "Master Data": "text-indigo-700",
  "Revival Engine": "text-amber-700",
  "Dubai Buyer Data": "text-gray-500",
  "India Buyer Data": "text-gray-500",
};

function num(n: number): string {
  return n.toLocaleString("en-IN");
}

/** Sum the 3 lead-module parts of a counts record. */
function tripleTotal(counts: Partial<Record<SourceModule, number>>): number {
  return LEAD_SOURCE_MODULES.reduce((s, mod) => s + (counts[mod] ?? 0), 0);
}

/**
 * Inline mini-table: one row per metric, columns = Leads · Master Data · Revival
 * · Total. Rows whose total is 0 are hidden (unless `showZeroRows`) to keep the
 * block tight. `minWidth` lets a caller keep it from collapsing inside a
 * horizontally-scrolling card.
 */
export function ModuleBreakdownTable({
  rows,
  showZeroRows = false,
  minWidth = 440,
  metricHeader = "Metric",
}: {
  rows: ModuleBreakdownRow[];
  showZeroRows?: boolean;
  minWidth?: number;
  metricHeader?: string;
}) {
  const visible = showZeroRows ? rows : rows.filter((r) => (r.total ?? tripleTotal(r.counts)) !== 0);
  if (visible.length === 0) {
    return <div className="text-[11px] text-gray-400 italic py-1">No lead activity to break down for this period.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-[11px]" style={{ minWidth }}>
        <thead>
          <tr className="text-gray-400">
            <th className="text-left font-medium pr-4 pb-1">{metricHeader}</th>
            {LEAD_SOURCE_MODULES.map((mod) => (
              <th key={mod} className={`text-right font-semibold px-3 pb-1 ${MODULE_ACCENT[mod]}`}>{mod}</th>
            ))}
            <th className="text-right font-semibold px-3 pb-1 text-gray-600">Total</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => {
            const total = r.total ?? tripleTotal(r.counts);
            return (
              <tr key={r.label} className="border-t border-gray-100">
                <td className="text-left text-gray-600 pr-4 py-0.5">{r.label}</td>
                {LEAD_SOURCE_MODULES.map((mod) => {
                  const v = r.counts[mod] ?? 0;
                  return (
                    <td key={mod} className={`text-right px-3 tabular-nums ${v ? MODULE_ACCENT[mod] : "text-gray-300"}`}>
                      {num(v)}
                    </td>
                  );
                })}
                <td className="text-right px-3 tabular-nums font-semibold text-gray-700">{num(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Collapsible wrapper around ModuleBreakdownTable — pure HTML <details>, no
 * client JS. Use where the breakdown should stay tucked away until the reader
 * expands it (matches the Agent Performance per-row breakdown affordance).
 */
export function ModuleBreakdownDetails({
  rows,
  summary = "Module breakdown (Leads · Master Data · Revival)",
  showZeroRows = false,
  minWidth = 440,
  metricHeader = "Metric",
}: {
  rows: ModuleBreakdownRow[];
  summary?: string;
  showZeroRows?: boolean;
  minWidth?: number;
  metricHeader?: string;
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-[11px] text-gray-500 py-1.5 select-none hover:text-gray-700">
        <span className="group-open:hidden">▸ {summary}</span>
        <span className="hidden group-open:inline">▾ {summary}</span>
      </summary>
      <div className="pb-2 pt-1">
        <ModuleBreakdownTable rows={rows} showZeroRows={showZeroRows} minWidth={minWidth} metricHeader={metricHeader} />
      </div>
    </details>
  );
}
