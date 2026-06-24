"use client";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ── Reusable client-state Excel-style column header filter ───────────────────
// Used by tables that load their full (scoped) row set CLIENT-SIDE and then
// filter / sort over it in a useMemo — so `count === visible rows` is always
// exact. This is the shared generalization of the inline dropdown Master Data
// grew first; the Buyer Data table now reuses it too. (Note: the Leads table
// uses a SEPARATE, URL-param-driven filter — `LeadHeaderFilter` — because the
// Leads server does the filtering. Two tables, two correct models, one shared
// component for each model.)
//
// Field kinds:
//   "text"    → A→Z / Z→A sort + multi-select (checkbox) value picker w/ search.
//   "number"  → Low→High / High→Low sort + min/max numeric range.
//   "date"    → Oldest→Newest / Newest→Oldest sort + from/to date range.
//   "select"  → like "text" but caller controls the option order (no forced A→Z) —
//               e.g. the canonical Status order.
//
// The popover is rendered through a PORTAL and fixed-positioned from the
// trigger's bounding rect, so a table's `overflow-x-auto` can never clip it.

export type ColKind = "text" | "number" | "date" | "select";

export type ColSortDir = "asc" | "desc";

/** A column's full filter state, owned by the parent table. */
export type ColFilterState = {
  /** Selected discrete values (text/select). Empty = no value filter. */
  values: Set<string>;
  /** Min/max for number, or from/to (yyyy-mm-dd) for date. "" = unbounded. */
  min: string;
  max: string;
};

export const emptyColFilter = (): ColFilterState => ({ values: new Set(), min: "", max: "" });

export const isColFilterActive = (f: ColFilterState | undefined): boolean =>
  !!f && (f.values.size > 0 || f.min.trim() !== "" || f.max.trim() !== "");

const inp =
  "w-full border border-gray-200 dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400";

export default function ColumnHeaderFilter({
  label,
  kind,
  sortActive,
  sortDir,
  onSort,
  filter,
  onApply,
  options = [],
  ascLabel,
  descLabel,
}: {
  label: string;
  kind: ColKind;
  /** Is THIS column the active sort column? */
  sortActive: boolean;
  sortDir: ColSortDir;
  /** Parent sets sort col + direction. */
  onSort: (dir: ColSortDir) => void;
  /** Current filter state for this column (parent-owned). */
  filter: ColFilterState | undefined;
  /** Commit a new filter state (or a cleared one). */
  onApply: (next: ColFilterState) => void;
  /** Distinct values for text/select kinds. */
  options?: string[];
  /** Override sort button copy (defaults chosen per kind). */
  ascLabel?: string;
  descLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = isColFilterActive(filter);

  // Default sort-button labels per field type.
  const asc = ascLabel ?? (kind === "number" ? "↑ Low → High" : kind === "date" ? "↑ Oldest → Newest" : "↑ Sort A → Z");
  const desc = descLabel ?? (kind === "number" ? "↓ High → Low" : kind === "date" ? "↓ Newest → Oldest" : "↓ Sort Z → A");

  function openAt() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 248) });
    setOpen((v) => !v);
  }

  return (
    <span className="relative inline-flex align-middle" onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        onClick={openAt}
        title={`Sort / filter ${label}`}
        className={`ml-0.5 leading-none text-[11px] ${
          active || sortActive ? "text-[#c9a24b]" : "text-gray-300 hover:text-gray-500 dark:text-slate-500"
        }`}
      >
        {sortActive ? (sortDir === "asc" ? "▲" : "▼") : active ? "●" : "⏷"}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
            <div
              style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
              className="w-60 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-2xl text-left font-normal normal-case tracking-normal"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Sort row */}
              <div className="flex border-b border-gray-100 dark:border-slate-700 text-[11px]">
                <button
                  type="button"
                  onClick={() => { onSort("asc"); setOpen(false); }}
                  className={`flex-1 px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700 ${sortActive && sortDir === "asc" ? "text-[#0b1a33] dark:text-blue-300 font-semibold" : "text-gray-600 dark:text-slate-300"}`}
                >
                  {asc}
                </button>
                <button
                  type="button"
                  onClick={() => { onSort("desc"); setOpen(false); }}
                  className={`flex-1 px-2 py-1.5 border-l border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 ${sortActive && sortDir === "desc" ? "text-[#0b1a33] dark:text-blue-300 font-semibold" : "text-gray-600 dark:text-slate-300"}`}
                >
                  {desc}
                </button>
              </div>

              <div className="p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-1.5 px-0.5">
                  Filter {label}
                </div>
                {(kind === "text" || kind === "select") ? (
                  <ValuePicker
                    options={options}
                    ordered={kind === "select"}
                    initial={filter?.values ?? new Set()}
                    onClear={() => { onApply(emptyColFilter()); setOpen(false); }}
                    onApply={(vals) => { onApply({ values: vals, min: "", max: "" }); setOpen(false); }}
                  />
                ) : (
                  <RangePicker
                    kind={kind}
                    initialMin={filter?.min ?? ""}
                    initialMax={filter?.max ?? ""}
                    onClear={() => { onApply(emptyColFilter()); setOpen(false); }}
                    onApply={(min, max) => { onApply({ values: new Set(), min, max }); setOpen(false); }}
                  />
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
    </span>
  );
}

function Footer({ onClear, onApply }: { onClear: () => void; onApply: () => void }) {
  return (
    <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100 dark:border-slate-700">
      <button type="button" onClick={onClear} className="text-[11px] text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200">Clear</button>
      <button type="button" onClick={onApply} className="text-[11px] font-semibold bg-[#0b1a33] text-white dark:bg-blue-700 px-2.5 py-1 rounded">Apply</button>
    </div>
  );
}

function ValuePicker({
  options, ordered, initial, onClear, onApply,
}: {
  options: string[];
  ordered: boolean;
  initial: Set<string>;
  onClear: () => void;
  onApply: (vals: Set<string>) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(initial));
  const [q, setQ] = useState("");
  // "as" keeps the caller's order (the canonical order); A→Z/Z→A still toggleable.
  const [dir, setDir] = useState<"az" | "za" | "as">(ordered ? "as" : "az");

  const shown = useMemo(() => {
    const f = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
    if (dir === "as") return f;
    return [...f].sort((a, b) => (dir === "az" ? a.localeCompare(b, undefined, { numeric: true }) : b.localeCompare(a, undefined, { numeric: true })));
  }, [options, q, dir]);

  const toggle = (v: string) => setChecked((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });

  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={inp} autoFocus />
      <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-slate-400 my-1 px-0.5">
        <button
          type="button"
          onClick={() => setDir((d) => (d === "az" ? "za" : d === "za" ? (ordered ? "as" : "az") : "az"))}
          className="hover:text-gray-700 dark:hover:text-slate-200"
        >
          ↕ {dir === "as" ? "Custom" : dir === "az" ? "A→Z" : "Z→A"}
        </button>
        <span className="flex gap-1.5">
          <button type="button" onClick={() => setChecked(new Set(shown))} className="text-blue-600 dark:text-blue-300 hover:underline">All</button>
          <button type="button" onClick={() => setChecked(new Set())} className="text-blue-600 dark:text-blue-300 hover:underline">None</button>
          <span className="text-gray-400">{checked.size}</span>
        </span>
      </div>
      <div className="max-h-44 overflow-y-auto space-y-0.5 pr-0.5">
        {shown.map((o) => (
          <label key={o} className="flex items-center gap-1.5 text-xs cursor-pointer py-0.5 hover:bg-gray-50 dark:hover:bg-slate-700 rounded px-1">
            <input type="checkbox" className="h-3.5 w-3.5 flex-none" checked={checked.has(o)} onChange={() => toggle(o)} />
            <span className="truncate text-gray-700 dark:text-slate-200">{o}</span>
          </label>
        ))}
        {shown.length === 0 && <div className="text-[11px] text-gray-400 italic px-1 py-1">No values</div>}
      </div>
      <Footer onClear={onClear} onApply={() => onApply(checked)} />
    </div>
  );
}

function RangePicker({
  kind, initialMin, initialMax, onClear, onApply,
}: {
  kind: "number" | "date";
  initialMin: string;
  initialMax: string;
  onClear: () => void;
  onApply: (min: string, max: string) => void;
}) {
  const [min, setMin] = useState(initialMin);
  const [max, setMax] = useState(initialMax);
  const num = (s: string) => s.replace(/[^\d.]/g, "");
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-gray-400 dark:text-slate-500">{kind === "number" ? "Min / Max" : "From / To"}</div>
      {kind === "number" ? (
        <>
          <input value={min} onChange={(e) => setMin(num(e.target.value))} placeholder="Min" inputMode="decimal" className={inp} autoFocus />
          <input value={max} onChange={(e) => setMax(num(e.target.value))} placeholder="Max" inputMode="decimal" className={inp} />
        </>
      ) : (
        <>
          <input type="date" value={min} onChange={(e) => setMin(e.target.value)} className={inp} autoFocus />
          <input type="date" value={max} onChange={(e) => setMax(e.target.value)} className={inp} />
        </>
      )}
      <Footer onClear={onClear} onApply={() => onApply(min.trim(), max.trim())} />
    </div>
  );
}
