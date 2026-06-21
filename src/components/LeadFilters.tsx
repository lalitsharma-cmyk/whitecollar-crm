"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { statusesForTeam, compareStatusDisplay } from "@/lib/lead-statuses";
import { parseBudget, formatBudget } from "@/lib/budgetParse";

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
const WHEN_LABELS: Record<string, string> = {
  IMMEDIATE: "⚡ Immediate", THIRTY_DAYS: "📅 1 Month",
  THREE_MONTHS: "✈ Visit Dubai First", SIX_PLUS_MONTHS: "⏳ 6+ Months",
  WINDOW_SHOPPING: "📆 Window Shopping",
};
const CLIENT_LABELS: Record<string, string> = {
  INVESTOR: "Investor", END_USER: "End User", BOTH: "Investor + End User", UNCLEAR: "Unclear",
};

interface Props {
  agents: { id: string; name: string }[];
  sources: string[];
  statuses: string[];
  showSource?: boolean;
  distinctTags?: string[];
  projects?: { id: string; name: string }[];
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function toggleSet(s: Set<string>, v: string): Set<string> {
  const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n;
}
function splitParam(s: string | null): string[] {
  return s?.split(",").map(v => v.trim()).filter(Boolean) ?? [];
}

// ── CheckList: searchable multi-select checkboxes ─────────────────────────────
function CheckList({
  label, options, selected, onChange, placeholder = "Search…",
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const shown = q ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">{label}</div>
      {options.length > 6 && (
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={placeholder}
          className="w-full mb-1.5 px-2 py-1 text-xs border border-gray-200 dark:border-slate-600 rounded dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      )}
      <div className="space-y-0.5 overflow-y-auto" style={{ maxHeight: 150 }}>
        {shown.map(o => (
          <label key={o.value} className="flex items-start gap-1.5 cursor-pointer group py-0.5">
            <input type="checkbox"
              className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 dark:border-slate-500 text-[#0b1a33] focus:ring-[#0b1a33] cursor-pointer flex-none"
              checked={selected.has(o.value)}
              onChange={() => onChange(toggleSet(selected, o.value))}
            />
            <span className="text-xs text-gray-700 dark:text-slate-200 group-hover:text-[#0b1a33] dark:group-hover:text-blue-300 leading-tight">{o.label}</span>
          </label>
        ))}
        {shown.length === 0 && <span className="text-xs text-gray-400 italic">No match</span>}
      </div>
      {selected.size > 0 && (
        <button type="button" onClick={() => onChange(new Set())}
          className="mt-1 text-[10px] text-blue-500 hover:underline">
          Clear {selected.size} ✕
        </button>
      )}
    </div>
  );
}

// ── Budget range inputs ───────────────────────────────────────────────────────
function BudgetRange({
  rawFrom, rawTo, onFromChange, onToChange,
}: {
  rawFrom: string; rawTo: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  const preview = (s: string) => {
    const n = parseBudget(s);
    if (!n) return null;
    return formatBudget(n, n >= 10_000_000 ? "INR" : "AED");
  };
  const inp = "w-full px-2.5 py-1.5 text-xs border border-gray-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400";
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">💰 Budget Range</div>
      <div className="space-y-1.5">
        <div>
          <label className="text-[10px] text-gray-400 dark:text-slate-500 block mb-0.5">Min</label>
          <input type="text" value={rawFrom} onChange={e => onFromChange(e.target.value)} placeholder="e.g. 5Cr, 2M, 500K" className={inp} />
          {preview(rawFrom) && <div className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">≈ {preview(rawFrom)}</div>}
        </div>
        <div>
          <label className="text-[10px] text-gray-400 dark:text-slate-500 block mb-0.5">Max</label>
          <input type="text" value={rawTo} onChange={e => onToChange(e.target.value)} placeholder="e.g. 10Cr, 5M" className={inp} />
          {preview(rawTo) && <div className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">≈ {preview(rawTo)}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Section header (collapsible) ──────────────────────────────────────────────
function SectionHead({ label, open, toggle, count }: { label: string; open: boolean; toggle: () => void; count: number }) {
  return (
    <button type="button" onClick={toggle}
      className="flex items-center gap-2 w-full text-left py-2 px-1 text-xs font-semibold text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 border-t border-gray-100 dark:border-slate-700 transition-colors">
      <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform flex-none ${open ? "rotate-90" : ""}`}>
        <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {label}
      {count > 0 && <span className="ml-auto bg-[#0b1a33] text-white text-[9px] rounded-full px-1.5 py-0.5">{count}</span>}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LeadFilters({
  agents, sources, statuses, showSource = true, distinctTags = [], projects = [],
}: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const sp       = useSearchParams();

  // Debounced search
  const [q, setQ] = useState(sp.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") === q) return;
      const p = new URLSearchParams(sp.toString());
      if (q) p.set("q", q); else p.delete("q");
      p.delete("page");
      router.replace(`${pathname}?${p.toString()}`);
    }, 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Multi-select (checkboxes)
  const [projectSel,  setProjectSel]  = useState<Set<string>>(new Set());
  const [cstatusSel,  setCstatusSel]  = useState<Set<string>>(new Set());
  const [sourceSel,   setSourceSel]   = useState<Set<string>>(new Set());
  const [ownerSel,    setOwnerSel]    = useState<Set<string>>(new Set());
  const [timelineSel, setTimelineSel] = useState<Set<string>>(new Set());
  const [clientSel,   setClientSel]   = useState<Set<string>>(new Set());

  // Budget range (raw text, parsed on apply)
  const [budgetFrom,  setBudgetFrom]  = useState("");
  const [budgetTo,    setBudgetTo]    = useState("");

  // Other filters
  const [draftTeam,         setDraftTeam]         = useState("");
  const [draftFollowupFrom, setDraftFollowupFrom] = useState("");
  const [draftFollowupTo,   setDraftFollowupTo]   = useState("");
  const [draftCity,         setDraftCity]         = useState("");
  const [draftFundReady,    setDraftFundReady]     = useState("");
  const [draftPotential,    setDraftPotential]    = useState("");
  const [draftNotPicked,    setDraftNotPicked]    = useState("");
  const [draftHasMeeting,   setDraftHasMeeting]   = useState("");
  const [draftHasSiteVisit, setDraftHasSiteVisit] = useState("");
  const [draftCategory,     setDraftCategory]     = useState("");
  const [draftTag,          setDraftTag]          = useState("");
  const [draftSort,         setDraftSort]         = useState("");
  const [draftDateFrom,     setDraftDateFrom]     = useState("");
  const [draftDateTo,       setDraftDateTo]       = useState("");
  const [draftDateField,    setDraftDateField]    = useState("followupDate");

  function initDraft() {
    setProjectSel(new Set(splitParam(sp.get("project"))));
    setCstatusSel(new Set(splitParam(sp.get("cstatus"))));
    setSourceSel(new Set(splitParam(sp.get("source"))));
    setOwnerSel(new Set(splitParam(sp.get("owner"))));
    setTimelineSel(new Set(splitParam(sp.get("whenInvest"))));
    setClientSel(new Set(splitParam(sp.get("clientType"))));
    setBudgetFrom(sp.get("budgetFrom") ? formatBudget(Number(sp.get("budgetFrom")), "INR") : "");
    setBudgetTo(sp.get("budgetTo")     ? formatBudget(Number(sp.get("budgetTo")),   "INR") : "");
    setDraftTeam(sp.get("team") ?? "");
    setDraftFollowupFrom(sp.get("followupFrom") ?? "");
    setDraftFollowupTo(sp.get("followupTo") ?? "");
    setDraftCity(sp.get("city") ?? "");
    setDraftFundReady(sp.get("fundReady") ?? "");
    setDraftPotential(sp.get("potential") ?? "");
    setDraftNotPicked(sp.get("notPicked") ?? "");
    setDraftHasMeeting(sp.get("hasMeeting") ?? "");
    setDraftHasSiteVisit(sp.get("hasSiteVisit") ?? "");
    setDraftCategory(sp.get("category") ?? "");
    setDraftTag(sp.get("tag") ?? "");
    setDraftSort(sp.get("sort") ?? "");
    setDraftDateFrom(sp.get("dateFrom") ?? "");
    setDraftDateTo(sp.get("dateTo") ?? "");
    setDraftDateField(sp.get("dateField") ?? "followupDate");
  }

  function applyFilters() {
    const p = new URLSearchParams(sp.toString());
    const set   = (k: string, v: string) => v ? p.set(k, v) : p.delete(k);
    const setMs = (k: string, s: Set<string>) => { const v = [...s].join(","); v ? p.set(k, v) : p.delete(k); };

    setMs("project",    projectSel);
    setMs("cstatus",    cstatusSel);
    setMs("source",     sourceSel);
    setMs("owner",      ownerSel);
    setMs("whenInvest", timelineSel);
    setMs("clientType", clientSel);

    // Budget range — parse human-readable to raw numbers
    const bFrom = parseBudget(budgetFrom);
    const bTo   = parseBudget(budgetTo);
    bFrom ? p.set("budgetFrom", String(Math.round(bFrom))) : p.delete("budgetFrom");
    bTo   ? p.set("budgetTo",   String(Math.round(bTo)))   : p.delete("budgetTo");
    p.delete("budgetPreset"); // legacy

    set("team",          draftTeam);
    set("followupFrom",  draftFollowupFrom);
    set("followupTo",    draftFollowupTo);
    // If date range is set, clear the quick-chip followup param to avoid conflict
    if (draftFollowupFrom || draftFollowupTo) p.delete("followup");
    set("city",          draftCity);
    set("fundReady",     draftFundReady);
    set("potential",     draftPotential);
    set("notPicked",     draftNotPicked);
    set("hasMeeting",    draftHasMeeting);
    set("hasSiteVisit",  draftHasSiteVisit);
    set("category",      draftCategory);
    set("tag",           draftTag);
    set("sort",          draftSort);
    set("dateFrom",      draftDateFrom);
    set("dateTo",        draftDateTo);
    set("dateField",     draftDateField);
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
    setOpen(false);
  }

  function resetFilters() {
    const p = new URLSearchParams(sp.toString());
    ["project","cstatus","source","owner","whenInvest","clientType",
     "budgetFrom","budgetTo","budgetPreset","team","followup","followupFrom","followupTo","city",
     "fundReady","potential","notPicked","hasMeeting","hasSiteVisit",
     "category","tag","sort","dateFrom","dateTo","dateField",
     "status","ai","smart","filter","when","eoi",
    ].forEach(k => p.delete(k));
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
    setOpen(false);
  }

  // ── Remove individual chip ──────────────────────────────────────────────────
  function removeParam(...keys: string[]) {
    const p = new URLSearchParams(sp.toString());
    keys.forEach(k => p.delete(k));
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }
  function removeFromMulti(param: string, val: string) {
    const cur = splitParam(sp.get(param));
    const next = cur.filter(v => v !== val);
    const p = new URLSearchParams(sp.toString());
    next.length ? p.set(param, next.join(",")) : p.delete(param);
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }

  // ── Build active chips ──────────────────────────────────────────────────────
  type Chip = { key: string; label: string; remove: () => void };
  const chips: Chip[] = [];

  splitParam(sp.get("project")).forEach(v =>
    chips.push({ key: `proj:${v}`, label: `🏢 ${v}`, remove: () => removeFromMulti("project", v) }));
  splitParam(sp.get("cstatus")).forEach(v =>
    chips.push({ key: `cs:${v}`, label: v, remove: () => removeFromMulti("cstatus", v) }));
  if (showSource) splitParam(sp.get("source")).forEach(v =>
    chips.push({ key: `src:${v}`, label: SRC_LABELS[v] ?? v, remove: () => removeFromMulti("source", v) }));
  splitParam(sp.get("owner")).forEach(v => {
    const n = v === "unassigned" ? "⚠ Unassigned" : (agents.find(a => a.id === v)?.name ?? v);
    chips.push({ key: `own:${v}`, label: `👤 ${n}`, remove: () => removeFromMulti("owner", v) });
  });
  splitParam(sp.get("whenInvest")).forEach(v =>
    chips.push({ key: `wi:${v}`, label: WHEN_LABELS[v] ?? v, remove: () => removeFromMulti("whenInvest", v) }));
  splitParam(sp.get("clientType")).forEach(v =>
    chips.push({ key: `ct:${v}`, label: CLIENT_LABELS[v] ?? v, remove: () => removeFromMulti("clientType", v) }));
  if (sp.get("budgetFrom") || sp.get("budgetTo")) {
    const fmtN = (raw: string | null) => {
      if (!raw) return "—";
      const n = Number(raw);
      return formatBudget(n, n >= 10_000_000 ? "INR" : "AED");
    };
    chips.push({ key: "budget", label: `💰 ${fmtN(sp.get("budgetFrom"))} – ${fmtN(sp.get("budgetTo"))}`, remove: () => removeParam("budgetFrom","budgetTo") });
  }
  if (sp.get("team"))     chips.push({ key:"team",      label: `${sp.get("team")} team`,                            remove: () => removeParam("team") });
  // Follow-up date range (from filter panel)
  if (sp.get("followupFrom") || sp.get("followupTo"))
                          chips.push({ key:"followupRange", label: `📅 Follow-Up: ${sp.get("followupFrom")??"∞"} → ${sp.get("followupTo")??"∞"}`, remove: () => removeParam("followupFrom","followupTo") });
  // Quick chip bar followup (Today/Overdue — from chip shortcuts, not panel)
  if (sp.get("followup") && sp.get("followup") !== "all" && !sp.get("followupFrom") && !sp.get("followupTo"))
                          chips.push({ key:"followup",  label: FOLLOWUP_LABELS[sp.get("followup")!] ?? sp.get("followup")!, remove: () => removeParam("followup") });
  if (sp.get("city"))     chips.push({ key:"city",      label: `📍 ${sp.get("city")}`,                              remove: () => removeParam("city") });
  if (sp.get("fundReady"))chips.push({ key:"fr",        label: `Fund: ${sp.get("fundReady")}`,                      remove: () => removeParam("fundReady") });
  if (sp.get("potential"))chips.push({ key:"pot",       label: `Potential: ${sp.get("potential")}`,                 remove: () => removeParam("potential") });
  if (sp.get("notPicked"))chips.push({ key:"np",        label: `No answer ${sp.get("notPicked")}d+`,                remove: () => removeParam("notPicked") });
  if (sp.get("hasMeeting"))   chips.push({ key:"mtg",  label: "Has Meeting",                                       remove: () => removeParam("hasMeeting") });
  if (sp.get("hasSiteVisit")) chips.push({ key:"sv",   label: "Has Site Visit",                                    remove: () => removeParam("hasSiteVisit") });
  if (sp.get("category")) chips.push({ key:"cat",      label: `Category: ${sp.get("category")}`,                   remove: () => removeParam("category") });
  if (sp.get("tag"))      chips.push({ key:"tag",      label: `Tag: ${sp.get("tag")}`,                             remove: () => removeParam("tag") });
  if (sp.get("q"))        chips.push({ key:"q",        label: `"${sp.get("q")}"`,                                  remove: () => removeParam("q") });
  if (sp.get("dateFrom") || sp.get("dateTo")) {
    const f = sp.get("dateField") ?? "followupDate";
    const fl = f === "createdAt" ? "Created" : f === "lastTouchedAt" ? "Activity" : "Follow-up";
    chips.push({ key:"date", label: `📅 ${fl}: ${sp.get("dateFrom")??"∞"} → ${sp.get("dateTo")??"∞"}`, remove: () => removeParam("dateFrom","dateTo","dateField") });
  }

  // Count active filters in the "More" section (for badge on SectionHead)
  const moreCount = [
    sp.get("fundReady"), sp.get("potential"), sp.get("notPicked"),
    sp.get("hasMeeting"), sp.get("hasSiteVisit"), sp.get("category"),
    sp.get("tag"), sp.get("dateFrom") || sp.get("dateTo"),
  ].filter(Boolean).length;

  const selCls = "w-full border border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400";

  // Helper to count active items in a multi-select set on the URL
  const cntMs = (param: string) => splitParam(sp.get(param)).length;

  const sourceOpts  = sources.map(s => ({ value: s, label: SRC_LABELS[s] ?? s }));
  const projectOpts = projects.map(p => ({ value: p.name, label: p.name }));
  // Status options FOLLOW the Forwarded-Team filter — Gurgaon (India) and Dubai
  // statuses are never merged into one list. With no team chosen, the status
  // filter stays empty (a hint points the user to pick a team first).
  const statusOpts  = (draftTeam === "Dubai" || draftTeam === "India")
    ? [...statusesForTeam(draftTeam)].sort(compareStatusDisplay).map(s => ({ value: s, label: s }))
    : [];
  const agentOpts   = [
    { value: "unassigned", label: "⚠ Unassigned" },
    ...agents.map(a => ({ value: a.id, label: a.name })),
  ];
  const timelineOpts = Object.entries(WHEN_LABELS).map(([v, l]) => ({ value: v, label: l }));
  const clientOpts   = Object.entries(CLIENT_LABELS).map(([v, l]) => ({ value: v, label: l }));

  return (
    <>
      {/* ── Search + Filters button ──────────────────────────────────────────── */}
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
          onClick={() => { if (!open) initDraft(); setOpen(v => !v); }}
          className={[
            "relative flex items-center gap-1.5 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap",
            open || chips.length > 0
              ? "border-[#0b1a33] bg-[#0b1a33] text-white dark:border-blue-500 dark:bg-blue-700"
              : "border-[#e5e7eb] dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-100 hover:border-gray-400",
          ].join(" ")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
            <circle cx="9" cy="6" r="2.5" fill="currentColor" stroke="none"/>
            <circle cx="16" cy="12" r="2.5" fill="currentColor" stroke="none"/>
            <circle cx="9" cy="18" r="2.5" fill="currentColor" stroke="none"/>
          </svg>
          Filters{chips.length > 0 && <span className="bg-white/25 rounded px-1.5 text-xs font-bold">{chips.length}</span>}
        </button>
      </div>

      {/* ── Active chips (always visible when filters are set) ───────────────── */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map(c => (
            <button key={c.key} type="button" onClick={c.remove}
              className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-[#0b1a33] text-white hover:bg-[#0b1a33]/80 dark:bg-blue-700 dark:hover:bg-blue-600 transition-colors">
              {c.label}
              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white/20 text-[10px] font-bold">×</span>
            </button>
          ))}
          {chips.length > 1 && (
            <button type="button" onClick={resetFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-gray-500 dark:text-slate-400 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700">
              Clear all
            </button>
          )}
        </div>
      )}

      {/* ── Filter Panel ─────────────────────────────────────────────────────── */}
      {open && (
        <div className="w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-xl">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/60 rounded-t-xl">
            <span className="text-sm font-semibold dark:text-slate-100">Filter leads</span>
            <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 p-1 rounded">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">

            {/* ── Core filters grid ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-4">

              {/* 1. Project */}
              {projectOpts.length > 0 && (
                <CheckList label="🏢 Project" options={projectOpts} selected={projectSel} onChange={setProjectSel} />
              )}

              {/* 2. Status — options follow the Forwarded-Team filter (never merged) */}
              {statusOpts.length > 0
                ? <CheckList label="📋 Status" options={statusOpts} selected={cstatusSel} onChange={setCstatusSel} />
                : <div className="text-[11px] text-gray-400 dark:text-slate-500 italic px-0.5">📋 Status — pick a <b>Forwarded Team</b> below first (Gurgaon &amp; Dubai statuses stay separate).</div>}

              {/* 3. Budget */}
              <BudgetRange rawFrom={budgetFrom} rawTo={budgetTo} onFromChange={setBudgetFrom} onToChange={setBudgetTo} />

              {/* 4. Source */}
              {showSource && (
                <CheckList label="🌐 Source" options={sourceOpts} selected={sourceSel} onChange={setSourceSel} />
              )}

              {/* 5. Assigned To */}
              {showSource && (
                <CheckList label="👤 Assigned To" options={agentOpts} selected={ownerSel} onChange={setOwnerSel} />
              )}

              {/* 6. Follow-Up Date — Excel-style date range */}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">📅 Follow-Up Date</div>
                <div className="space-y-1.5">
                  <div>
                    <label className="text-[10px] text-gray-400 dark:text-slate-500 block mb-0.5">From</label>
                    <input type="date" value={draftFollowupFrom} onChange={e => setDraftFollowupFrom(e.target.value)}
                      className={selCls} />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 dark:text-slate-500 block mb-0.5">To</label>
                    <input type="date" value={draftFollowupTo} onChange={e => setDraftFollowupTo(e.target.value)}
                      className={selCls} />
                  </div>
                  {(draftFollowupFrom || draftFollowupTo) && (
                    <button type="button" onClick={() => { setDraftFollowupFrom(""); setDraftFollowupTo(""); }}
                      className="text-[10px] text-blue-500 hover:underline">Clear dates</button>
                  )}
                </div>
              </div>

              {/* 7. Timeline (multi) */}
              <CheckList label="⏱ Timeline" options={timelineOpts} selected={timelineSel} onChange={setTimelineSel} />

              {/* 8. City */}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">📍 City / Location</div>
                <input type="text" value={draftCity} onChange={e => setDraftCity(e.target.value)}
                  placeholder="e.g. Mumbai, Delhi…" className={selCls} />
              </div>

              {/* 9. Client Type (multi) */}
              <CheckList label="👥 Client Type" options={clientOpts} selected={clientSel} onChange={setClientSel} />

              {/* 10. Team */}
              {showSource && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">🌍 Forwarded Team</div>
                  <div className="space-y-0.5">
                    {[{ v:"",l:"All"},{ v:"Dubai",l:"🇦🇪 Dubai"},{ v:"India",l:"🇮🇳 India"}].map(o => (
                      <label key={o.v} className="flex items-center gap-1.5 cursor-pointer group py-0.5">
                        <input type="radio" name="team" value={o.v} checked={draftTeam===o.v} onChange={() => setDraftTeam(o.v)}
                          className="h-3.5 w-3.5 text-[#0b1a33] border-gray-300 dark:border-slate-500 focus:ring-[#0b1a33] flex-none" />
                        <span className="text-xs text-gray-700 dark:text-slate-200 group-hover:text-[#0b1a33] dark:group-hover:text-blue-300">{o.l}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── More / Advanced (collapsible) ─────────────────────────────── */}
            <SectionHead
              label="More filters"
              open={moreOpen}
              toggle={() => setMoreOpen(v => !v)}
              count={moreCount}
            />
            {moreOpen && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">💼 Fund Readiness</div>
                  <select value={draftFundReady} onChange={e=>setDraftFundReady(e.target.value)} className={selCls}>
                    <option value="">Any</option>
                    <option value="IMMEDIATE_BUYER">Immediate Buyer</option>
                    <option value="SHORT_TERM_BUYER">Short-Term Buyer</option>
                    <option value="CONDITIONAL_BUYER">Conditional Buyer</option>
                    <option value="FINANCED_BUYER">Financed Buyer</option>
                    <option value="FUTURE_BUYER">Future Buyer</option>
                  </select>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">🎯 Potential</div>
                  <select value={draftPotential} onChange={e=>setDraftPotential(e.target.value)} className={selCls}>
                    <option value="">Any</option>
                    <option value="HIGH">🔥 High</option>
                    <option value="MEDIUM">🌤 Medium</option>
                    <option value="LOW">❄ Low</option>
                  </select>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">📵 Not Picking Calls</div>
                  <select value={draftNotPicked} onChange={e=>setDraftNotPicked(e.target.value)} className={selCls}>
                    <option value="">Any</option>
                    <option value="2">2+ days</option>
                    <option value="3">3+ days</option>
                    <option value="5">5+ days</option>
                    <option value="7">7+ days</option>
                  </select>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">🤝 Meeting / Visit</div>
                  <div className="space-y-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={draftHasMeeting==="1"} onChange={e=>setDraftHasMeeting(e.target.checked?"1":"")}
                        className="h-3.5 w-3.5 rounded text-[#0b1a33]" />
                      <span className="text-xs text-gray-700 dark:text-slate-200">Has meeting</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={draftHasSiteVisit==="1"} onChange={e=>setDraftHasSiteVisit(e.target.checked?"1":"")}
                        className="h-3.5 w-3.5 rounded text-[#0b1a33]" />
                      <span className="text-xs text-gray-700 dark:text-slate-200">Has site visit</span>
                    </label>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">🏷 Categorization</div>
                  <select value={draftCategory} onChange={e=>setDraftCategory(e.target.value)} className={selCls}>
                    <option value="">Any</option>
                    <option value="NRI">NRI</option>
                    <option value="Resident">Resident</option>
                    <option value="Investor">Investor</option>
                    <option value="End-user">End-user</option>
                    <option value="HNI">HNI</option>
                    <option value="Highly Responsive">Highly Responsive</option>
                    <option value="Non-Responsive">Non-Responsive</option>
                  </select>
                </div>
                {distinctTags.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">🔖 Tag</div>
                    <select value={draftTag} onChange={e=>setDraftTag(e.target.value)} className={selCls}>
                      <option value="">Any</option>
                      {distinctTags.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">⬆ Sort By</div>
                  <select value={draftSort} onChange={e=>setDraftSort(e.target.value)} className={selCls}>
                    <option value="">Smart (default)</option>
                    <option value="created_asc">Oldest first</option>
                    <option value="touched_asc">Stalest first</option>
                    <option value="touched_desc">Recently touched</option>
                    <option value="name_asc">Name A–Z</option>
                    <option value="score_desc">AI score: high → low</option>
                  </select>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1">📆 Date Range</div>
                  <select value={draftDateField} onChange={e=>setDraftDateField(e.target.value)} className={selCls + " mb-1.5"}>
                    <option value="followupDate">Follow-up</option>
                    <option value="createdAt">Created</option>
                    <option value="lastTouchedAt">Last activity</option>
                  </select>
                  <div className="flex gap-1">
                    <input type="date" value={draftDateFrom} onChange={e=>setDraftDateFrom(e.target.value)} className={selCls + " min-w-0"} />
                    <span className="self-center text-gray-400 text-xs">→</span>
                    <input type="date" value={draftDateTo} onChange={e=>setDraftDateTo(e.target.value)} className={selCls + " min-w-0"} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 px-5 py-3 bg-gray-50 dark:bg-slate-900/60 border-t border-gray-100 dark:border-slate-700 rounded-b-xl">
            <button type="button" onClick={applyFilters} className="btn btn-primary px-6">Apply Filters</button>
            <button type="button" onClick={resetFilters} className="btn btn-ghost">Reset All</button>
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost ml-auto text-gray-400">Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
