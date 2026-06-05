"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { EXCEL_STATUSES, BUDGET_PRESETS } from "@/lib/lead-statuses";

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
  HIGH: "High Potential", MEDIUM: "Medium Potential",
  LOW: "Low Potential", UNKNOWN: "Unknown Potential",
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
  IMMEDIATE: "Immediate", THIRTY_DAYS: "Within 1 Month",
  THREE_MONTHS: "Visit Dubai First", SIX_PLUS_MONTHS: "Not in 6 Months",
  WINDOW_SHOPPING: "Window Shopping",
};

interface Props {
  agents: { id: string; name: string }[];
  sources: string[];
  statuses: string[];
  /** Leadership-only flag — false for AGENT. Hides Source and Owner. */
  showSource?: boolean;
  /** DISTINCT tags from the dataset for the tag-filter dropdown. */
  distinctTags?: string[];
  /** All projects for the project filter dropdown */
  projects?: { id: string; name: string }[];
}

export default function LeadFilters({
  agents, sources, statuses, showSource = true, distinctTags = [], projects = [],
}: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const sp       = useSearchParams();

  // ── Search (debounced) ─────────────────────────────────────────────────────
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

  // ── More-Filters drawer ────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);

  // Draft state — initialised from URL when drawer opens
  const [draftSource,       setDraftSource]       = useState("");
  const [draftStatus,       setDraftStatus]       = useState("");
  const [draftCstatus,      setDraftCstatus]      = useState("");
  const [draftAI,           setDraftAI]           = useState("");
  const [draftTeam,         setDraftTeam]         = useState("");
  const [draftOwner,        setDraftOwner]        = useState("");
  const [draftSort,         setDraftSort]         = useState("");
  const [draftTag,          setDraftTag]          = useState("");
  const [draftNotPicked,    setDraftNotPicked]    = useState("");
  const [draftFollowup,     setDraftFollowup]     = useState("");
  const [draftDateFrom,     setDraftDateFrom]     = useState(sp.get("dateFrom") ?? "");
  const [draftDateTo,       setDraftDateTo]       = useState(sp.get("dateTo") ?? "");
  const [draftDateField,    setDraftDateField]    = useState(sp.get("dateField") ?? "followupDate");
  const [draftPotential,    setDraftPotential]    = useState("");
  const [draftFundReady,    setDraftFundReady]    = useState("");
  const [draftClientType,   setDraftClientType]   = useState("");
  const [draftWhenInvest,   setDraftWhenInvest]   = useState("");
  const [draftProject,      setDraftProject]      = useState("");
  const [draftBudgetPreset, setDraftBudgetPreset] = useState("");

  function openDrawer() {
    setDraftSource(sp.get("source") ?? "");
    setDraftStatus(sp.get("status") ?? "");
    setDraftCstatus(sp.get("cstatus") ?? "");
    setDraftAI(sp.get("ai") ?? "");
    setDraftTeam(sp.get("team") ?? "");
    setDraftOwner(sp.get("owner") ?? "");
    setDraftSort(sp.get("sort") ?? "");
    setDraftTag(sp.get("tag") ?? "");
    setDraftNotPicked(sp.get("notPicked") ?? "");
    setDraftFollowup(sp.get("followup") ?? "");
    setDraftDateFrom(sp.get("dateFrom") ?? "");
    setDraftDateTo(sp.get("dateTo") ?? "");
    setDraftDateField(sp.get("dateField") ?? "followupDate");
    setDraftPotential(sp.get("potential") ?? "");
    setDraftFundReady(sp.get("fundReady") ?? "");
    setDraftClientType(sp.get("clientType") ?? "");
    setDraftWhenInvest(sp.get("whenInvest") ?? "");
    setDraftProject(sp.get("project") ?? "");
    setDraftBudgetPreset(sp.get("budgetPreset") ?? "");
    setOpen(true);
  }

  function applyFilters() {
    const p = new URLSearchParams(sp);
    const set = (k: string, v: string) => v ? p.set(k, v) : p.delete(k);
    set("source",      draftSource);
    set("status",      draftStatus);
    set("cstatus",     draftCstatus);
    set("ai",          draftAI);
    set("team",        draftTeam);
    set("owner",       draftOwner);
    set("sort",        draftSort);
    set("tag",         draftTag);
    set("notPicked",   draftNotPicked);
    set("followup",    draftFollowup);
    set("dateFrom",    draftDateFrom);
    set("dateTo",      draftDateTo);
    set("dateField",   draftDateField);
    set("potential",     draftPotential);
    set("fundReady",     draftFundReady);
    set("clientType",    draftClientType);
    set("whenInvest",    draftWhenInvest);
    set("project",       draftProject);
    set("budgetPreset",  draftBudgetPreset);
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
    setOpen(false);
  }

  function resetFilters() {
    const p = new URLSearchParams(sp);
    ["source","status","cstatus","ai","team","owner","sort","tag","notPicked","followup","smart","filter","when","eoi","dateFrom","dateTo","dateField","potential","fundReady","clientType","whenInvest","project","budgetPreset"]
      .forEach(k => p.delete(k));
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
    setOpen(false);
  }

  // Badge: count of active drawer-managed params
  const advancedCount = [
    sp.get("source"),      sp.get("status"),       sp.get("cstatus"),
    sp.get("ai"),          sp.get("team"),          sp.get("owner"),
    sp.get("sort"),        sp.get("tag"),           sp.get("notPicked"),
    sp.get("smart"),       sp.get("filter"),
    sp.get("dateFrom"),    sp.get("dateTo"),
    sp.get("potential"),   sp.get("fundReady"),     sp.get("clientType"), sp.get("whenInvest"),
    sp.get("project"),     sp.get("budgetPreset"),
  ].filter(Boolean).length;

  // ── Active filter chips (shown outside the drawer, always visible) ──────────
  // Each entry = one removable chip. Clicking × deletes just that URL param.
  function removeParam(key: string) {
    const p = new URLSearchParams(sp.toString());
    p.delete(key);
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }
  function removeParamMulti(...keys: string[]) {
    const p = new URLSearchParams(sp.toString());
    keys.forEach(k => p.delete(k));
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }
  type Chip = { label: string; remove: () => void };
  const activeChips: Chip[] = [];
  if (sp.get("q"))           activeChips.push({ label: `"${sp.get("q")}"`,                          remove: () => removeParam("q") });
  if (sp.get("project"))     activeChips.push({ label: `🏢 ${sp.get("project")}`,                    remove: () => removeParam("project") });
  if (sp.get("cstatus"))     activeChips.push({ label: sp.get("cstatus")!,                           remove: () => removeParam("cstatus") });
  if (sp.get("budgetPreset"))activeChips.push({ label: BUDGET_PRESETS.find(b => b.key === sp.get("budgetPreset"))?.label ?? sp.get("budgetPreset")!, remove: () => removeParam("budgetPreset") });
  if (sp.get("potential"))   activeChips.push({ label: POTENTIAL_LABELS[sp.get("potential")!] ?? sp.get("potential")!, remove: () => removeParam("potential") });
  if (sp.get("fundReady"))   activeChips.push({ label: FUND_LABELS[sp.get("fundReady")!] ?? sp.get("fundReady")!,     remove: () => removeParam("fundReady") });
  if (sp.get("clientType"))  activeChips.push({ label: CLIENT_LABELS[sp.get("clientType")!] ?? sp.get("clientType")!, remove: () => removeParam("clientType") });
  if (sp.get("whenInvest"))  activeChips.push({ label: WHEN_LABELS[sp.get("whenInvest")!] ?? sp.get("whenInvest")!,   remove: () => removeParam("whenInvest") });
  if (sp.get("ai"))          activeChips.push({ label: `AI: ${sp.get("ai")}`,                        remove: () => removeParam("ai") });
  if (sp.get("followup") && sp.get("followup") !== "all")
                             activeChips.push({ label: FOLLOWUP_LABELS[sp.get("followup")!] ?? sp.get("followup")!,   remove: () => removeParam("followup") });
  if (sp.get("notPicked"))   activeChips.push({ label: `No answer ${sp.get("notPicked")}d+`,          remove: () => removeParam("notPicked") });
  if (sp.get("team"))        activeChips.push({ label: `Team: ${sp.get("team")}`,                    remove: () => removeParam("team") });
  if (sp.get("owner")) {
    const agentName = agents.find(a => a.id === sp.get("owner"))?.name ?? (sp.get("owner") === "unassigned" ? "Unassigned" : sp.get("owner")!);
    activeChips.push({ label: `👤 ${agentName}`, remove: () => removeParam("owner") });
  }
  if (showSource && sp.get("source"))
                             activeChips.push({ label: SRC_LABELS[sp.get("source")!] ?? sp.get("source")!, remove: () => removeParam("source") });
  if (sp.get("tag"))         activeChips.push({ label: `Tag: ${sp.get("tag")}`,                      remove: () => removeParam("tag") });
  if (sp.get("dateFrom") || sp.get("dateTo")) {
    const field = sp.get("dateField") ?? "followupDate";
    const fLabel = field === "createdAt" ? "Created" : field === "lastTouchedAt" ? "Activity" : "Follow-up";
    const range = `${sp.get("dateFrom") ?? "∞"} → ${sp.get("dateTo") ?? "∞"}`;
    activeChips.push({ label: `${fLabel}: ${range}`, remove: () => removeParamMulti("dateFrom","dateTo","dateField") });
  }

  const selCls = "w-full border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-3 py-2 text-sm";
  const lblCls = "text-xs font-semibold text-gray-500 dark:text-slate-400 block mb-1";

  return (
    <>
      {/* ── Search row ───────────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        <input
          type="search"
          placeholder="Search name / phone / email / company"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0b1a33]/20"
        />
        <button
          type="button"
          onClick={openDrawer}
          className={[
            "relative flex items-center gap-1.5 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap",
            advancedCount > 0
              ? "border-[#0b1a33] bg-[#0b1a33] text-white dark:border-blue-500 dark:bg-blue-700"
              : "border-[#e5e7eb] dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-100 hover:border-gray-400 dark:hover:border-slate-400",
          ].join(" ")}
          aria-label="Open filters"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="4" y1="6" x2="20" y2="6"/>
            <line x1="4" y1="12" x2="20" y2="12"/>
            <line x1="4" y1="18" x2="20" y2="18"/>
            <circle cx="9"  cy="6"  r="2.5" fill="currentColor" stroke="none"/>
            <circle cx="16" cy="12" r="2.5" fill="currentColor" stroke="none"/>
            <circle cx="9"  cy="18" r="2.5" fill="currentColor" stroke="none"/>
          </svg>
          Filters
          {advancedCount > 0 && (
            <span className="bg-white/25 rounded px-1.5 text-xs font-bold">{advancedCount}</span>
          )}
        </button>
      </div>

      {/* ── Active filter chips (stacked AND filters, each removable) ────────── */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {activeChips.map((chip, i) => (
            <button
              key={i}
              type="button"
              onClick={chip.remove}
              className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-[#0b1a33] text-white hover:bg-[#0b1a33]/80 transition-colors dark:bg-blue-700 dark:hover:bg-blue-600"
            >
              {chip.label}
              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white/20 hover:bg-white/30 text-[10px] font-bold leading-none ml-0.5" aria-hidden>×</span>
            </button>
          ))}
          {activeChips.length > 1 && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-gray-500 dark:text-slate-400 border border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* ── More-Filters drawer ───────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 dark:bg-black/70" aria-hidden />

          {/* Sheet */}
          <div className="relative bg-white dark:bg-slate-800 w-full sm:w-[400px] rounded-t-2xl sm:rounded-2xl shadow-2xl z-10 overflow-hidden">

            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="w-9 h-1 rounded-full bg-gray-300 dark:bg-slate-600" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">More Filters</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 rounded-full transition-colors"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Filter controls */}
            <div className="px-5 pb-4 space-y-3 overflow-y-auto" style={{ maxHeight: "60vh" }}>

              {/* ── PROJECT — primary Excel filter ── */}
              {projects.length > 0 && (
                <div>
                  <label className={lblCls}>🏢 Project</label>
                  <select value={draftProject} onChange={(e) => setDraftProject(e.target.value)} className={selCls}>
                    <option value="">All projects</option>
                    {projects.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
              )}

              {/* ── BUDGET MINIMUM ── */}
              <div>
                <label className={lblCls}>💰 Budget (minimum)</label>
                <select value={draftBudgetPreset} onChange={(e) => setDraftBudgetPreset(e.target.value)} className={selCls}>
                  <option value="">Any budget</option>
                  <optgroup label="INR">
                    {BUDGET_PRESETS.filter(b => b.key.endsWith("_inr")).map(b =>
                      <option key={b.key} value={b.key}>{b.label}</option>
                    )}
                  </optgroup>
                  <optgroup label="AED">
                    {BUDGET_PRESETS.filter(b => b.key.endsWith("_aed")).map(b =>
                      <option key={b.key} value={b.key}>{b.label}</option>
                    )}
                  </optgroup>
                </select>
              </div>

              {/* ── STATUS ── */}

              {/* Follow-up */}
              <div>
                <label className={lblCls}>📅 Follow-up</label>
                <select value={draftFollowup} onChange={(e) => setDraftFollowup(e.target.value)} className={selCls}>
                  <option value="">All leads</option>
                  <option value="overdue">⏰ Overdue</option>
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="week">This week</option>
                  <option value="month">This month</option>
                </select>
              </div>

              {/* Status — Excel/MIS values (primary filter) */}
              <div>
                <label className={lblCls}>📋 Status</label>
                <select value={draftCstatus} onChange={(e) => setDraftCstatus(e.target.value)} className={selCls}>
                  <option value="">All statuses</option>
                  {EXCEL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Potential */}
              <div>
                <label className={lblCls}>Potential</label>
                <select value={draftPotential} onChange={(e) => setDraftPotential(e.target.value)} className={selCls}>
                  <option value="">Any potential</option>
                  <option value="HIGH">🔥 High</option>
                  <option value="MEDIUM">🌤 Medium</option>
                  <option value="LOW">❄ Low</option>
                  <option value="UNKNOWN">— Unknown</option>
                </select>
              </div>

              {/* Fund Readiness */}
              <div>
                <label className={lblCls}>Fund Readiness</label>
                <select value={draftFundReady} onChange={(e) => setDraftFundReady(e.target.value)} className={selCls}>
                  <option value="">Any fund status</option>
                  <option value="IMMEDIATE_BUYER">🟢 Immediate Buyer</option>
                  <option value="SHORT_TERM_BUYER">🟡 Short-Term Buyer</option>
                  <option value="CONDITIONAL_BUYER">🔵 Conditional Buyer</option>
                  <option value="FINANCED_BUYER">🟣 Financed Buyer</option>
                  <option value="FUTURE_BUYER">🔴 Future Buyer</option>
                </select>
              </div>

              {/* Who is Client */}
              <div>
                <label className={lblCls}>Who Is Client</label>
                <select value={draftClientType} onChange={(e) => setDraftClientType(e.target.value)} className={selCls}>
                  <option value="">All client types</option>
                  <option value="INVESTOR">Investor</option>
                  <option value="END_USER">End User</option>
                  <option value="BOTH">Both</option>
                  <option value="UNCLEAR">Unclear</option>
                </select>
              </div>

              {/* When Can Invest */}
              <div>
                <label className={lblCls}>When Can Invest</label>
                <select value={draftWhenInvest} onChange={(e) => setDraftWhenInvest(e.target.value)} className={selCls}>
                  <option value="">Any timeline</option>
                  <option value="IMMEDIATE">⚡ Immediate / On Spot</option>
                  <option value="THIRTY_DAYS">📅 Within 1 Month</option>
                  <option value="THREE_MONTHS">✈ Will Visit Dubai First</option>
                  <option value="SIX_PLUS_MONTHS">⏳ Not in 6 Months</option>
                  <option value="WINDOW_SHOPPING">📆 Window Shopping</option>
                </select>
              </div>

              {/* AI Score */}
              <div>
                <label className={lblCls}>AI Score</label>
                <select value={draftAI} onChange={(e) => setDraftAI(e.target.value)} className={selCls}>
                  <option value="">Any score</option>
                  <option value="HOT">🔥 Hot</option>
                  <option value="WARM">☀ Warm</option>
                  <option value="COLD">🧊 Cold</option>
                </select>
              </div>

              {/* Not picking — only show if showSource (leadership) */}
              <div>
                <label className={lblCls}>📵 Not picking calls</label>
                <select value={draftNotPicked} onChange={(e) => setDraftNotPicked(e.target.value)} className={selCls}>
                  <option value="">Any</option>
                  <option value="2">Not picking 2+ days</option>
                  <option value="3">Not picking 3+ days</option>
                  <option value="5">Not picking 5+ days</option>
                  <option value="7">Not picking 7+ days</option>
                </select>
              </div>

              {/* Source — leadership only */}
              {showSource && (
                <div>
                  <label className={lblCls}>Source</label>
                  <select value={draftSource} onChange={(e) => setDraftSource(e.target.value)} className={selCls}>
                    <option value="">All sources</option>
                    {sources.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
                  </select>
                </div>
              )}

              {/* Team — leadership only */}
              {showSource && (
                <div>
                  <label className={lblCls}>Team</label>
                  <select value={draftTeam} onChange={(e) => setDraftTeam(e.target.value)} className={selCls}>
                    <option value="">All teams</option>
                    <option value="Dubai">Dubai</option>
                    <option value="India">India</option>
                  </select>
                </div>
              )}

              {/* Owner — leadership only */}
              {showSource && (
                <div>
                  <label className={lblCls}>Owner</label>
                  <select value={draftOwner} onChange={(e) => setDraftOwner(e.target.value)} className={selCls}>
                    <option value="">All owners</option>
                    <option value="unassigned">⚠ Unassigned</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}

              {/* Tag */}
              {distinctTags.length > 0 && (
                <div>
                  <label className={lblCls}>Tag</label>
                  <select value={draftTag} onChange={(e) => setDraftTag(e.target.value)} className={selCls}>
                    <option value="">All tags</option>
                    {distinctTags.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}

              {/* Sort */}
              <div>
                <label className={lblCls}>Sort by</label>
                <select value={draftSort} onChange={(e) => setDraftSort(e.target.value)} className={selCls}>
                  <option value="">Newest first</option>
                  <option value="created_asc">Oldest first</option>
                  <option value="score_desc">AI score: high → low</option>
                  <option value="touched_asc">Stalest first</option>
                  <option value="touched_desc">Recently touched</option>
                  <option value="name_asc">Name A–Z</option>
                </select>
              </div>

              {/* Date range filter */}
              <div>
                <label className={lblCls}>📅 Date Range Filter</label>
                <select value={draftDateField} onChange={(e) => setDraftDateField(e.target.value)} className={selCls + " mb-2"}>
                  <option value="followupDate">Follow-up Date</option>
                  <option value="createdAt">Created Date</option>
                  <option value="lastTouchedAt">Last Activity Date</option>
                </select>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] text-gray-500 dark:text-slate-400 block mb-0.5">From</label>
                    <input type="date" value={draftDateFrom} onChange={(e) => setDraftDateFrom(e.target.value)}
                      className={selCls} />
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] text-gray-500 dark:text-slate-400 block mb-0.5">To</label>
                    <input type="date" value={draftDateTo} onChange={(e) => setDraftDateTo(e.target.value)}
                      className={selCls} />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-5 py-4 bg-gray-50 dark:bg-slate-900/60 border-t border-gray-100 dark:border-slate-700">
              <button type="button" onClick={applyFilters} className="btn btn-primary flex-1 justify-center">
                Apply
              </button>
              <button type="button" onClick={resetFilters} className="btn btn-ghost flex-1 justify-center">
                Reset All
              </button>
            </div>
          </div>
        </div>
      )}

      {(sp.get("dateFrom") || sp.get("dateTo")) && (
        <div className="flex items-center gap-2 text-xs bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 mt-2">
          <span className="text-blue-700 dark:text-blue-300 font-medium">
            📅 Date filter: {sp.get("dateField") === "createdAt" ? "Created" : sp.get("dateField") === "lastTouchedAt" ? "Last activity" : "Follow-up"}
            {" "}{sp.get("dateFrom") || "∞"} → {sp.get("dateTo") || "∞"}
          </span>
          <button onClick={() => {
            const p = new URLSearchParams(sp.toString());
            ["dateFrom", "dateTo", "dateField"].forEach(k => p.delete(k));
            p.delete("page");
            router.replace(`${pathname}?${p.toString()}`);
          }} className="ml-auto text-blue-500 hover:text-blue-700 font-semibold">✕ Clear</button>
        </div>
      )}
    </>
  );
}
