"use client";

/**
 * RevivalEngineListClient — leads grid/table for /cold-calls.
 *
 * SAME list EXPERIENCE as the main Leads page (DRY — reuses the same bulk
 * endpoint and patterns), scoped to cold/revival data:
 *   • Mobile (<1024px): cards
 *   • Desktop (≥1024px): table with Lead / Status / Owner / Last touch / Source
 *     / Medium / Actions columns
 *   • Bulk toolbar (admin/mgr): select rows → Assign / Change team / Set status /
 *     Reject / Export — all via /api/leads/bulk (assign → assignLeadTo →
 *     Assignment-history row + notify). Mirrors Leads/Master-Data bulk actions.
 *
 * Filtering/search/saved-views are handled by the PAGE (shared <LeadFilters> +
 * <SavedFiltersBar> + leadFilterWhere), exactly like /leads. This component owns
 * the table + bulk + the Revival-specific bits (stale badge, cold reason,
 * Promote-to-Lead).
 */

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import ColdDataPromoteButton from "./ColdDataPromoteButton";
import OriginColdPromoteButton from "./OriginColdPromoteButton";
import { ActionIconButton } from "@/components/actions/ActionIconButton";
import { whatsappLink, telLink } from "@/lib/phone";
import { formatLeadName } from "@/lib/leadName";
import { statusesForTeam, compareStatusDisplay } from "@/lib/lead-statuses";

const REJECT_REASONS = [
  { value: "NOT_INTERESTED",            label: "Not Interested" },
  { value: "LOW_BUDGET",                label: "Low Budget" },
  { value: "FUND_ISSUE",                label: "Fund Issue" },
  { value: "NEVER_RESPONDED",           label: "Never Responded" },
  { value: "JUST_SEARCHING",            label: "Just Searching" },
  { value: "DROP_THE_PLAN",             label: "Drop The Plan" },
  { value: "WAITING_FOR_PROPERTY_SALE", label: "Waiting to Sell Own Property" },
  { value: "INVALID_NUMBER",            label: "Invalid Number" },
  { value: "OTHER",                     label: "Other" },
];

const TEAMS = ["Dubai", "India"];

export interface RevivalLead {
  id: string;
  name: string;
  phone: string | null;
  company: string | null;
  city: string | null;
  isColdCall: boolean;
  leadOrigin: string | null;
  status: string;
  currentStatus: string | null;
  statusChip: string;
  sourceRaw: string | null;
  medium: string | null;
  mediumOther: string | null;
  team: string | null;
  lastTouchedAt: Date | null;
  ownerId: string | null;
  owner: { name: string } | null;
  coldCallReason: string | null;
  alreadyBought: string | null;
  alreadyBoughtBy: string | null;
}

interface Props {
  leads: RevivalLead[];
  myId: string;
  isAdminOrMgr: boolean;
  canExport: boolean;
  agents: { id: string; name: string; team: string | null }[];
  /** ms timestamp so Date is not passed across server→client boundary */
  cutoffMs: number;
  coldDays: number;
  /** current URL params (querystring) so Export mirrors the active filters */
  exportParams: string;
  showSource: boolean;
}

type SortKey = "name" | "status" | "owner" | "touched" | "source";

// Per-row Call / WhatsApp now render via the central Action Design System
// (ActionIconButton + tokens). The old inline PhoneIcon/WaIcon SVGs (and the
// divergent blue Call colour) were removed — the brand WhatsApp glyph lives in
// components/actions/WhatsAppGlyph.tsx.

function mediumLabel(l: RevivalLead): string | null {
  if (!l.medium) return null;
  return l.medium === "Other" && l.mediumOther ? l.mediumOther : l.medium;
}

export default function RevivalEngineListClient({
  leads, myId, isAdminOrMgr, canExport, agents, cutoffMs, coldDays, exportParams, showSource,
}: Props) {
  const router = useRouter();
  const cutoff = new Date(cutoffMs);

  // ── Bulk select state ──────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState("NOT_INTERESTED");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [teamTo, setTeamTo] = useState("");
  const [statusTo, setStatusTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // ── Client-side column sort (parity with Leads sortable columns) ────────────
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  const sortedLeads = useMemo(() => {
    if (!sort) return leads;
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (l: RevivalLead): string | number => {
      switch (sort.key) {
        case "name": return formatLeadName(l.name).toLowerCase();
        case "status": return (l.currentStatus ?? l.status ?? "").toLowerCase();
        case "owner": return (l.owner?.name ?? "~").toLowerCase();
        case "source": return (l.sourceRaw ?? "~").toLowerCase();
        case "touched": return l.lastTouchedAt ? new Date(l.lastTouchedAt).getTime() : 0;
      }
    };
    return [...leads].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
    });
  }, [leads, sort]);

  const allChecked  = leads.length > 0 && selectedIds.size === leads.length;
  const someChecked = selectedIds.size > 0 && !allChecked;

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedIds(allChecked ? new Set() : new Set(leads.map(l => l.id)));
  }
  function clearSel() { setSelectedIds(new Set()); }

  // The status picker uses ONE team's status master (owner rule — never a merged
  // India+Dubai list). Disabled until the selection is narrowed to a single team.
  const selectedTeams = new Set<string>();
  for (const l of leads) if (selectedIds.has(l.id)) selectedTeams.add(l.team ?? "—");
  const bulkOneTeam = selectedTeams.size === 1 ? [...selectedTeams][0] : "";
  const bulkStatusOptions = (bulkOneTeam === "Dubai" || bulkOneTeam === "India")
    ? [...statusesForTeam(bulkOneTeam)].sort(compareStatusDisplay)
    : [];

  // ── Bulk action runner — POST /api/leads/bulk (same endpoint as Leads) ──────
  async function runBulk(action: string, extra: Record<string, unknown> = {}, clearAfter = true) {
    if (bulkBusy || selectedIds.size === 0) return;
    setBulkBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: [...selectedIds], ...extra }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? `Failed (${r.status})`); return; }
      const n = j.reassigned ?? j.updated ?? j.deleted ?? 0;
      setMsg(`Done — ${n} updated.${j.crossTeamWarningMessage ? " " + j.crossTeamWarningMessage : ""}`);
      if (clearAfter) clearSel();
      router.refresh();
    } catch (e) {
      setMsg(`Network error: ${String(e).slice(0, 80)}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function doBulkReject() {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", ids: [...selectedIds], reason: bulkReason }),
      });
      if (!r.ok) return;
      clearSel();
      setBulkModalOpen(false);
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // Export = the ADMIN CSV endpoint, scoped to cold/revival via master=1&cold=only
  // and carrying the CURRENT filter params so the CSV == the on-screen view.
  const exportHref = `/api/reports/export?type=leads&master=1&cold=only${exportParams ? `&${exportParams}` : ""}`;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function isStale(l: RevivalLead) {
    return l.lastTouchedAt && new Date(l.lastTouchedAt) < cutoff;
  }
  const canSee = (l: RevivalLead) => l.ownerId === myId || isAdminOrMgr;

  const btn = "text-xs font-semibold px-2.5 py-1.5 rounded-lg border whitespace-nowrap disabled:opacity-50";

  // ── Empty state ───────────────────────────────────────────────────────────
  if (leads.length === 0) {
    return (
      <div className="card p-8 text-center text-gray-500 text-sm">
        Nothing in this view. Either you&apos;re on top of follow-ups (✅), or no cold leads match the current filters.
      </div>
    );
  }

  const sortBtn = (key: SortKey) => () =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const sortArrow = (key: SortKey) => sort?.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";

  return (
    <>
      {/* ── Bulk toolbar (admin/mgr) — Assign / Team / Status / Reject / Export ── */}
      {isAdminOrMgr && (
        <div className="flex items-center gap-3 px-1 mb-1 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-gray-600">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              ref={(el) => { if (el) el.indeterminate = someChecked; }}
              className="w-4 h-4 cursor-pointer"
            />
            {selectedIds.size === 0 ? `Select all (${leads.length})` : `${selectedIds.size} selected`}
          </label>
          {canExport && (
            <a href={exportHref} className={`${btn} bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300`} title="Export this exact view to CSV">⬇ Export CSV</a>
          )}
        </div>
      )}

      {/* ── Floating bulk action bar ─────────────────────────────────────── */}
      {isAdminOrMgr && selectedIds.size > 0 && (
        <div className="sticky top-2 z-30 card p-2.5 flex flex-wrap items-center gap-2 border border-[#c9a24b]/40 bg-amber-50/70 dark:bg-slate-800">
          <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">{selectedIds.size} selected</span>

          {/* Assign → routes through assignLeadTo (Assignment row + notify) */}
          <span className="inline-flex items-center gap-1">
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600">
              <option value="">Assign to…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button disabled={bulkBusy || !assignTo} onClick={() => runBulk("reassign", { assignToUserId: assignTo })} className={`${btn} bg-blue-50 text-blue-800 border-blue-300`}>Assign</button>
          </span>

          {/* Change team */}
          <span className="inline-flex items-center gap-1">
            <select value={teamTo} onChange={(e) => setTeamTo(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600">
              <option value="">Team…</option>
              {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button disabled={bulkBusy || !teamTo} onClick={() => runBulk("set_team", { team: teamTo })} className={`${btn} bg-teal-50 text-teal-800 border-teal-300`} title="Set forwarded team for the selected leads">Change team</button>
          </span>

          {/* Set status — one team only (owner rule) */}
          <span className="inline-flex items-center gap-1">
            <select value={statusTo} onChange={(e) => setStatusTo(e.target.value)} disabled={bulkStatusOptions.length === 0} className="text-xs border rounded-lg px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600 disabled:opacity-50" title={bulkStatusOptions.length === 0 ? "Select leads from a single team to set status" : undefined}>
              <option value="">{bulkStatusOptions.length ? `Status… (${bulkOneTeam})` : "Status… (one team only)"}</option>
              {bulkStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button disabled={bulkBusy || !statusTo} onClick={() => runBulk("set_current_status", { status: statusTo })} className={`${btn} bg-violet-50 text-violet-800 border-violet-300`}>Set</button>
          </span>

          <button disabled={bulkBusy} onClick={() => setBulkModalOpen(true)} className={`${btn} bg-red-50 text-red-700 border-red-300`}>🗑 Reject</button>
          <button onClick={clearSel} className={`${btn} bg-white text-gray-500 border-gray-200 ml-auto`}>✕ Clear</button>
          {msg && <span className="text-xs text-gray-600 dark:text-slate-300 w-full">{msg}</span>}
        </div>
      )}
      {!selectedIds.size && msg && <div className="text-xs text-gray-600 dark:text-slate-300 mb-1">{msg}</div>}

      {/* ── MOBILE: card list (<1024px) ───────────────────────────────────── */}
      <div className="lg:hidden space-y-2">
        {sortedLeads.map((l) => {
          const wa  = l.phone ? (whatsappLink(l.phone, `Hi ${l.name.split(" ")[0]}, this is from White Collar Realty. Just checking in — any update on your property search?`) ?? "") : "";
          const tel = l.phone ? (telLink(l.phone) ?? "") : "";
          const isSelected = selectedIds.has(l.id);
          const isOriginCold = l.leadOrigin === "COLD" || l.leadOrigin === "REVIVAL";
          const stale = isStale(l);
          const med = mediumLabel(l);

          return (
            <div
              key={l.id}
              className={`card p-3 relative transition-colors ${isSelected ? "ring-2 ring-red-400 bg-red-50/30" : ""}`}
            >
              {isAdminOrMgr && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(l.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-2.5 left-2.5 w-4 h-4 cursor-pointer z-10"
                  aria-label={`Select ${l.name}`}
                />
              )}

              <div className={`flex items-start justify-between gap-2 ${isAdminOrMgr ? "pl-6" : ""}`}>
                <div className="min-w-0 flex-1">
                  <Link href={`/revival-engine/cold-data/${l.id}`} className="font-bold text-sm hover:underline truncate block text-[#0b1a33] dark:text-white">
                    {formatLeadName(l.name)}
                  </Link>
                  <div className="text-[11px] text-gray-500 truncate">
                    {l.phone}
                    {l.company && <span className="ml-1">· {l.company}</span>}
                  </div>
                </div>
              </div>

              {/* Status + stale + source/medium chips */}
              <div className="flex flex-wrap gap-1 mt-2">
                <span className={`chip ${l.statusChip} text-[10px]`}>{l.currentStatus ?? l.status}</span>
                {stale && <span className="chip chip-warm text-[9px]">{coldDays}d+ stale</span>}
                {!l.ownerId && <span className="chip chip-hot text-[9px]">UNASSIGNED</span>}
                {showSource && l.sourceRaw && <span className="chip src text-[9px]">{l.sourceRaw}</span>}
                {med && <span className="chip text-[9px] bg-slate-100 text-slate-600 border-slate-200">📡 {med}</span>}
                {l.alreadyBought && <span className="chip src text-[9px]" title={l.alreadyBought}>🏠 owns</span>}
              </div>

              {l.coldCallReason && (
                <div className="text-[11px] text-gray-700 mt-1 italic">&quot;{l.coldCallReason}&quot;</div>
              )}

              <div className="text-[11px] text-gray-500 mt-2 flex items-center justify-between">
                <span>{l.owner ? l.owner.name : "Unassigned"}</span>
                <span>
                  {l.lastTouchedAt
                    ? formatDistanceToNow(new Date(l.lastTouchedAt), { addSuffix: true })
                    : "never touched"}
                </span>
              </div>

              {l.phone && (
                <div className="flex gap-1.5 mt-2">
                  {/* Call / WhatsApp from the central Action Design System (was a
                      divergent blue Call + inline WA SVG). Hrefs unchanged. */}
                  <ActionIconButton action="call" variant="solid" href={tel} title={`Call ${l.name}`} />
                  <ActionIconButton action="whatsapp" variant="solid" href={wa} title={`WhatsApp ${l.name}`} external />
                </div>
              )}

              {canSee(l) && (
                <div className="mt-2">
                  {isOriginCold
                    ? <OriginColdPromoteButton leadId={l.id} leadName={l.name} />
                    : <ColdDataPromoteButton   leadId={l.id} leadName={l.name} />
                  }
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── DESKTOP: table (≥1024px) ─────────────────────────────────────── */}
      <div className="hidden lg:block card overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[#e5e7eb] dark:border-slate-700 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 bg-gray-50/80 dark:bg-slate-800/50">
              {isAdminOrMgr && (
                <th className="w-8 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked; }}
                    onChange={toggleAll}
                  />
                </th>
              )}
              <th className="px-3 py-2.5"><button onClick={sortBtn("name")} className="hover:text-[#0b1a33] dark:hover:text-blue-300">Lead{sortArrow("name")}</button></th>
              <th className="px-3 py-2.5 w-32"><button onClick={sortBtn("status")} className="hover:text-[#0b1a33] dark:hover:text-blue-300">Status{sortArrow("status")}</button></th>
              <th className="px-3 py-2.5 w-36"><button onClick={sortBtn("owner")} className="hover:text-[#0b1a33] dark:hover:text-blue-300">Owner{sortArrow("owner")}</button></th>
              <th className="px-3 py-2.5 w-36"><button onClick={sortBtn("touched")} className="hover:text-[#0b1a33] dark:hover:text-blue-300">Last Touch{sortArrow("touched")}</button></th>
              {showSource && <th className="px-3 py-2.5 w-28"><button onClick={sortBtn("source")} className="hover:text-[#0b1a33] dark:hover:text-blue-300">Source{sortArrow("source")}</button></th>}
              {showSource && <th className="px-3 py-2.5 w-24">Medium</th>}
              <th className="px-3 py-2.5 w-56">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f1f3f5] dark:divide-slate-800">
            {sortedLeads.map((l) => {
              const wa  = l.phone ? (whatsappLink(l.phone, `Hi ${l.name.split(" ")[0]}, this is from White Collar Realty. Just checking in — any update on your property search?`) ?? "") : "";
              const tel = l.phone ? (telLink(l.phone) ?? "") : "";
              const isSelected = selectedIds.has(l.id);
              const isOriginCold = l.leadOrigin === "COLD" || l.leadOrigin === "REVIVAL";
              const stale = isStale(l);
              const med = mediumLabel(l);

              return (
                <tr
                  key={l.id}
                  className={`transition-colors hover:bg-amber-50/40 dark:hover:bg-slate-800/40 ${isSelected ? "bg-red-50/40 dark:bg-red-950/20" : ""}`}
                >
                  {isAdminOrMgr && (
                    <td className="px-3 py-3 w-8 align-top">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(l.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                  )}

                  {/* Lead name + phone + chips */}
                  <td className="px-3 py-3 align-top">
                    <Link href={`/revival-engine/cold-data/${l.id}`} className="font-bold text-[#0b1a33] dark:text-white hover:underline text-sm">
                      {formatLeadName(l.name)}
                    </Link>
                    {l.phone && (
                      <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                        ···{l.phone.slice(-4)}
                      </div>
                    )}
                    {(l.company || l.city) && (
                      <div className="text-[11px] text-gray-500 truncate max-w-[180px]">
                        {[l.company, l.city].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {stale && <span className="chip chip-warm text-[9px]">{coldDays}d+ stale</span>}
                      {!l.ownerId && <span className="chip chip-hot text-[9px]">UNASSIGNED</span>}
                      {l.alreadyBought && <span className="chip src text-[9px]">🏠 owns</span>}
                    </div>
                    {l.coldCallReason && (
                      <div className="text-[11px] text-gray-600 italic mt-0.5 truncate max-w-[200px]">
                        &quot;{l.coldCallReason}&quot;
                      </div>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-3 py-3 align-top">
                    <span className={`chip ${l.statusChip} text-[10px]`}>{l.currentStatus ?? l.status}</span>
                  </td>

                  {/* Owner */}
                  <td className="px-3 py-3 align-top">
                    {l.owner ? (
                      <span className="text-xs text-gray-700 dark:text-slate-300">{l.owner.name}</span>
                    ) : (
                      <span className="text-[11px] text-amber-600 font-medium">Unassigned</span>
                    )}
                  </td>

                  {/* Last touch */}
                  <td className="px-3 py-3 align-top text-[11px] text-gray-500">
                    {l.lastTouchedAt
                      ? formatDistanceToNow(new Date(l.lastTouchedAt), { addSuffix: true })
                      : "—"}
                  </td>

                  {/* Source */}
                  {showSource && (
                    <td className="px-3 py-3 align-top text-[11px] text-gray-600 dark:text-slate-400">
                      {l.sourceRaw || <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </td>
                  )}

                  {/* Medium */}
                  {showSource && (
                    <td className="px-3 py-3 align-top text-[11px] text-gray-600 dark:text-slate-400">
                      {med || <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </td>
                  )}

                  {/* Actions */}
                  <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5 flex-nowrap">
                      {l.phone && (
                        <ActionIconButton action="call" variant="solid" href={tel} title={`Call ${l.name}`} />
                      )}
                      {l.phone && (
                        <ActionIconButton action="whatsapp" variant="solid" href={wa} title={`WhatsApp ${l.name}`} external />
                      )}
                      {canSee(l) && (
                        <div className="flex-none">
                          {isOriginCold
                            ? <OriginColdPromoteButton leadId={l.id} leadName={l.name} compact />
                            : <ColdDataPromoteButton   leadId={l.id} leadName={l.name} compact />
                          }
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Bulk reject confirm modal ─────────────────────────────────────── */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-sm p-5">
            <div className="text-base font-bold mb-1 dark:text-slate-100">
              Reject {selectedIds.size} lead{selectedIds.size !== 1 ? "s" : ""}?
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-4">
              They will be marked as LOST and removed from the Revival Engine.
            </div>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Reason</label>
            <select
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              className="w-full mt-1 mb-4 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100"
            >
              {REJECT_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setBulkModalOpen(false)}
                className="btn btn-ghost text-sm"
                disabled={bulkBusy}
              >
                Cancel
              </button>
              <button
                onClick={doBulkReject}
                disabled={bulkBusy}
                className="btn text-sm font-semibold bg-red-600 hover:bg-red-700 text-white border-red-700 disabled:opacity-60"
              >
                {bulkBusy ? "Rejecting…" : `Reject ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
