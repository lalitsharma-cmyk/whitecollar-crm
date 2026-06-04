"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, Calendar, Mail, Pencil, Trash2 } from "lucide-react";
import { format as fnsFormat } from "date-fns";
import { telLink, whatsappLink } from "@/lib/phone";

function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

export interface InboxRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  statusChip: string;
  statusLabel: string;
  potential: string | null;
  potentialEmoji: string;
  daysCold: number | null;
  followupDate: Date | null;
  ownerName: string | null;
  forwardedTeam: string | null;
}

interface Props {
  rows: InboxRow[];
  canDelete: boolean;
}

const REJECT_REASONS = [
  { value: "NOT_INTERESTED",           label: "Not Interested" },
  { value: "LOW_BUDGET",               label: "Low Budget" },
  { value: "FUND_ISSUE",               label: "Fund Issue" },
  { value: "NEVER_RESPONDED",          label: "Never Responded" },
  { value: "JUST_SEARCHING",           label: "Just Searching" },
  { value: "DROP_THE_PLAN",            label: "Drop The Plan" },
  { value: "WAR_FEAR",                 label: "War / Market Fear" },
  { value: "WAITING_FOR_PROPERTY_SALE",label: "Waiting to Sell Own Property" },
  { value: "INVALID_NUMBER",           label: "Invalid Number" },
  { value: "OTHER",                    label: "Other" },
];

export default function InboxClient({ rows, canDelete }: Props) {
  const router = useRouter();

  // ── Single-lead actions
  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteReason, setDeleteReason] = useState("NOT_INTERESTED");
  const [deleteBusy, setDeleteBusy] = useState(false);

  // ── Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState("NOT_INTERESTED");
  const [bulkBusy, setBulkBusy] = useState(false);

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

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === rows.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map((r) => r.id)));
  }

  async function doBulkReject() {
    if (bulkBusy || selectedIds.size === 0) return;
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

  function coldClass(daysCold: number | null) {
    if (daysCold === null || daysCold > 7) return "font-semibold text-red-600 dark:text-red-400";
    return "font-semibold text-amber-600 dark:text-amber-400";
  }

  function coldLabel(daysCold: number | null) {
    if (daysCold === null) return "Never touched";
    return `${daysCold}d cold`;
  }

  const allSelected = rows.length > 0 && selectedIds.size === rows.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < rows.length;

  return (
    <>
      {/* ── Bulk action bar (floats at top when rows are selected) ── */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-30 flex justify-center">
          <div className="bg-[#0b1a33] text-white rounded-xl px-4 py-2.5 flex items-center gap-3 shadow-xl">
            <span className="text-sm font-semibold">{selectedIds.size} selected</span>
            {canDelete && (
              <button
                type="button"
                onClick={() => { setBulkReason("NOT_INTERESTED"); setBulkModalOpen(true); }}
                className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Reject {selectedIds.size}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile cards ── */}
      <div className="md:hidden space-y-3">
        {rows.map((lead) => (
          <div key={lead.id} className={`bg-white dark:bg-slate-800 rounded-xl border transition-colors shadow-sm p-4 ${selectedIds.has(lead.id) ? "border-blue-400 dark:border-blue-500" : "border-[#e5e7eb] dark:border-slate-700"}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selectedIds.has(lead.id)}
                onChange={() => toggleSelect(lead.id)}
                className="mt-1 flex-none accent-blue-600 w-4 h-4"
              />
              <div className="min-w-0 flex-1">
                <Link href={`/leads/${lead.id}`} className="font-semibold text-[#0b1a33] dark:text-slate-100 hover:underline truncate block">
                  {lead.name}
                </Link>
                {lead.phone && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{lead.phone}</p>}
              </div>
              <span className={`chip ${lead.statusChip} flex-none text-[11px] px-2 py-0.5 rounded-full font-semibold`}>
                {lead.statusLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs flex-wrap mb-3">
              {lead.potential && <span title={lead.potential}>{lead.potentialEmoji}</span>}
              <span className={coldClass(lead.daysCold)}>{coldLabel(lead.daysCold)}</span>
              <span className="text-gray-400 dark:text-slate-500">
                Follow-up: {lead.followupDate ? fnsFormat(lead.followupDate, "dd MMM") : <span className="italic">None set</span>}
              </span>
              {lead.ownerName && <span className="text-gray-500 dark:text-slate-400 ml-auto">{lead.ownerName}</span>}
            </div>
            {/* Action buttons — mobile */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {lead.phone && (
                <a href={telLink(lead.phone) || "#"} title={`Call ${lead.name}`}
                  className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors">
                  <Phone className="w-3.5 h-3.5" />
                </a>
              )}
              {lead.phone && (
                <a href={whatsappLink(lead.phone) || "#"} target="_blank" rel="noopener noreferrer"
                  title={`WhatsApp ${lead.name}`}
                  className="w-8 h-8 rounded-lg bg-[#25D366] hover:bg-[#1ea953] text-white flex items-center justify-center transition-colors">
                  <WaIcon />
                </a>
              )}
              <div className="relative">
                <button type="button" onClick={() => setPickerOpenFor(pickerOpenFor === lead.id ? null : lead.id)}
                  title="Set follow-up"
                  className="w-8 h-8 rounded-lg bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center transition-colors">
                  <Calendar className="w-3.5 h-3.5" />
                </button>
                {pickerOpenFor === lead.id && (
                  <input type="date" autoFocus
                    className="absolute top-9 left-0 z-20 text-xs border rounded px-2 py-1 shadow-lg bg-white dark:bg-slate-800 dark:border-slate-600"
                    defaultValue={lead.followupDate ? fnsFormat(lead.followupDate, "yyyy-MM-dd") : ""}
                    onChange={(e) => quickSetFollowup(lead.id, e.target.value)}
                    onBlur={() => setPickerOpenFor(null)}
                  />
                )}
              </div>
              {lead.email && (
                <a href={`mailto:${lead.email}`} title={`Email ${lead.name}`}
                  className="w-8 h-8 rounded-lg bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center transition-colors">
                  <Mail className="w-3.5 h-3.5" />
                </a>
              )}
              <a href={`/leads/${lead.id}`} title="Open lead"
                className="w-8 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </a>
              {canDelete && (
                <button type="button" title="Reject lead"
                  onClick={() => { setDeleteTarget({ id: lead.id, name: lead.name }); setDeleteReason("NOT_INTERESTED"); }}
                  className="w-8 h-8 rounded-lg bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-[#e5e7eb] dark:border-slate-700">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 dark:bg-slate-800 text-xs font-semibold text-gray-500 dark:text-slate-400">
            <tr>
              {/* Select-all checkbox */}
              <th className="px-3 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  className="accent-blue-600 w-4 h-4 cursor-pointer"
                  title="Select all"
                />
              </th>
              <th className="px-4 py-3 text-left">Lead</th>
              <th className="px-4 py-3 text-left w-28">Status</th>
              <th className="px-4 py-3 text-left w-16">Potential</th>
              <th className="px-4 py-3 text-left w-24">Days Cold</th>
              <th className="px-4 py-3 text-left w-24">Follow-up</th>
              <th className="px-4 py-3 text-left w-28">Assigned To</th>
              <th className="px-4 py-3 text-left w-56">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e5e7eb] dark:divide-slate-700 bg-white dark:bg-slate-900">
            {rows.map((lead) => (
              <tr key={lead.id}
                className={`transition-colors ${selectedIds.has(lead.id) ? "bg-blue-50/60 dark:bg-blue-900/20" : "hover:bg-amber-50/30 dark:hover:bg-slate-800/60"}`}>
                {/* Row checkbox */}
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(lead.id)}
                    onChange={() => toggleSelect(lead.id)}
                    className="accent-blue-600 w-4 h-4 cursor-pointer"
                  />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-[#0b1a33] dark:text-slate-100 hover:underline">
                    {lead.name}
                  </Link>
                  {lead.phone && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{lead.phone}</p>}
                </td>
                <td className="px-4 py-3">
                  <span className={`chip ${lead.statusChip} text-[11px] px-2 py-0.5 rounded-full font-semibold`}>
                    {lead.statusLabel}
                  </span>
                </td>
                <td className="px-4 py-3 text-base">
                  {lead.potential ? lead.potentialEmoji : <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={coldClass(lead.daysCold)}>{coldLabel(lead.daysCold)}</span>
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-slate-300 text-xs">
                  {lead.followupDate ? fnsFormat(lead.followupDate, "dd MMM yyyy") : (
                    <span className="text-gray-400 dark:text-slate-500 italic">None set</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-slate-300 text-xs">
                  {lead.ownerName ?? <span className="text-gray-400 dark:text-slate-500 italic">Unassigned</span>}
                  {lead.forwardedTeam && <span className="text-gray-400 dark:text-slate-500 ml-1">· {lead.forwardedTeam}</span>}
                </td>
                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {lead.phone && (
                      <a href={telLink(lead.phone) || "#"} title={`Call ${lead.name}`}
                        className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition-colors flex-none">
                        <Phone className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {lead.phone && (
                      <a href={whatsappLink(lead.phone) || "#"} target="_blank" rel="noopener noreferrer"
                        title={`WhatsApp ${lead.name}`}
                        className="w-8 h-8 rounded-lg bg-[#25D366] hover:bg-[#1ea953] text-white flex items-center justify-center transition-colors flex-none">
                        <WaIcon />
                      </a>
                    )}
                    <div className="relative flex-none">
                      <button type="button" title="Set follow-up date"
                        onClick={() => setPickerOpenFor(pickerOpenFor === lead.id ? null : lead.id)}
                        className="w-8 h-8 rounded-lg bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center transition-colors">
                        <Calendar className="w-3.5 h-3.5" />
                      </button>
                      {pickerOpenFor === lead.id && (
                        <input type="date" autoFocus
                          className="absolute top-9 left-0 z-20 text-xs border rounded px-2 py-1 shadow-lg bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                          defaultValue={lead.followupDate ? fnsFormat(lead.followupDate, "yyyy-MM-dd") : ""}
                          onChange={(e) => quickSetFollowup(lead.id, e.target.value)}
                          onBlur={() => setPickerOpenFor(null)}
                        />
                      )}
                    </div>
                    {lead.email && (
                      <a href={`mailto:${lead.email}`} title={`Email ${lead.name}`}
                        className="w-8 h-8 rounded-lg bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center transition-colors flex-none">
                        <Mail className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <a href={`/leads/${lead.id}`} title="Open lead"
                      className="w-8 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-colors flex-none">
                      <Pencil className="w-3.5 h-3.5" />
                    </a>
                    {canDelete && (
                      <button type="button" title="Reject lead"
                        onClick={() => { setDeleteTarget({ id: lead.id, name: lead.name }); setDeleteReason("NOT_INTERESTED"); }}
                        className="w-8 h-8 rounded-lg bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors flex-none">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Single-lead delete confirm modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !deleteBusy && setDeleteTarget(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-sm w-full p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <Trash2 className="w-4 h-4 text-red-500 flex-none" />
              <span className="font-semibold text-base">Reject &ldquo;{deleteTarget.name}&rdquo;?</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
              Lead will be marked Lost and removed from the active queue.
            </p>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Reason</label>
            <select value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)}
              className="w-full mt-1 mb-4 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100">
              {REJECT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="btn btn-ghost text-sm">Cancel</button>
              <button onClick={quickReject} disabled={deleteBusy}
                className="btn bg-red-600 hover:bg-red-700 text-white text-sm">
                {deleteBusy ? "Rejecting…" : "Reject Lead"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk reject confirm modal ── */}
      {bulkModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !bulkBusy && setBulkModalOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-sm w-full p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <Trash2 className="w-4 h-4 text-red-500 flex-none" />
              <span className="font-semibold text-base">Reject {selectedIds.size} leads?</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
              All {selectedIds.size} selected leads will be marked Lost and removed from the active queue.
            </p>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Reason</label>
            <select value={bulkReason} onChange={(e) => setBulkReason(e.target.value)}
              className="w-full mt-1 mb-4 border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 dark:text-slate-100">
              {REJECT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => setBulkModalOpen(false)} className="btn btn-ghost text-sm">Cancel</button>
              <button onClick={doBulkReject} disabled={bulkBusy}
                className="btn bg-red-600 hover:bg-red-700 text-white text-sm">
                {bulkBusy ? "Rejecting…" : `Reject ${selectedIds.size} Leads`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
