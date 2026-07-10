"use client";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PROPERTY_TYPES } from "@/lib/propertyType";
import { statusesForTeam, compareStatusDisplay, TERMINAL_STATUSES } from "@/lib/lead-statuses";
import { formatLeadName } from "@/lib/leadName";
import { backdropProps } from "@/lib/useDismiss";
import { parseBudget } from "@/lib/budgetParse";
import { isWebsiteSource, isEventSource } from "@/lib/lead-sources";
import ColumnHeaderFilter, { type ColFilterState } from "@/components/ColumnHeaderFilter";
import { useScrollRestore } from "@/hooks/useScrollRestore";

// Cleaned-up Source list — mirrors ALLOWED_SOURCES in LeadSourceMediumFields.tsx
// (single "Website"; no Call/WhatsApp/Email/Event; WCR Event kept). The label
// is what we store in sourceRaw; the value is the LeadSource enum sent to the
// update route so `source` + `sourceRaw` stay consistent. Master Data is
// admin-only, so source is editable here (route enforces Admin/Super-Admin).
const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "WEBSITE", label: "Website" },
  { value: "WCR_EVENT", label: "WCR Event" },
  { value: "LANDING_PAGE", label: "Landing Page" },
  { value: "REFERRAL", label: "Referral" },
  { value: "FACEBOOK_ADS", label: "Facebook Ads" },
  { value: "GOOGLE_ADS", label: "Google Ads" },
  { value: "PORTAL_99ACRES", label: "Portal 99acres" },
  { value: "PORTAL_MAGICBRICKS", label: "Portal MagicBricks" },
  { value: "PORTAL_HOUSING", label: "Portal Housing" },
  { value: "OTHER", label: "Other" },
];

// Standard contact mediums (matches STANDARD_MEDIUMS in mediumManager.ts) + the
// always-present "Other" so an admin can type the first custom medium inline.
const MEDIUM_OPTIONS = ["Call", "WhatsApp", "Email", "Other"];

export type MDRow = {
  id: string;
  name: string;
  href: string;
  createdDate: string;
  createdTime: string;
  createdAtMs: number;
  budget: string;
  statusLabel: string | null;
  statusClass: string;
  bucket: string;
  bucketClass: string;
  owner: string;
  ownerId: string | null;
  previousOwner: string;         // last working agent (Lost/Reject unassign) — read-only
  previousOwnerId: string | null;
  team: string;            // "Dubai" | "India" | "—"
  project: string;
  propertyType: string;    // "Residential" | "Commercial" | ""
  source: string;          // raw LeadSource enum — family tests use this, not the label
  sourceLabel: string;
  sourceRaw: string;
  medium: string;          // "Call", "WhatsApp", "Email", or custom
  mediumOther: string | null;  // custom medium value if medium="Other"
  leadOrigin: string;
  // read-only preview fields
  phone: string;
  email: string;
  message: string;         // notesShort — what a website lead actually wrote
  lastRemark: string;      // latest activity remark (fallback lead.remarks)
  followupDate: string;    // IST date string, "" if none
};

interface Props {
  rows: MDRow[];
  agents: { id: string; name: string }[];
  projects: { id: string; name: string; city: string; country: string }[];
  isSuperAdmin: boolean;
  viewerId: string;        // per-admin localStorage scope
}

type ColKey =
  | "name" | "agent" | "previousOwner" | "team"
  | "createdDate" | "createdTime" | "budget" | "project" | "propertyType" | "source" | "medium" | "message" | "status" | "bucket" | "email" | "phone";

const TEAMS = ["Dubai", "India"];
const PAGE = 50;

// Column order (Lalit 2026-06-28): when + who first, then the deal fields, so the
// important columns fit one screen with NO horizontal scroll. Frozen identity block
// = Created Date / Created Time / Client Name (pinned while the rest scroll).
// Compact widths throughout. "Message" is DEFAULT-HIDDEN (still available in the
// Columns menu). Order: Created Date · Created Time · Client Name · Agent · Team ·
// Property Enquired · Budget · Status · Source · Bucket · (remaining/optional).
const COLS: { key: ColKey; label: string; frozen?: boolean; w?: number; minW?: number; defHidden?: boolean; wide?: boolean }[] = [
  { key: "createdDate", label: "Created Date", frozen: true, w: 96 },
  { key: "createdTime", label: "Created Time", frozen: true, w: 78 },
  { key: "name", label: "Client Name", frozen: true, w: 150 },
  { key: "agent", label: "Agent", minW: 104 },
  { key: "previousOwner", label: "Previous Owner", minW: 120 },
  { key: "team", label: "Team", minW: 60 },
  { key: "project", label: "Property Enquired", minW: 150 },
  { key: "budget", label: "Budget", minW: 96 },
  { key: "status", label: "Status", minW: 130 },
  { key: "source", label: "Source", minW: 92 },
  { key: "bucket", label: "Bucket", minW: 84 },
  { key: "propertyType", label: "Property Type", minW: 100 },
  { key: "medium", label: "Medium", minW: 90 },
  { key: "message", label: "Message", wide: true, defHidden: true },
  { key: "email", label: "Email", defHidden: true },
  { key: "phone", label: "Phone", defHidden: true },
];
const HIDEABLE = COLS.filter((c) => !c.frozen).map((c) => c.key);
const DEFAULT_HIDDEN = COLS.filter((c) => c.defHidden).map((c) => c.key);

// Frozen-column left offsets (checkbox = 36px, then Name/Agent/Team widths).
const CB_W = 36;
const FROZEN_LEFT: Partial<Record<ColKey, number>> = (() => {
  const out: Partial<Record<ColKey, number>> = {};
  let acc = CB_W;
  for (const c of COLS.filter((c) => c.frozen)) { out[c.key] = acc; acc += c.w ?? 120; }
  return out;
})();

function valueOf(r: MDRow, c: ColKey): string {
  switch (c) {
    case "name": return r.name;
    case "agent": return r.owner;
    case "previousOwner": return r.previousOwner;
    case "team": return r.team;
    case "createdDate": return r.createdDate;
    case "createdTime": return r.createdTime;
    case "budget": return r.budget;
    case "project": return r.project;
    case "propertyType": return r.propertyType || "—";
    case "source": return r.sourceLabel;
    case "medium": return r.medium === "Other" && r.mediumOther ? r.mediumOther : (r.medium || "—");
    case "message": return r.message;
    case "status": return r.statusLabel ?? "— none —";
    case "bucket": return r.bucket;
    case "email": return r.email;
    case "phone": return r.phone;
  }
}

// Master Data DEFAULT section order (display only): Unassigned → India → Dubai →
// Website → Event → Others. Applied only when no explicit column sort is active;
// any column-sort the user clicks overrides it. Pure ordering — no data change.
function sectionRank(r: MDRow): number {
  if (!r.ownerId && r.bucket === "Workable") return 0;  // 1. Unassigned Leads (rejected/terminal unassigned are NOT "ready to assign")
  if (r.team === "India") return 1;          // 2. India Leads
  if (r.team === "Dubai") return 2;          // 3. Dubai Leads
  if (isWebsiteSource(r.source)) return 3;   // 4. Website Leads (Website/WCR Website/Landing Page)
  if (isEventSource(r.source)) return 4;     // 5. Event Leads (Event/WCR Event)
  return 5;                                   // 6. Others
}

// Team-specific status options for a Master Data row's inline menu. NEVER a
// combined India+Dubai list (owner rule). A teamless lead prompts for a team
// first; the lead's CURRENT status is always kept so it can't be lost.
function statusMenuOptions(team: string, current: string | null): { value: string; label: string }[] {
  if (team !== "Dubai" && team !== "India") return [{ value: "", label: "⚠ Set the lead's team first" }];
  const opts = [...statusesForTeam(team)].sort(compareStatusDisplay);
  if (current && !opts.includes(current)) opts.unshift(current);
  return opts.map((s) => ({ value: s, label: s }));
}

const todayIST = () => new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

// Format a Date as the "YYYY-MM-DDTHH:mm" wall-clock string an <input
// type="datetime-local"> expects, in the USER'S LOCAL timezone. Date.toISOString()
// is UTC, so we subtract the local offset FIRST; the sliced ISO then reads as the
// local wall clock (never shifted). Converting back is just new Date(value) — a
// zone-less datetime-local string parses as LOCAL — then .toISOString() for the API.
function toLocalDatetimeValue(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

// "10 Jul 2026, 2:15 PM" — friendly local rendering of a datetime-local value for
// the confirmation line (formatted in the SAME local zone the input shows).
function fmtLocalFollowup(local: string): string {
  const d = new Date(local);
  if (isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date}, ${time}`;
}

// Unassigned age badge (Orange ≥15m · Red ≥30m · Critical ≥60m). Computed
// client-side from createdAt; only rendered after hydration to avoid a
// server/client time mismatch.
function unassignedAgeBadge(createdAtMs: number): { label: string; cls: string } | null {
  const mins = Math.floor((Date.now() - createdAtMs) / 60000);
  if (mins < 15) return null;
  const age = mins >= 1440 ? `${Math.floor(mins / 1440)}d` : mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`;
  if (mins >= 60) return { label: `🔴 ${age}`, cls: "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-300" };
  if (mins >= 30) return { label: `🟠 ${age}`, cls: "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300" };
  return { label: `🟡 ${age}`, cls: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300" };
}

// Default Saved Views — predicate presets over the loaded rows (owner-approved list).
const BUILTINS: { name: string; test: (r: MDRow, today: string) => boolean }[] = [
  { name: "New Website Leads", test: (r) => isWebsiteSource(r.source) },
  // "Unassigned" must mean READY TO ASSIGN — only workable leads. A rejected lead is
  // unassigned too (hard-unassign on reject) but CANNOT be assigned until reactivated,
  // so it stays under Lost/Rejected, never in this queue (Lalit 2026-06-28).
  { name: "Unassigned Leads", test: (r) => !r.ownerId && r.bucket === "Workable" },
  // Teamless AND still workable — a rejected/lost teamless lead is not "awaiting
  // classification", it's done. Mirrors queueAwaitingWhere on the server.
  { name: "Awaiting Classification", test: (r) => r.team === "—" && r.bucket === "Workable" },
  { name: "Dubai Leads", test: (r) => r.team === "Dubai" },
  { name: "India Leads", test: (r) => r.team === "India" },
  { name: "Event Leads", test: (r) => isEventSource(r.source) },
  { name: "Today's Leads", test: (r, t) => r.createdDate === t },
  { name: "Follow Up Today", test: (r, t) => r.followupDate === t },
  { name: "Fresh Leads", test: (r) => r.statusLabel === "Fresh Lead" },
  { name: "Workable Leads", test: (r) => r.bucket === "Workable" },
];

type SavedView = { name: string; filters: Record<string, string[]>; sort: { col: ColKey; dir: "asc" | "desc" } | null; hidden: ColKey[]; frozen: boolean; builtin?: string | null };
const serFilters = (f: Record<string, Set<string>>) => Object.fromEntries(Object.entries(f).filter(([, s]) => s.size).map(([k, s]) => [k, [...s]]));
const deserFilters = (o: Record<string, string[]>) => Object.fromEntries(Object.entries(o || {}).map(([k, a]) => [k, new Set(a)]));

export default function MasterDataRecordsTable({ rows, agents, projects, isSuperAdmin, viewerId }: Props) {
  const router = useRouter();
  // Restore scroll position on Back (open a record → Back returns to the same row).
  useScrollRestore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [statusTo, setStatusTo] = useState("");
  const [teamTo, setTeamTo] = useState("");
  // Assign modal (agent + initial status + follow-up) — replaces the old bare picker.
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignStatus, setAssignStatus] = useState("Not Contacted");
  const [assignFollowup, setAssignFollowup] = useState("");
  const [edit, setEdit] = useState<{ id: string; field: ColKey } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [sort, setSort] = useState<{ col: ColKey; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [pageNo, setPageNo] = useState(0);
  // new V3.1 state
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set(DEFAULT_HIDDEN));
  const [frozen, setFrozen] = useState(true);
  const [activeView, setActiveView] = useState<string | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [colsOpen, setColsOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [preview, setPreview] = useState<MDRow | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const LSKEY = `wcr_md_v31_${viewerId}`;
  const VKEY = `wcr_md_views_${viewerId}`;

  // ── Sticky state: restore last-used filters / columns / freeze / view per admin ──
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LSKEY) || "null");
      if (s) {
        if (Array.isArray(s.hidden)) setHidden(new Set(s.hidden));
        if (typeof s.frozen === "boolean") setFrozen(s.frozen);
        if (s.sort) setSort(s.sort);
        if (s.filters) setFilters(deserFilters(s.filters));
        if (typeof s.activeView === "string") setActiveView(s.activeView);
        // Restore the page number too, so Back returns to the same page of the list
        // (the filters/sort/view already persisted here; pageNo was the missing piece).
        if (typeof s.pageNo === "number" && s.pageNo >= 0) setPageNo(s.pageNo);
      }
      const v = JSON.parse(localStorage.getItem(VKEY) || "null");
      if (Array.isArray(v)) setViews(v);
    } catch { /* ignore corrupt storage */ }
    // A summary-counter deep link can preselect a built-in view via ?view=… (e.g. the
    // Master-Data header "N unassigned" link). URL takes precedence over sticky state.
    try {
      const urlView = new URLSearchParams(window.location.search).get("view");
      if (urlView && BUILTINS.some((b) => b.name === urlView)) setActiveView(urlView);
    } catch { /* no window / malformed URL — ignore */ }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LSKEY, JSON.stringify({ hidden: [...hidden], frozen, sort, filters: serFilters(filters), activeView, pageNo }));
    } catch { /* quota / private mode — non-fatal */ }
  }, [hidden, frozen, sort, filters, activeView, pageNo, hydrated, LSKEY]);

  const persistViews = (next: SavedView[]) => { setViews(next); try { localStorage.setItem(VKEY, JSON.stringify(next)); } catch { /**/ } };

  const filtered = useMemo(() => {
    let out = rows;
    // A built-in can be active directly (activeView is its name) OR captured inside an
    // active SAVED view (v.builtin) — apply it either way so a saved "Today's Leads"
    // view re-runs the test against TODAY (dynamic, not frozen to the save date).
    const bvName = BUILTINS.find((b) => b.name === activeView)?.name
      ?? views.find((v) => v.name === activeView)?.builtin
      ?? null;
    const bv = BUILTINS.find((b) => b.name === bvName);
    if (bv) { const t = todayIST(); out = out.filter((r) => bv.test(r, t)); }
    for (const [col, set] of Object.entries(filters)) {
      if (set.size === 0) continue;
      out = out.filter((r) => set.has(valueOf(r, col as ColKey)));
    }
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) =>
        (sort.col === "createdDate" || sort.col === "createdTime")
          ? (a.createdAtMs - b.createdAtMs) * dir
          : valueOf(a, sort.col).localeCompare(valueOf(b, sort.col), undefined, { numeric: true }) * dir,
      );
    } else {
      // No explicit column sort → canonical section order (Unassigned → India →
      // Dubai → Website → Event → Others), newest-first within each section.
      out = [...out].sort((a, b) => sectionRank(a) - sectionRank(b) || (b.createdAtMs - a.createdAtMs));
    }
    return out;
  }, [rows, filters, sort, activeView, views]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(pageNo, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => (pageRows.every((r) => s.has(r.id)) ? new Set() : new Set([...s, ...pageRows.map((r) => r.id)])));
  const clear = () => setSelected(new Set());

  async function bulk(ids: string[], action: string, extra: Record<string, unknown> = {}) {
    if (busy || ids.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/master-data/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids, ...extra }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? `Failed (${r.status})`); return; }
      if (typeof j.assigned === "number") {
        // Assign returns { assigned, skipped } — skipped = records whose team
        // rejected the chosen status. Surface it so the partial outcome is visible.
        const skipped = typeof j.skipped === "number" ? j.skipped : 0;
        setMsg(`Done — ${j.assigned} assigned${skipped > 0 ? `, ${skipped} skipped (status not valid for their team)` : ""}.`);
      } else {
        setMsg(`Done — ${j.moved ?? j.updated ?? j.deleted ?? j.restored ?? 0} updated.`);
      }
      setEdit(null); router.refresh();
    } catch (e) { setMsg(`Network error: ${String(e).slice(0, 80)}`); }
    finally { setBusy(false); }
  }
  const runBulk = (action: string, extra: Record<string, unknown> = {}) => bulk([...selected], action, extra).then(() => { if (action !== "restore") clear(); });

  async function saveText(id: string, field: string, value: string) {
    return saveFields(id, { [field]: value });
  }

  // THE canonical inline-save: PATCHes /api/leads/[id]/update with an arbitrary
  // field map and, on success, router.refresh() so the force-dynamic page
  // re-pulls from the DB (counts / filters / unassigned-counter all recompute).
  // On failure it surfaces the server error and LEAVES edit mode open so the
  // cell reverts to the DB value (no optimistic/fake save). ownerId routes
  // through assignLeadTo() server-side (Assignment row + notify).
  async function saveFields(id: string, fields: Record<string, unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/leads/${id}/update`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(j.error ?? `Failed (${r.status})`); return false; }
      setEdit(null); router.refresh();
      return true;
    } catch (e) { setMsg(`Network error: ${String(e).slice(0, 80)}`); return false; }
    finally { setBusy(false); }
  }

  // Budget inline-save: parse "2.5M"/"30L"/"3Cr"/digits → raw number, save to
  // budgetMin (the RAW stored value, NOT the converted display). Empty clears it.
  async function saveBudget(id: string, value: string) {
    const v = value.trim();
    if (!v) return saveFields(id, { budgetMin: null });
    const parsed = parseBudget(v);
    if (parsed == null) { setMsg("Couldn't parse budget — try 2.5M, 30L, 3Cr, or digits."); return; }
    return saveFields(id, { budgetMin: parsed });
  }

  const distinctVals = (c: ColKey) => Array.from(new Set(rows.map((r) => valueOf(r, c)))).filter((v) => v !== "").sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const btn = "text-xs font-semibold px-2.5 py-1.5 rounded-lg border whitespace-nowrap disabled:opacity-50";
  const openTextEdit = (id: string, field: ColKey, cur: string) => { setEdit({ id, field }); setEditVal(cur === "—" ? "" : cur); };
  const editing = (id: string, f: ColKey) => edit?.id === id && edit?.field === f;
  const openMenu = (id: string, f: ColKey) => setEdit((e) => (e?.id === id && e?.field === f ? null : { id, field: f }));
  const setColFilter = (c: ColKey, next: Set<string>) => { setFilters((f) => ({ ...f, [c]: next })); setPageNo(0); };
  // Adapt MasterData's values-only filter map to the shared component's shape.
  const mdColFilter = (set: Set<string> | undefined): ColFilterState | undefined =>
    set && set.size ? { values: set, min: "", max: "" } : undefined;

  // ── Views ──
  const applyBuiltin = (name: string) => { setActiveView((a) => (a === name ? null : name)); setPageNo(0); };
  const applyCustom = (v: SavedView) => { setFilters(deserFilters(v.filters)); setSort(v.sort); setHidden(new Set(v.hidden)); setFrozen(v.frozen); setActiveView(v.name); setPageNo(0); };
  const saveCurrentView = () => {
    const name = (window.prompt("Save current filters + columns as a view named:") || "").trim();
    if (!name) return;
    // Capture an active built-in (e.g. "Today's Leads") so the saved view re-runs it
    // dynamically on reopen — Lalit wants "Today's Leads" to always mean the CURRENT day.
    const v: SavedView = { name, filters: serFilters(filters), sort, hidden: [...hidden], frozen, builtin: BUILTINS.some((b) => b.name === activeView) ? activeView : null };
    persistViews([...views.filter((x) => x.name !== name), v]);
    setActiveView(name);
  };
  const deleteView = (name: string) => { persistViews(views.filter((v) => v.name !== name)); if (activeView === name) setActiveView(null); };
  const resetAll = () => { setFilters({}); setSort(null); setActiveView(null); setPageNo(0); };

  // ── Single-click row → preview drawer · double-click name → rename ──
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowClick = (l: MDRow) => { if (clickTimer.current) clearTimeout(clickTimer.current); clickTimer.current = setTimeout(() => { setPreview(l); clickTimer.current = null; }, 200); };
  const cancelRowClick = () => { if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; } };
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const visibleCols = COLS.filter((c) => c.frozen || !hidden.has(c.key));
  const colSpan = visibleCols.length + 1;
  const fStyle = (key: ColKey): React.CSSProperties | undefined => {
    if (!frozen) return undefined;
    const left = FROZEN_LEFT[key];
    if (left == null) return undefined;
    const w = COLS.find((c) => c.key === key)?.w;
    return { position: "sticky", left, zIndex: 10, minWidth: w, maxWidth: w };
  };
  const fClass = (key: ColKey, sel: boolean) =>
    frozen && FROZEN_LEFT[key] != null ? (sel ? "bg-amber-50 dark:bg-slate-800" : "bg-white dark:bg-slate-900") : "";

  // Bulk "Set status" must use ONE team's status master — never a combined
  // India+Dubai list (owner rule). When the selection spans teams (or includes a
  // teamless lead), the status picker is disabled until it's narrowed to one team.
  const selectedTeams = new Set<string>();
  for (const r of rows) if (selected.has(r.id)) selectedTeams.add(r.team);
  const bulkOneTeam = selectedTeams.size === 1 ? [...selectedTeams][0] : "";
  const bulkStatusOptions = bulkOneTeam === "Dubai" || bulkOneTeam === "India" ? [...statusesForTeam(bulkOneTeam)].sort(compareStatusDisplay) : [];

  // ── Assign modal — status options + handlers ──────────────────────────────
  // Status list = the team master MINUS every terminal (Lost/Rejected/Booked)
  // status; default "Not Contacted". Owner rule (never a combined India+Dubai
  // master): only a single-team selection exposes that team's statuses — a
  // multi-team / teamless selection offers just the universal default, so two
  // masters are never blended. "Not Contacted" is always present so the default
  // is selectable even for a Dubai-only selection (server skips per-team-invalid).
  const assignStatusOptions = (() => {
    // Mirror bulkStatusOptions' guard EXACTLY: only a wholly-Dubai or wholly-India
    // selection exposes that team's master. Mixed OR teamless ("—") → [] → just the
    // universal default below, so a combined India+Dubai list is never shown.
    const base = bulkOneTeam === "Dubai" || bulkOneTeam === "India"
      ? [...statusesForTeam(bulkOneTeam)].filter((s) => !TERMINAL_STATUSES.includes(s))
      : [];
    if (!base.includes("Not Contacted")) base.unshift("Not Contacted");
    return [...new Set(base)].sort(compareStatusDisplay);
  })();
  const assignAgentName = agents.find((a) => a.id === assignTo)?.name ?? "";

  const openAssign = () => {
    if (busy) return;
    setAssignTo("");
    setAssignStatus("Not Contacted");
    setAssignFollowup(toLocalDatetimeValue(new Date(Date.now() + 15 * 60_000)));
    setAssignOpen(true);
  };
  const submitAssign = () => {
    if (busy || !assignTo || !assignFollowup) return;
    // datetime-local is a zone-less LOCAL wall-clock string; new Date() parses it
    // as local, .toISOString() gives the unambiguous UTC ISO 8601 the API expects.
    const followupDate = new Date(assignFollowup).toISOString();
    setAssignOpen(false);
    runBulk("assign", { userId: assignTo, status: assignStatus, followupDate });
  };
  // Escape closes the assign modal (backdropProps handles the backdrop click).
  useEffect(() => {
    if (!assignOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAssignOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assignOpen]);

  // Export EXACTLY the rows currently on screen — i.e. after the active builtin /
  // Saved View + every column-header filter + sort. POSTs the resolved id-set to
  // the audited, watermarked export so the CSV == the visible table (the old GET
  // link only knew the URL params and silently ignored the client filters).
  async function exportFiltered(format: "csv" | "xlsx" = "csv") {
    const ids = filtered.map((r) => r.id);
    if (ids.length === 0) { setMsg("Nothing to export — no rows match the current filters."); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/reports/export?format=${format}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids }),
      });
      if (!r.ok) { setMsg(`Export failed (${r.status}).`); return; }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `wcr-master-data-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      setMsg(`Exported ${ids.length} row${ids.length === 1 ? "" : "s"} (exactly the current view).`);
    } catch (e) { setMsg(`Export error: ${String(e).slice(0, 80)}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      {/* ── Saved Views + Columns + Freeze toolbar ─────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setActiveView(null)} className={`${btn} ${!activeView ? "bg-[#0b1a33] text-white border-[#0b1a33]" : "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300"}`}>All</button>
        {BUILTINS.map((v) => (
          <button key={v.name} onClick={() => applyBuiltin(v.name)} className={`${btn} ${activeView === v.name ? "bg-blue-600 text-white border-blue-600" : "bg-blue-50/60 dark:bg-slate-800 border-blue-200 dark:border-slate-600 text-blue-800 dark:text-blue-300"}`}>{v.name}</button>
        ))}
        {views.map((v) => (
          <span key={v.name} className={`${btn} inline-flex items-center gap-1 ${activeView === v.name ? "bg-violet-600 text-white border-violet-600" : "bg-violet-50 dark:bg-slate-800 border-violet-200 dark:border-slate-600 text-violet-800 dark:text-violet-300"}`}>
            <button onClick={() => applyCustom(v)}>★ {v.name}</button>
            <button onClick={() => deleteView(v.name)} title="Delete view" className="opacity-60 hover:opacity-100">×</button>
          </span>
        ))}
        <button onClick={saveCurrentView} className={`${btn} bg-white dark:bg-slate-800 border-dashed border-gray-300 dark:border-slate-600 text-gray-500`}>＋ Save view</button>

        <span className="ml-auto inline-flex items-center gap-1.5">
          {/* Export — OWNER (Super Admin) only, matching the server gate. CSV + Excel. */}
          {isSuperAdmin && (
            <>
              <button onClick={() => exportFiltered("csv")} disabled={busy} className={`${btn} bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 disabled:opacity-50`} title="Export exactly the rows shown (after view + column filters) to CSV">⬇ CSV ({filtered.length})</button>
              <button onClick={() => exportFiltered("xlsx")} disabled={busy} className={`${btn} bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 disabled:opacity-50`} title="Export exactly the rows shown (after view + column filters) to Excel">⬇ Excel</button>
            </>
          )}
          <button onClick={() => setFrozen((f) => !f)} className={`${btn} ${frozen ? "bg-sky-50 text-sky-700 border-sky-300" : "bg-white dark:bg-slate-800 text-gray-500 border-gray-200 dark:border-slate-600"}`} title="Freeze Created Date / Time / Client Name while scrolling">❄ Freeze {frozen ? "On" : "Off"}</button>
          <span className="relative">
            <button onClick={() => setColsOpen((o) => !o)} className={`${btn} bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300`}>⚙ Columns</button>
            {colsOpen && (
              <div className="absolute right-0 z-40 mt-1 w-48 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl p-2 text-xs font-normal">
                <div className="font-semibold text-gray-500 mb-1 px-1">Show columns</div>
                {COLS.filter((c) => HIDEABLE.includes(c.key)).map((c) => (
                  <label key={c.key} className="flex items-center gap-2 px-1 py-0.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 rounded">
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((h) => { const n = new Set(h); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })} />
                    <span>{c.label}</span>
                  </label>
                ))}
                <div className="text-[10px] text-gray-400 mt-1 px-1 border-t pt-1 border-gray-100 dark:border-slate-700">Created Date · Time · Client Name stay frozen</div>
              </div>
            )}
          </span>
          {(Object.values(filters).some((s) => s.size) || sort || activeView) && (
            <button onClick={resetAll} className={`${btn} bg-white dark:bg-slate-800 text-gray-400 border-gray-200 dark:border-slate-600`}>✕ Reset</button>
          )}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-0 z-30 card p-2.5 flex flex-wrap items-center gap-2 border border-[#c9a24b]/40 bg-amber-50/60 dark:bg-slate-800">
          <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">{selected.size} selected</span>
          <button disabled={busy} onClick={openAssign} className={`${btn} bg-blue-50 text-blue-800 border-blue-300`}>Assign…</button>
          <span className="inline-flex items-center gap-1">
            <select value={teamTo} onChange={(e) => setTeamTo(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600"><option value="">Team…</option>{TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <button disabled={busy || !teamTo} onClick={() => runBulk("change_team", { team: teamTo })} className={`${btn} bg-teal-50 text-teal-800 border-teal-300`}>Change team</button>
          </span>
          <span className="inline-flex items-center gap-1">
            <select value={statusTo} onChange={(e) => setStatusTo(e.target.value)} disabled={bulkStatusOptions.length === 0} className="text-xs border rounded-lg px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600 disabled:opacity-50" title={bulkStatusOptions.length === 0 ? "Select leads from a single team to set status" : undefined}><option value="">{bulkStatusOptions.length ? `Status… (${bulkOneTeam})` : "Status… (one team only)"}</option>{bulkStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <button disabled={busy || !statusTo} onClick={() => runBulk("set_status", { status: statusTo })} className={`${btn} bg-violet-50 text-violet-800 border-violet-300`}>Set</button>
          </span>
          <button disabled={busy} onClick={() => runBulk("move_to_revival")} className={`${btn} bg-sky-50 text-sky-800 border-sky-300`}>→ Revival</button>
          <button disabled={busy} onClick={() => runBulk("move_to_leads")} className={`${btn} bg-emerald-50 text-emerald-800 border-emerald-300`}>→ Leads</button>
          {isSuperAdmin && <button disabled={busy} onClick={() => { if (confirm(`Soft-delete ${selected.size} record(s)? They move to Archived and stay recoverable.`)) runBulk("soft_delete"); }} className={`${btn} bg-red-50 text-red-700 border-red-300`}>Delete</button>}
          <button onClick={clear} className={`${btn} bg-white text-gray-500 border-gray-200 ml-auto`}>Clear</button>
          {msg && <span className="text-xs text-gray-600 dark:text-slate-300 w-full">{msg}</span>}
        </div>
      )}
      {!selected.size && msg && <div className="text-xs text-gray-600 dark:text-slate-300">{msg}</div>}

      {/* ─── DESKTOP EXCEL GRID (sm:+) — frozen columns, CellEditPopover inline edit,
            ColumnHeaderFilter, bulk-select. Hidden on phones, where the card block
            below takes over (the wide horizontal-scroll grid is unusable < 640px). ─── */}
      <div className="hidden sm:block card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-[#e5e7eb] dark:border-slate-600">
              <th className="px-3 py-2 w-8 bg-white dark:bg-slate-800" style={frozen ? { position: "sticky", left: 0, zIndex: 20 } : undefined}>
                <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all" />
              </th>
              {visibleCols.map((c) => {
                const fz = frozen && FROZEN_LEFT[c.key] != null;
                // Date columns sort on the underlying ms (handled in `filtered`);
                // everything filters as multi-select text — so the shared
                // ColumnHeaderFilter runs in "text"/"select" mode here. The Status
                // column keeps the canonical order (no forced A→Z).
                const kind = c.key === "status" ? "select" : "text";
                return (
                  <th key={c.key} className={`px-3 py-2 font-semibold relative ${fz ? "bg-white dark:bg-slate-800" : ""}`} style={fz ? { ...fStyle(c.key), zIndex: 20 } : (c.minW ? { minWidth: c.minW } : undefined)}>
                    <span className="inline-flex items-center gap-1">
                      <span onClick={() => setSort((s) => s?.col === c.key ? { col: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { col: c.key, dir: "asc" })} className="cursor-pointer hover:text-[#0b1a33] dark:hover:text-blue-300">{c.label}</span>
                      <ColumnHeaderFilter
                        label={c.label}
                        kind={kind}
                        sortActive={sort?.col === c.key}
                        sortDir={sort?.dir ?? "asc"}
                        onSort={(dir) => setSort({ col: c.key, dir })}
                        filter={mdColFilter(filters[c.key])}
                        onApply={(next: ColFilterState) => setColFilter(c.key, next.values)}
                        options={distinctVals(c.key)}
                      />
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-gray-400">No records match these filters.</td></tr>}
            {pageRows.map((l) => {
              const sel = selected.has(l.id);
              return (
              <tr key={l.id} onClick={() => rowClick(l)} onDoubleClick={cancelRowClick}
                className={`border-b border-[#f1f5f9] dark:border-slate-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 ${sel ? "bg-amber-50/50 dark:bg-slate-700/40" : ""}`}>
                <td className={`px-3 py-2 ${fClass("name", sel) ? "" : ""}`} style={frozen ? { position: "sticky", left: 0, zIndex: 10 } : undefined} onClick={stop}>
                  <span className={frozen ? (sel ? "bg-amber-50 dark:bg-slate-800" : "bg-white dark:bg-slate-900") : ""}><input type="checkbox" checked={sel} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} /></span>
                </td>
                {visibleCols.map((c) => {
                  const fz = frozen && FROZEN_LEFT[c.key] != null;
                  const cellCls = `px-3 py-2 relative ${fz ? fClass(c.key, sel) : ""}`;
                  switch (c.key) {
                    case "name":
                      return (
                        <td key={c.key} className={cellCls} style={fStyle(c.key)}>
                          {editing(l.id, "name")
                            ? <span onClick={stop}><InlineInput value={editVal} onChange={setEditVal} onSave={() => saveText(l.id, "name", editVal)} onCancel={() => setEdit(null)} /></span>
                            : <span onDoubleClick={(e) => { stop(e); openTextEdit(l.id, "name", l.name); }} title="Click = preview · double-click = rename" className="font-semibold text-[#0b1a33] dark:text-blue-300 hover:underline">{formatLeadName(l.name)}</span>}
                        </td>
                      );
                    case "agent": {
                      // "Unassigned for X — please assign" urgency only for WORKABLE
                      // unassigned. A rejected/terminal lead is unassigned (hard-unassign)
                      // but must NOT show the assign-me urgency badge.
                      const ageBadge = hydrated && !l.ownerId && l.bucket === "Workable" ? unassignedAgeBadge(l.createdAtMs) : null;
                      // Inline-assign routes through ownerId on the update route →
                      // assignLeadTo() (Assignment history row + notify + SLA), so
                      // the Agent Performance report (assignment-history attribution)
                      // and the new owner's notification both stay correct.
                      const agentOpts = [
                        { value: "", label: l.ownerId ? "⚠ Unassign" : "— Unassigned —" },
                        ...agents.map((a) => ({ value: a.id, label: a.name })),
                      ];
                      return (
                        <td key={c.key} className={`${cellCls} whitespace-nowrap`} style={fStyle(c.key)} onClick={stop}>
                          <MenuCell
                            open={editing(l.id, "agent")}
                            onToggle={() => openMenu(l.id, "agent")}
                            onClose={() => setEdit(null)}
                            label={l.owner}
                            title="Click to assign"
                            triggerClass="text-gray-700 dark:text-slate-300 hover:underline"
                            options={agentOpts}
                            onPick={(v) => saveText(l.id, "ownerId", v)}
                            busy={busy}
                            after={ageBadge ? <span className={`ml-1.5 align-middle text-[9px] px-1.5 py-0.5 rounded-full border ${ageBadge.cls}`} title="Unassigned for this long — please assign">{ageBadge.label}</span> : null}
                          />
                        </td>
                      );
                    }
                    case "previousOwner":
                      // Historical, READ-ONLY — the last working agent stashed on
                      // Lead.previousOwnerId when a Lost/Rejected lead was unassigned.
                      // Plain text (never a MenuCell): you don't re-assign the past.
                      return <td key={c.key} className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap">{l.previousOwner || "—"}</td>;
                    case "team":
                      // forwardedTeam via the update route — it re-validates the
                      // existing status against the NEW team's master (→ Needs Review
                      // if invalid), same rule as the bulk endpoint. router.refresh
                      // after so counts/filters update.
                      return (
                        <td key={c.key} className={cellCls} style={fStyle(c.key)} onClick={stop}>
                          <MenuCell
                            open={editing(l.id, "team")}
                            onToggle={() => openMenu(l.id, "team")}
                            onClose={() => setEdit(null)}
                            label={l.team}
                            title="Click to set team"
                            triggerClass="text-gray-700 dark:text-slate-300 hover:underline"
                            options={TEAMS.map((t) => ({ value: t, label: t }))}
                            onPick={(v) => saveText(l.id, "forwardedTeam", v)}
                            busy={busy}
                          />
                        </td>
                      );
                    case "createdDate":
                      return <td key={c.key} className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap text-xs tabular-nums">{l.createdDate}</td>;
                    case "createdTime":
                      return <td key={c.key} className="px-3 py-2 text-gray-500 dark:text-slate-400 whitespace-nowrap text-xs tabular-nums">{l.createdTime}</td>;
                    case "budget":
                      // Read view = displayBudget() (already computed in l.budget;
                      // Dubai-team INR converts to AED). Edit operates on the RAW
                      // stored budgetMin — saveBudget parses 2.5M/30L/3Cr→number and
                      // saves budgetMin (no double-convert). Edit field starts EMPTY
                      // (the read cell shows a converted/formatted string, not the
                      // raw number, so pre-filling it would be misleading).
                      return (
                        <td key={c.key} className="px-3 py-2 relative whitespace-nowrap" onClick={stop}>
                          {editing(l.id, "budget")
                            ? <InlineInput value={editVal} onChange={setEditVal} onSave={() => saveBudget(l.id, editVal)} onCancel={() => setEdit(null)} placeholder="e.g. 5 Cr / 2.5M / 30L" />
                            : <button onClick={() => { setEdit({ id: l.id, field: "budget" }); setEditVal(""); }} className="text-gray-700 dark:text-slate-300 hover:underline" title="Click to edit (type 2.5M · 30L · 3Cr · digits)">{l.budget}</button>}
                        </td>
                      );
                    case "project":
                      // Property Enquired = free-text sourceDetail. The picker SEARCHES
                      // the Project Master (team-aware) to help pick a known name, but
                      // also accepts manual free-text when the project isn't found —
                      // the chosen NAME is stored in sourceDetail (never a forced Project
                      // mapping). Dropdown renders via a PORTAL so the grid's horizontal
                      // scroll/overflow never clips it.
                      return (
                        <td key={c.key} className="px-3 py-2 relative max-w-[180px]" onClick={stop}>
                          {editing(l.id, "project")
                            ? <ProjectPickerCell
                                team={l.team}
                                projects={projects}
                                initial={l.project === "—" ? "" : l.project}
                                busy={busy}
                                onSave={(name) => saveFields(l.id, { sourceDetail: name || null })}
                                onCancel={() => setEdit(null)}
                              />
                            : <button onClick={() => openTextEdit(l.id, "project", l.project)} className="text-gray-600 dark:text-slate-400 hover:underline truncate block max-w-[180px]" title={l.project}>{l.project}</button>}
                        </td>
                      );
                    case "propertyType":
                      // Editable dropdown — Residential / Commercial / Mixed Use ONLY.
                      // (Was previously MISSING, which shifted every later column left
                      // so Source values appeared under the Property Type header.)
                      return (
                        <td key={c.key} className="px-3 py-2 relative whitespace-nowrap" onClick={stop}>
                          <MenuCell
                            open={editing(l.id, "propertyType")}
                            onToggle={() => openMenu(l.id, "propertyType")}
                            onClose={() => setEdit(null)}
                            label={l.propertyType || <span className="text-gray-300 dark:text-slate-600">—</span>}
                            title="Click to set property type"
                            triggerClass="text-gray-700 dark:text-slate-300 hover:underline"
                            options={[{ value: "", label: "— clear —" }, ...PROPERTY_TYPES.map((p) => ({ value: p, label: p }))]}
                            onPick={(v) => saveText(l.id, "propertyType", v)}
                            busy={busy}
                          />
                        </td>
                      );
                    case "source":
                      // Cleaned Source list (single "Website"; no Call/WhatsApp/Email/
                      // Event; WCR Event kept). Saves BOTH the LeadSource enum (source)
                      // and the human label (sourceRaw) so they stay consistent. The
                      // update route gates source/sourceRaw to Admin/Super-Admin — fine,
                      // Master Data is admin-only.
                      return (
                        <td key={c.key} className="px-3 py-2 relative whitespace-nowrap" onClick={stop}>
                          <MenuCell
                            open={editing(l.id, "source")}
                            onToggle={() => openMenu(l.id, "source")}
                            onClose={() => setEdit(null)}
                            label={l.sourceLabel}
                            title="Click to set source"
                            triggerClass="text-gray-600 dark:text-slate-400 hover:underline"
                            options={SOURCE_OPTIONS}
                            onPick={(v) => {
                              const opt = SOURCE_OPTIONS.find((s) => s.value === v);
                              saveFields(l.id, { source: v, sourceRaw: opt?.label ?? v });
                            }}
                            busy={busy}
                          />
                        </td>
                      );
                    case "medium":
                      // Contact medium (Call / WhatsApp / Email / Other + custom). "Other"
                      // opens a free-text input for a custom medium (stored in mediumOther).
                      // The editor is portal-floated (CellEditPopover inside MediumPickerCell)
                      // so the grid's overflow-x never clips it; the read trigger stays in
                      // place so the row height doesn't jump.
                      return (
                        <td key={c.key} className="px-3 py-2 relative whitespace-nowrap" onClick={stop}>
                          <MediumPickerCell
                            open={editing(l.id, "medium")}
                            onToggle={() => openMenu(l.id, "medium")}
                            display={valueOf(l, "medium")}
                            initialMedium={l.medium}
                            initialOther={l.mediumOther ?? ""}
                            busy={busy}
                            onSave={(medium, mediumOther) => saveFields(l.id, { medium: medium || null, mediumOther: medium === "Other" ? mediumOther : null })}
                            onCancel={() => setEdit(null)}
                          />
                        </td>
                      );
                    case "message":
                      return (
                        <td key={c.key} className="px-3 py-2 max-w-[200px]">
                          {l.message
                            ? <span className="text-gray-600 dark:text-slate-400 truncate block max-w-[200px]" title={l.message}>{l.message}</span>
                            : <span className="text-gray-300 dark:text-slate-600">—</span>}
                        </td>
                      );
                    case "status":
                      return (
                        <td key={c.key} className="px-3 py-2 relative whitespace-nowrap min-w-[150px]" onClick={stop}>
                          <MenuCell
                            open={editing(l.id, "status")}
                            onToggle={() => openMenu(l.id, "status")}
                            onClose={() => setEdit(null)}
                            label={l.statusLabel ? <span className={`text-xs px-2 py-0.5 rounded-full ${l.statusClass}`}>{l.statusLabel}</span> : <span className="text-xs text-gray-400 italic">— set —</span>}
                            title="Click to change status"
                            options={statusMenuOptions(l.team, l.statusLabel)}
                            onPick={(v) => v && bulk([l.id], "set_status", { status: v })}
                            busy={busy}
                          />
                        </td>
                      );
                    case "bucket":
                      return (
                        <td key={c.key} className="px-3 py-2 relative" onClick={stop}>
                          <MenuCell
                            open={editing(l.id, "bucket")}
                            onToggle={() => openMenu(l.id, "bucket")}
                            onClose={() => setEdit(null)}
                            label={<span className={`text-xs px-2 py-0.5 rounded-full border ${l.bucketClass}`}>{l.bucket}</span>}
                            options={[{ value: "move_to_revival", label: "→ Revival (cold)" }, { value: "move_to_leads", label: "→ Active (leads)" }]}
                            onPick={(v) => bulk([l.id], v)}
                            busy={busy}
                          />
                        </td>
                      );
                    case "email":
                      return <td key={c.key} className="px-3 py-2 text-gray-600 dark:text-slate-400 max-w-[180px]"><span className="truncate block max-w-[180px]" title={l.email}>{l.email || "—"}</span></td>;
                    case "phone":
                      return <td key={c.key} className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap tabular-nums">{l.phone || "—"}</td>;
                  }
                })}
              </tr>
            );})}
          </tbody>
        </table>
      </div>

      {/* ─── MOBILE CARDS (< sm) — dedicated layout, not a shrunken Excel grid. Mirrors
            the Leads mobile cards for visual consistency. Tap the card → existing
            Preview drawer; the ✏️ chip opens the same per-cell editors as desktop. ─── */}
      <div className="sm:hidden space-y-2">
        {pageRows.length === 0 && <div className="card p-5 text-center text-gray-400 text-sm">No records match these filters.</div>}
        {pageRows.map((l) => {
          const sel = selected.has(l.id);
          const ageBadge = hydrated && !l.ownerId ? unassignedAgeBadge(l.createdAtMs) : null;
          return (
            <div key={l.id} onClick={() => setPreview(l)}
              className={`bg-white dark:bg-slate-800 rounded-xl border p-3 shadow-sm ${sel ? "border-[#c9a24b]/60 bg-amber-50/40 dark:bg-slate-700/40" : "border-gray-100 dark:border-slate-700"}`}>
              {/* Row 1: checkbox + Name + Status chip */}
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="flex items-center gap-2 min-w-0">
                  <input type="checkbox" checked={sel} onClick={(e) => e.stopPropagation()} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} className="shrink-0" />
                  <span className="font-bold text-sm text-[#0b1a33] dark:text-white truncate">{formatLeadName(l.name)}</span>
                </span>
                {l.statusLabel
                  ? <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${l.statusClass}`}>{l.statusLabel}</span>
                  : <span className="text-[10px] text-gray-400 italic shrink-0">— no status —</span>}
              </div>
              {/* Row 2: Owner/Agent · Team · Phone */}
              <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400 mb-1 flex-wrap">
                <span className="flex items-center gap-1">👤 <span className="text-gray-700 dark:text-slate-300 font-medium">{l.owner}</span></span>
                {l.team && l.team !== "—" && <span className="flex items-center gap-1">🏷 {l.team}</span>}
                {l.phone && <span className="flex items-center gap-1 font-mono tabular-nums">📞 {l.phone}</span>}
                {ageBadge && <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${ageBadge.cls}`} title="Unassigned for this long — please assign">{ageBadge.label}</span>}
              </div>
              {/* Row 3: Property Enquired · Budget · Source */}
              <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-slate-400 mb-1 flex-wrap">
                {l.project && l.project !== "—" && <span className="truncate max-w-[60%]">🏗 <span className="font-medium">{l.project}</span></span>}
                {l.budget && <span className="text-gray-700 dark:text-slate-300 font-medium">💰 {l.budget}</span>}
                {l.sourceLabel && <span>🔗 {l.sourceLabel}</span>}
              </div>
              {/* Row 4: Follow-up date */}
              {l.followupDate && (
                <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mb-2">📅 Follow-up: <span className="font-medium">{l.followupDate}</span></div>
              )}
              {/* Row 5: tap targets — Preview drawer + Open full lead */}
              <div className="flex items-center gap-1 pt-2 border-t border-gray-50 dark:border-slate-700 [&>*]:flex-1">
                <button onClick={(e) => { e.stopPropagation(); setPreview(l); }}
                  className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-amber-700 bg-amber-50 dark:bg-amber-900/20 text-xs font-medium min-h-9">
                  ✏️ Preview / Edit
                </button>
                <Link href={l.href} onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-xs font-medium min-h-9">
                  Open →
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
        <span>{filtered.length} of {rows.length} · single-click = preview · double-click Name / click a cell to edit (admin)</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={safePage === 0} onClick={() => setPageNo(Math.max(0, safePage - 1))} className="btn btn-ghost disabled:opacity-40">← Prev</button>
            <span>Page {safePage + 1} / {totalPages}</span>
            <button disabled={safePage >= totalPages - 1} onClick={() => setPageNo(Math.min(totalPages - 1, safePage + 1))} className="btn btn-ghost disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>

      {preview && <PreviewDrawer l={preview} onClose={() => setPreview(null)} />}

      {/* ── Assign modal (agent + status + follow-up) — Lalit 2026-07-10. Backdrop
            uses backdropProps so a drag-select inside the box never closes it;
            Escape + Cancel + Assign all close. Acts on the CURRENT selection. ── */}
      {assignOpen && selected.size > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4"
          {...backdropProps(() => setAssignOpen(false))}
          role="dialog"
          aria-modal="true"
          aria-labelledby="md-assign-title"
        >
          <div
            className="bg-white dark:bg-slate-900 sm:rounded-xl rounded-t-2xl border border-gray-200 dark:border-slate-700 w-full max-w-md p-5 shadow-2xl max-h-[90vh] overflow-y-auto safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <div id="md-assign-title" className="font-semibold text-lg text-[#0b1a33] dark:text-blue-200">
                Assign {selected.size} record{selected.size === 1 ? "" : "s"}
              </div>
              <button type="button" onClick={() => setAssignOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">Choose the agent, the status to apply, and when to follow up.</p>

            {/* 1 · Assign To */}
            <label htmlFor="md-assign-agent" className="text-xs font-semibold text-gray-600 dark:text-slate-300">
              Assign To <span className="text-red-600">*</span>
            </label>
            <select
              id="md-assign-agent"
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              disabled={busy}
              className="w-full mt-1 mb-3 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">Assign to…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>

            {/* 2 · New Status — workable statuses only, pre-selected "Not Contacted" */}
            <label htmlFor="md-assign-status" className="text-xs font-semibold text-gray-600 dark:text-slate-300">New Status</label>
            <select
              id="md-assign-status"
              value={assignStatus}
              onChange={(e) => setAssignStatus(e.target.value)}
              disabled={busy}
              className="w-full mt-1 mb-3 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100"
            >
              {assignStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            {/* 3 · Follow-up date & time — defaults to now + 15 min (user's local time) */}
            <label htmlFor="md-assign-followup" className="text-xs font-semibold text-gray-600 dark:text-slate-300">Follow-up Date &amp; Time</label>
            <input
              id="md-assign-followup"
              type="datetime-local"
              value={assignFollowup}
              onChange={(e) => setAssignFollowup(e.target.value)}
              disabled={busy}
              className="w-full mt-1 mb-3 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100"
            />

            {/* Preview + confirmation (exact counts / chosen values) */}
            <p className="text-xs text-gray-700 dark:text-slate-300 bg-amber-50 dark:bg-slate-800 border border-amber-200 dark:border-slate-700 rounded-lg px-3 py-2">
              {assignTo
                ? <>You are about to assign <strong>{selected.size} selected record{selected.size === 1 ? "" : "s"}</strong> to <strong>{assignAgentName}</strong> with status <strong>{assignStatus}</strong> and follow-up <strong>{fmtLocalFollowup(assignFollowup)}</strong>.</>
                : <>Choose an agent above to continue.</>}
            </p>

            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setAssignOpen(false)} disabled={busy} className="btn btn-ghost">Cancel</button>
              <button type="button" onClick={submitAssign} disabled={busy || !assignTo || !assignFollowup} className="btn bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60">
                {busy ? "Assigning…" : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewDrawer({ l, onClose }: { l: MDRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const Field = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-slate-500">{label}</div>
      <div className={`text-sm text-gray-800 dark:text-slate-200 ${mono ? "tabular-nums" : ""}`}>{value || "—"}</div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-none sm:max-w-md h-full bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-700 px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold text-[#0b1a33] dark:text-blue-200">{formatLeadName(l.name)}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {l.statusLabel && <span className={`text-[11px] px-2 py-0.5 rounded-full ${l.statusClass}`}>{l.statusLabel}</span>}
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${l.bucketClass}`}>{l.bucket}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-xl leading-none">×</button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Field label="Phone" value={l.phone} mono />
          <Field label="Assigned Agent" value={l.owner} />
          <Field label="Email" value={l.email} />
          <Field label="Team" value={l.team} />
          <Field label="Budget" value={l.budget} />
          <Field label="Property Enquired" value={l.project} />
          <Field label="Source" value={l.sourceLabel} />
          <Field label="Created" value={`${l.createdDate} · ${l.createdTime}`} />
        </div>
        <div className="px-4 pb-2">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-1">Message (what the client wrote)</div>
          <div className="text-sm text-gray-800 dark:text-slate-200 whitespace-pre-wrap bg-gray-50 dark:bg-slate-800 rounded-lg p-2.5 max-h-44 overflow-y-auto">{l.message || "— no message —"}</div>
        </div>
        <div className="px-4 pb-4">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-1">Last Remark</div>
          <div className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap bg-gray-50 dark:bg-slate-800 rounded-lg p-2.5 max-h-40 overflow-y-auto">{l.lastRemark || "— no remarks yet —"}</div>
        </div>
        <div className="px-4 pb-6">
          <Link href={l.href} className="block w-full text-center bg-[#0b1a33] text-white rounded-lg py-2 text-sm font-semibold hover:bg-[#142a4f]">Open full lead →</Link>
        </div>
      </div>
    </div>
  );
}

// ── Shared floating cell-edit popover ─────────────────────────────────────────
// EVERY editable-cell dropdown renders THROUGH this wrapper. It portals to
// document.body and fixes itself to the trigger element's bounding rect (re-
// measured on open + on scroll/resize), exactly like ColumnHeaderFilter. This
// is THE fix for the reported bug: the old <Menu> used `absolute` inside the
// <td>, so the grid's `overflow-x-auto` clipped it and the frozen columns'
// stacking contexts (z-10/20) buried it. A portal escapes both — the panel now
// floats above ALL table layers, never clipped, never behind, correct width.
//
//   • position: fixed at the trigger's bottom-left, width ≥ trigger width
//     (clamped to a sensible min/max and kept inside the viewport).
//   • flips ABOVE the trigger when it would overflow the bottom of the screen.
//   • click-outside (transparent backdrop) + Esc close it.
//   • the cell's read view never moves — only this overlay paints — so the row
//     height never jumps and the table layout never shifts.
function CellEditPopover({
  anchorRef, onClose, minWidth = 176, maxWidth = 280, children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  minWidth?: number;
  maxWidth?: number;
  children: React.ReactNode;
}) {
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxH: number; flip: boolean } | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(maxWidth, Math.max(minWidth, r.width));
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      // Flip above only when there's clearly more room up top and not enough below.
      const flip = below < 180 && above > below;
      const maxH = Math.max(140, Math.min(320, flip ? above : below));
      const top = flip ? r.top : r.bottom;
      setBox({ left, top, width, maxH, flip });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!box || typeof document === "undefined") return null;
  return createPortal(
    <>
      {/* transparent click-outside catcher */}
      <div className="fixed inset-0 z-[9998]" onMouseDown={onClose} />
      <div
        style={{
          position: "fixed",
          left: box.left,
          top: box.top,
          width: box.width,
          maxHeight: box.maxH,
          zIndex: 9999,
          ...(box.flip ? { transform: "translateY(-100%)" } : {}),
        }}
        className="overflow-auto rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-2xl text-xs"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

// Simple option list rendered inside the floating popover. Anchored to the
// cell's trigger button (passed as anchorRef) so it floats above the grid.
function Menu({ options, onPick, busy, anchorRef, onClose }: {
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
  busy: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  return (
    <CellEditPopover anchorRef={anchorRef} onClose={onClose}>
      {options.map((o) => (
        <button key={o.value} disabled={busy} onClick={() => onPick(o.value)} className="block w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50">{o.label}</button>
      ))}
    </CellEditPopover>
  );
}

// ── Self-contained editable dropdown cell ─────────────────────────────────────
// The trigger button + its floating Menu, sharing one ref. Used by Agent / Team /
// Property Type / Source / Status / Bucket. The trigger stays in normal table
// flow (read view never moves); the Menu portals out via CellEditPopover so it
// floats above every table layer — the fix for the clipped/buried dropdown.
function MenuCell({
  open, onToggle, onClose, label, title, triggerClass, options, onPick, busy, after,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  label: React.ReactNode;
  title?: string;
  triggerClass?: string;
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
  busy: boolean;
  after?: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={onToggle} className={triggerClass} title={title}>{label}</button>
      {after}
      {open && <Menu busy={busy} options={options} onPick={onPick} anchorRef={triggerRef} onClose={onClose} />}
    </>
  );
}

function InlineInput({ value, onChange, onSave, onCancel, placeholder }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void; placeholder?: string }) {
  return (
    <input autoFocus value={value} placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
      onBlur={onSave}
      className="w-full min-w-[90px] px-2 py-1 text-sm border border-blue-400 rounded dark:bg-slate-700" />
  );
}

// ── Property-Enquired picker ──────────────────────────────────────────────────
// Searchable Project-Master picker with a free-text fallback. The dropdown is
// rendered in a PORTAL (document.body) and positioned from the input's
// bounding rect, so the grid's overflow-x-auto can NEVER clip it (the old bug:
// the menu was absolute inside an overflow:hidden cell and got cut off). The
// VALUE stored is always the project NAME string → sourceDetail (free-text);
// selecting a master project just fills that name. Manual typing + Enter saves
// the typed text verbatim — no forced Project mapping.
function ProjectPickerCell({
  team, projects, initial, busy, onSave, onCancel,
}: {
  team: string;
  projects: { id: string; name: string; city: string; country: string }[];
  initial: string;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState(initial);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Team → country, so an admin editing an India lead sees India projects first
  // (admin sees ALL markets — we don't HIDE, just rank the lead's market up).
  const leadCountry = team === "Dubai" ? "UAE" : team === "India" ? "India" : "";

  const measure = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom, width: Math.max(r.width, 220) });
  };
  useEffect(() => {
    measure();
    setTimeout(() => inputRef.current?.focus(), 0);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("scroll", measure, true); window.removeEventListener("resize", measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matches = useMemo(() => {
    const nq = norm(q);
    const ranked = [...projects].sort((a, b) => {
      // lead-market projects first, then by name
      const am = leadCountry && a.country === leadCountry ? 0 : 1;
      const bm = leadCountry && b.country === leadCountry ? 0 : 1;
      return am !== bm ? am - bm : a.name.localeCompare(b.name);
    });
    if (!nq) return ranked.slice(0, 50);
    return ranked.filter((p) => norm(`${p.name} ${p.city}`).includes(nq)).slice(0, 50);
  }, [projects, q, leadCountry]);

  const exactExists = matches.some((m) => m.name.toLowerCase() === q.trim().toLowerCase());

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(matches.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[highlight];
      // Prefer the highlighted match's NAME; else save the raw typed text (free-text).
      onSave((m && q.trim() && norm(`${m.name} ${m.city}`).includes(norm(q)) ? m.name : q).trim());
    } else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  }

  return (
    <>
      <input
        ref={inputRef}
        value={q}
        disabled={busy}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { setQ(e.target.value); setHighlight(0); }}
        onKeyDown={onKey}
        placeholder="Search project or type a name…"
        className="w-full min-w-[120px] px-2 py-1 text-sm border border-blue-400 rounded dark:bg-slate-700"
        autoComplete="off"
      />
      {rect && typeof document !== "undefined" && createPortal(
        <div
          className="fixed z-[100] max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-2xl text-sm"
          style={{ left: rect.left, top: rect.top + 2, width: rect.width }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.map((p, idx) => (
            <button
              key={p.id}
              onClick={() => onSave(p.name)}
              onMouseEnter={() => setHighlight(idx)}
              className={`block w-full text-left px-3 py-1.5 border-b border-gray-50 dark:border-slate-700 last:border-b-0 ${idx === highlight ? "bg-amber-50 dark:bg-slate-700" : "hover:bg-gray-50 dark:hover:bg-slate-700/60"}`}
            >
              <div className="font-medium text-gray-800 dark:text-slate-200 truncate">{p.name}</div>
              <div className="text-[10px] text-gray-400">{[p.city, p.country].filter(Boolean).join(" · ")}</div>
            </button>
          ))}
          {q.trim() && !exactExists && (
            <button
              onClick={() => onSave(q.trim())}
              className="block w-full text-left px-3 py-2 text-blue-700 dark:text-blue-300 hover:bg-amber-50 dark:hover:bg-slate-700"
            >
              ➕ Use &ldquo;<span className="font-semibold">{q.trim()}</span>&rdquo; (custom)
            </button>
          )}
          {matches.length === 0 && !q.trim() && (
            <div className="px-3 py-2 text-gray-400 italic">Type to search or add a custom name</div>
          )}
          <div className="flex border-t border-gray-100 dark:border-slate-700">
            {q.trim() && (
              <button onClick={() => onSave("")} className="flex-1 px-3 py-1.5 text-[11px] text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-700">Clear</button>
            )}
            <button onClick={onCancel} className="flex-1 px-3 py-1.5 text-[11px] text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-700">Cancel</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Medium picker ─────────────────────────────────────────────────────────────
// Call / WhatsApp / Email / Other(+custom). "Other" reveals a free-text input
// for a custom medium (stored in mediumOther). Saves on ✓ / Enter. The trigger
// stays in the cell (read view); the select + custom input float in a portal
// popover (CellEditPopover) so the grid's overflow-x-auto can't clip them.
function MediumPickerCell({
  open, onToggle, display, initialMedium, initialOther, busy, onSave, onCancel,
}: {
  open: boolean;
  onToggle: () => void;
  display: string;
  initialMedium: string;
  initialOther: string;
  busy: boolean;
  onSave: (medium: string, mediumOther: string) => void;
  onCancel: () => void;
}) {
  // If the stored medium isn't one of the standard 4 (a pre-existing custom one),
  // treat it as "Other" with the value pre-filled so it round-trips.
  const isStd = MEDIUM_OPTIONS.includes(initialMedium);
  const [medium, setMedium] = useState(isStd ? initialMedium : (initialMedium ? "Other" : ""));
  const [other, setOther] = useState(!isStd && initialMedium ? initialMedium : initialOther);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Reset the local editor state each time the popover (re)opens so it reflects
  // the current row value — the trigger now persists across open/close.
  useEffect(() => {
    if (!open) return;
    const std = MEDIUM_OPTIONS.includes(initialMedium);
    setMedium(std ? initialMedium : (initialMedium ? "Other" : ""));
    setOther(!std && initialMedium ? initialMedium : initialOther);
  }, [open, initialMedium, initialOther]);

  const commit = () => {
    if (medium === "Other") {
      const t = other.trim();
      if (!t) { onCancel(); return; }   // no custom value → no-op, revert
      onSave("Other", t);
    } else {
      onSave(medium, "");
    }
  };

  return (
    <>
      <button ref={triggerRef} onClick={onToggle} className="text-gray-600 dark:text-slate-400 hover:underline" title="Click to set medium">{display}</button>
      {open && (
        <CellEditPopover anchorRef={triggerRef} onClose={onCancel} minWidth={200}>
          <div className="flex items-center gap-1 p-2" onClick={(e) => e.stopPropagation()}>
            <select
              autoFocus
              value={medium}
              disabled={busy}
              onChange={(e) => setMedium(e.target.value)}
              className="min-w-[90px] px-2 py-1 text-sm border border-blue-400 rounded dark:bg-slate-700 dark:text-slate-100"
            >
              <option value="">— clear —</option>
              {MEDIUM_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {medium === "Other" && (
              <input
                value={other}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") onCancel(); }}
                placeholder="custom…"
                className="w-24 px-2 py-1 text-sm border border-blue-400 rounded dark:bg-slate-700 dark:text-slate-100"
              />
            )}
            <button onClick={commit} disabled={busy} aria-label="Save" className="text-emerald-600 hover:bg-emerald-50 dark:hover:bg-slate-700 rounded px-1.5 py-1 text-sm">✓</button>
            <button onClick={onCancel} aria-label="Cancel" className="text-red-600 hover:bg-red-50 dark:hover:bg-slate-700 rounded px-1.5 py-1 text-sm">✕</button>
          </div>
        </CellEditPopover>
      )}
    </>
  );
}
