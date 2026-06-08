"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { ACTIVE_STATUS_DEFS, statusColor, statusLabel } from "@/lib/hrStatus";

function fmtDate(s: string) { return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" }); }
function fmtAct(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

interface Candidate {
  id: string; name: string; phone: string | null; whatsappPhone: string | null; email: string | null;
  experience: string | null; currentCompany: string | null; currentProfile: string | null;
  currentSalary: number | null; expectedSalary: number | null; noticePeriod: string | null;
  status: string; nextAction: string | null; nextActionDate: string | null; remarks: string | null;
  primaryOwner: { name: string } | null;
  followUps: { dueAt: string; type: string }[];
  interviews: { scheduledAt: string; type: string; confirmationStatus: string }[];
  activities: { type: string; createdAt: string }[];
}

interface Props {
  candidates: Candidate[];
  agents: { id: string; name: string }[];
  countMap: Record<string, number>;
  meId: string; meRole: string;
}

export default function HRCandidateTable({ candidates, countMap }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const now = new Date();

  const filtered = useMemo(() => {
    let r = candidates;
    if (statusFilter) r = r.filter(c => c.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      r = r.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.currentCompany ?? "").toLowerCase().includes(q) ||
        (c.currentProfile ?? "").toLowerCase().includes(q),
      );
    }
    return r;
  }, [candidates, search, statusFilter]);

  return (
    <div className="space-y-3">
      {/* Search + filter */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍  Search name, phone, email, company…"
          className="flex-1 min-w-[200px] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2e4a]/20 dark:bg-slate-800 dark:border-slate-600"
        />
        <select
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-600"
        >
          <option value="">All statuses ({candidates.length})</option>
          {ACTIVE_STATUS_DEFS.map(s => (
            <option key={s.key} value={s.key}>{s.label} ({countMap[s.key] ?? 0})</option>
          ))}
        </select>
      </div>

      <div className="text-xs text-gray-500">{filtered.length} candidates</div>

      {/* Desktop table — 8 columns, fixed layout (no horizontal scroll) */}
      <div className="hidden sm:block rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              <th className="px-3 py-2.5 w-[19%]">Name</th>
              <th className="px-3 py-2.5 w-[12%]">Phone</th>
              <th className="px-3 py-2.5 w-[13%]">Current Role</th>
              <th className="px-3 py-2.5 w-[13%]">Status</th>
              <th className="px-3 py-2.5 w-[16%]">Next Action</th>
              <th className="px-3 py-2.5 w-[9%]">Follow-Up</th>
              <th className="px-3 py-2.5 w-[9%]">Owner</th>
              <th className="px-3 py-2.5 w-[9%]">Last Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-xs">No candidates found.</td></tr>
            )}
            {filtered.map(c => {
              const fu = c.followUps[0];
              const fuDateStr = fu?.dueAt ?? c.nextActionDate ?? null;
              const fuOverdue = fuDateStr ? new Date(fuDateStr) < now : false;
              const lastAct = c.activities[0];
              return (
                <tr key={c.id} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/50 transition align-top">
                  <td className="px-3 py-2.5">
                    <Link href={`/hr/candidates/${c.id}`} className="font-semibold text-[#1a2e4a] dark:text-blue-400 hover:underline block truncate">{c.name}</Link>
                    {c.currentCompany && <div className="text-[11px] text-gray-400 truncate">{c.currentCompany}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 truncate">
                    {c.phone ? <a href={`tel:${c.phone}`} className="hover:text-blue-600">{c.phone}</a> : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 truncate">{c.currentProfile ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor(c.status)}`}>{statusLabel(c.status)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">
                    <div className="truncate">{c.nextAction ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {fuDateStr ? <span className={fuOverdue ? "text-red-600 font-semibold" : "text-amber-600"}>{fuOverdue ? "⚠ " : ""}{fmtDate(fuDateStr)}</span> : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 truncate">{c.primaryOwner?.name?.split(" ")[0] ?? "—"}</td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-500">
                    {lastAct ? <><div className="text-gray-700 dark:text-slate-300 truncate">{fmtAct(lastAct.type)}</div><div>{fmtDate(lastAct.createdAt)}</div></> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-2">
        {filtered.map(c => {
          const fu = c.followUps[0];
          const fuOverdue = fu ? new Date(fu.dueAt) < now : false;
          return (
            <Link key={c.id} href={`/hr/candidates/${c.id}`}
              className="block bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-3 hover:shadow-md transition">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-sm text-gray-900 dark:text-white">{c.name}</div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${statusColor(c.status)}`}>{statusLabel(c.status)}</span>
              </div>
              {c.currentProfile && <div className="text-[11px] text-gray-500 mt-0.5">{c.currentProfile}</div>}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-gray-500">
                {c.phone && <span>📞 {c.phone}</span>}
                {c.nextAction && <span className="truncate max-w-[150px]">⏭ {c.nextAction}</span>}
                {fu && <span className={fuOverdue ? "text-red-600 font-semibold" : "text-amber-600"}>{fuOverdue ? "⚠ Overdue" : `📅 ${fmtDate(fu.dueAt)}`}</span>}
                {c.primaryOwner?.name && <span>👤 {c.primaryOwner.name.split(" ")[0]}</span>}
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && <div className="text-center text-gray-400 text-sm py-8">No candidates found.</div>}
      </div>
    </div>
  );
}
