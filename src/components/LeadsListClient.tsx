"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle, Tag, RefreshCw, XCircle, X, ExternalLink, Pencil, Calendar, Mail, Trash2 } from "lucide-react";

/** Official WhatsApp logo mark (brand colour applied via parent bg) */
function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}
import { telLink, whatsappLink } from "@/lib/phone";
import CopyPhoneButton from "./CopyPhoneButton";
import { statusColor, EXCEL_STATUSES } from "@/lib/lead-statuses";

// Preset tag vocab — mirrors what Lalit asked the team to standardise on
// across the pipeline. Kept here (not server-fetched) so the popover renders
// instantly without a round-trip on first open.
const PRESET_TAGS = [
  "NRI",
  "Investor",
  "End-user",
  "HNI",
  "First-time buyer",
  "Repeat client",
  "Referral",
  "Hot prospect",
  "Cold revival",
];

// Same allow-list as RejectLeadClient / the single-lead reject endpoint.
const REJECT_REASONS: Array<{ v: string; label: string }> = [
  { v: "FUND_ISSUE",                  label: "💰 Fund issue" },
  { v: "WAR_FEAR",                    label: "⚔ War fear" },
  { v: "LOW_BUDGET",                  label: "📉 Low budget" },
  { v: "LOOK_AFTER_2_YEARS",          label: "📅 Look after 2 years" },
  { v: "WAITING_FOR_PROPERTY_SALE",   label: "🏠 Waiting to sell own property" },
  { v: "OTHER",                       label: "✏ Other (specify)" },
];

// Bulk-WhatsApp template presets — must match the keys the /api/leads/bulk-wa
// endpoint understands.
const WA_PRESETS: Array<{ v: string; label: string }> = [
  { v: "followup",   label: "Follow-up" },
  { v: "checkin",    label: "Check-in" },
  { v: "newlisting", label: "New listing" },
];

function idleClass(lastTouchedAt: string | null | undefined): string {
  if (!lastTouchedAt) return "text-gray-400";
  const days = (Date.now() - new Date(lastTouchedAt).getTime()) / (1000 * 60 * 60 * 24);
  if (days > 7) return "text-red-600 font-semibold";
  if (days > 2) return "text-amber-600 font-medium";
  return "text-emerald-600";
}

/** Format "Last Activity" cell — e.g. "📞 Call · 2h ago" */
function fmtLastActivity(type: string | null, at: string | null): string | null {
  if (!type || !at) return null;
  const ms = Date.now() - new Date(at).getTime();
  const mins = Math.floor(ms / 60_000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  const ago = days >= 7 ? `${days}d` : days >= 1 ? `${days}d` : hrs >= 1 ? `${hrs}h` : `${mins}m`;
  const icon = type === "CALL" ? "📞" : type === "WHATSAPP" ? "💬" : type === "EMAIL" ? "✉️"
    : type === "NOTE" ? "📝" : type === "SITE_VISIT" ? "🏗" : "•";
  const label = type === "CALL" ? "Call" : type === "WHATSAPP" ? "WhatsApp" : type === "EMAIL" ? "Email"
    : type === "NOTE" ? "Note" : type === "SITE_VISIT" ? "Visit" : type.replace(/_/g, " ").toLowerCase();
  return `${icon} ${label} · ${ago}`;
}

interface Row {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string;
  statusName: string;
  /** User-facing Excel/MIS status (currentStatus field) */
  currentStatus: string | null;
  srcChip: string;
  srcLabel: string;
  statusChip: string;
  aiScore: string | null;
  aiScoreValue: number | null;
  team: string | null;
  owner: { name: string; avatarColor: string } | null;
  budget: string | null;
  interest: string | null;
  lastTouched: string | null;
  lastTouchedAt?: string | Date | null;
  // Command Center fields
  budgetFormatted: string | null;
  bantCount: number;
  needSummary: string | null;
  discussedProjects: string[];
  todoNext: string | null;
  followupDate: string | null;
  followupRaw: string | null;   // YYYY-MM-DD for the date input
  intelligenceMatch: {
    matchType: string;
    confidence: number;
    totalPropertiesFound: number;
  } | null;
  // Table view extra fields
  city: string | null;
  whenCanInvest: string | null;
  remarks: string | null;
  // Last Activity column — what happened last + when
  lastActivityType: string | null;
  lastActivityAt: string | null;
  // Connected History column — e.g. 5C / 2NC
  connectedCount: number;
  notPickedCount: number;
}

export default function LeadsListClient({ leads, canBulk, canReassign = false, canSetStatus = false, agents, showSource = true, view = "cards", searchParamsStr = "" }: { leads: Row[]; canBulk: boolean; canReassign?: boolean; canSetStatus?: boolean; agents: { id: string; name: string; team: string | null }[]; showSource?: boolean; view?: "cards" | "table"; searchParamsStr?: string; }) {
  // showSource = false → hide the source column + chip from agents.
  // Lalit's policy: agents shouldn't see where each lead came from (avoids them
  // cherry-picking high-converting sources or gaming the round-robin pool).
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedIds = Array.from(selected);

  // Bulk action UI state. The action bar is a single sticky element at the
  // bottom; popovers/modals for each action layer on top via z-50.
  const [showTagPopover, setShowTagPopover] = useState(false);
  const [showReassignPopover, setShowReassignPopover] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showWaPopover, setShowWaPopover] = useState(false);
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());
  const [reassignPick, setReassignPick] = useState("");
  const [rejectReason, setRejectReason] = useState("FUND_ISSUE");
  const [rejectNote, setRejectNote] = useState("");
  const [waTemplate, setWaTemplate] = useState("followup");
  const [waLinks, setWaLinks] = useState<Array<{ leadId: string; name: string; phone: string; waLink: string }>>([]);
  const [waSkipped, setWaSkipped] = useState<Array<{ leadId: string; name: string; reason: string }>>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [bulkCrossTeamWarn, setBulkCrossTeamWarn] = useState<string | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null);
  const [statusOpenFor, setStatusOpenFor] = useState<string | null>(null);
  // §1: Assigned is display-only from the table — no inline reassign dropdown.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteReason, setDeleteReason] = useState("NOT_INTERESTED");
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Excel/MIS status values — imported from canonical source
  const EXCEL_LEAD_STATUSES = EXCEL_STATUSES as unknown as string[];

  async function quickSetStatus(leadId: string, currentStatus: string) {
    await fetch(`/api/leads/${leadId}/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentStatus }),
    });
    setStatusOpenFor(null);
    router.refresh();
  }

  async function quickSetFollowup(leadId: string, date: string) {
    await fetch(`/api/leads/${leadId}/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ followupDate: date || null }),
    });
    setPickerOpenFor(null);
    router.refresh();
  }

  async function quickReject() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const r = await fetch(`/api/leads/${deleteTarget.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason, note: "" }),
      });
      if (!r.ok) return;
      setDeleteTarget(null);
      router.refresh();
    } finally {
      setDeleteBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === leads.length) setSelected(new Set());
    else setSelected(new Set(leads.map((l) => l.id)));
  }
  function clearSelection() {
    setSelected(new Set());
    setShowTagPopover(false);
    setShowReassignPopover(false);
    setShowRejectModal(false);
    setShowWaPopover(false);
    setPickedTags(new Set());
    setReassignPick("");
    setRejectReason("FUND_ISSUE");
    setRejectNote("");
    setWaTemplate("followup");
    setWaLinks([]);
    setWaSkipped([]);
    setBulkErr(null);
  }
  const allChecked = leads.length > 0 && selected.size === leads.length;

  // ESC closes any open popover/modal first, then clears selection.
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (statusOpenFor) { setStatusOpenFor(null); return; }
      if (pickerOpenFor) { setPickerOpenFor(null); return; }
      if (showTagPopover || showReassignPopover || showRejectModal || showWaPopover) {
        setShowTagPopover(false);
        setShowReassignPopover(false);
        setShowRejectModal(false);
        setShowWaPopover(false);
      } else if (selected.size > 0) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [statusOpenFor, showTagPopover, showReassignPopover, showRejectModal, showWaPopover, selected.size]);

  // Click outside to close floating popovers
  useEffect(() => {
    if (!statusOpenFor && !pickerOpenFor) return;
    const fn = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-status-popover]")) setStatusOpenFor(null);
      if (!target.closest("[data-picker-popover]")) setPickerOpenFor(null);
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [statusOpenFor, pickerOpenFor]);

  function togglePickedTag(t: string) {
    setPickedTags((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  async function applyBulkTag() {
    if (pickedTags.size === 0 || bulkBusy) return;
    setBulkBusy(true); setBulkErr(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tag", leadIds: selectedIds, addTags: Array.from(pickedTags) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      clearSelection();
      router.refresh();
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  async function applyBulkReassign() {
    if (!reassignPick || bulkBusy) return;
    setBulkBusy(true); setBulkErr(null); setBulkCrossTeamWarn(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reassign", leadIds: selectedIds, ownerId: reassignPick }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      if (j.crossTeamWarningMessage) {
        setBulkCrossTeamWarn(j.crossTeamWarningMessage);
      }
      clearSelection();
      router.refresh();
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  async function applyBulkReject() {
    if (bulkBusy) return;
    if (rejectReason === "OTHER" && !rejectNote.trim()) {
      setBulkErr("Please specify the reason in the note.");
      return;
    }
    setBulkBusy(true); setBulkErr(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", leadIds: selectedIds, reason: rejectReason, note: rejectNote.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      clearSelection();
      router.refresh();
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  // Bulk WhatsApp can't send server-side (no Meta API) — the endpoint returns a
  // list of wa.me draft links the agent opens one by one. Each is also logged
  // as a PLANNED activity server-side.
  async function generateWaLinks() {
    if (bulkBusy) return;
    setBulkBusy(true); setBulkErr(null);
    setWaLinks([]); setWaSkipped([]);
    try {
      const r = await fetch("/api/leads/bulk-wa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: selectedIds, templateKey: waTemplate }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      setWaLinks(Array.isArray(j.links) ? j.links : []);
      setWaSkipped(Array.isArray(j.skipped) ? j.skipped : []);
      router.refresh(); // surface the new PLANNED activities
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  // Open every generated link with a 300ms stagger. Browsers may block all but
  // the first — the UI shows a hint to allow popups for this site.
  function openAllWa() {
    waLinks.forEach((l, i) => {
      setTimeout(() => window.open(l.waLink, "_blank", "noopener,noreferrer"), i * 300);
    });
  }

  return (
    <>
      {/* ── TABLE VIEW — desktop only; mobile falls through to cards below ─── */}
      {view === "table" && (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block card overflow-x-auto w-full">
            {(() => {
              // Build sort URL helper — no useSearchParams needed, params come via prop
              function sortHref(key: string): string {
                const params = new URLSearchParams(searchParamsStr);
                const cur = params.get("sort");
                const next = cur === `${key}_asc` ? `${key}_desc` : `${key}_asc`;
                params.set("sort", next);
                params.delete("page");
                return `/leads?${params.toString()}`;
              }
              function SortIcon({ k }: { k: string }) {
                const cur = new URLSearchParams(searchParamsStr).get("sort");
                if (cur === `${k}_asc`) return <span className="text-blue-500 ml-0.5">▲</span>;
                if (cur === `${k}_desc`) return <span className="text-blue-500 ml-0.5">▼</span>;
                return <span className="opacity-25 ml-0.5 text-[9px]">⇅</span>;
              }
              const WHEN: Record<string, string> = {
                IMMEDIATE: "⚡ Immediate", THIRTY_DAYS: "📅 1 Month",
                THREE_MONTHS: "✈ Visit Dubai", SIX_PLUS_MONTHS: "⏳ 6+ Months",
                WINDOW_SHOPPING: "📆 Window Shopping",
              };
              const thCls = "px-3 py-2 font-semibold text-gray-600 dark:text-slate-300 whitespace-nowrap text-left bg-gray-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wide";
              const sortThCls = `${thCls} cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-700/60 select-none`;
              // Total visible columns count (for colSpan on empty row)
              const colCount = 9 + (showSource ? 1 : 0);
              // Spec §6: Name·Status·Budget·Follow-Up·Assigned·Source(admin)·LastActivity·Actions
              // §1 Assigned=display-only · §4 C/NC removed · §5 Actions always visible
              return (
                <table className="w-full text-xs border-collapse" style={{ tableLayout: "fixed" }}>
                  <colgroup>
                    {/* checkbox */}<col style={{ width: 28 }} />
                    {/* name     */}<col style={{ width: 170 }} />
                    {/* status   */}<col style={{ width: 135 }} />
                    {/* budget   */}<col style={{ width: 95 }} />
                    {/* follow-up*/}<col style={{ width: 95 }} />
                    {/* assigned */}<col style={{ width: 110 }} />
                    {showSource && <col style={{ width: 80 }} />}
                    {/* activity */}<col style={{ width: 130 }} />
                    {/* actions  */}<col style={{ width: 108 }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-slate-700">
                      <th className={thCls}>
                        {canBulk && <input type="checkbox" checked={allChecked} onChange={toggleAll} />}
                      </th>
                      <th className={sortThCls} onClick={() => router.push(sortHref("name"))}>Name <SortIcon k="name" /></th>
                      <th className={sortThCls} onClick={() => router.push(sortHref("status"))}>Status <SortIcon k="status" /></th>
                      <th className={sortThCls} onClick={() => router.push(sortHref("budget"))}>Budget <SortIcon k="budget" /></th>
                      <th className={sortThCls} onClick={() => router.push(sortHref("followup"))}>Follow-Up <SortIcon k="followup" /></th>
                      <th className={thCls}>Assigned</th>
                      {showSource && <th className={thCls}>Source</th>}
                      <th className={thCls}>Last Activity</th>
                      <th className={thCls}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.length === 0 && (
                      <tr><td colSpan={7 + (showSource ? 1 : 0)} className="px-4 py-10 text-center text-gray-400 text-sm">No leads match these filters.</td></tr>
                    )}
                    {leads.map((l, i) => {
                      const lastAct = fmtLastActivity(l.lastActivityType, l.lastActivityAt);
                      return (
                      <tr key={l.id}
                        onClick={() => router.push(`/leads/${l.id}`)}
                        className={`border-b border-gray-100 dark:border-slate-700/60 cursor-pointer hover:bg-blue-50/60 dark:hover:bg-blue-900/20 transition-colors ${i % 2 === 1 ? "bg-gray-50/30 dark:bg-slate-800/30" : "bg-white dark:bg-slate-800"}`}>

                        {/* 1. Checkbox */}
                        <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                          {canBulk && <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />}
                        </td>

                        {/* 2. Name */}
                        <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-slate-100 truncate">
                          <Link href={`/leads/${l.id}`} onClick={e => e.stopPropagation()}
                            className="hover:text-[#0b1a33] dark:hover:text-blue-300 hover:underline">{l.name}</Link>
                        </td>

                        {/* 3. Status — floating popover, table never shifts */}
                        <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>
                          <div className="relative" data-status-popover>
                            <button type="button"
                              onClick={() => setStatusOpenFor(statusOpenFor === l.id ? null : l.id)}
                              className={`${statusColor(l.currentStatus)} text-[10px] px-2 py-0.5 rounded-full border font-medium inline-flex items-center gap-0.5 max-w-full`}
                              title={l.currentStatus ?? ""}>
                              <span className="truncate max-w-[90px]">{l.currentStatus ?? "Set status"}</span>
                              <span className="shrink-0">▾</span>
                            </button>
                            {statusOpenFor === l.id && (
                              <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl w-52 max-h-72 overflow-y-auto py-1"
                                onClick={e => e.stopPropagation()}>
                                {EXCEL_LEAD_STATUSES.map(s => (
                                  <button key={s} type="button"
                                    onClick={() => quickSetStatus(l.id, s)}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 flex items-center gap-2 ${l.currentStatus === s ? "font-semibold text-[#0b1a33] dark:text-blue-300" : "text-gray-700 dark:text-slate-200"}`}>
                                    <span className={`${statusColor(s)} px-1.5 py-0.5 rounded-full text-[9px] border shrink-0`}>{s}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 4. Budget */}
                        <td className="px-3 py-1.5 text-gray-700 dark:text-slate-300 whitespace-nowrap tabular-nums text-xs">
                          {l.budgetFormatted ?? <span className="text-gray-300">—</span>}
                        </td>

                        {/* 5. Follow-Up — click to change date, floating picker */}
                        <td className="px-3 py-1.5" onClick={e => e.stopPropagation()}>
                          <div className="relative" data-picker-popover>
                            <button type="button"
                              onClick={() => setPickerOpenFor(pickerOpenFor === l.id ? null : l.id)}
                              className={`text-xs flex items-center gap-0.5 whitespace-nowrap ${l.followupDate ? "text-emerald-700 dark:text-emerald-400 font-medium" : "text-gray-300 hover:text-gray-400"}`}>
                              {l.followupDate ?? "—"}
                            </button>
                            {pickerOpenFor === l.id && (
                              <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl p-3 min-w-[180px]"
                                onClick={e => e.stopPropagation()}>
                                <div className="text-[10px] text-gray-500 dark:text-slate-400 mb-1.5 font-semibold">Set follow-up date</div>
                                <input type="date" autoFocus
                                  className="text-xs border border-gray-200 dark:border-slate-600 rounded-md px-2 py-1.5 bg-white dark:bg-slate-700 dark:text-slate-100 outline-none focus:ring-2 focus:ring-blue-200 w-full"
                                  defaultValue={l.followupRaw ?? ""}
                                  onChange={e => e.target.value && quickSetFollowup(l.id, e.target.value)} />
                                {l.followupDate && (
                                  <button type="button" onClick={() => quickSetFollowup(l.id, "")}
                                    className="mt-1.5 text-[10px] text-red-500 hover:text-red-700">
                                    × Clear
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 6. Assigned — display only (§1: controlled workflow, no accidental reassign) */}
                        <td className="px-3 py-1.5 text-gray-600 dark:text-slate-300 text-xs truncate">
                          {l.owner?.name ?? <span className="text-amber-500 text-[10px]">Unassigned</span>}
                        </td>

                        {/* 7. Source — admin/manager only (§2) */}
                        {showSource && (
                          <td className="px-3 py-1.5 text-gray-400 dark:text-slate-400 text-xs truncate">
                            {l.srcLabel}
                          </td>
                        )}

                        {/* 8. Last Activity */}
                        <td className="px-3 py-1.5 text-gray-500 dark:text-slate-400 text-xs truncate">
                          {lastAct ?? <span className="text-gray-300">—</span>}
                        </td>

                        {/* 9. Actions — ALWAYS VISIBLE (§5: no invisible hover area) */}
                        <td className="px-2 py-1.5 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-0.5">
                            {l.phone && (
                              <a href={`tel:${l.phone}`} title="Call"
                                className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-colors">
                                <Phone className="w-3.5 h-3.5" />
                              </a>
                            )}
                            {l.phone && (
                              <a href={whatsappLink(l.phone, "")} target="_blank" rel="noreferrer" title="WhatsApp"
                                className="p-1.5 rounded-md text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors">
                                <WaIcon />
                              </a>
                            )}
                            <button type="button" title="Set follow-up"
                              onClick={() => setPickerOpenFor(pickerOpenFor === l.id ? null : l.id)}
                              className="p-1.5 rounded-md text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors">
                              <Calendar className="w-3.5 h-3.5" />
                            </button>
                            <Link href={`/leads/${l.id}`} title="Open lead" onClick={e => e.stopPropagation()}
                              className="p-1.5 rounded-md text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          </div>
          {/* ─── MOBILE CARDS (§7+§8) — dedicated layout, not a shrunken table ─── */}
          <div className="sm:hidden space-y-2">
            {leads.length === 0 && <div className="card p-5 text-center text-gray-500 text-sm">No leads match these filters.</div>}
            {leads.map(l => (
              <div key={l.id} className="bg-white dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-700 p-3 shadow-sm">
                {/* Row 1: Name + Status badge */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <Link href={`/leads/${l.id}`} className="font-bold text-sm text-[#0b1a33] dark:text-white truncate">
                    {l.name}
                  </Link>
                  <span className={`${statusColor(l.currentStatus)} text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0`}>
                    {l.currentStatus ?? "—"}
                  </span>
                </div>
                {/* Row 2: Phone + Budget */}
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400 mb-1">
                  {l.phone && (
                    <span className="flex items-center gap-1 font-mono">
                      📞 ···{l.phone.slice(-4)}
                    </span>
                  )}
                  {l.budgetFormatted && (
                    <span className="text-gray-700 dark:text-slate-300 font-medium">
                      💰 {l.budgetFormatted}
                    </span>
                  )}
                </div>
                {/* Row 3: Follow-up date */}
                {l.followupDate && (
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mb-2">
                    📅 Follow-up: <span className="font-medium">{l.followupDate}</span>
                  </div>
                )}
                {/* Row 4: Action icons — ALWAYS VISIBLE on mobile (§8, no hover on touch) */}
                <div className="flex items-center gap-1 pt-2 border-t border-gray-50 dark:border-slate-700">
                  {l.phone && (
                    <a href={`tel:${l.phone}`}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-xs font-medium"
                      onClick={e => e.stopPropagation()}>
                      <Phone className="w-3.5 h-3.5" /> Call
                    </a>
                  )}
                  {l.phone && (
                    <a href={whatsappLink(l.phone, "")} target="_blank" rel="noreferrer"
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-green-600 bg-green-50 dark:bg-green-900/20 text-xs font-medium"
                      onClick={e => e.stopPropagation()}>
                      <WaIcon /> WA
                    </a>
                  )}
                  <button type="button"
                    onClick={e => { e.stopPropagation(); setPickerOpenFor(pickerOpenFor === l.id ? null : l.id); }}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-blue-600 bg-blue-50 dark:bg-blue-900/20 text-xs font-medium">
                    <Calendar className="w-3.5 h-3.5" /> Date
                  </button>
                  <Link href={`/leads/${l.id}`}
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 text-xs font-medium"
                    onClick={e => e.stopPropagation()}>
                    <ExternalLink className="w-3.5 h-3.5" /> Open
                  </Link>
                </div>
                {/* Follow-up date picker (mobile) */}
                {pickerOpenFor === l.id && (
                  <div className="mt-2 pt-2 border-t border-gray-100 dark:border-slate-700" data-picker-popover
                    onClick={e => e.stopPropagation()}>
                    <input type="date" autoFocus
                      className="text-xs border border-gray-200 dark:border-slate-600 rounded-md px-2 py-1.5 bg-white dark:bg-slate-700 dark:text-slate-100 outline-none w-full"
                      defaultValue={l.followupRaw ?? ""}
                      onChange={e => e.target.value && quickSetFollowup(l.id, e.target.value)} />
                    {l.followupDate && (
                      <button type="button" onClick={() => quickSetFollowup(l.id, "")}
                        className="mt-1 text-[10px] text-red-500">× Clear date</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* CARD VIEW — mobile+desktop cards when view=cards */}
      <div className={`${view === "table" ? "hidden" : ""} lg:hidden space-y-2`}>
        {leads.length === 0 && <div className="card p-6 text-center text-gray-500 dark:text-slate-400 text-sm">No leads match these filters.</div>}
        {leads.map((l) => {
          const maskedPhone = l.phone ? `···${l.phone.slice(-4)}` : null;
          const intel = l.intelligenceMatch;
          const nextAction = l.todoNext ?? (l.followupDate ? `Follow-up: ${l.followupDate}` : null);
          return (
            <div key={l.id} className="card p-3 active:bg-amber-50">
              <div className="flex items-start gap-2">
                {canBulk && (
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="mt-1" />
                )}
                <Link href={`/leads/${l.id}`} className="flex-1 min-w-0 block">
                  {/* Row 1: Name · Phone masked · Status */}
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <span className="font-bold text-sm text-[#0b1a33] truncate">{l.name}</span>
                      {maskedPhone && <span className="text-[10px] text-gray-400 dark:text-slate-500 font-mono flex-none">{maskedPhone}</span>}
                    </div>
                    <div className="flex items-center gap-1 flex-none relative" data-status-popover>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setStatusOpenFor(statusOpenFor === l.id ? null : l.id); }}
                        className={`${statusColor(l.currentStatus)} text-[10px] px-2 py-0.5 rounded-full border font-medium inline-flex items-center gap-0.5`}
                      >
                        {l.currentStatus ?? "Set status"}<span aria-hidden>▾</span>
                      </button>
                      {statusOpenFor === l.id && (
                        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl w-52 max-h-72 overflow-y-auto py-1"
                          onClick={e => e.stopPropagation()}>
                          {EXCEL_LEAD_STATUSES.map(s => (
                            <button key={s} type="button"
                              onClick={() => quickSetStatus(l.id, s)}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 ${l.currentStatus === s ? "font-semibold" : "text-gray-700 dark:text-slate-200"}`}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Row 2: Budget · BANT · Need */}
                  <div className="flex items-center gap-1 text-[10px] text-gray-600 dark:text-slate-300 mt-0.5 flex-wrap">
                    <span>💰 {l.budgetFormatted ?? "—"}</span>
                    <span className="text-gray-300 dark:text-slate-600">·</span>
                    <span>📋 BANT {l.bantCount}/4</span>
                    {l.needSummary && (
                      <>
                        <span className="text-gray-300">·</span>
                        <span className="truncate max-w-[160px] text-gray-500 dark:text-slate-400">🎯 {l.needSummary}</span>
                      </>
                    )}
                  </div>
                  {/* Row 3: Projects · Intel · Last */}
                  <div className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-slate-400 mt-0.5 flex-wrap">
                    {l.discussedProjects.length > 0 ? (
                      l.discussedProjects.slice(0, 2).map((p, i) => (
                        <span key={i} className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-1 py-0 rounded">{p}</span>
                      ))
                    ) : l.interest ? (
                      <span className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-1 py-0 rounded truncate max-w-[120px]">{l.interest}</span>
                    ) : null}
                    {intel?.matchType === "STRONG" && (
                      <span className="text-[9px] font-semibold px-1 py-0 rounded bg-red-100 text-red-700">🏠 Existing</span>
                    )}
                    {intel?.matchType === "MEDIUM" && (
                      <span className="text-[9px] font-semibold px-1 py-0 rounded bg-amber-100 text-amber-700">~ Possible</span>
                    )}
                    {l.lastTouched && (
                      <span className={idleClass(l.lastTouchedAt as string | null)}>
                        · {l.lastTouched} ago
                        {(() => { const d = l.lastTouchedAt ? (Date.now() - new Date(l.lastTouchedAt as string).getTime()) / (1000 * 60 * 60 * 24) : 0; return d > 7 ? <span className="ml-1 text-[10px] bg-red-100 text-red-700 px-1 rounded">idle</span> : null; })()}
                      </span>
                    )}
                  </div>
                  {/* Row 4: Next action · Owner */}
                  <div className="flex items-center justify-between mt-1 text-[10px]">
                    <span className="flex items-center gap-1 text-gray-500 dark:text-slate-400 truncate max-w-[180px]">
                      {nextAction ? (l.todoNext ? `📌 ${nextAction}` : `📅 ${nextAction}`) : ""}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setPickerOpenFor(pickerOpenFor === l.id ? null : l.id); }}
                        className="text-gray-400 hover:text-blue-600 text-xs flex-none"
                        title="Set follow-up date"
                      >📅</button>
                      {pickerOpenFor === l.id && (
                        <input
                          type="date"
                          autoFocus
                          className="text-xs border rounded px-1 py-0.5"
                          defaultValue={l.followupDate ?? ""}
                          onChange={(e) => quickSetFollowup(l.id, e.target.value)}
                        />
                      )}
                    </span>
                    {canReassign && l.owner && (
                      <span className={`avatar ${l.owner.avatarColor} inline-flex w-5 h-5 text-[9px]`} title={l.owner.name}>
                        {l.owner.name.split(" ").map((s: string) => s[0]).slice(0, 2).join("")}
                      </span>
                    )}
                  </div>
                </Link>
                {/* Direct-action call/WA buttons */}
                {l.phone && (
                  <div className="flex flex-col gap-1.5 flex-none items-center">
                    <a
                      href={telLink(l.phone) || "#"}
                      aria-label={`Call ${l.name}`}
                      className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-sm active:bg-emerald-700"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                    <a
                      href={whatsappLink(l.phone) || "#"}
                      target="_blank" rel="noopener noreferrer"
                      aria-label={`WhatsApp ${l.name}`}
                      className="w-10 h-10 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-sm active:bg-[#1ea953]"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </a>
                    {l.phone && <CopyPhoneButton phone={l.phone} />}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* DESKTOP: Clean multi-column table (hidden in table mode — Excel table above handles it) */}
      <div className={`${view === "table" ? "hidden" : "hidden lg:block"} card overflow-x-auto`}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[#e5e7eb] dark:border-slate-700 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 bg-gray-50/80 dark:bg-slate-800/50">
              <th className="w-8 px-3 py-2.5">
                {canBulk && <input type="checkbox" checked={allChecked} onChange={toggleAll} />}
              </th>
              <th className="px-3 py-2.5">Lead</th>
              <th className="px-3 py-2.5 w-36">Status</th>
              {canReassign && <th className="px-3 py-2.5 w-32">Assigned to</th>}
              <th className="px-3 py-2.5 w-60">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f1f3f5] dark:divide-slate-800">
            {leads.length === 0 && (
              <tr>
                <td colSpan={canReassign ? 5 : 4} className="text-center py-8 text-gray-500 dark:text-slate-400">
                  No leads match these filters. Try clearing some.
                </td>
              </tr>
            )}
            {leads.map((l) => {
              const maskedPhone = l.phone ? `···${l.phone.slice(-4)}` : null;
              const intel = l.intelligenceMatch;
              const nextAction = l.todoNext ?? (l.followupDate ? `Follow-up: ${l.followupDate}` : null);

              return (
                <tr
                  key={l.id}
                  className={`transition-colors hover:bg-amber-50/40 dark:hover:bg-slate-800/40 ${selected.has(l.id) ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-3 w-8 align-top">
                    {canBulk && <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />}
                  </td>

                  {/* ── Lead Name + intel ── */}
                  <td className="px-3 py-3 align-top cursor-pointer" onClick={() => router.push(`/leads/${l.id}`)}>
                    {/* Row 1: Name · Phone */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                      <span className="font-bold text-[#0b1a33] dark:text-white text-sm leading-tight">{l.name}</span>
                      {maskedPhone && (
                        <span className="text-[11px] text-gray-400 dark:text-slate-500 font-mono">{maskedPhone}</span>
                      )}
                      {l.phone && <CopyPhoneButton phone={l.phone} />}
                      {intel?.matchType === "STRONG" && (
                        <span className="text-[9px] font-semibold px-1 py-0 rounded bg-red-100 text-red-700">🏠 Existing</span>
                      )}
                      {intel?.matchType === "MEDIUM" && (
                        <span className="text-[9px] font-semibold px-1 py-0 rounded bg-amber-100 text-amber-700">~ Possible</span>
                      )}
                    </div>
                    {/* Row 2: Budget · BANT · Need */}
                    <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-slate-400 flex-wrap">
                      <span>💰 {l.budgetFormatted ?? "—"}</span>
                      <span className="text-gray-300 dark:text-slate-600">·</span>
                      <span>BANT {l.bantCount}/4</span>
                      {l.needSummary && (
                        <><span className="text-gray-300 dark:text-slate-600">·</span>
                        <span className="truncate max-w-[200px] text-gray-500 dark:text-slate-400">🎯 {l.needSummary}</span></>
                      )}
                    </div>
                    {/* Row 3: Projects · Last touch · Next action */}
                    <div className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500 mt-0.5 flex-wrap">
                      {l.discussedProjects.length > 0 ? (
                        l.discussedProjects.slice(0, 3).map((p, i) => (
                          <span key={i} className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 rounded text-[10px]">{p}</span>
                        ))
                      ) : l.interest ? (
                        <span className="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 rounded text-[10px] truncate max-w-[120px]">{l.interest}</span>
                      ) : null}
                      {l.lastTouched && (
                        <span className={`${idleClass(l.lastTouchedAt as string | null)} ml-1`}>
                          · {l.lastTouched} ago
                          {(() => {
                            const d = l.lastTouchedAt ? (Date.now() - new Date(l.lastTouchedAt as string).getTime()) / (1000 * 60 * 60 * 24) : 0;
                            return d > 7 ? <span className="ml-1 text-[10px] bg-red-100 text-red-700 px-1 rounded">idle</span> : null;
                          })()}
                        </span>
                      )}
                      {nextAction && (
                        <span className="text-gray-400 dark:text-slate-500 truncate max-w-[150px]">
                          · {l.todoNext ? `📌 ${nextAction}` : `📅 ${nextAction}`}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* ── Status chip (floating popover) ── */}
                  <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                    <div className="relative" data-status-popover>
                      <button type="button"
                        onClick={() => setStatusOpenFor(statusOpenFor === l.id ? null : l.id)}
                        className={`${statusColor(l.currentStatus)} text-[10px] px-2 py-0.5 rounded-full border font-medium inline-flex items-center gap-0.5 whitespace-nowrap`}>
                        {l.currentStatus ?? "Set status"}<span aria-hidden>▾</span>
                      </button>
                      {statusOpenFor === l.id && (
                        <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-lg shadow-xl w-52 max-h-64 overflow-y-auto py-1"
                          onClick={e => e.stopPropagation()}>
                          {EXCEL_LEAD_STATUSES.map(s => (
                            <button key={s} type="button"
                              onClick={() => quickSetStatus(l.id, s)}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 ${l.currentStatus === s ? "font-semibold text-[#0b1a33] dark:text-blue-300" : "text-gray-700 dark:text-slate-200"}`}>
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* ── Assigned to — admin/manager only ── */}
                  {canReassign && (
                    <td className="px-3 py-3 align-top">
                      {l.owner ? (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`avatar ${l.owner.avatarColor} w-6 h-6 text-[9px] flex-none inline-flex items-center justify-center rounded-full font-bold`}
                            title={l.owner.name}
                          >
                            {l.owner.name.split(" ").map((s: string) => s[0]).slice(0, 2).join("")}
                          </span>
                          <span className="text-xs text-gray-600 dark:text-slate-300 truncate max-w-[72px]" title={l.owner.name}>
                            {l.owner.name.split(" ")[0]}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Unassigned</span>
                      )}
                    </td>
                  )}

                  {/* ── Actions ── */}
                  <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1 flex-nowrap">

                      {/* 1. Call */}
                      {l.phone && (
                        <a href={telLink(l.phone) || "#"} title={`Call ${l.name}`}
                          className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors flex-none">
                          <Phone className="w-3.5 h-3.5" />
                        </a>
                      )}

                      {/* 2. WhatsApp — real brand icon */}
                      {l.phone && (
                        <a href={whatsappLink(l.phone) || "#"} target="_blank" rel="noopener noreferrer"
                          title={`WhatsApp ${l.name}`}
                          className="w-8 h-8 rounded-lg bg-[#25D366] hover:bg-[#1ea953] text-white flex items-center justify-center transition-colors flex-none">
                          <WaIcon />
                        </a>
                      )}

                      {/* 3. Follow-up */}
                      <div className="relative flex-none">
                        <button type="button" title="Set follow-up date"
                          onClick={() => setPickerOpenFor(pickerOpenFor === l.id ? null : l.id)}
                          className="w-8 h-8 rounded-lg bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center transition-colors">
                          <Calendar className="w-3.5 h-3.5" />
                        </button>
                        {pickerOpenFor === l.id && (
                          <input type="date" autoFocus
                            className="absolute top-9 left-0 z-20 text-xs border rounded px-2 py-1 shadow-lg bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                            defaultValue={l.followupDate ?? ""}
                            onChange={(e) => quickSetFollowup(l.id, e.target.value)}
                          />
                        )}
                      </div>

                      {/* 4. Email */}
                      {l.email && (
                        <a href={`mailto:${l.email}`} title={`Email ${l.name}`}
                          className="w-8 h-8 rounded-lg bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center transition-colors flex-none">
                          <Mail className="w-3.5 h-3.5" />
                        </a>
                      )}

                      {/* 5. Edit */}
                      <button type="button" title="Open lead"
                        onClick={() => router.push(`/leads/${l.id}`)}
                        className="w-8 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-colors flex-none">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      {/* 6. Delete — admin / manager only */}
                      {canBulk && (
                        <button type="button" title="Reject lead"
                          onClick={() => { setDeleteTarget({ id: l.id, name: l.name }); setDeleteReason("NOT_INTERESTED"); }}
                          className="w-8 h-8 rounded-lg bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors flex-none">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* ─── Bulk action bar (Tag · WhatsApp · Reassign · Reject) ─────
          Sticky bottom bar; appears when rows are selected.
          Safe-bottom inset so iPhone home indicator doesn't eat buttons. */}
      {canBulk && selectedIds.length > 0 && (
        <>
          <div
            className="fixed left-0 right-0 z-50 bg-white dark:bg-slate-800 border-t border-[#e5e7eb] dark:border-slate-700 shadow-2xl px-3 py-2 safe-bottom"
            style={{ bottom: 0 }}
          >
            <div className="max-w-5xl mx-auto flex items-center gap-2 flex-wrap">
              <div className="text-xs font-semibold text-[#0b1a33] dark:text-white mr-1">
                {selectedIds.length} selected
              </div>
              <button
                onClick={clearSelection}
                className="text-[11px] text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 underline"
              >
                Clear
              </button>
              <div className="w-px h-6 bg-gray-200 dark:bg-slate-600 mx-1" />
              <button
                onClick={() => { setShowTagPopover(v => !v); setShowReassignPopover(false); setShowWaPopover(false); }}
                className="inline-flex items-center gap-1 text-xs font-semibold bg-fuchsia-50 text-fuchsia-800 border border-fuchsia-300 px-3 py-2 rounded-lg min-h-11"
              >
                <Tag className="w-3.5 h-3.5" /> Tag
              </button>
              <button
                onClick={() => { setShowWaPopover(v => !v); setShowTagPopover(false); setShowReassignPopover(false); }}
                className="inline-flex items-center gap-1 text-xs font-semibold bg-[#e7f9ef] text-[#0f7a3d] border border-[#9ce0bb] px-3 py-2 rounded-lg min-h-11"
              >
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
              </button>
              {canReassign && (
                <button
                  onClick={() => { setShowReassignPopover(v => !v); setShowTagPopover(false); setShowWaPopover(false); }}
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-300 px-3 py-2 rounded-lg min-h-11"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reassign
                </button>
              )}
              <button
                onClick={() => { setShowRejectModal(true); setShowTagPopover(false); setShowReassignPopover(false); setShowWaPopover(false); }}
                className="inline-flex items-center gap-1 text-xs font-semibold bg-red-50 text-red-800 border border-red-300 px-3 py-2 rounded-lg min-h-11"
              >
                <XCircle className="w-3.5 h-3.5" /> Reject
              </button>
            </div>

            {/* Tag popover — multi-select checkbox grid. Anchored above the
                bar via absolute positioning relative to viewport (mb-2 from
                the bar by stacking it just above with bottom-full). */}
            {showTagPopover && (
              <div className="absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md bottom-full mb-2 bg-white dark:bg-slate-800 border border-[#e5e7eb] dark:border-slate-700 rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#0b1a33] dark:text-white">Add tags to {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}</div>
                  <button onClick={() => setShowTagPopover(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {PRESET_TAGS.map((t) => {
                    const on = pickedTags.has(t);
                    return (
                      <button
                        key={t}
                        onClick={() => togglePickedTag(t)}
                        className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold border ${on ? "bg-fuchsia-600 text-white border-fuchsia-600" : "bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-100 border-[#e5e7eb] dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600"}`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
                {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowTagPopover(false)} className="btn btn-ghost text-xs">Cancel</button>
                  <button
                    onClick={applyBulkTag}
                    disabled={bulkBusy || pickedTags.size === 0}
                    className="btn btn-primary text-xs"
                  >
                    {bulkBusy ? "Applying…" : `Apply (${pickedTags.size})`}
                  </button>
                </div>
              </div>
            )}

            {/* Reassign popover — single-select agent dropdown. */}
            {showReassignPopover && canReassign && (
              <div className="absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md bottom-full mb-2 bg-white dark:bg-slate-800 border border-[#e5e7eb] dark:border-slate-700 rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#0b1a33] dark:text-white">Reassign {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}</div>
                  <button onClick={() => setShowReassignPopover(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>
                <select
                  value={reassignPick}
                  onChange={(e) => setReassignPick(e.target.value)}
                  className="w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 mb-3"
                >
                  <option value="">Pick an agent…</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.team ?? "—"})</option>)}
                </select>
                {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                {bulkCrossTeamWarn && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2">⚠️ {bulkCrossTeamWarn}</div>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowReassignPopover(false)} className="btn btn-ghost text-xs">Cancel</button>
                  <button
                    onClick={applyBulkReassign}
                    disabled={bulkBusy || !reassignPick}
                    className="btn btn-primary text-xs"
                  >
                    {bulkBusy ? "Reassigning…" : "Apply"}
                  </button>
                </div>
              </div>
            )}

            {/* WhatsApp popover — pick a template, generate wa.me draft links.
                WhatsApp can't be sent server-side (no Meta API), so the agent
                opens each link one-by-one (or "Open all" with a 300ms stagger). */}
            {showWaPopover && (
              <div className="absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md bottom-full mb-2 bg-white dark:bg-slate-800 border border-[#e5e7eb] dark:border-slate-700 rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#0b1a33] dark:text-white inline-flex items-center gap-1.5">
                    <MessageCircle className="w-4 h-4 text-[#0f7a3d]" />
                    WhatsApp {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}
                  </div>
                  <button onClick={() => setShowWaPopover(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>

                {waLinks.length === 0 && waSkipped.length === 0 ? (
                  <>
                    <label className="text-[11px] font-semibold text-gray-600 dark:text-slate-300">Template</label>
                    <select
                      value={waTemplate}
                      onChange={(e) => setWaTemplate(e.target.value)}
                      className="w-full mt-1 mb-3 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
                    >
                      {WA_PRESETS.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
                    </select>
                    {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowWaPopover(false)} className="btn btn-ghost text-xs">Cancel</button>
                      <button
                        onClick={generateWaLinks}
                        disabled={bulkBusy}
                        className="btn btn-primary text-xs"
                      >
                        {bulkBusy ? "Generating…" : "Generate links"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">
                      {waLinks.length} link{waLinks.length === 1 ? "" : "s"} ready. Tap each to open WhatsApp with the message pre-typed, then hit Send.
                      {waLinks.length > 1 && " “Open all” staggers them — your browser may block extras, so allow popups for this site."}
                    </p>
                    {waLinks.length > 0 && (
                      <div className="max-h-56 overflow-y-auto border border-[#eef0f3] rounded-lg divide-y divide-[#f1f3f5] mb-2">
                        {waLinks.map((l) => (
                          <a
                            key={l.leadId}
                            href={l.waLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-[#f3fbf6]"
                          >
                            <span className="truncate font-medium text-[#0b1a33]">Open WhatsApp — {l.name}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-[#0f7a3d] flex-none" />
                          </a>
                        ))}
                      </div>
                    )}
                    {waSkipped.length > 0 && (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
                        Skipped {waSkipped.length} (no phone): {waSkipped.slice(0, 5).map(s => s.name).join(", ")}{waSkipped.length > 5 ? "…" : ""}
                      </div>
                    )}
                    <div className="flex justify-between gap-2">
                      <button
                        onClick={() => { setWaLinks([]); setWaSkipped([]); setBulkErr(null); }}
                        className="btn btn-ghost text-xs"
                      >
                        Back
                      </button>
                      {waLinks.length > 0 && (
                        <button onClick={openAllWa} className="btn btn-primary text-xs">
                          Open all ({waLinks.length})
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Reject modal — full-screen overlay so the textarea has room. */}
          {showRejectModal && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !bulkBusy && setShowRejectModal(false)}>
              <div
                className="bg-white dark:bg-slate-800 sm:rounded-xl rounded-t-2xl max-w-md w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto safe-bottom"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-lg flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-red-600" />
                    Reject {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}
                  </div>
                  <button onClick={() => setShowRejectModal(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
                  Each lead is marked LOST, removed from Today's follow-ups, and the reason is recorded in Reports.
                </p>

                <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Reason *</label>
                <select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full mt-1 mb-3 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
                >
                  {REJECT_REASONS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>

                <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">
                  {rejectReason === "OTHER" ? "Specify *" : "Note (optional)"}
                </label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={3}
                  placeholder={
                    rejectReason === "OTHER"
                      ? "e.g. Client passed away, moved abroad, family dispute…"
                      : "Add context — what did they say?"
                  }
                  className="w-full mt-1 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm font-mono text-[13px] dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
                />

                {bulkErr && <div className="text-xs text-red-600 mt-2">{bulkErr}</div>}

                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowRejectModal(false)} className="btn btn-ghost">Cancel</button>
                  <button
                    onClick={applyBulkReject}
                    disabled={bulkBusy}
                    className="btn bg-red-600 hover:bg-red-700 text-white"
                  >
                    {bulkBusy ? "Rejecting…" : `Reject ${selectedIds.length}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {/* ── Delete / Reject confirm modal ── */}
      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !deleteBusy && setDeleteTarget(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-xl max-w-sm w-full p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <Trash2 className="w-4 h-4 text-red-500 flex-none" />
              <span className="font-semibold text-base">Reject "{deleteTarget.name}"?</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
              Lead will be marked Lost and removed from the active queue.
            </p>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Reason</label>
            <select
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              className="w-full mt-1 mb-4 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="NOT_INTERESTED">Not Interested</option>
              <option value="LOW_BUDGET">Low Budget</option>
              <option value="FUND_ISSUE">Fund Issue</option>
              <option value="NEVER_RESPONDED">Never Responded</option>
              <option value="JUST_SEARCHING">Just Searching</option>
              <option value="DROP_THE_PLAN">Drop The Plan</option>
              <option value="WAR_FEAR">War / Market Fear</option>
              <option value="WAITING_FOR_PROPERTY_SALE">Waiting to Sell Own Property</option>
              <option value="INVALID_NUMBER">Invalid Number</option>
              <option value="OTHER">Other</option>
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="btn btn-ghost text-sm">
                Cancel
              </button>
              <button
                onClick={quickReject}
                disabled={deleteBusy}
                className="btn bg-red-600 hover:bg-red-700 text-white text-sm"
              >
                {deleteBusy ? "Rejecting…" : "Reject Lead"}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
