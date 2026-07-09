"use client";
import Link from "next/link";
import { useState, useMemo, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useScrollRestore } from "@/hooks/useScrollRestore";
import BuyerDistributionPanel from "@/components/BuyerDistributionPanel";
import ColumnHeaderFilter, {
  type ColKind,
  type ColFilterState,
  type ColSortDir,
  isColFilterActive,
} from "@/components/ColumnHeaderFilter";
import { type BuyerClass, BUYER_CLASS_META } from "@/lib/buyerIntelligence";

// ── Buyer list = the Leads list experience (Part 5b) ─────────────────────────
// Filters (poolStatus / owner / project / type / nationality / region / repeat /
// search) + sortable columns + Saved Views (localStorage, per-viewer) + two views
// (Admin Pool vs Assigned/All) + an admin bulk toolbar (Assign-from-pool /
// Transfer / Delete / Export / Edit) + the AI distribution console. Buyers aren't
// leads, so this is a dedicated client (no leadFilterWhere); the UX mirrors
// RevivalEngineListClient / MasterDataRecordsTable. Responsive: desktop table,
// mobile cards. 16px inputs on mobile (no iOS zoom).

export type BuyerRow = {
  id: string;
  href: string;
  clientName: string;
  project: string;
  towerUnit: string;
  propertyType: string;
  configuration: string;
  txnValueDisplay: string;
  txnValueNum: number;
  txnDate: string;
  txnDateMs: number;
  nationality: string;
  region: string;        // "India" | "Dubai/UAE" | "—"
  agent: string;
  ownerId: string;
  poolStatus: string;    // ADMIN_POOL | ASSIGNED | CONVERTED | REJECTED
  poolStatusLabel: string;
  businessStatus: string;   // the REAL imported buyer status (R4) — distinct from poolStatus
  followupDisplay: string;  // formatted follow-up date (R5); "—" when none
  followupMs: number;       // follow-up date in ms for sort/range (0 = none)
  attemptCount: number;
  repeat: boolean;
  propertiesOwned: number;
  buyerClass: BuyerClass; // First-Time | Investor | Whale (computed from rollup)
  createdAtMs: number;
  // hidden search fields
  phone: string;
  passport: string;
};

export type BuyerAgent = { id: string; name: string; team: string | null };

interface Props {
  rows: BuyerRow[];
  projects: string[];
  propertyTypes: string[];
  nationalities: string[];
  owners: { id: string; name: string }[];
  agents: BuyerAgent[];
  isAdmin: boolean;
  isAdminOrMgr: boolean;
  viewerId: string;
  /** Which market this list is — drives the distribution panel (default Dubai). */
  market?: "Dubai" | "India";
  poolAvailable: number;
  convertedCount: number;
  summary: {
    total: number; uniqueBuyers: number; repeatBuyers: number;
    pool: number; assigned: number; converted: number; rejected: number;
    investmentLabel: string;
  };
}

// ── Column model (drives the Excel header filters + sort, DRY) ───────────────
// Every business column declares: a sortKey, a field kind, how to read its
// display string (for the multi-select picker + text match) and — for numeric /
// date columns — a numeric accessor (transaction date is sorted/ranged on its ms
// value, not the formatted string). The Actions column is NOT in this list, so
// it gets no header filter (per spec).
type ColKey = "clientName" | "businessStatus" | "followup" | "poolStatus" | "project" | "towerUnit" | "propertyType" | "txnValue" | "txnDate" | "nationality" | "agent" | "attempts" | "buyer";
type SortKey = ColKey;
// "active" = the working pipeline (Admin Pool + Assigned) and is the DEFAULT, so
// terminal CONVERTED/REJECTED records no longer inflate the main view. Terminal
// states have their own tabs; "all" still shows literally everything for the admin.
type Tab = "active" | "all" | "pool" | "assigned" | "converted" | "rejected";

type ColDef = {
  key: ColKey;
  label: string;
  kind: ColKind;
  /** Display string used for multi-select options + text filtering. */
  str: (r: BuyerRow) => string;
  /** Numeric value for number/date sort + range. */
  num?: (r: BuyerRow) => number;
  /** Keep caller option order (no forced A→Z) — used for the canonical status order. */
  ordered?: boolean;
  /** Caller-controlled option list (else distinct of str()). */
  options?: (rows: BuyerRow[]) => string[];
};

// Canonical status order for the Status multi-select (matches the tab order).
const STATUS_ORDER: { value: string; label: string }[] = [
  { value: "ADMIN_POOL", label: "Admin Pool" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "CONVERTED", label: "Converted" },
  { value: "REJECTED", label: "Rejected" },
];

const COLS: ColDef[] = [
  { key: "clientName", label: "Client Name", kind: "text", str: (r) => r.clientName },
  // R4: the REAL imported buyer status (distinct from the Admin-Pool lifecycle below).
  { key: "businessStatus", label: "Status", kind: "select", str: (r) => r.businessStatus },
  // R5: follow-up date — sortable/rangeable on its ms value (parity with txnDate).
  { key: "followup", label: "Follow-up", kind: "date", str: (r) => r.followupDisplay, num: (r) => r.followupMs },
  // The Admin-Pool / assignment lifecycle — RELABELED "Pool" so it is never confused
  // with the imported Status above. Filters on the LABEL; options are the canonical order.
  { key: "poolStatus", label: "Pool", kind: "select", ordered: true, str: (r) => r.poolStatusLabel,
    options: () => STATUS_ORDER.map((s) => s.label) },
  { key: "project", label: "Project", kind: "text", str: (r) => r.project },
  { key: "towerUnit", label: "Tower / Unit", kind: "text", str: (r) => r.towerUnit },
  { key: "propertyType", label: "Type", kind: "text", str: (r) => r.propertyType },
  { key: "txnValue", label: "Transaction Value", kind: "number", str: (r) => r.txnValueDisplay, num: (r) => r.txnValueNum },
  { key: "txnDate", label: "Transaction Date", kind: "date", str: (r) => r.txnDate, num: (r) => r.txnDateMs },
  { key: "nationality", label: "Nationality", kind: "text", str: (r) => r.nationality },
  { key: "agent", label: "Agent", kind: "text", str: (r) => r.agent },
  { key: "attempts", label: "Attempts", kind: "number", str: (r) => String(r.attemptCount), num: (r) => r.attemptCount },
  { key: "buyer", label: "Buyer Count", kind: "number", str: (r) => String(r.propertiesOwned), num: (r) => r.propertiesOwned },
];
const COL_BY_KEY = new Map(COLS.map((c) => [c.key, c]));

type SavedView = { name: string; tab: Tab; q: string; project: string; ptype: string; nat: string; region: string; ownerId: string; repeatOnly: "" | "yes" | "no"; classFilter?: "" | "First-Time" | "Investor" | "Whale"; sortKey: SortKey; sortDir: "asc" | "desc"; colFilters?: Record<string, { values: string[]; min: string; max: string }> };

const PAGE = 50;
const EDITABLE_FIELDS: [string, string][] = [
  ["nationality", "Nationality"], ["projectName", "Project"], ["tower", "Tower / Building"],
  ["propertyType", "Property Type"], ["configuration", "Configuration"], ["agentName", "Agent (name)"],
  ["businessStatus", "Business Status"], ["transactionValue", "Transaction Value"], ["remarks", "Remarks"],
];

// followupMs → YYYY-MM-DD for the inline date input, in IST so the value shown in
// the picker matches the followupDisplay cell (the buyer route stores follow-ups at
// noon IST). 0 / falsy → "" (empty input). Uses en-CA which formats as YYYY-MM-DD.
const followupInputValue = (ms: number): string =>
  ms > 0 ? new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "";

const statusChip = (s: string) => {
  switch (s) {
    case "ADMIN_POOL": return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700";
    case "ASSIGNED": return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700";
    case "CONVERTED": return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700";
    case "REJECTED": return "bg-gray-100 text-gray-600 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";
    default: return "bg-gray-100 text-gray-600 border-gray-200";
  }
};

export default function BuyerListClient(props: Props) {
  const { rows, projects, propertyTypes, nationalities, owners, agents, isAdmin, isAdminOrMgr, viewerId, poolAvailable, convertedCount, summary } = props;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Restore scroll position on Back (open a buyer → Back returns to the same row).
  useScrollRestore();

  // The summary-card selection ("tab") is DEVICE-INDEPENDENT: it lives in the URL
  // (?tab=…), NOT per-device localStorage — so the same user sees the same filtered
  // result on every device/browser, it survives refresh, and it's shareable (fixes the
  // Windows-vs-Mac summary-card bug, Lalit 2026-07-07). Only the default "active" omits it.
  const TAB_VALUES: readonly Tab[] = ["active", "all", "pool", "assigned", "converted", "rejected"];
  const tabFromUrl = (): Tab | null => {
    const t = searchParams.get("tab");
    return t && (TAB_VALUES as readonly string[]).includes(t) ? (t as Tab) : null;
  };
  const [tab, setTab] = useState<Tab>(tabFromUrl() ?? "active");
  // Selecting a card/tab updates BOTH React state and the URL, so the active filter is
  // reflected in the address bar (device-independent + Back/refresh safe).
  const selectTab = (t: Tab) => {
    setTab(t);
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    if (t === "active") sp.delete("tab"); else sp.set("tab", t);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  // Keep the tab in sync when the URL changes (browser Back/Forward, shared link).
  useEffect(() => { setTab(tabFromUrl() ?? "active"); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [searchParams]);
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [ptype, setPtype] = useState("");
  const [nat, setNat] = useState("");
  const [region, setRegion] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const repeatFromUrl = (): "" | "yes" | "no" => { const r = searchParams.get("repeat"); return r === "yes" || r === "no" ? r : ""; };
  const [repeatOnly, setRepeatOnly] = useState<"" | "yes" | "no">(repeatFromUrl());
  // Repeat/Unique summary cards are URL-driven too (?repeat=yes|no) so clicking them is
  // device-independent + refresh-safe, exactly like the tab (Lalit 2026-07-08).
  const selectRepeat = (v: "" | "yes" | "no") => {
    setRepeatOnly(v);
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    if (v) sp.set("repeat", v); else sp.delete("repeat");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    setPage(0);
  };
  useEffect(() => { setRepeatOnly(repeatFromUrl()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [searchParams]);
  const [classFilter, setClassFilter] = useState<"" | "First-Time" | "Investor" | "Whale">("");
  const [sortKey, setSortKey] = useState<SortKey>("txnDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Per-column Excel header filters (client-state — composes with the top filters).
  const [colFilters, setColFilters] = useState<Record<string, ColFilterState>>({});
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Bulk selection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [editField, setEditField] = useState("");
  const [editValue, setEditValue] = useState("");
  const [showDistribute, setShowDistribute] = useState(false);

  // ── Per-row inline edit (Status + Follow-up) — parity with Leads/Revival ─────
  // Buyers were bulk-only; this adds save-on-change inline edits for the SAME two
  // fields the buyer /update PATCH route already exposes (businessStatus R4 +
  // followupDate R5), reusing that route + field names verbatim. Owner/assigned
  // editing is intentionally NOT added here (buyer pool semantics — auto-return
  // at 5 — live on the assign/return endpoints, not this generic editor).
  //
  // canEditRow mirrors the route's canTouchBuyer gate WITHOUT touching pool/org
  // logic: ADMIN → any row; AGENT → own ASSIGNED row. (A MANAGER's org-subtree
  // arm needs a server query, so we only surface the control on rows the manager
  // personally owns — a strict subset the route always allows — never a control
  // the route would 403.) The route re-enforces canTouchBuyer server-side.
  const canEditRow = (r: BuyerRow) => isAdmin || (r.ownerId === viewerId && r.poolStatus === "ASSIGNED");
  const [rowBusy, setRowBusy] = useState<string | null>(null); // `${id}:${field}` mid-save

  async function saveRowField(id: string, field: "businessStatus" | "followupDate", value: string | null) {
    const key = `${id}:${field}`;
    if (rowBusy === key) return;
    setRowBusy(key); setBulkMsg(null);
    try {
      const r = await fetch(`/api/buyer-data/${id}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value === "" ? null : value }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setBulkMsg(`⚠ ${j.error ?? `Save failed (${r.status})`}`);
        return;
      }
      router.refresh(); // optimistic row-refresh (mirrors LeadsListClient)
    } catch {
      setBulkMsg("⚠ Network error saving edit.");
    } finally { setRowBusy(null); }
  }

  // Saved views (per viewer, localStorage — mirrors Master Data). Keyed by BOTH
  // viewer AND pathname (like FKEY below) so the Dubai (/buyer-data) and India
  // (/india-buyer-data) lists each keep their OWN saved views instead of sharing
  // one bucket. NOTE: changing the key means saved views stored under the old
  // pathname-less key won't appear under the new key (acceptable one-time reset).
  const VKEY = `wcr_buyer_views_${viewerId}_${pathname}`;
  const [views, setViews] = useState<SavedView[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // Sticky live-filter state — persisted so the current tab/filters/sort/page/
  // column-filters SURVIVE opening a buyer and pressing Back (parity with the
  // URL-restore /leads already gets). Keyed by BOTH viewer AND pathname so the
  // Dubai (/buyer-data) and India (/india-buyer-data) lists each keep their own.
  const FKEY = `wcr_buyer_filters_${viewerId}_${pathname}`;
  useEffect(() => {
    try { const raw = localStorage.getItem(VKEY); if (raw) setViews(JSON.parse(raw)); } catch { /* ignore */ }
    // Restore the last live filter/sort/page snapshot for THIS list.
    try {
      const raw = localStorage.getItem(FKEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<SavedView> & { page?: number };
        // NOTE: tab is NOT restored from localStorage — it's URL-driven (?tab=) so it
        // stays consistent across devices. Only the convenience filters below persist.
        if (typeof s.q === "string") setQ(s.q);
        if (typeof s.project === "string") setProject(s.project);
        if (typeof s.ptype === "string") setPtype(s.ptype);
        if (typeof s.nat === "string") setNat(s.nat);
        if (typeof s.region === "string") setRegion(s.region);
        if (typeof s.ownerId === "string") setOwnerId(s.ownerId);
        // repeatOnly is URL-driven (?repeat=) — not restored from localStorage.
        if (s.classFilter === "" || s.classFilter === "First-Time" || s.classFilter === "Investor" || s.classFilter === "Whale") setClassFilter(s.classFilter);
        if (s.sortKey) setSortKey(s.sortKey);
        if (s.sortDir === "asc" || s.sortDir === "desc") setSortDir(s.sortDir);
        if (s.colFilters) setColFilters(deserCol(s.colFilters));
        if (typeof s.page === "number" && s.page >= 0) setPage(s.page);
      }
    } catch { /* ignore corrupt storage */ }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [VKEY, FKEY]);
  const persistViews = (v: SavedView[]) => { setViews(v); try { localStorage.setItem(VKEY, JSON.stringify(v)); } catch { /* ignore */ } };

  // Persist the live filter/sort/page snapshot on every change (post-hydration),
  // so a subsequent Back re-hydrates the exact same view. Purely additive — the
  // filters/query logic is untouched; only the state is saved & restored.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(FKEY, JSON.stringify({
        tab, q, project, ptype, nat, region, ownerId, repeatOnly, classFilter,
        sortKey, sortDir, colFilters: serCol(colFilters), page,
      }));
    } catch { /* quota / private mode — non-fatal */ }
  }, [tab, q, project, ptype, nat, region, ownerId, repeatOnly, classFilter, sortKey, sortDir, colFilters, page, hydrated, FKEY]);

  const resetAll = () => {
    setTab("active"); setQ(""); setProject(""); setPtype(""); setNat(""); setRegion(""); setOwnerId("");
    setRepeatOnly(""); setClassFilter(""); setSortKey("txnDate"); setSortDir("desc"); setColFilters({}); setPage(0);
    router.replace(pathname, { scroll: false }); // clear ?tab & ?repeat in ONE replace (no double-setter race)
  };

  // Serialize / deserialize the per-column filters (Set → array) for saved views.
  const serCol = (cf: Record<string, ColFilterState>) =>
    Object.fromEntries(Object.entries(cf).filter(([, f]) => isColFilterActive(f)).map(([k, f]) => [k, { values: [...f.values], min: f.min, max: f.max }]));
  const deserCol = (o: Record<string, { values: string[]; min: string; max: string }> | undefined): Record<string, ColFilterState> =>
    Object.fromEntries(Object.entries(o || {}).map(([k, f]) => [k, { values: new Set(f.values), min: f.min, max: f.max }]));

  function applyView(v: SavedView) {
    setTab(v.tab); setQ(v.q); setProject(v.project); setPtype(v.ptype); setNat(v.nat); setRegion(v.region);
    setOwnerId(v.ownerId); setRepeatOnly(v.repeatOnly); setClassFilter(v.classFilter ?? ""); setSortKey(v.sortKey); setSortDir(v.sortDir);
    setColFilters(deserCol(v.colFilters)); setPage(0);
    // Reflect tab + repeat in the URL together (ONE replace — no race between two setters).
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    if (v.tab === "active") sp.delete("tab"); else sp.set("tab", v.tab);
    if (v.repeatOnly) sp.set("repeat", v.repeatOnly); else sp.delete("repeat");
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  function saveCurrentView() {
    const name = window.prompt("Name this view:");
    if (!name || !name.trim()) return;
    const v: SavedView = { name: name.trim(), tab, q, project, ptype, nat, region, ownerId, repeatOnly, classFilter, sortKey, sortDir, colFilters: serCol(colFilters) };
    persistViews([...views.filter((x) => x.name !== v.name), v]);
  }
  function deleteView(name: string) { persistViews(views.filter((v) => v.name !== name)); }

  const setColFilter = (key: ColKey, next: ColFilterState) => {
    setColFilters((prev) => {
      const n = { ...prev };
      if (isColFilterActive(next)) n[key] = next; else delete n[key];
      return n;
    });
    setPage(0);
  };
  const activeColCount = Object.values(colFilters).filter(isColFilterActive).length;

  // ── filter + sort ──────────────────────────────────────────────────────────
  // Layered AND: tab → top filters → search → per-column Excel header filters.
  // Everything runs over the loaded (scoped) rows, so `filtered.length` is the
  // EXACT visible count and the bulk/export/saved-view paths all see the same set.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Date range comparisons operate on the row's txn ms vs the picker's
    // yyyy-mm-dd bounds (inclusive; "to" extends to end-of-day).
    const dayStart = (s: string) => { const t = new Date(s + "T00:00:00").getTime(); return isNaN(t) ? null : t; };
    const dayEnd = (s: string) => { const t = new Date(s + "T23:59:59.999").getTime(); return isNaN(t) ? null : t; };

    const colEntries = Object.entries(colFilters).filter(([, f]) => isColFilterActive(f));

    let out = rows.filter((r) => {
      if (tab === "active" && r.poolStatus !== "ADMIN_POOL" && r.poolStatus !== "ASSIGNED") return false;
      if (tab === "pool" && r.poolStatus !== "ADMIN_POOL") return false;
      if (tab === "assigned" && r.poolStatus !== "ASSIGNED") return false;
      if (tab === "converted" && r.poolStatus !== "CONVERTED") return false;
      if (tab === "rejected" && r.poolStatus !== "REJECTED") return false;
      if (project && r.project !== project) return false;
      if (ptype && r.propertyType !== ptype) return false;
      if (nat && r.nationality !== nat) return false;
      if (region && r.region !== region) return false;
      if (ownerId && r.ownerId !== ownerId) return false;
      if (repeatOnly === "yes" && !r.repeat) return false;
      if (repeatOnly === "no" && r.repeat) return false;
      if (classFilter && r.buyerClass !== classFilter) return false;
      if (needle) {
        const hay = `${r.clientName} ${r.phone} ${r.passport} ${r.project} ${r.towerUnit} ${r.agent}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      // Per-column header filters.
      for (const [key, f] of colEntries) {
        const col = COL_BY_KEY.get(key as ColKey);
        if (!col) continue;
        if (col.kind === "text" || col.kind === "select") {
          // Multi-select on the display string. Blank cells show as "—".
          if (f.values.size > 0 && !f.values.has(col.str(r) || "—")) return false;
        } else if (col.kind === "number") {
          const v = col.num ? col.num(r) : 0;
          if (f.min !== "" && v < Number(f.min)) return false;
          if (f.max !== "" && v > Number(f.max)) return false;
        } else if (col.kind === "date") {
          const v = col.num ? col.num(r) : 0;
          if (f.min !== "") { const lo = dayStart(f.min); if (lo != null && (v === 0 || v < lo)) return false; }
          if (f.max !== "") { const hi = dayEnd(f.max); if (hi != null && (v === 0 || v > hi)) return false; }
        }
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    const col = COL_BY_KEY.get(sortKey);
    out = out.slice().sort((a, b) => {
      if (col?.num) return (col.num(a) - col.num(b)) * dir;
      const sa = col ? col.str(a) : "";
      const sb = col ? col.str(b) : "";
      return sa.localeCompare(sb, undefined, { numeric: true }) * dir;
    });
    return out;
  }, [rows, tab, q, project, ptype, nat, region, ownerId, repeatOnly, classFilter, sortKey, sortDir, colFilters]);

  // Distinct option lists for the text/select header filters (over loaded rows).
  const colOptions = useMemo(() => {
    const m = new Map<ColKey, string[]>();
    for (const c of COLS) {
      if (c.kind !== "text" && c.kind !== "select") continue;
      if (c.options) { m.set(c.key, c.options(rows)); continue; }
      // The AGENT column filter must list the COMPLETE agent set — every assignable-roster
      // agent AND every record-owner — NEVER only agents present in the loaded rows. So
      // Mehak/Dinesh/Lalit/… always appear regardless of pagination, active filters, or
      // ownership churn (Lalit 2026-07-07). `owners` already = roster ∪ record-owners.
      const base = c.key === "agent" ? owners.map((o) => o.name) : [];
      const vals = Array.from(new Set([...base, ...rows.map((r) => c.str(r) || "—")]))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      m.set(c.key, vals);
    }
    return m;
  }, [rows, owners]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE, safePage * PAGE + PAGE);

  // Selection helpers (operate on the FILTERED set, not just the page).
  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  // Rule #6 (Lalit 2026-07-07): when filters/search/tab change, drop any selected rows
  // that no longer match — a bulk action can never touch an out-of-view record.
  const filteredIdSet = useMemo(() => new Set(filteredIds), [filteredIds]);
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => filteredIdSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredIdSet]);
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const toggleOne = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());

  // ── Select-all safety (Lalit 2026-07-07) ──────────────────────────────────
  // The header checkbox selects ONLY THE CURRENT PAGE. A header "select all" that
  // silently grabbed the ENTIRE dataset across every page caused an accidental
  // bulk transfer of the whole Dubai module. Selecting all matching records is now
  // a SEPARATE, explicit action, and any full-dataset bulk mutation is confirmed.
  const pageIdSet = useMemo(() => new Set(pageRows.map((r) => r.id)), [pageRows]);
  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const selectedOnPage = pageRows.reduce((n, r) => n + (selected.has(r.id) ? 1 : 0), 0);
  const togglePage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };
  // Does the current selection reach BEYOND this page? (i.e. "all matching") — if so
  // a bulk mutation must be explicitly confirmed as a full-dataset action.
  const selectionSpansPages = useMemo(() => Array.from(selected).some((id) => !pageIdSet.has(id)), [selected, pageIdSet]);

  // Toggle direction on repeat header-text click; default direction per field type
  // (text → A→Z, number/date → high/newest first).
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { const c = COL_BY_KEY.get(k); setSortKey(k); setSortDir(c?.num ? "desc" : "asc"); }
    setPage(0);
  };
  // Direct set (the header-filter dropdown's Asc/Desc buttons).
  const setSort = (k: SortKey, dir: ColSortDir) => { setSortKey(k); setSortDir(dir); setPage(0); };
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  // Render a column's Excel header filter (sort + filter dropdown). Shared with
  // Master Data via the same ColumnHeaderFilter component. `chip` renders a
  // labeled pill for the mobile/tablet card view (where the table is hidden).
  const renderHF = (key: ColKey, chip = false) => {
    const c = COL_BY_KEY.get(key)!;
    const hf = (
      <ColumnHeaderFilter
        label={c.label}
        kind={c.kind}
        sortActive={sortKey === key}
        sortDir={sortDir}
        onSort={(dir) => setSort(key, dir)}
        filter={colFilters[key]}
        onApply={(next) => setColFilter(key, next)}
        options={colOptions.get(key) ?? []}
      />
    );
    if (!chip) return hf;
    const on = isColFilterActive(colFilters[key]) || sortKey === key;
    return (
      <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-2 py-1 rounded-full border whitespace-nowrap ${on ? "border-[#c9a24b] text-[#9a7b2e] bg-[#c9a24b]/10 dark:bg-[#c9a24b]/15 dark:border-[#c9a24b] dark:text-[#d9b765]" : "border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300"}`}>
        {c.label}{hf}
      </span>
    );
  };

  const sel = "border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-2 text-base sm:text-sm dark:bg-slate-800 dark:text-slate-100";
  const anyFilter = q || project || ptype || nat || region || ownerId || repeatOnly || classFilter || tab !== "active" || activeColCount > 0;

  // ── bulk runner ──────────────────────────────────────────────────────────
  async function runBulk(action: string, extra?: Record<string, unknown>, confirmMsg?: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) { setBulkMsg("Select at least one buyer first."); return; }
    // MANDATORY full-dataset confirmation when the selection reaches BEYOND the current
    // page ("Select all matching") — never silently mutate every page (Lalit 2026-07-07).
    if (selectionSpansPages) {
      const verb = action === "edit" ? "update" : action;
      if (!window.confirm(`⚠ You are about to ${verb} ${ids.length} records across ALL pages — not just the ${selectedOnPage} on this page. This affects the entire matching dataset. Do you want to continue?`)) return;
    } else if (confirmMsg && !window.confirm(confirmMsg.replace("{n}", String(ids.length)))) return;
    setBulkBusy(true); setBulkMsg(null);
    try {
      const r = await fetch("/api/buyer-data/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, buyerIds: ids, ...extra }),
      });
      const j = await r.json();
      if (!r.ok) { setBulkMsg(`⚠ ${j.error ?? "Bulk action failed."}`); setBulkBusy(false); return; }
      const n = j.transferred ?? j.deleted ?? j.restored ?? j.updated ?? 0;
      setBulkMsg(`✓ ${action}: ${n} buyer${n === 1 ? "" : "s"}.`);
      clearSel(); setTransferTo(""); setEditField(""); setEditValue("");
      router.refresh();
    } catch { setBulkMsg("⚠ Network error."); }
    finally { setBulkBusy(false); }
  }

  // Export reflects the ACTIVE FILTERS. The table is client-side, so we POST the
  // exact filtered id set to the audited + watermarked server export (it re-fetches
  // those rows, still ADMIN-only + deletedAt-excluded). Falls back to a plain GET
  // (all / ?project=) if no narrowing is active. Bulk selection, when present,
  // exports the selected rows instead.
  async function exportCsv() {
    const ids = selected.size > 0 ? Array.from(selected) : (anyFilter ? filteredIds : []);
    if (ids.length === 0) { // unfiltered → simplest audited GET path
      window.location.href = project ? `/api/buyer-data/export?project=${encodeURIComponent(project)}` : `/api/buyer-data/export`;
      return;
    }
    try {
      const r = await fetch("/api/buyer-data/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerIds: ids }),
      });
      if (!r.ok) { setBulkMsg(`⚠ Export failed (${r.status}).`); return; }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `wcr-dubai-buyer-data-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    } catch { setBulkMsg("⚠ Export network error."); }
  }

  const tabBtn = (t: Tab, label: string, count?: number) => (
    <button type="button" onClick={() => { selectTab(t); setPage(0); clearSel(); }}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${tab === t ? "bg-[#0b1a33] text-white dark:bg-[#c9a24b] dark:text-[#0b1a33]" : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300"}`}>
      {label}{count != null ? ` (${count})` : ""}
    </button>
  );

  // Clickable summary card. Two kinds are interactive:
  //   • status cards (tabKey)  → set the tab + reconcile the rows below (Rejected → rejected tab)
  //   • filter cards (onClick) → toggle a non-tab filter (Unique/Repeat → ?repeat=no|yes)
  // Only "Investment" stays a plain informational tile. All click state is URL-driven
  // (tab + repeat), so a click behaves identically on Windows / iMac / iPad and survives
  // a refresh or a shared link (Lalit cross-device fix, 2026-07-08).
  const card = (
    label: string,
    value: string | number,
    opts?: { tabKey?: Tab; tone?: string; onClick?: () => void; pressed?: boolean },
  ) => {
    const active = (opts?.tabKey ? tab === opts.tabKey : false) || !!opts?.pressed;
    const base = `rounded-lg border p-3 text-left transition ${active ? "border-[#c9a24b] ring-1 ring-[#c9a24b] bg-[#c9a24b]/5" : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800"}`;
    const inner = (
      <>
        <div className={`text-lg font-bold ${opts?.tone ?? "text-gray-800 dark:text-slate-100"}`}>{value}</div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
      </>
    );
    if (!opts?.tabKey && !opts?.onClick) return <div className={base}>{inner}</div>;
    const handleClick = opts?.tabKey
      ? () => { selectTab(opts.tabKey!); setPage(0); clearSel(); }
      : () => { opts!.onClick!(); clearSel(); };
    return (
      <button type="button" onClick={handleClick} className={`${base} hover:border-[#c9a24b] focus:outline-none focus:ring-1 focus:ring-[#c9a24b]`} aria-pressed={active} title={active ? `Clear ${label} filter` : `Show ${label}`}>
        {inner}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {/* ── Summary cards (clickable status filters) ────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {card("Active Pipeline", summary.pool + summary.assigned, { tabKey: "active", tone: "text-[#0b1a33] dark:text-[#d9b765]" })}
        {isAdmin && card("Admin Pool", summary.pool, { tabKey: "pool", tone: summary.pool ? "text-blue-600 dark:text-blue-400" : undefined })}
        {card("Assigned", summary.assigned, { tabKey: "assigned", tone: summary.assigned ? "text-emerald-600 dark:text-emerald-400" : undefined })}
        {isAdmin && card("Converted", summary.converted, { tabKey: "converted", tone: summary.converted ? "text-purple-600 dark:text-purple-400" : undefined })}
        {isAdmin && card("Rejected", summary.rejected, { tabKey: "rejected", tone: summary.rejected ? "text-gray-500 dark:text-slate-400" : undefined })}
        {card("Unique Buyers", summary.uniqueBuyers, { onClick: () => selectRepeat(repeatOnly === "no" ? "" : "no"), pressed: repeatOnly === "no" })}
        {card("Repeat Buyers", summary.repeatBuyers, { onClick: () => selectRepeat(repeatOnly === "yes" ? "" : "yes"), pressed: repeatOnly === "yes", tone: summary.repeatBuyers ? "text-amber-600 dark:text-amber-400" : undefined })}
        {card("Investment", summary.investmentLabel)}
      </div>

      {/* ── Views (tabs) + Saved views + filters toggle ─────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {tabBtn("active", "Active", summary.pool + summary.assigned)}
        {isAdmin && tabBtn("pool", "Admin Pool", poolAvailable)}
        {tabBtn("assigned", "Assigned", summary.assigned)}
        {isAdmin && tabBtn("converted", "Converted", convertedCount)}
        {isAdmin && tabBtn("rejected", "Rejected", summary.rejected)}
        {tabBtn("all", "All", summary.total)}
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <button type="button" onClick={() => setShowDistribute((s) => !s)}
              className="btn btn-ghost text-sm" title="AI buyer distribution — assign pool buyers to agents">
              ✨ Distribute
            </button>
          )}
          <button type="button" onClick={() => setShowFilters((s) => !s)} className={`btn text-sm ${anyFilter ? "btn-primary" : "btn-ghost"}`}>
            ⚙ Filters{anyFilter ? " •" : ""}
          </button>
        </div>
      </div>

      {/* Saved views bar */}
      {hydrated && (views.length > 0 || anyFilter) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {views.map((v) => (
            <span key={v.name} className="group inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 pl-2.5 pr-1 py-0.5 text-xs">
              <button type="button" onClick={() => applyView(v)} className="text-amber-800 dark:text-amber-300 font-medium">{v.name}</button>
              <button type="button" onClick={() => deleteView(v.name)} className="text-amber-400 hover:text-red-500" aria-label={`Delete view ${v.name}`}>✕</button>
            </span>
          ))}
          {anyFilter && <button type="button" onClick={saveCurrentView} className="text-xs text-[#0b1a33] dark:text-blue-300 underline">+ Save view</button>}
        </div>
      )}

      {/* Mobile / tablet column-filter chips — same Excel filters as the desktop
          table headers, surfaced here because the table is hidden below lg. */}
      <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "thin" }}>
        <span className="text-[11px] font-semibold text-gray-400 dark:text-slate-500 shrink-0">Columns:</span>
        {COLS.map((c) => <span key={c.key} className="shrink-0">{renderHF(c.key, true)}</span>)}
      </div>

      {/* AI distribution console (admin) */}
      {isAdmin && showDistribute && (
        <BuyerDistributionPanel agents={agents} poolAvailable={poolAvailable} market={props.market ?? "Dubai"} onApplied={() => router.refresh()} />
      )}

      {/* ── Filter panel ───────────────────────────────────────────────────── */}
      {showFilters && (
        <div className="card p-3 flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search name, phone, passport, unit, agent…" className={`${sel} flex-1 min-w-[200px]`} />
          <select value={project} onChange={(e) => { setProject(e.target.value); setPage(0); }} className={sel} title="Project">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={ptype} onChange={(e) => { setPtype(e.target.value); setPage(0); }} className={sel} title="Property type">
            <option value="">All types</option>
            {propertyTypes.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={nat} onChange={(e) => { setNat(e.target.value); setPage(0); }} className={sel} title="Nationality">
            <option value="">All nationalities</option>
            {nationalities.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={region} onChange={(e) => { setRegion(e.target.value); setPage(0); }} className={sel} title="Region / market">
            <option value="">All regions</option>
            <option value="India">India</option>
            <option value="Dubai/UAE">Dubai / UAE</option>
          </select>
          {(isAdminOrMgr && owners.length > 0) && (
            <select value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setPage(0); }} className={sel} title="Owner agent">
              <option value="">All owners</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <select value={repeatOnly} onChange={(e) => selectRepeat(e.target.value as "" | "yes" | "no")} className={sel} title="Repeat buyers">
            <option value="">All buyers</option>
            <option value="yes">🔁 Repeat buyers</option>
            <option value="no">First-time buyers</option>
          </select>
          <select value={classFilter} onChange={(e) => { setClassFilter(e.target.value as "" | "First-Time" | "Investor" | "Whale"); setPage(0); }} className={sel} title="Buyer classification">
            <option value="">All classes</option>
            <option value="Whale">🐋 Whale</option>
            <option value="Investor">📈 Investor</option>
            <option value="First-Time">🌱 First-Time</option>
          </select>
          {anyFilter && <button type="button" onClick={resetAll} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-slate-200 underline">Clear all</button>}
        </div>
      )}

      {/* ── Bulk toolbar (admin/mgr) ───────────────────────────────────────── */}
      {isAdminOrMgr && selected.size > 0 && (
        <div className="card p-3 bg-amber-50/60 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {selected.size} selected
            {selectionSpansPages && <span className="ml-1 font-normal text-red-700 dark:text-red-300">· ⚠ ALL pages</span>}
          </span>
          {/* Explicit "select all matching" — the header checkbox only takes THIS page. */}
          {allPageSelected && filtered.length > pageRows.length && !selectionSpansPages && (
            <button type="button" onClick={toggleAll}
              className="text-xs underline font-semibold text-[#9a7b2e] dark:text-[#d9b765]"
              title="Select every matching record across all pages">
              Select all {filtered.length} matching (all pages)
            </button>
          )}
          {selectionSpansPages && allFilteredSelected && (
            <span className="text-xs text-red-700 dark:text-red-300">All {filtered.length} matching records selected across all pages.</span>
          )}
          {/* Transfer + Edit are ADMIN / Super-Admin ONLY, and kept in two VISUALLY
              DISTINCT groups so they're never confused: Transfer (blue) changes the
              OWNER; Edit field (violet) changes METADATA. Both are reversible from
              Admin → Operations, and both preview an exact count before applying. */}
          {isAdmin && (
            <>
              {/* ── TRANSFER — ownership (blue) ── */}
              <div className="flex items-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 px-2 py-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">🔁 Transfer</span>
                <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className={sel} title="Transfer selected buyers to an agent (changes owner)">
                  <option value="">to agent…</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.team ? ` · ${a.team}` : ""}</option>)}
                </select>
                <button type="button" disabled={!transferTo || bulkBusy}
                  onClick={() => runBulk("transfer", { agentId: transferTo }, `You are about to transfer {n} selected buyer(s) to ${agents.find((a) => a.id === transferTo)?.name ?? "the selected agent"}. Continue?`)}
                  className="btn btn-primary text-sm disabled:opacity-40">Transfer</button>
              </div>
              {/* ── EDIT FIELD — metadata (violet) ── */}
              <div className="flex items-center gap-1.5 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-900/10 px-2 py-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">✎ Edit field</span>
                <select value={editField} onChange={(e) => { setEditField(e.target.value); setEditValue(""); }} className={sel} title="Change one metadata field on the selected buyers">
                  <option value="">choose field…</option>
                  {EDITABLE_FIELDS.map(([f, l]) => <option key={f} value={f}>{l}</option>)}
                </select>
                {editField && (() => {
                  // Dropdown for enumerated fields (values pulled from the data in view);
                  // free text for Remarks / Transaction Value / Tower / Configuration.
                  const opts = editField === "nationality" ? nationalities
                    : editField === "projectName" ? projects
                    : editField === "propertyType" ? propertyTypes
                    : editField === "agentName" ? agents.map((a) => a.name)
                    : null;
                  return opts ? (
                    <select value={editValue} onChange={(e) => setEditValue(e.target.value)} className={`${sel} min-w-[9rem]`} title="New value">
                      <option value="">select value…</option>
                      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="new value" className={`${sel} w-36`} title="New value" />
                  );
                })()}
                {editField && (
                  <button type="button" disabled={bulkBusy}
                    onClick={() => runBulk("edit", { field: editField, value: editValue }, `You are about to change ${EDITABLE_FIELDS.find(([f]) => f === editField)?.[1] ?? editField} to "${editValue || "(blank)"}" for {n} selected buyer(s). Continue?`)}
                    className="btn btn-ghost text-sm disabled:opacity-40">Apply</button>
                )}
              </div>
            </>
          )}
          {/* Export */}
          <button type="button" disabled={bulkBusy} onClick={exportCsv} className="btn btn-ghost text-sm" title="Export to CSV">⬇ Export</button>
          {/* Delete (admin only) */}
          {isAdmin && (
            <button type="button" disabled={bulkBusy} onClick={() => runBulk("delete", {}, "Move {n} buyer(s) to the recycle bin? This is reversible.")}
              className="btn text-sm text-red-600 border border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 disabled:opacity-40">🗑 Delete</button>
          )}
          <button type="button" onClick={clearSel} className="text-xs text-gray-500 underline ml-1">Clear selection</button>
        </div>
      )}
      {bulkMsg && <div className="text-xs px-3 py-1.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200">{bulkMsg}</div>}

      {/* ── Count (== visible rows, always) ───────────────────────────────── */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
        <span>
          {filtered.length} record{filtered.length === 1 ? "" : "s"}
          {anyFilter ? <span className="text-[#9a7b2e] dark:text-[#d9b765]"> (filtered{activeColCount > 0 ? ` · ${activeColCount} column${activeColCount === 1 ? "" : "s"}` : ""})</span> : ""}
        </span>
        {anyFilter && <button type="button" onClick={resetAll} className="text-gray-500 hover:text-gray-800 dark:hover:text-slate-200 underline">Clear all filters</button>}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-5 text-center text-sm text-gray-500 dark:text-slate-400">
          {rows.length === 0 ? "No buyer records yet. Use Import to bring in transaction data." : "No records match these filters."}
        </div>
      ) : (
        <>
          {/* ── Desktop table ───────────────────────────────────────────────── */}
          <div className="card p-0 overflow-x-auto hidden lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800 text-left text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  {isAdminOrMgr && (
                    <th className="px-3 py-2 w-8"><input type="checkbox" checked={allPageSelected} onChange={togglePage} aria-label="Select all on this page" title="Select all on THIS page" /></th>
                  )}
                  <th className="px-3 py-2 whitespace-nowrap"><span className="cursor-pointer" onClick={() => toggleSort("clientName")}>Client Name{arrow("clientName")}</span>{renderHF("clientName")}</th>
                  <th className="px-3 py-2 whitespace-nowrap"><span className="cursor-pointer" onClick={() => toggleSort("businessStatus")}>Status{arrow("businessStatus")}</span>{renderHF("businessStatus")}</th>
                  <th className="px-3 py-2 whitespace-nowrap"><span className="cursor-pointer" onClick={() => toggleSort("followup")}>Follow-up{arrow("followup")}</span>{renderHF("followup")}</th>
                  <th className="px-3 py-2 whitespace-nowrap" title="Admin-Pool / assignment lifecycle — separate from the imported Status"><span className="cursor-pointer" onClick={() => toggleSort("poolStatus")}>Pool{arrow("poolStatus")}</span>{renderHF("poolStatus")}</th>
                  <th className="px-3 py-2 whitespace-nowrap"><span className="cursor-pointer" onClick={() => toggleSort("project")}>Project{arrow("project")}</span>{renderHF("project")}</th>
                  <th className="px-3 py-2 whitespace-nowrap"><span className="cursor-pointer" onClick={() => toggleSort("towerUnit")}>Tower / Unit{arrow("towerUnit")}</span>{renderHF("towerUnit")}</th>
                  <th className="px-3 py-2 whitespace-nowrap"><span className="cursor-pointer" onClick={() => toggleSort("propertyType")}>Type{arrow("propertyType")}</span>{renderHF("propertyType")}</th>
                  <th className="px-3 py-2 whitespace-nowrap text-right"><span className="cursor-pointer" onClick={() => toggleSort("txnValue")}>Txn Value{arrow("txnValue")}</span>{renderHF("txnValue")}</th>
                  <th className="px-3 py-2 whitespace-nowrap"><span className="cursor-pointer" onClick={() => toggleSort("txnDate")}>Txn Date{arrow("txnDate")}</span>{renderHF("txnDate")}</th>
                  <th className="px-3 py-2 whitespace-nowrap"><span className="cursor-pointer" onClick={() => toggleSort("nationality")}>Nationality{arrow("nationality")}</span>{renderHF("nationality")}</th>
                  <th className="px-3 py-2 whitespace-nowrap"><span className="cursor-pointer" onClick={() => toggleSort("agent")}>Agent{arrow("agent")}</span>{renderHF("agent")}</th>
                  <th className="px-3 py-2 whitespace-nowrap text-center" title="Contact attempts (auto-return at 5)"><span className="cursor-pointer" onClick={() => toggleSort("attempts")}>Att{arrow("attempts")}</span>{renderHF("attempts")}</th>
                  <th className="px-3 py-2 whitespace-nowrap text-center" title="Properties owned by this buyer"><span className="cursor-pointer" onClick={() => toggleSort("buyer")}>Buyer{arrow("buyer")}</span>{renderHF("buyer")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {pageRows.map((r) => (
                  <tr key={r.id} className={`hover:bg-gray-50 dark:hover:bg-slate-800/50 ${selected.has(r.id) ? "bg-amber-50/50 dark:bg-amber-900/10" : ""}`}>
                    {isAdminOrMgr && (
                      <td className="px-3 py-2"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`Select ${r.clientName}`} /></td>
                    )}
                    <td className="px-3 py-2">
                      <Link href={r.href} className="font-medium text-[#0b1a33] dark:text-blue-300 hover:underline">{r.clientName}</Link>
                      {r.buyerClass !== "First-Time" && (
                        <span title={`${BUYER_CLASS_META[r.buyerClass].label} buyer`} className={`ml-1.5 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold align-middle ${BUYER_CLASS_META[r.buyerClass].tone}`}>{BUYER_CLASS_META[r.buyerClass].emoji} {BUYER_CLASS_META[r.buyerClass].label}</span>
                      )}
                    </td>
                    {/* Status (businessStatus, R4) — inline-editable on save-on-blur
                        for anyone the route allows (canEditRow); free-text to match the
                        imported value + the route's string field. Others see read-only. */}
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-300 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {canEditRow(r) ? (
                        <input
                          type="text"
                          defaultValue={r.businessStatus}
                          disabled={rowBusy === `${r.id}:businessStatus`}
                          onBlur={e => { const v = e.target.value.trim(); if (v !== (r.businessStatus ?? "")) saveRowField(r.id, "businessStatus", v || null); }}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { (e.target as HTMLInputElement).value = r.businessStatus; (e.target as HTMLInputElement).blur(); } }}
                          placeholder="—"
                          title="Status — click to edit"
                          className="w-28 border border-transparent hover:border-gray-200 dark:hover:border-slate-600 focus:border-[#c9a24b] rounded px-1 py-0.5 text-sm bg-transparent focus:bg-white dark:focus:bg-slate-800 focus:outline-none"
                        />
                      ) : (r.businessStatus || "—")}
                    </td>
                    {/* Follow-up (followupDate, R5) — inline date, save-on-change (parity
                        with the Leads list follow-up cell). Read-only for others. */}
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {canEditRow(r) ? (
                        <input
                          type="date"
                          defaultValue={followupInputValue(r.followupMs)}
                          disabled={rowBusy === `${r.id}:followupDate`}
                          onChange={e => saveRowField(r.id, "followupDate", e.target.value || null)}
                          title="Follow-up date — pick to set, clear to remove"
                          className="border border-transparent hover:border-gray-200 dark:hover:border-slate-600 focus:border-[#c9a24b] rounded px-1 py-0.5 text-xs bg-transparent focus:bg-white dark:focus:bg-slate-800 focus:outline-none"
                        />
                      ) : (r.followupDisplay || "—")}
                    </td>
                    <td className="px-3 py-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusChip(r.poolStatus)}`}>{r.poolStatusLabel}</span></td>
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{r.project || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap">{r.towerUnit || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{r.propertyType || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-800 dark:text-slate-200 whitespace-nowrap">{r.txnValueDisplay}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap">{r.txnDate || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{r.nationality || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{r.agent || <span className="text-blue-500 text-xs">— pool —</span>}</td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {r.poolStatus === "ASSIGNED" && r.attemptCount > 0
                        ? <span className={r.attemptCount >= 4 ? "text-red-600 font-semibold" : r.attemptCount >= 3 ? "text-amber-600" : "text-gray-500"}>{r.attemptCount}/5</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      {r.repeat
                        ? <span title={`Repeat buyer — owns ${r.propertiesOwned} properties`} className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">🔁 {r.propertiesOwned}</span>
                        : <span className="text-[11px] text-gray-400">1</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ────────────────────────────────────────────────── */}
          <div className="lg:hidden space-y-2">
            {pageRows.map((r) => (
              <div key={r.id} className={`card p-3 ${selected.has(r.id) ? "ring-1 ring-amber-300" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex items-start gap-2">
                    {isAdminOrMgr && <input type="checkbox" className="mt-1" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`Select ${r.clientName}`} />}
                    <Link href={r.href} className="min-w-0">
                      <div className="font-semibold text-[#0b1a33] dark:text-blue-300 truncate">{r.clientName}</div>
                      {r.buyerClass !== "First-Time" && (
                        <span className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold mt-0.5 ${BUYER_CLASS_META[r.buyerClass].tone}`}>{BUYER_CLASS_META[r.buyerClass].emoji} {BUYER_CLASS_META[r.buyerClass].label}</span>
                      )}
                      <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{r.project || "—"}{r.towerUnit ? ` · ${r.towerUnit}` : ""}</div>
                    </Link>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusChip(r.poolStatus)}`}>{r.poolStatusLabel}</span>
                    {r.repeat && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">🔁 {r.propertiesOwned}</span>}
                  </div>
                </div>
                {/* Inline-editable Status + Follow-up — pulled OUT of the tap-to-open
                    Link so the inputs work on touch (parity with the desktop cells).
                    Only when the route would allow the edit (canEditRow); otherwise the
                    two values render read-only inside the details Link below. */}
                {canEditRow(r) && (
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs" onClick={e => e.stopPropagation()}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-gray-400">Status</span>
                      <input
                        type="text"
                        defaultValue={r.businessStatus}
                        disabled={rowBusy === `${r.id}:businessStatus`}
                        onBlur={e => { const v = e.target.value.trim(); if (v !== (r.businessStatus ?? "")) saveRowField(r.id, "businessStatus", v || null); }}
                        placeholder="—"
                        className="border border-gray-200 dark:border-slate-600 rounded px-1.5 py-1 text-base bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#c9a24b]"
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-gray-400">Follow-up</span>
                      <input
                        type="date"
                        defaultValue={followupInputValue(r.followupMs)}
                        disabled={rowBusy === `${r.id}:followupDate`}
                        onChange={e => saveRowField(r.id, "followupDate", e.target.value || null)}
                        className="border border-gray-200 dark:border-slate-600 rounded px-1.5 py-1 text-base bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-[#c9a24b]"
                      />
                    </div>
                  </div>
                )}
                <Link href={r.href} className="block mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-slate-400">
                  {!canEditRow(r) && <div><span className="text-gray-400">Status:</span> <span className="font-medium text-gray-800 dark:text-slate-200">{r.businessStatus || "—"}</span></div>}
                  {!canEditRow(r) && <div><span className="text-gray-400">Follow-up:</span> {r.followupDisplay || "—"}</div>}
                  <div><span className="text-gray-400">Value:</span> <span className="font-medium text-gray-800 dark:text-slate-200">{r.txnValueDisplay}</span></div>
                  <div><span className="text-gray-400">Date:</span> {r.txnDate || "—"}</div>
                  <div><span className="text-gray-400">Type:</span> {r.propertyType || "—"}</div>
                  <div><span className="text-gray-400">Nationality:</span> {r.nationality || "—"}</div>
                  <div><span className="text-gray-400">Agent:</span> {r.agent || "pool"}</div>
                  {r.poolStatus === "ASSIGNED" && r.attemptCount > 0 && <div><span className="text-gray-400">Attempts:</span> {r.attemptCount}/5</div>}
                </Link>
              </div>
            ))}
          </div>

          {/* ── Pagination ──────────────────────────────────────────────────── */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between text-sm">
              <button type="button" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="btn btn-ghost disabled:opacity-40">← Prev</button>
              <span className="text-gray-500 dark:text-slate-400">Page {safePage + 1} of {pageCount}</span>
              <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="btn btn-ghost disabled:opacity-40">Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
