"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { EXCEL_STATUSES, BUDGET_PRESETS } from "@/lib/lead-statuses";

// ─── Label maps ────────────────────────────────────────────────────────────────
const SRC_LABELS: Record<string, string> = {
  WEBSITE: "Website", WHATSAPP: "WhatsApp", CSV_IMPORT: "CSV Import",
  EVENT: "Event", REFERRAL: "Referral", INBOUND_CALL: "Inbound Call",
  FACEBOOK_ADS: "Facebook Ads", GOOGLE_ADS: "Google Ads",
  PORTAL_99ACRES: "99Acres", PORTAL_MAGICBRICKS: "MagicBricks",
  PORTAL_HOUSING: "Housing.com", OTHER: "Other",
};
const FOLLOWUP_LABELS: Record<string, string> = {
  today: "Follow-up: Today", tomorrow: "Follow-up: Tomorrow",
  week: "Follow-up: This week", month: "Follow-up: This month",
  overdue: "Follow-up: Overdue",
};
const POTENTIAL_LABELS: Record<string, string> = {
  HIGH: "🔥 High", MEDIUM: "🌤 Medium", LOW: "❄ Low", UNKNOWN: "— Unknown",
};
const FUND_LABELS: Record<string, string> = {
  IMMEDIATE_BUYER: "Immediate Buyer", SHORT_TERM_BUYER: "Short-Term Buyer",
  CONDITIONAL_BUYER: "Conditional Buyer", FINANCED_BUYER: "Financed Buyer",
  FUTURE_BUYER: "Future Buyer",
};
const CLIENT_LABELS: Record<string, string> = {
  INVESTOR: "Investor", END_USER: "End User", BOTH: "Investor + End User", UNCLEAR: "Unclear",
};
const WHEN_LABELS: Record<string, string> = {
  IMMEDIATE: "⚡ Immediate", THIRTY_DAYS: "📅 Within 1 Month",
  THREE_MONTHS: "✈ Visit Dubai First", SIX_PLUS_MONTHS: "⏳ Not in 6 Months",
  WINDOW_SHOPPING: "📆 Window Shopping",
};

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Props {
  agents: { id: string; name: string }[];
  sources: string[];
  statuses: string[];
  showSource?: boolean;
  distinctTags?: string[];
  projects?: { id: string; name: string }[];
}

// ─── Helper: toggle a value in a Set, return new Set ──────────────────────────
function toggleSet(s: Set<string>, v: string): Set<string> {
  const next = new Set(s);
  if (next.has(v)) next.delete(v); else next.add(v);
  return next;
}

// ─── Multi-select cell component ──────────────────────────────────────────────
function MultiCell({
  label, options, selected, onChange, searchable = false,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  searchable?: boolean;
}) {
  const [q, setQ] = useState("");
  const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div className="flex flex-col min-h-0">
      <div className="text-[11px] font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">{label}</div>
      {searchable && options.length > 8 && (
        <input
          type="search"
          placeholder="Search…"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="mb-1 px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      )}
      <div className="overflow-y-auto space-y-0.5 pr-0.5" style={{ maxHeight: 148 }}>
        {filtered.map(o => (
          <label key={o.value} className="flex items-center gap-1.5 cursor-pointer group">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-gray-300 dark:border-slate-500 text-[#0b1a33] focus:ring-[#0b1a33] cursor-pointer flex-none"
              checked={selected.has(o.value)}
              onChange={() => onChange(toggleSet(selected, o.value))}
            />
            <span className="text-xs text-gray-700 dark:text-slate-200 truncate group-hover:text-[#0b1a33] dark:group-hover:text-blue-300 leading-tight">{o.label}</span>
          </label>
        ))}
        {filtered.length === 0 && <span className="text-xs text-gray-400">No match</span>}
      </div>
      {selected.size > 0 && (
        <button
          type="button"
          onClick={() => onChange(new Set())}
          className="mt-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline text-left"
        >
          Clear {selected.size} selected
        </button>
      )}
    </div>
  );
}

// ─── Radio cell component ──────────────────────────────────────────────────────
function RadioCell({
  label, options, value, onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col min-h-0">
      <div className="text-[11px] font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">{label}</div>
      <div className="overflow-y-auto space-y-0.5" style={{ maxHeight: 148 }}>
        {options.map(o => (
          <label key={o.value} className="flex items-center gap-1.5 cursor-pointer group">
            <input
              type="radio"
              className="h-3.5 w-3.5 border-gray-300 dark:border-slate-500 text-[#0b1a33] focus:ring-[#0b1a33] cursor-pointer flex-none"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              name={label}
            />
            <span className="text-xs text-gray-700 dark:text-slate-200 truncate group-hover:text-[#0b1a33] dark:group-hover:text-blue-300 leading-tight">{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function LeadFilters({
  agents, sources, statuses, showSource = true, distinctTags = [], projects = [],
}: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const sp       = useSearchParams();
  const panelRef = useRef<HTMLDivElement>(null);

  // Search input (debounced directly into URL)
  const [q, setQ] = useState(sp.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") === q) return;
      const p = new URLSearchParams(sp);
      if (q) p.set("q", q); else p.delete("q");
      p.delete("page");
      router.replace(`${pathname}?${p.toString()}`);
    }, 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Panel open state
  const [open, setOpen] = useState(false);

  // ── Multi-select draft state ─────────────────────────────────────────────────
  const [projectSel,  setProjectSel]  = useState<Set<string>>(new Set());
  const [cstatusSel,  setCstatusSel]  = useState<Set<string>>(new Set());
  const [sourceSel,   setSourceSel]   = useState<Set<string>>(new Set());

  // ── Single-select draft state ────────────────────────────────────────────────
  const [draftTeam,        setDraftTeam]        = useState("");
  const [draftOwner,       setDraftOwner]        = useState("");
  const [draftBudgetPreset,setDraftBudgetPreset] = useState("");
  const [draftPotential,   setDraftPotential]    = useState("");
  const [draftFundReady,   setDraftFundReady]    = useState("");
  const [draftClientType,  setDraftClientType]   = useState("");
  const [draftWhenInvest,  setDraftWhenInvest]   = useState("");
  const [draftFollowup,    setDraftFollowup]     = useState("");
  const [draftNotPicked,   setDraftNotPicked]    = useState("");
  const [draftSort,        setDraftSort]         = useState("");
  const [draftTag,         setDraftTag]          = useState("");
  const [draftDateFrom,    setDraftDateFrom]     = useState("");
  const [draftDateTo,      setDraftDateTo]       = useState("");
  const [draftDateField,   setDraftDateField]    = useState("followupDate");
  const [draftCity,        setDraftCity]         = useState("");
  const [draftCategory,    setDraftCategory]     = useState("");
  const [draftHasMeeting,  setDraftHasMeeting]   = useState("");
  const [draftHasSiteVisit,setDraftHasSiteVisit] = useState("");

  function openPanel() {
    // Init multi-select from URL
    setProjectSel(new Set(sp.get("project")?.split(",").map(s=>s.trim()).filter(Boolean) ?? []));
    setCstatusSel(new Set(sp.get("cstatus")?.split(",").map(s=>s.trim()).filter(Boolean) ?? []));
    setSourceSel(new Set(sp.get("source")?.split(",").map(s=>s.trim()).filter(Boolean) ?? []));
    // Init single-select
    setDraftTeam(sp.get("team") ?? "");
    setDraftOwner(sp.get("owner") ?? "");
    setDraftBudgetPreset(sp.get("budgetPreset") ?? "");
    setDraftPotential(sp.get("potential") ?? "");
    setDraftFundReady(sp.get("fundReady") ?? "");
    setDraftClientType(sp.get("clientType") ?? "");
    setDraftWhenInvest(sp.get("whenInvest") ?? "");
    setDraftFollowup(sp.get("followup") ?? "");
    setDraftNotPicked(sp.get("notPicked") ?? "");
    setDraftSort(sp.get("sort") ?? "");
    setDraftTag(sp.get("tag") ?? "");
    setDraftDateFrom(sp.get("dateFrom") ?? "");
    setDraftDateTo(sp.get("dateTo") ?? "");
    setDraftDateField(sp.get("dateField") ?? "followupDate");
    setDraftCity(sp.get("city") ?? "");
    setDraftCategory(sp.get("category") ?? "");
    setDraftHasMeeting(sp.get("hasMeeting") ?? "");
    setDraftHasSiteVisit(sp.get("hasSiteVisit") ?? "");
    setOpen(true);
  }

  function applyFilters() {
    const p = new URLSearchParams(sp);
    const set = (k: string, v: string) => v ? p.set(k, v) : p.delete(k);
    const setArr = (k: string, s: Set<string>) => { const v = [...s].join(","); v ? p.set(k, v) : p.delete(k); };
    // Multi-select
    setArr("project",       projectSel);
    setArr("cstatus",       cstatusSel);
    setArr("source",        sourceSel);
    // Single-select
    set("team",          draftTeam);
    set("owner",         draftOwner);
    set("budgetPreset",  draftBudgetPreset);
    set("potential",     draftPotential);
    set("fundReady",     draftFundReady);
    set("clientType",    draftClientType);
    set("whenInvest",    draftWhenInvest);
    set("followup",      draftFollowup);
    set("notPicked",     draftNotPicked);
    set("sort",          draftSort);
    set("tag",           draftTag);
    set("dateFrom",      draftDateFrom);
    set("dateTo",        draftDateTo);
    set("dateField",     draftDateField);
    set("city",          draftCity);
    set("category",      draftCategory);
    set("hasMeeting",    draftHasMeeting);
    set("hasSiteVisit",  draftHasSiteVisit);
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
    setOpen(false);
  }

  function resetFilters() {
    const p = new URLSearchParams(sp);
    [
      "project","cstatus","source","team","owner","budgetPreset",
      "potential","fundReady","clientType","whenInvest","followup",
      "notPicked","sort","tag","dateFrom","dateTo","dateField",
      "city","category","hasMeeting","hasSiteVisit",
      "status","ai","smart","filter","when","eoi",
    ].forEach(k => p.delete(k));
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
    setOpen(false);
  }

  // ── Active filter chips ──────────────────────────────────────────────────────
  function removeParam(...keys: string[]) {
    const p = new URLSearchParams(sp.toString());
    keys.forEach(k => p.delete(k));
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }
  function removeFromMulti(param: string, val: string) {
    const cur = sp.get(param)?.split(",").map(s=>s.trim()).filter(Boolean) ?? [];
    const next = cur.filter(v => v !== val);
    const p = new URLSearchParams(sp.toString());
    if (next.length) p.set(param, next.join(",")); else p.delete(param);
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }

  type Chip = { key: string; label: string; remove: () => void };
  const activeChips: Chip[] = [];
  // Multi-select chips — one chip per selected value
  sp.get("project")?.split(",").filter(Boolean).forEach(v =>
    activeChips.push({ key: `project:${v}`, label: `🏢 ${v}`, remove: () => removeFromMulti("project", v) })
  );
  sp.get("cstatus")?.split(",").filter(Boolean).forEach(v =>
    activeChips.push({ key: `cstatus:${v}`, label: v, remove: () => removeFromMulti("cstatus", v) })
  );
  if (showSource) sp.get("source")?.split(",").filter(Boolean).forEach(v =>
    activeChips.push({ key: `source:${v}`, label: SRC_LABELS[v] ?? v, remove: () => removeFromMulti("source", v) })
  );
  // Single-select chips
  if (sp.get("q"))            activeChips.push({ key:"q",           label: `"${sp.get("q")}"`,                                            remove: () => removeParam("q") });
  if (sp.get("budgetPreset")) activeChips.push({ key:"budget",      label: BUDGET_PRESETS.find(b=>b.key===sp.get("budgetPreset"))?.label ?? sp.get("budgetPreset")!, remove: () => removeParam("budgetPreset") });
  if (sp.get("potential"))    activeChips.push({ key:"potential",   label: POTENTIAL_LABELS[sp.get("potential")!] ?? sp.get("potential")!, remove: () => removeParam("potential") });
  if (sp.get("fundReady"))    activeChips.push({ key:"fundReady",   label: FUND_LABELS[sp.get("fundReady")!] ?? sp.get("fundReady")!,     remove: () => removeParam("fundReady") });
  if (sp.get("clientType"))   activeChips.push({ key:"clientType",  label: CLIENT_LABELS[sp.get("clientType")!] ?? sp.get("clientType")!, remove: () => removeParam("clientType") });
  if (sp.get("whenInvest"))   activeChips.push({ key:"whenInvest",  label: WHEN_LABELS[sp.get("whenInvest")!] ?? sp.get("whenInvest")!,   remove: () => removeParam("whenInvest") });
  if (sp.get("followup") && sp.get("followup") !== "all")
                              activeChips.push({ key:"followup",    label: FOLLOWUP_LABELS[sp.get("followup")!] ?? sp.get("followup")!,   remove: () => removeParam("followup") });
  if (sp.get("notPicked"))    activeChips.push({ key:"notPicked",   label: `No answer ${sp.get("notPicked")}d+`,                          remove: () => removeParam("notPicked") });
  if (sp.get("team"))         activeChips.push({ key:"team",        label: `${sp.get("team")} team`,                                      remove: () => removeParam("team") });
  if (sp.get("owner")) {
    const n = agents.find(a=>a.id===sp.get("owner"))?.name ?? (sp.get("owner")==="unassigned" ? "Unassigned" : sp.get("owner")!);
    activeChips.push({ key:"owner", label: `👤 ${n}`, remove: () => removeParam("owner") });
  }
  if (sp.get("city"))         activeChips.push({ key:"city",        label: `📍 ${sp.get("city")}`,                                       remove: () => removeParam("city") });
  if (sp.get("category"))     activeChips.push({ key:"category",    label: `Category: ${sp.get("category")}`,                            remove: () => removeParam("category") });
  if (sp.get("hasMeeting"))   activeChips.push({ key:"hasMeeting",  label: "Has Meeting",                                                 remove: () => removeParam("hasMeeting") });
  if (sp.get("hasSiteVisit")) activeChips.push({ key:"hasSiteVisit",label: "Has Site Visit",                                              remove: () => removeParam("hasSiteVisit") });
  if (sp.get("tag"))          activeChips.push({ key:"tag",         label: `Tag: ${sp.get("tag")}`,                                      remove: () => removeParam("tag") });
  if (sp.get("ai"))           activeChips.push({ key:"ai",          label: `AI: ${sp.get("ai")}`,                                        remove: () => removeParam("ai") });
  if (sp.get("dateFrom") || sp.get("dateTo")) {
    const field = sp.get("dateField") ?? "followupDate";
    const fLabel = field==="createdAt" ? "Created" : field==="lastTouchedAt" ? "Activity" : "Follow-up";
    activeChips.push({ key:"date", label: `${fLabel}: ${sp.get("dateFrom")??"∞"} → ${sp.get("dateTo")??"∞"}`, remove: () => removeParam("dateFrom","dateTo","dateField") });
  }

  const totalActiveCount = activeChips.length;

  // ── Option lists ─────────────────────────────────────────────────────────────
  const sourceOpts = sources.map(s => ({ value: s, label: SRC_LABELS[s] ?? s }));
  const agentOpts  = agents.map(a => ({ value: a.id, label: a.name }));
  const projectOpts = projects.map(p => ({ value: p.name, label: p.name }));
  const statusOpts = EXCEL_STATUSES.map(s => ({ value: s, label: s }));

  const selCls = "w-full border border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400";

  return (
    <>
      {/* ── Search + Filter button row ────────────────────────────────────────── */}
      <div className="flex gap-2">
        <input
          type="search"
          placeholder="Search name / phone / email / company…"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="flex-1 border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0b1a33]/20"
        />
        <button
          type="button"
          onClick={open ? () => setOpen(false) : openPanel}
          className={[
            "relative flex items-center gap-1.5 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap",
            open || totalActiveCount > 0
              ? "border-[#0b1a33] bg-[#0b1a33] text-white dark:border-blue-500 dark:bg-blue-700"
              : "border-[#e5e7eb] dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-100 hover:border-gray-400",
          ].join(" ")}
          aria-label={open ? "Close filters" : "Open filters"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
            <circle cx="9"  cy="6"  r="2.5" fill="currentColor" stroke="none"/>
            <circle cx="16" cy="12" r="2.5" fill="currentColor" stroke="none"/>
            <circle cx="9"  cy="18" r="2.5" fill="currentColor" stroke="none"/>
          </svg>
          Filters{totalActiveCount > 0 && <span className="bg-white/25 rounded px-1.5 text-xs font-bold">{totalActiveCount}</span>}
        </button>
      </div>

      {/* ── Active filter chips (always visible when filters are on) ─────────── */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeChips.map(chip => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.remove}
              className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-[#0b1a33] text-white hover:bg-[#0b1a33]/80 transition-colors dark:bg-blue-700 dark:hover:bg-blue-600"
            >
              {chip.label}
              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white/20 text-[10px] font-bold leading-none">×</span>
            </button>
          ))}
          {activeChips.length > 1 && (
            <button type="button" onClick={resetFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-gray-500 dark:text-slate-400 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700">
              Clear all
            </button>
          )}
        </div>
      )}

      {/* ── Wide filter panel ─────────────────────────────────────────────────── */}
      {open && (
        <div
          ref={panelRef}
          className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-xl overflow-hidden"
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-5 py-3 bg-gray-50 dark:bg-slate-900/60 border-b border-gray-100 dark:border-slate-700">
            <span className="text-sm font-semibold text-gray-800 dark:text-slate-100">Filter by Excel fields</span>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 p-1 rounded">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>

          {/* Grid of filter cells */}
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-5">

            {/* ── 1. PROJECT ── */}
            {projectOpts.length > 0 && (
              <MultiCell
                label="🏢 Project"
                options={projectOpts}
                selected={projectSel}
                onChange={setProjectSel}
                searchable
              />
            )}

            {/* ── 2. STATUS ── */}
            <MultiCell
              label="📋 Status"
              options={statusOpts}
              selected={cstatusSel}
              onChange={setCstatusSel}
              searchable
            />

            {/* ── 3. BUDGET ── */}
            <RadioCell
              label="💰 Budget (min)"
              value={draftBudgetPreset}
              onChange={setDraftBudgetPreset}
              options={[
                { value: "", label: "Any budget" },
                ...BUDGET_PRESETS.map(b => ({ value: b.key, label: b.label })),
              ]}
            />

            {/* ── 4. SOURCE (admin only) ── */}
            {showSource && (
              <MultiCell
                label="🌐 Source"
                options={sourceOpts}
                selected={sourceSel}
                onChange={setSourceSel}
              />
            )}

            {/* ── 5. ASSIGNED TO ── */}
            {showSource && (
              <RadioCell
                label="👤 Assigned To"
                value={draftOwner}
                onChange={setDraftOwner}
                options={[
                  { value: "", label: "Anyone" },
                  { value: "unassigned", label: "⚠ Unassigned" },
                  ...agentOpts,
                ]}
              />
            )}

            {/* ── 6. TEAM ── */}
            {showSource && (
              <RadioCell
                label="🌍 Forwarded Team"
                value={draftTeam}
                onChange={setDraftTeam}
                options={[
                  { value: "", label: "All teams" },
                  { value: "Dubai", label: "🇦🇪 Dubai" },
                  { value: "India", label: "🇮🇳 India" },
                ]}
              />
            )}

            {/* ── 7. POTENTIAL ── */}
            <RadioCell
              label="🎯 Potential"
              value={draftPotential}
              onChange={setDraftPotential}
              options={[
                { value: "", label: "Any" },
                ...Object.entries(POTENTIAL_LABELS).map(([v, l]) => ({ value: v, label: l })),
              ]}
            />

            {/* ── 8. FUND READINESS ── */}
            <RadioCell
              label="💼 Fund Readiness"
              value={draftFundReady}
              onChange={setDraftFundReady}
              options={[
                { value: "", label: "Any" },
                ...Object.entries(FUND_LABELS).map(([v, l]) => ({ value: v, label: l })),
              ]}
            />

            {/* ── 9. WHO IS CLIENT ── */}
            <RadioCell
              label="👥 Who Is Client"
              value={draftClientType}
              onChange={setDraftClientType}
              options={[
                { value: "", label: "Any" },
                ...Object.entries(CLIENT_LABELS).map(([v, l]) => ({ value: v, label: l })),
              ]}
            />

            {/* ── 10. WHEN CAN INVEST ── */}
            <RadioCell
              label="⏱ Timeline"
              value={draftWhenInvest}
              onChange={setDraftWhenInvest}
              options={[
                { value: "", label: "Any" },
                ...Object.entries(WHEN_LABELS).map(([v, l]) => ({ value: v, label: l })),
              ]}
            />

            {/* ── 11. FOLLOW-UP ── */}
            <RadioCell
              label="📅 Follow-up Date"
              value={draftFollowup}
              onChange={setDraftFollowup}
              options={[
                { value: "", label: "Any" },
                { value: "overdue", label: "⏰ Overdue" },
                { value: "today",   label: "Today" },
                { value: "tomorrow",label: "Tomorrow" },
                { value: "week",    label: "This week" },
                { value: "month",   label: "This month" },
              ]}
            />

            {/* ── 12. MEETING / SITE VISIT ── */}
            <div className="flex flex-col min-h-0">
              <div className="text-[11px] font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">🤝 Meeting / Visit</div>
              <div className="space-y-1">
                {[
                  { value: "", label: "Any" },
                  { value: "1", label: "Has meeting" },
                ].map(o => (
                  <label key={o.value} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="hasMeeting" className="h-3.5 w-3.5 text-[#0b1a33]" checked={draftHasMeeting===o.value} onChange={() => setDraftHasMeeting(o.value)} />
                    <span className="text-xs text-gray-700 dark:text-slate-200">{o.label}</span>
                  </label>
                ))}
                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-slate-700">
                  {[
                    { value: "", label: "Any" },
                    { value: "1", label: "Has site visit" },
                  ].map(o => (
                    <label key={o.value} className="flex items-center gap-1.5 cursor-pointer mb-0.5">
                      <input type="radio" name="hasSiteVisit" className="h-3.5 w-3.5 text-[#0b1a33]" checked={draftHasSiteVisit===o.value} onChange={() => setDraftHasSiteVisit(o.value)} />
                      <span className="text-xs text-gray-700 dark:text-slate-200">{o.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* ── 13. NOT PICKING CALLS ── */}
            <RadioCell
              label="📵 Not Picking"
              value={draftNotPicked}
              onChange={setDraftNotPicked}
              options={[
                { value: "", label: "Any" },
                { value: "2", label: "2+ days" },
                { value: "3", label: "3+ days" },
                { value: "5", label: "5+ days" },
                { value: "7", label: "7+ days" },
              ]}
            />

            {/* ── 14. CITY ── */}
            <div className="flex flex-col min-h-0">
              <div className="text-[11px] font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">📍 City / Location</div>
              <input
                type="text"
                placeholder="e.g. Mumbai, Delhi…"
                value={draftCity}
                onChange={e => setDraftCity(e.target.value)}
                className={selCls}
              />
            </div>

            {/* ── 15. CATEGORIZATION ── */}
            <div className="flex flex-col min-h-0">
              <div className="text-[11px] font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">🏷 Categorization</div>
              <select value={draftCategory} onChange={e=>setDraftCategory(e.target.value)} className={selCls}>
                <option value="">Any</option>
                <option value="NRI">NRI</option>
                <option value="Resident">Resident</option>
                <option value="Investor">Investor</option>
                <option value="End-user">End-user</option>
                <option value="HNI">HNI</option>
                <option value="Highly Responsive">Highly Responsive</option>
                <option value="Moderately Responsive">Moderately Responsive</option>
                <option value="Irregular">Irregular</option>
                <option value="Disappearing">Disappearing</option>
                <option value="Non-Responsive">Non-Responsive</option>
              </select>
            </div>

            {/* ── 16. TAG ── */}
            {distinctTags.length > 0 && (
              <div className="flex flex-col min-h-0">
                <div className="text-[11px] font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">🔖 Tag</div>
                <select value={draftTag} onChange={e=>setDraftTag(e.target.value)} className={selCls}>
                  <option value="">Any</option>
                  {distinctTags.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            )}

            {/* ── 17. DATE RANGE ── */}
            <div className="flex flex-col min-h-0 col-span-2 sm:col-span-1">
              <div className="text-[11px] font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">📆 Date Range</div>
              <select value={draftDateField} onChange={e=>setDraftDateField(e.target.value)} className={selCls + " mb-1.5"}>
                <option value="followupDate">Follow-up Date</option>
                <option value="createdAt">Created Date</option>
                <option value="lastTouchedAt">Last Activity</option>
              </select>
              <div className="flex gap-1">
                <input type="date" value={draftDateFrom} onChange={e=>setDraftDateFrom(e.target.value)} className={selCls + " flex-1 min-w-0"} />
                <span className="self-center text-xs text-gray-400">→</span>
                <input type="date" value={draftDateTo} onChange={e=>setDraftDateTo(e.target.value)} className={selCls + " flex-1 min-w-0"} />
              </div>
            </div>

            {/* ── 18. SORT ── */}
            <div className="flex flex-col min-h-0">
              <div className="text-[11px] font-bold text-gray-600 dark:text-slate-300 uppercase tracking-wide mb-1.5">⬆ Sort By</div>
              <select value={draftSort} onChange={e=>setDraftSort(e.target.value)} className={selCls}>
                <option value="">Newest first (default)</option>
                <option value="created_asc">Oldest first</option>
                <option value="touched_asc">Stalest first</option>
                <option value="touched_desc">Recently touched</option>
                <option value="name_asc">Name A–Z</option>
                <option value="score_desc">AI score: high → low</option>
              </select>
            </div>

          </div>

          {/* Panel footer */}
          <div className="flex items-center gap-3 px-5 py-3.5 bg-gray-50 dark:bg-slate-900/60 border-t border-gray-100 dark:border-slate-700">
            <button type="button" onClick={applyFilters}
              className="btn btn-primary flex-none px-6">
              Apply Filters
            </button>
            <button type="button" onClick={resetFilters}
              className="btn btn-ghost flex-none">
              Reset All
            </button>
            <button type="button" onClick={() => setOpen(false)}
              className="btn btn-ghost flex-none ml-auto text-gray-400">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Date-range active banner (keep legacy) ────────────────────────────── */}
      {!open && (sp.get("dateFrom") || sp.get("dateTo")) && (
        <div className="flex items-center gap-2 text-xs bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2">
          <span className="text-blue-700 dark:text-blue-300 font-medium">
            📅 {sp.get("dateField")==="createdAt" ? "Created" : sp.get("dateField")==="lastTouchedAt" ? "Last activity" : "Follow-up"}:&nbsp;
            {sp.get("dateFrom") || "∞"} → {sp.get("dateTo") || "∞"}
          </span>
          <button onClick={() => removeParam("dateFrom","dateTo","dateField")} className="text-blue-600 hover:text-blue-800 font-bold ml-auto">×</button>
        </div>
      )}
    </>
  );
}
