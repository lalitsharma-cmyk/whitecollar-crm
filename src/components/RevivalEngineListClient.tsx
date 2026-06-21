"use client";

/**
 * RevivalEngineListClient — leads grid/table for /cold-calls.
 *
 * Layout mirrors the main Leads list:
 *   • Mobile (<1024px): cards
 *   • Desktop (≥1024px): table with Lead / Status / Owner / Actions columns
 *
 * Filtering is status-based (NEW, CONTACTED, etc.) — replaces the old
 * "sub-bucket" concept (cold import / BANT / stale).  The unassigned
 * admin-only tab is preserved as a workflow tool.
 *
 * Admin/manager bulk-reject is preserved (checkbox → floating bar → modal).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import ColdDataPromoteButton from "./ColdDataPromoteButton";
import OriginColdPromoteButton from "./OriginColdPromoteButton";
import { whatsappLink, telLink } from "@/lib/phone";
import { REVIVAL_STATUSES } from "@/lib/revival-constants";
import { formatLeadName } from "@/lib/leadName";

export { REVIVAL_STATUSES };

const REJECT_REASONS = [
  { value: "NOT_INTERESTED",            label: "Not Interested" },
  { value: "LOW_BUDGET",                label: "Low Budget" },
  { value: "FUND_ISSUE",                label: "Fund Issue" },
  { value: "NEVER_RESPONDED",           label: "Never Responded" },
  { value: "JUST_SEARCHING",            label: "Just Searching" },
  { value: "DROP_THE_PLAN",             label: "Drop The Plan" },
  { value: "WAR_FEAR",                  label: "War / Market Fear" },
  { value: "WAITING_FOR_PROPERTY_SALE", label: "Waiting to Sell Own Property" },
  { value: "INVALID_NUMBER",            label: "Invalid Number" },
  { value: "OTHER",                     label: "Other" },
];

export interface RevivalLead {
  id: string;
  name: string;
  phone: string | null;
  company: string | null;
  city: string | null;
  isColdCall: boolean;
  leadOrigin: string | null;
  status: string;
  statusChip: string;
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
  /** ms timestamp so Date is not passed across server→client boundary */
  cutoffMs: number;
  coldDays: number;
}

// ── Inline icons ─────────────────────────────────────────────────────────────
function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.17 6.5a19.79 19.79 0 01-3.07-8.67A2 2 0 011.72 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L5.93 7.47a16 16 0 006.29 6.29l1.54-1.54a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
    </svg>
  );
}
function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

export default function RevivalEngineListClient({ leads, myId, isAdminOrMgr, cutoffMs, coldDays }: Props) {
  const router = useRouter();
  const cutoff = new Date(cutoffMs);

  // ── Bulk select state ──────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState("NOT_INTERESTED");
  const [bulkBusy, setBulkBusy] = useState(false);

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
      setSelectedIds(new Set());
      setBulkModalOpen(false);
      router.refresh();
    } finally {
      setBulkBusy(false);
    }
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (leads.length === 0) {
    return (
      <div className="card p-8 text-center text-gray-500 text-sm">
        Nothing in this bucket. Either you&apos;re on top of follow-ups (✅) or no leads in this stage.
      </div>
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function isStale(l: RevivalLead) {
    return l.lastTouchedAt && new Date(l.lastTouchedAt) < cutoff;
  }

  const canSee = (l: RevivalLead) => l.ownerId === myId || isAdminOrMgr;

  return (
    <>
      {/* ── Select-all toolbar (admin/mgr only) ─────────────────────────── */}
      {isAdminOrMgr && (
        <div className="flex items-center gap-3 px-1 mb-1">
          <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-gray-600">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              ref={(el) => { if (el) el.indeterminate = someChecked; }}
              className="w-4 h-4 cursor-pointer"
            />
            {selectedIds.size === 0
              ? `Select all (${leads.length})`
              : `${selectedIds.size} selected`}
          </label>
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => setBulkModalOpen(true)}
              className="text-xs font-semibold px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
            >
              🗑 Reject {selectedIds.size}
            </button>
          )}
        </div>
      )}

      {/* ── MOBILE: card list (<1024px) ───────────────────────────────────── */}
      <div className="lg:hidden space-y-2">
        {leads.map((l) => {
          const wa  = l.phone ? (whatsappLink(l.phone, `Hi ${l.name.split(" ")[0]}, this is from White Collar Realty. Just checking in — any update on your property search?`) ?? "") : "";
          const tel = l.phone ? (telLink(l.phone) ?? "") : "";
          const isSelected = selectedIds.has(l.id);
          const isOriginCold = l.leadOrigin === "COLD" || l.leadOrigin === "REVIVAL";
          const stale = isStale(l);
          const statusMeta = REVIVAL_STATUSES.find(s => s.v === l.status);

          return (
            <div
              key={l.id}
              className={`card p-3 relative transition-colors ${isSelected ? "ring-2 ring-red-400 bg-red-50/30" : ""}`}
            >
              {/* Checkbox — admin/mgr only */}
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

              {/* Status + stale chips */}
              <div className="flex flex-wrap gap-1 mt-2">
                {statusMeta && (
                  <span className={`chip ${statusMeta.chip} text-[10px]`}>{statusMeta.label}</span>
                )}
                {stale && (
                  <span className="chip chip-warm text-[9px]">{coldDays}d+ stale</span>
                )}
                {!l.ownerId && (
                  <span className="chip chip-hot text-[9px]">UNASSIGNED</span>
                )}
                {l.alreadyBought && (
                  <span className="chip src text-[9px]" title={l.alreadyBought}>🏠 owns</span>
                )}
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

              {/* Action buttons */}
              {l.phone && (
                <div className="flex gap-1.5 mt-2">
                  <a href={tel} title={`Call ${l.name}`}
                    className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors flex-none">
                    <PhoneIcon />
                  </a>
                  <a href={wa} target="_blank" rel="noopener noreferrer" title={`WhatsApp ${l.name}`}
                    className="w-8 h-8 rounded-lg bg-[#25D366] hover:bg-[#1ea953] text-white flex items-center justify-center transition-colors flex-none">
                    <WaIcon />
                  </a>
                </div>
              )}

              {/* Promote to Lead */}
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
              <th className="px-3 py-2.5">Lead</th>
              <th className="px-3 py-2.5 w-32">Status</th>
              <th className="px-3 py-2.5 w-36">Owner</th>
              <th className="px-3 py-2.5 w-36">Last Touch</th>
              <th className="px-3 py-2.5 w-56">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f1f3f5] dark:divide-slate-800">
            {leads.map((l) => {
              const wa  = l.phone ? (whatsappLink(l.phone, `Hi ${l.name.split(" ")[0]}, this is from White Collar Realty. Just checking in — any update on your property search?`) ?? "") : "";
              const tel = l.phone ? (telLink(l.phone) ?? "") : "";
              const isSelected = selectedIds.has(l.id);
              const isOriginCold = l.leadOrigin === "COLD" || l.leadOrigin === "REVIVAL";
              const stale = isStale(l);
              const statusMeta = REVIVAL_STATUSES.find(s => s.v === l.status);

              return (
                <tr
                  key={l.id}
                  className={`transition-colors hover:bg-amber-50/40 dark:hover:bg-slate-800/40 ${isSelected ? "bg-red-50/40 dark:bg-red-950/20" : ""}`}
                >
                  {/* Checkbox */}
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
                    {statusMeta ? (
                      <span className={`chip ${statusMeta.chip} text-[10px]`}>{statusMeta.label}</span>
                    ) : (
                      <span className="chip chip-new text-[10px]">{l.status}</span>
                    )}
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

                  {/* Actions */}
                  <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5 flex-nowrap">
                      {l.phone && (
                        <a href={tel} title={`Call ${l.name}`}
                          className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors flex-none">
                          <PhoneIcon />
                        </a>
                      )}
                      {l.phone && (
                        <a href={wa} target="_blank" rel="noopener noreferrer" title={`WhatsApp ${l.name}`}
                          className="w-8 h-8 rounded-lg bg-[#25D366] hover:bg-[#1ea953] text-white flex items-center justify-center transition-colors flex-none">
                          <WaIcon />
                        </a>
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

      {/* ── Floating bulk action bar ─────────────────────────────────────── */}
      {isAdminOrMgr && selectedIds.size > 0 && (
        <div className="sticky top-2 z-30 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 bg-[#0b1a33] text-white px-5 py-2.5 rounded-xl shadow-2xl">
            <span className="text-sm font-semibold">{selectedIds.size} selected</span>
            <button
              type="button"
              onClick={() => setBulkModalOpen(true)}
              className="text-sm font-semibold px-4 py-1.5 rounded-lg bg-red-500 hover:bg-red-400 transition-colors"
            >
              🗑 Reject
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              ✕ Clear
            </button>
          </div>
        </div>
      )}

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
