"use client";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export type FilterKind = "search" | "multi" | "budget" | "followup" | "activity" | "enquiry";
interface Opt { value: string; label: string }

const inp = "w-full border border-gray-200 dark:border-slate-600 rounded px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400";
const applyBtn = "text-[11px] font-semibold bg-[#0b1a33] text-white dark:bg-blue-700 px-2.5 py-1 rounded";
const clearBtn = "text-[11px] text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200";

/**
 * Excel-style per-column filter dropdown for the Leads table. Each instance
 * drives the SAME URL search params the server already filters on, so all
 * header filters + the filter panel + search combine with AND automatically.
 * Popover is fixed-positioned so the table's overflow never clips it.
 */
export default function LeadHeaderFilter({
  kind, paramKey, label, options = [], searchParamsStr, showLabel = false,
}: {
  kind: FilterKind;
  paramKey?: string;
  label: string;
  options?: Opt[];
  searchParamsStr: string;
  /** Render a labeled chip ("Project ⏷") instead of just the small icon — for the card-view toolbar. */
  showLabel?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const sp = new URLSearchParams(searchParamsStr);

  const active =
    kind === "search" || kind === "multi" ? !!sp.get(paramKey!) :
    kind === "budget" ? !!(sp.get("budgetFrom") || sp.get("budgetTo")) :
    kind === "followup" ? !!(sp.get("followupFrom") || sp.get("followupTo") || (sp.get("followup") && sp.get("followup") !== "all")) :
    kind === "activity" ? !!(sp.get("dateField") === "lastTouchedAt" && (sp.get("dateFrom") || sp.get("dateTo"))) :
    kind === "enquiry" ? !!(sp.get("dateField") === "createdAt" && (sp.get("dateFrom") || sp.get("dateTo"))) : false;

  function openAt(e: React.MouseEvent) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 240) });
    setOpen(v => !v);
  }
  function apply(mut: (p: URLSearchParams) => void) {
    const p = new URLSearchParams(searchParamsStr);
    mut(p);
    p.delete("page");
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  return (
    <span className="relative inline-flex align-middle" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={openAt}
        title={`Filter ${label}`}
        className={showLabel
          ? `inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-full border whitespace-nowrap transition-colors ${active ? "border-[#c9a24b] text-[#9a7b2e] bg-[#c9a24b]/10 dark:bg-[#c9a24b]/15 dark:border-[#c9a24b] dark:text-[#d9b765]" : "border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-gray-400"}`
          : `ml-0.5 leading-none text-[11px] ${active ? "text-[#c9a24b]" : "text-gray-300 hover:text-gray-500 dark:text-slate-500"}`
        }
      >
        {showLabel ? <span>{label} {active ? "●" : "⏷"}</span> : (active ? "●" : "⏷")}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
          <div
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
            className="w-56 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-2xl p-2 text-left font-normal normal-case tracking-normal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-1.5 px-0.5">{label}</div>
            {kind === "search" && <SearchFilter paramKey={paramKey!} sp={sp} apply={apply} />}
            {kind === "multi" && <MultiFilter paramKey={paramKey!} options={options} sp={sp} apply={apply} />}
            {kind === "budget" && <BudgetFilter sp={sp} apply={apply} />}
            {kind === "followup" && <FollowupFilter sp={sp} apply={apply} />}
            {kind === "activity" && <ActivityFilter sp={sp} apply={apply} />}
            {kind === "enquiry" && <EnquiryFilter sp={sp} apply={apply} />}
          </div>
        </>
      )}
    </span>
  );
}

type ApplyFn = (mut: (p: URLSearchParams) => void) => void;

function Footer({ onClear, onApply }: { onClear: () => void; onApply: () => void }) {
  return (
    <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100 dark:border-slate-700">
      <button type="button" onClick={onClear} className={clearBtn}>Clear</button>
      <button type="button" onClick={onApply} className={applyBtn}>Apply</button>
    </div>
  );
}

function SearchFilter({ paramKey, sp, apply }: { paramKey: string; sp: URLSearchParams; apply: ApplyFn }) {
  const [v, setV] = useState(sp.get(paramKey) ?? "");
  const go = () => apply(p => { const t = v.trim(); t ? p.set(paramKey, t) : p.delete(paramKey); });
  return (
    <div>
      <input autoFocus value={v} onChange={e => setV(e.target.value)} placeholder="Search…"
        onKeyDown={e => { if (e.key === "Enter") go(); }} className={inp} />
      <Footer onClear={() => apply(p => p.delete(paramKey))} onApply={go} />
    </div>
  );
}

function MultiFilter({ paramKey, options, sp, apply }: { paramKey: string; options: Opt[]; sp: URLSearchParams; apply: ApplyFn }) {
  const initial = new Set((sp.get(paramKey) ?? "").split(",").map(s => s.trim()).filter(Boolean));
  const [checked, setChecked] = useState<Set<string>>(initial);
  const [q, setQ] = useState("");
  const [dir, setDir] = useState<"az" | "za">("az");
  const shown = options
    .filter(o => o.label.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => dir === "az" ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label));
  const toggle = (v: string) => setChecked(s => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });
  return (
    <div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className={inp} />
      <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-slate-400 my-1 px-0.5">
        <button type="button" onClick={() => setDir(d => d === "az" ? "za" : "az")} className="hover:text-gray-700 dark:hover:text-slate-200">↕ Sort {dir === "az" ? "A→Z" : "Z→A"}</button>
        <span>{checked.size} selected</span>
      </div>
      <div className="max-h-44 overflow-y-auto space-y-0.5 pr-0.5">
        {shown.map(o => (
          <label key={o.value} className="flex items-center gap-1.5 text-xs cursor-pointer py-0.5 hover:bg-gray-50 dark:hover:bg-slate-700 rounded px-1">
            <input type="checkbox" className="h-3.5 w-3.5 flex-none" checked={checked.has(o.value)} onChange={() => toggle(o.value)} />
            <span className="truncate text-gray-700 dark:text-slate-200">{o.label}</span>
          </label>
        ))}
        {shown.length === 0 && <div className="text-[11px] text-gray-400 italic px-1 py-1">No match</div>}
      </div>
      <Footer
        onClear={() => apply(p => p.delete(paramKey))}
        onApply={() => apply(p => { const v = [...checked].join(","); v ? p.set(paramKey, v) : p.delete(paramKey); })}
      />
    </div>
  );
}

function BudgetFilter({ sp, apply }: { sp: URLSearchParams; apply: ApplyFn }) {
  const [from, setFrom] = useState(sp.get("budgetFrom") ?? "");
  const [to, setTo] = useState(sp.get("budgetTo") ?? "");
  const num = (s: string) => s.replace(/[^\d]/g, "");
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-gray-400 dark:text-slate-500">Min / Max (number)</div>
      <input value={from} onChange={e => setFrom(num(e.target.value))} placeholder="Min e.g. 5000000" inputMode="numeric" className={inp} />
      <input value={to} onChange={e => setTo(num(e.target.value))} placeholder="Max e.g. 30000000" inputMode="numeric" className={inp} />
      <Footer
        onClear={() => apply(p => { p.delete("budgetFrom"); p.delete("budgetTo"); })}
        onApply={() => apply(p => {
          from ? p.set("budgetFrom", from) : p.delete("budgetFrom");
          to ? p.set("budgetTo", to) : p.delete("budgetTo");
        })}
      />
    </div>
  );
}

function FollowupFilter({ sp, apply }: { sp: URLSearchParams; apply: ApplyFn }) {
  const [from, setFrom] = useState(sp.get("followupFrom") ?? "");
  const [to, setTo] = useState(sp.get("followupTo") ?? "");
  const chip = "text-[11px] px-2 py-0.5 rounded-full border border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700";
  const quick = (v: string) => apply(p => { p.delete("followupFrom"); p.delete("followupTo"); p.set("followup", v); });
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1 flex-wrap">
        <button type="button" onClick={() => quick("today")} className={chip}>Today</button>
        <button type="button" onClick={() => quick("overdue")} className={chip}>Overdue</button>
        <button type="button" onClick={() => quick("week")} className={chip}>7 days</button>
      </div>
      <div className="text-[10px] text-gray-400 dark:text-slate-500">Date range</div>
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} />
      <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} />
      <Footer
        onClear={() => apply(p => { p.delete("followupFrom"); p.delete("followupTo"); p.delete("followup"); })}
        onApply={() => apply(p => {
          from ? p.set("followupFrom", from) : p.delete("followupFrom");
          to ? p.set("followupTo", to) : p.delete("followupTo");
          p.delete("followup");
        })}
      />
    </div>
  );
}

function ActivityFilter({ sp, apply }: { sp: URLSearchParams; apply: ApplyFn }) {
  const [from, setFrom] = useState(sp.get("dateField") === "lastTouchedAt" ? (sp.get("dateFrom") ?? "") : "");
  const [to, setTo] = useState(sp.get("dateField") === "lastTouchedAt" ? (sp.get("dateTo") ?? "") : "");
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-gray-400 dark:text-slate-500">Last activity between</div>
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} />
      <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} />
      <Footer
        onClear={() => apply(p => { p.delete("dateFrom"); p.delete("dateTo"); p.delete("dateField"); })}
        onApply={() => apply(p => {
          from ? p.set("dateFrom", from) : p.delete("dateFrom");
          to ? p.set("dateTo", to) : p.delete("dateTo");
          if (from || to) p.set("dateField", "lastTouchedAt"); else p.delete("dateField");
        })}
      />
    </div>
  );
}

function EnquiryFilter({ sp, apply }: { sp: URLSearchParams; apply: ApplyFn }) {
  const isEnquiry = sp.get("dateField") === "createdAt";
  const [from, setFrom] = useState(isEnquiry ? (sp.get("dateFrom") ?? "") : "");
  const [to, setTo] = useState(isEnquiry ? (sp.get("dateTo") ?? "") : "");
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-gray-400 dark:text-slate-500">Enquiry date between</div>
      <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inp} />
      <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inp} />
      <Footer
        onClear={() => apply(p => { p.delete("dateFrom"); p.delete("dateTo"); p.delete("dateField"); })}
        onApply={() => apply(p => {
          from ? p.set("dateFrom", from) : p.delete("dateFrom");
          to ? p.set("dateTo", to) : p.delete("dateTo");
          if (from || to) p.set("dateField", "createdAt"); else p.delete("dateField");
        })}
      />
    </div>
  );
}
