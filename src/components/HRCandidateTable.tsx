"use client";
import { useState, useMemo } from "react";
import Link from "next/link";

const ACTIVE_STATUSES = ["NEW","NOT_CALLED","PIPELINE","VIRTUAL_INTERVIEW_SCHEDULED","HR_INTERVIEW_COMPLETED","FINAL_INTERVIEW_SCHEDULED","FINAL_INTERVIEW_COMPLETED","SHORTLISTED","OFFER_RELEASED","JOINED","HOLD"];

const STATUS_COLOR: Record<string,string> = {
  NEW:"bg-blue-100 text-blue-800",NOT_CALLED:"bg-slate-100 text-slate-700",
  PIPELINE:"bg-emerald-100 text-emerald-800",VIRTUAL_INTERVIEW_SCHEDULED:"bg-indigo-100 text-indigo-800",
  HR_INTERVIEW_COMPLETED:"bg-cyan-100 text-cyan-800",FINAL_INTERVIEW_SCHEDULED:"bg-purple-100 text-purple-800",
  FINAL_INTERVIEW_COMPLETED:"bg-violet-100 text-violet-800",SHORTLISTED:"bg-teal-100 text-teal-800",
  OFFER_RELEASED:"bg-amber-100 text-amber-800",JOINED:"bg-green-100 text-green-800",
  HOLD:"bg-orange-100 text-orange-800",NOT_INTERESTED:"bg-red-100 text-red-700",
  NOT_SUITABLE:"bg-red-100 text-red-700",HIGH_SALARY:"bg-pink-100 text-pink-700",
  OTHER_PROFILE:"bg-slate-100 text-slate-600",REJECTED:"bg-red-200 text-red-800",
  OFFER_DECLINED:"bg-orange-200 text-orange-800",WRONG_NUMBER:"bg-gray-100 text-gray-500",
  SWITCH_OFF:"bg-gray-100 text-gray-500",NEVER_RESPONSE:"bg-gray-100 text-gray-500",NOT_RESPONDING:"bg-gray-100 text-gray-500",
};

function fmt(s:string){return s.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());}
function fmtSal(n:number|null){if(!n)return"—";return n>=100000?`₹${(n/100000).toFixed(1)}L`:`₹${(n/1000).toFixed(0)}K`;}
function fmtDate(s:string){return new Date(s).toLocaleDateString("en-IN",{day:"numeric",month:"short"});}
function fmtDateTime(s:string){const d=new Date(s);return d.toLocaleDateString("en-IN",{day:"numeric",month:"short"})+" "+d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"});}

interface Candidate {
  id:string;name:string;phone:string|null;whatsappPhone:string|null;email:string|null;
  experience:string|null;currentCompany:string|null;currentProfile:string|null;
  currentSalary:number|null;expectedSalary:number|null;noticePeriod:string|null;
  status:string;nextAction:string|null;nextActionDate:string|null;remarks:string|null;
  primaryOwner:{name:string}|null;
  followUps:{dueAt:string;type:string}[];
  interviews:{scheduledAt:string;type:string;confirmationStatus:string}[];
  activities:{type:string;createdAt:string}[];
}

interface Props {
  candidates:Candidate[];
  agents:{id:string;name:string}[];
  countMap:Record<string,number>;
  meId:string;meRole:string;
}

export default function HRCandidateTable({candidates, countMap}: Props) {
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
        (c.phone??'').includes(q) ||
        (c.email??'').toLowerCase().includes(q) ||
        (c.currentCompany??'').toLowerCase().includes(q) ||
        (c.currentProfile??'').toLowerCase().includes(q)
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
          {ACTIVE_STATUSES.map(s => (
            <option key={s} value={s}>{fmt(s)} ({countMap[s] ?? 0})</option>
          ))}
        </select>
      </div>

      <div className="text-xs text-gray-500">{filtered.length} candidates</div>

      {/* Desktop table — scrollable */}
      <div className="hidden sm:block overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="min-w-[1200px] w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              {["Candidate","Phone","WhatsApp","Experience","Company / Profile","Salary","Notice","Status","Next Action","Follow-Up","Interview","Confirmation","Owner","Last Activity","Remarks","Actions"].map(h=>(
                <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {filtered.length === 0 && (
              <tr><td colSpan={16} className="px-4 py-10 text-center text-gray-400 text-xs">No candidates found.</td></tr>
            )}
            {filtered.map(c => {
              const fu = c.followUps[0];
              const fuDate = fu ? new Date(fu.dueAt) : null;
              const fuOverdue = fuDate && fuDate < now;
              const iv = c.interviews[0];
              const lastAct = c.activities[0];
              return (
                <tr key={c.id} className="hover:bg-gray-50/80 dark:hover:bg-slate-800/50 transition">
                  <td className="px-3 py-2.5 min-w-[140px]">
                    <Link href={`/hr/candidates/${c.id}`} className="font-semibold text-[#1a2e4a] dark:text-blue-400 hover:underline block">{c.name}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                    {c.phone ? <a href={`tel:${c.phone}`} className="hover:text-blue-600">{c.phone}</a> : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                    {(c.whatsappPhone ?? c.phone) ? (
                      <a href={`https://wa.me/${(c.whatsappPhone??c.phone)!.replace(/\D/g,"")}`} target="_blank" rel="noopener noreferrer" className="hover:text-green-600">💬</a>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{c.experience ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs min-w-[140px]">
                    {c.currentCompany && <div className="font-medium text-gray-700 dark:text-slate-200 truncate">{c.currentCompany}</div>}
                    {c.currentProfile && <div className="text-gray-500 truncate">{c.currentProfile}</div>}
                    {!c.currentCompany && !c.currentProfile && "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                    {fmtSal(c.currentSalary)} → <span className="font-medium text-gray-800 dark:text-slate-200">{fmtSal(c.expectedSalary)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{c.noticePeriod ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_COLOR[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {fmt(c.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600 max-w-[120px]">
                    <div className="truncate">{c.nextAction ?? "—"}</div>
                    {c.nextActionDate && <div className="text-[10px] text-amber-600">{fmtDate(c.nextActionDate)}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                    {fuDate ? (
                      <span className={fuOverdue ? "text-red-600 font-semibold" : "text-amber-600"}>
                        {fuOverdue ? "⚠ " : "📅 "}{fmtDate(fu!.dueAt)}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                    {iv ? <span className="text-blue-700">🎯 {fmtDate(iv.scheduledAt)}</span> : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {iv ? (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${iv.confirmationStatus==="CONFIRMED"?"bg-green-100 text-green-700":"bg-amber-100 text-amber-700"}`}>
                        {fmt(iv.confirmationStatus)}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">{c.primaryOwner?.name?.split(" ")[0] ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                    {lastAct ? (
                      <div>
                        <div className="text-gray-700 dark:text-slate-300">{fmt(lastAct.type).slice(0,18)}</div>
                        <div className="text-[10px]">{fmtDate(lastAct.createdAt)}</div>
                      </div>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[140px]">
                    <div className="truncate">{c.remarks ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/hr/candidates/${c.id}`}
                      className="text-[11px] px-2 py-1 rounded-lg bg-[#1a2e4a] text-white hover:bg-[#243d60] whitespace-nowrap">
                      Open
                    </Link>
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
          const fuOverdue = fu && new Date(fu.dueAt) < now;
          const iv = c.interviews[0];
          return (
            <Link key={c.id} href={`/hr/candidates/${c.id}`}
              className="block bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-3 hover:shadow-md transition">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-sm text-gray-900 dark:text-white">{c.name}</div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOR[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                  {fmt(c.status)}
                </span>
              </div>
              {(c.currentProfile || c.currentCompany) && (
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {c.currentProfile}{c.currentCompany ? ` · ${c.currentCompany}` : ""}
                </div>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-gray-500">
                {c.phone && <span>📞 {c.phone}</span>}
                {c.expectedSalary && <span>Expected: {fmtSal(c.expectedSalary)}</span>}
                {fu && <span className={fuOverdue ? "text-red-600 font-semibold" : "text-amber-600"}>
                  {fuOverdue ? "⚠ Overdue" : `📅 ${fmtDate(fu.dueAt)}`}
                </span>}
                {iv && <span className="text-blue-700">🎯 {fmtDateTime(iv.scheduledAt)}</span>}
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && <div className="text-center text-gray-400 text-sm py-8">No candidates found.</div>}
      </div>
    </div>
  );
}
