"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatLeadName } from "@/lib/leadName";
import { Calendar, Pencil, Trash2 } from "lucide-react";
import { telLink, whatsappLink } from "@/lib/phone";
import { ActionIconButton } from "@/components/actions/ActionIconButton";
// Per-contact Call / WhatsApp / Email render from the central Action Design
// System (was a divergent blue Call, sky Email + inline WA SVG). The brand
// WhatsApp glyph now lives in components/actions/WhatsAppGlyph.tsx.

// IST follow-up formatters — an IST-midnight follow-up instant must render on its
// IST calendar day (date-fns formats in the runtime TZ → off-by-a-day on the
// UTC deploy). en-IN → "25 Jun" label; en-CA → "2026-06-25" for the date input.
const fuLabelIST = (d: Date) => new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });
const fuInputIST = (d: Date) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

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
                  {formatLeadName(lead.name)}
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
                Follow-up: {lead.followupDate ? fuLabelIST(lead.followupDate) : <span className="italic">None set</span>}
              </span>
              {lead.ownerName && <span className="text-gray-500 dark:text-slate-400 ml-auto">{lead.ownerName}</span>}
            </div>
            {/* Action buttons — mobile (central Action Design System) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {lead.phone && (
                <ActionIconButton action="call" variant="solid" href={telLink(lead.phone) || "#"} title={`Call ${lead.name}`} />
              )}
              {lead.phone && (
                <ActionIconButton action="whatsapp" variant="solid" href={whatsappLink(lead.phone) || "#"} title={`WhatsApp ${lead.name}`} external />
              )}
              <div className="relative">
                <ActionIconButton action="followUp" variant="solid" title="Set follow-up"
                  onClick={() => setPickerOpenFor(pickerOpenFor === lead.id ? null : lead.id)} />
                {pickerOpenFor === lead.id && (
                  <input type="date" autoFocus
                    className="absolute top-9 left-0 z-20 text-xs border rounded px-2 py-1 shadow-lg bg-white dark:bg-slate-800 dark:border-slate-600"
                    defaultValue={lead.followupDate ? fuInputIST(lead.followupDate) : ""}
                    onChange={(e) => quickSetFollowup(lead.id, e.target.value)}
                    onBlur={() => setPickerOpenFor(null)}
                  />
                )}
              </div>
              {lead.email && (
                <ActionIconButton action="email" variant="solid" href={`mailto:${lead.email}`} title={`Email ${lead.name}`} />
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
                    {formatLeadName(lead.name)}
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
                  {lead.followupDate ? new Date(lead.followupDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : (
                    <span className="text-gray-400 dark:text-slate-500 italic">None set</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-slate-300 text-xs">
                  {lead.ownerName ?? <span className="text-gray-400 dark:text-slate-500 italic">Unassigned</span>}
                  {lead.forwardedTeam && <span className="text-gray-400 dark:text-slate-500 ml-1">· {lead.forwardedTeam}</span>}
                </td>
                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 flex-wrap [&>a]:flex-none">
                    {lead.phone && (
                      <ActionIconButton action="call" variant="solid" href={telLink(lead.phone) || "#"} title={`Call ${lead.name}`} />
                    )}
                    {lead.phone && (
                      <ActionIconButton action="whatsapp" variant="solid" href={whatsappLink(lead.phone) || "#"} title={`WhatsApp ${lead.name}`} external />
                    )}
                    <div className="relative flex-none">
                      <ActionIconButton action="followUp" variant="solid" title="Set follow-up date"
                        onClick={() => setPickerOpenFor(pickerOpenFor === lead.id ? null : lead.id)} />
                      {pickerOpenFor === lead.id && (
                        <input type="date" autoFocus
                          className="absolute top-9 left-0 z-20 text-xs border rounded px-2 py-1 shadow-lg bg-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                          defaultValue={lead.followupDate ? fuInputIST(lead.followupDate) : ""}
                          onChange={(e) => quickSetFollowup(lead.id, e.target.value)}
                          onBlur={() => setPickerOpenFor(null)}
                        />
                      )}
                    </div>
                    {lead.email && (
                      <ActionIconButton action="email" variant="solid" href={`mailto:${lead.email}`} title={`Email ${lead.name}`} />
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
