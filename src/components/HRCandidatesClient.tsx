"use client";
import { useState, useMemo } from "react";
import Link from "next/link";

interface Candidate {
  id: string; name: string; phone: string | null; email: string | null;
  location: string | null; currentProfile: string | null; currentCompany: string | null;
  expectedSalary: number | null; experience: string | null; noticePeriod: string | null;
  status: string; nextAction: string | null; nextActionDate: string | null;
  primaryOwner: { name: string; avatarColor: string } | null;
  followUps: { dueAt: string; type: string }[];
  interviews: { scheduledAt: string; type: string }[];
  _count: { activities: number };
}

interface Props {
  candidates: Candidate[];
  agents: { id: string; name: string; avatarColor: string | null }[];
  meId: string;
  meRole: string;
  activeStatuses: string[];
  closedStatuses: string[];
  countMap: Record<string, number>;
}

const STATUS_COLOR: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-800",
  NOT_CALLED: "bg-gray-100 text-gray-700",
  PIPELINE: "bg-emerald-100 text-emerald-800",
  VIRTUAL_INTERVIEW_SCHEDULED: "bg-indigo-100 text-indigo-800",
  HR_INTERVIEW_COMPLETED: "bg-cyan-100 text-cyan-800",
  FINAL_INTERVIEW_SCHEDULED: "bg-purple-100 text-purple-800",
  FINAL_INTERVIEW_COMPLETED: "bg-violet-100 text-violet-800",
  SHORTLISTED: "bg-teal-100 text-teal-800",
  OFFER_RELEASED: "bg-amber-100 text-amber-800",
  JOINED: "bg-green-100 text-green-800",
  HOLD: "bg-orange-100 text-orange-800",
  NOT_INTERESTED: "bg-red-100 text-red-700",
  NOT_SUITABLE: "bg-red-100 text-red-700",
  HIGH_SALARY: "bg-pink-100 text-pink-700",
  OTHER_PROFILE: "bg-slate-100 text-slate-600",
  REJECTED: "bg-red-200 text-red-800",
  OFFER_DECLINED: "bg-orange-200 text-orange-800",
  WRONG_NUMBER: "bg-gray-100 text-gray-500",
  SWITCH_OFF: "bg-gray-100 text-gray-500",
  NEVER_RESPONSE: "bg-gray-100 text-gray-500",
  NOT_RESPONDING: "bg-gray-100 text-gray-500",
};

function fmtStatus(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function fmtSalary(n: number | null) {
  if (!n) return "—";
  if (n >= 100000) return `₹${(n/100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n/1000).toFixed(0)}K`;
  return `₹${n}`;
}

export default function HRCandidatesClient({ candidates, countMap, activeStatuses }: Props) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const filtered = useMemo(() => {
    let r = candidates;
    if (filterStatus) r = r.filter(c => c.status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      r = r.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.currentProfile ?? "").toLowerCase().includes(q) ||
        (c.currentCompany ?? "").toLowerCase().includes(q)
      );
    }
    return r;
  }, [candidates, search, filterStatus]);

  const now = new Date();

  return (
    <div className="space-y-3">
      {/* Search + filter bar */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, profile…"
          className="flex-1 min-w-0 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-600"
        />
        <select
          value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-600"
        >
          <option value="">All statuses</option>
          {activeStatuses.map(s => (
            <option key={s} value={s}>{fmtStatus(s)} ({countMap[s] ?? 0})</option>
          ))}
        </select>
      </div>

      <div className="text-xs text-gray-500">{filtered.length} candidates</div>

      {/* Table — desktop */}
      <div className="hidden sm:block overflow-x-auto rounded-lg border border-[#e5e7eb] dark:border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Phone</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Next Action</th>
              <th className="px-3 py-2.5">Follow-Up</th>
              <th className="px-3 py-2.5">Owner</th>
              <th className="px-3 py-2.5">Expected ₹</th>
              <th className="px-3 py-2.5">Experience</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0] dark:divide-slate-700">
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400 text-xs">No candidates found.</td></tr>
            )}
            {filtered.map(c => {
              const fu = c.followUps[0];
              const fuDate = fu ? new Date(fu.dueAt) : null;
              const fuOverdue = fuDate && fuDate < now;
              const iv = c.interviews[0];
              return (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer"
                  onClick={() => window.location.href = `/hr/candidates/${c.id}`}>
                  <td className="px-3 py-2.5 font-medium text-gray-900 dark:text-slate-100">
                    <div>{c.name}</div>
                    {c.currentProfile && <div className="text-[11px] text-gray-500">{c.currentProfile}{c.currentCompany ? ` · ${c.currentCompany}` : ""}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{c.phone ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {fmtStatus(c.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 max-w-[140px] truncate">{c.nextAction ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {iv ? (
                      <span className="text-blue-700">🎯 {new Date(iv.scheduledAt).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</span>
                    ) : fuDate ? (
                      <span className={fuOverdue ? "text-red-600 font-semibold" : "text-amber-600"}>
                        {fuOverdue ? "⚠ " : "📅 "}{fuDate.toLocaleDateString("en-IN",{day:"numeric",month:"short"})}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{c.primaryOwner?.name?.split(" ")[0] ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{fmtSalary(c.expectedSalary)}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{c.experience ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cards — mobile */}
      <div className="sm:hidden space-y-2">
        {filtered.map(c => {
          const fu = c.followUps[0];
          const fuDate = fu ? new Date(fu.dueAt) : null;
          const fuOverdue = fuDate && fuDate < now;
          return (
            <Link key={c.id} href={`/hr/candidates/${c.id}`}
              className="block card p-3 border border-[#e5e7eb] dark:border-slate-700 hover:shadow-md transition">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-sm text-gray-900 dark:text-slate-100">{c.name}</div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOR[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                  {fmtStatus(c.status)}
                </span>
              </div>
              {c.currentProfile && <div className="text-[11px] text-gray-500 mt-0.5">{c.currentProfile}{c.currentCompany ? ` · ${c.currentCompany}` : ""}</div>}
              <div className="flex gap-3 mt-1.5 text-[11px] text-gray-500 flex-wrap">
                {c.phone && <span>📞 {c.phone}</span>}
                {fuDate && <span className={fuOverdue ? "text-red-600 font-semibold" : "text-amber-600"}>
                  {fuOverdue ? "⚠ Overdue" : `📅 ${fuDate.toLocaleDateString("en-IN",{day:"numeric",month:"short"})}`}
                </span>}
                {c.primaryOwner && <span>{c.primaryOwner.name.split(" ")[0]}</span>}
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && <div className="text-center text-gray-400 text-sm py-8">No candidates found.</div>}
      </div>
    </div>
  );
}
